import os
import base64
import threading
import urllib.request
import json as _json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.database import get_db
from app.models.campaign import Campaign, CampaignRecipient
from app.models.crm import Lead
from app.models.user import User
from app.schemas.campaign import CampaignCreate, CampaignUpdate, CampaignResponse, RecipientResponse, VariantCreate
from app.dependencies import get_current_user, require_page

import hmac
import hashlib

from app.config import settings
from app.models.email_suppression import EmailSuppression
from app.schemas.email_suppression import SendTestRequest

# Public router — no auth required (used for email tracking pixels)
public_router = APIRouter(prefix="/campaigns", tags=["campaigns"])

# Protected router — requires page access
router = APIRouter(prefix="/campaigns", tags=["campaigns"], dependencies=[Depends(require_page("campaigns"))])

# 1x1 transparent GIF bytes
TRACKING_PIXEL = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)


def _make_unsub_token(email: str, campaign_id: int) -> str:
    """Create HMAC-signed unsubscribe token: base64url(email:campaign_id:signature)."""
    payload = f"{email}:{campaign_id}"
    sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    token = base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()
    return token


def _verify_unsub_token(token: str) -> tuple | None:
    """Verify and decode unsubscribe token. Returns (email, campaign_id) or None."""
    try:
        decoded = base64.urlsafe_b64decode(token).decode()
        parts = decoded.rsplit(":", 2)
        if len(parts) != 3:
            return None
        email, campaign_id_str, sig = parts
        payload = f"{email}:{campaign_id_str}"
        expected = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected):
            return None
        return email, int(campaign_id_str)
    except Exception:
        return None


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


# ── Tracking helpers ─────────────────────────────────────────────────────────

def _parse_device(ua: str) -> str:
    u = ua.lower()
    if any(x in u for x in ["ipad", "tablet"]):
        return "tablet"
    if any(x in u for x in ["iphone", "android", "mobile"]):
        return "mobile"
    return "desktop"


def _parse_email_client(ua: str) -> str:
    u = ua.lower()
    if "gmail" in u:
        return "Gmail"
    if "outlook" in u:
        return "Outlook"
    if "apple mail" in u or ("darwin" in u and "mac" in u):
        return "Apple Mail"
    if "thunderbird" in u:
        return "Thunderbird"
    if "yahoo" in u:
        return "Yahoo Mail"
    return "Other"


def _enrich_recipient(recipient_id: int, ip: str, user_agent: str):
    """Fire-and-forget background task: geolocate + parse UA, update recipient row."""
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


def _build_audience(db: Session, target_filter: dict) -> list:
    """Return leads matching the campaign's target_filter, excluding suppressed emails."""
    query = db.query(Lead).filter(Lead.email.isnot(None))
    statuses = target_filter.get("statuses", [])
    sources = target_filter.get("sources", [])
    if statuses:
        query = query.filter(Lead.status.in_(statuses))
    if sources:
        query = query.filter(Lead.source.in_(sources))

    leads = query.all()

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

    # Suppression filter (must be last)
    suppressed_q = db.query(EmailSuppression.email).filter(
        (EmailSuppression.resubscribed_at.is_(None)) |
        (EmailSuppression.resubscribed_at < EmailSuppression.unsubscribed_at)
    )
    suppressed_emails = {row[0] for row in suppressed_q.all()}

    # Also exclude leads that have been marked as invalid by the email validator
    return [
        lead for lead in leads
        if lead.email not in suppressed_emails and lead.email_valid is not False
    ]


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


def _do_send(campaign_id: int, db: Session):
    """Core send logic — called by background task and scheduler."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign or campaign.status not in ("draft", "scheduled"):
        return

    campaign.status = "sending"
    db.commit()

    from app.services.branding_service import branding_service
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    smtp_config = branding_service.get_smtp_config(db)
    audience = _build_audience(db, campaign.target_filter or {})

    # Pre-send bulk email validation (skip if validator not configured)
    from app.services.email_validator_service import email_validator_service
    from app.models.email_suppression import EmailSuppression as _ES
    validation_skipped_count = 0

    validator_config = email_validator_service.get_validator_config(db)
    if validator_config and audience:
        try:
            audience_emails = [lead.email for lead in audience]
            bulk_results = email_validator_service.validate_bulk(audience_emails, db)
            # Build a map: email -> result
            result_map = {r.get("email"): r for r in bulk_results if r.get("email")}
            filtered_audience = []
            for lead in audience:
                result = result_map.get(lead.email)
                if result is None:
                    # No result for this email — fail open, include
                    filtered_audience.append(lead)
                    continue
                passed = result.get("is_valid", True)
                if passed:
                    lead.email_valid = True
                    filtered_audience.append(lead)
                else:
                    lead.email_valid = False
                    existing_sup = db.query(_ES).filter(
                        _ES.email == lead.email,
                    ).first()
                    if existing_sup:
                        existing_sup.reason = "invalid"
                    else:
                        db.add(_ES(email=lead.email, reason="invalid", campaign_id=campaign_id))
                    validation_skipped_count += 1
            db.commit()
            audience = filtered_audience
        except Exception as exc:
            import logging as _logging
            _logging.getLogger(__name__).warning("Pre-send bulk validation failed: %s", exc)
            # Fail open — proceed with original audience

    base_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    sent = 0
    errors = 0

    # Query attachments once (outside the loop)
    from app.models.campaign_attachment import CampaignAttachment as CA
    from email.mime.base import MIMEBase
    from email import encoders
    attachments = db.query(CA).filter(CA.campaign_id == campaign_id).all()

    for lead in audience:
        recipient = None
        try:
            # Create or find recipient row
            recipient = db.query(CampaignRecipient).filter(
                CampaignRecipient.campaign_id == campaign_id,
                CampaignRecipient.email == lead.email,
            ).first()
            if recipient and recipient.sent_at:
                continue  # Already sent (e.g. A/B test recipient)
            if not recipient:
                recipient = CampaignRecipient(
                    campaign_id=campaign_id,
                    lead_id=lead.id,
                    email=lead.email,
                    name=f"{lead.first_name} {lead.last_name or ''}".strip(),
                    status="sent",
                )
                db.add(recipient)
                db.flush()  # get id

            # Build per-recipient unsubscribe URL
            unsub_token = _make_unsub_token(lead.email, campaign_id)
            unsub_url = f"{base_url}/campaigns/unsubscribe/{unsub_token}"

            # Personalise + inject tracking pixel into body
            pixel_url = f"{base_url}/campaigns/track/open/{campaign_id}/{recipient.id}"
            personalized_body = _process_dynamic_blocks(campaign.body_html, lead)
            personalized_body = _replace_tags(personalized_body, lead, unsub_url)
            tracked_body = personalized_body + f'<img src="{pixel_url}" width="1" height="1" style="display:none" />'
            tracked_body = _rewrite_links(tracked_body, campaign_id, recipient.id, base_url, db)

            msg = MIMEMultipart("alternative")
            msg["Subject"] = campaign.subject
            msg["From"] = smtp_config.get("smtp_from_email", "no-reply@example.com")
            msg["To"] = lead.email
            # RFC 8058 one-click unsubscribe headers
            msg["List-Unsubscribe"] = f"<{unsub_url}>"
            msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
            msg.attach(MIMEText(tracked_body, "html"))

            for att in attachments:
                if os.path.exists(att.file_path):
                    with open(att.file_path, "rb") as f:
                        part = MIMEBase("application", "octet-stream")
                        part.set_payload(f.read())
                        encoders.encode_base64(part)
                        part.add_header("Content-Disposition", f"attachment; filename={att.filename}")
                        msg.attach(part)

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
            if recipient:
                recipient.status = "bounced"
            existing_sup = db.query(EmailSuppression).filter(EmailSuppression.email == lead.email).first()
            if not existing_sup:
                db.add(EmailSuppression(email=lead.email, reason="bounced", campaign_id=campaign_id))
            errors += 1
        except (smtplib.SMTPDataError, smtplib.SMTPServerDisconnected):
            if recipient:
                recipient.status = "failed"
            errors += 1
        except Exception:
            if recipient:
                recipient.status = "failed"
            errors += 1

    campaign.sent_count = sent
    campaign.sent_at = datetime.utcnow()
    campaign.status = "sent" if errors == 0 else "failed"
    db.commit()


def _do_ab_send(campaign_id: int, db: Session):
    """Send A/B test variants to a subset of the audience."""
    from app.models.campaign_variant import CampaignVariant
    from app.services.branding_service import branding_service
    import smtplib
    import random
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign or not campaign.is_ab_test:
        return

    campaign.status = "ab_testing"
    db.commit()

    smtp_config = branding_service.get_smtp_config(db)
    audience = _build_audience(db, campaign.target_filter or {})

    variants = db.query(CampaignVariant).filter(
        CampaignVariant.campaign_id == campaign_id
    ).order_by(CampaignVariant.variant_label).all()
    if len(variants) != 2:
        campaign.status = "failed"
        db.commit()
        return

    base_url = os.getenv("BACKEND_URL", "http://localhost:8000")

    # Calculate test audience size
    test_size = max(1, int(len(audience) * (campaign.ab_test_size_pct or 20) / 100))
    random.shuffle(audience)
    test_audience = audience[:test_size]

    # Split test audience between variant A and variant B
    midpoint = len(test_audience) // 2
    variant_groups = [
        (variants[0], test_audience[:midpoint]),
        (variants[1], test_audience[midpoint:]),
    ]

    # Query attachments once (outside the loop)
    from app.models.campaign_attachment import CampaignAttachment as CA
    from email.mime.base import MIMEBase
    from email import encoders
    ab_attachments = db.query(CA).filter(CA.campaign_id == campaign_id).all()

    sent = 0
    for variant, leads in variant_groups:
        for lead in leads:
            recipient = None
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
                        variant_id=variant.id,
                    )
                    db.add(recipient)
                    db.flush()

                unsub_token = _make_unsub_token(lead.email, campaign_id)
                unsub_url = f"{base_url}/campaigns/unsubscribe/{unsub_token}"

                pixel_url = f"{base_url}/campaigns/track/open/{campaign_id}/{recipient.id}"
                personalized_body = _process_dynamic_blocks(variant.body_html, lead)
                personalized_body = _replace_tags(personalized_body, lead, unsub_url)
                tracked_body = personalized_body + f'<img src="{pixel_url}" width="1" height="1" style="display:none" />'
                tracked_body = _rewrite_links(tracked_body, campaign_id, recipient.id, base_url, db)

                msg = MIMEMultipart("alternative")
                msg["Subject"] = variant.subject
                msg["From"] = smtp_config.get("smtp_from_email", "no-reply@example.com")
                msg["To"] = lead.email
                msg["List-Unsubscribe"] = f"<{unsub_url}>"
                msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
                msg.attach(MIMEText(tracked_body, "html"))

                for att in ab_attachments:
                    if os.path.exists(att.file_path):
                        with open(att.file_path, "rb") as f:
                            part = MIMEBase("application", "octet-stream")
                            part.set_payload(f.read())
                            encoders.encode_base64(part)
                            part.add_header("Content-Disposition", f"attachment; filename={att.filename}")
                            msg.attach(part)

                if smtp_config.get("smtp_password"):
                    with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                        if smtp_config.get("smtp_use_tls", True):
                            server.starttls()
                        server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                        server.sendmail(smtp_config["smtp_from_email"], lead.email, msg.as_string())

                recipient.sent_at = datetime.utcnow()
                recipient.status = "sent"
                sent += 1
                variant.sent_count = (variant.sent_count or 0) + 1
            except Exception:
                if recipient:
                    recipient.status = "failed"

    campaign.sent_count = sent
    campaign.sent_at = datetime.utcnow()
    db.commit()


# ===== TRACKING PIXEL =====
# IMPORTANT: This route must be registered BEFORE the {campaign_id} wildcard routes
# to avoid FastAPI treating "track" as a campaign_id integer.

@public_router.get("/track/open/{campaign_id}/{recipient_id}")
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


# ===== AUDIENCE PREVIEW (no campaign_id) =====

@router.post("/preview-audience")
def preview_audience(
    filter_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Preview audience count for a target_filter before saving."""
    leads = _build_audience(db, filter_data)
    return {"count": len(leads)}


# ===== SEND TEST EMAIL =====

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

    # Process dynamic blocks with dummy lead data
    class DummyLead:
        tags = ["vip"]
        status = "new"
        source = "website"
    body = _process_dynamic_blocks(req.body_html, DummyLead())

    # Replace merge tags with dummy data
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


# ===== SUPPRESSION LIST =====

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


# ===== A/B TEST VARIANTS =====

@router.post("/{campaign_id}/variants")
def create_variant(
    campaign_id: int,
    data: VariantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.campaign_variant import CampaignVariant
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    existing = db.query(CampaignVariant).filter(
        CampaignVariant.campaign_id == campaign_id,
        CampaignVariant.variant_label == data.variant_label,
    ).first()
    if existing:
        existing.subject = data.subject
        existing.body_html = data.body_html
    else:
        existing = CampaignVariant(
            campaign_id=campaign_id,
            variant_label=data.variant_label,
            subject=data.subject,
            body_html=data.body_html,
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


# ===== AUDIENCE COUNT for existing campaign =====

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
    if c.is_ab_test:
        background_tasks.add_task(_do_ab_send, campaign_id, db)
        return {"status": "ab_testing"}
    background_tasks.add_task(_do_send, campaign_id, db)
    return {"status": "sending"}


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
    click_rate = round((c.clicked_count / c.sent_count * 100), 1) if c.sent_count else 0

    # Build breakdown summaries from recipients that have opened
    from collections import Counter
    opened_recipients = [r for r in recipients if r.opened_at]
    device_breakdown = dict(Counter(r.device_type for r in opened_recipients if r.device_type))
    client_breakdown = dict(Counter(r.email_client for r in opened_recipients if r.email_client))
    country_breakdown = dict(Counter(r.country for r in opened_recipients if r.country))

    from app.models.campaign_link import CampaignLink
    links = db.query(CampaignLink).filter(CampaignLink.campaign_id == campaign_id).order_by(desc(CampaignLink.click_count)).all()

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

    return {
        "sent_count": c.sent_count,
        "opened_count": c.opened_count,
        "open_rate": open_rate,
        "clicked_count": c.clicked_count,
        "click_rate": click_rate,
        "is_ab_test": c.is_ab_test,
        "ab_winner_criteria": c.ab_winner_criteria,
        "variants": variant_stats,
        "device_breakdown": device_breakdown,
        "client_breakdown": client_breakdown,
        "country_breakdown": country_breakdown,
        "top_links": [
            {"url": l.original_url, "clicks": l.click_count, "first_click": l.first_clicked_at, "last_click": l.last_clicked_at}
            for l in links[:10]
        ],
        "recipients": [
            {
                "id": r.id,
                "email": r.email,
                "name": r.name,
                "sent_at": r.sent_at,
                "opened_at": r.opened_at,
                "open_count": r.open_count,
                "clicked_at": r.clicked_at,
                "country": r.country,
                "city": r.city,
                "device_type": r.device_type,
                "email_client": r.email_client,
            }
            for r in recipients
        ],
    }
