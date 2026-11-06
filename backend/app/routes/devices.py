"""
Device registration for mobile push notifications.

The app calls /devices/register after the OS hands it an FCM token (see
`frontend/lib/push.ts`). Tokens are owned by whoever is signed in at the time:
re-registering an existing token moves it to the current agent, which is what
should happen when a shared phone changes hands.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.device_token import DeviceToken
from app.models.user import User
from app.services import push_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/devices", tags=["devices"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class DeviceRegisterRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=4096)
    platform: str = Field("android", pattern="^(android|ios|web)$")
    device_name: Optional[str] = Field(None, max_length=200)
    os_version: Optional[str] = Field(None, max_length=50)


class DeviceUnregisterRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=4096)


class DeviceResponse(BaseModel):
    id: int
    platform: str
    device_name: Optional[str] = None
    os_version: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True


class PushStatusResponse(BaseModel):
    configured: bool
    project_id: Optional[str] = None
    active_devices: int


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("/register", response_model=DeviceResponse)
def register_device(
    payload: DeviceRegisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stores (or re-points) this device's push token for the signed-in agent."""
    existing = db.query(DeviceToken).filter(DeviceToken.token == payload.token).first()

    if existing:
        existing.user_id = current_user.id
        existing.platform = payload.platform
        existing.device_name = payload.device_name or existing.device_name
        existing.os_version = payload.os_version or existing.os_version
        # A token we previously marked dead is clearly alive again.
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing

    device = DeviceToken(
        token=payload.token,
        user_id=current_user.id,
        platform=payload.platform,
        device_name=payload.device_name,
        os_version=payload.os_version,
        is_active=True,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    log.info("Registered %s device for user %s", payload.platform, current_user.id)
    return device


@router.post("/unregister")
def unregister_device(
    payload: DeviceUnregisterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Called on sign-out. Deactivates rather than deletes, so the device keeps
    its row if the same agent signs back in. Only the owner may do this.
    """
    device = (
        db.query(DeviceToken)
        .filter(DeviceToken.token == payload.token, DeviceToken.user_id == current_user.id)
        .first()
    )
    if not device:
        # Not an error: the client retries this and a stale token is harmless.
        return {"status": "not_found"}

    device.is_active = False
    db.commit()
    return {"status": "unregistered"}


@router.get("/", response_model=List[DeviceResponse])
def list_my_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The agent's own registered devices, for a 'signed-in devices' screen."""
    return (
        db.query(DeviceToken)
        .filter(DeviceToken.user_id == current_user.id)
        .order_by(DeviceToken.last_seen_at.desc())
        .all()
    )


@router.get("/push-status", response_model=PushStatusResponse)
def push_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Whether background push is usable at all. The admin panel and the mobile
    settings screen use this to explain why notifications are quiet.
    """
    active = (
        db.query(DeviceToken)
        .filter(DeviceToken.user_id == current_user.id, DeviceToken.is_active.is_(True))
        .count()
    )
    return PushStatusResponse(
        configured=push_service.is_configured(),
        project_id=push_service.project_id(),
        active_devices=active,
    )


@router.post("/test")
def send_test_push(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sends a test notification to the agent's own devices."""
    if not push_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Push is not configured on the server (FCM_SERVICE_ACCOUNT_JSON is unset).",
        )

    sent = push_service.notify_user(
        db,
        current_user.id,
        "Test notification",
        "Push notifications are working on this device.",
        {"route": "/dashboard"},
    )
    if sent == 0:
        raise HTTPException(
            status_code=404,
            detail="No active devices registered. Open the mobile app and allow notifications.",
        )
    return {"status": "sent", "devices": sent}
