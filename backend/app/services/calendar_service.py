"""
Calendar sync service for Google Calendar and Microsoft Graph.
Handles OAuth token management and CRUD on calendar events.
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import requests
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID", "")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET", "")
MICROSOFT_TENANT_ID = os.getenv("MICROSOFT_TENANT_ID", "common")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


class CalendarService:

    # ── Google Calendar ──────────────────────────────────────────────────

    def get_google_auth_url(self, user_id: int) -> str:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/google"
        scope = "https://www.googleapis.com/auth/calendar.events"
        return (
            f"https://accounts.google.com/o/oauth2/v2/auth"
            f"?client_id={GOOGLE_CLIENT_ID}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={scope}"
            f"&access_type=offline"
            f"&prompt=consent"
            f"&state={user_id}"
        )

    def exchange_google_code(self, code: str) -> dict:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/google"
        resp = requests.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        resp.raise_for_status()
        return resp.json()

    def refresh_google_token(self, refresh_token: str) -> dict:
        resp = requests.post("https://oauth2.googleapis.com/token", data={
            "refresh_token": refresh_token,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "grant_type": "refresh_token",
        })
        resp.raise_for_status()
        return resp.json()

    def _google_create_event(self, access_token: str, summary: str, description: str, start: datetime, calendar_id: str = "primary") -> str:
        end = start + timedelta(hours=1)
        body = {
            "summary": summary,
            "description": description or "",
            "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
        }
        resp = requests.post(
            f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
        resp.raise_for_status()
        return resp.json()["id"]

    def _google_update_event(self, access_token: str, event_id: str, summary: str, description: str, start: datetime, calendar_id: str = "primary"):
        end = start + timedelta(hours=1)
        body = {
            "summary": summary,
            "description": description or "",
            "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
        }
        resp = requests.patch(
            f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
        resp.raise_for_status()

    def _google_delete_event(self, access_token: str, event_id: str, calendar_id: str = "primary"):
        resp = requests.delete(
            f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code not in (200, 204, 404, 410):
            resp.raise_for_status()

    # ── Microsoft Graph ──────────────────────────────────────────────────

    def get_microsoft_auth_url(self, user_id: int) -> str:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/microsoft"
        scope = "Calendars.ReadWrite offline_access"
        return (
            f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize"
            f"?client_id={MICROSOFT_CLIENT_ID}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={scope}"
            f"&state={user_id}"
        )

    def exchange_microsoft_code(self, code: str) -> dict:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/microsoft"
        resp = requests.post(
            f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/token",
            data={
                "code": code,
                "client_id": MICROSOFT_CLIENT_ID,
                "client_secret": MICROSOFT_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": "Calendars.ReadWrite offline_access",
            },
        )
        resp.raise_for_status()
        return resp.json()

    def refresh_microsoft_token(self, refresh_token: str) -> dict:
        resp = requests.post(
            f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/token",
            data={
                "refresh_token": refresh_token,
                "client_id": MICROSOFT_CLIENT_ID,
                "client_secret": MICROSOFT_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "scope": "Calendars.ReadWrite offline_access",
            },
        )
        resp.raise_for_status()
        return resp.json()

    def _ms_create_event(self, access_token: str, summary: str, description: str, start: datetime) -> str:
        end = start + timedelta(hours=1)
        body = {
            "subject": summary,
            "body": {"contentType": "text", "content": description or ""},
            "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
            "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        }
        resp = requests.post(
            "https://graph.microsoft.com/v1.0/me/events",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()
        return resp.json()["id"]

    def _ms_update_event(self, access_token: str, event_id: str, summary: str, description: str, start: datetime):
        end = start + timedelta(hours=1)
        body = {
            "subject": summary,
            "body": {"contentType": "text", "content": description or ""},
            "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
            "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        }
        resp = requests.patch(
            f"https://graph.microsoft.com/v1.0/me/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()

    def _ms_delete_event(self, access_token: str, event_id: str):
        resp = requests.delete(
            f"https://graph.microsoft.com/v1.0/me/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    # ── Unified helpers (called from routes) ─────────────────────────────

    def _get_connections(self, user_id: int, db: Session):
        from app.models.calendar_connection import UserCalendarConnection
        return db.query(UserCalendarConnection).filter(
            UserCalendarConnection.user_id == user_id,
        ).all()

    def _ensure_fresh_token(self, conn, db: Session) -> str:
        """Refresh token if expired and return a valid access_token."""
        now = datetime.utcnow()
        if conn.token_expires_at and conn.token_expires_at > now:
            return conn.access_token

        if conn.provider == "google":
            data = self.refresh_google_token(conn.refresh_token)
        else:
            data = self.refresh_microsoft_token(conn.refresh_token)

        conn.access_token = data["access_token"]
        conn.token_expires_at = now + timedelta(seconds=data.get("expires_in", 3600))
        if data.get("refresh_token"):
            conn.refresh_token = data["refresh_token"]
        db.commit()
        return conn.access_token

    def create_event(self, reminder, user_id: int, db: Session):
        if not reminder.due_date:
            return
        for conn in self._get_connections(user_id, db):
            try:
                token = self._ensure_fresh_token(conn, db)
                if conn.provider == "google":
                    event_id = self._google_create_event(
                        token, reminder.title, reminder.description, reminder.due_date,
                        conn.calendar_id or "primary",
                    )
                    reminder.google_event_id = event_id
                elif conn.provider == "microsoft":
                    event_id = self._ms_create_event(
                        token, reminder.title, reminder.description, reminder.due_date,
                    )
                    reminder.microsoft_event_id = event_id
                db.commit()
            except Exception as e:
                logger.warning("Calendar create failed (%s): %s", conn.provider, e)

    def update_event(self, reminder, user_id: int, db: Session):
        if not reminder.due_date:
            return
        for conn in self._get_connections(user_id, db):
            try:
                token = self._ensure_fresh_token(conn, db)
                if conn.provider == "google" and reminder.google_event_id:
                    self._google_update_event(
                        token, reminder.google_event_id, reminder.title,
                        reminder.description, reminder.due_date,
                        conn.calendar_id or "primary",
                    )
                elif conn.provider == "microsoft" and reminder.microsoft_event_id:
                    self._ms_update_event(
                        token, reminder.microsoft_event_id, reminder.title,
                        reminder.description, reminder.due_date,
                    )
            except Exception as e:
                logger.warning("Calendar update failed (%s): %s", conn.provider, e)

    def delete_event(self, reminder, user_id: int, db: Session):
        for conn in self._get_connections(user_id, db):
            try:
                token = self._ensure_fresh_token(conn, db)
                if conn.provider == "google" and reminder.google_event_id:
                    self._google_delete_event(token, reminder.google_event_id, conn.calendar_id or "primary")
                    reminder.google_event_id = None
                elif conn.provider == "microsoft" and reminder.microsoft_event_id:
                    self._ms_delete_event(token, reminder.microsoft_event_id)
                    reminder.microsoft_event_id = None
                db.commit()
            except Exception as e:
                logger.warning("Calendar delete failed (%s): %s", conn.provider, e)

    def refresh_all_expiring_tokens(self, db: Session) -> int:
        """Background job: refresh tokens expiring within 10 minutes."""
        from app.models.calendar_connection import UserCalendarConnection
        soon = datetime.utcnow() + timedelta(minutes=10)
        expiring = db.query(UserCalendarConnection).filter(
            UserCalendarConnection.token_expires_at <= soon,
            UserCalendarConnection.refresh_token != None,
        ).all()
        refreshed = 0
        for conn in expiring:
            try:
                self._ensure_fresh_token(conn, db)
                refreshed += 1
            except Exception as e:
                logger.warning("Token refresh failed for user %d (%s): %s", conn.user_id, conn.provider, e)
        return refreshed


calendar_service = CalendarService()
