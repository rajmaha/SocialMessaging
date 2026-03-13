"""
CRUD endpoints for managing widget domains (multi-domain widget support).
Each domain gets its own widget_key, branding overrides, and assigned
platform accounts + agents.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import check_permission
from app.models.domain_account import DomainAccount
from app.models.domain_agent import DomainAgent
from app.models.platform_account import PlatformAccount
from app.models.user import User
from app.models.widget_domain import WidgetDomain

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
