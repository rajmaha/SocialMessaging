from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import os

from app.database import get_db
from app.dependencies import get_current_user, require_module
from app.models.user import User
from app.models import UserEmailAccount, Email
from app.models.email import EmailSignature, Contact, EmailThread, EmailAttachment
from app.schemas.email import (
    EmailAccountResponse, SendEmailRequest, SendEmailReplyRequest,
    EmailResponse, EmailListResponse, SyncEmailsResponse,
    EmailSignatureCreate, EmailSignatureUpdate, EmailSignatureResponse,
    ContactCreate, ContactUpdate, ContactResponse, ContactListResponse,
    ScheduledSendRequest, EmailThreadListResponse, EmailThreadResponse
)
from app.services.email_service import email_service
from pydantic import BaseModel

router = APIRouter(prefix="/email", tags=["email"])

require_email = require_module("module_email")

# Add the dependency to the router after it's defined
router.dependencies.append(Depends(require_email))


def get_user_email_account(db: Session, user_id: int, account_id: Optional[int] = None):
    """Helper to get user's email account with support for multiple accounts"""
    query = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == user_id,
        UserEmailAccount.is_active == True
    )
    if account_id:
        return query.filter(UserEmailAccount.id == account_id).first()
    return query.first()


# ========== EMAIL ACCOUNT REQUEST ==========

class EmailAccountRequestBody(BaseModel):
    message: Optional[str] = None

@router.post("/request-account")
def request_email_account(
    body: EmailAccountRequestBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Allow a user without an email account to request one from the admin"""
    # Allow users to request additional accounts even if they already have one

    # Get admin email from branding settings; fall back to SMTP from_email
    from app.services.branding_service import branding_service
    branding = branding_service.get_branding(db)
    admin_email = (branding.admin_email if branding and branding.admin_email else None) or \
                  (branding.smtp_from_email if branding and branding.smtp_from_email else None)

    requester_name = current_user.full_name or current_user.username or current_user.email

    if admin_email:
        email_service.send_email_account_request(
            admin_email=admin_email,
            requester_name=requester_name,
            requester_email=current_user.email,
            message=body.message or "",
            db=db,
        )
        return {"status": "success", "message": "Your request has been sent to the administrator."}
    else:
        # No email configured at all – log it and let the user know
        print(f"📋 Email account request from {requester_name} <{current_user.email}> (no admin email configured — set one in Branding → Settings)")
        return {
            "status": "logged",
            "message": "Your request has been recorded. The administrator has not yet configured a contact email, so please also reach out to them directly."
        }


# ========== EMAIL ACCOUNT ACCESS (USERS CAN VIEW/USE ONLY) ==========

@router.get("/accounts", response_model=List[EmailAccountResponse])
def get_email_accounts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all email accounts for the current user"""
    accounts = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id,
        UserEmailAccount.is_active == True
    ).all()
    return accounts

@router.get("/account", response_model=EmailAccountResponse)
def get_email_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the primary email account (first configured)"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id,
        UserEmailAccount.is_active == True
    ).first()
    
    if not account:
        raise HTTPException(
            status_code=404, 
            detail="No email account configured for this user."
        )
    return account


@router.post("/account/sync", response_model=SyncEmailsResponse)
async def sync_emails(
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Sync emails from IMAP account"""
    try:
        account = get_user_email_account(db, current_user.id, account_id)
        
        if not account:
            raise HTTPException(
                status_code=404, 
                detail="No email account configured for this user"
            )
        
        # Sync emails
        synced_count = email_service.sync_emails_from_imap(account, db)
        
        # Notify frontend via WebSocket if new emails arrived
        if synced_count > 0:
            from app.services.events_service import events_service, EventTypes
            await events_service.broadcast_to_user(current_user.id, {
                "type": EventTypes.EMAIL_RECEIVED,
                "synced_count": synced_count,
                "message": f"{synced_count} new email{'s' if synced_count > 1 else ''} received"
            })
        
        return {
            "status": "success",
            "synced_count": synced_count,
            "message": f"Successfully synced {synced_count} emails from {account.email_address}"
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to sync emails: {str(e)}")


@router.get("/inbox", response_model=EmailListResponse)
def get_inbox(
    account_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 20,
    starred: bool = False,
    has_attachments: bool = False,
    search: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get emails from current user's inbox"""
    account = get_user_email_account(db, current_user.id, account_id)
    
    if not account:
        raise HTTPException(
            status_code=404, 
            detail="No email account configured for this user"
        )

    base_filter = [
        Email.account_id == account.id,
        Email.from_address != account.email_address,  # only received emails (not sent by us)
        Email.is_archived == False,
        Email.is_spam == False,
        Email.is_draft == False,
    ]
    if starred:
        base_filter.append(Email.is_starred == True)
    if has_attachments:
        from app.models.email import EmailAttachment
        base_filter.append(
            Email.id.in_(
                db.query(EmailAttachment.email_id).distinct()
            )
        )
    if search:
        from sqlalchemy import or_
        term = f"%{search}%"
        base_filter.append(
            or_(
                Email.subject.ilike(term),
                Email.from_address.ilike(term),
                Email.body_text.ilike(term),
            )
        )

    # Get RECEIVED emails (from_address != user's email) - exclude sent/drafts/trash
    received = db.query(Email).filter(
        *base_filter
    ).order_by(Email.received_at.desc()).offset(skip).limit(limit).all()

    # Collect thread_ids from received emails so we can include sent replies in same threads
    thread_ids = list({e.thread_id for e in received if e.thread_id is not None})

    # Fetch sent replies that belong to those threads (to complete the chain)
    sent_in_threads = []
    if thread_ids:
        sent_in_threads = db.query(Email).filter(
            Email.account_id == account.id,
            Email.thread_id.in_(thread_ids),
            Email.from_address == account.email_address,
            Email.is_sent == True
        ).all()

    # Merge and deduplicate by id
    all_emails = list({e.id: e for e in received + sent_in_threads}.values())

    total = db.query(Email).filter(*base_filter).count()

    return {
        "total": total,
        "emails": all_emails
    }


@router.get("/sent", response_model=EmailListResponse)
def get_sent_threads(
    account_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    skip: int = 0,          # alias for offset (frontend sends 'skip')
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get sent email threads"""
    from app.models.email import Email as EmailModel
    effective_offset = offset or skip

    query = db.query(UserEmailAccount).filter(UserEmailAccount.user_id == current_user.id)
    if account_id:
        account = query.filter(UserEmailAccount.id == account_id).first()
    else:
        account = query.first()

    if not account:
        raise HTTPException(
            status_code=404,
            detail="No email account configured for this user"
        )

    from sqlalchemy import or_
    base_filter = [
        EmailModel.account_id == account.id,
        # "Sent" = emails the user composed: either flagged is_sent=True by the app,
        # OR from_address matches the account (IMAP sync saves all emails with is_sent=0,
        # so we need from_address to catch IMAP-synced sent emails).
        or_(
            EmailModel.is_sent == True,
            EmailModel.from_address == account.email_address,
        ),
        EmailModel.is_draft == False,
        EmailModel.is_archived == False,
        EmailModel.is_scheduled == False,
    ]
    if search:
        from sqlalchemy import or_
        term = f"%{search}%"
        base_filter.append(
            or_(
                EmailModel.subject.ilike(term),
                EmailModel.from_address.ilike(term),
                EmailModel.to_address.ilike(term),
                EmailModel.body_text.ilike(term),
            )
        )

    emails = db.query(EmailModel).filter(
        *base_filter
    ).order_by(EmailModel.received_at.desc()).offset(effective_offset).limit(limit).all()

    total = db.query(EmailModel).filter(*base_filter).count()

    return {
        "total": total,
        "emails": emails
    }


@router.get("/archived", response_model=EmailListResponse)
def get_archived_threads(
    account_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get archived email threads from current user"""
    from app.models.email import Email as EmailModel

    query = db.query(UserEmailAccount).filter(UserEmailAccount.user_id == current_user.id)
    if account_id:
        account = query.filter(UserEmailAccount.id == account_id).first()
    else:
        account = query.first()
    
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured for this user")
    
    base_filter = [
        EmailModel.account_id == account.id,
        EmailModel.is_archived == True
    ]
    if search:
        from sqlalchemy import or_
        term = f"%{search}%"
        base_filter.append(
            or_(
                EmailModel.subject.ilike(term),
                EmailModel.from_address.ilike(term),
                EmailModel.body_text.ilike(term),
            )
        )

    emails = db.query(EmailModel).filter(
        *base_filter
    ).order_by(EmailModel.received_at.desc()).offset(offset).limit(limit).all()
    
    total = db.query(EmailModel).filter(*base_filter).count()
    
    return {"total": total, "emails": emails}


@router.get("/starred", response_model=EmailListResponse)
def get_starred_threads(
    account_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get starred email threads from current user"""
    from app.models.email import Email as EmailModel

    query = db.query(UserEmailAccount).filter(UserEmailAccount.user_id == current_user.id)
    if account_id:
        account = query.filter(UserEmailAccount.id == account_id).first()
    else:
        account = query.first()
    
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured for this user")
    
    base_filter = [
        EmailModel.account_id == account.id,
        EmailModel.is_starred == True,
        EmailModel.is_archived == False,
        EmailModel.is_spam == False,
        EmailModel.is_draft == False
    ]
    if search:
        from sqlalchemy import or_
        term = f"%{search}%"
        base_filter.append(
            or_(
                EmailModel.subject.ilike(term),
                EmailModel.from_address.ilike(term),
                EmailModel.body_text.ilike(term),
            )
        )

    emails = db.query(EmailModel).filter(
        *base_filter
    ).order_by(EmailModel.received_at.desc()).offset(offset).limit(limit).all()
    
    total = db.query(EmailModel).filter(*base_filter).count()
    
    return {"total": total, "emails": emails}


@router.get("/drafts", response_model=EmailListResponse)
def get_drafts(
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get draft emails composed by current user"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured for this user")
    
    base_filter = [
        Email.account_id == account.id,
        Email.from_address == account.email_address,
        Email.is_draft == True
    ]
    if search:
        from sqlalchemy import or_
        term = f"%{search}%"
        base_filter.append(
            or_(
                Email.subject.ilike(term),
                Email.to_address.ilike(term),
                Email.body_text.ilike(term),
            )
        )

    # Get OUTGOING drafts (from_address == user's email)
    emails = db.query(Email).filter(
        *base_filter
    ).order_by(Email.received_at.desc()).offset(skip).limit(limit).all()
    
    total = db.query(Email).filter(*base_filter).count()
    
    return {"total": total, "emails": emails}


@router.get("/outbox", response_model=EmailListResponse)
def get_outbox(
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get unsent outgoing emails from outbox (emails sent by us that failed to send)"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured for this user")
    
    base_filter = [
        Email.account_id == account.id,
        Email.from_address == account.email_address,
        Email.is_sent == False,
        Email.is_draft == False,
        Email.is_archived == False,
        Email.is_scheduled == False,   # scheduled emails belong in Scheduled, not Outbox
    ]
    if search:
        from sqlalchemy import or_
        term = f"%{search}%"
        base_filter.append(
            or_(
                Email.subject.ilike(term),
                Email.to_address.ilike(term),
                Email.body_text.ilike(term),
            )
        )

    # Get OUTGOING emails (from_address == user's email) that are unsent and not drafts
    emails = db.query(Email).filter(
        *base_filter
    ).order_by(Email.received_at.desc()).offset(skip).limit(limit).all()
    
    total = db.query(Email).filter(*base_filter).count()
    
    return {"total": total, "emails": emails}


@router.get("/thread/{thread_id}", response_model=EmailListResponse)
def get_thread(
    thread_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all emails in a thread (received + sent replies) in chronological order"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")

    # Verify the thread belongs to this account
    from app.models.email import EmailThread
    thread = db.query(EmailThread).filter(
        EmailThread.id == thread_id,
        EmailThread.account_id == account.id,
    ).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    emails = (
        db.query(Email)
        .filter(Email.thread_id == thread_id, Email.is_draft == False)
        .order_by(Email.received_at.asc())
        .all()
    )
    return {"total": len(emails), "emails": emails}


@router.get("/emails/{email_id}", response_model=EmailResponse)
def get_email(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get specific email"""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Verify user owns this email
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    # Mark as read
    if not email.is_read:
        email.is_read = True
        db.commit()
    
    return email


@router.get("/{email_id}/attachments/{attachment_id}")
def download_attachment(
    email_id: int,
    attachment_id: str,  # Can be ID or filename
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Download email attachment"""
    try:
        # Get the email to verify ownership
        email = db.query(Email).filter(Email.id == email_id).first()
        
        if not email:
            raise HTTPException(status_code=404, detail="Email not found")
        
        # Verify user owns this email
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.id == email.account_id,
            UserEmailAccount.user_id == current_user.id
        ).first()
        
        if not account:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Find attachment - try both by ID and by filename
        attachment = None
        try:
            # Try as integer ID first
            attachment_id_int = int(attachment_id)
            attachment = db.query(EmailAttachment).filter(
                EmailAttachment.id == attachment_id_int,
                EmailAttachment.email_id == email_id
            ).first()
        except ValueError:
            # If not an integer, search by filename
            attachment = db.query(EmailAttachment).filter(
                EmailAttachment.email_id == email_id,
                EmailAttachment.filename == attachment_id
            ).first()
        
        if not attachment:
            raise HTTPException(status_code=404, detail="Attachment not found")
        
        # Check if file exists
        file_path = attachment.file_path
        if not file_path or not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found on server")
        
        # Return file as download
        return FileResponse(
            path=file_path,
            filename=attachment.filename,
            media_type=attachment.content_type or 'application/octet-stream'
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error downloading attachment: {str(e)}")

@router.post("/send")
def send_email(
    request: SendEmailRequest,
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a new email"""
    account = get_user_email_account(db, current_user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Email account not configured")
    
    try:
        # Send via service
        email_service.send_email_from_account(
            account,
            request.to_address,
            request.subject,
            request.body,
            request.cc,
            request.bcc
        )
        # Save to sent folder
        from app.models.email import Email as EmailModel
        sent_email = EmailModel(
            account_id=account.id,
            message_id=f"sent_{datetime.utcnow().timestamp()}_{current_user.id}",
            subject=request.subject,
            from_address=account.email_address,
            to_address=request.to_address,
            cc=request.cc,
            bcc=request.bcc,
            body_html=request.body,
            received_at=datetime.utcnow(),
            is_sent=True,
            is_read=True
        )
        db.add(sent_email)
        db.commit()
        return {"status": "success", "message": "Email sent successfully", "id": sent_email.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to send email: {str(e)}")


@router.post("/emails/{email_id}/reply")
def reply_to_email(
    email_id: int,
    request: SendEmailReplyRequest,
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reply to an email thread"""
    try:
        # Get the original email
        from app.models.email import Email as EmailModel
        original_email = db.query(EmailModel).filter(EmailModel.id == email_id).first()
        if not original_email:
            raise HTTPException(status_code=404, detail="Email not found")
            
        account = get_user_email_account(db, current_user.id, account_id or original_email.account_id)
        if not account:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Prepare subject
        reply_subject = original_email.subject
        if not reply_subject.startswith("Re:"):
            reply_subject = f"Re: {reply_subject}"
        
        # Send reply via SMTP
        email_service.send_email_from_account(
            account,
            original_email.from_address,
            reply_subject,
            request.body,
            request.cc,
            request.bcc,
            in_reply_to=original_email.message_id
        )
        
        # Get or create email thread
        thread = None
        if original_email.thread_id:
            thread = db.query(EmailThread).filter(
                EmailThread.id == original_email.thread_id
            ).first()
        else:
            # Create new thread from original email
            thread = EmailThread(
                account_id=account.id,
                subject=original_email.subject,
                from_address=original_email.from_address,
                to_addresses=original_email.to_address,
                cc_addresses=original_email.cc,
                thread_key=original_email.message_id,
                first_email_at=original_email.received_at,
                last_email_at=original_email.received_at
            )
            db.add(thread)
            db.flush()  # Get thread.id
            
            # Update original email with thread_id
            original_email.thread_id = thread.id
        
        # Save reply to sent folder
        reply_email = EmailModel(
            account_id=account.id,
            thread_id=thread.id,
            message_id=f"sent_{datetime.utcnow().timestamp()}_{current_user.id}",
            subject=reply_subject,
            from_address=account.email_address,
            to_address=original_email.from_address,
            cc=request.cc,
            bcc=request.bcc,
            body_html=request.body,
            received_at=datetime.utcnow(),
            in_reply_to=original_email.message_id,
            is_sent=True,
            is_read=True
        )
        db.add(reply_email)
        
        # Update thread stats
        thread.last_email_at = datetime.utcnow()
        thread.reply_count = (thread.reply_count or 0) + 1
        
        db.commit()
        
        return {
            "status": "success",
            "message": f"Reply sent successfully to {original_email.from_address}",
            "reply_email_id": reply_email.id
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to send reply: {str(e)}")


@router.put("/emails/{email_id}/mark-read")
def mark_email_read(
    email_id: int,
    is_read: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark email as read/unread"""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Verify user owns this email
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    email.is_read = is_read
    db.commit()
    
    return {"status": "success", "message": "Email updated"}


@router.put("/emails/{email_id}/star")
def star_email(
    email_id: int,
    is_starred: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Star/unstar email"""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Verify user owns this email
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    email.is_starred = is_starred
    db.commit()
    
    return {"status": "success", "message": "Email updated"}


@router.put("/emails/{email_id}/trash")
def trash_email(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Move email to trash (archive)"""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Verify user owns this email
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    email.is_archived = True
    
    # If part of a thread, move all emails in thread to trash
    if email.thread_id is not None:
        db.query(Email).filter(
            Email.thread_id == email.thread_id,
            Email.account_id == email.account_id
        ).update({"is_archived": True}, synchronize_session=False)
        
    db.commit()
    
    return {"status": "success", "message": "Email moved to trash"}


@router.put("/emails/{email_id}/restore")
def restore_email(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Restore email from trash"""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Verify user owns this email
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    email.is_archived = False
    
    # If part of a thread, restore all emails in thread
    if email.thread_id is not None:
        db.query(Email).filter(
            Email.thread_id == email.thread_id,
            Email.account_id == email.account_id
        ).update({"is_archived": False}, synchronize_session=False)
        
    db.commit()
    
    return {"status": "success", "message": "Email restored"}


@router.post("/emails/{email_id}/forward")
def forward_email(
    email_id: int,
    to_address: str,
    cc: str = None,
    bcc: str = None,
    reply_text: str = "",
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Forward email to another recipient"""
    try:
        # Get the original email
        from app.models.email import Email as EmailModel
        original_email = db.query(EmailModel).filter(EmailModel.id == email_id).first()
        
        if not original_email:
            raise HTTPException(status_code=404, detail="Email not found")
        
        # Verify user owns this email
        account = get_user_email_account(db, current_user.id, account_id or original_email.account_id)
        
        if not account:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Prepare forwarded subject
        fwd_subject = original_email.subject
        if not fwd_subject.startswith("Fwd:"):
            fwd_subject = f"Fwd: {fwd_subject}"
        
        # Prepare forwarded body
        fwd_body = f"""
{reply_text}

---------- Forwarded message ---------
From: {original_email.from_address}
Date: {original_email.received_at}
Subject: {original_email.subject}
To: {original_email.to_address}
Cc: {original_email.cc or ''}

{original_email.body_html or original_email.body_text}
        """
        
        # Send forwarded email
        email_service.send_email_from_account(
            account,
            to_address,
            fwd_subject,
            fwd_body,
            cc,
            bcc
        )
        
        # Save forwarded email to sent folder
        forwarded_email = EmailModel(
            account_id=account.id,
            message_id=f"fwd_{datetime.utcnow().timestamp()}_{current_user.id}",
            subject=fwd_subject,
            from_address=account.email_address,
            to_address=to_address,
            cc=cc,
            bcc=bcc,
            body_html=fwd_body,
            received_at=datetime.utcnow(),
            is_sent=True,
            is_read=True
        )
        db.add(forwarded_email)
        db.commit()
        
        return {
            "status": "success",
            "message": f"Email forwarded successfully to {to_address}",
            "forwarded_email_id": forwarded_email.id
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to forward email: {str(e)}")


@router.put("/emails/{email_id}/mark-unread")
def mark_email_unread(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark email as unread (unseen)"""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Verify user owns this email
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    email.is_read = False
    db.commit()
    
    return {"status": "success", "message": "Email marked as unread"}


@router.put("/emails/{email_id}/labels")
def update_email_labels(
    email_id: int,
    label_ids: List[str] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add or remove labels from email"""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    # Verify user owns this email
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    email.labels = label_ids
    db.commit()
    
    return {"status": "success", "message": "Labels updated", "labels": email.labels}


@router.post("/drafts/save")
def save_draft(
    request_data: SendEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save email as draft"""
    try:
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.user_id == current_user.id
        ).first()
        
        if not account:
            raise HTTPException(status_code=404, detail="No email account configured for this user")
        
        from app.models.email import Email as EmailModel
        draft_email = EmailModel(
            account_id=account.id,
            message_id=f"draft_{datetime.utcnow().timestamp()}_{current_user.id}",
            subject=request_data.subject,
            from_address=account.email_address,
            to_address=request_data.to_address,
            cc=request_data.cc,
            bcc=request_data.bcc,
            body_html=request_data.body,
            received_at=datetime.utcnow(),
            is_draft=True,
            is_read=True
        )
        db.add(draft_email)
        db.commit()
        
        return {
            "status": "success",
            "message": "Draft saved successfully",
            "draft_id": draft_email.id
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to save draft: {str(e)}")


@router.put("/drafts/{draft_id}")
def update_draft(
    draft_id: int,
    request_data: SendEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a draft email"""
    draft = db.query(Email).filter(Email.id == draft_id).first()
    
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    
    # Verify user owns this draft
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == draft.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    # Update draft fields
    draft.subject = request_data.subject
    draft.to_address = request_data.to_address
    draft.cc = request_data.cc
    draft.bcc = request_data.bcc
    draft.body_html = request_data.body
    draft.updated_at = datetime.utcnow()
    db.commit()
    
    return {"status": "success", "message": "Draft updated successfully"}


@router.delete("/drafts/{draft_id}")
def delete_draft(
    draft_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a draft email"""
    draft = db.query(Email).filter(Email.id == draft_id, Email.is_draft == True).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == draft.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    db.delete(draft)
    db.commit()
    return {"status": "success", "message": "Draft deleted"}


@router.post("/outbox/{email_id}/retry")
def retry_send_outbox_email(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retry sending an email from outbox"""
    try:
        email = db.query(Email).filter(Email.id == email_id).first()
        
        if not email:
            raise HTTPException(status_code=404, detail="Email not found")
        
        # Verify user owns this email
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.id == email.account_id,
            UserEmailAccount.user_id == current_user.id
        ).first()
        
        if not account:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Retry sending
        email_service.send_email_from_account(
            account,
            email.to_address,
            email.subject,
            email.body_html or email.body_text,
            email.cc,
            email.bcc
        )
        
        # Mark as sent
        email.is_sent = True
        db.commit()
        
        return {"status": "success", "message": "Email sent successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to send email: {str(e)}")


@router.post("/drafts/{draft_id}/send")
def send_from_draft(
    draft_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send an email from draft"""
    try:
        draft = db.query(Email).filter(Email.id == draft_id).first()
        
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        # Verify user owns this draft
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.id == draft.account_id,
            UserEmailAccount.user_id == current_user.id
        ).first()
        
        if not account:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Send email
        email_service.send_email_from_account(
            account,
            draft.to_address,
            draft.subject,
            draft.body_html or draft.body_text,
            draft.cc,
            draft.bcc
        )
        
        # Update draft to sent
        draft.is_draft = False
        draft.is_sent = True
        draft.message_id = f"sent_{datetime.utcnow().timestamp()}"
        db.commit()
        
        return {"status": "success", "message": "Email sent successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to send email: {str(e)}")


# ========== EMAIL SIGNATURE ENDPOINTS ==========

@router.post("/signature", response_model=EmailSignatureResponse)
def create_email_signature(
    sig_data: EmailSignatureCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create or update email signature"""
    
    # Check if signature exists
    signature = db.query(EmailSignature).filter(
        EmailSignature.user_id == current_user.id
    ).first()
    
    if signature:
        # Update existing
        signature.signature_text = sig_data.signature_text
        signature.is_html = sig_data.is_html
        signature.is_enabled = sig_data.is_enabled
        signature.updated_at = datetime.utcnow()
    else:
        # Create new
        signature = EmailSignature(
            user_id=current_user.id,
            signature_text=sig_data.signature_text,
            is_html=sig_data.is_html,
            is_enabled=sig_data.is_enabled
        )
        db.add(signature)
    
    db.commit()
    db.refresh(signature)
    
    return signature


@router.get("/signature", response_model=EmailSignatureResponse)
def get_email_signature(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's email signature"""
    
    signature = db.query(EmailSignature).filter(
        EmailSignature.user_id == current_user.id
    ).first()
    
    if not signature:
        raise HTTPException(
            status_code=404, 
            detail="No email signature configured"
        )
    
    return signature


@router.delete("/signature")
def delete_email_signature(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete email signature"""
    
    signature = db.query(EmailSignature).filter(
        EmailSignature.user_id == current_user.id
    ).first()
    
    if not signature:
        raise HTTPException(status_code=404, detail="No email signature found")
    
    db.delete(signature)
    db.commit()
    
    return {"status": "success", "message": "Email signature deleted"}


# ========== MULTI-SIGNATURE LIST ENDPOINTS ==========
# Stores the full list of named signatures as a JSON blob in the signature_text column.
# is_html=True signals that the column contains a JSON array, not a plain HTML string.

@router.get("/signatures-all")
def get_all_signatures(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return the user's full list of named signatures (JSON array)"""
    import json
    row = db.query(EmailSignature).filter(
        EmailSignature.user_id == current_user.id
    ).first()
    if not row or not row.signature_text:
        return []
    try:
        result = json.loads(row.signature_text)
        # Only return if it's a JSON list (our multi-signature format)
        if isinstance(result, list):
            return result
        return []
    except Exception:
        return []


@router.put("/signatures-all")
def save_all_signatures(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Persist the full list of named signatures as a JSON array"""
    import json
    sigs = payload.get("signatures", [])
    blob = json.dumps(sigs)
    row = db.query(EmailSignature).filter(
        EmailSignature.user_id == current_user.id
    ).first()
    if row:
        row.signature_text = blob
        row.is_html = True
        row.updated_at = datetime.utcnow()
    else:
        row = EmailSignature(
            user_id=current_user.id,
            signature_text=blob,
            is_html=True,
            is_enabled=True,
        )
        db.add(row)
    db.commit()
    return {"status": "ok", "count": len(sigs)}


# ========== CONTACT ENDPOINTS ==========

@router.post("/contacts", response_model=ContactResponse)
def create_contact(
    contact_data: ContactCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create new contact"""
    
    new_contact = Contact(
        user_id=current_user.id,
        name=contact_data.name,
        email=contact_data.email,
        phone=contact_data.phone,
        notes=contact_data.notes
    )
    
    db.add(new_contact)
    db.commit()
    db.refresh(new_contact)
    
    return new_contact


@router.get("/contacts", response_model=ContactListResponse)
def get_contacts(
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all contacts for current user"""
    
    contacts = db.query(Contact).filter(
        Contact.user_id == current_user.id
    ).order_by(Contact.name).offset(skip).limit(limit).all()
    
    total = db.query(Contact).filter(
        Contact.user_id == current_user.id
    ).count()
    
    return {
        "total": total,
        "contacts": contacts
    }


@router.get("/contacts/{contact_id}", response_model=ContactResponse)
def get_contact(
    contact_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get specific contact"""
    
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.user_id == current_user.id
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    return contact


@router.put("/contacts/{contact_id}", response_model=ContactResponse)
def update_contact(
    contact_id: int,
    contact_update: ContactUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update contact"""
    
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.user_id == current_user.id
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Update fields
    if contact_update.name is not None:
        contact.name = contact_update.name
    if contact_update.email is not None:
        contact.email = contact_update.email
    if contact_update.phone is not None:
        contact.phone = contact_update.phone
    if contact_update.notes is not None:
        contact.notes = contact_update.notes
    
    contact.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(contact)
    
    return contact


@router.delete("/contacts/{contact_id}")
def delete_contact(
    contact_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete contact"""
    
    contact = db.query(Contact).filter(
        Contact.id == contact_id,
        Contact.user_id == current_user.id
    ).first()
    
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    db.delete(contact)
    db.commit()
    
    return {"status": "success", "message": "Contact deleted"}


# ========== SCHEDULED EMAIL ENDPOINTS ==========

@router.post("/send-later")

@router.post("/send-later")
def schedule_email(
    request_data: ScheduledSendRequest,
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Schedule an email to be sent at a future time (UTC)."""
    account = get_user_email_account(db, current_user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")

    try:
        scheduled_dt = datetime.fromisoformat(request_data.scheduled_at.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format. Use ISO 8601 UTC.")

    if scheduled_dt <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Scheduled time must be in the future")

    from app.models.email import Email as EmailModel
    scheduled_email = EmailModel(
        account_id=account.id,
        message_id=f"scheduled_{datetime.utcnow().timestamp()}_{current_user.id}",
        subject=request_data.subject,
        from_address=account.email_address,
        to_address=request_data.to_address,
        cc=request_data.cc,
        bcc=request_data.bcc,
        body_html=request_data.body,
        received_at=scheduled_dt,
        is_draft=False,
        is_sent=False,
        is_scheduled=True,
        scheduled_at=scheduled_dt,
        labels=[],
        is_read=True,
    )
    db.add(scheduled_email)
    db.commit()
    db.refresh(scheduled_email)

    return {
        "status": "scheduled",
        "id": scheduled_email.id,
        "scheduled_at": scheduled_dt.isoformat(),
        "message": f"Email scheduled to send to {request_data.to_address} at {scheduled_dt.strftime('%b %d, %Y %H:%M')} UTC",
    }


@router.get("/scheduled")
def list_scheduled_emails(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all pending scheduled emails for the current user."""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        return []

    from app.models.email import Email as EmailModel
    rows = (
        db.query(EmailModel)
        .filter(
            EmailModel.account_id == account.id,
            EmailModel.is_scheduled == True,
        )
        .order_by(EmailModel.scheduled_at)
        .all()
    )

    return [
        {
            "id": r.id,
            "to_address": r.to_address,
            "subject": r.subject,
            "scheduled_at": (r.scheduled_at.isoformat() + "Z") if r.scheduled_at else None,
            "body_html": r.body_html,
            "cc": r.cc,
            "bcc": r.bcc,
        }
        for r in rows
    ]


@router.delete("/scheduled/{email_id}")
def cancel_scheduled_email(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cancel a scheduled email (delete it before it is sent)."""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")

    from app.models.email import Email as EmailModel
    row = db.query(EmailModel).filter(
        EmailModel.id == email_id,
        EmailModel.account_id == account.id,
        EmailModel.is_scheduled == True,
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Scheduled email not found")

    db.delete(row)
    db.commit()
    return {"status": "cancelled", "message": "Scheduled email cancelled"}


# ========== PERMANENT DELETE ==========

@router.delete("/emails/{email_id}/permanent")
def permanently_delete_email(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Permanently delete an email (hard delete from DB)"""
    from app.models.email import Email as EmailModel
    email = db.query(EmailModel).filter(EmailModel.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    # If part of a thread, permanently delete all emails in thread
    if email.thread_id is not None:
        db.query(EmailModel).filter(
            EmailModel.thread_id == email.thread_id,
            EmailModel.account_id == email.account_id
        ).delete(synchronize_session=False)
    else:
        db.delete(email)
        
    db.commit()
    return {"status": "success", "message": "Email permanently deleted"}



@router.post("/bulk-delete-permanent")
def bulk_permanently_delete_emails(
    email_ids: List[int] = Body(...),
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Permanently delete multiple emails"""
    from app.models.email import Email as EmailModel
    account = get_user_email_account(db, current_user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")
    db.query(EmailModel).filter(
        EmailModel.id.in_(email_ids),
        EmailModel.account_id == account.id
    ).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "deleted": len(email_ids)}


@router.post("/bulk-mark-read")
def bulk_mark_read_emails(
    email_ids: List[int] = Body(...),
    is_read: bool = Body(..., embed=True),
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark multiple emails as read or unread"""
    from app.models.email import Email as EmailModel
    account = get_user_email_account(db, current_user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")
    db.query(EmailModel).filter(
        EmailModel.id.in_(email_ids),
        EmailModel.account_id == account.id
    ).update({EmailModel.is_read: is_read}, synchronize_session=False)
    db.commit()
    return {"status": "success", "updated": len(email_ids)}


@router.post("/bulk-trash")
def bulk_trash_emails(
    email_ids: List[int] = Body(...),
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Move multiple emails to trash (archive)"""
    from app.models.email import Email as EmailModel
    account = get_user_email_account(db, current_user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")
    db.query(EmailModel).filter(
        EmailModel.id.in_(email_ids),
        EmailModel.account_id == account.id
    ).update({EmailModel.is_archived: True}, synchronize_session=False)
    db.commit()
    return {"status": "success", "trashed": len(email_ids)}


@router.post("/bulk-add-label")
def bulk_add_label_emails(
    email_ids: List[int] = Body(...),
    label_id: str = Body(..., embed=True),
    account_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a label to multiple emails"""
    from app.models.email import Email as EmailModel
    account = get_user_email_account(db, current_user.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")
    
    # Labels are stored as a JSON array in the database
    emails = db.query(EmailModel).filter(
        EmailModel.id.in_(email_ids),
        EmailModel.account_id == account.id
    ).all()
    
    for email in emails:
        labels = list(email.labels) if email.labels else []
        if label_id not in labels:
            labels.append(label_id)
            email.labels = labels
    
    db.commit()
    return {"status": "success", "updated": len(emails)}


# ========== SNOOZE ==========

class SnoozeRequest(BaseModel):
    snoozed_until: str  # ISO 8601

@router.put("/emails/{email_id}/snooze")
def snooze_email(
    email_id: int,
    body: SnoozeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Snooze an email until a given time"""
    from app.models.email import Email as EmailModel
    email = db.query(EmailModel).filter(EmailModel.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    try:
        snooze_dt = datetime.fromisoformat(body.snoozed_until.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format")
    email.snoozed_until = snooze_dt
    db.commit()
    return {"status": "success", "snoozed_until": snooze_dt.isoformat()}


@router.delete("/emails/{email_id}/snooze")
def unsnooze_email(
    email_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove snooze from an email"""
    from app.models.email import Email as EmailModel
    email = db.query(EmailModel).filter(EmailModel.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.id == email.account_id,
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=403, detail="Unauthorized")
    email.snoozed_until = None
    db.commit()
    return {"status": "success"}


@router.get("/snoozed")
def get_snoozed_emails(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all currently snoozed emails"""
    from app.models.email import Email as EmailModel
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")
    now = datetime.utcnow()
    emails = db.query(EmailModel).filter(
        EmailModel.account_id == account.id,
        EmailModel.snoozed_until != None,
        EmailModel.snoozed_until > now
    ).order_by(EmailModel.snoozed_until).all()
    return [{
        "id": e.id,
        "subject": e.subject,
        "from_address": e.from_address,
        "snoozed_until": e.snoozed_until.isoformat() if e.snoozed_until else None,
        "is_read": e.is_read,
    } for e in emails]


# ========== EMAIL TEMPLATES ==========

class EmailTemplateRequest(BaseModel):
    name: str
    subject: Optional[str] = None
    body: str

@router.get("/templates")
def list_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailTemplate
    templates = db.query(EmailTemplate).filter(
        EmailTemplate.user_id == current_user.id
    ).order_by(EmailTemplate.created_at.desc()).all()
    return [{"id": t.id, "name": t.name, "subject": t.subject, "body": t.body} for t in templates]

@router.post("/templates")
def create_template(
    body: EmailTemplateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailTemplate
    tpl = EmailTemplate(
        user_id=current_user.id,
        name=body.name,
        subject=body.subject,
        body=body.body
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return {"id": tpl.id, "name": tpl.name, "subject": tpl.subject, "body": tpl.body}

@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    body: EmailTemplateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailTemplate
    tpl = db.query(EmailTemplate).filter(
        EmailTemplate.id == template_id,
        EmailTemplate.user_id == current_user.id
    ).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    tpl.name = body.name
    tpl.subject = body.subject
    tpl.body = body.body
    tpl.updated_at = datetime.utcnow()
    db.commit()
    return {"id": tpl.id, "name": tpl.name, "subject": tpl.subject, "body": tpl.body}

@router.delete("/templates/{template_id}")
def delete_template(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailTemplate
    tpl = db.query(EmailTemplate).filter(
        EmailTemplate.id == template_id,
        EmailTemplate.user_id == current_user.id
    ).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tpl)
    db.commit()
    return {"status": "success"}


# ========== EMAIL RULES ==========

class RuleCondition(BaseModel):
    field: str   # "from" | "subject" | "to" | "body"
    op: str      # "contains" | "equals" | "starts_with"
    value: str

class RuleAction(BaseModel):
    type: str    # "label" | "move" | "star" | "mark_read"
    value: Optional[str] = None  # label id or folder name

class EmailRuleRequest(BaseModel):
    name: str
    is_active: bool = True
    match_all: bool = True
    conditions: List[RuleCondition]
    actions: List[RuleAction]

@router.get("/rules")
def list_rules(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailRule
    rules = db.query(EmailRule).filter(EmailRule.user_id == current_user.id).all()
    return [{"id": r.id, "name": r.name, "is_active": r.is_active,
             "match_all": r.match_all, "conditions": r.conditions, "actions": r.actions}
            for r in rules]

@router.post("/rules")
def create_rule(
    body: EmailRuleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailRule
    rule = EmailRule(
        user_id=current_user.id,
        name=body.name,
        is_active=body.is_active,
        match_all=body.match_all,
        conditions=[c.dict() for c in body.conditions],
        actions=[a.dict() for a in body.actions]
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"id": rule.id, "name": rule.name, "is_active": rule.is_active,
            "match_all": rule.match_all, "conditions": rule.conditions, "actions": rule.actions}

@router.put("/rules/{rule_id}")
def update_rule(
    rule_id: int,
    body: EmailRuleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailRule
    rule = db.query(EmailRule).filter(
        EmailRule.id == rule_id, EmailRule.user_id == current_user.id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.name = body.name
    rule.is_active = body.is_active
    rule.match_all = body.match_all
    rule.conditions = [c.dict() for c in body.conditions]
    rule.actions = [a.dict() for a in body.actions]
    rule.updated_at = datetime.utcnow()
    db.commit()
    return {"id": rule.id, "name": rule.name, "is_active": rule.is_active,
            "match_all": rule.match_all, "conditions": rule.conditions, "actions": rule.actions}

@router.delete("/rules/{rule_id}")
def delete_rule(
    rule_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from app.models.email import EmailRule
    rule = db.query(EmailRule).filter(
        EmailRule.id == rule_id, EmailRule.user_id == current_user.id
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"status": "success"}


# ========== AUTO-REPLY ==========

class AutoReplyRequest(BaseModel):
    is_enabled: bool = False
    mode: str = "fixed"                 # "fixed" | "ai"
    subject_prefix: Optional[str] = "Re: "
    reply_body: Optional[str] = None    # used when mode == "fixed"
    ai_system_prompt: Optional[str] = None  # used when mode == "ai"
    skip_if_from: Optional[str] = None  # comma-separated emails/domains to skip


@router.get("/auto-reply")
def get_auto_reply(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's auto-reply configuration."""
    from app.models.email import EmailAutoReply
    config = db.query(EmailAutoReply).filter(
        EmailAutoReply.user_id == current_user.id
    ).first()
    if not config:
        # Return defaults (not yet configured)
        return {
            "is_enabled": False,
            "mode": "fixed",
            "subject_prefix": "Re: ",
            "reply_body": "",
            "ai_system_prompt": "",
            "skip_if_from": "",
        }
    return {
        "is_enabled": config.is_enabled,
        "mode": config.mode,
        "subject_prefix": config.subject_prefix or "Re: ",
        "reply_body": config.reply_body or "",
        "ai_system_prompt": config.ai_system_prompt or "",
        "skip_if_from": config.skip_if_from or "",
    }


@router.post("/auto-reply")
def save_auto_reply(
    body: AutoReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create or update the current user's auto-reply configuration."""
    from app.models.email import EmailAutoReply
    config = db.query(EmailAutoReply).filter(
        EmailAutoReply.user_id == current_user.id
    ).first()
    if config:
        config.is_enabled = body.is_enabled
        config.mode = body.mode
        config.subject_prefix = body.subject_prefix or "Re: "
        config.reply_body = body.reply_body
        config.ai_system_prompt = body.ai_system_prompt
        config.skip_if_from = body.skip_if_from
        config.updated_at = datetime.utcnow()
    else:
        config = EmailAutoReply(
            user_id=current_user.id,
            is_enabled=body.is_enabled,
            mode=body.mode,
            subject_prefix=body.subject_prefix or "Re: ",
            reply_body=body.reply_body,
            ai_system_prompt=body.ai_system_prompt,
            skip_if_from=body.skip_if_from,
            replied_message_ids=[],
        )
        db.add(config)
    db.commit()
    db.refresh(config)
    return {"status": "success", "is_enabled": config.is_enabled, "mode": config.mode}


@router.delete("/auto-reply")
def disable_auto_reply(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disable the auto-reply (set is_enabled=False without deleting config)."""
    from app.models.email import EmailAutoReply
    config = db.query(EmailAutoReply).filter(
        EmailAutoReply.user_id == current_user.id
    ).first()
    if config:
        config.is_enabled = False
        db.commit()
    return {"status": "success", "is_enabled": False}


@router.post("/auto-reply/test")
def test_auto_reply(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a test auto-reply to yourself to verify the configuration works."""
    from app.models.email import EmailAutoReply
    config = db.query(EmailAutoReply).filter(
        EmailAutoReply.user_id == current_user.id
    ).first()
    if not config or not config.is_enabled:
        raise HTTPException(status_code=400, detail="Auto-reply is not enabled")

    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured")

    subject = f"{config.subject_prefix or 'Re: '}Test Auto-Reply"

    if config.mode == "ai":
        body = (
            "<p>✅ <strong>AI Auto-Reply is active.</strong></p>"
            "<p>When a real email arrives, the AI will generate a context-aware reply "
            "using your configured system prompt.</p>"
            f"<p>System prompt: <em>{config.ai_system_prompt or '(none)'}</em></p>"
        )
    else:
        body = config.reply_body or "<p>Auto-reply body not configured.</p>"

    try:
        email_service.send_email_from_account(
            account,
            account.email_address,   # send to self
            subject,
            body,
        )
        return {"status": "success", "message": f"Test auto-reply sent to {account.email_address}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send test: {str(e)}")

