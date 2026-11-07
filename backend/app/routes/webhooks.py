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
import mimetypes
import os
import re
import uuid
from datetime import datetime

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.platform_account import PlatformAccount
from app.models.platform_settings import PlatformSettings
from app.services.bot_service import handle_incoming
from app.services.events_service import EventTypes, events_service
from app.services.platform_service import FacebookService, ViberService, WhatsAppService

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


# ── Inbound media ─────────────────────────────────────────────────────────────

# Same folder and URL shape that /messages/upload-attachment writes, so the
# chat window renders a webhook image exactly like an agent-uploaded one.
_MEDIA_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "attachment_storage", "messages"
)
_MAX_MEDIA_BYTES = 25 * 1024 * 1024

# ChatWindow only knows how to render 'image' and 'file'; everything else
# (video, audio, document, sticker) is offered as a download.
_IMAGE_TYPES = {"image", "picture", "photo", "sticker"}


def _media_kind(raw_type: str) -> str:
    return "image" if (raw_type or "").lower() in _IMAGE_TYPES else "file"


def _store_media(content: bytes, mime_type: str = "", filename: str = "") -> str | None:
    """Write inbound bytes to message storage and return their served URL."""
    if not content or len(content) > _MAX_MEDIA_BYTES:
        return None
    try:
        name = filename or ""
        if not os.path.splitext(name)[1]:
            # No usable extension on the wire; derive one so the browser and
            # the media library can both tell what this is.
            ext = mimetypes.guess_extension(mime_type.split(";")[0].strip()) if mime_type else None
            name = (name or "attachment") + (ext or "")
        # Stricter than /messages/upload-attachment, which keeps spaces: this
        # name goes straight into an <img src>, and an unencoded space there
        # is a needless thing to rely on the browser to fix.
        safe_name = re.sub(r"[^\w\-.]", "_", name)
        unique_name = f"{uuid.uuid4().hex}_{safe_name}"

        os.makedirs(_MEDIA_DIR, exist_ok=True)
        with open(os.path.join(_MEDIA_DIR, unique_name), "wb") as f_out:
            f_out.write(content)
        return f"/attachments/messages/{unique_name}"
    except Exception as e:
        logger.warning("Storing inbound media failed: %s", e)
        return None


async def _fetch_public_media(url: str) -> tuple[bytes, str] | None:
    """Download a directly-addressable media URL (Facebook, Viber)."""
    if not url:
        return None
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            res = await client.get(url)
            res.raise_for_status()
            if len(res.content) > _MAX_MEDIA_BYTES:
                return None
            return res.content, res.headers.get("content-type", "")
    except Exception as e:
        logger.warning("Inbound media download failed for %s: %s", url, e)
        return None


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


def _find_account(db: Session, platform: str, account_identifier: str | None = None) -> PlatformAccount | None:
    """Find platform account by account_id (from webhook payload), or fall back to first active."""
    if account_identifier:
        acct = (
            db.query(PlatformAccount)
            .filter(
                PlatformAccount.platform == platform,
                PlatformAccount.account_id == account_identifier,
                PlatformAccount.is_active == 1,
            )
            .first()
        )
        if acct:
            return acct
    # Fallback: first active account for this platform
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
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    db: Session = Depends(get_db),
):
    """Meta webhook verification handshake."""
    # Read verify_token from DB (saved via admin settings UI)
    ps = db.query(PlatformSettings).filter(PlatformSettings.platform == "whatsapp").first()
    stored_token = (ps.verify_token if ps and ps.verify_token else None) or settings.WHATSAPP_VERIFY_TOKEN or ""
    if hub_mode == "subscribe" and hub_verify_token and hub_verify_token == stored_token:
        return Response(content=hub_challenge, media_type="text/plain")
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

                wa_phone_number_id = value.get("metadata", {}).get("phone_number_id")

                for msg in messages:
                    contact_id = msg.get("from", "")
                    contact_name = contacts.get(contact_id, contact_id)
                    msg_type = msg.get("type", "text")

                    saved_type, saved_media = "text", None

                    if msg_type == "text":
                        text = msg.get("text", {}).get("body", "")
                    elif msg_type in ("image", "video", "audio", "document"):
                        text = f"[{msg_type} attachment]"
                        # Pull the file down now: the Cloud API URL needs our
                        # token and expires, so it is useless to the browser.
                        part = msg.get(msg_type, {}) or {}
                        acct_for_media = _find_account(db, "whatsapp", wa_phone_number_id)
                        fetched = await WhatsAppService.download_media(
                            part.get("id", ""),
                            acct_for_media.access_token if acct_for_media else None,
                        )
                        if fetched:
                            content, mime = fetched
                            stored = _store_media(
                                content, mime, part.get("filename", "") or msg_type
                            )
                            if stored:
                                saved_type = _media_kind(msg_type)
                                saved_media = stored
                                text = part.get("caption") or part.get("filename") or text
                    elif msg_type == "button":
                        text = msg.get("button", {}).get("text", "")
                    else:
                        continue

                    acct = _find_account(db, "whatsapp", wa_phone_number_id)
                    conv = _get_or_create_conversation(
                        db, "whatsapp", contact_id, contact_name,
                        acct.id if acct else None,
                        acct.user_id if acct else None,
                    )
                    saved = _save_inbound_message(
                        db, conv, text, "whatsapp", contact_name, saved_type, saved_media
                    )
                    await _notify_agents(saved, conv)

                    reply_token = acct.access_token if acct else None
                    reply_phone_id = wa_phone_number_id

                    async def _send(reply: str, cid=contact_id, token=reply_token, pid=reply_phone_id):
                        try:
                            await WhatsAppService.send_message(cid, reply, access_token=token, phone_number_id=pid)
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
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    db: Session = Depends(get_db),
):
    """Meta webhook verification handshake."""
    # Read verify_token from DB (saved via admin settings UI)
    ps = db.query(PlatformSettings).filter(PlatformSettings.platform == "facebook").first()
    stored_token = (ps.verify_token if ps and ps.verify_token else None) or settings.FACEBOOK_VERIFY_TOKEN or ""
    if hub_mode == "subscribe" and hub_verify_token and hub_verify_token == stored_token:
        return Response(content=hub_challenge, media_type="text/plain")
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
            fb_page_id = str(entry.get("id", ""))

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
                saved_type, saved_media = "text", None
                if not text:
                    # Attachment-only message
                    attachments = msg.get("attachments", [])
                    if attachments:
                        att = attachments[0]
                        att_type = att.get("type", "attachment")
                        text = f"[{att_type} attachment]"
                        # Messenger's payload URL is directly fetchable, but it
                        # is signed and short-lived, so copy it locally.
                        fetched = await _fetch_public_media(
                            (att.get("payload") or {}).get("url", "")
                        )
                        if fetched:
                            content, mime = fetched
                            stored = _store_media(content, mime, att_type)
                            if stored:
                                saved_type = _media_kind(att_type)
                                saved_media = stored
                    else:
                        continue

                # Resolve contact name via Graph API
                contact_name = await _fb_get_name(sender_id)

                acct = _find_account(db, "facebook", fb_page_id)
                conv = _get_or_create_conversation(
                    db, "facebook", sender_id, contact_name,
                    acct.id if acct else None,
                    acct.user_id if acct else None,
                )
                saved = _save_inbound_message(
                    db, conv, text, "facebook", contact_name, saved_type, saved_media
                )
                await _notify_agents(saved, conv)

                reply_token = acct.access_token if acct else None

                async def _send(reply: str, sid=sender_id, token=reply_token):
                    try:
                        await FacebookService.send_message(sid, reply, access_token=token)
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

        saved_type, saved_media = "text", None

        if msg_type == "text":
            text = msg.get("text", "")
        elif msg_type in ("picture", "video", "file", "sticker"):
            text = f"[{msg_type} attachment]"
            # Viber hands over a plain media URL that expires, so copy it.
            fetched = await _fetch_public_media(msg.get("media", ""))
            if fetched:
                content, mime = fetched
                stored = _store_media(
                    content, mime, msg.get("file_name", "") or msg_type
                )
                if stored:
                    saved_type = _media_kind(msg_type)
                    saved_media = stored
                    text = msg.get("file_name") or text
        else:
            return

        if not text or not contact_id:
            return

        acct = _find_account(db, "viber")
        conv = _get_or_create_conversation(
            db, "viber", contact_id, contact_name,
            acct.id if acct else None,
            acct.user_id if acct else None,
        )
        saved = _save_inbound_message(
            db, conv, text, "viber", contact_name, saved_type, saved_media
        )
        await _notify_agents(saved, conv)

        reply_token = acct.access_token if acct else None

        async def _send(reply: str, cid=contact_id, token=reply_token):
            try:
                await ViberService.send_message(cid, reply, bot_token=token)
            except Exception as e:
                logger.warning("Viber send failed: %s", e)

        await handle_incoming(text, conv, "viber", db, _send)
    except Exception as e:
        logger.error("Viber webhook error: %s", e)
    finally:
        db.close()
