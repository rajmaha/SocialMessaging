# Multi-Account Platform Support — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable connecting multiple accounts per platform (Facebook pages, WhatsApp numbers, Viber bots, LinkedIn orgs) with per-agent access control and conversation filtering.

**Architecture:** Extend the existing `platform_accounts` table with 3 new columns. Add a new `agent_accounts` junction table for per-agent access control. Update webhook handlers to route inbound messages by account identifier from the payload (falling back to `platform_settings`). Add CRUD endpoints and frontend UI for managing accounts and agent assignments.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, Next.js 14 App Router, TailwindCSS, Axios

**Note:** This project has no test suite (no pytest/Jest). Each task uses Swagger UI at `/docs` for manual verification. Inline SQL migrations follow the project pattern in `main.py`.

---

## Chunk 1: Data Model & Backend API

### Task 1: Data Model — New columns and agent_accounts table

**Files:**
- Create: `backend/app/models/agent_account.py`
- Modify: `backend/app/models/platform_account.py` (add 3 columns)
- Modify: `backend/main.py` (add inline migrations)

- [ ] **Step 1: Create AgentAccount model**

Create `backend/app/models/agent_account.py`:

```python
from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from datetime import datetime
from app.database import Base

class AgentAccount(Base):
    __tablename__ = "agent_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "platform_account_id", name="uq_agent_account"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    platform_account_id = Column(Integer, ForeignKey("platform_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 2: Add new columns to PlatformAccount model**

In `backend/app/models/platform_account.py`, add after the `is_active` column:

```python
app_secret = Column(String, nullable=True)
verify_token = Column(String, nullable=True)
metadata = Column(JSON, nullable=True)  # flexible extras (business_account_id, org_id, etc.)
```

Add `JSON` to the import: `from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON`

- [ ] **Step 3: Add inline migrations in main.py**

In `backend/main.py`, inside `_run_inline_migrations()`, add:

```python
# Multi-account platform support
db.execute(text("CREATE TABLE IF NOT EXISTS agent_accounts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform_account_id INTEGER NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW())"))
db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_account ON agent_accounts(user_id, platform_account_id)"))
db.execute(text("ALTER TABLE platform_accounts ADD COLUMN IF NOT EXISTS app_secret VARCHAR"))
db.execute(text("ALTER TABLE platform_accounts ADD COLUMN IF NOT EXISTS verify_token VARCHAR"))
db.execute(text("ALTER TABLE platform_accounts ADD COLUMN IF NOT EXISTS metadata JSON"))
db.commit()
```

- [ ] **Step 4: Import AgentAccount in main.py**

Add `from app.models.agent_account import AgentAccount` near the other model imports in `main.py` so `Base.metadata.create_all()` picks it up.

- [ ] **Step 5: Verify by restarting backend**

Run: `cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000`

Check logs for migration success (no errors). Verify in Swagger at `/docs` that the app starts.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/agent_account.py backend/app/models/platform_account.py backend/main.py
git commit -m "feat: add agent_accounts table and extend platform_accounts model"
```

---

### Task 2: Backend CRUD — Platform Accounts endpoints

**Files:**
- Create: `backend/app/routes/platform_accounts.py`
- Modify: `backend/main.py` (register new router)

- [ ] **Step 1: Create platform_accounts route file**

Create `backend/app/routes/platform_accounts.py`:

```python
"""
CRUD endpoints for managing connected platform accounts (multi-account support).
Separate from platform_settings which stores global/fallback config per platform.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import check_permission
from app.models.platform_account import PlatformAccount

router = APIRouter(prefix="/admin/platform-accounts", tags=["platform-accounts"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class PlatformAccountCreate(BaseModel):
    platform: str  # facebook, whatsapp, viber, linkedin
    account_id: str  # page_id, phone_number_id, bot_id, org_id
    account_name: str
    access_token: str
    phone_number: Optional[str] = None
    app_secret: Optional[str] = None
    verify_token: Optional[str] = None
    metadata: Optional[dict] = None  # business_account_id, org_id, etc.


class PlatformAccountUpdate(BaseModel):
    account_name: Optional[str] = None
    access_token: Optional[str] = None
    phone_number: Optional[str] = None
    app_secret: Optional[str] = None
    verify_token: Optional[str] = None
    metadata: Optional[dict] = None


class PlatformAccountResponse(BaseModel):
    id: int
    platform: str
    account_id: str
    account_name: str
    access_token: str
    phone_number: Optional[str] = None
    app_secret: Optional[str] = None
    verify_token: Optional[str] = None
    metadata: Optional[dict] = None
    is_active: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_platform_accounts(
    platform: Optional[str] = None,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """List all connected accounts, optionally filtered by platform."""
    query = db.query(PlatformAccount)
    if platform:
        query = query.filter(PlatformAccount.platform == platform)
    accounts = query.order_by(PlatformAccount.platform, PlatformAccount.account_name).all()
    return [
        {
            "id": a.id,
            "platform": a.platform,
            "account_id": a.account_id,
            "account_name": a.account_name,
            "access_token": a.access_token,
            "phone_number": a.phone_number,
            "app_secret": a.app_secret,
            "verify_token": a.verify_token,
            "metadata": a.metadata,
            "is_active": a.is_active,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        }
        for a in accounts
    ]


@router.post("/")
async def create_platform_account(
    body: PlatformAccountCreate,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Add a new connected account."""
    if body.platform not in ("facebook", "whatsapp", "viber", "linkedin"):
        raise HTTPException(status_code=400, detail="Invalid platform")

    existing = db.query(PlatformAccount).filter(
        PlatformAccount.account_id == body.account_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Account with this ID already exists")

    account = PlatformAccount(
        user_id=current_user["id"],
        platform=body.platform,
        account_id=body.account_id,
        account_name=body.account_name,
        access_token=body.access_token,
        phone_number=body.phone_number,
        app_secret=body.app_secret,
        verify_token=body.verify_token,
        metadata=body.metadata,
        is_active=1,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return {"id": account.id, "message": "Account created"}


@router.put("/{account_id}")
async def update_platform_account(
    account_id: int,
    body: PlatformAccountUpdate,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Update an existing connected account."""
    account = db.query(PlatformAccount).filter(PlatformAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    update_data = body.dict(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None and value != "":
            setattr(account, key, value)

    account.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Account updated"}


@router.delete("/{account_id}")
async def delete_platform_account(
    account_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Remove a connected account."""
    account = db.query(PlatformAccount).filter(PlatformAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    db.delete(account)
    db.commit()
    return {"message": "Account deleted"}


@router.patch("/{account_id}/toggle")
async def toggle_platform_account(
    account_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Enable or disable a connected account."""
    account = db.query(PlatformAccount).filter(PlatformAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    account.is_active = 0 if account.is_active == 1 else 1
    account.updated_at = datetime.utcnow()
    db.commit()
    return {"is_active": account.is_active, "message": "Account toggled"}
```

- [ ] **Step 2: Register router in main.py**

In `backend/main.py`, add the import and `app.include_router()`:

```python
from app.routes import platform_accounts
# ...
app.include_router(platform_accounts.router)
```

- [ ] **Step 3: Verify CRUD endpoints in Swagger**

Restart backend. Open `/docs`. Test:
1. `POST /admin/platform-accounts` — create a Facebook account with page_id, access_token
2. `GET /admin/platform-accounts?platform=facebook` — see it listed
3. `PUT /admin/platform-accounts/{id}` — update account_name
4. `PATCH /admin/platform-accounts/{id}/toggle` — disable then re-enable
5. `DELETE /admin/platform-accounts/{id}` — remove it

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/platform_accounts.py backend/main.py
git commit -m "feat: add platform accounts CRUD endpoints"
```

---

### Task 3: Backend — Agent Access Control endpoints

**Files:**
- Modify: `backend/app/routes/platform_accounts.py` (add agent assignment endpoints)

- [ ] **Step 1: Add agent assignment schemas and endpoints**

Append to `backend/app/routes/platform_accounts.py`:

```python
from app.models.agent_account import AgentAccount
from app.models.user import User


class AgentAssignRequest(BaseModel):
    user_id: int


class AgentAccountsReplaceRequest(BaseModel):
    platform_account_ids: List[int]


# ── Agent ↔ Account assignment ───────────────────────────────────────────────

@router.get("/{account_id}/agents")
async def list_account_agents(
    account_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """List agents assigned to a specific account."""
    account = db.query(PlatformAccount).filter(PlatformAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    rows = (
        db.query(AgentAccount, User)
        .join(User, AgentAccount.user_id == User.id)
        .filter(AgentAccount.platform_account_id == account_id)
        .all()
    )
    return [
        {
            "user_id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "display_name": user.display_name,
        }
        for _, user in rows
    ]


@router.post("/{account_id}/agents")
async def assign_agent_to_account(
    account_id: int,
    body: AgentAssignRequest,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Assign an agent to a connected account."""
    account = db.query(PlatformAccount).filter(PlatformAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    user = db.query(User).filter(User.id == body.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.query(AgentAccount).filter(
        AgentAccount.user_id == body.user_id,
        AgentAccount.platform_account_id == account_id,
    ).first()
    if existing:
        return {"message": "Agent already assigned"}

    aa = AgentAccount(user_id=body.user_id, platform_account_id=account_id)
    db.add(aa)
    db.commit()
    return {"message": "Agent assigned"}


@router.delete("/{account_id}/agents/{user_id}")
async def remove_agent_from_account(
    account_id: int,
    user_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Remove an agent from a connected account."""
    row = db.query(AgentAccount).filter(
        AgentAccount.user_id == user_id,
        AgentAccount.platform_account_id == account_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Assignment not found")

    db.delete(row)
    db.commit()
    return {"message": "Agent removed"}
```

- [ ] **Step 2: Add user-side endpoints for bidirectional view**

Append to `backend/app/routes/platform_accounts.py` (under a separate prefix via the admin router, or same file):

```python
# ── User-side account access (for admin user-edit page) ─────────────────────

@router.get("/user/{user_id}/accounts")
async def list_user_accounts(
    user_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """List connected accounts assigned to a specific agent."""
    rows = (
        db.query(AgentAccount, PlatformAccount)
        .join(PlatformAccount, AgentAccount.platform_account_id == PlatformAccount.id)
        .filter(AgentAccount.user_id == user_id)
        .all()
    )
    return [
        {
            "platform_account_id": acct.id,
            "platform": acct.platform,
            "account_id": acct.account_id,
            "account_name": acct.account_name,
        }
        for _, acct in rows
    ]


@router.put("/user/{user_id}/accounts")
async def replace_user_accounts(
    user_id: int,
    body: AgentAccountsReplaceRequest,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Replace the full list of accounts assigned to an agent."""
    # Delete existing
    db.query(AgentAccount).filter(AgentAccount.user_id == user_id).delete()

    # Insert new
    for acct_id in body.platform_account_ids:
        db.add(AgentAccount(user_id=user_id, platform_account_id=acct_id))

    db.commit()
    return {"message": "Agent accounts updated", "count": len(body.platform_account_ids)}
```

- [ ] **Step 3: Verify in Swagger**

Test:
1. Create 2 platform accounts (Facebook page A, Facebook page B)
2. `POST /admin/platform-accounts/{id}/agents` — assign agent user_id=1 to page A
3. `GET /admin/platform-accounts/{id}/agents` — see agent listed
4. `GET /admin/platform-accounts/user/1/accounts` — see page A listed
5. `PUT /admin/platform-accounts/user/1/accounts` — replace with both pages
6. `DELETE /admin/platform-accounts/{id}/agents/1` — remove assignment

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/platform_accounts.py
git commit -m "feat: add agent-account assignment endpoints (bidirectional)"
```

---

### Task 4: Backend — Webhook routing by account

**Files:**
- Modify: `backend/app/routes/webhooks.py`

- [ ] **Step 1: Replace _first_account with _find_account_by_id helper**

In `backend/app/routes/webhooks.py`, replace the `_first_account` function:

```python
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
```

- [ ] **Step 2: Update _process_whatsapp to extract phone_number_id and route**

In `_process_whatsapp`, extract the phone_number_id from the payload metadata and pass to `_find_account`:

```python
async def _process_whatsapp(data: dict):
    db: Session = SessionLocal()
    try:
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})

                # Extract phone_number_id from webhook metadata for routing
                wa_phone_number_id = value.get("metadata", {}).get("phone_number_id")

                # ── Delivery / read receipts (unchanged) ──────────────────
                for status_update in value.get("statuses", []):
                    wamid = status_update.get("id")
                    new_status = status_update.get("status")
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

                    acct = _find_account(db, "whatsapp", wa_phone_number_id)
                    conv = _get_or_create_conversation(
                        db, "whatsapp", contact_id, contact_name,
                        acct.id if acct else None,
                        acct.user_id if acct else None,
                    )
                    saved = _save_inbound_message(db, conv, text, "whatsapp", contact_name)
                    await _notify_agents(saved, conv)

                    # Use per-account token for reply if available
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
```

- [ ] **Step 3: Update _process_facebook to extract page_id and route**

In `_process_facebook`, extract the page_id from `entry[].id`:

```python
async def _process_facebook(data: dict):
    db: Session = SessionLocal()
    try:
        for entry in data.get("entry", []):
            # Extract page_id from entry for routing
            fb_page_id = str(entry.get("id", ""))

            for messaging in entry.get("messaging", []):
                sender_id = messaging.get("sender", {}).get("id", "")

                # ── Delivery / read receipts (unchanged) ──────────────────
                delivery = messaging.get("delivery")
                if delivery:
                    for mid in delivery.get("mids") or []:
                        db.query(Message).filter(
                            Message.platform_message_id == mid
                        ).update({"delivery_status": "delivered"})
                    db.commit()
                    continue

                read_ev = messaging.get("read")
                if read_ev:
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
                    attachments = msg.get("attachments", [])
                    if attachments:
                        text = f"[{attachments[0].get('type','attachment')} attachment]"
                    else:
                        continue

                contact_name = await _fb_get_name(sender_id)

                acct = _find_account(db, "facebook", fb_page_id)
                conv = _get_or_create_conversation(
                    db, "facebook", sender_id, contact_name,
                    acct.id if acct else None,
                    acct.user_id if acct else None,
                )
                saved = _save_inbound_message(db, conv, text, "facebook", contact_name)
                await _notify_agents(saved, conv)

                # Use per-account token for reply
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
```

- [ ] **Step 4: Update _process_viber to route by account**

In `_process_viber`, Viber doesn't include an explicit account_id in the payload — the bot token is in the signature. For multi-bot, we match by the bot token used in signature verification. For now, use `_find_account` with `None` (falls back to first active viber account):

```python
                acct = _find_account(db, "viber")
```

(Replace the existing `acct = _first_account(db, "viber")` line.)

- [ ] **Step 5: Verify webhook routing**

Restart backend. Send a test webhook to Swagger or curl:
```bash
curl -X POST http://localhost:8000/webhooks/whatsapp -H "Content-Type: application/json" -d '{"entry":[{"changes":[{"value":{"metadata":{"phone_number_id":"123456"},"messages":[{"from":"1234","type":"text","text":{"body":"test"}}],"contacts":[{"wa_id":"1234","profile":{"name":"Test"}}]}}]}]}'
```

Check that conversation is created with the correct `platform_account_id`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routes/webhooks.py
git commit -m "feat: route inbound webhooks to specific platform accounts"
```

---

### Task 5: Backend — Send service per-account token support

**Files:**
- Modify: `backend/app/services/platform_service.py`

- [ ] **Step 1: Update WhatsAppService.send_message to accept optional per-account params**

```python
class WhatsAppService:
    BASE_URL = "https://graph.facebook.com/v18.0"

    @staticmethod
    async def send_message(
        phone_number: str,
        message: str,
        access_token: str = None,
        phone_number_id: str = None,
    ) -> Dict[str, Any]:
        token = access_token or settings.WHATSAPP_API_KEY
        pnid = phone_number_id or settings.WHATSAPP_PHONE_NUMBER_ID
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": phone_number,
            "type": "text",
            "text": {"body": message}
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{WhatsAppService.BASE_URL}/{pnid}/messages",
                json=payload,
                headers=headers
            )
            return response.json()
```

- [ ] **Step 2: Update FacebookService.send_message similarly**

Find `FacebookService` in the same file and add optional `access_token` parameter:

```python
@staticmethod
async def send_message(recipient_id: str, message: str, access_token: str = None) -> Dict[str, Any]:
    token = access_token or settings.FACEBOOK_ACCESS_TOKEN
    # Use token in the API call instead of settings.FACEBOOK_ACCESS_TOKEN
```

- [ ] **Step 3: Update ViberService.send_message similarly**

Add optional `bot_token` parameter:

```python
@staticmethod
async def send_message(receiver_id: str, message: str, bot_token: str = None) -> Dict[str, Any]:
    token = bot_token or settings.VIBER_BOT_TOKEN
    # Use token in the API call
```

- [ ] **Step 4: Verify — restart backend, no import errors**

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/platform_service.py
git commit -m "feat: send services accept per-account tokens with env fallback"
```

---

### Task 6: Backend — Conversation access scoping

**Files:**
- Modify: `backend/app/routes/conversations.py`

- [ ] **Step 1: Add account-based filtering to get_conversations**

In `get_conversations()`, after the existing query construction, add account scoping based on the current user's `agent_accounts` rows:

```python
from app.models.agent_account import AgentAccount

# Inside get_conversations, after building initial query:

# Scope to agent's permitted platform accounts
agent_account_rows = db.query(AgentAccount.platform_account_id).filter(
    AgentAccount.user_id == user_id
).all()

if agent_account_rows:
    # Agent has specific account assignments — scope to those
    permitted_ids = [r[0] for r in agent_account_rows]
    query = query.filter(
        or_(
            Conversation.platform_account_id.in_(permitted_ids),
            Conversation.platform_account_id.is_(None),  # unlinked conversations
            Conversation.platform == "webchat",
            Conversation.platform == "email",
        )
    )
# else: no rows = agent sees everything (backward compatible)
```

- [ ] **Step 2: Add optional platform_account_id filter param**

Add `platform_account_id: Optional[int] = None` query param to `get_conversations` so the frontend account filter dropdown works:

```python
if platform_account_id:
    query = query.filter(Conversation.platform_account_id == platform_account_id)
```

- [ ] **Step 3: Verify — test with and without account assignments**

1. No rows in `agent_accounts` for user 1 → should see all conversations
2. Add one row linking user 1 to account A → should only see account A conversations (+ webchat + email)
3. Add `?platform_account_id=X` param → should filter to that account only

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/conversations.py
git commit -m "feat: scope conversations to agent's permitted platform accounts"
```

---

## Chunk 2: Frontend UI

### Task 7: Frontend — Connected Accounts tab in Admin Settings

**Files:**
- Create: `frontend/app/admin/accounts/page.tsx`

- [ ] **Step 1: Create the Connected Accounts admin page**

Create `frontend/app/admin/accounts/page.tsx` with:

1. **State**: `accounts[]`, `loading`, `selectedPlatform` filter, `showModal` (add/edit), `editingAccount` (null for new)
2. **API calls**: `fetchAccounts()`, `createAccount()`, `updateAccount()`, `deleteAccount()`, `toggleAccount()`
3. **Account List Table**: Platform icon + name | Account Name | Account ID | Status badge (Active/Disabled) | Actions (Edit/Toggle/Delete buttons)
4. **Platform filter dropdown**: All / Facebook / WhatsApp / Viber / LinkedIn
5. **Add Account button** → opens modal
6. **Add/Edit Modal**:
   - Platform dropdown (disabled when editing)
   - Dynamic fields per platform:
     - Facebook: Account Name, Page ID, Access Token, App Secret
     - WhatsApp: Account Name, Phone Number ID, Phone Number, Access Token, Business Account ID (in metadata)
     - Viber: Account Name, Bot Token (mapped to access_token)
     - LinkedIn: Account Name, Access Token, Organisation ID (in metadata)
   - Password toggle (eye icon) on token/secret fields
   - Save / Cancel
7. **Agent Assignment**: "Manage Agents" button on each row → expands inline panel with:
   - List of all agents with checkboxes (ticked = assigned)
   - Fetches `GET /admin/platform-accounts/{id}/agents` and `GET /admin/users` for full list
   - On toggle: `POST` to assign or `DELETE` to remove
   - "Select All" / "Clear All" links

Follow the existing patterns in `frontend/app/admin/settings/page.tsx` for styling (TailwindCSS), API calls (axios from `lib/api.ts`), auth checks, and form layout.

- [ ] **Step 2: Add navigation link**

Find the admin sidebar/nav component and add a "Connected Accounts" link to `/admin/accounts`.

- [ ] **Step 3: Verify — full CRUD flow in browser**

1. Navigate to `/admin/accounts`
2. Click "Add Account" → fill in Facebook page → Save → see in list
3. Edit → change name → Save
4. Toggle disable/enable
5. Delete
6. "Manage Agents" → assign/unassign agents

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/accounts/page.tsx
git commit -m "feat: add Connected Accounts admin page with CRUD and agent assignment"
```

---

### Task 8: Frontend — Agent Account Access on User Edit page

**Files:**
- Modify: the admin user edit page (find in `frontend/app/admin/` — likely in the users section or a modal in the admin settings page)

- [ ] **Step 1: Add Account Access section to user edit**

After the existing user profile fields, add an "Account Access" section:

1. Fetch all platform accounts: `GET /admin/platform-accounts`
2. Fetch this user's assigned accounts: `GET /admin/platform-accounts/user/{userId}/accounts`
3. Display checkboxes grouped by platform:
   ```
   Facebook
     ☑ Sales Page (145949238600326)
     ☐ Support Page (234567890123456)
   WhatsApp
     ☑ Support Chat (+1234567890)
   ```
4. On save: `PUT /admin/platform-accounts/user/{userId}/accounts` with selected `platform_account_ids[]`

- [ ] **Step 2: Verify bidirectional**

1. Assign agent to account via Connected Accounts page → check user edit shows it
2. Change assignment via user edit → check Connected Accounts page reflects it

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/
git commit -m "feat: add Account Access section to user edit page"
```

---

### Task 9: Frontend — Conversation inbox account badge and filter

**Files:**
- Modify: `frontend/app/dashboard/page.tsx` (or the conversation list component)

- [ ] **Step 1: Add account name badge to conversation list items**

In the conversation list, next to the platform icon, show a small badge with the account name. This requires:

1. The `GET /conversations` response must include `platform_account_id`
2. Fetch the accounts list once on load: `GET /admin/platform-accounts`
3. Build a lookup map: `accountId → accountName`
4. Show as a small gray tag: `<span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{accountName}</span>`

- [ ] **Step 2: Add Account filter dropdown to sidebar**

In the filter sidebar (where platform and status filters exist), add an "Account" dropdown:

1. Populate from the accounts list fetched in step 1
2. On change: pass `?platform_account_id=X` to the conversations API call
3. "All Accounts" as default option

- [ ] **Step 3: Verify**

1. See account badges on conversations
2. Filter by account → only matching conversations shown
3. Agent with restricted access → only sees permitted account conversations

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/
git commit -m "feat: add account badges and filter to conversation inbox"
```

---

## Final Step

- [ ] **Commit all remaining changes and verify end-to-end**

Restart both backend and frontend. Test full flow:
1. Admin adds 2 Facebook pages as connected accounts
2. Admin assigns Agent A to Page 1, Agent B to both pages
3. Inbound message on Page 1 → Agent A sees it, Agent B sees it
4. Inbound message on Page 2 → only Agent B sees it
5. Reply goes out using the correct page's access token
6. Account badges show correctly in inbox
7. Filter dropdown works
