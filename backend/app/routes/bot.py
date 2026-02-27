from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from app.database import get_db
from app.models.bot import BotSettings, BotQA, AISettings
from app.models import User
from app.dependencies import get_current_user, require_admin_feature

router = APIRouter(prefix="/bot", tags=["bot"])

require_bot = require_admin_feature("feature_manage_bot")

# ── Pydantic schemas ──────────────────────────────────────────────────────────
# ... (rest of schemas)
# I'll just replace the imports and the usages.
# Wait, let's just do a clean replace of the middle section.

class BotSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    bot_name: Optional[str] = None
    welcome_message: Optional[str] = None
    handoff_message: Optional[str] = None
    handoff_after: Optional[int] = None

class BotQACreate(BaseModel):
    question: Optional[str] = None
    keywords: str
    answer: str
    order: int = 0
    enabled: bool = True

class BotQAUpdate(BaseModel):
    question: Optional[str] = None
    keywords: Optional[str] = None
    answer: Optional[str] = None
    order: Optional[int] = None
    enabled: Optional[bool] = None


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/config")
def get_bot_config(db: Session = Depends(get_db), _: User = Depends(require_bot)):
    cfg = db.query(BotSettings).first()
    if not cfg:
        cfg = BotSettings()
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return {
        "id": cfg.id,
        "enabled": cfg.enabled,
        "bot_name": cfg.bot_name,
        "welcome_message": cfg.welcome_message,
        "handoff_message": cfg.handoff_message,
        "handoff_after": cfg.handoff_after,
    }

@router.put("/config")
def update_bot_config(
    payload: BotSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cfg = db.query(BotSettings).first()
    if not cfg:
        cfg = BotSettings()
        db.add(cfg)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    return {"ok": True, "enabled": cfg.enabled}


def _qa_dict(r):
    return {"id": r.id, "question": r.question or "", "keywords": r.keywords,
            "answer": r.answer, "order": r.order, "enabled": r.enabled}


@router.get("/qa")
def list_qa(db: Session = Depends(get_db), _: User = Depends(require_bot)):
    rows = db.query(BotQA).order_by(BotQA.order, BotQA.id).all()
    return [_qa_dict(r) for r in rows]

@router.post("/qa", status_code=201)
def create_qa(
    payload: BotQACreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    row = BotQA(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _qa_dict(row)

@router.put("/qa/{qa_id}")
def update_qa(
    qa_id: int,
    payload: BotQAUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    row = db.query(BotQA).filter(BotQA.id == qa_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Q&A not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    return {"ok": True}

@router.delete("/qa/{qa_id}")
def delete_qa(
    qa_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    row = db.query(BotQA).filter(BotQA.id == qa_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Q&A not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ── AI provider config ───────────────────────────────────────────────────────

class AISettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    provider: Optional[str] = None   # none | groq | gemini | ollama
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    ollama_url: Optional[str] = None
    system_prompt: Optional[str] = None


@router.get("/ai-config")
def get_ai_config(db: Session = Depends(get_db), _: User = Depends(require_bot)):
    cfg = db.query(AISettings).first()
    if not cfg:
        cfg = AISettings()
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return {
        "enabled": cfg.enabled,
        "provider": cfg.provider or "none",
        "api_key": cfg.api_key or "",
        "model_name": cfg.model_name or "",
        "ollama_url": cfg.ollama_url or "http://localhost:11434",
        "system_prompt": cfg.system_prompt or "",
    }


@router.put("/ai-config")
def update_ai_config(
    payload: AISettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    cfg = db.query(AISettings).first()
    if not cfg:
        cfg = AISettings()
        db.add(cfg)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(cfg, field, value)
    db.commit()
    return {"ok": True}


# ── Public endpoint (widget fetches this on load) ─────────────────────────────

@router.get("/public-config")
def get_public_bot_config(db: Session = Depends(get_db)):
    """Returns only what the widget needs — no auth required."""
    cfg = db.query(BotSettings).first()
    return {
        "enabled": cfg.enabled if cfg else False,
        "bot_name": cfg.bot_name if cfg else "Support Bot",
        "welcome_message": cfg.welcome_message if cfg else "",
        "handoff_message": cfg.handoff_message if cfg else "",
        "handoff_after": cfg.handoff_after if cfg else 3,
    }
