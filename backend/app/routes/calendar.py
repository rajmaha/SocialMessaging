from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import os

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.calendar_connection import UserCalendarConnection
from app.services.calendar_service import calendar_service
from app.schemas.calendar import CalendarStatusResponse, CalendarConnectionResponse

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

router = APIRouter(
    prefix="/api/calendar",
    tags=["calendar"],
)


@router.get("/connect/{provider}")
def connect_calendar(
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initiate OAuth flow for Google or Microsoft calendar."""
    if provider == "google":
        url = calendar_service.get_google_auth_url(current_user.id, db)
    elif provider == "microsoft":
        url = calendar_service.get_microsoft_auth_url(current_user.id, db)
    else:
        raise HTTPException(400, "Provider must be 'google' or 'microsoft'")
    return {"auth_url": url}


@router.get("/callback/google")
def google_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle Google OAuth callback."""
    try:
        user_id = int(state)
    except ValueError:
        raise HTTPException(400, "Invalid state parameter")

    token_data = calendar_service.exchange_google_code(code, db)

    # Upsert connection
    conn = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == user_id,
        UserCalendarConnection.provider == "google",
    ).first()
    if not conn:
        conn = UserCalendarConnection(user_id=user_id, provider="google")
        db.add(conn)

    conn.access_token = token_data["access_token"]
    conn.refresh_token = token_data.get("refresh_token", conn.refresh_token)
    conn.token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
    conn.calendar_id = "primary"
    db.commit()

    return RedirectResponse(f"{FRONTEND_URL}/settings?tab=calendar&connected=google")


@router.get("/callback/microsoft")
def microsoft_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle Microsoft OAuth callback."""
    try:
        user_id = int(state)
    except ValueError:
        raise HTTPException(400, "Invalid state parameter")

    token_data = calendar_service.exchange_microsoft_code(code, db)

    conn = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == user_id,
        UserCalendarConnection.provider == "microsoft",
    ).first()
    if not conn:
        conn = UserCalendarConnection(user_id=user_id, provider="microsoft")
        db.add(conn)

    conn.access_token = token_data["access_token"]
    conn.refresh_token = token_data.get("refresh_token", conn.refresh_token)
    conn.token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
    db.commit()

    return RedirectResponse(f"{FRONTEND_URL}/settings?tab=calendar&connected=microsoft")


@router.get("/status", response_model=CalendarStatusResponse)
def calendar_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check which calendars are connected."""
    conns = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == current_user.id,
    ).all()
    result = {"google": None, "microsoft": None}
    for c in conns:
        result[c.provider] = {
            "id": c.id,
            "provider": c.provider,
            "calendar_id": c.calendar_id,
            "connected": True,
            "created_at": c.created_at,
        }
    return result


@router.delete("/disconnect/{provider}", status_code=204)
def disconnect_calendar(
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Disconnect a calendar provider."""
    conn = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == current_user.id,
        UserCalendarConnection.provider == provider,
    ).first()
    if conn:
        db.delete(conn)
        db.commit()
