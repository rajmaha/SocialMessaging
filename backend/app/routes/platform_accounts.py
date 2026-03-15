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
from app.routes.admin import check_permission
from app.models.agent_account import AgentAccount
from app.models.platform_account import PlatformAccount
from app.models.user import User

router = APIRouter(prefix="/admin/platform-accounts", tags=["platform-accounts"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class PlatformAccountCreate(BaseModel):
    platform: str
    account_id: str
    account_name: str
    access_token: str
    phone_number: Optional[str] = None
    app_secret: Optional[str] = None
    verify_token: Optional[str] = None
    metadata: Optional[dict] = None


class PlatformAccountUpdate(BaseModel):
    account_name: Optional[str] = None
    access_token: Optional[str] = None
    phone_number: Optional[str] = None
    app_secret: Optional[str] = None
    verify_token: Optional[str] = None
    metadata: Optional[dict] = None


class AgentAssignRequest(BaseModel):
    user_id: int


class AgentAccountsReplaceRequest(BaseModel):
    platform_account_ids: List[int]


# ── Account CRUD ─────────────────────────────────────────────────────────────

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
            "metadata": a.extra_metadata,
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
        extra_metadata=body.metadata,
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
            attr_name = "extra_metadata" if key == "metadata" else key
            setattr(account, attr_name, value)

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


# ── Agent ↔ Account Assignment ───────────────────────────────────────────────

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
    db.query(AgentAccount).filter(AgentAccount.user_id == user_id).delete()

    for acct_id in body.platform_account_ids:
        db.add(AgentAccount(user_id=user_id, platform_account_id=acct_id))

    db.commit()
    return {"message": "Agent accounts updated", "count": len(body.platform_account_ids)}
