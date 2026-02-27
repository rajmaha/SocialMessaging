from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.telephony import TelephonySettings
from app.schemas.telephony import TelephonySettingsResponse, TelephonySettingsUpdate

router = APIRouter(
    prefix="/admin/telephony",
    tags=["admin", "telephony"],
    responses={404: {"description": "Not found"}},
)

require_telephony = require_admin_feature("feature_manage_telephony")


@router.get("/settings", response_model=TelephonySettingsResponse)
def get_telephony_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Get the current telephony settings."""
    settings = db.query(TelephonySettings).first()
    if not settings:
        settings = TelephonySettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.post("/settings", response_model=TelephonySettingsResponse)
def update_telephony_settings(
    settings_update: TelephonySettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Update telephony settings including FreePBX REST API credentials."""
    settings = db.query(TelephonySettings).first()
    if not settings:
        settings = TelephonySettings()
        db.add(settings)

    if settings_update.pbx_type is not None:
        settings.pbx_type = settings_update.pbx_type
    if settings_update.host is not None:
        settings.host = settings_update.host
    if settings_update.port is not None:
        settings.port = settings_update.port
    if settings_update.ami_username is not None:
        settings.ami_username = settings_update.ami_username
    if settings_update.ami_secret is not None:
        settings.ami_secret = settings_update.ami_secret
    if settings_update.webrtc_wss_url is not None:
        settings.webrtc_wss_url = settings_update.webrtc_wss_url
    if settings_update.freepbx_api_key is not None:
        settings.freepbx_api_key = settings_update.freepbx_api_key
    if settings_update.freepbx_api_secret is not None:
        settings.freepbx_api_secret = settings_update.freepbx_api_secret
    if settings_update.is_active is not None:
        settings.is_active = settings_update.is_active

    db.commit()
    db.refresh(settings)
    return settings


@router.post("/test-freepbx")
def test_freepbx_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Test the FreePBX REST API connection using stored credentials."""
    from app.services.freepbx_service import freepbx_service
    import requests

    settings = db.query(TelephonySettings).first()
    if not settings or not settings.host:
        raise HTTPException(status_code=400, detail="FreePBX host is not configured.")
    if not settings.freepbx_api_key or not settings.freepbx_api_secret:
        raise HTTPException(status_code=400, detail="FreePBX REST API key/secret not configured.")

    token = freepbx_service._get_token(
        settings.host,
        settings.port or 443,
        settings.freepbx_api_key,
        settings.freepbx_api_secret,
    )
    if token:
        return {
            "status": "success",
            "message": f"✅ Connected to FreePBX at {settings.host} successfully.",
        }
    else:
        return {
            "status": "error",
            "message": f"❌ Could not connect to FreePBX at {settings.host}. Check credentials and ensure REST API module is enabled.",
        }
