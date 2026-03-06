# Marketing Nice-to-Have Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add click tracking, advanced segmentation, A/B testing, campaign attachments, and dynamic content blocks to the marketing module.

**Architecture:** New models for links/clicks, variants, and attachments extend the existing campaign system. Click tracking uses redirect-proxy pattern. A/B testing splits audience and uses a scheduler job to pick winners. Dynamic content uses Handlebars-style blocks processed server-side before merge tags. All features build on the existing `_do_send` pipeline.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL, Next.js 14, TailwindCSS, Tiptap

---

## Feature 1: Click Tracking

### Task 1: Create CampaignLink and CampaignClick Models

**Files:**
- Create: `backend/app/models/campaign_link.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/campaign.py`
- Modify: `backend/main.py`

**Step 1: Create the model file**

```python
# backend/app/models/campaign_link.py
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class CampaignLink(Base):
    __tablename__ = "campaign_links"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    original_url = Column(Text, nullable=False)
    click_count = Column(Integer, default=0)
    first_clicked_at = Column(DateTime(timezone=True), nullable=True)
    last_clicked_at = Column(DateTime(timezone=True), nullable=True)


class CampaignClick(Base):
    __tablename__ = "campaign_clicks"

    id = Column(Integer, primary_key=True, index=True)
    link_id = Column(Integer, ForeignKey("campaign_links.id", ondelete="CASCADE"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("campaign_recipients.id", ondelete="CASCADE"), nullable=False)
    clicked_at = Column(DateTime(timezone=True), server_default=func.now())
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
```

**Step 2: Add `clicked_count` to Campaign and `clicked_at` to CampaignRecipient**

In `backend/app/models/campaign.py`:
- After `opened_count` (line 20): add `clicked_count = Column(Integer, default=0)`
- After `status` in CampaignRecipient (line 37): add `clicked_at = Column(DateTime(timezone=True), nullable=True)`

**Step 3: Register in `__init__.py`**

Add `from .campaign_link import CampaignLink, CampaignClick` and add both to `__all__`.

**Step 4: Add inline migration in `main.py`**

Before the final `conn.commit()` in `_run_inline_migrations`, add:
```python
        # Click tracking tables
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS campaign_links (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
                original_url TEXT NOT NULL,
                click_count INTEGER DEFAULT 0,
                first_clicked_at TIMESTAMPTZ,
                last_clicked_at TIMESTAMPTZ
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS campaign_clicks (
                id SERIAL PRIMARY KEY,
                link_id INTEGER REFERENCES campaign_links(id) ON DELETE CASCADE,
                recipient_id INTEGER REFERENCES campaign_recipients(id) ON DELETE CASCADE,
                clicked_at TIMESTAMPTZ DEFAULT NOW(),
                ip_address VARCHAR(45),
                user_agent TEXT
            )
        """))
        conn.execute(text("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS clicked_count INTEGER DEFAULT 0"))
        conn.execute(text("ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ"))
```

Also add the model import at top of `main.py`:
```python
from app.models.campaign_link import CampaignLink, CampaignClick  # noqa: F401
```

**Step 5: Commit**

```bash
git add backend/app/models/campaign_link.py backend/app/models/__init__.py backend/app/models/campaign.py backend/main.py
git commit -m "feat(marketing): add CampaignLink and CampaignClick models for click tracking"
```

---

### Task 2: Add Click Tracking Redirect Endpoint and Link Rewriting

**Files:**
- Modify: `backend/app/routes/campaigns.py`

**Step 1: Add click tracking endpoint to `public_router`**

After the resubscribe endpoint, add:
```python
@public_router.get("/track/click/{campaign_id}/{link_id}/{recipient_id}")
def track_click(
    campaign_id: int,
    link_id: int,
    recipient_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """Log click and 302-redirect to original URL."""
    from fastapi.responses import RedirectResponse
    from app.models.campaign_link import CampaignLink, CampaignClick

    link = db.query(CampaignLink).filter(
        CampaignLink.id == link_id,
        CampaignLink.campaign_id == campaign_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    # Log click
    click = CampaignClick(
        link_id=link_id,
        recipient_id=recipient_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", ""),
    )
    db.add(click)

    # Update link stats
    link.click_count = (link.click_count or 0) + 1
    now = datetime.utcnow()
    if not link.first_clicked_at:
        link.first_clicked_at = now
    link.last_clicked_at = now

    # Update recipient first-click
    recipient = db.query(CampaignRecipient).filter(CampaignRecipient.id == recipient_id).first()
    if recipient and not recipient.clicked_at:
        recipient.clicked_at = now
        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        if campaign:
            campaign.clicked_count = (campaign.clicked_count or 0) + 1

    db.commit()
    return RedirectResponse(url=link.original_url, status_code=302)
```

**Step 2: Add link rewriting function**

Before `_do_send`, add:
```python
import re as _re

def _rewrite_links(html: str, campaign_id: int, recipient_id: int, base_url: str, db: Session) -> str:
    """Replace all <a href="..."> with tracked redirect URLs."""
    from app.models.campaign_link import CampaignLink

    link_cache = {}  # original_url -> link_id

    def replace_href(match):
        url = match.group(1)
        # Skip unsubscribe links and tracking pixels
        if "unsubscribe" in url or "track/open" in url or url.startswith("#") or url.startswith("mailto:"):
            return match.group(0)
        if url not in link_cache:
            link = db.query(CampaignLink).filter(
                CampaignLink.campaign_id == campaign_id,
                CampaignLink.original_url == url,
            ).first()
            if not link:
                link = CampaignLink(campaign_id=campaign_id, original_url=url)
                db.add(link)
                db.flush()
            link_cache[url] = link.id
        tracked_url = f"{base_url}/campaigns/track/click/{campaign_id}/{link_cache[url]}/{recipient_id}"
        return match.group(0).replace(url, tracked_url)

    return _re.sub(r'href=["\']([^"\']+)["\']', replace_href, html)
```

**Step 3: Update `_do_send` to call `_rewrite_links`**

In `_do_send`, after the line that creates `tracked_body` (the tracking pixel injection), add link rewriting:
```python
            tracked_body = _rewrite_links(tracked_body, campaign_id, recipient.id, base_url, db)
```

**Step 4: Update stats endpoint**

In `get_campaign_stats`, add click data to the response:
```python
    from app.models.campaign_link import CampaignLink
    links = db.query(CampaignLink).filter(CampaignLink.campaign_id == campaign_id).order_by(desc(CampaignLink.click_count)).all()
    click_rate = round((c.clicked_count / c.sent_count * 100), 1) if c.sent_count else 0
```

Add to the return dict:
```python
        "clicked_count": c.clicked_count,
        "click_rate": click_rate,
        "top_links": [
            {"url": l.original_url, "clicks": l.click_count, "first_click": l.first_clicked_at, "last_click": l.last_clicked_at}
            for l in links[:10]
        ],
```

Add `clicked_at` to each recipient in the recipients list.

**Step 5: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add click tracking redirect endpoint and link rewriting in send"
```

---

### Task 3: Update Campaign Stats Frontend for Click Tracking

**Files:**
- Modify: `frontend/app/admin/campaigns/[id]/page.tsx`

**Step 1: Add click rate to overview cards**

After the "Open Rate" stat card, add a "Click Rate" card showing `stats.click_rate`%.

**Step 2: Add top links table**

After the breakdown charts, add a "Top Links" section showing a table with columns: URL (truncated), Clicks, First Click, Last Click. Data from `stats.top_links`.

**Step 3: Add clicked_at to recipients table**

Add a "Clicked" column to the per-recipient table showing `r.clicked_at` timestamp.

**Step 4: Commit**

```bash
git add frontend/app/admin/campaigns/[id]/page.tsx
git commit -m "feat(marketing): add click tracking stats to campaign stats page"
```

---

## Feature 2: Advanced Segmentation

### Task 4: Update `_build_audience` for Tag and Engagement Filters

**Files:**
- Modify: `backend/app/routes/campaigns.py`

**Step 1: Extend `_build_audience` function**

After the existing source filter logic, add tag and engagement filtering:

```python
    # Tag filters
    tags_filter = target_filter.get("tags", {})
    include_tags = tags_filter.get("include", [])
    exclude_tags = tags_filter.get("exclude", [])

    if include_tags or exclude_tags:
        filtered_leads = []
        for lead in leads:
            lead_tags = lead.tags if isinstance(lead.tags, list) else []
            if include_tags and not all(t in lead_tags for t in include_tags):
                continue
            if exclude_tags and any(t in lead_tags for t in exclude_tags):
                continue
            filtered_leads.append(lead)
        leads = filtered_leads

    # Engagement filters
    engagement = target_filter.get("engagement", {})
    if engagement.get("opened_campaign"):
        cid = engagement["opened_campaign"]
        opened_emails = {r.email for r in db.query(CampaignRecipient.email).filter(
            CampaignRecipient.campaign_id == cid,
            CampaignRecipient.opened_at.isnot(None),
        ).all()}
        leads = [l for l in leads if l.email in opened_emails]

    if engagement.get("not_opened_campaign"):
        cid = engagement["not_opened_campaign"]
        opened_emails = {r.email for r in db.query(CampaignRecipient.email).filter(
            CampaignRecipient.campaign_id == cid,
            CampaignRecipient.opened_at.isnot(None),
        ).all()}
        leads = [l for l in leads if l.email not in opened_emails]

    if engagement.get("clicked_campaign"):
        cid = engagement["clicked_campaign"]
        clicked_emails = {r.email for r in db.query(CampaignRecipient.email).filter(
            CampaignRecipient.campaign_id == cid,
            CampaignRecipient.clicked_at.isnot(None),
        ).all()}
        leads = [l for l in leads if l.email in clicked_emails]
```

Note: Move the suppression filter to the END (after all other filters) so it's the final gate. The function should: query leads → filter by status/source → filter by tags → filter by engagement → filter by suppression → return.

**Step 2: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add tag and engagement filters to audience builder"
```

---

### Task 5: Add Advanced Segmentation UI to Campaign Form

**Files:**
- Modify: `frontend/app/admin/campaigns/new/page.tsx`
- Modify: `frontend/app/admin/campaigns/[id]/edit/page.tsx`

**Step 1: Update form state**

Extend the `target_filter` in form state:
```typescript
target_filter: {
    statuses: [] as string[],
    sources: [] as string[],
    tags: { include: [] as string[], exclude: [] as string[] },
    engagement: {} as Record<string, number>,
}
```

**Step 2: Add tag filter UI**

After the source filter section, add a "Filter by Tags" section:
- Fetch available tags from leads via `GET /crm/leads` or a dedicated endpoint
- Two multi-select areas: "Include tags" (AND) and "Exclude tags"
- Each is a text input + chip display

**Step 3: Add engagement filter UI**

After tags, add "Engagement Filters":
- Dropdown to select a past campaign (fetch from `GET /campaigns`)
- Radio buttons: "Opened" / "Did not open" / "Clicked"
- Sets `engagement.opened_campaign`, `engagement.not_opened_campaign`, or `engagement.clicked_campaign`

**Step 4: Apply same changes to the edit page**

Mirror the form state and UI changes in `[id]/edit/page.tsx`.

**Step 5: Commit**

```bash
git add frontend/app/admin/campaigns/new/page.tsx frontend/app/admin/campaigns/[id]/edit/page.tsx
git commit -m "feat(marketing): add tag and engagement filter UI to campaign forms"
```

---

## Feature 3: A/B Testing

### Task 6: Create CampaignVariant Model and Campaign A/B Fields

**Files:**
- Create: `backend/app/models/campaign_variant.py`
- Modify: `backend/app/models/campaign.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/main.py`

**Step 1: Create the variant model**

```python
# backend/app/models/campaign_variant.py
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class CampaignVariant(Base):
    __tablename__ = "campaign_variants"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    variant_label = Column(String(10), nullable=False)  # "A" or "B"
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    split_percentage = Column(Integer, default=50)
    sent_count = Column(Integer, default=0)
    opened_count = Column(Integer, default=0)
    clicked_count = Column(Integer, default=0)
```

**Step 2: Add A/B columns to Campaign model**

In `backend/app/models/campaign.py`, after `clicked_count`, add:
```python
    from sqlalchemy import Boolean
    is_ab_test = Column(Boolean, default=False)
    ab_test_size_pct = Column(Integer, default=20)
    ab_winner_variant_id = Column(Integer, ForeignKey("campaign_variants.id", ondelete="SET NULL"), nullable=True)
    ab_winner_criteria = Column(String(50), default="open_rate")  # open_rate | click_rate
    ab_test_duration_hours = Column(Integer, default=4)
```

Note: Import `Boolean` at the top of the file with the other imports.

**Step 3: Add `variant_id` to CampaignRecipient**

After `clicked_at`, add:
```python
    variant_id = Column(Integer, ForeignKey("campaign_variants.id", ondelete="SET NULL"), nullable=True)
```

**Step 4: Register model, add migration SQL, add import to main.py**

Same pattern as previous tasks. Migration SQL:
```sql
CREATE TABLE IF NOT EXISTS campaign_variants (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    variant_label VARCHAR(10) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body_html TEXT NOT NULL,
    split_percentage INTEGER DEFAULT 50,
    sent_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0
);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_ab_test BOOLEAN DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_test_size_pct INTEGER DEFAULT 20;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_winner_variant_id INTEGER REFERENCES campaign_variants(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_winner_criteria VARCHAR(50) DEFAULT 'open_rate';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_test_duration_hours INTEGER DEFAULT 4;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES campaign_variants(id) ON DELETE SET NULL;
```

**Step 5: Commit**

```bash
git add backend/app/models/campaign_variant.py backend/app/models/campaign.py backend/app/models/__init__.py backend/main.py
git commit -m "feat(marketing): add CampaignVariant model and A/B test fields"
```

---

### Task 7: Add A/B Test Send Logic and Winner Picker

**Files:**
- Modify: `backend/app/routes/campaigns.py`
- Modify: `backend/main.py`

**Step 1: Create `_do_ab_send` function**

After `_do_send`, add a new function:
```python
def _do_ab_send(campaign_id: int, db: Session):
    """Send A/B test variants to test-size portion of audience."""
    from app.models.campaign_variant import CampaignVariant
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign or not campaign.is_ab_test:
        return

    campaign.status = "ab_testing"
    db.commit()

    from app.services.branding_service import branding_service
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    import random

    smtp_config = branding_service.get_smtp_config(db)
    audience = _build_audience(db, campaign.target_filter or {})
    base_url = os.getenv("BACKEND_URL", "http://localhost:8000")

    # Get variants
    variants = db.query(CampaignVariant).filter(CampaignVariant.campaign_id == campaign_id).order_by(CampaignVariant.variant_label).all()
    if len(variants) != 2:
        campaign.status = "failed"
        db.commit()
        return

    # Split audience: test_size % for testing, rest for winner later
    test_size = max(1, int(len(audience) * campaign.ab_test_size_pct / 100))
    random.shuffle(audience)
    test_audience = audience[:test_size]
    # Remaining audience will be sent the winner later

    # Split test audience between variants
    split_point = len(test_audience) // 2
    groups = [
        (variants[0], test_audience[:split_point]),
        (variants[1], test_audience[split_point:]),
    ]

    for variant, leads in groups:
        sent = 0
        for lead in leads:
            try:
                recipient = CampaignRecipient(
                    campaign_id=campaign_id,
                    lead_id=lead.id,
                    email=lead.email,
                    name=f"{lead.first_name} {lead.last_name or ''}".strip(),
                    status="sent",
                    variant_id=variant.id,
                )
                db.add(recipient)
                db.flush()

                unsub_token = _make_unsub_token(lead.email, campaign_id)
                unsub_url = f"{base_url}/campaigns/unsubscribe/{unsub_token}"
                pixel_url = f"{base_url}/campaigns/track/open/{campaign_id}/{recipient.id}"
                personalized_body = _replace_tags(variant.body_html, lead, unsub_url)
                tracked_body = personalized_body + f'<img src="{pixel_url}" width="1" height="1" style="display:none" />'
                tracked_body = _rewrite_links(tracked_body, campaign_id, recipient.id, base_url, db)

                msg = MIMEMultipart("alternative")
                msg["Subject"] = variant.subject
                msg["From"] = smtp_config.get("smtp_from_email", "no-reply@example.com")
                msg["To"] = lead.email
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
                sent += 1
            except Exception:
                recipient.status = "failed"

        variant.sent_count = sent

    campaign.sent_count = sum(v.sent_count for v in variants)
    campaign.sent_at = datetime.utcnow()
    db.commit()
```

**Step 2: Update send endpoint to handle A/B campaigns**

In the `send_campaign` endpoint, before `background_tasks.add_task(_do_send, ...)`, add:
```python
    if c.is_ab_test:
        background_tasks.add_task(_do_ab_send, campaign_id, db)
        return {"status": "ab_testing"}
```

**Step 3: Add A/B winner picker scheduler job in `main.py`**

After the `send_scheduled_campaigns` job, add:
```python
        def pick_ab_winners():
            """Check A/B testing campaigns and pick winners after test duration."""
            from app.models.campaign import Campaign
            from app.models.campaign_variant import CampaignVariant
            from app.routes.campaigns import _do_send, _build_audience
            db = SessionLocal()
            try:
                now = datetime.utcnow()
                testing = db.query(Campaign).filter(Campaign.status == "ab_testing").all()
                for campaign in testing:
                    if not campaign.sent_at:
                        continue
                    from datetime import timedelta
                    deadline = campaign.sent_at + timedelta(hours=campaign.ab_test_duration_hours or 4)
                    if now < deadline:
                        continue

                    # Pick winner
                    variants = db.query(CampaignVariant).filter(CampaignVariant.campaign_id == campaign.id).all()
                    if not variants:
                        continue

                    if campaign.ab_winner_criteria == "click_rate":
                        winner = max(variants, key=lambda v: (v.clicked_count / v.sent_count if v.sent_count else 0))
                    else:
                        winner = max(variants, key=lambda v: (v.opened_count / v.sent_count if v.sent_count else 0))

                    campaign.ab_winner_variant_id = winner.id
                    # Now send winner to remaining audience
                    campaign.subject = winner.subject
                    campaign.body_html = winner.body_html
                    campaign.status = "draft"  # Reset so _do_send can process
                    db.commit()

                    try:
                        _do_send(campaign.id, db)
                    except Exception as e:
                        logger.error(f"A/B winner send error (id={campaign.id}): {e}")
            except Exception as e:
                logger.error(f"pick_ab_winners error: {e}")
            finally:
                db.close()

        scheduler.add_job(pick_ab_winners, 'interval', minutes=5, id='pick_ab_winners_job')
```

**Step 4: Commit**

```bash
git add backend/app/routes/campaigns.py backend/main.py
git commit -m "feat(marketing): add A/B test send logic and winner picker scheduler"
```

---

### Task 8: Add A/B Test Variant CRUD Endpoints

**Files:**
- Modify: `backend/app/routes/campaigns.py`

**Step 1: Add variant endpoints**

After the suppression list endpoints, before CRUD:
```python
# ===== A/B TEST VARIANTS =====

@router.post("/{campaign_id}/variants")
def create_variant(
    campaign_id: int,
    variant_label: str,
    subject: str,
    body_html: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.campaign_variant import CampaignVariant
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    existing = db.query(CampaignVariant).filter(
        CampaignVariant.campaign_id == campaign_id,
        CampaignVariant.variant_label == variant_label,
    ).first()
    if existing:
        existing.subject = subject
        existing.body_html = body_html
    else:
        existing = CampaignVariant(
            campaign_id=campaign_id,
            variant_label=variant_label,
            subject=subject,
            body_html=body_html,
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return {"id": existing.id, "variant_label": existing.variant_label, "subject": existing.subject}


@router.get("/{campaign_id}/variants")
def list_variants(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.campaign_variant import CampaignVariant
    variants = db.query(CampaignVariant).filter(CampaignVariant.campaign_id == campaign_id).order_by(CampaignVariant.variant_label).all()
    return [
        {
            "id": v.id, "variant_label": v.variant_label, "subject": v.subject,
            "body_html": v.body_html, "sent_count": v.sent_count,
            "opened_count": v.opened_count, "clicked_count": v.clicked_count,
        }
        for v in variants
    ]
```

**Step 2: Update stats endpoint for A/B variant comparison**

In `get_campaign_stats`, add variant stats:
```python
    from app.models.campaign_variant import CampaignVariant
    variants = db.query(CampaignVariant).filter(CampaignVariant.campaign_id == campaign_id).all()
    variant_stats = []
    for v in variants:
        v_open_rate = round((v.opened_count / v.sent_count * 100), 1) if v.sent_count else 0
        v_click_rate = round((v.clicked_count / v.sent_count * 100), 1) if v.sent_count else 0
        variant_stats.append({
            "id": v.id, "label": v.variant_label, "subject": v.subject,
            "sent_count": v.sent_count, "opened_count": v.opened_count,
            "clicked_count": v.clicked_count, "open_rate": v_open_rate,
            "click_rate": v_click_rate,
            "is_winner": v.id == c.ab_winner_variant_id,
        })
```

Add to return dict: `"is_ab_test": c.is_ab_test, "ab_winner_criteria": c.ab_winner_criteria, "variants": variant_stats,`

**Step 3: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add A/B variant CRUD and variant stats endpoints"
```

---

### Task 9: Add A/B Test UI to Campaign Forms and Stats

**Files:**
- Modify: `frontend/app/admin/campaigns/new/page.tsx`
- Modify: `frontend/app/admin/campaigns/[id]/edit/page.tsx`
- Modify: `frontend/app/admin/campaigns/[id]/page.tsx`

**Step 1: Add A/B toggle to campaign form**

After the "Email Body" section, add:
- Toggle switch: "Enable A/B Test"
- When on: show two side-by-side panels (Variant A and Variant B), each with subject + EmailEditor
- Settings: Test size % (slider 10-50), Winner criteria (dropdown: Open Rate / Click Rate), Test duration hours (input)
- On save: POST variants to `/{campaign_id}/variants`

**Step 2: Add variant comparison to stats page**

When `stats.is_ab_test` is true:
- Show variant comparison cards side by side (A vs B)
- Each shows: Subject, Sent, Opened, Open Rate, Clicked, Click Rate
- Winner badge on the winning variant
- Show winner criteria used

**Step 3: Apply same changes to edit page**

When editing an A/B test campaign, load existing variants via `GET /{campaign_id}/variants` and populate the side-by-side editors.

**Step 4: Commit**

```bash
git add frontend/app/admin/campaigns/new/page.tsx frontend/app/admin/campaigns/[id]/edit/page.tsx frontend/app/admin/campaigns/[id]/page.tsx
git commit -m "feat(marketing): add A/B test UI to campaign forms and stats page"
```

---

## Feature 4: Campaign Attachments

### Task 10: Create CampaignAttachment Model and Endpoints

**Files:**
- Create: `backend/app/models/campaign_attachment.py`
- Create: `backend/app/routes/campaign_attachments.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/main.py`
- Modify: `backend/app/routes/campaigns.py`

**Step 1: Create the attachment model**

```python
# backend/app/models/campaign_attachment.py
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class CampaignAttachment(Base):
    __tablename__ = "campaign_attachments"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    content_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

**Step 2: Create the attachment routes**

```python
# backend/app/routes/campaign_attachments.py
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.campaign import Campaign
from app.models.campaign_attachment import CampaignAttachment
from app.models.user import User
from app.dependencies import get_current_user, require_page

router = APIRouter(prefix="/campaigns", tags=["campaign-attachments"], dependencies=[Depends(require_page("campaigns"))])

ATTACHMENT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "attachment_storage", "campaigns")


@router.post("/{campaign_id}/attachments")
async def upload_attachment(
    campaign_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Check max 3 attachments
    count = db.query(CampaignAttachment).filter(CampaignAttachment.campaign_id == campaign_id).count()
    if count >= 3:
        raise HTTPException(status_code=400, detail="Maximum 3 attachments per campaign")

    # Read file
    content = await file.read()
    size = len(content)
    if size > 10 * 1024 * 1024:  # 10MB
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    # Save to disk
    save_dir = os.path.join(ATTACHMENT_DIR, str(campaign_id))
    os.makedirs(save_dir, exist_ok=True)
    file_path = os.path.join(save_dir, file.filename)
    with open(file_path, "wb") as f:
        f.write(content)

    att = CampaignAttachment(
        campaign_id=campaign_id,
        filename=file.filename,
        file_path=file_path,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return {"id": att.id, "filename": att.filename, "size_bytes": att.size_bytes, "content_type": att.content_type}


@router.get("/{campaign_id}/attachments")
def list_attachments(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    atts = db.query(CampaignAttachment).filter(CampaignAttachment.campaign_id == campaign_id).all()
    return [{"id": a.id, "filename": a.filename, "size_bytes": a.size_bytes, "content_type": a.content_type} for a in atts]


@router.delete("/{campaign_id}/attachments/{attachment_id}")
def delete_attachment(
    campaign_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    att = db.query(CampaignAttachment).filter(
        CampaignAttachment.id == attachment_id,
        CampaignAttachment.campaign_id == campaign_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if os.path.exists(att.file_path):
        os.remove(att.file_path)
    db.delete(att)
    db.commit()
    return {"status": "deleted"}
```

**Step 3: Register model, migration, and router**

- Add import + `__all__` entry in `__init__.py`
- Add migration SQL in `main.py`
- Import and register `campaign_attachments.router` in `main.py`
- Add model import: `from app.models.campaign_attachment import CampaignAttachment  # noqa: F401`

Migration SQL:
```sql
CREATE TABLE IF NOT EXISTS campaign_attachments (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 4: Update `_do_send` to attach files**

In `_do_send`, after creating the MIMEMultipart message, before sending:
```python
            # Attach campaign files
            from app.models.campaign_attachment import CampaignAttachment as CA
            from email.mime.base import MIMEBase
            from email import encoders
            attachments = db.query(CA).filter(CA.campaign_id == campaign_id).all()
            for att in attachments:
                if os.path.exists(att.file_path):
                    with open(att.file_path, "rb") as f:
                        part = MIMEBase("application", "octet-stream")
                        part.set_payload(f.read())
                        encoders.encode_base64(part)
                        part.add_header("Content-Disposition", f"attachment; filename={att.filename}")
                        msg.attach(part)
```

Note: Query attachments ONCE outside the loop (before `for lead in audience`) and reuse.

**Step 5: Commit**

```bash
git add backend/app/models/campaign_attachment.py backend/app/routes/campaign_attachments.py backend/app/models/__init__.py backend/main.py backend/app/routes/campaigns.py
git commit -m "feat(marketing): add campaign attachments with upload, list, delete, and send"
```

---

### Task 11: Add Attachment Upload UI to Campaign Forms

**Files:**
- Modify: `frontend/app/admin/campaigns/new/page.tsx`
- Modify: `frontend/app/admin/campaigns/[id]/edit/page.tsx`

**Step 1: Add attachment section to campaign form**

After the email body section, add an "Attachments" card:
- File input with drag-and-drop styling
- List of attached files as chips (filename, size formatted, X button to remove)
- Upload on file select via `POST /{campaign_id}/attachments` (multipart)
- Note: For new campaigns, save draft first then enable attachments (need campaign_id)
- Max 3 files indicator

**Step 2: Apply same to edit page**

Load existing attachments on mount via `GET /{campaign_id}/attachments`.

**Step 3: Commit**

```bash
git add frontend/app/admin/campaigns/new/page.tsx frontend/app/admin/campaigns/[id]/edit/page.tsx
git commit -m "feat(marketing): add attachment upload UI to campaign forms"
```

---

## Feature 5: Dynamic Content Blocks

### Task 12: Add Dynamic Block Processing to Send Logic

**Files:**
- Modify: `backend/app/routes/campaigns.py`

**Step 1: Add `_process_dynamic_blocks` function**

Before `_replace_tags`, add:
```python
def _process_dynamic_blocks(html: str, lead) -> str:
    """Process {{#if condition="value"}}...{{#else}}...{{/if}} blocks."""
    import re

    lead_tags = lead.tags if isinstance(getattr(lead, 'tags', None), list) else []

    def evaluate_condition(condition: str) -> bool:
        match = re.match(r'(\w+)\s*=\s*"([^"]*)"', condition.strip())
        if not match:
            return False
        field, value = match.groups()
        if field == "tag":
            return value in lead_tags
        elif field == "status":
            return (getattr(lead, 'status', '') or '') == value
        elif field == "source":
            return (getattr(lead, 'source', '') or '') == value
        return False

    def replace_block(match):
        condition = match.group(1)
        if_content = match.group(2)
        else_content = match.group(4) if match.group(4) else ""
        if evaluate_condition(condition):
            return if_content.strip()
        return else_content.strip()

    # Match {{#if condition}}...{{#else}}...{{/if}} or {{#if condition}}...{{/if}}
    pattern = r'\{\{#if\s+(.+?)\}\}(.*?)(\{\{#else\}\}(.*?))?\{\{/if\}\}'
    return re.sub(pattern, replace_block, html, flags=re.DOTALL)
```

**Step 2: Call it in `_do_send`**

In `_do_send`, BEFORE the `_replace_tags` call, add:
```python
            personalized_body = _process_dynamic_blocks(campaign.body_html, lead)
            personalized_body = _replace_tags(personalized_body, lead, unsub_url)
```

Replace the existing `personalized_body = _replace_tags(campaign.body_html, lead, unsub_url)` line.

Do the same in `_do_ab_send` for the variant body.

**Step 3: Update test email endpoint**

In `send_test_email`, process dynamic blocks with dummy lead data before merge tags:
```python
    # Process dynamic blocks with dummy lead
    class DummyLead:
        tags = ["vip"]
        status = "new"
        source = "website"
    body = _process_dynamic_blocks(body, DummyLead())
```

**Step 4: Commit**

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat(marketing): add dynamic content block processing to campaign send"
```

---

### Task 13: Add Dynamic Block Button to EmailEditor

**Files:**
- Modify: `frontend/components/EmailEditor.tsx`

**Step 1: Add dynamic block insertion**

Add a "Dynamic" button to the toolbar (after merge tags section). When clicked, insert at cursor:
```html
{{#if tag="vip"}}
<div>VIP content here</div>
{{#else}}
<div>Default content here</div>
{{/if}}
```

Add a small dropdown/popover for the button with:
- Condition type: Tag / Status / Source (select)
- Value: text input
- "Insert Block" button

The inserted block should be clearly visible in the editor. Use Tiptap's `insertContent` method.

**Step 2: Commit**

```bash
git add frontend/components/EmailEditor.tsx
git commit -m "feat(marketing): add dynamic block inserter to email editor toolbar"
```

---

### Task 14: Verify All Features Work Together

**Step 1: Start backend, verify no startup errors**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Check: all new tables created, scheduler jobs registered, no import errors.

**Step 2: Verify endpoints in Swagger**

Open http://localhost:8000/docs and confirm all new endpoints exist:
- `GET /campaigns/track/click/{campaign_id}/{link_id}/{recipient_id}` (public)
- `POST /{campaign_id}/variants`, `GET /{campaign_id}/variants`
- `POST /{campaign_id}/attachments`, `GET /{campaign_id}/attachments`, `DELETE /{campaign_id}/attachments/{id}`

**Step 3: Start frontend, verify build**

```bash
cd frontend && npm run dev
```

Navigate to `/admin/campaigns/new` and verify:
- A/B toggle appears
- Tag/engagement filters appear in audience section
- Attachment section appears
- Dynamic block button in email editor

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(marketing): resolve integration issues for nice-to-have features"
```
