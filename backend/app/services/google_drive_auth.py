# backend/app/services/google_drive_auth.py
"""
Signing a backup destination in to Google Drive.

The admin presses "Connect Google Drive" on the destination form; a popup goes
to Google, and the callback hands the refresh token back to the form, which
keeps it in the destination's config as `oauth_token`. The Google client is the
one set up for Calendar (Admin -> Calendar settings), else the
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET environment settings.

The scope is drive.file: the app sees only files and folders it created itself,
which needs no Google verification. So backups go to a folder the app creates
("SocialMessaging Backups") unless the admin names one the app made.
"""
import base64
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import requests

from app.config import settings

SCOPES = "https://www.googleapis.com/auth/drive.file"
STATE_SECONDS = 600


def client_credentials() -> tuple:
    """(client_id, client_secret) of the site's Google OAuth client."""
    client_id = client_secret = None
    try:
        from app.database import SessionLocal
        from app.models.calendar_settings import CalendarIntegrationSettings
        db = SessionLocal()
        try:
            row = db.query(CalendarIntegrationSettings).first()
            if row:
                client_id, client_secret = row.google_client_id, row.google_client_secret
        finally:
            db.close()
    except Exception:
        pass
    client_id = client_id or settings.GOOGLE_CLIENT_ID
    client_secret = client_secret or settings.GOOGLE_CLIENT_SECRET
    if not client_id or not client_secret:
        raise ValueError(
            "No Google client is set up. Enter the Google Client ID and Secret under "
            "Calendar settings first."
        )
    return client_id, client_secret


def redirect_uri() -> str:
    return f"{settings.BACKEND_URL.rstrip('/')}/backups/google/callback"


def _sign(payload: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_state(user_id: int, nonce: str) -> str:
    body = json.dumps({"u": user_id, "n": nonce, "e": int(time.time()) + STATE_SECONDS}, separators=(",", ":"))
    body = base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")
    return f"{body}.{_sign(body)}"


def read_state(state: str) -> dict:
    """The state's contents, or ValueError when it is forged or expired."""
    try:
        body, sig = state.rsplit(".", 1)
    except ValueError:
        raise ValueError("This sign-in link is not valid.")
    if not hmac.compare_digest(sig, _sign(body)):
        raise ValueError("This sign-in link is not valid.")
    data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    if data.get("e", 0) < time.time():
        raise ValueError("This sign-in took too long. Press Connect Google Drive again.")
    return data


def auth_url(user_id: int, nonce: str) -> str:
    client_id, _ = client_credentials()
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",  # always hand back a refresh token
        "include_granted_scopes": "true",
        "state": make_state(user_id, nonce),
    })


def exchange_code(code: str) -> dict:
    """Swap the callback's code for tokens; answers what a destination keeps."""
    client_id, client_secret = client_credentials()
    resp = requests.post("https://oauth2.googleapis.com/token", data={
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri(),
        "grant_type": "authorization_code",
    }, timeout=20)
    if resp.status_code != 200:
        raise ValueError("Google did not accept the sign-in. Try Connect Google Drive again.")
    tokens = resp.json()
    if not tokens.get("refresh_token"):
        raise ValueError(
            "Google sent no refresh token. Remove SocialMessaging from your Google account's "
            "third-party access, then connect again."
        )
    email = None
    try:
        about = requests.get(
            "https://www.googleapis.com/drive/v3/about",
            params={"fields": "user(emailAddress)"},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
            timeout=20,
        )
        if about.ok:
            email = about.json().get("user", {}).get("emailAddress")
    except Exception:
        pass
    return {"refresh_token": tokens["refresh_token"], "email": email, "connected_at": int(time.time())}
