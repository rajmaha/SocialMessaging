"""
Shared bot reply engine used by both webchat WebSocket handler and platform webhooks.

Handles:
  - Keyword scoring (_bot_suggest) — same algorithm as webchat
  - AI provider fallback (Groq / Gemini / Ollama)
  - Unmatched counter + human-handoff threshold
  - Saving bot message to DB + broadcasting event to agents

In-memory unmatched counter is keyed by conversation.id (integer)
and resets on any successful reply.
"""

import re
import asyncio
import logging
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.bot import BotSettings, BotQA
from app.models.message import Message
from app.models.conversation import Conversation
from app.services.ai_service import ai_reply as _ai_reply
from app.services.events_service import events_service, EventTypes

logger = logging.getLogger(__name__)

# In-memory unmatched counters: {conversation_id: int}
_unmatched: dict[int, int] = {}


# ── Scoring ──────────────────────────────────────────────────────────────────

def bot_suggest(text: str, db: Session) -> list:
    """
    Score every enabled Q&A against visitor text and return ranked suggestions.

    Scoring per keyword:
      Exact phrase match → +3 × number of words in keyword
      Partial word overlap → +1 per matching word

    Returns top-5 matches (score > 0), sorted best-first.
    Each entry: {id, question, answer, score}
    """
    cfg = db.query(BotSettings).first()
    if not cfg or not cfg.enabled:
        return []

    lower = text.lower()
    words = set(re.findall(r'\w+', lower))
    qas = (
        db.query(BotQA)
        .filter(BotQA.enabled == True)
        .order_by(BotQA.order, BotQA.id)
        .all()
    )
    results = []
    for qa in qas:
        keywords = [k.strip().lower() for k in qa.keywords.split(',') if k.strip()]
        score = 0.0
        for kw in keywords:
            if kw in lower:
                score += 3 * len(kw.split())
            else:
                score += len(set(kw.split()) & words)
        if score > 0:
            label = (qa.question or "").strip() or (
                keywords[0].capitalize() + "?" if keywords else "…"
            )
            results.append({"id": qa.id, "question": label, "answer": qa.answer, "score": score})

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:5]


# ── DB save ───────────────────────────────────────────────────────────────────

def _save_bot_message(text: str, conv: Conversation, platform: str, db: Session) -> Message:
    """Persist a bot outbound message and update conversation metadata."""
    cfg = db.query(BotSettings).first()
    bot_name = cfg.bot_name if cfg else "Support Bot"

    msg = Message(
        conversation_id=conv.id,
        platform_account_id=conv.platform_account_id,
        sender_id="bot",
        sender_name=bot_name,
        receiver_id=conv.contact_id,
        receiver_name=conv.contact_name,
        message_text=text,
        message_type="text",
        platform=platform,
        is_sent=1,
        read_status=1,
        timestamp=datetime.utcnow(),
    )
    db.add(msg)
    conv.last_message = text
    conv.last_message_time = datetime.utcnow()
    db.commit()
    db.refresh(msg)
    return msg


async def _broadcast(msg: Message, conv: Conversation):
    """Notify connected agents via SSE events."""
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
        logger.warning("Bot broadcast failed: %s", e)


# ── Main entry point ──────────────────────────────────────────────────────────

async def handle_incoming(
    text: str,
    conv: Conversation,
    platform: str,
    db: Session,
    send_fn,        # async callable(text: str) — platform-specific send
    websocket=None, # optional: webchat WebSocket (for suggestion buttons)
) -> None:
    """
    Core bot logic called for every incoming visitor/customer message.

    1. Keyword scoring → if 1 match: auto-reply; if 2+: suggestions (webchat only)
    2. AI fallback → if no keyword match and AI enabled
    3. Handoff message → if AI also fails / disabled and threshold reached
    4. Saves bot reply to DB + broadcasts to agents
    5. Sends reply back to customer via send_fn (or WS for webchat)

    For non-webchat platforms (WhatsApp, Facebook, Viber), multiple keyword
    matches auto-send the best match (no interactive buttons available).
    """
    cfg = db.query(BotSettings).first()
    if not cfg or not cfg.enabled:
        return

    suggestions = bot_suggest(text, db)

    async def _reply(answer: str):
        """Save, send, and broadcast a bot answer."""
        _unmatched[conv.id] = 0
        await asyncio.sleep(0.6)
        msg = _save_bot_message(answer, conv, platform, db)
        await send_fn(answer)
        await _broadcast(msg, conv)

    if len(suggestions) == 1:
        await _reply(suggestions[0]["answer"])
        return

    if len(suggestions) > 1:
        if websocket is not None:
            # Webchat: send interactive suggestion buttons
            _unmatched[conv.id] = 0
            await asyncio.sleep(0.6)
            await websocket.send_json({
                "type": "bot_suggestions",
                "suggestions": [
                    {"id": s["id"], "question": s["question"]} for s in suggestions
                ],
            })
        else:
            # Other platforms: just reply with the top-scoring match
            await _reply(suggestions[0]["answer"])
        return

    # No keyword match — try AI
    ai_resp = await _ai_reply(text, db)
    if ai_resp:
        await _reply(ai_resp)
        return

    # AI also failed / disabled — handoff tracking
    if cfg.handoff_after and cfg.handoff_after > 0:
        count = _unmatched.get(conv.id, 0) + 1
        _unmatched[conv.id] = count
        if count >= cfg.handoff_after:
            _unmatched[conv.id] = 0
            await _reply(cfg.handoff_message or "Let me connect you with a human agent.")


async def handle_bot_selection(
    qa_id: int,
    conv: Conversation,
    platform: str,
    db: Session,
    send_fn,
    websocket=None,
) -> None:
    """Handle visitor selecting a suggestion button (webchat only in practice)."""
    qa = db.query(BotQA).filter(BotQA.id == qa_id, BotQA.enabled == True).first()
    if not qa:
        return
    _unmatched[conv.id] = 0
    await asyncio.sleep(0.4)
    msg = _save_bot_message(qa.answer, conv, platform, db)
    await send_fn(qa.answer)
    await _broadcast(msg, conv)
