# Email Campaigns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a bulk email campaign system targeting CRM leads, with open-tracking pixels, per-recipient stats, and scheduled sending via APScheduler.

**Architecture:** Two new DB tables (`campaigns`, `campaign_recipients`) created via inline SQL in `main.py`. A new `campaigns.py` router handles CRUD, send, and the tracking pixel endpoint. The existing `email_service.py` SMTP pattern is reused for sending. A new APScheduler job fires scheduled campaigns. The frontend provides a compose page (with Tiptap), audience filter, and per-campaign stats view.

**Tech Stack:** FastAPI, SQLAlchemy ORM, APScheduler, smtplib (via existing email_service), Next.js 14, TypeScript, TailwindCSS.

**Note:** No Alembic. Migrations are inline SQL in `backend/main.py` using `text()` + `IF NOT EXISTS`. No Jest. Verify manually in browser.

---

### Task 1: Add Campaign and CampaignRecipient DB models

**Files:**
- Create: `backend/app/models/campaign.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create `backend/app/models/campaign.py`**

```python
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.database import Base


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    # status: draft | scheduled | sending | sent | failed
    status = Column(String(50), default="draft", nullable=False)
    # target_filter: {"statuses": ["new","contacted"], "sources": ["email","website"]}
    target_filter = Column(JSON, default={})
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    sent_count = Column(Integer, default=0)
    opened_count = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class CampaignRecipient(Base):
    __tablename__ = "campaign_recipients"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=True)
    email = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    opened_at = Column(DateTime(timezone=True), nullable=True)
    open_count = Column(Integer, default=0)
```

**Step 2: Register models in `backend/app/models/__init__.py`**

Add to the existing imports:
```python
from app.models.campaign import Campaign, CampaignRecipient
```

**Step 3: Add inline SQL migration in `backend/main.py`**

Find the section in `main.py` where inline SQL migrations run (look for `text("ALTER TABLE ... ADD COLUMN IF NOT EXISTS")`). Add after the last existing migration:

```python
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS campaigns (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    subject VARCHAR(500) NOT NULL,
                    body_html TEXT NOT NULL,
                    status VARCHAR(50) DEFAULT 'draft' NOT NULL,
                    target_filter JSONB DEFAULT '{}',
                    scheduled_at TIMESTAMPTZ,
                    sent_at TIMESTAMPTZ,
                    sent_count INTEGER DEFAULT 0,
                    opened_count INTEGER DEFAULT 0,
                    created_by INTEGER REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS campaign_recipients (
                    id SERIAL PRIMARY KEY,
                    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
                    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
                    email VARCHAR(255) NOT NULL,
                    name VARCHAR(255),
                    sent_at TIMESTAMPTZ,
                    opened_at TIMESTAMPTZ,
                    open_count INTEGER DEFAULT 0
                )
            """))
            conn.commit()
```

**Step 4: Verify**

Restart backend. Check logs — no error on startup. Check `http://localhost:8000/docs` — router not yet wired but backend should start cleanly.

**Step 5: Commit**

```bash
git add backend/app/models/campaign.py backend/app/models/__init__.py backend/main.py
git commit -m "feat: add Campaign and CampaignRecipient models with inline SQL migration"
```

---

### Task 2: Create campaign Pydantic schemas

**Files:**
- Create: `backend/app/schemas/campaign.py`

**Step 1: Create the file**

```python
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class CampaignCreate(BaseModel):
    name: str
    subject: str
    body_html: str
    target_filter: Optional[dict] = {}
    scheduled_at: Optional[datetime] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    body_html: Optional[str] = None
    target_filter: Optional[dict] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    subject: str
    body_html: str
    status: str
    target_filter: Optional[dict] = {}
    scheduled_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    sent_count: int
    opened_count: int
    created_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class RecipientResponse(BaseModel):
    id: int
    campaign_id: int
    lead_id: Optional[int] = None
    email: str
    name: Optional[str] = None
    sent_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    open_count: int

    class Config:
        from_attributes = True
```

**Step 2: Commit**

```bash
git add backend/app/schemas/campaign.py
git commit -m "feat: add Campaign Pydantic schemas"
```

---

### Task 3: Create campaign routes (CRUD + send + tracking pixel)

**Files:**
- Create: `backend/app/routes/campaigns.py`
- Modify: `backend/main.py` (register router)

**Step 1: Create `backend/app/routes/campaigns.py`**

```python
import os
import base64
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.database import get_db
from app.models.campaign import Campaign, CampaignRecipient
from app.models.crm import Lead
from app.models.user import User
from app.schemas.campaign import CampaignCreate, CampaignUpdate, CampaignResponse, RecipientResponse
from app.dependencies import get_current_user

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

# 1x1 transparent GIF bytes
TRACKING_PIXEL = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)


def _build_audience(db: Session, target_filter: dict) -> list[Lead]:
    """Return leads matching the campaign's target_filter."""
    query = db.query(Lead).filter(Lead.email.isnot(None))
    statuses = target_filter.get("statuses", [])
    sources = target_filter.get("sources", [])
    if statuses:
        query = query.filter(Lead.status.in_(statuses))
    if sources:
        query = query.filter(Lead.source.in_(sources))
    return query.all()


def _do_send(campaign_id: int, db: Session):
    """Core send logic — called by background task and scheduler."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign or campaign.status not in ("draft", "scheduled"):
        return

    campaign.status = "sending"
    db.commit()

    from app.services.email_service import email_service
    from app.services.branding_service import branding_service
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    smtp_config = branding_service.get_smtp_config(db)
    audience = _build_audience(db, campaign.target_filter or {})

    base_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    sent = 0
    errors = 0

    for lead in audience:
        try:
            # Create or find recipient row
            recipient = db.query(CampaignRecipient).filter(
                CampaignRecipient.campaign_id == campaign_id,
                CampaignRecipient.email == lead.email,
            ).first()
            if not recipient:
                recipient = CampaignRecipient(
                    campaign_id=campaign_id,
                    lead_id=lead.id,
                    email=lead.email,
                    name=f"{lead.first_name} {lead.last_name or ''}".strip(),
                )
                db.add(recipient)
                db.flush()  # get id

            # Inject tracking pixel into body
            pixel_url = f"{base_url}/campaigns/track/open/{campaign_id}/{recipient.id}"
            tracked_body = campaign.body_html + f'<img src="{pixel_url}" width="1" height="1" style="display:none" />'

            msg = MIMEMultipart("alternative")
            msg["Subject"] = campaign.subject
            msg["From"] = smtp_config.get("smtp_from_email", "no-reply@example.com")
            msg["To"] = lead.email
            msg.attach(MIMEText(tracked_body, "html"))

            if smtp_config.get("smtp_password"):
                with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                    if smtp_config.get("smtp_use_tls", True):
                        server.starttls()
                    server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                    server.sendmail(smtp_config["smtp_from_email"], lead.email, msg.as_string())

            recipient.sent_at = datetime.utcnow()
            sent += 1
        except Exception as e:
            errors += 1

    campaign.sent_count = sent
    campaign.sent_at = datetime.utcnow()
    campaign.status = "sent" if errors == 0 else "failed"
    db.commit()


# ===== CRUD =====

@router.post("", response_model=CampaignResponse)
def create_campaign(
    campaign: CampaignCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_campaign = Campaign(**campaign.model_dump(), created_by=current_user.id)
    db.add(db_campaign)
    db.commit()
    db.refresh(db_campaign)
    return db_campaign


@router.get("", response_model=list[CampaignResponse])
def list_campaigns(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Campaign).order_by(desc(Campaign.created_at)).all()


@router.get("/{campaign_id}", response_model=CampaignResponse)
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return c


@router.patch("/{campaign_id}", response_model=CampaignResponse)
def update_campaign(
    campaign_id: int,
    update: CampaignUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(c, field, value)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{campaign_id}")
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    db.delete(c)
    db.commit()
    return {"status": "deleted"}


# ===== AUDIENCE PREVIEW =====

@router.post("/{campaign_id}/audience-count")
def audience_count(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    leads = _build_audience(db, c.target_filter or {})
    return {"count": len(leads)}


@router.post("/preview-audience")
def preview_audience(
    filter_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Preview audience count for a target_filter before saving."""
    leads = _build_audience(db, filter_data)
    return {"count": len(leads)}


# ===== SEND =====

@router.post("/{campaign_id}/send")
def send_campaign(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if c.status == "sending":
        raise HTTPException(status_code=400, detail="Campaign is already sending")
    if c.status == "sent":
        raise HTTPException(status_code=400, detail="Campaign already sent")
    background_tasks.add_task(_do_send, campaign_id, db)
    return {"status": "sending"}


# ===== TRACKING PIXEL =====

@router.get("/track/open/{campaign_id}/{recipient_id}")
def track_open(
    campaign_id: int,
    recipient_id: int,
    db: Session = Depends(get_db),
):
    """Returns a 1x1 transparent GIF and records email open."""
    recipient = db.query(CampaignRecipient).filter(
        CampaignRecipient.id == recipient_id,
        CampaignRecipient.campaign_id == campaign_id,
    ).first()
    if recipient:
        if recipient.opened_at is None:
            recipient.opened_at = datetime.utcnow()
            # Increment campaign opened_count
            campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
            if campaign:
                campaign.opened_count = (campaign.opened_count or 0) + 1
        recipient.open_count = (recipient.open_count or 0) + 1
        db.commit()
    return Response(content=TRACKING_PIXEL, media_type="image/gif")


# ===== STATS =====

@router.get("/{campaign_id}/stats")
def get_campaign_stats(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    recipients = db.query(CampaignRecipient).filter(
        CampaignRecipient.campaign_id == campaign_id
    ).all()
    open_rate = round((c.opened_count / c.sent_count * 100), 1) if c.sent_count else 0
    return {
        "sent_count": c.sent_count,
        "opened_count": c.opened_count,
        "open_rate": open_rate,
        "recipients": [
            {
                "id": r.id,
                "email": r.email,
                "name": r.name,
                "sent_at": r.sent_at,
                "opened_at": r.opened_at,
                "open_count": r.open_count,
            }
            for r in recipients
        ],
    }
```

**Step 2: Register router in `backend/main.py`**

Find where other routers are imported and registered. Add:

```python
from app.routes.campaigns import router as campaigns_router
# ...
app.include_router(campaigns_router)
```

**Step 3: Verify**

Restart backend → go to http://localhost:8000/docs → confirm `/campaigns` endpoints appear.

**Step 4: Commit**

```bash
git add backend/app/routes/campaigns.py backend/main.py
git commit -m "feat: add campaign CRUD, send, tracking pixel, and stats endpoints"
```

---

### Task 4: Add APScheduler job for scheduled campaigns

**Files:**
- Modify: `backend/main.py`

**Step 1: Add the scheduler job function**

In `main.py`, find the section where `check_overdue_crm_tasks` is defined (the last scheduler job added). After `scheduler.add_job(check_overdue_crm_tasks, ...)`, add:

```python
        def send_scheduled_campaigns():
            """Fire campaigns whose scheduled_at has passed and status is 'scheduled'."""
            from app.models.campaign import Campaign
            from app.routes.campaigns import _do_send
            db = SessionLocal()
            try:
                now = datetime.utcnow()
                due = db.query(Campaign).filter(
                    Campaign.status == "scheduled",
                    Campaign.scheduled_at <= now,
                ).all()
                for campaign in due:
                    try:
                        _do_send(campaign.id, db)
                    except Exception as e:
                        logger.error(f"Campaign send error (id={campaign.id}): {e}")
            except Exception as e:
                logger.error(f"send_scheduled_campaigns error: {e}")
            finally:
                db.close()

        scheduler.add_job(send_scheduled_campaigns, 'interval', minutes=1, id='send_scheduled_campaigns_job')
```

**Note:** `datetime` should already be imported at the top of main.py. If not, add `from datetime import datetime`.

**Step 2: Verify**

Restart backend — no startup errors = success.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: add APScheduler job for scheduled campaign sending"
```

---

### Task 5: Add Campaigns to AdminNav

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Add campaign nav items to the Business group**

In `AdminNav.tsx`, find the `Business` group items array:

```tsx
{
    label: 'Business',
    items: [
        { href: '/admin/pricing', ... },
        { href: '/admin/usage', ... },
        { href: '/admin/crm/leads', ... },
        ...
    ]
}
```

Add after the existing CRM items:

```tsx
{ href: '/admin/campaigns', label: 'Campaigns', icon: '📨', permission: () => hasAdminFeature('feature_manage_billing') },
```

**Step 2: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: add Campaigns link to AdminNav Business group"
```

---

### Task 6: Build Campaign List Page

**Files:**
- Create: `frontend/app/admin/campaigns/page.tsx`

**Step 1: Create the file**

```tsx
"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STATUS_COLORS: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  sending:   "bg-yellow-100 text-yellow-700",
  sent:      "bg-green-100 text-green-700",
  failed:    "bg-red-100 text-red-700",
};

export default function CampaignsPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampaigns = async () => {
    try {
      const res = await axios.get(`${API_URL}/campaigns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCampaigns(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this campaign?")) return;
    await axios.delete(`${API_URL}/campaigns/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchCampaigns();
  };

  const handleSend = async (id: number) => {
    if (!confirm("Send this campaign now to all matching leads?")) return;
    try {
      await axios.post(`${API_URL}/campaigns/${id}/send`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("Campaign is sending!");
      fetchCampaigns();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to send");
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Email Campaigns</h1>
            <p className="text-sm text-gray-500 mt-0.5">{campaigns.length} total</p>
          </div>
          <a
            href="/admin/campaigns/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New Campaign
          </a>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            <p className="mb-2">No campaigns yet.</p>
            <a href="/admin/campaigns/new" className="text-blue-600 hover:underline text-sm">
              Create your first campaign
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {["Name", "Subject", "Status", "Sent", "Opened", "Open Rate", "Created", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{c.subject}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[c.status] || "bg-gray-100"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.sent_count}</td>
                    <td className="px-4 py-3 text-gray-600">{c.opened_count}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.sent_count ? `${((c.opened_count / c.sent_count) * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 text-sm">
                        <a href={`/admin/campaigns/${c.id}`} className="text-blue-600 hover:underline">Stats</a>
                        <a href={`/admin/campaigns/${c.id}/edit`} className="text-amber-600 hover:underline">Edit</a>
                        {c.status === "draft" && (
                          <button onClick={() => handleSend(c.id)} className="text-green-600 hover:underline">Send</button>
                        )}
                        <button onClick={() => handleDelete(c.id)} className="text-red-600 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/campaigns/page.tsx
git commit -m "feat: add campaign list page with send/delete actions"
```

---

### Task 7: Build Campaign Compose (New/Edit) Page

**Files:**
- Create: `frontend/app/admin/campaigns/new/page.tsx`
- Create: `frontend/app/admin/campaigns/[id]/edit/page.tsx`

**Step 1: Create `frontend/app/admin/campaigns/new/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import { useRouter } from "next/navigation";

const LEAD_STATUSES = ["new", "contacted", "qualified", "lost", "converted"];
const LEAD_SOURCES = ["conversation", "email", "website", "referral", "phone_call", "existing_client", "other"];

export default function NewCampaignPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const router = useRouter();

  const [form, setForm] = useState({
    name: "",
    subject: "",
    body_html: "",
    target_filter: { statuses: [] as string[], sources: [] as string[] },
    scheduled_at: "",
  });
  const [saving, setSaving] = useState(false);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [error, setError] = useState("");

  const previewAudience = async () => {
    try {
      const res = await axios.post(`${API_URL}/campaigns/preview-audience`, form.target_filter, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAudienceCount(res.data.count);
    } catch {}
  };

  const toggleFilter = (type: "statuses" | "sources", value: string) => {
    setForm(prev => {
      const arr = prev.target_filter[type];
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, target_filter: { ...prev.target_filter, [type]: next } };
    });
    setAudienceCount(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.subject || !form.body_html) {
      setError("Name, subject, and body are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        status: form.scheduled_at ? "scheduled" : "draft",
      };
      const res = await axios.post(`${API_URL}/campaigns`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push(`/admin/campaigns/${res.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-4xl">
        <a href="/admin/campaigns" className="text-gray-400 hover:text-gray-600 text-sm">← Campaigns</a>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2 mb-6">New Campaign</h1>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 className="font-semibold text-gray-700">Campaign Details</h2>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Campaign Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. March Newsletter"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Email Subject *</label>
              <input
                type="text"
                value={form.subject}
                onChange={e => setForm({ ...form, subject: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Special offer just for you"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Email Body (HTML) *</label>
              <textarea
                value={form.body_html}
                onChange={e => setForm({ ...form, body_html: e.target.value })}
                rows={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="<p>Hello {{name}},</p><p>Your message here...</p>"
              />
              <p className="text-xs text-gray-400 mt-1">Paste HTML email content. A tracking pixel will be automatically appended when sent.</p>
            </div>
          </div>

          {/* Audience */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 className="font-semibold text-gray-700">Target Audience</h2>
            <p className="text-xs text-gray-500">Leave all unchecked to send to all leads with an email address.</p>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Filter by Lead Status</label>
              <div className="flex flex-wrap gap-2">
                {LEAD_STATUSES.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleFilter("statuses", s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      form.target_filter.statuses.includes(s)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Filter by Lead Source</label>
              <div className="flex flex-wrap gap-2">
                {LEAD_SOURCES.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleFilter("sources", s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      form.target_filter.sources.includes(s)
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {s.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={previewAudience}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Preview Audience
              </button>
              {audienceCount !== null && (
                <span className="text-sm font-medium text-gray-700">
                  {audienceCount} lead{audienceCount !== 1 ? "s" : ""} will receive this campaign
                </span>
              )}
            </div>
          </div>

          {/* Schedule */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="font-semibold text-gray-700 mb-3">Schedule (optional)</h2>
            <p className="text-xs text-gray-500 mb-3">Leave empty to save as draft and send manually.</p>
            <input
              type="datetime-local"
              value={form.scheduled_at}
              onChange={e => setForm({ ...form, scheduled_at: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Campaign"}
            </button>
            <a href="/admin/campaigns" className="px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </a>
          </div>
        </form>
      </main>
    </div>
  );
}
```

**Step 2: Create `frontend/app/admin/campaigns/[id]/edit/page.tsx`**

This is identical to the new page but pre-populates from `GET /campaigns/{id}` and uses `PATCH` on submit. Copy the new page and:
- Add `const { id } = useParams()`
- Add a `useEffect` to fetch campaign and populate `form`
- Change submit to `axios.patch(`${API_URL}/campaigns/${id}`, ...)`
- Change heading to "Edit Campaign"

**Step 3: Commit**

```bash
git add frontend/app/admin/campaigns/new/page.tsx frontend/app/admin/campaigns/
git commit -m "feat: add campaign compose page (new + edit)"
```

---

### Task 8: Build Campaign Stats Page

**Files:**
- Create: `frontend/app/admin/campaigns/[id]/page.tsx`

**Step 1: Create the file**

```tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

export default function CampaignStatsPage() {
  const user = authAPI.getUser();
  const { id } = useParams();
  const token = getAuthToken();
  const [campaign, setCampaign] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      axios.get(`${API_URL}/campaigns/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_URL}/campaigns/${id}/stats`, { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(([cRes, sRes]) => {
      setCampaign(cRes.data);
      setStats(sRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id, token]);

  if (loading) return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
    </div>
  );

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <a href="/admin/campaigns" className="text-gray-400 hover:text-gray-600 text-sm">← Campaigns</a>
        <div className="flex justify-between items-start mt-2 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{campaign?.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{campaign?.subject}</p>
          </div>
          <a href={`/admin/campaigns/${id}/edit`} className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm">Edit</a>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-5 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Sent</p>
            <p className="text-4xl font-bold text-gray-900 mt-1">{stats?.sent_count ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Opened</p>
            <p className="text-4xl font-bold text-green-600 mt-1">{stats?.opened_count ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Open Rate</p>
            <p className="text-4xl font-bold text-indigo-600 mt-1">{stats?.open_rate ?? 0}%</p>
            <p className="text-xs text-gray-400 mt-1">Note: pixel blocking may undercount</p>
          </div>
        </div>

        {/* Per-recipient table */}
        {stats?.recipients && stats.recipients.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="font-semibold text-gray-700">Recipients</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {["Name", "Email", "Sent At", "Opened", "Open Count"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.recipients.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{r.name || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{r.email}</td>
                    <td className="px-4 py-3 text-gray-400">{r.sent_at ? new Date(r.sent_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3">
                      {r.opened_at ? (
                        <span className="text-green-600 font-medium">✓ {new Date(r.opened_at).toLocaleString()}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.open_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
```

**Step 2: Verify in browser**

1. Navigate to `/admin/campaigns` — see list
2. Click `+ New Campaign` — fill in name/subject/body, select some statuses, click Preview Audience
3. Save → redirects to stats page showing 0 sent / 0 opened
4. Click Edit to go back and modify
5. From list, click Send → confirm → campaign status changes to "sent"

**Step 3: Commit**

```bash
git add frontend/app/admin/campaigns/
git commit -m "feat: add campaign stats page with per-recipient open tracking table"
```
