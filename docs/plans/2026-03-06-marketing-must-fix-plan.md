# Marketing Must-Fix Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add unsubscribe compliance, bounce handling, and test email endpoint to the marketing module.

**Architecture:** New `EmailSuppression` model tracks unsubscribed/bounced emails. Campaign send logic filters suppressed emails and handles SMTP errors. Public endpoints serve unsubscribe/resubscribe landing pages. A new admin page shows the suppression list.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL, Next.js 14, TailwindCSS

---

### Task 1: Create EmailSuppression Model

**Files:**
- Create: `backend/app/models/email_suppression.py`

**Step 1: Create the model file**

```python
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class EmailSuppression(Base):
    __tablename__ = "email_suppressions"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    reason = Column(String(50), nullable=False)  # unsubscribed | bounced | complaint
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="SET NULL"), nullable=True)
    unsubscribed_at = Column(DateTime(timezone=True), server_default=func.now())
    resubscribed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

**Step 2: Register in `backend/app/models/__init__.py`**

Add import line after the campaign import (line 12):
```python
from .email_suppression import EmailSuppression
```

Add `"EmailSuppression"` to the `__all__` list.

**Step 3: Add inline migration in `backend/main.py`**

Before the final `conn.commit()` at line 1333, add:
```python
        # Email suppression list (unsubscribe + bounce management)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_suppressions (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                reason VARCHAR(50) NOT NULL,
                campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
                unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
                resubscribed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_email_suppressions_email
            ON email_suppressions(email)
        """))
        -- CampaignRecipient status column for bounce tracking
        conn.execute(text(
            "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'sent'"
        ))
```

**Step 4: Add `status` column to CampaignRecipient model**

In `backend/app/models/campaign.py`, add after `open_count` (line 37):
```python
    status = Column(String(50), default="sent")  # sent | bounced | failed
```

**Step 5: Import model in `main.py`**

Add after the `CampaignEmailTemplate` import (line 20):
```python
from app.models.email_suppression import EmailSuppression  # noqa: F401
```

**Step 6: Commit**

```bash
git add backend/app/models/email_suppression.py backend/app/models/__init__.py backend/app/models/campaign.py backend/main.py
git commit -m "feat(marketing): add EmailSuppression model and CampaignRecipient status column"
```

---

### Task 2: Create Pydantic Schemas for Suppression

**Files:**
- Create: `backend/app/schemas/email_suppression.py`

**Step 1: Create the schema file**

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SuppressionResponse(BaseModel):
    id: int
    email: str
    reason: str
    campaign_id: Optional[int] = None
    unsubscribed_at: Optional[datetime] = None
    resubscribed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SendTestRequest(BaseModel):
    subject: str
    body_html: str
    to_email: str
```

**Step 2: Commit**

```bash
git add backend/app/schemas/email_suppression.py
git commit -m "feat(marketing): add suppression and send-test Pydantic schemas"
```

---

### Task 3: Add Unsubscribe Token Helpers

**Files:**
- Modify: `backend/app/routes/campaigns.py` (top of file, after imports)

**Step 1: Add HMAC token generation and verification functions**

After the existing imports (line 17), add:
```python
import hmac
import hashlib

from app.config import settings
from app.models.email_suppression import EmailSuppression
from app.schemas.email_suppression import SendTestRequest


def _make_unsub_token(email: str, campaign_id: int) -> str:
    """Create HMAC-signed unsubscribe token: base64url(email:campaign_id:signature)."""
    payload = f"{email}:{campaign_id}"
    sig = hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    token = base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()
    return token


def _verify_unsub_token(token: str) -> tuple[str, int] | None:
    """Verify and decode unsubscribe token. Returns (email, campaign_id) or None."""
    try:
        decoded = base64.urlsafe_b64decode(token).decode()
        parts = decoded.rsplit(":", 2)
        if len(parts) != 3:
            return None
        email, campaign_id_str, sig = parts
        payload = f"{email}:{campaign_id_str}"
        expected = hmac.new(settings.secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected):
            return None
        return email, int(campaign_id_str)
    except Exception:
        return None
```

**Step 2: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add HMAC unsubscribe token helpers"
```

---

### Task 4: Add Unsubscribe & Resubscribe Endpoints

**Files:**
- Modify: `backend/app/routes/campaigns.py` (add to `public_router`)

**Step 1: Add unsubscribe endpoint**

After the `track_open` route (after line 222), add:
```python
from fastapi.responses import HTMLResponse


@public_router.get("/unsubscribe/{token}")
def unsubscribe(token: str, db: Session = Depends(get_db)):
    """One-click unsubscribe — decodes token, suppresses email, shows landing page."""
    result = _verify_unsub_token(token)
    if not result:
        return HTMLResponse(content=_unsub_page("Invalid or expired link.", token, error=True), status_code=400)

    email, campaign_id = result

    existing = db.query(EmailSuppression).filter(EmailSuppression.email == email).first()
    if existing:
        existing.unsubscribed_at = datetime.utcnow()
        existing.resubscribed_at = None
        existing.reason = "unsubscribed"
    else:
        db.add(EmailSuppression(
            email=email,
            reason="unsubscribed",
            campaign_id=campaign_id,
        ))
    db.commit()

    return HTMLResponse(content=_unsub_page("You've been unsubscribed.", token))


@public_router.post("/resubscribe")
def resubscribe(token: str, db: Session = Depends(get_db)):
    """Re-subscribe — sets resubscribed_at so the email is no longer suppressed."""
    result = _verify_unsub_token(token)
    if not result:
        return HTMLResponse(content=_unsub_page("Invalid or expired link.", token, error=True), status_code=400)

    email, _ = result
    sup = db.query(EmailSuppression).filter(EmailSuppression.email == email).first()
    if sup:
        sup.resubscribed_at = datetime.utcnow()
        db.commit()

    return HTMLResponse(content=_unsub_page("Welcome back! You've been re-subscribed.", token, resubscribed=True))
```

**Step 2: Add HTML landing page helper**

Before the unsubscribe endpoint, add:
```python
def _unsub_page(message: str, token: str, error: bool = False, resubscribed: bool = False) -> str:
    color = "#ef4444" if error else ("#10b981" if resubscribed else "#3b82f6")
    button = "" if error or resubscribed else f"""
        <form method="POST" action="/campaigns/resubscribe?token={token}">
            <button type="submit" style="margin-top:24px;padding:12px 32px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;">
                Changed your mind? Re-subscribe
            </button>
        </form>
    """
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Email Preferences</title></head>
    <body style="margin:0;padding:40px 20px;font-family:Arial,sans-serif;background:#f9fafb;text-align:center;">
        <div style="max-width:480px;margin:80px auto;background:#fff;border-radius:12px;padding:48px 32px;box-shadow:0 2px 8px rgba(0,0,0,.06);">
            <div style="width:64px;height:64px;border-radius:50%;background:{color};margin:0 auto 24px;display:flex;align-items:center;justify-content:center;">
                <span style="color:#fff;font-size:28px;">{'!' if error else '✓'}</span>
            </div>
            <h1 style="font-size:22px;color:#1f2937;margin:0 0 12px;">{message}</h1>
            <p style="font-size:14px;color:#6b7280;margin:0;">{'Please try again or contact support.' if error else ("You won't receive campaign emails from us anymore." if not resubscribed else "You'll continue receiving our campaign emails.")}</p>
            {button}
        </div>
    </body></html>"""
```

**Step 3: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add unsubscribe and resubscribe public endpoints with landing page"
```

---

### Task 5: Update Campaign Send Logic

**Files:**
- Modify: `backend/app/routes/campaigns.py` — `_build_audience` and `_do_send` functions

**Step 1: Update `_build_audience` to exclude suppressed emails**

Replace the `_build_audience` function (lines 94-103):
```python
def _build_audience(db: Session, target_filter: dict) -> list:
    """Return leads matching the campaign's target_filter, excluding suppressed emails."""
    # Get actively suppressed emails
    suppressed_q = db.query(EmailSuppression.email).filter(
        (EmailSuppression.resubscribed_at.is_(None)) |
        (EmailSuppression.resubscribed_at < EmailSuppression.unsubscribed_at)
    )
    suppressed_emails = {row[0] for row in suppressed_q.all()}

    query = db.query(Lead).filter(Lead.email.isnot(None))
    statuses = target_filter.get("statuses", [])
    sources = target_filter.get("sources", [])
    if statuses:
        query = query.filter(Lead.status.in_(statuses))
    if sources:
        query = query.filter(Lead.source.in_(sources))

    leads = query.all()
    return [lead for lead in leads if lead.email not in suppressed_emails]
```

**Step 2: Update `_replace_tags` to accept unsubscribe URL**

Replace the `_replace_tags` function (lines 106-118):
```python
def _replace_tags(html: str, lead, unsub_url: str = "#unsubscribe") -> str:
    """Replace {{merge_tags}} with lead data for personalized emails."""
    name_parts = (lead.name or "").split()
    replacements = {
        "{{first_name}}": name_parts[0] if name_parts else "",
        "{{last_name}}": " ".join(name_parts[1:]) if len(name_parts) > 1 else "",
        "{{email}}": lead.email or "",
        "{{company}}": lead.company or "",
        "{{unsubscribe_link}}": unsub_url,
    }
    for tag, value in replacements.items():
        html = html.replace(tag, value)
    return html
```

**Step 3: Update `_do_send` for bounce handling and unsubscribe links**

In the `_do_send` function, update the for-loop body (lines 142-180). Replace it with:
```python
    import smtplib

    for lead in audience:
        try:
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
                    status="sent",
                )
                db.add(recipient)
                db.flush()

            # Build per-recipient unsubscribe URL
            unsub_token = _make_unsub_token(lead.email, campaign_id)
            unsub_url = f"{base_url}/campaigns/unsubscribe/{unsub_token}"

            pixel_url = f"{base_url}/campaigns/track/open/{campaign_id}/{recipient.id}"
            personalized_body = _replace_tags(campaign.body_html, lead, unsub_url)
            tracked_body = personalized_body + f'<img src="{pixel_url}" width="1" height="1" style="display:none" />'

            msg = MIMEMultipart("alternative")
            msg["Subject"] = campaign.subject
            msg["From"] = smtp_config.get("smtp_from_email", "no-reply@example.com")
            msg["To"] = lead.email
            # RFC 8058 one-click unsubscribe headers
            msg["List-Unsubscribe"] = f"<{unsub_url}>"
            msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
            msg.attach(MIMEText(tracked_body, "html"))

            if smtp_config.get("smtp_password"):
                with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                    if smtp_config.get("smtp_use_tls", True):
                        server.starttls()
                    server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                    server.sendmail(smtp_config["smtp_from_email"], lead.email, msg.as_string())

            recipient.sent_at = datetime.utcnow()
            recipient.status = "sent"
            sent += 1
        except smtplib.SMTPRecipientsRefused:
            # Hard bounce — auto-suppress this email
            recipient.status = "bounced"
            existing_sup = db.query(EmailSuppression).filter(EmailSuppression.email == lead.email).first()
            if not existing_sup:
                db.add(EmailSuppression(email=lead.email, reason="bounced", campaign_id=campaign_id))
            errors += 1
        except (smtplib.SMTPDataError, smtplib.SMTPServerDisconnected) as smtp_err:
            # Likely a server-side rejection or disconnect
            if hasattr(smtp_err, 'smtp_code') and smtp_err.smtp_code and smtp_err.smtp_code >= 500:
                recipient.status = "bounced"
                existing_sup = db.query(EmailSuppression).filter(EmailSuppression.email == lead.email).first()
                if not existing_sup:
                    db.add(EmailSuppression(email=lead.email, reason="bounced", campaign_id=campaign_id))
            else:
                recipient.status = "failed"
            errors += 1
        except Exception:
            recipient.status = "failed"
            errors += 1
```

Note: Also remove the existing `import smtplib` at line 132 since we moved it into the for-loop scope. Actually keep the import at the top of the function — just add the `smtplib.SMTPRecipientsRefused` etc. catches.

**Step 4: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): filter suppressed emails from audience and handle bounces during send"
```

---

### Task 6: Add Send Test Email Endpoint

**Files:**
- Modify: `backend/app/routes/campaigns.py` (add to `router`)

**Step 1: Add send-test endpoint**

After the `preview_audience` route (after line 235), add:
```python
@router.post("/send-test")
def send_test_email(
    req: SendTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send a test email with dummy merge tag data."""
    from app.services.branding_service import branding_service
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    # Replace merge tags with dummy data
    body = req.body_html
    replacements = {
        "{{first_name}}": "John",
        "{{last_name}}": "Doe",
        "{{email}}": req.to_email,
        "{{company}}": "Acme Corp",
        "{{unsubscribe_link}}": "#",
    }
    for tag, value in replacements.items():
        body = body.replace(tag, value)

    smtp_config = branding_service.get_smtp_config(db)
    if not smtp_config.get("smtp_password"):
        raise HTTPException(status_code=400, detail="SMTP not configured. Set up email in Admin > Branding.")

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[TEST] {req.subject}"
        msg["From"] = smtp_config.get("smtp_from_email", "no-reply@example.com")
        msg["To"] = req.to_email
        msg.attach(MIMEText(body, "html"))

        with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
            if smtp_config.get("smtp_use_tls", True):
                server.starttls()
            server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
            server.sendmail(smtp_config["smtp_from_email"], req.to_email, msg.as_string())

        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**IMPORTANT:** This route must be placed BEFORE the `/{campaign_id}` wildcard routes, otherwise FastAPI will try to parse "send-test" as a campaign_id integer. Place it right after `/preview-audience`.

**Step 2: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add POST /campaigns/send-test endpoint"
```

---

### Task 7: Add Suppression List Admin Endpoints

**Files:**
- Modify: `backend/app/routes/campaigns.py` (add to `router`)

**Step 1: Add suppression list endpoints**

After the send-test route, add:
```python
@router.get("/suppression-list")
def list_suppressed(
    search: str = "",
    reason: str = "",
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List suppressed emails with optional search and filter."""
    query = db.query(EmailSuppression).filter(
        (EmailSuppression.resubscribed_at.is_(None)) |
        (EmailSuppression.resubscribed_at < EmailSuppression.unsubscribed_at)
    )
    if search:
        query = query.filter(EmailSuppression.email.ilike(f"%{search}%"))
    if reason:
        query = query.filter(EmailSuppression.reason == reason)

    total = query.count()
    items = query.order_by(desc(EmailSuppression.unsubscribed_at)).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": s.id,
                "email": s.email,
                "reason": s.reason,
                "campaign_id": s.campaign_id,
                "unsubscribed_at": s.unsubscribed_at,
                "created_at": s.created_at,
            }
            for s in items
        ],
    }


@router.delete("/suppression-list/{suppression_id}")
def remove_suppression(
    suppression_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove an email from the suppression list (admin action)."""
    sup = db.query(EmailSuppression).filter(EmailSuppression.id == suppression_id).first()
    if not sup:
        raise HTTPException(status_code=404, detail="Suppression entry not found")
    db.delete(sup)
    db.commit()
    return {"status": "removed"}
```

**IMPORTANT:** These routes also need to be placed BEFORE the `/{campaign_id}` routes. The order should be:
1. `/preview-audience`
2. `/send-test`
3. `/suppression-list` (GET)
4. `/suppression-list/{suppression_id}` (DELETE)
5. Then all `/{campaign_id}` routes

**Step 2: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add suppression list admin endpoints"
```

---

### Task 8: Create Suppression List Admin Page

**Files:**
- Create: `frontend/app/admin/campaigns/suppression/page.tsx`

**Step 1: Create the suppression list page**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const REASON_COLORS: Record<string, string> = {
  unsubscribed: "bg-yellow-100 text-yellow-700",
  bounced: "bg-red-100 text-red-700",
  complaint: "bg-orange-100 text-orange-700",
};

export default function SuppressionListPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "50" });
      if (search) params.set("search", search);
      if (reasonFilter) params.set("reason", reasonFilter);
      const res = await axios.get(`${API_URL}/campaigns/suppression-list?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, reasonFilter, token]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleRemove = async (id: number) => {
    if (!confirm("Remove this email from the suppression list? They will receive campaigns again.")) return;
    await axios.delete(`${API_URL}/campaigns/suppression-list/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchList();
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Suppression List</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} suppressed email{total !== 1 ? "s" : ""}</p>
          </div>
          <a href="/admin/campaigns" className="text-sm text-blue-600 hover:underline">
            &larr; Back to Campaigns
          </a>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={reasonFilter}
            onChange={e => { setReasonFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All reasons</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
            <option value="complaint">Complaint</option>
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            No suppressed emails found.
          </div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {["Email", "Reason", "Suppressed At", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((s: any) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${REASON_COLORS[s.reason] || "bg-gray-100"}`}>
                          {s.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {s.unsubscribed_at ? new Date(s.unsubscribed_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleRemove(s.id)} className="text-red-600 hover:underline text-sm">
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100"
                >
                  Previous
                </button>
                <span className="px-3 py-1.5 text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/campaigns/suppression/page.tsx
git commit -m "feat(marketing): add suppression list admin page"
```

---

### Task 9: Add Suppression List Link to Campaigns Page

**Files:**
- Modify: `frontend/app/admin/campaigns/page.tsx`

**Step 1: Add link to suppression list**

In the header area (around line 70-76), after the "New Campaign" button, add a suppression list link:
```tsx
          <div className="flex gap-3">
            <a
              href="/admin/campaigns/suppression"
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              Suppression List
            </a>
            <a
              href="/admin/campaigns/new"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              + New Campaign
            </a>
          </div>
```

**Step 2: Commit**

```bash
git add frontend/app/admin/campaigns/page.tsx
git commit -m "feat(marketing): add suppression list link to campaigns page"
```

---

### Task 10: Verify All Changes Work Together

**Step 1: Start the backend**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Verify no startup errors. Check that `email_suppressions` table was created.

**Step 2: Test endpoints via Swagger**

Open http://localhost:8000/docs and verify:
- `POST /campaigns/send-test` exists and accepts `{subject, body_html, to_email}`
- `GET /campaigns/suppression-list` exists and returns `{total, page, page_size, items}`
- `DELETE /campaigns/suppression-list/{suppression_id}` exists
- `GET /campaigns/unsubscribe/{token}` exists on the public router

**Step 3: Start the frontend**

```bash
cd frontend && npm run dev
```

Verify no build errors. Navigate to `/admin/campaigns` and confirm the "Suppression List" button appears. Click it and confirm the suppression list page loads.

**Step 4: Final commit**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix(marketing): resolve any integration issues from must-fix features"
```
