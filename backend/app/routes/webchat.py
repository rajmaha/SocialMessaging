"""
WebChat routes — real-time visitor chat widget powered by WebSockets.

Flow:
  1. New visitor:
       POST /webchat/request-otp  {email, name}  → OTP sent to email
       POST /webchat/verify-otp   {email, otp}   → session_id + history
     Returning visitor (session_id in localStorage):
       POST /webchat/session      {session_id}   → session_id + history  (no OTP)
  2. Visitor opens WS  /webchat/ws/{session_id}
  3. Visitor sends {type:"message", text:"..."}  → saved to DB + broadcast to agents
  4. Agent replies via existing POST /messages/send  → pushed back to visitor WS

Visitors are identified permanently by their email address.
The same email always resumes the same conversation with full history.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import uuid
import re
import random

from app.database import get_db, SessionLocal
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.user import User
from app.models.branding import BrandingSettings
from app.services.webchat_service import webchat_service
from app.services.events_service import events_service, EventTypes
import logging

logger = logging.getLogger(__name__)

# In-memory OTP store: normalised_email → {otp, expires, name}
# (cleared automatically on verification or expiry)
_otp_store: dict = {}

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

def _session_response(conv: Conversation, db: Session) -> dict:
    """Build the standard session response: session_id + history + branding."""
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.timestamp.asc())
        .limit(100)
        .all()
    )
    return {
        "session_id": conv.conversation_id,
        "conversation_id": conv.id,
        "visitor_name": conv.contact_name,
        "visitor_email": conv.contact_id,   # email stored as permanent contact_id
        "messages": [_msg_dict(m) for m in messages],
        "branding": _get_branding(db),
        "agent_online": len(events_service.active_connections) > 0,
    }


# ─────────────────────────────────────────
# REST – OTP-based identity
# ─────────────────────────────────────────

class OtpRequest(BaseModel):
    email: str
    name: str

class OtpVerify(BaseModel):
    email: str
    otp: str


@router.post("/request-otp")
def request_otp(req: OtpRequest, db: Session = Depends(get_db)):
    """Send a 6-digit OTP to the visitor's email. Call this before /verify-otp."""
    from app.services.email_service import email_service

    email = req.email.strip().lower()
    if not re.match(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Invalid email address.")

    name = req.name.strip() or email.split("@")[0]
    otp = str(random.randint(100000, 999999))

    _otp_store[email] = {
        "otp": otp,
        "expires": datetime.utcnow() + timedelta(minutes=10),
        "name": name,
    }

    email_service.send_otp_email(
        to_email=email,
        full_name=name,
        otp_code=otp,
        context="webchat",
        db=db,
    )

    return {"status": "otp_sent", "message": "A 6-digit code has been sent to your email."}


@router.post("/verify-otp")
def verify_otp(req: OtpVerify, db: Session = Depends(get_db)):
    """Verify OTP and return (or create) a permanent chat session for this email."""
    email = req.email.strip().lower()

    record = _otp_store.get(email)
    if not record:
        raise HTTPException(
            status_code=400,
            detail="No verification code found for this email. Please request a new code.",
        )
    if datetime.utcnow() > record["expires"]:
        _otp_store.pop(email, None)
        raise HTTPException(status_code=400, detail="Code has expired. Please request a new one.")
    if record["otp"] != req.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect code. Please try again.")

    # OTP valid — remove it
    visitor_name = record["name"]
    _otp_store.pop(email, None)

    # Look up existing conversation by email (permanent contact_id)
    conv = db.query(Conversation).filter(
        Conversation.contact_id == email,
        Conversation.platform == "webchat",
    ).first()

    if conv is None:
        admin = _first_admin(db)
        session_id = str(uuid.uuid4())
        conv = Conversation(
            user_id=admin.id if admin else 1,
            platform_account_id=None,
            conversation_id=session_id,
            platform="webchat",
            contact_name=visitor_name,
            contact_id=email,          # email = permanent identity
            contact_avatar=None,
            last_message=None,
            last_message_time=None,
            unread_count=0,
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)

    return _session_response(conv, db)


# ─────────────────────────────────────────
# REST – session resume (localStorage token)
# ─────────────────────────────────────────

class SessionRequest(BaseModel):
    session_id: Optional[str] = None
    visitor_name: str = ""
    visitor_email: Optional[str] = None


@router.post("/session")
def create_or_resume_session(req: SessionRequest, db: Session = Depends(get_db)):
    """Resume an existing session by session_id (stored in visitor's localStorage).
    Legacy fallback — does NOT create new sessions; use /verify-otp for new visitors."""

    session_id = req.session_id

    conv = None
    if session_id:
        conv = db.query(Conversation).filter(
            Conversation.conversation_id == session_id,
            Conversation.platform == "webchat"
        ).first()

    if conv is None:
        raise HTTPException(status_code=404, detail="Session not found.")

    return _session_response(conv, db)


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
