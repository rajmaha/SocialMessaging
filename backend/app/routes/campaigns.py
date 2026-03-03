import os
import base64
import threading
import urllib.request
import json as _json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
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
    """Return leads matching the campaign's target_filter."""
    query = db.query(Lead).filter(Lead.email.isnot(None))
    statuses = target_filter.get("statuses", [])
    sources = target_filter.get("sources", [])
    if statuses:
        query = query.filter(Lead.status.in_(statuses))
    if sources:
        query = query.filter(Lead.source.in_(sources))
    return query.all()


def _replace_tags(html: str, lead) -> str:
    """Replace {{merge_tags}} with lead data for personalized emails."""
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

            # Personalise + inject tracking pixel into body
            pixel_url = f"{base_url}/campaigns/track/open/{campaign_id}/{recipient.id}"
            personalized_body = _replace_tags(campaign.body_html, lead)
            tracked_body = personalized_body + f'<img src="{pixel_url}" width="1" height="1" style="display:none" />'

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


# ===== TRACKING PIXEL =====
# IMPORTANT: This route must be registered BEFORE the {campaign_id} wildcard routes
# to avoid FastAPI treating "track" as a campaign_id integer.

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

    # Build breakdown summaries from recipients that have opened
    from collections import Counter
    opened_recipients = [r for r in recipients if r.opened_at]
    device_breakdown = dict(Counter(r.device_type for r in opened_recipients if r.device_type))
    client_breakdown = dict(Counter(r.email_client for r in opened_recipients if r.email_client))
    country_breakdown = dict(Counter(r.country for r in opened_recipients if r.country))

    return {
        "sent_count": c.sent_count,
        "opened_count": c.opened_count,
        "open_rate": open_rate,
        "device_breakdown": device_breakdown,
        "client_breakdown": client_breakdown,
        "country_breakdown": country_breakdown,
        "recipients": [
            {
                "id": r.id,
                "email": r.email,
                "name": r.name,
                "sent_at": r.sent_at,
                "opened_at": r.opened_at,
                "open_count": r.open_count,
                "country": r.country,
                "city": r.city,
                "device_type": r.device_type,
                "email_client": r.email_client,
            }
            for r in recipients
        ],
    }
