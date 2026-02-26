"""
AI provider abstraction layer.

Supported providers: groq | gemini | ollama
Falls back gracefully (returns None) on any error so the bot handoff logic
can take over.

The Q&A knowledge base is injected into every request as context so the AI
can understand paraphrased questions even if keyword scoring didn't match.
"""

import httpx
import logging
from sqlalchemy.orm import Session
from app.models.bot import AISettings, BotQA

logger = logging.getLogger(__name__)

_DEFAULT_SYSTEM = (
    "You are a helpful customer support assistant. "
    "Answer concisely and politely. "
    "If you genuinely don't know the answer, say so rather than guessing."
)


async def ai_reply(text: str, db: Session) -> str | None:
    """
    Send visitor message to the configured AI provider and return its reply.
    Returns None if AI is disabled, provider is 'none', or an error occurs.
    """
    cfg = db.query(AISettings).first()
    if not cfg or not cfg.enabled or not cfg.provider or cfg.provider == "none":
        return None

    system = _build_system_prompt(cfg, db)

    try:
        if cfg.provider == "groq":
            return await _groq(text, cfg, system)
        elif cfg.provider == "gemini":
            return await _gemini(text, cfg, system)
        elif cfg.provider == "ollama":
            return await _ollama(text, cfg, system)
    except httpx.HTTPStatusError as e:
        logger.warning("AI provider HTTP error (%s %s): %s", cfg.provider, e.response.status_code, e.response.text[:200])
    except Exception as e:
        logger.warning("AI provider error (%s): %s", cfg.provider, e)

    return None


def _build_system_prompt(cfg: AISettings, db: Session) -> str:
    """
    Combine the admin-configured system prompt with the Q&A knowledge base
    so the AI can answer paraphrased questions even without keyword matches.
    """
    base = (cfg.system_prompt or "").strip() or _DEFAULT_SYSTEM

    # Inject enabled Q&As as grounded knowledge
    qa_rows = db.query(BotQA).filter(BotQA.enabled == True).order_by(BotQA.order, BotQA.id).all()
    if not qa_rows:
        return base

    kb_lines = ["", "Knowledge base (prioritise these answers when relevant):"]
    for qa in qa_rows:
        q_label = (qa.question or "").strip() or qa.keywords
        kb_lines.append(f"Q: {q_label}\nA: {qa.answer}")
    return base + "\n".join(kb_lines)


# ── Provider implementations ─────────────────────────────────────────────────

async def _groq(text: str, cfg: AISettings, system: str) -> str:
    """Groq OpenAI-compatible API."""
    model = (cfg.model_name or "").strip() or "llama-3.1-8b-instant"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": text},
                ],
                "max_tokens": 500,
                "temperature": 0.7,
            },
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()


async def _gemini(text: str, cfg: AISettings, system: str) -> str:
    """Google Gemini generateContent API."""
    model = (cfg.model_name or "").strip() or "gemini-1.5-flash"
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={cfg.api_key}"
    )
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            url,
            json={
                "system_instruction": {"parts": [{"text": system}]},
                "contents": [{"parts": [{"text": text}]}],
                "generationConfig": {"maxOutputTokens": 500, "temperature": 0.7},
            },
        )
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()


async def _ollama(text: str, cfg: AISettings, system: str) -> str:
    """Ollama local server /api/chat endpoint."""
    base = (cfg.ollama_url or "http://localhost:11434").rstrip("/")
    model = (cfg.model_name or "").strip() or "mistral"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{base}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": text},
                ],
                "stream": False,
            },
        )
        r.raise_for_status()
        return r.json()["message"]["content"].strip()
