from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import os

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, UserEmailAccount, Email
from app.models.email import EmailSignature, Contact, EmailThread, EmailAttachment
from app.schemas.email import (
    EmailAccountResponse, SendEmailRequest, SendEmailReplyRequest,
    EmailResponse, EmailListResponse, SyncEmailsResponse,
    EmailSignatureCreate, EmailSignatureUpdate, EmailSignatureResponse,
    ContactCreate, ContactUpdate, ContactResponse, ContactListResponse
)
from app.services.email_service import email_service
from pydantic import BaseModel

router = APIRouter(prefix="/email", tags=["email"])


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
    # Check they don't already have an account
    existing = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id,
        UserEmailAccount.is_active == True
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="You already have an email account configured.")

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

@router.get("/account", response_model=EmailAccountResponse)
def get_email_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's email account (admin must configure)"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id,
        UserEmailAccount.is_active == True
    ).first()
    
    if not account:
        raise HTTPException(
            status_code=404, 
            detail="No email account configured for this user. Contact your administrator."
        )
    
    return account


@router.post("/account/sync", response_model=SyncEmailsResponse)
async def sync_emails(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Sync emails from IMAP account"""
    try:
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.user_id == current_user.id
        ).first()
        
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
    skip: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get emails from current user's inbox (only received emails, not sent by us)"""
    # Get user's email account
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(
            status_code=404, 
            detail="No email account configured for this user"
        )
    
    # Get RECEIVED emails (from_address != user's email) - exclude sent/drafts/trash
    received = db.query(Email).filter(
        Email.account_id == account.id,
        Email.from_address != account.email_address,
        Email.is_archived == False,
        Email.is_spam == False,
        Email.is_draft == False
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

    total = db.query(Email).filter(
        Email.account_id == account.id,
        Email.from_address != account.email_address,
        Email.is_archived == False,
        Email.is_spam == False,
        Email.is_draft == False
    ).count()

    return {
        "total": total,
        "emails": all_emails
    }


@router.get("/sent", response_model=EmailListResponse)
def get_sent(
    skip: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get sent emails from current user"""
    # Get user's email account
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(
            status_code=404, 
            detail="No email account configured for this user"
        )
    
    # Get sent emails
    emails = db.query(Email).filter(
        Email.account_id == account.id,
        Email.is_sent == True
    ).order_by(Email.received_at.desc()).offset(skip).limit(limit).all()
    
    total = db.query(Email).filter(
        Email.account_id == account.id,
        Email.is_sent == True
    ).count()
    
    return {
        "total": total,
        "emails": emails
    }


@router.get("/trash", response_model=EmailListResponse)
def get_trash(
    skip: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get trashed emails from current user"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured for this user")
    
    emails = db.query(Email).filter(
        Email.account_id == account.id,
        Email.is_archived == True
    ).order_by(Email.received_at.desc()).offset(skip).limit(limit).all()
    
    total = db.query(Email).filter(
        Email.account_id == account.id,
        Email.is_archived == True
    ).count()
    
    return {"total": total, "emails": emails}


@router.get("/drafts", response_model=EmailListResponse)
def get_drafts(
    skip: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get draft emails composed by current user"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured for this user")
    
    # Get OUTGOING drafts (from_address == user's email)
    emails = db.query(Email).filter(
        Email.account_id == account.id,
        Email.from_address == account.email_address,  # Only drafts composed by user
        Email.is_draft == True
    ).order_by(Email.received_at.desc()).offset(skip).limit(limit).all()
    
    total = db.query(Email).filter(
        Email.account_id == account.id,
        Email.from_address == account.email_address,
        Email.is_draft == True
    ).count()
    
    return {"total": total, "emails": emails}


@router.get("/outbox", response_model=EmailListResponse)
def get_outbox(
    skip: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get unsent outgoing emails from outbox (emails sent by us that failed to send)"""
    account = db.query(UserEmailAccount).filter(
        UserEmailAccount.user_id == current_user.id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="No email account configured for this user")
    
    # Get OUTGOING emails (from_address == user's email) that are unsent and not drafts
    emails = db.query(Email).filter(
        Email.account_id == account.id,
        Email.from_address == account.email_address,  # Only outgoing emails
        Email.is_sent == False,  # Not yet sent
        Email.is_draft == False,  # Not a draft (ready to send)
        Email.is_archived == False
    ).order_by(Email.received_at.desc()).offset(skip).limit(limit).all()
    
    total = db.query(Email).filter(
        Email.account_id == account.id,
        Email.from_address == account.email_address,
        Email.is_sent == False,
        Email.is_draft == False,
        Email.is_archived == False
    ).count()
    
    return {"total": total, "emails": emails}



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
    request_data: SendEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send email from user's account"""
    try:
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.user_id == current_user.id
        ).first()
        
        if not account:
            raise HTTPException(
                status_code=404, 
                detail="No email account configured for this user"
            )
        
        # Send email
        email_service.send_email_from_account(
            account,
            request_data.to_address,
            request_data.subject,
            request_data.body,
            request_data.cc,
            request_data.bcc
        )
        
        # Save to sent folder
        from app.models.email import Email as EmailModel
        sent_email = EmailModel(
            account_id=account.id,
            message_id=f"sent_{datetime.utcnow().timestamp()}",
            subject=request_data.subject,
            from_address=account.email_address,
            to_address=request_data.to_address,
            cc=request_data.cc,
            bcc=request_data.bcc,
            body_html=request_data.body,
            received_at=datetime.utcnow(),
            is_sent=True,
            is_read=True
        )
        db.add(sent_email)
        db.commit()
        
        return {
            "status": "success",
            "message": f"Email sent successfully to {request_data.to_address}"
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to send email: {str(e)}")


@router.post("/emails/{email_id}/reply")
def reply_to_email(
    email_id: int,
    request_data: SendEmailReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reply to an email"""
    try:
        # Get the original email
        original_email = db.query(Email).filter(Email.id == email_id).first()
        
        if not original_email:
            raise HTTPException(status_code=404, detail="Email not found")
        
        # Verify user owns this email
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.id == original_email.account_id,
            UserEmailAccount.user_id == current_user.id
        ).first()
        
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
            request_data.body,
            request_data.cc,
            request_data.bcc,
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
        reply_email = Email(
            account_id=account.id,
            thread_id=thread.id,
            message_id=f"sent_{datetime.utcnow().timestamp()}_{current_user.id}",
            subject=reply_subject,
            from_address=account.email_address,
            to_address=original_email.from_address,
            cc=request_data.cc,
            bcc=request_data.bcc,
            body_html=request_data.body,
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
    db.commit()
    
    return {"status": "success", "message": "Email restored"}


@router.post("/emails/{email_id}/forward")
def forward_email(
    email_id: int,
    to_address: str,
    cc: str = None,
    bcc: str = None,
    reply_text: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Forward email to another recipient"""
    try:
        # Get the original email
        original_email = db.query(Email).filter(Email.id == email_id).first()
        
        if not original_email:
            raise HTTPException(status_code=404, detail="Email not found")
        
        # Verify user owns this email
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.id == original_email.account_id,
            UserEmailAccount.user_id == current_user.id
        ).first()
        
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
        forwarded_email = Email(
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

