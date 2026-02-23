from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models.message import Message
from app.models.conversation import Conversation
from app.schemas.message import MessageCreate, MessageResponse
from app.services.platform_service import (
    WhatsAppService, FacebookService, ViberService, LinkedInService
)
from app.services.events_service import events_service, EventTypes
from app.dependencies import get_current_user
from app.models.user import User
import asyncio
import os
import re
import uuid

router = APIRouter(prefix="/messages", tags=["messages"])

# Defaults used when branding has no allowed_file_types configured
DEFAULT_ALLOWED_TYPES = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/pdf",
    "application/zip", "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]


@router.post("/upload-attachment")
async def upload_attachment(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a file attachment for use in a message."""
    from app.services.branding_service import branding_service
    branding = branding_service.get_branding(db)
    allowed_types: list = branding.allowed_file_types or DEFAULT_ALLOWED_TYPES
    max_size_bytes = (branding.max_file_size_mb or 10) * 1024 * 1024

    content = await file.read()

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{file.content_type}' is not allowed.",
        )
    if len(content) > max_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the maximum allowed size of {branding.max_file_size_mb or 10} MB.",
        )

    # Sanitise filename to prevent path traversal
    original_name = file.filename or "attachment"
    safe_name = re.sub(r"[^\w\-. ]", "_", original_name)
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"

    msg_attach_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "..", "attachment_storage", "messages",
    )
    os.makedirs(msg_attach_dir, exist_ok=True)

    with open(os.path.join(msg_attach_dir, unique_name), "wb") as f_out:
        f_out.write(content)

    return {
        "url": f"/attachments/messages/{unique_name}",
        "filename": original_name,
        "content_type": file.content_type,
        "size": len(content),
    }


@router.get("/allowed-file-types")
def get_allowed_file_types(db: Session = Depends(get_db)):
    """Return the allowed MIME types and max file size for the current branding config."""
    from app.services.branding_service import branding_service
    branding = branding_service.get_branding(db)
    return {
        "allowed_file_types": branding.allowed_file_types or DEFAULT_ALLOWED_TYPES,
        "max_file_size_mb": branding.max_file_size_mb or 10,
    }


@router.post("/send", response_model=dict)
async def send_message(
    conversation_id: int,
    message_text: str = "",
    media_url: Optional[str] = None,
    attachment_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Send a message to the selected platform"""
    
    # Get conversation details
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Send message based on platform
    platform = conversation.platform.lower()
    
    try:
        if platform == "whatsapp":
            result = await WhatsAppService.send_message(
                conversation.contact_id, message_text
            )
        elif platform == "facebook":
            result = await FacebookService.send_message(
                conversation.contact_id, message_text
            )
        elif platform == "viber":
            result = await ViberService.send_message(
                conversation.contact_id, message_text
            )
        elif platform == "linkedin":
            result = await LinkedInService.send_message(
                conversation.contact_id, message_text
            )
        elif platform == "webchat":
            result = {"success": True, "delivered": False}  # updated after DB commit
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")
        
        # Determine message type
        if media_url:
            if any(media_url.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp")):
                msg_type = "image"
            else:
                msg_type = "file"
        else:
            msg_type = "text"

        # Save message to database
        db_message = Message(
            conversation_id=conversation_id,
            platform_account_id=conversation.platform_account_id,
            sender_id="self",
            sender_name="You",
            receiver_id=conversation.contact_id,
            receiver_name=conversation.contact_name,
            message_text=message_text or (attachment_name or "Attachment"),
            message_type=msg_type,
            media_url=media_url,
            platform=platform,
            is_sent=1,
            read_status=1
        )
        db.add(db_message)
        db.commit()
        db.refresh(db_message)

        # For webchat: push agent reply to visitor WebSocket after DB commit (real id + timestamp)
        if platform == "webchat":
            from app.services.webchat_service import webchat_service
            delivered = await webchat_service.send_to_visitor(conversation.contact_id, {
                "type": "message",
                "id": db_message.id,
                "text": message_text or (attachment_name or "Attachment"),
                "media_url": media_url,
                "attachment_name": attachment_name,
                "message_type": msg_type,
                "sender": current_user.full_name or "Agent",
                "is_agent": True,
                "timestamp": db_message.timestamp.isoformat() if db_message.timestamp else None,
            })
            result["delivered"] = delivered
        timezone = events_service.get_timezone(db)
        event_data = {
            "message_id": db_message.id,
            "conversation_id": conversation_id,
            "sender_id": "self",
            "sender_name": "You",
            "receiver_id": conversation.contact_id,
            "receiver_name": conversation.contact_name,
            "message_text": message_text,
            "platform": platform,
            "timestamp": db_message.timestamp.isoformat() if db_message.timestamp else None
        }
        event = events_service.create_event(
            EventTypes.MESSAGE_SENT,
            event_data,
            db,
            timezone
        )
        
        # Broadcast to current user
        await events_service.broadcast_to_user(current_user.id, event)
        
        return {"success": True, "message": "Message sent successfully", "data": result}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversation/{conversation_id}", response_model=List[MessageResponse])
def get_conversation_messages(
    conversation_id: int,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Get messages from a specific conversation"""
    messages = db.query(Message).filter(
        Message.conversation_id == conversation_id
    ).order_by(Message.timestamp.desc()).limit(limit).all()
    
    return list(reversed(messages))

@router.put("/mark-as-read/{message_id}")
def mark_message_as_read(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark a message as read"""
    message = db.query(Message).filter(Message.id == message_id).first()
    
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    message.read_status = 1
    db.commit()
    
    # Emit message_updated event
    timezone = events_service.get_timezone(db)
    event_data = {
        "message_id": message.id,
        "conversation_id": message.conversation_id,
        "action": "marked_as_read",
        "read_status": message.read_status
    }
    event = events_service.create_event(
        EventTypes.MESSAGE_UPDATED,
        event_data,
        db,
        timezone
    )
    
    # Broadcast to current user (we use a non-async approach here)
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If loop is running, schedule as task
            asyncio.ensure_future(events_service.broadcast_to_user(current_user.id, event))
        else:
            # Otherwise run it directly
            loop.run_until_complete(events_service.broadcast_to_user(current_user.id, event))
    except RuntimeError:
        # Handle case where no event loop exists
        pass
    
    return {"success": True, "message": "Message marked as read"}
