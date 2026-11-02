"""
CRUD endpoints for managing widget domains (multi-domain widget support).
Each domain gets its own widget_key, branding overrides, and assigned
platform accounts + agents.
"""
import secrets
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.routes.admin import check_permission
from app.models.domain_account import DomainAccount
from app.models.domain_agent import DomainAgent
from app.models.platform_account import PlatformAccount
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.models.organization import Organization
from app.models.ticket import Ticket
from app.services import secret_box
from app.services.support_webhooks import address_problem

router = APIRouter(prefix="/admin/widget-domains", tags=["widget-domains"])


# -- Schemas -------------------------------------------------------------------

class WidgetDomainCreate(BaseModel):
    domain: str
    display_name: str
    branding_overrides: Optional[dict] = None


class WidgetDomainUpdate(BaseModel):
    domain: Optional[str] = None
    display_name: Optional[str] = None
    branding_overrides: Optional[dict] = None


class SupportSettings(BaseModel):
    support_enabled: bool = False
    chat_enabled: bool = True
    allow_anonymous: bool = True
    support_categories: List[str] = []
    webhook_url: Optional[str] = None
    organization_id: Optional[int] = None


class DomainAccountsReplace(BaseModel):
    platform_account_ids: List[int]


class DomainAgentsReplace(BaseModel):
    user_ids: List[int]


# -- Domain CRUD --------------------------------------------------------------

@router.get("/")
async def list_widget_domains(
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """List all widget domains with account and agent counts."""
    domains = db.query(WidgetDomain).order_by(WidgetDomain.domain).all()

    # Batch-fetch counts
    account_counts = dict(
        db.query(DomainAccount.widget_domain_id, func.count(DomainAccount.id))
        .group_by(DomainAccount.widget_domain_id)
        .all()
    )
    agent_counts = dict(
        db.query(DomainAgent.widget_domain_id, func.count(DomainAgent.id))
        .group_by(DomainAgent.widget_domain_id)
        .all()
    )

    return [
        {
            "id": d.id,
            "domain": d.domain,
            "widget_key": d.widget_key,
            "display_name": d.display_name,
            "is_active": d.is_active,
            "branding_overrides": d.branding_overrides,
            **_support_view(d),
            "account_count": account_counts.get(d.id, 0),
            "agent_count": agent_counts.get(d.id, 0),
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }
        for d in domains
    ]


@router.post("/")
async def create_widget_domain(
    body: WidgetDomainCreate,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Create a new widget domain with an auto-generated widget_key."""
    domain = body.domain.strip().lower()

    existing = db.query(WidgetDomain).filter(WidgetDomain.domain == domain).first()
    if existing:
        raise HTTPException(status_code=409, detail="Domain already exists")

    wd = WidgetDomain(
        domain=domain,
        widget_key=str(uuid.uuid4()),
        display_name=body.display_name,
        is_active=1,
        branding_overrides=body.branding_overrides,
    )
    db.add(wd)
    db.commit()
    db.refresh(wd)
    return {"id": wd.id, "widget_key": wd.widget_key, "message": "Domain created"}


@router.put("/{domain_id}")
async def update_widget_domain(
    domain_id: int,
    body: WidgetDomainUpdate,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Update an existing widget domain."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")

    update_data = body.dict(exclude_unset=True)
    for key, value in update_data.items():
        if key == "domain" and value is not None:
            value = value.strip().lower()
        if value is not None and value != "":
            setattr(wd, key, value)

    wd.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Domain updated"}


@router.delete("/{domain_id}")
async def delete_widget_domain(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Delete a widget domain and cascade-remove its associations."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")
    # Its support requests would lose their site and stop being reachable by
    # the customer; switching the domain off keeps them.
    held = db.query(func.count(Ticket.id)).filter(Ticket.support_site_id == domain_id).scalar() or 0
    if held:
        raise HTTPException(status_code=409,
                            detail=f"This domain has {held} support request(s). Disable it instead of deleting it.")

    # Cascade associations
    db.query(DomainAccount).filter(DomainAccount.widget_domain_id == domain_id).delete()
    db.query(DomainAgent).filter(DomainAgent.widget_domain_id == domain_id).delete()
    db.delete(wd)
    db.commit()
    return {"message": "Domain deleted"}


@router.patch("/{domain_id}/toggle")
async def toggle_widget_domain(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Enable or disable a widget domain."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")

    wd.is_active = 0 if wd.is_active == 1 else 1
    wd.updated_at = datetime.utcnow()
    db.commit()
    return {"is_active": wd.is_active, "message": "Domain toggled"}


# -- Domain <-> Account Assignment ---------------------------------------------

@router.get("/{domain_id}/accounts")
async def list_domain_accounts(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """List platform accounts assigned to a widget domain."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")

    rows = (
        db.query(DomainAccount, PlatformAccount)
        .join(PlatformAccount, DomainAccount.platform_account_id == PlatformAccount.id)
        .filter(DomainAccount.widget_domain_id == domain_id)
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


@router.put("/{domain_id}/accounts")
async def replace_domain_accounts(
    domain_id: int,
    body: DomainAccountsReplace,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Replace the full list of platform accounts assigned to a widget domain."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")

    db.query(DomainAccount).filter(DomainAccount.widget_domain_id == domain_id).delete()

    for acct_id in body.platform_account_ids:
        db.add(DomainAccount(widget_domain_id=domain_id, platform_account_id=acct_id))

    db.commit()
    return {"message": "Domain accounts updated", "count": len(body.platform_account_ids)}


# -- Domain <-> Agent Assignment -----------------------------------------------

@router.get("/{domain_id}/agents")
async def list_domain_agents(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """List agents assigned to a widget domain."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")

    rows = (
        db.query(DomainAgent, User)
        .join(User, DomainAgent.user_id == User.id)
        .filter(DomainAgent.widget_domain_id == domain_id)
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


@router.put("/{domain_id}/agents")
async def replace_domain_agents(
    domain_id: int,
    body: DomainAgentsReplace,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Replace the full list of agents assigned to a widget domain."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")

    db.query(DomainAgent).filter(DomainAgent.widget_domain_id == domain_id).delete()

    for uid in body.user_ids:
        db.add(DomainAgent(widget_domain_id=domain_id, user_id=uid))

    db.commit()
    return {"message": "Domain agents updated", "count": len(body.user_ids)}


# -- Support desk ----------------------------------------------------------------

MAX_CATEGORIES = 20
CATEGORY_MAX = 60


def _support_view(d: WidgetDomain) -> dict:
    """A domain's support settings for the admin screen. The secret itself is never sent back."""
    return {
        "support_enabled": bool(d.support_enabled),
        "chat_enabled": bool(d.chat_enabled if d.chat_enabled is not None else 1),
        "allow_anonymous": bool(d.allow_anonymous if d.allow_anonymous is not None else 1),
        "support_categories": [c for c in (d.support_categories or []) if isinstance(c, str)],
        "webhook_url": d.webhook_url,
        "organization_id": d.organization_id,
        "has_identity_secret": bool(d.identity_secret),
    }


@router.put("/{domain_id}/support")
async def update_support_settings(
    domain_id: int,
    body: SupportSettings,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """Switch support on or off for a domain and set its categories, webhook and organization."""
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")

    categories, seen = [], set()
    for c in body.support_categories:
        c = (c or "").strip()
        if not c or c.lower() in seen:
            continue
        if len(c) > CATEGORY_MAX:
            raise HTTPException(status_code=422, detail=f"A category may be at most {CATEGORY_MAX} characters: {c[:20]}...")
        seen.add(c.lower())
        categories.append(c)
    if len(categories) > MAX_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"At most {MAX_CATEGORIES} categories.")

    webhook = (body.webhook_url or "").strip() or None
    if webhook:
        problem = address_problem(webhook)
        if problem:
            raise HTTPException(status_code=422, detail=problem[0].upper() + problem[1:] + ".")
    if body.organization_id is not None and not db.get(Organization, body.organization_id):
        raise HTTPException(status_code=422, detail="That organization does not exist.")
    if body.support_enabled and not body.allow_anonymous and not wd.identity_secret:
        raise HTTPException(status_code=422, detail=(
            "With anonymous visitors off, people can only be signed in by the site. "
            "Make a secret first and give it to the site."))

    wd.support_enabled = 1 if body.support_enabled else 0
    wd.chat_enabled = 1 if body.chat_enabled else 0
    wd.allow_anonymous = 1 if body.allow_anonymous else 0
    wd.support_categories = categories or None
    wd.webhook_url = webhook
    wd.organization_id = body.organization_id
    wd.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Support settings saved", **_support_view(wd)}


@router.post("/{domain_id}/support-secret")
async def make_support_secret(
    domain_id: int,
    current_user: dict = Depends(check_permission("feature_manage_messenger_config")),
    db: Session = Depends(get_db),
):
    """
    A new identity secret for the domain, answered this once. The site signs its
    users and checks webhooks with it. The old secret stops working at once.
    """
    wd = db.query(WidgetDomain).filter(WidgetDomain.id == domain_id).first()
    if not wd:
        raise HTTPException(status_code=404, detail="Domain not found")
    secret = secrets.token_urlsafe(32)
    try:
        wd.identity_secret = secret_box.seal(secret)
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err))
    wd.updated_at = datetime.utcnow()
    db.commit()
    return {"secret": secret, "widget_key": wd.widget_key,
            "message": "Copy it now: it is not shown again. The previous secret no longer works."}
