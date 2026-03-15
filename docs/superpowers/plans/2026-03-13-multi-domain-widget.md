# Multi-Domain Widget Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable installing the chat widget on multiple domains, each with its own branding, platform account assignments, and agent assignments controlled by admin.

**Architecture:** Three new DB tables (`widget_domains`, `domain_accounts`, `domain_agents`) plus a `widget_domain_id` FK on `conversations`. The widget script reads a `data-key` attribute and passes it to branding/channels endpoints. Backend resolves the key to apply per-domain overrides and scoping. Admin manages domains via a new CRUD page.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL, Next.js 14 (TypeScript), TailwindCSS

**Spec:** `docs/superpowers/specs/2026-03-13-multi-domain-widget-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `backend/app/models/widget_domain.py` | `WidgetDomain` ORM model |
| `backend/app/models/domain_account.py` | `DomainAccount` junction ORM model |
| `backend/app/models/domain_agent.py` | `DomainAgent` junction ORM model |
| `backend/app/routes/widget_domains.py` | Admin CRUD + assignment endpoints |
| `frontend/app/admin/widget-domains/page.tsx` | Widget Domains admin page |

### Modified Files
| File | Changes |
|---|---|
| `backend/app/models/conversation.py` | Add `widget_domain_id` column |
| `backend/app/routes/webchat.py` | Update `/branding` and `/channels` to accept `?key=`, update WS to tag domain |
| `backend/app/routes/conversations.py` | Add domain-based agent scoping for webchat |
| `backend/main.py` | Import new models, register router, add inline migrations |
| `frontend/public/chat-widget.js` | Read `data-key`, pass to API calls and WS |
| `frontend/components/AdminNav.tsx` | Add "Widget Domains" nav link |
| `frontend/app/dashboard/page.tsx` | Add domain filter dropdown, domain badge |
| `frontend/components/ConversationList.tsx` | Show domain badge on webchat conversations |

---

## Chunk 1: Backend Models & Migrations

### Task 1: Create WidgetDomain Model

**Files:**
- Create: `backend/app/models/widget_domain.py`

- [ ] **Step 1: Create the WidgetDomain ORM model**

```python
# backend/app/models/widget_domain.py
from sqlalchemy import Column, Integer, String, DateTime, JSON
from datetime import datetime
from app.database import Base


class WidgetDomain(Base):
    __tablename__ = "widget_domains"

    id = Column(Integer, primary_key=True, index=True)
    domain = Column(String, unique=True, nullable=False, index=True)
    widget_key = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    is_active = Column(Integer, default=1)
    branding_overrides = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: Verify file is importable**

Run: `cd backend && python -c "from app.models.widget_domain import WidgetDomain; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/widget_domain.py
git commit -m "feat: add WidgetDomain model"
```

---

### Task 2: Create DomainAccount Junction Model

**Files:**
- Create: `backend/app/models/domain_account.py`

- [ ] **Step 1: Create the DomainAccount ORM model**

```python
# backend/app/models/domain_account.py
from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from datetime import datetime
from app.database import Base


class DomainAccount(Base):
    __tablename__ = "domain_accounts"
    __table_args__ = (
        UniqueConstraint("widget_domain_id", "platform_account_id", name="uq_domain_account"),
    )

    id = Column(Integer, primary_key=True, index=True)
    widget_domain_id = Column(
        Integer,
        ForeignKey("widget_domains.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    platform_account_id = Column(
        Integer,
        ForeignKey("platform_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 2: Verify file is importable**

Run: `cd backend && python -c "from app.models.domain_account import DomainAccount; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/domain_account.py
git commit -m "feat: add DomainAccount junction model"
```

---

### Task 3: Create DomainAgent Junction Model

**Files:**
- Create: `backend/app/models/domain_agent.py`

- [ ] **Step 1: Create the DomainAgent ORM model**

```python
# backend/app/models/domain_agent.py
from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from datetime import datetime
from app.database import Base


class DomainAgent(Base):
    __tablename__ = "domain_agents"
    __table_args__ = (
        UniqueConstraint("widget_domain_id", "user_id", name="uq_domain_agent"),
    )

    id = Column(Integer, primary_key=True, index=True)
    widget_domain_id = Column(
        Integer,
        ForeignKey("widget_domains.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 2: Verify file is importable**

Run: `cd backend && python -c "from app.models.domain_agent import DomainAgent; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/domain_agent.py
git commit -m "feat: add DomainAgent junction model"
```

---

### Task 4: Add widget_domain_id to Conversation Model

**Files:**
- Modify: `backend/app/models/conversation.py`

- [ ] **Step 1: Add widget_domain_id column**

Add after the existing `platform_account_id` line (line 10):

```python
widget_domain_id = Column(Integer, ForeignKey("widget_domains.id"), nullable=True)
```

The full import line also needs `ForeignKey` — it's already imported on line 1.

- [ ] **Step 2: Verify model loads**

Run: `cd backend && python -c "from app.models.conversation import Conversation; print(Conversation.__table__.columns.keys())"`
Expected: Output includes `widget_domain_id`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/conversation.py
git commit -m "feat: add widget_domain_id FK to Conversation model"
```

---

### Task 5: Register Models & Add Inline Migrations in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add model imports near the top of main.py**

Find the existing model imports section (near `from app.models.agent_account import AgentAccount`) and add:

```python
from app.models.widget_domain import WidgetDomain
from app.models.domain_account import DomainAccount
from app.models.domain_agent import DomainAgent
```

- [ ] **Step 2: Add inline SQL migrations**

Find the migration block in the startup lifespan (after existing `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` statements) and append:

```python
        # ── Multi-domain widget tables ──
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS widget_domains (
                id SERIAL PRIMARY KEY,
                domain VARCHAR UNIQUE NOT NULL,
                widget_key VARCHAR UNIQUE NOT NULL,
                display_name VARCHAR NOT NULL,
                is_active INTEGER DEFAULT 1,
                branding_overrides JSON,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS domain_accounts (
                id SERIAL PRIMARY KEY,
                widget_domain_id INTEGER NOT NULL REFERENCES widget_domains(id) ON DELETE CASCADE,
                platform_account_id INTEGER NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (widget_domain_id, platform_account_id)
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS domain_agents (
                id SERIAL PRIMARY KEY,
                widget_domain_id INTEGER NOT NULL REFERENCES widget_domains(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (widget_domain_id, user_id)
            )
        """))
        conn.execute(text("""
            ALTER TABLE conversations ADD COLUMN IF NOT EXISTS widget_domain_id INTEGER REFERENCES widget_domains(id)
        """))
```

- [ ] **Step 3: Verify server starts without errors**

Run: `cd backend && python -c "from main import app; print('App loaded OK')"`
Expected: `App loaded OK` (no import errors)

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: register widget domain models and add inline migrations"
```

---

## Chunk 2: Backend Admin API

### Task 6: Create Widget Domains CRUD Route

**Files:**
- Create: `backend/app/routes/widget_domains.py`

- [ ] **Step 1: Create the route file with schemas and CRUD endpoints**

```python
# backend/app/routes/widget_domains.py
"""
CRUD endpoints for managing widget domains (multi-domain widget support).
Each domain gets a unique widget_key used in the embed snippet.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import check_permission
from app.models.widget_domain import WidgetDomain
from app.models.domain_account import DomainAccount
from app.models.domain_agent import DomainAgent
from app.models.platform_account import PlatformAccount
from app.models.user import User

router = APIRouter(prefix="/admin/widget-domains", tags=["widget-domains"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class WidgetDomainCreate(BaseModel):
    domain: str
    display_name: str
    branding_overrides: Optional[dict] = None


class WidgetDomainUpdate(BaseModel):
    domain: Optional[str] = None
    display_name: Optional[str] = None
    branding_overrides: Optional[dict] = None


class DomainAccountsReplace(BaseModel):
    platform_account_ids: List[int]


class DomainAgentsReplace(BaseModel):
    user_ids: List[int]


# ── Domain CRUD ──────────────────────────────────────────────────────────────

@router.get("/")
def list_widget_domains(
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """List all widget domains."""
    domains = db.query(WidgetDomain).order_by(WidgetDomain.created_at.desc()).all()
    result = []
    for d in domains:
        acct_count = db.query(DomainAccount).filter(DomainAccount.widget_domain_id == d.id).count()
        agent_count = db.query(DomainAgent).filter(DomainAgent.widget_domain_id == d.id).count()
        result.append({
            "id": d.id,
            "domain": d.domain,
            "widget_key": d.widget_key,
            "display_name": d.display_name,
            "is_active": d.is_active,
            "branding_overrides": d.branding_overrides,
            "account_count": acct_count,
            "agent_count": agent_count,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        })
    return result


@router.post("/")
def create_widget_domain(
    body: WidgetDomainCreate,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Create a new widget domain with auto-generated widget_key."""
    existing = db.query(WidgetDomain).filter(WidgetDomain.domain == body.domain).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domain already exists")

    domain = WidgetDomain(
        domain=body.domain.strip().lower(),
        widget_key=str(uuid.uuid4()),
        display_name=body.display_name.strip(),
        is_active=1,
        branding_overrides=body.branding_overrides,
    )
    db.add(domain)
    db.commit()
    db.refresh(domain)
    return {
        "id": domain.id,
        "domain": domain.domain,
        "widget_key": domain.widget_key,
        "display_name": domain.display_name,
        "is_active": domain.is_active,
        "branding_overrides": domain.branding_overrides,
    }


@router.put("/{domain_id}")
def update_widget_domain(
    domain_id: int,
    body: WidgetDomainUpdate,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Update a widget domain's settings."""
    domain = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    update_data = body.dict(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            if key == "domain":
                value = value.strip().lower()
            elif key == "display_name":
                value = value.strip()
            setattr(domain, key, value)
    domain.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(domain)
    return {"status": "updated", "id": domain.id}


@router.delete("/{domain_id}")
def delete_widget_domain(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Delete a widget domain and its associations."""
    domain = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    db.query(DomainAccount).filter(DomainAccount.widget_domain_id == domain_id).delete()
    db.query(DomainAgent).filter(DomainAgent.widget_domain_id == domain_id).delete()
    db.delete(domain)
    db.commit()
    return {"status": "deleted"}


@router.patch("/{domain_id}/toggle")
def toggle_widget_domain(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Toggle a widget domain active/inactive."""
    domain = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    domain.is_active = 0 if domain.is_active == 1 else 1
    domain.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "toggled", "is_active": domain.is_active}


# ── Domain ↔ Account Assignment ─────────────────────────────────────────────

@router.get("/{domain_id}/accounts")
def get_domain_accounts(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Get platform accounts assigned to a domain."""
    rows = db.query(DomainAccount).filter(DomainAccount.widget_domain_id == domain_id).all()
    account_ids = [r.platform_account_id for r in rows]
    accounts = db.query(PlatformAccount).filter(PlatformAccount.id.in_(account_ids)).all() if account_ids else []
    return [
        {
            "id": a.id,
            "platform": a.platform,
            "account_name": a.account_name,
            "account_id": a.account_id,
        }
        for a in accounts
    ]


@router.put("/{domain_id}/accounts")
def replace_domain_accounts(
    domain_id: int,
    body: DomainAccountsReplace,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Replace all account assignments for a domain."""
    domain = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    db.query(DomainAccount).filter(DomainAccount.widget_domain_id == domain_id).delete()
    for aid in body.platform_account_ids:
        db.add(DomainAccount(widget_domain_id=domain_id, platform_account_id=aid))
    db.commit()
    return {"status": "updated", "count": len(body.platform_account_ids)}


# ── Domain ↔ Agent Assignment ───────────────────────────────────────────────

@router.get("/{domain_id}/agents")
def get_domain_agents(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Get agents assigned to a domain."""
    rows = db.query(DomainAgent).filter(DomainAgent.widget_domain_id == domain_id).all()
    user_ids = [r.user_id for r in rows]
    users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
    return [
        {"id": u.id, "username": u.username, "full_name": getattr(u, "full_name", u.username)}
        for u in users
    ]


@router.put("/{domain_id}/agents")
def replace_domain_agents(
    domain_id: int,
    body: DomainAgentsReplace,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Replace all agent assignments for a domain."""
    domain = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    db.query(DomainAgent).filter(DomainAgent.widget_domain_id == domain_id).delete()
    for uid in body.user_ids:
        db.add(DomainAgent(widget_domain_id=domain_id, user_id=uid))
    db.commit()
    return {"status": "updated", "count": len(body.user_ids)}
```

- [ ] **Step 2: Register router in main.py**

In `main.py`, find the existing router registrations (near `app.include_router(platform_accounts.router)`) and add:

```python
from app.routes import widget_domains
app.include_router(widget_domains.router)
```

- [ ] **Step 3: Verify endpoints are registered**

Run: `cd backend && python -c "from main import app; routes = [r.path for r in app.routes]; print([r for r in routes if 'widget-domain' in r])"`
Expected: List of `/admin/widget-domains/...` paths

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/widget_domains.py backend/main.py
git commit -m "feat: add widget domains admin CRUD and assignment endpoints"
```

---

## Chunk 3: Webchat Endpoint Updates

### Task 7: Update /webchat/branding to Accept Widget Key

**Files:**
- Modify: `backend/app/routes/webchat.py:87-95` (the `_get_branding` helper)
- Modify: `backend/app/routes/webchat.py:397-400` (the GET `/branding` endpoint)

- [ ] **Step 1: Update the `_get_branding` helper to accept an optional widget_key**

Replace the existing `_get_branding` function (lines 87-95) with:

```python
def _get_branding(db: Session, widget_key: str | None = None) -> dict:
    b = db.query(BrandingSettings).first()
    base = {
        "company_name": b.company_name if b else "Support Chat",
        "primary_color": b.primary_color if b else "#2563eb",
        "logo_url": b.logo_url if b else None,
        "welcome_message": "Hi! How can we help you today?",
        "timezone": b.timezone if b else "UTC",
    }

    if widget_key:
        from app.models.widget_domain import WidgetDomain
        wd = db.query(WidgetDomain).filter(
            WidgetDomain.widget_key == widget_key,
            WidgetDomain.is_active == 1,
        ).first()
        if wd and wd.branding_overrides:
            # Merge overrides — only non-None fields replace globals
            for k, v in wd.branding_overrides.items():
                if v is not None and k in base:
                    base[k] = v
    return base
```

- [ ] **Step 2: Update the GET /branding endpoint to accept ?key= parameter**

Replace the existing `get_webchat_branding` function (lines 397-400) with:

```python
@router.get("/branding")
def get_webchat_branding(key: str = Query(None), db: Session = Depends(get_db)):
    """Return branding info so the widget launcher can style itself.
    If ?key=<widget_key> is provided, apply per-domain branding overrides."""
    return _get_branding(db, widget_key=key)
```

- [ ] **Step 3: Verify endpoint accepts key parameter**

Run: `cd backend && python -c "from main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/webchat.py
git commit -m "feat: update /webchat/branding to support per-domain overrides via widget_key"
```

---

### Task 8: Update /webchat/channels to Accept Widget Key

**Files:**
- Modify: `backend/app/routes/webchat.py:403-420` (the GET `/channels` endpoint)

- [ ] **Step 1: Update get_public_channels to filter by domain's assigned accounts**

Replace the existing `get_public_channels` function (lines 403-420) with:

```python
@router.get("/channels")
def get_public_channels(key: str = Query(None), db: Session = Depends(get_db)):
    """Return configured social channel links for the widget channels tab.
    If ?key=<widget_key> is provided, return only accounts assigned to that domain."""
    from app.models.platform_settings import PlatformSettings
    from app.models.widget_domain import WidgetDomain
    from app.models.domain_account import DomainAccount
    from app.models.platform_account import PlatformAccount

    # If widget_key provided, try to scope to domain's assigned accounts
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
        # Return channels from specific platform_accounts assigned to this domain
        accounts = db.query(PlatformAccount).filter(
            PlatformAccount.id.in_(domain_account_ids),
            PlatformAccount.is_active == 1,
        ).all()
        for a in accounts:
            ch = _account_to_channel(a)
            if ch:
                channels.append(ch)
    else:
        # Fallback: return channels from global platform_settings (backward compatible)
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
```

- [ ] **Step 2: Add the `_account_to_channel` helper**

Add this helper just above the `get_public_channels` function:

```python
def _account_to_channel(acct: "PlatformAccount") -> dict | None:
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
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routes/webchat.py
git commit -m "feat: update /webchat/channels to scope by domain's assigned accounts"
```

---

### Task 9: Tag WebSocket Conversations with widget_domain_id

**Files:**
- Modify: `backend/app/routes/webchat.py:494-554` (the WebSocket handler)

- [ ] **Step 1: Update the WebSocket handler to read widget_key from initial message**

In the `visitor_websocket` function, after `conv` is fetched (around line 504) and before the `while True` loop (line 531), add logic to tag the conversation with `widget_domain_id` on the first message.

Find the `while True:` loop and the `if msg_type == "message":` block. Inside it, before saving the message, add widget_key handling:

```python
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
```

This inserts the domain tagging check right after extracting `text` and the existing `if not text:` guard. The `widget_key` is only read from message payloads (not the WS URL) — the widget script will include it in every message, and it's only applied once (when `widget_domain_id` is still None).

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/webchat.py
git commit -m "feat: tag webchat conversations with widget_domain_id from WebSocket"
```

---

## Chunk 4: Conversation Scoping

### Task 10: Add Domain-Based Agent Scoping to Conversations

**Files:**
- Modify: `backend/app/routes/conversations.py:53-108`
- Modify: `backend/app/schemas/conversation.py`

- [ ] **Step 1: Add widget_domain_id to ConversationResponse schema**

In `backend/app/schemas/conversation.py`, find the `ConversationResponse` class and add:

```python
widget_domain_id: Optional[int] = None
widget_domain_name: Optional[str] = None
```

- [ ] **Step 2: Update conversations query with domain agent scoping**

In `backend/app/routes/conversations.py`, add imports near the top:

```python
from app.models.domain_agent import DomainAgent
from app.models.widget_domain import WidgetDomain
```

Then, in the `get_conversations` function, add a `widget_domain_id` query parameter:

```python
widget_domain_id: Optional[int] = None,
```

After the existing `agent_account_rows` scoping block (around line 102), add domain agent scoping:

```python
    # Scope webchat conversations to agent's permitted domains
    domain_agent_rows = db.query(DomainAgent.widget_domain_id).filter(
        DomainAgent.user_id == user_id
    ).all()

    if domain_agent_rows:
        permitted_domain_ids = [r[0] for r in domain_agent_rows]
        query = query.filter(
            or_(
                Conversation.platform != "webchat",
                Conversation.widget_domain_id.in_(permitted_domain_ids),
                Conversation.widget_domain_id.is_(None),
            )
        )

    if widget_domain_id:
        query = query.filter(Conversation.widget_domain_id == widget_domain_id)
```

- [ ] **Step 3: Enrich response with domain name**

In the `_enrich` helper or after the query, build a domain name lookup. After `conversations = query.order_by(...)`:

```python
    # Build domain name lookup for webchat conversations
    domain_ids = {c.widget_domain_id for c in conversations if c.widget_domain_id}
    domain_map = {}
    if domain_ids:
        domains = db.query(WidgetDomain).filter(WidgetDomain.id.in_(domain_ids)).all()
        domain_map = {d.id: d.display_name for d in domains}
```

Then in the enrichment/serialization, include `widget_domain_name` from the map.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/conversations.py backend/app/schemas/conversation.py
git commit -m "feat: add domain-based agent scoping and widget_domain_id to conversations"
```

---

## Chunk 5: Chat Widget Script Updates

### Task 11: Update chat-widget.js to Pass Widget Key

**Files:**
- Modify: `frontend/public/chat-widget.js`

- [ ] **Step 1: Read data-key from script tag**

Near the top of the IIFE (around line 10, after `var SERVER = ...`), add:

```javascript
  // Read widget key from script tag's data-key attribute
  var scriptTag = document.currentScript || document.querySelector('script[data-key]')
  var WIDGET_KEY = scriptTag ? scriptTag.getAttribute('data-key') : null
```

- [ ] **Step 2: Append key parameter to branding fetch URL**

Find the branding fetch call (line 17):
```javascript
  fetch(SERVER.replace(':3000', ':8000') + '/webchat/branding')
```

Replace with:
```javascript
  var brandingUrl = SERVER.replace(':3000', ':8000') + '/webchat/branding'
  if (WIDGET_KEY) brandingUrl += '?key=' + encodeURIComponent(WIDGET_KEY)
  fetch(brandingUrl)
```

- [ ] **Step 3: Append key parameter to channels fetch URL**

Find the channels fetch call (line 376):
```javascript
  fetch(SERVER.replace(':3000', ':8000') + '/webchat/channels')
```

Replace with:
```javascript
  var channelsUrl = SERVER.replace(':3000', ':8000') + '/webchat/channels'
  if (WIDGET_KEY) channelsUrl += '?key=' + encodeURIComponent(WIDGET_KEY)
  fetch(channelsUrl)
```

- [ ] **Step 4: Include widget_key in WebSocket messages**

Find where the widget sends messages via WebSocket (look for `send_json` or `websocket.send` calls that include `type: "message"`). In the message payload, add:

```javascript
  widget_key: WIDGET_KEY
```

So a message send becomes something like:
```javascript
  ws.send(JSON.stringify({ type: 'message', text: text, widget_key: WIDGET_KEY }))
```

Note: The WebSocket connection is made from the iframe, not the widget script directly. Check if the iframe URL or the postMessage flow passes the key. If the iframe handles the WS, ensure the key is passed to it via URL parameter or postMessage config.

- [ ] **Step 5: Commit**

```bash
git add frontend/public/chat-widget.js
git commit -m "feat: update chat widget to pass widget_key to branding, channels, and WebSocket"
```

---

## Chunk 6: Frontend Admin UI

### Task 12: Add Widget Domains Admin Page

**Files:**
- Create: `frontend/app/admin/widget-domains/page.tsx`

- [ ] **Step 1: Create the Widget Domains admin page**

Follow the pattern from `frontend/app/admin/accounts/page.tsx`. The page should include:

1. **Domain list table** — Domain, Display Name, Widget Key, Status, Account Count, Agent Count, Actions (edit/delete/toggle)
2. **Add/Edit modal** — Fields: Domain, Display Name, Branding Overrides (Company Name, Logo URL, Primary Color, Welcome Message — all optional)
3. **Embed code snippet** — Per-domain copy-to-clipboard:
   ```html
   <script src="https://<BACKEND_URL>/chat-widget.js" data-key="<widget_key>"></script>
   ```
4. **Accounts tab** — Checkbox list of active platform accounts grouped by platform. Uses `PUT /admin/widget-domains/{id}/accounts`
5. **Agents tab** — Checkbox list of agents. Uses `PUT /admin/widget-domains/{id}/agents`

API calls:
- `GET /admin/widget-domains` — list
- `POST /admin/widget-domains` — create
- `PUT /admin/widget-domains/{id}` — update
- `DELETE /admin/widget-domains/{id}` — delete
- `PATCH /admin/widget-domains/{id}/toggle` — toggle
- `GET /admin/widget-domains/{id}/accounts` — get assigned accounts
- `PUT /admin/widget-domains/{id}/accounts` — replace accounts
- `GET /admin/widget-domains/{id}/agents` — get assigned agents
- `PUT /admin/widget-domains/{id}/agents` — replace agents

Use the same auth header pattern as the Connected Accounts page (`Authorization: Bearer ${token}` from localStorage).

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/widget-domains/page.tsx
git commit -m "feat: add Widget Domains admin page with CRUD, accounts, and agents tabs"
```

---

### Task 13: Add Widget Domains Link to Admin Nav

**Files:**
- Modify: `frontend/components/AdminNav.tsx:28-37`

- [ ] **Step 1: Add nav item in the Communication group**

In `AdminNav.tsx`, find the `Communication` group `items` array (around line 30) and add after the "Connected Accounts" entry:

```typescript
{ href: '/admin/widget-domains', label: 'Widget Domains', icon: '🌐', permission: () => hasAdminFeature('manage_messenger_config') },
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: add Widget Domains link to admin navigation"
```

---

### Task 14: Add Domain Filter and Badge to Conversation Inbox

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`
- Modify: `frontend/components/ConversationList.tsx`

- [ ] **Step 1: Fetch widget domains on dashboard load**

In `frontend/app/dashboard/page.tsx`, add a state for domains and fetch them on mount:

```typescript
const [widgetDomains, setWidgetDomains] = useState<any[]>([])

// In useEffect alongside existing platform accounts fetch:
api.get('/admin/widget-domains', { headers: { Authorization: `Bearer ${token}` } })
  .then(r => setWidgetDomains(r.data || []))
  .catch(() => {})
```

- [ ] **Step 2: Add domain filter dropdown**

Add a dropdown near the existing account filter. Filter options come from `widgetDomains`. When selected, pass `widget_domain_id` to the conversations API call.

```typescript
const [domainFilter, setDomainFilter] = useState<string>('')

// In filter area:
<select value={domainFilter} onChange={e => setDomainFilter(e.target.value)}>
  <option value="">All Domains</option>
  {widgetDomains.map(d => (
    <option key={d.id} value={d.id}>{d.display_name}</option>
  ))}
</select>
```

- [ ] **Step 3: Build domain name lookup and pass to ConversationList**

```typescript
const domainMap = Object.fromEntries(widgetDomains.map(d => [d.id, d.display_name]))
// Pass as prop: domainMap={domainMap}
```

- [ ] **Step 4: Show domain badge in ConversationList**

In `frontend/components/ConversationList.tsx`, if the conversation has `widget_domain_id` and a matching name in `domainMap`, show a small badge:

```tsx
{conv.widget_domain_id && domainMap?.[conv.widget_domain_id] && (
  <span className="ml-1 text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">
    {domainMap[conv.widget_domain_id]}
  </span>
)}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/page.tsx frontend/components/ConversationList.tsx
git commit -m "feat: add domain filter dropdown and domain badge to conversation inbox"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | WidgetDomain model | `backend/app/models/widget_domain.py` |
| 2 | DomainAccount model | `backend/app/models/domain_account.py` |
| 3 | DomainAgent model | `backend/app/models/domain_agent.py` |
| 4 | Conversation FK | `backend/app/models/conversation.py` |
| 5 | Migrations + registration | `backend/main.py` |
| 6 | Admin CRUD routes | `backend/app/routes/widget_domains.py`, `backend/main.py` |
| 7 | Branding endpoint | `backend/app/routes/webchat.py` |
| 8 | Channels endpoint | `backend/app/routes/webchat.py` |
| 9 | WebSocket tagging | `backend/app/routes/webchat.py` |
| 10 | Conversation scoping | `backend/app/routes/conversations.py`, `backend/app/schemas/conversation.py` |
| 11 | Widget script | `frontend/public/chat-widget.js` |
| 12 | Admin page | `frontend/app/admin/widget-domains/page.tsx` |
| 13 | Admin nav | `frontend/components/AdminNav.tsx` |
| 14 | Inbox filter + badge | `frontend/app/dashboard/page.tsx`, `frontend/components/ConversationList.tsx` |
