"""
Inbound webhook receivers for WhatsApp, Facebook Messenger, and Viber.

Each platform requires:
  GET  /webhooks/{platform}  — verification challenge (one-time setup)
  POST /webhooks/{platform}  — receives incoming messages

The bot reply logic is shared with the webchat widget via app.services.bot_service.
"""

import hashlib
import hmac
import json
import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.platform_account import PlatformAccount
from app.services.bot_service import handle_incoming
from app.services.events_service import EventTypes, events_service
from app.services.platform_service import FacebookService, ViberService, WhatsAppService

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


# ── Shared helpers ────────────────────────────────────────────────────────────

def _get_or_create_conversation(
    db: Session,
    platform: str,
    contact_id: str,
    contact_name: str,
    platform_account_id: int | None,
    user_id: int | None,
) -> Conversation:
    """Find existing or create new conversation for this contact."""
    conv_uid = f"{platform}_{contact_id}"
    conv = db.query(Conversation).filter(Conversation.conversation_id == conv_uid).first()
    if not conv:
        conv = Conversation(
            user_id=user_id or 1,
            platform_account_id=platform_account_id,
            conversation_id=conv_uid,
            platform=platform,
            contact_name=contact_name,
            contact_id=contact_id,
            unread_count=0,
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)
    return conv


def _save_inbound_message(
    db: Session,
    conv: Conversation,
    text: str,
    platform: str,
    sender_name: str,
    msg_type: str = "text",
    media_url: str | None = None,
) -> Message:
    """Persist an inbound customer message and update conversation counters."""
    msg = Message(
        conversation_id=conv.id,
        platform_account_id=conv.platform_account_id,
        sender_id=conv.contact_id,
        sender_name=sender_name,
        receiver_id="agent",
        receiver_name="Agent",
        message_text=text,
        message_type=msg_type,
        media_url=media_url,
        platform=platform,
        is_sent=0,
        read_status=0,
        timestamp=datetime.utcnow(),
    )
    db.add(msg)
    conv.last_message = text
    conv.last_message_time = datetime.utcnow()
    conv.unread_count = (conv.unread_count or 0) + 1
    db.commit()
    db.refresh(msg)
    return msg


async def _notify_agents(msg: Message, conv: Conversation):
    try:
        await events_service.broadcast_to_all({
            "type": EventTypes.MESSAGE_RECEIVED,
            "data": {
                "message_id": msg.id,
                "conversation_id": conv.id,
                "sender_name": msg.sender_name,
                "message_text": msg.message_text,
                "platform": msg.platform,
                "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
            }
        })
    except Exception as e:
        logger.warning("Agent notification failed: %s", e)


def _first_account(db: Session, platform: str) -> PlatformAccount | None:
    return (
        db.query(PlatformAccount)
        .filter(PlatformAccount.platform == platform, PlatformAccount.is_active == 1)
        .first()
    )


# ── WhatsApp ──────────────────────────────────────────────────────────────────

@router.get("/whatsapp")
async def whatsapp_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify.token"),
):
    """Meta webhook verification handshake."""
    if hub_mode == "subscribe" and hub_verify_token == (settings.WHATSAPP_VERIFY_TOKEN or ""):
        return int(hub_challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/whatsapp")
async def whatsapp_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive inbound WhatsApp messages."""
    # Optional: verify X-Hub-Signature-256
    body = await request.body()
    sig = request.headers.get("X-Hub-Signature-256", "")
    if settings.FACEBOOK_APP_SECRET and sig:
        expected = "sha256=" + hmac.new(
            settings.FACEBOOK_APP_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=403, detail="Invalid signature")

    data = json.loads(body)
    background_tasks.add_task(_process_whatsapp, data)
    return {"status": "ok"}


async def _process_whatsapp(data: dict):
    db: Session = SessionLocal()
    try:
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})

                # ── Delivery / read receipts ──────────────────────────────
                for status_update in value.get("statuses", []):
                    wamid = status_update.get("id")
                    new_status = status_update.get("status")  # sent/delivered/read/failed
                    if wamid and new_status:
                        db.query(Message).filter(
                            Message.platform_message_id == wamid
                        ).update({"delivery_status": new_status})
                        db.commit()

                messages = value.get("messages", [])
                contacts = {c["wa_id"]: c.get("profile", {}).get("name", "Unknown")
                            for c in value.get("contacts", [])}

                for msg in messages:
                    contact_id = msg.get("from", "")
                    contact_name = contacts.get(contact_id, contact_id)
                    msg_type = msg.get("type", "text")

                    if msg_type == "text":
                        text = msg.get("text", {}).get("body", "")
                    elif msg_type in ("image", "video", "audio", "document"):
                        text = f"[{msg_type} attachment]"
                    elif msg_type == "button":
                        text = msg.get("button", {}).get("text", "")
                    else:
                        continue

                    acct = _first_account(db, "whatsapp")
                    conv = _get_or_create_conversation(
                        db, "whatsapp", contact_id, contact_name,
                        acct.id if acct else None,
                        acct.user_id if acct else None,
                    )
                    saved = _save_inbound_message(db, conv, text, "whatsapp", contact_name)
                    await _notify_agents(saved, conv)

                    async def _send(reply: str, cid=contact_id):
                        try:
                            await WhatsAppService.send_message(cid, reply)
                        except Exception as e:
                            logger.warning("WhatsApp send failed: %s", e)

                    await handle_incoming(text, conv, "whatsapp", db, _send)
    except Exception as e:
        logger.error("WhatsApp webhook error: %s", e)
    finally:
        db.close()


# ── Facebook Messenger ────────────────────────────────────────────────────────

@router.get("/facebook")
async def facebook_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify.token"),
):
    """Meta webhook verification handshake."""
    if hub_mode == "subscribe" and hub_verify_token == (settings.FACEBOOK_VERIFY_TOKEN or ""):
        return int(hub_challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/facebook")
async def facebook_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive inbound Facebook Messenger messages."""
    body = await request.body()
    sig = request.headers.get("X-Hub-Signature-256", "")
    if settings.FACEBOOK_APP_SECRET and sig:
        expected = "sha256=" + hmac.new(
            settings.FACEBOOK_APP_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=403, detail="Invalid signature")

    data = json.loads(body)
    if data.get("object") != "page":
        return {"status": "ignored"}

    background_tasks.add_task(_process_facebook, data)
    return {"status": "ok"}


async def _process_facebook(data: dict):
    db: Session = SessionLocal()
    try:
        for entry in data.get("entry", []):
            for messaging in entry.get("messaging", []):
                sender_id = messaging.get("sender", {}).get("id", "")

                # ── Delivery receipt ──────────────────────────────────────
                delivery = messaging.get("delivery")
                if delivery:
                    for mid in delivery.get("mids") or []:
                        db.query(Message).filter(
                            Message.platform_message_id == mid
                        ).update({"delivery_status": "delivered"})
                    db.commit()
                    continue

                # ── Read receipt ──────────────────────────────────────────
                read_ev = messaging.get("read")
                if read_ev:
                    # Facebook read receipts only carry a watermark (timestamp),
                    # so mark all sent messages for this sender as read.
                    conv_uid = f"facebook_{sender_id}"
                    conv = db.query(Conversation).filter(
                        Conversation.conversation_id == conv_uid
                    ).first()
                    if conv:
                        db.query(Message).filter(
                            Message.conversation_id == conv.id,
                            Message.is_sent == 1,
                        ).update({"delivery_status": "read"})
                        db.commit()
                    continue

                msg = messaging.get("message", {})
                if not sender_id or not msg or msg.get("is_echo"):
                    continue

                text = msg.get("text", "")
                if not text:
                    # Attachment-only message
                    attachments = msg.get("attachments", [])
                    if attachments:
                        text = f"[{attachments[0].get('type','attachment')} attachment]"
                    else:
                        continue

                # Resolve contact name via Graph API
                contact_name = await _fb_get_name(sender_id)

                acct = _first_account(db, "facebook")
                conv = _get_or_create_conversation(
                    db, "facebook", sender_id, contact_name,
                    acct.id if acct else None,
                    acct.user_id if acct else None,
                )
                saved = _save_inbound_message(db, conv, text, "facebook", contact_name)
                await _notify_agents(saved, conv)

                async def _send(reply: str, sid=sender_id):
                    try:
                        await FacebookService.send_message(sid, reply)
                    except Exception as e:
                        logger.warning("Facebook send failed: %s", e)

                await handle_incoming(text, conv, "facebook", db, _send)
    except Exception as e:
        logger.error("Facebook webhook error: %s", e)
    finally:
        db.close()


async def _fb_get_name(user_id: str) -> str:
    """Fetch Facebook user's name via Graph API. Returns user_id on failure."""
    token = settings.FACEBOOK_ACCESS_TOKEN
    if not token:
        return user_id
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"https://graph.facebook.com/{user_id}",
                params={"fields": "name", "access_token": token},
            )
            if r.status_code == 200:
                return r.json().get("name", user_id)
    except Exception:
        pass
    return user_id


# ── Viber ─────────────────────────────────────────────────────────────────────

@router.post("/viber")
async def viber_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receive Viber events.
    Viber uses a POST-only webhook (no GET verification challenge).
    Signature verification is via X-Viber-Content-Signature.
    """
    body = await request.body()
    sig = request.headers.get("X-Viber-Content-Signature", "")
    if settings.VIBER_BOT_TOKEN and sig:
        expected = hmac.new(
            settings.VIBER_BOT_TOKEN.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=403, detail="Invalid signature")

    data = json.loads(body)
    event_type = data.get("event")

    if event_type == "webhook":
        # Viber sends this when you register the webhook — just acknowledge
        return {"status": "ok"}

    if event_type == "message":
        background_tasks.add_task(_process_viber, data)

    return {"status": "ok"}


async def _process_viber(data: dict):
    db: Session = SessionLocal()
    try:
        sender = data.get("sender", {})
        contact_id = sender.get("id", "")
        contact_name = sender.get("name", contact_id)
        msg = data.get("message", {})
        msg_type = msg.get("type", "")

        if msg_type == "text":
            text = msg.get("text", "")
        elif msg_type in ("picture", "video", "file", "sticker"):
            text = f"[{msg_type} attachment]"
        else:
            return

        if not text or not contact_id:
            return

        acct = _first_account(db, "viber")
        conv = _get_or_create_conversation(
            db, "viber", contact_id, contact_name,
            acct.id if acct else None,
            acct.user_id if acct else None,
        )
        saved = _save_inbound_message(db, conv, text, "viber", contact_name)
        await _notify_agents(saved, conv)

        async def _send(reply: str, cid=contact_id):
            try:
                await ViberService.send_message(cid, reply)
            except Exception as e:
                logger.warning("Viber send failed: %s", e)

        await handle_incoming(text, conv, "viber", db, _send)
    except Exception as e:
        logger.error("Viber webhook error: %s", e)
    finally:
        db.close()
