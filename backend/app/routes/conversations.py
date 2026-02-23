from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.conversation import Conversation
from app.schemas.conversation import ConversationResponse

router = APIRouter(prefix="/conversations", tags=["conversations"])

@router.get("/", response_model=List[ConversationResponse])
def get_conversations(
    user_id: int,
    platform: str = None,
    db: Session = Depends(get_db)
):
    """Get all conversations for a user, optionally filtered by platform.
    Webchat conversations are shared across all users (no user_id filter)."""
    from sqlalchemy import or_

    query = db.query(Conversation).filter(
        or_(
            Conversation.user_id == user_id,
            Conversation.platform == "webchat",  # visible to every agent
        )
    )

    if platform:
        query = query.filter(Conversation.platform == platform.lower())

    conversations = query.order_by(Conversation.updated_at.desc()).all()
    return conversations

@router.get("/search", response_model=List[ConversationResponse])
def search_conversations(
    user_id: int,
    query: str,
    db: Session = Depends(get_db)
):
    """Search conversations by contact name"""
    conversations = db.query(Conversation).filter(
        Conversation.user_id == user_id,
        Conversation.contact_name.ilike(f"%{query}%")
    ).all()
    
    return conversations

@router.put("/{conversation_id}")
def mark_conversation_as_read(
    conversation_id: int,
    db: Session = Depends(get_db)
):
    """Mark all messages in a conversation as read"""
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    conversation.unread_count = 0
    db.commit()
    
    return {"success": True, "message": "Conversation marked as read"}

@router.delete("/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db)
):
    """Delete a conversation (archive it)"""
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id
    ).first()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    db.delete(conversation)
    db.commit()
    
    return {"success": True, "message": "Conversation archived"}
