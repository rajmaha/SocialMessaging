# Email Template Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a professional email template library to campaigns, with a visual template picker, Tiptap rich editor + merge tag toolbar, and enhanced open tracking (IP geolocation + device detection).

**Architecture:** New `email_templates` DB table seeded with 4 preset HTML templates. Backend CRUD routes at `/email-templates/`. Campaign form replaces raw textarea with EmailTemplateGallery modal + EmailEditor (Tiptap + merge tag bar). Tracking pixel enhanced with BackgroundTasks to async-geolocate via `ipapi.co` and parse User-Agent for device/client data.

**Tech Stack:** FastAPI, SQLAlchemy, `ipapi.co` (free HTTP API), Next.js 14, Tiptap v3, TailwindCSS

---

### Task 1: EmailTemplate model + migration + seed 4 presets

**Files:**
- Create: `backend/app/models/email_template.py`
- Modify: `backend/main.py` (add migration + seed + import)

**Step 1: Create model**

```python
# backend/app/models/email_template.py
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(50), nullable=False)   # newsletter | promotional | welcome | followup
    is_preset = Column(Boolean, default=False, nullable=False)
    body_html = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

**Step 2: Define preset HTML strings in main.py**

Add these constants near the top of `backend/main.py` (after imports):

```python
# ── Email Template Presets ────────────────────────────────────────────────────
_TPL_NEWSLETTER = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:#4f46e5;padding:32px 40px;text-align:center;">
  <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">{{company}}</h1>
  <p style="color:#c7d2fe;margin:8px 0 0;font-size:14px;">Monthly Newsletter</p>
</td></tr>
<tr><td style="padding:32px 40px 16px;">
  <p style="font-size:18px;color:#1f2937;margin:0 0 16px;">Hi {{first_name}},</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0;">Here's what's new this month.</p>
</td></tr>
<tr><td style="padding:0 40px 24px;">
  <div style="border-left:4px solid #4f46e5;padding-left:16px;">
    <h2 style="font-size:17px;color:#1f2937;margin:0 0 8px;">📌 Featured Update</h2>
    <p style="font-size:14px;color:#6b7280;line-height:1.7;margin:0;">Your article content goes here. Share your latest news or product updates.</p>
  </div>
</td></tr>
<tr><td style="padding:0 40px 24px;"><hr style="border:none;border-top:1px solid #e5e7eb;"></td></tr>
<tr><td style="padding:0 40px 32px;">
  <div style="border-left:4px solid #10b981;padding-left:16px;">
    <h2 style="font-size:17px;color:#1f2937;margin:0 0 8px;">💡 Tip of the Month</h2>
    <p style="font-size:14px;color:#6b7280;line-height:1.7;margin:0;">Share a valuable tip here. Keep it concise and actionable.</p>
  </div>
</td></tr>
<tr><td style="padding:0 40px 32px;text-align:center;">
  <a href="#" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;">Read More →</a>
</td></tr>
<tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">You received this from {{company}}. <a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_TPL_PROMOTIONAL = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:48px 40px;text-align:center;">
  <div style="display:inline-block;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.5);border-radius:24px;padding:6px 20px;margin-bottom:20px;">
    <span style="color:#fff;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Limited Time Offer</span>
  </div>
  <h1 style="color:#fff;margin:0 0 16px;font-size:36px;font-weight:800;line-height:1.2;">Exclusive Deal<br>Just For You</h1>
  <p style="color:rgba(255,255,255,.85);margin:0;font-size:16px;">Hi {{first_name}}, we have something special for you.</p>
</td></tr>
<tr><td style="padding:40px;text-align:center;">
  <div style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:12px;padding:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#92400e;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Your Special Discount</p>
    <p style="font-size:48px;color:#d97706;font-weight:800;margin:0 0 8px;">20% OFF</p>
    <p style="font-size:13px;color:#92400e;margin:0;">Use code: <strong>SPECIAL20</strong></p>
  </div>
  <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0 0 32px;">Don't miss out on this exclusive offer available for a limited time.</p>
  <a href="#" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;padding:16px 48px;border-radius:50px;font-size:16px;font-weight:700;">Claim Your Offer →</a>
</td></tr>
<tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">© {{company}} · <a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_TPL_WELCOME = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:#059669;padding:32px 40px;text-align:center;">
  <div style="font-size:40px;margin-bottom:12px;">👋</div>
  <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;">Welcome to {{company}}!</h1>
</td></tr>
<tr><td style="padding:32px 40px 16px;">
  <p style="font-size:16px;color:#1f2937;margin:0 0 16px;">Hi {{first_name}},</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0;">We're thrilled to have you. Here are a few steps to get started:</p>
</td></tr>
<tr><td style="padding:0 40px 32px;">
  <table width="100%" cellpadding="0" cellspacing="8">
    <tr><td style="padding:12px;background:#f0fdf4;border-radius:8px;font-size:14px;color:#1f2937;"><strong>Step 1:</strong> Complete your profile setup</td></tr>
    <tr><td style="height:8px;"></td></tr>
    <tr><td style="padding:12px;background:#eff6ff;border-radius:8px;font-size:14px;color:#1f2937;"><strong>Step 2:</strong> Explore our features and resources</td></tr>
    <tr><td style="height:8px;"></td></tr>
    <tr><td style="padding:12px;background:#faf5ff;border-radius:8px;font-size:14px;color:#1f2937;"><strong>Step 3:</strong> Reach out if you have any questions</td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 40px 32px;text-align:center;">
  <a href="#" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:15px;font-weight:600;">Get Started →</a>
</td></tr>
<tr><td style="padding:0 40px 32px;border-top:1px solid #e5e7eb;">
  <p style="font-size:14px;color:#4b5563;margin:24px 0 0;">Warmly,<br><strong>The {{company}} Team</strong></p>
</td></tr>
<tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">© {{company}} · <a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_TPL_FOLLOWUP = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:#3b82f6;height:4px;"></td></tr>
<tr><td style="padding:40px;">
  <p style="font-size:15px;color:#1f2937;margin:0 0 20px;">Hi {{first_name}},</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.8;margin:0 0 20px;">I wanted to follow up and check in with you. I'd love to see how things are going.</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.8;margin:0 0 32px;">If there's anything I can help you with, I'm just one click away.</p>
  <a href="#" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;">Let's Chat →</a>
  <p style="font-size:14px;color:#6b7280;margin:32px 0 0;border-top:1px solid #e5e7eb;padding-top:24px;">Best regards,<br><strong style="color:#1f2937;">The {{company}} Team</strong></p>
</td></tr>
<tr><td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;"><a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_PRESET_TEMPLATES = [
    ("Newsletter", "newsletter", _TPL_NEWSLETTER),
    ("Promotional / Offer", "promotional", _TPL_PROMOTIONAL),
    ("Welcome Email", "welcome", _TPL_WELCOME),
    ("Follow-up", "followup", _TPL_FOLLOWUP),
]
```

**Step 3: Add migration + seed in main.py startup block**

In `main.py` inside the `with engine.connect() as conn:` startup block, add **after** the campaigns migration:

```python
# ── email_templates table ────────────────────────────────────────────────────
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50) NOT NULL,
        is_preset BOOLEAN NOT NULL DEFAULT FALSE,
        body_html TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
"""))
conn.commit()

# Seed preset templates once
preset_count = conn.execute(
    text("SELECT COUNT(*) FROM email_templates WHERE is_preset = TRUE")
).scalar()
if preset_count == 0:
    for tpl_name, tpl_category, tpl_html in _PRESET_TEMPLATES:
        conn.execute(text("""
            INSERT INTO email_templates (name, category, is_preset, body_html)
            VALUES (:name, :category, TRUE, :body_html)
        """), {"name": tpl_name, "category": tpl_category, "body_html": tpl_html})
    conn.commit()
```

**Step 4: Import model in main.py**

Add to imports in main.py alongside other model imports:
```python
from app.models.email_template import EmailTemplate
```

**Step 5: Commit**
```bash
git add backend/app/models/email_template.py backend/main.py
git commit -m "feat: add email_templates model, migration, and 4 preset seeds"
```

---

### Task 2: Enhanced tracking — geolocation + device detection

**Files:**
- Modify: `backend/main.py` (add `campaign_recipients` columns migration)
- Modify: `backend/app/routes/campaigns.py` (enhance tracking pixel endpoint)

**Step 1: Add migration for new recipient columns**

In the `main.py` startup block, **after** the existing `campaign_recipients` table creation, add:

```python
# ── tracking enrichment columns ──────────────────────────────────────────────
for col_sql in [
    "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS country VARCHAR(100)",
    "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS city VARCHAR(100)",
    "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS device_type VARCHAR(50)",
    "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS email_client VARCHAR(100)",
]:
    conn.execute(text(col_sql))
conn.commit()
```

**Step 2: Add helper functions in campaigns.py**

Add these helper functions near the top of `backend/app/routes/campaigns.py` (after existing imports):

```python
import threading
import urllib.request
import json as _json


def _parse_device(ua: str) -> str:
    ua = ua.lower()
    if any(x in ua for x in ["ipad", "tablet"]):
        return "tablet"
    if any(x in ua for x in ["iphone", "android", "mobile"]):
        return "mobile"
    return "desktop"


def _parse_email_client(ua: str) -> str:
    ua = ua.lower()
    if "gmail" in ua:
        return "Gmail"
    if "outlook" in ua:
        return "Outlook"
    if "apple mail" in ua or ("darwin" in ua and "mac" in ua):
        return "Apple Mail"
    if "thunderbird" in ua:
        return "Thunderbird"
    if "yahoo" in ua:
        return "Yahoo Mail"
    return "Other"


def _enrich_recipient(recipient_id: int, ip: str, user_agent: str):
    """Fire-and-forget: geolocate IP and parse UA, update recipient row."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        country, city = None, None
        if ip and ip not in ("127.0.0.1", "::1", "testclient"):
            try:
                req = urllib.request.Request(
                    f"https://ipapi.co/{ip}/json/",
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                with urllib.request.urlopen(req, timeout=4) as resp:
                    geo = _json.loads(resp.read())
                    country = geo.get("country_name")
                    city = geo.get("city")
            except Exception:
                pass

        device_type = _parse_device(user_agent)
        email_client = _parse_email_client(user_agent)

        r = db.query(CampaignRecipient).filter(CampaignRecipient.id == recipient_id).first()
        if r:
            if country:
                r.country = country
            if city:
                r.city = city
            r.device_type = device_type
            r.email_client = email_client
            db.commit()
    except Exception:
        pass
    finally:
        db.close()
```

**Step 3: Update the tracking pixel endpoint**

Replace the existing `track_open` function in `campaigns.py`:

```python
from fastapi import Request, BackgroundTasks


@router.get("/track/open/{campaign_id}/{recipient_id}")
def track_open(
    campaign_id: int,
    recipient_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Returns 1×1 GIF, records open, and async-enriches with geo+device data."""
    recipient = db.query(CampaignRecipient).filter(
        CampaignRecipient.id == recipient_id,
        CampaignRecipient.campaign_id == campaign_id,
    ).first()
    if recipient:
        if recipient.opened_at is None:
            recipient.opened_at = datetime.utcnow()
            campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
            if campaign:
                campaign.opened_count = (campaign.opened_count or 0) + 1
        recipient.open_count = (recipient.open_count or 0) + 1
        db.commit()

        client_ip = request.client.host if request.client else ""
        user_agent = request.headers.get("user-agent", "")
        background_tasks.add_task(_enrich_recipient, recipient.id, client_ip, user_agent)

    return Response(
        content=TRACKING_PIXEL,
        media_type="image/gif",
        headers={"Cache-Control": "no-store, no-cache"},
    )
```

**Step 4: Commit**
```bash
git add backend/main.py backend/app/routes/campaigns.py
git commit -m "feat: enhance tracking pixel with geolocation and device detection"
```

---

### Task 3: Email templates CRUD routes + merge tags in campaign send

**Files:**
- Create: `backend/app/schemas/email_template.py`
- Create: `backend/app/routes/email_templates.py`
- Modify: `backend/main.py` (import + register router)
- Modify: `backend/app/routes/campaigns.py` (add `_replace_tags` + call in `_do_send`)

**Step 1: Create schema**

```python
# backend/app/schemas/email_template.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class EmailTemplateCreate(BaseModel):
    name: str
    category: str
    body_html: str


class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    body_html: Optional[str] = None


class EmailTemplateResponse(BaseModel):
    id: int
    name: str
    category: str
    is_preset: bool
    body_html: str
    created_at: datetime

    class Config:
        from_attributes = True
```

**Step 2: Create routes file**

```python
# backend/app/routes/email_templates.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.email_template import EmailTemplate
from app.schemas.email_template import EmailTemplateCreate, EmailTemplateUpdate, EmailTemplateResponse
from app.dependencies import get_current_user
from app.models.user import User

router = APIRouter(prefix="/email-templates", tags=["email-templates"])


@router.get("/", response_model=List[EmailTemplateResponse])
def list_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(EmailTemplate).order_by(
        EmailTemplate.is_preset.desc(), EmailTemplate.created_at.desc()
    ).all()


@router.get("/{template_id}", response_model=EmailTemplateResponse)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t


@router.post("/", response_model=EmailTemplateResponse)
def create_template(
    data: EmailTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    t = EmailTemplate(**data.model_dump(), is_preset=False)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/{template_id}", response_model=EmailTemplateResponse)
def update_template(
    template_id: int,
    data: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if t.is_preset:
        raise HTTPException(status_code=400, detail="Cannot edit preset templates")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(t, key, value)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if t.is_preset:
        raise HTTPException(status_code=400, detail="Cannot delete preset templates")
    db.delete(t)
    db.commit()
    return {"status": "deleted"}
```

**Step 3: Register router in main.py**

After `from app.routes.campaigns import router as campaigns_router`, add:
```python
from app.routes.email_templates import router as email_templates_router
```

After `app.include_router(campaigns_router)`, add:
```python
app.include_router(email_templates_router)
```

**Step 4: Add merge tag replacement in campaigns.py**

Add this helper function in `campaigns.py` (before `_do_send`):

```python
def _replace_tags(html: str, lead) -> str:
    """Replace {{merge_tags}} with lead data."""
    name_parts = (lead.name or "").split()
    replacements = {
        "{{first_name}}": name_parts[0] if name_parts else "",
        "{{last_name}}": " ".join(name_parts[1:]) if len(name_parts) > 1 else "",
        "{{email}}": lead.email or "",
        "{{company}}": lead.company or "",
        "{{unsubscribe_link}}": "#unsubscribe",
    }
    for tag, value in replacements.items():
        html = html.replace(tag, value)
    return html
```

In `_do_send`, update the `tracked_body` line from:
```python
tracked_body = campaign.body_html + f'<img src="{pixel_url}" ...'
```
to:
```python
personalized_body = _replace_tags(campaign.body_html, lead)
tracked_body = personalized_body + f'<img src="{pixel_url}" width="1" height="1" style="display:none" />'
```

**Step 5: Commit**
```bash
git add backend/app/schemas/email_template.py backend/app/routes/email_templates.py backend/main.py backend/app/routes/campaigns.py
git commit -m "feat: add email templates CRUD routes and merge tag personalization"
```

---

### Task 4: Frontend — EmailEditor component (Tiptap + merge tag toolbar)

**Files:**
- Create: `frontend/components/EmailEditor.tsx`

**Step 1: Create component**

```tsx
// frontend/components/EmailEditor.tsx
'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useEffect } from 'react'

const MERGE_TAGS = [
  { label: 'First Name', tag: '{{first_name}}' },
  { label: 'Last Name', tag: '{{last_name}}' },
  { label: 'Email', tag: '{{email}}' },
  { label: 'Company', tag: '{{company}}' },
  { label: 'Unsubscribe', tag: '{{unsubscribe_link}}' },
]

interface EmailEditorProps {
  content: string
  onChange: (html: string) => void
}

function ToolBtn({ onClick, active, title, children }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}

export default function EmailEditor({ content, onChange }: EmailEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    content: content || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Sync when external content changes (e.g. template selected)
  useEffect(() => {
    if (!editor || !content) return
    if (editor.getHTML() === content) return
    editor.commands.setContent(content, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  if (!editor) return null

  const div = <span className="w-px h-5 bg-gray-200 mx-0.5 flex-shrink-0" />

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
      {/* Merge tags */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-indigo-50 border-b border-indigo-100">
        <span className="text-xs font-semibold text-indigo-600 mr-1 flex-shrink-0">Insert:</span>
        {MERGE_TAGS.map(({ label, tag }) => (
          <button
            key={tag}
            type="button"
            onClick={() => editor.chain().focus().insertContent(tag).run()}
            title={label}
            className="px-2 py-0.5 bg-white border border-indigo-200 rounded text-xs text-indigo-700 hover:bg-indigo-100 font-mono transition-colors"
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Formatting toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <strong>B</strong>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <em>I</em>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strike">
          <s>S</s>
        </ToolBtn>
        {div}
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="H2">H2</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="H3">H3</ToolBtn>
        {div}
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">• List</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">1. List</ToolBtn>
        {div}
        <ToolBtn
          onClick={() => {
            const url = window.prompt('Link URL:')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          title="Add link"
        >🔗</ToolBtn>
        {editor.isActive('link') && (
          <ToolBtn onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">🔗✕</ToolBtn>
        )}
        {div}
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo">↩</ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo">↪</ToolBtn>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className={[
          'min-h-[300px] max-h-[500px] overflow-y-auto p-4 bg-white text-sm',
          '[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[280px]',
          '[&_.ProseMirror_p]:mb-2',
          '[&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2',
          '[&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
          '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:ml-5 [&_.ProseMirror_ul]:mb-2',
          '[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:ml-5 [&_.ProseMirror_ol]:mb-2',
          '[&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline',
        ].join(' ')}
      />
    </div>
  )
}
```

**Step 2: Commit**
```bash
git add frontend/components/EmailEditor.tsx
git commit -m "feat: add EmailEditor component with merge tag toolbar"
```

---

### Task 5: Frontend — EmailTemplateGallery modal component

**Files:**
- Create: `frontend/components/EmailTemplateGallery.tsx`

**Step 1: Create component**

```tsx
// frontend/components/EmailTemplateGallery.tsx
'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface Template {
  id: number
  name: string
  category: string
  is_preset: boolean
  body_html: string
}

const CATEGORY_LABELS: Record<string, string> = {
  newsletter: 'Newsletter',
  promotional: 'Promotional',
  welcome: 'Welcome',
  followup: 'Follow-up',
}

const CATEGORY_COLORS: Record<string, string> = {
  newsletter: 'bg-indigo-100 text-indigo-700',
  promotional: 'bg-purple-100 text-purple-700',
  welcome: 'bg-green-100 text-green-700',
  followup: 'bg-blue-100 text-blue-700',
}

interface Props {
  onSelect: (html: string) => void
  trigger?: React.ReactNode
}

export default function EmailTemplateGallery({ onSelect, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [tab, setTab] = useState<'presets' | 'custom'>('presets')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<Template | null>(null)

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/email-templates/`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      setTemplates(res.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    if (open) fetchTemplates()
  }, [open])

  const presets = templates.filter(t => t.is_preset)
  const custom = templates.filter(t => !t.is_preset)
  const displayed = tab === 'presets' ? presets : custom

  const handleSelect = (t: Template) => {
    onSelect(t.body_html)
    setOpen(false)
    setPreview(null)
  }

  return (
    <>
      {/* Trigger */}
      <div onClick={() => setOpen(true)} className="inline-block cursor-pointer">
        {trigger ?? (
          <button
            type="button"
            className="px-4 py-2 border border-indigo-300 text-indigo-700 bg-indigo-50 rounded-lg text-sm hover:bg-indigo-100 font-medium transition-colors"
          >
            📨 Choose Template
          </button>
        )}
      </div>

      {/* Modal backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Choose Email Template</h2>
                <p className="text-xs text-gray-400 mt-0.5">Select a template to pre-fill the editor, then customize it.</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-6 pt-4 border-b">
              {(['presets', 'custom'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                    tab === t
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t === 'presets' ? `Presets (${presets.length})` : `My Templates (${custom.length})`}
                </button>
              ))}
              <div className="ml-auto pb-2">
                <a href="/admin/email-templates/new" target="_blank" className="text-xs text-indigo-600 hover:underline">+ Create new template</a>
              </div>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Grid */}
              <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                  <div className="flex justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                  </div>
                ) : displayed.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <p className="text-lg mb-2">{tab === 'custom' ? '📭' : '📭'}</p>
                    <p>{tab === 'custom' ? 'No custom templates yet.' : 'No presets found.'}</p>
                    {tab === 'custom' && (
                      <a href="/admin/email-templates/new" target="_blank" className="mt-3 inline-block text-indigo-600 text-sm hover:underline">Create your first template →</a>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {displayed.map(t => (
                      <div
                        key={t.id}
                        onClick={() => setPreview(t)}
                        className={`rounded-xl border-2 cursor-pointer transition-all overflow-hidden ${
                          preview?.id === t.id ? 'border-indigo-500 shadow-md' : 'border-gray-200 hover:border-indigo-300 hover:shadow'
                        }`}
                      >
                        {/* HTML preview thumbnail */}
                        <div className="h-40 bg-gray-50 overflow-hidden relative">
                          <iframe
                            srcDoc={t.body_html}
                            sandbox="allow-same-origin"
                            className="w-full border-none pointer-events-none"
                            style={{
                              height: '600px',
                              transform: 'scale(0.27)',
                              transformOrigin: 'top left',
                              width: '370%',
                            }}
                            title={t.name}
                          />
                        </div>
                        <div className="p-3">
                          <p className="font-medium text-sm text-gray-900 truncate">{t.name}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[t.category] || 'bg-gray-100 text-gray-600'}`}>
                              {CATEGORY_LABELS[t.category] || t.category}
                            </span>
                            {t.is_preset && <span className="text-xs text-gray-400">Preset</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview pane */}
              {preview && (
                <div className="w-80 border-l bg-gray-50 flex flex-col">
                  <div className="px-4 py-3 border-b bg-white">
                    <p className="font-semibold text-sm text-gray-900">{preview.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{CATEGORY_LABELS[preview.category]}</p>
                  </div>
                  <div className="flex-1 overflow-hidden p-2">
                    <iframe
                      srcDoc={preview.body_html}
                      sandbox="allow-same-origin"
                      className="w-full h-full border-none rounded"
                      title={`Preview: ${preview.name}`}
                    />
                  </div>
                  <div className="p-4 border-t bg-white">
                    <button
                      onClick={() => handleSelect(preview)}
                      className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
                    >
                      Use This Template →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t flex justify-between items-center bg-gray-50">
              <button
                type="button"
                onClick={() => { onSelect('<p></p>'); setOpen(false) }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Start with blank email
              </button>
              <button onClick={() => setOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

**Step 2: Commit**
```bash
git add frontend/components/EmailTemplateGallery.tsx
git commit -m "feat: add EmailTemplateGallery modal with thumbnail previews"
```

---

### Task 6: Frontend — /admin/email-templates management pages + AdminNav link

**Files:**
- Create: `frontend/app/admin/email-templates/page.tsx`
- Create: `frontend/app/admin/email-templates/new/page.tsx`
- Create: `frontend/app/admin/email-templates/[id]/edit/page.tsx`
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: List page**

```tsx
// frontend/app/admin/email-templates/page.tsx
"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const CATEGORY_COLORS: Record<string, string> = {
  newsletter: "bg-indigo-100 text-indigo-700",
  promotional: "bg-purple-100 text-purple-700",
  welcome: "bg-green-100 text-green-700",
  followup: "bg-blue-100 text-blue-700",
};

export default function EmailTemplatesPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = async () => {
    try {
      const res = await axios.get(`${API_URL}/email-templates/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTemplates(res.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetch(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this template?")) return;
    try {
      await axios.delete(`${API_URL}/email-templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTemplates(ts => ts.filter(t => t.id !== id));
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Email Templates</h1>
            <p className="text-sm text-gray-400 mt-0.5">Reusable templates for campaigns</p>
          </div>
          <a href="/admin/email-templates/new" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            + New Template
          </a>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-5">
            {templates.map(t => (
              <div key={t.id} className="bg-white rounded-xl shadow overflow-hidden">
                {/* Preview thumbnail */}
                <div className="h-44 bg-gray-50 overflow-hidden relative">
                  <iframe
                    srcDoc={t.body_html}
                    sandbox="allow-same-origin"
                    className="w-full border-none pointer-events-none"
                    style={{ height: "600px", transform: "scale(0.3)", transformOrigin: "top left", width: "333%" }}
                    title={t.name}
                  />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                    {t.is_preset && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Preset</span>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[t.category] || "bg-gray-100 text-gray-600"}`}>
                    {t.category}
                  </span>
                  {!t.is_preset && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                      <a href={`/admin/email-templates/${t.id}/edit`} className="text-xs text-indigo-600 hover:underline">Edit</a>
                      <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
```

**Step 2: New template page**

```tsx
// frontend/app/admin/email-templates/new/page.tsx
"use client";

import { useState } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import EmailEditor from "@/components/EmailEditor";
import { useRouter } from "next/navigation";

const CATEGORIES = ["newsletter", "promotional", "welcome", "followup"];

export default function NewTemplatePage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", category: "newsletter", body_html: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.body_html) { setError("Name and body are required."); return; }
    setSaving(true);
    try {
      await axios.post(`${API_URL}/email-templates/`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push("/admin/email-templates");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-4xl">
        <a href="/admin/email-templates" className="text-gray-400 hover:text-gray-600 text-sm">← Templates</a>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2 mb-6">New Template</h1>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Template Name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Q1 Newsletter" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Body *</label>
              <EmailEditor content={form.body_html} onChange={html => setForm(prev => ({ ...prev, body_html: html }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : "Save Template"}
            </button>
            <a href="/admin/email-templates" className="px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</a>
          </div>
        </form>
      </main>
    </div>
  );
}
```

**Step 3: Edit template page**

```tsx
// frontend/app/admin/email-templates/[id]/edit/page.tsx
"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import EmailEditor from "@/components/EmailEditor";
import { useRouter, useParams } from "next/navigation";

const CATEGORIES = ["newsletter", "promotional", "welcome", "followup"];

export default function EditTemplatePage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const router = useRouter();
  const { id } = useParams();
  const [form, setForm] = useState({ name: "", category: "newsletter", body_html: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    axios.get(`${API_URL}/email-templates/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setForm({ name: res.data.name, category: res.data.category, body_html: res.data.body_html }))
      .catch(() => setError("Failed to load template"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.body_html) { setError("Name and body are required."); return; }
    setSaving(true);
    try {
      await axios.patch(`${API_URL}/email-templates/${id}`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push("/admin/email-templates");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save");
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
    </div>
  );

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-4xl">
        <a href="/admin/email-templates" className="text-gray-400 hover:text-gray-600 text-sm">← Templates</a>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2 mb-6">Edit Template</h1>
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Template Name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Body *</label>
              <EmailEditor content={form.body_html} onChange={html => setForm(prev => ({ ...prev, body_html: html }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <a href="/admin/email-templates" className="px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</a>
          </div>
        </form>
      </main>
    </div>
  );
}
```

**Step 4: Add to AdminNav — in the Marketing group, add Email Templates link**

In `frontend/components/AdminNav.tsx`, update the Marketing group:

```ts
{
    label: 'Marketing',
    items: [
        { href: '/admin/email-templates', label: 'Email Templates', icon: '🎨' },
        { href: '/admin/campaigns', label: 'Email Campaigns', icon: '📨', permission: () => hasAdminFeature('manage_billing') },
    ],
},
```

**Step 5: Commit**
```bash
git add frontend/app/admin/email-templates/ frontend/components/AdminNav.tsx
git commit -m "feat: add email templates management pages and nav link"
```

---

### Task 7: Frontend — Campaign new/edit: replace textarea with gallery picker + EmailEditor

**Files:**
- Modify: `frontend/app/admin/campaigns/new/page.tsx`
- Modify: `frontend/app/admin/campaigns/[id]/edit/page.tsx`

**Step 1: Update new campaign page**

Add imports at top:
```tsx
import EmailEditor from "@/components/EmailEditor";
import EmailTemplateGallery from "@/components/EmailTemplateGallery";
```

Replace the "Email Body (HTML) *" `<div>` block (textarea section) with:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-600 mb-2">Email Body *</label>
  <div className="mb-3">
    <EmailTemplateGallery
      onSelect={html => setForm(prev => ({ ...prev, body_html: html }))}
    />
    <span className="ml-2 text-xs text-gray-400">or start with the editor below</span>
  </div>
  <EmailEditor
    content={form.body_html}
    onChange={html => setForm(prev => ({ ...prev, body_html: html }))}
  />
  <p className="text-xs text-gray-400 mt-1">A tracking pixel is automatically appended when sent.</p>
</div>
```

**Step 2: Update edit campaign page**

Check if `frontend/app/admin/campaigns/[id]/edit/page.tsx` exists (it should from the previous session). Apply the same changes:
- Add the same two imports
- Replace the textarea with EmailTemplateGallery + EmailEditor

If the edit page does not exist, create it by copying `new/page.tsx`, then:
- Add `useParams` import and `const { id } = useParams()`
- Add `useEffect` to load existing campaign data via `GET /campaigns/{id}` and pre-fill `form`
- Change submit to `PATCH /campaigns/{id}` instead of `POST /campaigns`

**Step 3: Commit**
```bash
git add frontend/app/admin/campaigns/
git commit -m "feat: replace campaign textarea with template gallery + EmailEditor"
```

---

### Task 8: Frontend — Campaign stats: location/device columns + summary

**Files:**
- Modify: `frontend/app/admin/campaigns/[id]/page.tsx`

**Step 1: Update the recipients table headers**

Change the `["Name", "Email", "Sent At", "Opened", "Open Count"]` array to:
```tsx
["Name", "Email", "Sent At", "Opened", "Opens", "Country", "Device", "Client"]
```

**Step 2: Update each recipient row — add the 3 new cells**

After the existing `<td>` for `open_count`, add:
```tsx
<td className="px-4 py-3 text-gray-500">
  {r.country ? <span title={r.city || ""}>{r.country}</span> : <span className="text-gray-300">—</span>}
</td>
<td className="px-4 py-3">
  {r.device_type ? (
    <span className="text-sm">
      {r.device_type === 'mobile' ? '📱' : r.device_type === 'tablet' ? '📲' : '💻'}
      <span className="ml-1 text-gray-500 capitalize">{r.device_type}</span>
    </span>
  ) : <span className="text-gray-300">—</span>}
</td>
<td className="px-4 py-3 text-gray-500 text-xs">{r.email_client || '—'}</td>
```

**Step 3: Add device summary above the table**

Before the table `<div>`, add a summary row that calculates device percentages from `stats.recipients`:

```tsx
{/* Device breakdown summary */}
{stats?.recipients && stats.recipients.length > 0 && (() => {
  const opened = stats.recipients.filter((r: any) => r.opened_at)
  const mobile = opened.filter((r: any) => r.device_type === 'mobile').length
  const desktop = opened.filter((r: any) => r.device_type === 'desktop').length
  const tablet = opened.filter((r: any) => r.device_type === 'tablet').length
  const total = opened.length || 1
  return opened.length > 0 ? (
    <div className="bg-white rounded-lg shadow p-5 mb-6 flex gap-6 items-center">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opens by Device</p>
      <span className="text-sm">📱 Mobile <strong>{Math.round(mobile / total * 100)}%</strong></span>
      <span className="text-sm">💻 Desktop <strong>{Math.round(desktop / total * 100)}%</strong></span>
      {tablet > 0 && <span className="text-sm">📲 Tablet <strong>{Math.round(tablet / total * 100)}%</strong></span>}
    </div>
  ) : null
})()}
```

**Step 4: Commit**
```bash
git add frontend/app/admin/campaigns/
git commit -m "feat: add location, device, and email client columns to campaign stats"
```
