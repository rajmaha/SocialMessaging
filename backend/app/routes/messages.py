from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
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

router = APIRouter(prefix="/messages", tags=["messages"])

@router.post("/send", response_model=dict)
async def send_message(
    conversation_id: int,
    message_text: str,
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
        
        # Save message to database
        db_message = Message(
            conversation_id=conversation_id,
            platform_account_id=conversation.platform_account_id,
            sender_id="self",
            sender_name="You",
            receiver_id=conversation.contact_id,
            receiver_name=conversation.contact_name,
            message_text=message_text,
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
                "text": message_text,
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
