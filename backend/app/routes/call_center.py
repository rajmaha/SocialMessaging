from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, get_admin_user
from app.models.user import User
from app.models.call_center import CallCenterSettings
from app.schemas.call_center import CallCenterSettingsResponse, CallCenterSettingsUpdate

router = APIRouter(
    prefix="/admin/callcenter",
    tags=["admin", "call_center"],
    responses={404: {"description": "Not found"}},
)

@router.get("/settings", response_model=CallCenterSettingsResponse)
def get_call_center_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Get the current call center settings."""
    settings = db.query(CallCenterSettings).first()
    if not settings:
        # Create default empty settings if not existing
        settings = CallCenterSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.post("/settings", response_model=CallCenterSettingsResponse)
def update_call_center_settings(
    settings_update: CallCenterSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Update call center settings."""
    settings = db.query(CallCenterSettings).first()
    if not settings:
        settings = CallCenterSettings()
        db.add(settings)

    if settings_update.application_type is not None:
        settings.application_type = settings_update.application_type
    if settings_update.support_phone is not None:
        settings.support_phone = settings_update.support_phone
    if settings_update.support_email is not None:
        settings.support_email = settings_update.support_email
    if settings_update.working_hours is not None:
        settings.working_hours = settings_update.working_hours

    db.commit()
    db.refresh(settings)
    return settings
