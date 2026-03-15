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
import hmac
import hashlib
import base64
import json
import time

import httpx

from app.database import get_db, SessionLocal
from app.dependencies import get_current_user
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.user import User
from app.models.branding import BrandingSettings
from app.models.bot import BotSettings, BotQA
from app.models.webchat_otp import WebchatOtp
from app.services.bot_service import handle_incoming, handle_bot_selection, bot_suggest
from app.services.ai_service import ai_reply as _ai_reply
from app.services.webchat_service import webchat_service
from app.services.events_service import events_service, EventTypes
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webchat", tags=["webchat"])

# ─────────────────────────────────────────
# HMAC-signed OTP token helpers
# (stateless — works with any number of workers)
# ─────────────────────────────────────────

def _sign_otp_token(email: str, otp: str, name: str) -> str:
    """Return a tamper-proof token containing email + OTP + name + expiry (10 min)."""
    from app.config import settings
    payload = json.dumps({"e": email, "o": otp, "n": name, "x": time.time() + 600}, separators=(',', ':'))
    b64 = base64.urlsafe_b64encode(payload.encode()).decode()
    sig = hmac.new(settings.SECRET_KEY.encode(), b64.encode(), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"

def _decode_otp_token(token: str, email: str, otp: str):
    """Return payload dict if valid, else None."""
    from app.config import settings
    try:
        b64, sig = token.rsplit('.', 1)
        expected = hmac.new(settings.SECRET_KEY.encode(), b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(b64).decode())
        if payload.get('e') != email or payload.get('o') != otp or time.time() >= payload.get('x', 0):
            return None
        return payload
    except Exception:
        return None

# ─────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────

def _get_branding(db: Session, widget_key: str | None = None) -> dict:
    b = db.query(BrandingSettings).first()
    base = {
        "company_name": b.company_name if b else "Support Chat",
        "primary_color": b.primary_color if b else "#2563eb",
        "logo_url": b.logo_url if b else None,
        "welcome_message": "Hi! How can we help you today?",
        "timezone": b.timezone if b else "UTC",
        "key_valid": widget_key is None,  # no key = no validation needed
    }

    if widget_key:
        from app.models.widget_domain import WidgetDomain
        wd = db.query(WidgetDomain).filter(
            WidgetDomain.widget_key == widget_key,
            WidgetDomain.is_active == 1,
        ).first()
        if wd:
            base["key_valid"] = True
            if wd.branding_overrides:
                for k, v in wd.branding_overrides.items():
                    if v is not None and k in base:
                        base[k] = v
        else:
            base["key_valid"] = False
    return base

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
    token: Optional[str] = None


@router.post("/request-otp")
def request_otp(req: OtpRequest, db: Session = Depends(get_db)):
    """Send a 6-digit OTP to the visitor's email. Call this before /verify-otp."""
    from app.services.email_service import email_service

    email = req.email.strip().lower()
    if not re.match(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Invalid email address.")

    name = req.name.strip() or email.split("@")[0]
    otp = str(random.randint(100000, 999999))

    token = _sign_otp_token(email, otp, name)

    email_service.send_otp_email(
        to_email=email,
        full_name=name,
        otp_code=otp,
        context="webchat",
        db=db,
    )

    return {"status": "otp_sent", "message": "A 6-digit code has been sent to your email.", "token": token}


@router.post("/verify-otp")
def verify_otp(req: OtpVerify, db: Session = Depends(get_db)):
    """Verify OTP and return (or create) a permanent chat session for this email."""
    email = req.email.strip().lower()

    otp = req.otp.strip()
    visitor_name = email.split('@')[0]  # default fallback

    # Primary: verify via HMAC-signed token (stateless, works with multiple workers)
    token_payload = _decode_otp_token(req.token, email, otp) if req.token else None
    if token_payload:
        visitor_name = token_payload.get('n') or visitor_name
    else:
        # Fallback: DB lookup (covers clients without token)
        record = db.query(WebchatOtp).filter(WebchatOtp.email == email).order_by(WebchatOtp.id.desc()).first()
        if not record:
            raise HTTPException(
                status_code=400,
                detail="Verification code not found or expired. Please request a new code.",
            )
        if datetime.utcnow() > record.expires_at:
            db.delete(record)
            db.commit()
            raise HTTPException(status_code=400, detail="Code has expired. Please request a new one.")
        if record.otp != otp:
            raise HTTPException(status_code=400, detail="Incorrect code. Please try again.")
        visitor_name = record.name
        db.delete(record)
        db.commit()

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
def get_webchat_branding(key: str = Query(None), db: Session = Depends(get_db)):
    """Return branding info so the widget launcher can style itself.
    If ?key=<widget_key> is provided, apply per-domain branding overrides."""
    return _get_branding(db, widget_key=key)


def _account_to_channel(acct) -> dict | None:
    """Convert a PlatformAccount row into a channel link dict for the widget."""
    if acct.platform == "whatsapp" and acct.phone_number:
        phone = acct.phone_number.replace("+", "").replace(" ", "").replace("-", "")
        return {"platform": "whatsapp", "label": acct.account_name or "WhatsApp", "url": f"https://wa.me/{phone}"}
    elif acct.platform == "facebook" and acct.account_id:
        return {"platform": "facebook", "label": acct.account_name or "Messenger", "url": f"https://m.me/{acct.account_id}"}
    elif acct.platform == "viber":
        return {"platform": "viber", "label": acct.account_name or "Viber", "url": f"viber://pa?chatURI={acct.account_id}"}
    elif acct.platform == "linkedin" and acct.account_id:
        return {"platform": "linkedin", "label": acct.account_name or "LinkedIn", "url": f"https://www.linkedin.com/company/{acct.account_id}"}
    return None


@router.get("/channels")
def get_public_channels(key: str = Query(None), db: Session = Depends(get_db)):
    """Return configured social channel links for the widget channels tab.
    If ?key=<widget_key> is provided, return only accounts assigned to that domain."""
    from app.models.platform_settings import PlatformSettings
    from app.models.widget_domain import WidgetDomain
    from app.models.domain_account import DomainAccount
    from app.models.platform_account import PlatformAccount

    domain_account_ids = None
    if key:
        wd = db.query(WidgetDomain).filter(
            WidgetDomain.widget_key == key,
            WidgetDomain.is_active == 1,
        ).first()
        if wd:
            rows = db.query(DomainAccount.platform_account_id).filter(
                DomainAccount.widget_domain_id == wd.id
            ).all()
            if rows:
                domain_account_ids = [r[0] for r in rows]

    channels = []

    if domain_account_ids is not None:
        accounts = db.query(PlatformAccount).filter(
            PlatformAccount.id.in_(domain_account_ids),
            PlatformAccount.is_active == 1,
        ).all()
        for a in accounts:
            ch = _account_to_channel(a)
            if ch:
                channels.append(ch)
    else:
        # Fallback: global platform_settings (backward compatible)
        platforms = db.query(PlatformSettings).filter(PlatformSettings.is_configured >= 1).all()
        for p in platforms:
            if p.platform == "whatsapp" and p.phone_number:
                phone = p.phone_number.replace("+", "").replace(" ", "").replace("-", "")
                channels.append({"platform": "whatsapp", "label": "WhatsApp", "url": f"https://wa.me/{phone}"})
            elif p.platform == "facebook" and p.page_id:
                channels.append({"platform": "facebook", "label": "Messenger", "url": f"https://m.me/{p.page_id}"})
            elif p.platform == "viber" and p.phone_number:
                phone = p.phone_number.lstrip("+").replace(" ", "").replace("-", "")
                channels.append({"platform": "viber", "label": "Viber", "url": f"viber://chat?number=%2B{phone}"})
            elif p.platform == "linkedin" and p.organization_id:
                channels.append({"platform": "linkedin", "label": "LinkedIn", "url": f"https://www.linkedin.com/company/{p.organization_id}"})

    return channels


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

                # Tag conversation with widget domain on first message if widget_key provided
                widget_key = data.get("widget_key")
                if widget_key and not conv.widget_domain_id:
                    from app.models.widget_domain import WidgetDomain
                    wd = db.query(WidgetDomain).filter(
                        WidgetDomain.widget_key == widget_key,
                        WidgetDomain.is_active == 1,
                    ).first()
                    if wd:
                        conv.widget_domain_id = wd.id
                        db.commit()

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

                # Push to assigned agents only (or all agents if none assigned)
                event_payload = {
                    "type": EventTypes.MESSAGE_RECEIVED,
                    "data": {
                        **msg_payload,
                        "platform": "webchat",
                        "conversation_id": conv.id,
                        "session_id": session_id,
                        "visitor_name": conv.contact_name,
                    }
                }
                # Admins always receive all chats
                admin_ids = {
                    u.id for u in db.query(User).filter(
                        User.is_active == True, User.role == "admin"
                    ).all()
                }
                assigned_agent_ids = []
                if conv.widget_domain_id:
                    from app.models.domain_agent import DomainAgent
                    assigned_agent_ids = [
                        row.user_id for row in db.query(DomainAgent).filter(
                            DomainAgent.widget_domain_id == conv.widget_domain_id
                        ).all()
                    ]
                if assigned_agent_ids:
                    # Broadcast to assigned agents + all admins
                    recipient_ids = set(assigned_agent_ids) | admin_ids
                    for uid in recipient_ids:
                        await events_service.broadcast_to_user(uid, event_payload)
                else:
                    await events_service.broadcast_to_all(event_payload)

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
