from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.calendar_settings import CalendarIntegrationSettings
from app.models.user import User

router = APIRouter(prefix="/api/calendar/settings", tags=["calendar-settings"])

require_settings = require_admin_feature("feature_manage_branding")

MASK = "***"


class CalendarSettingsUpdate(BaseModel):
    google_enabled: Optional[bool] = None
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    microsoft_enabled: Optional[bool] = None
    microsoft_client_id: Optional[str] = None
    microsoft_client_secret: Optional[str] = None
    microsoft_tenant_id: Optional[str] = None


def _get_or_create(db: Session) -> CalendarIntegrationSettings:
    row = db.query(CalendarIntegrationSettings).first()
    if not row:
        row = CalendarIntegrationSettings()
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("")
def get_calendar_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _admin=Depends(require_settings),
):
    """Admin-only: get calendar integration settings (secrets masked)."""
    row = _get_or_create(db)
    return {
        "google_enabled": row.google_enabled,
        "google_client_id": row.google_client_id or "",
        "google_client_secret": MASK if row.google_client_secret else "",
        "microsoft_enabled": row.microsoft_enabled,
        "microsoft_client_id": row.microsoft_client_id or "",
        "microsoft_client_secret": MASK if row.microsoft_client_secret else "",
        "microsoft_tenant_id": row.microsoft_tenant_id or "common",
    }


@router.put("")
def update_calendar_settings(
    data: CalendarSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _admin=Depends(require_settings),
):
    """Admin-only: update calendar integration settings."""
    row = _get_or_create(db)

    for field, value in data.dict(exclude_unset=True).items():
        # Skip masked secrets — user didn't change them
        if value == MASK:
            continue
        setattr(row, field, value)

    db.commit()
    db.refresh(row)

    return {"status": "success", "message": "Calendar settings updated"}


@router.get("/status")
def get_calendar_provider_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Any authenticated user: check which calendar providers are enabled."""
    row = _get_or_create(db)
    return {
        "google_enabled": row.google_enabled and bool(row.google_client_id and row.google_client_secret),
        "microsoft_enabled": row.microsoft_enabled and bool(row.microsoft_client_id and row.microsoft_client_secret),
    }
