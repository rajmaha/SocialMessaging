"""
WebChat routes — real-time visitor chat widget powered by WebSockets.

Flow:
  1. Visitor calls POST /webchat/session  → gets back session_id + chat history
  2. Visitor opens WS  /webchat/ws/{session_id}
  3. Visitor sends {type:"message", text:"..."}  → saved to DB + broadcast to agents
  4. Agent replies via existing POST /messages/send  → pushed back to visitor WS
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

from app.database import get_db, SessionLocal
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.user import User
from app.models.branding import BrandingSettings
from app.services.webchat_service import webchat_service
from app.services.events_service import events_service, EventTypes
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webchat", tags=["webchat"])


# ─────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────

def _get_branding(db: Session) -> dict:
    b = db.query(BrandingSettings).first()
    return {
        "company_name": b.company_name if b else "Support Chat",
        "primary_color": b.primary_color if b else "#2563eb",
        "logo_url": b.logo_url if b else None,
        "welcome_message": "Hi! How can we help you today?",
    }

def _first_admin(db: Session) -> Optional[User]:
    return db.query(User).filter(User.role == "admin", User.is_active == True).first()

def _msg_dict(m: Message) -> dict:
    return {
        "id": m.id,
        "text": m.message_text,
        "sender": m.sender_name,
        "is_agent": bool(m.is_sent),
        "timestamp": m.timestamp.isoformat() if m.timestamp else None,
    }


# ─────────────────────────────────────────
# REST – session management
# ─────────────────────────────────────────

class SessionRequest(BaseModel):
    session_id: Optional[str] = None
    visitor_name: str
    visitor_email: Optional[str] = None


@router.post("/session")
def create_or_resume_session(req: SessionRequest, db: Session = Depends(get_db)):
    """Create a new chat session or resume an existing one."""

    session_id = req.session_id

    # Try to find an existing conversation for this session
    conv = None
    if session_id:
        conv = db.query(Conversation).filter(
            Conversation.conversation_id == session_id,
            Conversation.platform == "webchat"
        ).first()

    if conv is None:
        session_id = session_id or str(uuid.uuid4())
        admin = _first_admin(db)

        conv = Conversation(
            user_id=admin.id if admin else 1,
            platform_account_id=None,
            conversation_id=session_id,
            platform="webchat",
            contact_name=req.visitor_name,
            contact_id=session_id,
            contact_avatar=None,
            last_message=None,
            last_message_time=None,
            unread_count=0,
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)

    # Fetch message history
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.timestamp.asc())
        .limit(100)
        .all()
    )

    branding = _get_branding(db)

    return {
        "session_id": session_id,
        "conversation_id": conv.id,
        "visitor_name": conv.contact_name,
        "messages": [_msg_dict(m) for m in messages],
        "branding": branding,
        "agent_online": len(events_service.active_connections) > 0,
    }


@router.get("/branding")
def get_webchat_branding(db: Session = Depends(get_db)):
    """Return branding info so the widget launcher can style itself."""
    return _get_branding(db)


# ─────────────────────────────────────────
# WebSocket – visitor connection
# ─────────────────────────────────────────

@router.websocket("/ws/{session_id}")
async def visitor_websocket(session_id: str, websocket: WebSocket):
    """Persistent WebSocket for a visitor's chat session."""
    await websocket.accept()

    db = SessionLocal()
    try:
        conv = db.query(Conversation).filter(
            Conversation.conversation_id == session_id,
            Conversation.platform == "webchat"
        ).first()

        if not conv:
            await websocket.close(code=4004, reason="Session not found")
            return

        await webchat_service.connect(session_id, websocket)

        # Notify agents that visitor is online
        await events_service.broadcast_to_all({
            "type": "webchat_visitor_online",
            "data": {
                "session_id": session_id,
                "conversation_id": conv.id,
                "visitor_name": conv.contact_name,
            }
        })

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "message")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "typing":
                # Forward typing indicator to agents
                await events_service.broadcast_to_all({
                    "type": "webchat_typing",
                    "data": {
                        "session_id": session_id,
                        "conversation_id": conv.id,
                        "visitor_name": conv.contact_name,
                        "is_typing": data.get("is_typing", False),
                    }
                })
                continue

            if msg_type == "message":
                text = (data.get("text") or "").strip()
                if not text:
                    continue

                # Save to DB
                db_msg = Message(
                    conversation_id=conv.id,
                    platform_account_id=None,
                    sender_id=session_id,
                    sender_name=conv.contact_name,
                    receiver_id="agent",
                    receiver_name="Agent",
                    message_text=text,
                    message_type="text",
                    platform="webchat",
                    is_sent=0,       # 0 = received (from visitor)
                    read_status=0,
                )
                db.add(db_msg)

                conv.last_message = text
                conv.last_message_time = datetime.utcnow()
                conv.unread_count = (conv.unread_count or 0) + 1
                db.commit()
                db.refresh(db_msg)

                msg_payload = _msg_dict(db_msg)

                # Echo back to visitor
                await websocket.send_json({"type": "message", **msg_payload})

                # Push to all connected agents
                await events_service.broadcast_to_all({
                    "type": EventTypes.MESSAGE_RECEIVED,
                    "data": {
                        **msg_payload,
                        "platform": "webchat",
                        "conversation_id": conv.id,
                        "session_id": session_id,
                        "visitor_name": conv.contact_name,
                    }
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"[webchat ws] error for {session_id}: {e}")
    finally:
        webchat_service.disconnect(session_id)
        await events_service.broadcast_to_all({
            "type": "webchat_visitor_offline",
            "data": {"session_id": session_id, "conversation_id": conv.id if conv else None}
        })
        db.close()
