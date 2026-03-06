# Email Validator Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate an external email validation API into branding settings, email compose (real-time per-address chip validation), and campaign sends (bulk pre-send validation with lead marking and re-check).

**Architecture:** Backend proxy pattern — all validation calls go through the project's own FastAPI backend so the secret key never reaches the browser. The validator service reads config from `branding_settings`, calls the external API via `httpx`, and always fails open (never blocks the caller on error/timeout).

**Tech Stack:** FastAPI, SQLAlchemy 2.0, httpx (already in requirements.txt), Next.js 14, TailwindCSS, TypeScript

---

## Task 1: BrandingSettings Model — 3 New Validator Columns

**Files:**
- Modify: `backend/app/models/branding.py` (add 3 columns before `created_at`)
- Modify: `backend/main.py` (add inline SQL migrations)

**Step 1: Add columns to BrandingSettings model**

In `backend/app/models/branding.py`, add these 3 lines right before the `# Metadata` comment (before the `created_at` line):

```python
    # Email Validator
    email_validator_url = Column(String, nullable=True)
    email_validator_secret = Column(String, nullable=True)
    email_validator_risk_threshold = Column(Integer, default=60)
```

**Step 2: Add inline SQL migrations to main.py**

Find the inline migrations block in `backend/main.py` (look for other `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements). Add these 3 migrations in the same block:

```python
conn.execute(text("""
    ALTER TABLE branding_settings
    ADD COLUMN IF NOT EXISTS email_validator_url VARCHAR
"""))
conn.execute(text("""
    ALTER TABLE branding_settings
    ADD COLUMN IF NOT EXISTS email_validator_secret VARCHAR
"""))
conn.execute(text("""
    ALTER TABLE branding_settings
    ADD COLUMN IF NOT EXISTS email_validator_risk_threshold INTEGER DEFAULT 60
"""))
```

**Step 3: Start the backend and check for errors**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Expected: Server starts without errors. Check the terminal for any SQLAlchemy or migration errors.

**Step 4: Verify columns exist**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
python -c "
from sqlalchemy import create_engine, text, inspect
from app.config import settings
engine = create_engine(settings.DATABASE_URL)
inspector = inspect(engine)
cols = [c['name'] for c in inspector.get_columns('branding_settings')]
print(cols)
assert 'email_validator_url' in cols
assert 'email_validator_secret' in cols
assert 'email_validator_risk_threshold' in cols
print('All 3 columns present ✓')
"
```

Expected output: `All 3 columns present ✓`

**Step 5: Commit**

```bash
git add backend/app/models/branding.py backend/main.py
git commit -m "feat: add email validator columns to branding_settings"
```

---

## Task 2: Lead Model — email_valid Column

**Files:**
- Modify: `backend/app/models/crm.py` (add `email_valid` to `Lead` class)
- Modify: `backend/main.py` (add inline SQL migration)

**Step 1: Add email_valid column to Lead model**

In `backend/app/models/crm.py`, find the `Lead` class. Add this line right before the `# Timestamps` comment (before `created_at`):

```python
    # Email validation
    email_valid = Column(Boolean, nullable=True)  # NULL=unchecked, True=passed, False=failed
```

**Step 2: Add inline SQL migration to main.py**

In the same migrations block as Task 1, add:

```python
conn.execute(text("""
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS email_valid BOOLEAN
"""))
```

**Step 3: Restart backend and verify**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
python -c "
from sqlalchemy import create_engine, text, inspect
from app.config import settings
engine = create_engine(settings.DATABASE_URL)
inspector = inspect(engine)
cols = [c['name'] for c in inspector.get_columns('leads')]
print(cols)
assert 'email_valid' in cols
print('email_valid column present ✓')
"
```

**Step 4: Commit**

```bash
git add backend/app/models/crm.py backend/main.py
git commit -m "feat: add email_valid column to leads"
```

---

## Task 3: Email Validator Service

**Files:**
- Create: `backend/app/services/email_validator_service.py`

**Step 1: Create the service file**

Create `backend/app/services/email_validator_service.py` with this exact content:

```python
"""
Email Validator Service — backend proxy for external email validation API.
All calls fail open: errors/timeouts never block the caller.
"""
import httpx
import logging
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def get_validator_config(db: Session):
    """
    Returns (url, secret, threshold) tuple if configured, else None.
    """
    from app.models.branding import BrandingSettings
    branding = db.query(BrandingSettings).first()
    if not branding or not branding.email_validator_url or not branding.email_validator_secret:
        return None
    return (
        branding.email_validator_url.rstrip("/"),
        branding.email_validator_secret,
        branding.email_validator_risk_threshold or 60,
    )


def validate_single(email: str, db: Session) -> dict | None:
    """
    Validate a single email address.
    Returns dict with at least {is_valid, risk_score} or None on error/not-configured.
    Always fails open.
    """
    config = get_validator_config(db)
    if not config:
        return None
    url, secret, threshold = config
    try:
        resp = httpx.post(
            f"{url}/api/validate",
            json={"email": email},
            headers={"Authorization": f"Bearer {secret}"},
            timeout=5.0,
        )
        resp.raise_for_status()
        data = resp.json()
        # Normalise: add computed is_valid based on threshold
        risk_score = data.get("risk_score", 0)
        if "is_valid" not in data:
            data["is_valid"] = risk_score < threshold
        return data
    except Exception as exc:
        logger.warning("email_validator single failed for %s: %s", email, exc)
        return None


def validate_bulk(emails: list[str], db: Session) -> list[dict]:
    """
    Validate up to 500 emails in one request.
    Returns list of result dicts or [] on error/not-configured.
    Always fails open.
    """
    if not emails:
        return []
    config = get_validator_config(db)
    if not config:
        return []
    url, secret, threshold = config
    # Send in batches of 500
    all_results = []
    for i in range(0, len(emails), 500):
        batch = emails[i:i + 500]
        try:
            resp = httpx.post(
                f"{url}/api/validate/bulk",
                json={"emails": batch},
                headers={"Authorization": f"Bearer {secret}"},
                timeout=30.0,
            )
            resp.raise_for_status()
            results = resp.json()
            if isinstance(results, list):
                # Normalise each result
                for item in results:
                    risk_score = item.get("risk_score", 0)
                    if "is_valid" not in item:
                        item["is_valid"] = risk_score < threshold
                all_results.extend(results)
        except Exception as exc:
            logger.warning("email_validator bulk failed for batch starting %s: %s", batch[0], exc)
            # Fail open — return empty for this batch
    return all_results
```

**Step 2: Smoke-test the service (without real API)**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
python -c "
from app.services.email_validator_service import get_validator_config, validate_single, validate_bulk
from app.database import SessionLocal
db = SessionLocal()
# Should return None when not configured
result = validate_single('test@example.com', db)
print('validate_single (unconfigured):', result)
assert result is None
bulk = validate_bulk(['a@b.com', 'c@d.com'], db)
print('validate_bulk (unconfigured):', bulk)
assert bulk == []
db.close()
print('Service smoke test ✓')
"
```

Expected: `Service smoke test ✓`

**Step 3: Commit**

```bash
git add backend/app/services/email_validator_service.py
git commit -m "feat: add email_validator_service with single/bulk validation"
```

---

## Task 4: Email Validator Backend Routes

**Files:**
- Create: `backend/app/routes/email_validator.py`
- Modify: `backend/main.py` (register router)

**Step 1: Create the routes file**

Create `backend/app/routes/email_validator.py`:

```python
"""
Email Validator proxy routes — frontend calls these; backend adds the secret.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.email_validator_service import validate_single, validate_bulk

router = APIRouter(prefix="/email-validator", tags=["email-validator"])


class SingleValidateRequest(BaseModel):
    email: str


class BulkValidateRequest(BaseModel):
    emails: list[str]


@router.post("/validate")
def proxy_validate_single(
    body: SingleValidateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy single email validation to external API."""
    result = validate_single(body.email, db)
    if result is None:
        # Not configured or failed — return unchecked state
        return {"email": body.email, "is_valid": None, "risk_score": None, "unchecked": True}
    return {"email": body.email, **result}


@router.post("/validate-bulk")
def proxy_validate_bulk(
    body: BulkValidateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy bulk email validation to external API."""
    results = validate_bulk(body.emails, db)
    return {"results": results}


@router.post("/recheck-lead/{lead_id}")
def recheck_lead_email(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Re-validate a lead's email. Updates lead.email_valid and EmailSuppression.
    Returns updated validity status.
    """
    from app.models.crm import Lead
    from app.models.email_suppression import EmailSuppression

    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.email:
        return {"lead_id": lead_id, "email": None, "email_valid": None, "message": "No email on lead"}

    result = validate_single(lead.email, db)

    if result is None:
        # Validator not configured or timed out — fail open, don't change status
        return {"lead_id": lead_id, "email": lead.email, "email_valid": lead.email_valid, "unchecked": True}

    from app.services.email_validator_service import get_validator_config
    config = get_validator_config(db)
    threshold = config[2] if config else 60
    risk_score = result.get("risk_score", 0)
    passed = result.get("is_valid", True) and risk_score < threshold

    if passed:
        lead.email_valid = True
        # Remove any "invalid" suppression for this email
        db.query(EmailSuppression).filter(
            EmailSuppression.email == lead.email,
            EmailSuppression.reason == "invalid",
        ).delete(synchronize_session=False)
    else:
        lead.email_valid = False
        # Upsert suppression with reason="invalid"
        existing = db.query(EmailSuppression).filter(
            EmailSuppression.email == lead.email,
            EmailSuppression.reason == "invalid",
        ).first()
        if not existing:
            db.add(EmailSuppression(email=lead.email, reason="invalid"))

    db.commit()
    db.refresh(lead)
    return {
        "lead_id": lead_id,
        "email": lead.email,
        "email_valid": lead.email_valid,
        "risk_score": risk_score,
        "unchecked": False,
    }
```

**Step 2: Register the router in main.py**

In `backend/main.py`, add the import near the other route imports (find the block starting with `from app.routes import ...`):

```python
from app.routes.email_validator import router as email_validator_router
```

Then add the `include_router` call near the other `app.include_router(...)` calls:

```python
app.include_router(email_validator_router)
```

**Step 3: Restart backend and verify endpoints appear**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Then in another terminal:

```bash
curl -s http://localhost:8000/openapi.json | python -c "
import json, sys
spec = json.load(sys.stdin)
ev_paths = [p for p in spec['paths'] if '/email-validator' in p]
print('Email validator paths:', ev_paths)
assert len(ev_paths) == 3, f'Expected 3 paths, got {len(ev_paths)}'
print('All 3 routes registered ✓')
"
```

Expected: `All 3 routes registered ✓`

**Step 4: Commit**

```bash
git add backend/app/routes/email_validator.py backend/main.py
git commit -m "feat: add email-validator proxy routes (validate, validate-bulk, recheck-lead)"
```

---

## Task 5: Extend Branding Routes for Validator Config

**Files:**
- Modify: `backend/app/routes/branding.py` (add schema + endpoints)

**Step 1: Add EmailValidatorUpdate schema**

In `backend/app/routes/branding.py`, add this Pydantic model after the `SmtpUpdate` class:

```python
class EmailValidatorUpdate(BaseModel):
    email_validator_url: Optional[str] = None
    email_validator_secret: Optional[str] = None
    email_validator_risk_threshold: Optional[int] = None
```

**Step 2: Add validator fields to GET /branding/admin response**

In the `get_branding_admin` function, add these fields to the returned `data` dict (after `layout_bg_color`):

```python
            "email_validator_url": branding.email_validator_url,
            "email_validator_secret": (
                ("*" * (len(branding.email_validator_secret) - 4) + branding.email_validator_secret[-4:])
                if branding.email_validator_secret and len(branding.email_validator_secret) > 4
                else ("****" if branding.email_validator_secret else None)
            ),
            "email_validator_risk_threshold": branding.email_validator_risk_threshold or 60,
```

**Step 3: Add POST /branding/email-validator endpoint**

Add this new endpoint after the `update_smtp` function:

```python
@router.post("/email-validator")
def update_email_validator(
    data: EmailValidatorUpdate,
    user: User = Depends(require_branding),
    db: Session = Depends(get_db)
):
    """Update email validator settings (admin only)."""
    update_dict = data.dict(exclude_unset=True)
    # Don't overwrite the secret if the frontend sent back the masked value
    if "email_validator_secret" in update_dict:
        secret = update_dict["email_validator_secret"]
        if secret and set(secret.replace("*", "").replace(secret[-4:], "")) == set():
            # Looks like a masked value (all stars except last 4) — skip
            del update_dict["email_validator_secret"]
    branding = branding_service.update_branding(db, **update_dict)
    return {
        "status": "success",
        "message": "Email validator settings updated",
        "data": {
            "email_validator_url": branding.email_validator_url,
            "email_validator_risk_threshold": branding.email_validator_risk_threshold or 60,
        }
    }
```

**Step 4: Restart backend, test endpoint exists**

```bash
curl -s http://localhost:8000/openapi.json | python -c "
import json, sys
spec = json.load(sys.stdin)
assert '/branding/email-validator' in spec['paths'], 'endpoint missing'
print('/branding/email-validator endpoint registered ✓')
"
```

**Step 5: Commit**

```bash
git add backend/app/routes/branding.py
git commit -m "feat: extend branding routes with email validator config endpoints"
```

---

## Task 6: Campaign Flow Changes

**Files:**
- Modify: `backend/app/routes/campaigns.py` (update `_build_audience` and `_do_send`)

**Step 1: Update `_build_audience` to exclude email_valid=False leads**

In `backend/app/routes/campaigns.py`, find the `_build_audience` function. Find the line:

```python
    return [lead for lead in leads if lead.email not in suppressed_emails]
```

Replace it with:

```python
    # Also exclude leads that have been marked as invalid by the email validator
    return [
        lead for lead in leads
        if lead.email not in suppressed_emails and lead.email_valid is not False
    ]
```

**Step 2: Add bulk pre-send validation step to `_do_send`**

In `backend/app/routes/campaigns.py`, find the `_do_send` function. Find this block (after `audience = _build_audience(...)`):

```python
    base_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    sent = 0
    errors = 0
```

Insert the pre-send bulk validation step between `audience = _build_audience(...)` and `base_url = ...`:

```python
    # Pre-send bulk email validation (skip if validator not configured)
    from app.services.email_validator_service import validate_bulk, get_validator_config
    from app.models.email_suppression import EmailSuppression as _ES
    validation_skipped_count = 0

    validator_config = get_validator_config(db)
    if validator_config and audience:
        _, _, threshold = validator_config
        audience_emails = [lead.email for lead in audience]
        try:
            bulk_results = validate_bulk(audience_emails, db)
            # Build a map: email -> result
            result_map = {r.get("email"): r for r in bulk_results if r.get("email")}
            filtered_audience = []
            for lead in audience:
                result = result_map.get(lead.email)
                if result is None:
                    # No result for this email — fail open, include
                    filtered_audience.append(lead)
                    continue
                risk_score = result.get("risk_score", 0)
                passed = result.get("is_valid", True) and risk_score < threshold
                if passed:
                    lead.email_valid = True
                    filtered_audience.append(lead)
                else:
                    lead.email_valid = False
                    existing_sup = db.query(_ES).filter(
                        _ES.email == lead.email,
                        _ES.reason == "invalid",
                    ).first()
                    if not existing_sup:
                        db.add(_ES(email=lead.email, reason="invalid", campaign_id=campaign_id))
                    validation_skipped_count += 1
            db.commit()
            audience = filtered_audience
        except Exception as exc:
            import logging as _logging
            _logging.getLogger(__name__).warning("Pre-send bulk validation failed: %s", exc)
            # Fail open — proceed with original audience
```

**Step 3: Restart backend and check for syntax errors**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
python -c "import app.routes.campaigns; print('campaigns module OK ✓')"
```

Expected: `campaigns module OK ✓`

**Step 4: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat: campaign audience excludes invalid leads; pre-send bulk validation"
```

---

## Task 7: EmailAddressInput Component

**Files:**
- Create: `frontend/components/EmailAddressInput.tsx`

**Step 1: Create the component**

Create `frontend/components/EmailAddressInput.tsx`:

```tsx
'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

type ChipStatus = 'pending' | 'valid' | 'risky' | 'invalid' | 'unchecked'

interface Chip {
  email: string
  status: ChipStatus
  riskScore?: number
  reason?: string
}

interface Props {
  label: string
  value: string        // comma-separated string for form compat
  onChange: (val: string) => void
  placeholder?: string
}

async function validateEmail(email: string): Promise<{ status: ChipStatus; riskScore?: number; reason?: string }> {
  try {
    const token = getAuthToken()
    const res = await axios.post(
      `${API_URL}/email-validator/validate`,
      { email },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = res.data
    if (data.unchecked) return { status: 'unchecked' }
    const riskScore: number = data.risk_score ?? 0
    if (data.is_valid === false) {
      return { status: 'invalid', riskScore, reason: data.reason ?? 'Invalid address' }
    }
    if (riskScore >= 40) {
      return { status: 'risky', riskScore }
    }
    return { status: 'valid', riskScore }
  } catch {
    return { status: 'unchecked' }
  }
}

const STATUS_STYLES: Record<ChipStatus, string> = {
  pending:   'border-gray-300 bg-gray-50 text-gray-700',
  valid:     'border-green-400 bg-green-50 text-green-800',
  risky:     'border-yellow-400 bg-yellow-50 text-yellow-800',
  invalid:   'border-red-400 bg-red-50 text-red-800',
  unchecked: 'border-gray-300 bg-white text-gray-700',
}

const STATUS_ICON: Record<ChipStatus, string> = {
  pending:   '⏳',
  valid:     '✅',
  risky:     '⚠️',
  invalid:   '❌',
  unchecked: '',
}

export default function EmailAddressInput({ label, value, onChange, placeholder }: Props) {
  const [chips, setChips] = useState<Chip[]>(() =>
    value
      ? value.split(',').map(e => e.trim()).filter(Boolean).map(email => ({ email, status: 'unchecked' as ChipStatus }))
      : []
  )
  const [inputVal, setInputVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const emitChange = (updated: Chip[]) => {
    onChange(updated.map(c => c.email).join(', '))
  }

  const addChip = async (raw: string) => {
    const email = raw.trim().toLowerCase()
    if (!email || chips.some(c => c.email === email)) return
    const chip: Chip = { email, status: 'pending' }
    const updated = [...chips, chip]
    setChips(updated)
    emitChange(updated)

    const result = await validateEmail(email)
    setChips(prev => {
      const next = prev.map(c =>
        c.email === email ? { ...c, ...result } : c
      )
      emitChange(next)
      return next
    })
  }

  const removeChip = (email: string) => {
    const updated = chips.filter(c => c.email !== email)
    setChips(updated)
    emitChange(updated)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', 'Tab', ','].includes(e.key)) {
      e.preventDefault()
      if (inputVal.trim()) {
        addChip(inputVal)
        setInputVal('')
      }
    } else if (e.key === 'Backspace' && !inputVal && chips.length > 0) {
      removeChip(chips[chips.length - 1].email)
    }
  }

  const handleBlur = () => {
    if (inputVal.trim()) {
      addChip(inputVal)
      setInputVal('')
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div
        className="flex flex-wrap gap-1 min-h-[36px] px-2 py-1 border border-gray-300 rounded-lg bg-white cursor-text focus-within:ring-2 focus-within:ring-blue-500"
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map(chip => (
          <span
            key={chip.email}
            title={
              chip.status === 'risky'
                ? `Risk score: ${chip.riskScore}`
                : chip.status === 'invalid'
                ? chip.reason ?? 'Invalid address'
                : undefined
            }
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[chip.status]}`}
          >
            {STATUS_ICON[chip.status] && (
              <span className="text-xs">{STATUS_ICON[chip.status]}</span>
            )}
            {chip.email}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); removeChip(chip.email) }}
              className="ml-1 text-gray-400 hover:text-gray-600 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={chips.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none text-sm bg-transparent py-0.5"
        />
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /Users/rajmaha/Sites/SocialMedia/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors related to `EmailAddressInput.tsx`. Other pre-existing errors are OK.

**Step 3: Commit**

```bash
git add frontend/components/EmailAddressInput.tsx
git commit -m "feat: add EmailAddressInput chip component with per-address validation"
```

---

## Task 8: Email Compose — Replace to/cc/bcc with EmailAddressInput

**Files:**
- Modify: `frontend/app/email/page.tsx`

**Step 1: Import the component**

At the top of `frontend/app/email/page.tsx`, add this import near the other component imports:

```tsx
import EmailAddressInput from '@/components/EmailAddressInput'
```

**Step 2: Change composeData state types**

The `composeData` state already uses strings for `to`, `cc`, `bcc`. No type change needed — `EmailAddressInput` accepts and emits comma-separated strings.

**Step 3: Replace the to/cc/bcc text inputs in the compose form**

In the compose modal/panel, find the `to` input (it will look something like):

```tsx
<input
  type="text"
  value={composeData.to}
  onChange={(e) => setComposeData({ ...composeData, to: e.target.value })}
  placeholder="To"
  ...
/>
```

Replace the `to`, `cc`, and `bcc` plain text inputs with `EmailAddressInput`:

```tsx
<EmailAddressInput
  label="To"
  value={composeData.to}
  onChange={(val) => setComposeData(prev => ({ ...prev, to: val }))}
  placeholder="recipient@example.com"
/>
```

```tsx
<EmailAddressInput
  label="CC"
  value={composeData.cc}
  onChange={(val) => setComposeData(prev => ({ ...prev, cc: val }))}
  placeholder="cc@example.com"
/>
```

```tsx
<EmailAddressInput
  label="BCC"
  value={composeData.bcc}
  onChange={(val) => setComposeData(prev => ({ ...prev, bcc: val }))}
  placeholder="bcc@example.com"
/>
```

> **Tip**: Search for `composeData.to` in the file to find the exact location. The CC/BCC inputs are likely inside the `showCcBcc` conditional block.

**Step 4: Test in browser**

```bash
cd /Users/rajmaha/Sites/SocialMedia/frontend
npm run dev
```

Open http://localhost:3000/email, click Compose, and verify:
- The To field shows chips when you type an address and press Enter/Tab/comma
- Chips show ⏳ briefly, then update to ✅/⚠️/❌ (or stay neutral if validator not configured)
- Chips can be deleted with the × button
- Sending still works (the comma-separated string is passed correctly)

**Step 5: Commit**

```bash
git add frontend/app/email/page.tsx
git commit -m "feat: replace plain to/cc/bcc inputs with EmailAddressInput chip component"
```

---

## Task 9: Branding Admin — Email Validator Tab

**Files:**
- Modify: `frontend/app/admin/branding/page.tsx`

**Step 1: Add EmailValidatorData interface**

After the `SmtpData` interface, add:

```tsx
interface EmailValidatorData {
  email_validator_url: string
  email_validator_secret: string
  email_validator_risk_threshold: number
}
```

**Step 2: Add state for validator data**

Find the `useState` block near the top of `BrandingAdmin`. Add:

```tsx
  const [validator, setValidator] = useState<EmailValidatorData>({
    email_validator_url: '',
    email_validator_secret: '',
    email_validator_risk_threshold: 60,
  })
  const [showValidatorSecret, setShowValidatorSecret] = useState(false)
```

**Step 3: Extend the activeTab type**

Find:

```tsx
const [activeTab, setActiveTab] = useState<'company' | 'colors' | 'smtp' | 'links' | 'attachments'>('company')
```

Replace with:

```tsx
const [activeTab, setActiveTab] = useState<'company' | 'colors' | 'smtp' | 'links' | 'attachments' | 'email-validator'>('company')
```

**Step 4: Populate validator state in the data-fetch useEffect**

In the `useEffect` that fetches branding data (look for `setBranding(` or `axios.get('/branding/admin')`), add after the existing state setters:

```tsx
      setValidator({
        email_validator_url: data.email_validator_url || '',
        email_validator_secret: data.email_validator_secret || '',
        email_validator_risk_threshold: data.email_validator_risk_threshold ?? 60,
      })
```

**Step 5: Add saveValidator function**

After the `saveSmtp` function (look for `POST /branding/smtp`), add:

```tsx
  const saveValidator = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const token = getAuthToken()
      await axios.post(
        `${API_URL}/branding/email-validator`,
        validator,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSuccess('Email validator settings saved')
    } catch {
      setError('Failed to save validator settings')
    } finally {
      setSaving(false)
    }
  }
```

**Step 6: Add Email Validator tab button**

Find the tab buttons row (look for `onClick={() => setActiveTab('attachments')}`). Add after the Attachments tab button:

```tsx
<button
  onClick={() => setActiveTab('email-validator')}
  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
    activeTab === 'email-validator'
      ? 'bg-blue-600 text-white'
      : 'text-gray-600 hover:bg-gray-100'
  }`}
>
  Email Validator
</button>
```

**Step 7: Add Email Validator tab panel**

After the `{activeTab === 'attachments' && ...}` block (before the closing `</main>`), add:

```tsx
        {/* Email Validator */}
        {activeTab === 'email-validator' && (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <p className="text-sm text-gray-600">
              Configure the external email validation API. When set, emails are validated in real-time
              during compose and in bulk before campaign sends.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Validator URL</label>
              <input
                type="url"
                value={validator.email_validator_url}
                onChange={(e) => setValidator(prev => ({ ...prev, email_validator_url: e.target.value }))}
                placeholder="https://hooks.yourdomain.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Base URL of the validation API (e.g. https://hooks.yourdomain.com)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Secret Key</label>
              <div className="relative">
                <input
                  type={showValidatorSecret ? 'text' : 'password'}
                  value={validator.email_validator_secret}
                  onChange={(e) => setValidator(prev => ({ ...prev, email_validator_secret: e.target.value }))}
                  placeholder="Bearer token"
                  className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowValidatorSecret(!showValidatorSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  {showValidatorSecret ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Sent as <code>Authorization: Bearer &lt;secret&gt;</code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Risk Threshold</label>
              <input
                type="number"
                min={1}
                max={100}
                value={validator.email_validator_risk_threshold}
                onChange={(e) =>
                  setValidator(prev => ({ ...prev, email_validator_risk_threshold: parseInt(e.target.value) || 60 }))
                }
                className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Emails with risk score ≥ this value will be rejected (default: 60, range: 1–100)
              </p>
            </div>

            <button
              onClick={saveValidator}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Validator Settings'}
            </button>
          </div>
        )}
```

**Step 8: Test in browser**

Open http://localhost:3000/admin/branding and verify:
- "Email Validator" tab appears in the tab bar
- Clicking it shows the form with Validator URL, Secret Key (masked with show/hide), and Risk Threshold fields
- Saving shows "Email validator settings saved"

**Step 9: Commit**

```bash
git add frontend/app/admin/branding/page.tsx
git commit -m "feat: add Email Validator tab to branding admin page"
```

---

## Task 10: Campaign Recipients — Invalid Badge + Re-check Button

**Files:**
- Modify: `frontend/app/admin/` — find the campaign recipients/stats page (likely `frontend/app/admin/campaigns/[id]/page.tsx` or similar)

**Step 1: Find the campaign recipients table**

Run:

```bash
grep -r "CampaignRecipient\|recipient\.email\|recipients" /Users/rajmaha/Sites/SocialMedia/frontend/app --include="*.tsx" -l
```

Then read the file(s) found to understand the current structure.

**Step 2: Add re-check state**

In the campaign detail/recipients page component, add:

```tsx
const [recheckingLeadId, setRecheckingLeadId] = useState<number | null>(null)
const [recheckResults, setRecheckResults] = useState<Record<number, boolean | null>>({})
```

**Step 3: Add recheckLead function**

```tsx
const recheckLead = async (leadId: number) => {
  setRecheckingLeadId(leadId)
  try {
    const token = getAuthToken()
    const res = await axios.post(
      `${API_URL}/email-validator/recheck-lead/${leadId}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    )
    setRecheckResults(prev => ({ ...prev, [leadId]: res.data.email_valid }))
  } catch {
    // silently fail
  } finally {
    setRecheckingLeadId(null)
  }
}
```

**Step 4: Add badge + re-check button to each recipient row**

In the recipients table row, after the email cell, add:

```tsx
{/* Validity badge */}
{(() => {
  const validity = recheckResults[recipient.lead_id] ?? recipient.email_valid
  if (validity === false) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 border border-red-300">
        ❌ Invalid
      </span>
    )
  }
  if (validity === true) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300">
        ✅ Valid
      </span>
    )
  }
  return null
})()}

{/* Re-check button — show only for invalid leads */}
{(recheckResults[recipient.lead_id] ?? recipient.email_valid) === false && (
  <button
    onClick={() => recheckLead(recipient.lead_id)}
    disabled={recheckingLeadId === recipient.lead_id}
    className="ml-2 px-2 py-0.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
  >
    {recheckingLeadId === recipient.lead_id ? '⏳' : 'Re-check'}
  </button>
)}
```

> **Note**: The `recipient` object may not currently include `email_valid` or `lead_id`. If those fields are missing from the API response, read `backend/app/routes/campaigns.py` recipient endpoints and add the fields to the response schema.

**Step 5: Verify in browser**

Open a campaign's detail/recipients view. If any leads have `email_valid=False`, they should show the ❌ Invalid badge and Re-check button. Clicking Re-check should update the badge inline.

**Step 6: Commit**

```bash
git add frontend/app/admin/campaigns/
git commit -m "feat: add Invalid badge and Re-check button to campaign recipients"
```

---

## Task 11: CRM Lead Profile — Verify Email Button

**Files:**
- Modify: the CRM lead detail page (likely `frontend/app/admin/crm/` or similar)

**Step 1: Find the CRM lead detail component**

```bash
grep -r "lead\.email\|lead_id\|LeadDetail\|lead profile" /Users/rajmaha/Sites/SocialMedia/frontend/app --include="*.tsx" -l
```

Read the file(s) found to understand the current structure and where the email field is displayed.

**Step 2: Add re-check state to the lead detail component**

```tsx
const [verifyingEmail, setVerifyingEmail] = useState(false)
const [emailValidState, setEmailValidState] = useState<boolean | null | undefined>(lead?.email_valid)
```

**Step 3: Add verifyEmail function**

```tsx
const verifyEmail = async () => {
  if (!lead?.id) return
  setVerifyingEmail(true)
  try {
    const token = getAuthToken()
    const res = await axios.post(
      `${API_URL}/email-validator/recheck-lead/${lead.id}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    )
    setEmailValidState(res.data.email_valid)
  } catch {
    // silently fail
  } finally {
    setVerifyingEmail(false)
  }
}
```

**Step 4: Add validity badge + Verify Email button next to the email field**

In the lead profile, find where `lead.email` is rendered. After it, add:

```tsx
{/* Email validity badge */}
{(() => {
  const validity = emailValidState ?? lead?.email_valid
  if (validity === true) {
    return <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-300">✅ Valid</span>
  }
  if (validity === false) {
    return <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 border border-red-300">❌ Invalid</span>
  }
  return <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 border border-gray-200">— Not checked</span>
})()}

{/* Verify Email button */}
{lead?.email && (
  <button
    onClick={verifyEmail}
    disabled={verifyingEmail}
    className="ml-2 px-3 py-1 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
  >
    {verifyingEmail ? '⏳ Verifying...' : '🔍 Verify Email'}
  </button>
)}
```

**Step 5: Verify in browser**

Open a CRM lead profile. The email field should have a validity badge (— Not checked if never validated) and a "🔍 Verify Email" button. Clicking it should update the badge inline.

**Step 6: Commit**

```bash
git add frontend/app/admin/crm/
git commit -m "feat: add email validity badge and Verify Email button to CRM lead profile"
```

---

## Done

All tasks complete. Summary of what was built:

| Area | What changed |
|---|---|
| `branding_settings` | 3 new columns: `email_validator_url`, `email_validator_secret`, `email_validator_risk_threshold` |
| `leads` | 1 new column: `email_valid` (Boolean nullable) |
| `email_suppressions` | No schema change; `reason="invalid"` now used |
| `email_validator_service.py` | `get_validator_config`, `validate_single`, `validate_bulk` — all fail open |
| `email_validator.py` routes | `POST /email-validator/validate`, `/validate-bulk`, `/recheck-lead/{id}` |
| `branding.py` routes | `GET /branding/admin` extended; `POST /branding/email-validator` added |
| `campaigns.py` | `_build_audience` excludes `email_valid=False`; `_do_send` runs pre-send bulk validation |
| `EmailAddressInput.tsx` | Reusable chip input with per-address real-time validation states |
| Email compose | `to`, `cc`, `bcc` replaced with `EmailAddressInput` |
| Branding admin | New "Email Validator" tab with URL, secret, threshold fields |
| Campaign recipients | ❌ Invalid badge + Re-check button per recipient row |
| CRM lead profile | Validity badge + Verify Email button inline |
