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

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query, UploadFile, File
import os
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import uuid
import re
import random
import ipaddress
import socket

import httpx

from app.database import get_db, SessionLocal
from app.dependencies import get_current_user
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.user import User
from app.models.branding import BrandingSettings
from app.models.bot import BotSettings, BotQA
from app.services.bot_service import handle_incoming, handle_bot_selection, bot_suggest
from app.services.ai_service import ai_reply as _ai_reply
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
        "timezone": b.timezone if b else "UTC",
    }

def _first_admin(db: Session) -> Optional[User]:
    return db.query(User).filter(User.role == "admin", User.is_active == True).first()


async def _send_bot_message(text: str, conv, websocket, db: Session):
    """Save a bot reply to DB, echo to visitor, and notify agents."""
    cfg = db.query(BotSettings).first()
    bot_name = cfg.bot_name if cfg else "Support Bot"
    bot_msg = Message(
        conversation_id=conv.id,
        platform_account_id=None,
        sender_id="bot",
        sender_name=bot_name,
        receiver_id=conv.conversation_id,
        receiver_name=conv.contact_name,
        message_text=text,
        message_type="text",
        platform="webchat",
        is_sent=1,
        read_status=1,
    )
    db.add(bot_msg)
    conv.last_message = text
    conv.last_message_time = datetime.utcnow()
    db.commit()
    db.refresh(bot_msg)
    payload = _msg_dict(bot_msg)
    await websocket.send_json({"type": "message", **payload})
    await events_service.broadcast_to_all({
        "type": EventTypes.MESSAGE_RECEIVED,
        "data": {**payload, "platform": "webchat", "conversation_id": conv.id,
                 "session_id": conv.conversation_id, "visitor_name": conv.contact_name},
    })

def _msg_dict(m: Message) -> dict:
    return {
        "id": m.id,
        "text": m.message_text,
        "sender": m.sender_name,
        "is_agent": bool(m.is_sent),
        "timestamp": m.timestamp.isoformat() if m.timestamp else None,
        "media_url": m.media_url,
        "message_type": m.message_type or "text",
    }

def _session_response(conv: Conversation, db: Session) -> dict:
    """Build the standard session response: session_id + history + branding."""
    from app.models.user import User
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.timestamp.asc())
        .limit(100)
        .all()
    )
    assigned_agent_name = None
    if conv.assigned_to:
        agent = db.query(User).filter(User.id == conv.assigned_to).first()
        if agent:
            assigned_agent_name = agent.display_name or agent.full_name or agent.username
    return {
        "session_id": conv.conversation_id,
        "conversation_id": conv.id,
        "visitor_name": conv.contact_name,
        "visitor_email": conv.contact_id,   # email stored as permanent contact_id
        "messages": [_msg_dict(m) for m in messages],
        "branding": _get_branding(db),
        "agent_online": len(events_service.active_connections) > 0,
        "assigned_agent_name": assigned_agent_name,
        "rating": conv.rating,
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


class RateRequest(BaseModel):
    session_id: str
    rating: int          # 1–5
    comment: Optional[str] = None


@router.post("/rate")
def rate_conversation(req: RateRequest, db: Session = Depends(get_db)):
    """Visitor submits a 1-5 star rating for the conversation. Idempotent — can be updated."""
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5.")
    conv = db.query(Conversation).filter(
        Conversation.conversation_id == req.session_id,
        Conversation.platform == "webchat",
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Session not found.")
    conv.rating = req.rating
    conv.rating_comment = req.comment or None
    conv.rated_at = datetime.utcnow()
    db.commit()
    return {"success": True, "rating": conv.rating}


@router.get("/link-preview")
async def link_preview(url: str):
    """Fetch Open Graph / meta preview data for a URL (SSRF-safe)."""
    if not re.match(r'^https?://', url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only http/https URLs allowed")
    # SSRF protection — block private / loopback IPs
    try:
        from urllib.parse import urlparse as _up
        hostname = _up(url).hostname or ''
        for info in socket.getaddrinfo(hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise HTTPException(status_code=400, detail="URL not allowed")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not resolve URL")

    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)"})
            html = resp.text[:80000]

        def _og(prop):
            m = re.search(rf'<meta[^>]+property=["\']og:{prop}["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
            if not m:
                m = re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:{prop}["\']', html, re.IGNORECASE)
            return m.group(1).strip() if m else None

        def _meta(name):
            m = re.search(rf'<meta[^>]+name=["\'{name}["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
            if not m:
                m = re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\'{name}["\']', html, re.IGNORECASE)
            return m.group(1).strip() if m else None

        title = _og('title') or _meta('title')
        if not title:
            m = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
            title = m.group(1).strip() if m else None

        description = _og('description') or _meta('description')
        image = _og('image')

        from urllib.parse import urlparse as _up2, urljoin
        from html import unescape
        parsed = _up2(url)
        # Resolve relative image URLs to absolute
        if image and not image.startswith('http'):
            image = urljoin(f"{parsed.scheme}://{parsed.netloc}", image)
        return {
            "url": url,
            "title": unescape(title) if title else None,
            "description": unescape(description[:200]) if description else None,
            "image": image,
            "domain": parsed.netloc,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch preview")


@router.get("/online-conversation-ids")
def online_conversation_ids(db: Session = Depends(get_db)):
    """Return DB conversation IDs (integers) whose visitors have an open WebSocket."""
    session_ids = list(webchat_service.connections.keys())
    if not session_ids:
        return {"ids": []}
    convs = (
        db.query(Conversation.id)
        .filter(Conversation.conversation_id.in_(session_ids), Conversation.platform == "webchat")
        .all()
    )
    return {"ids": [c.id for c in convs]}


@router.get("/branding")
def get_webchat_branding(db: Session = Depends(get_db)):
    """Return branding info so the widget launcher can style itself."""
    return _get_branding(db)


@router.post("/typing/{conversation_id}")
async def agent_typing(
    conversation_id: int,
    is_typing: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Push an agent typing indicator to the visitor's WebSocket."""
    conv = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.platform == "webchat",
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await webchat_service.send_to_visitor(conv.conversation_id, {
        "type": "agent_typing",
        "is_typing": is_typing,
    })
    return {"ok": True}


@router.post("/upload-attachment")
async def webchat_upload_attachment(
    file: UploadFile = File(...),
    session_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Public attachment upload for webchat visitors (validated by session_id)."""
    conv = db.query(Conversation).filter(
        Conversation.conversation_id == session_id,
        Conversation.platform == "webchat",
    ).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Session not found")

    from app.services.branding_service import branding_service
    from app.routes.messages import DEFAULT_ALLOWED_TYPES
    branding = branding_service.get_branding(db)
    allowed_types: list = branding.allowed_file_types or DEFAULT_ALLOWED_TYPES
    max_size_bytes = (branding.max_file_size_mb or 10) * 1024 * 1024

    content = await file.read()
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"File type '{file.content_type}' is not allowed.")
    if len(content) > max_size_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds maximum size of {branding.max_file_size_mb or 10} MB.")

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

        # Send bot welcome message if no messages exist yet in this conversation
        bot_cfg = db.query(BotSettings).first()
        if bot_cfg and bot_cfg.enabled and bot_cfg.welcome_message:
            existing = db.query(Message).filter(Message.conversation_id == conv.id).count()
            if existing == 0:
                import asyncio
                await asyncio.sleep(0.5)
                await _send_bot_message(bot_cfg.welcome_message, conv, websocket, db)

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
                    is_sent=0,
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

                # Bot reply via shared bot_service (keyword → AI → handoff)
                async def _wc_send(reply: str, _ws=websocket):
                    await _send_bot_message(reply, conv, _ws, db)

                await handle_incoming(text, conv, "webchat", db, _wc_send, websocket=websocket)

            if msg_type == "bot_selection":
                qa_id = data.get("qa_id")
                if qa_id is not None:
                    async def _wc_send_sel(reply: str, _ws=websocket):
                        await _send_bot_message(reply, conv, _ws, db)
                    await handle_bot_selection(int(qa_id), conv, "webchat", db, _wc_send_sel, websocket=websocket)
                continue

            if msg_type == "file":
                media_url = data.get("media_url", "")
                attachment_name = data.get("attachment_name", "Attachment")
                file_msg_type = data.get("message_type", "file")  # 'image' or 'file'
                if not media_url:
                    continue

                db_msg = Message(
                    conversation_id=conv.id,
                    platform_account_id=None,
                    sender_id=session_id,
                    sender_name=conv.contact_name,
                    receiver_id="agent",
                    receiver_name="Agent",
                    message_text=attachment_name,
                    message_type=file_msg_type,
                    media_url=media_url,
                    platform="webchat",
                    is_sent=0,
                    read_status=0,
                )
                db.add(db_msg)

                conv.last_message = f"[{attachment_name}]"
                conv.last_message_time = datetime.utcnow()
                conv.unread_count = (conv.unread_count or 0) + 1
                db.commit()
                db.refresh(db_msg)

                msg_payload = _msg_dict(db_msg)

                await websocket.send_json({"type": "message", **msg_payload})

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
