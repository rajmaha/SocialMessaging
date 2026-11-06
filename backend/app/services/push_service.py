"""
Push notifications to the mobile app (FCM HTTP v1)
==================================================

The app reaches an agent in two ways. While it is running, events already
travel over the WebSocket in `app/routes/events.py` and the WebView raises a
local notification itself -- nothing here is involved. This module is for the
other case: the app is **killed or swapped out**, and only the OS push
services can wake it.

Android goes through FCM directly; iOS goes through FCM too, which relays to
APNs using the APNs key uploaded to the Firebase project. So one credential
covers both platforms: a Google service-account JSON for the Firebase project.

Configuration (either one, checked in this order):

    FCM_SERVICE_ACCOUNT_JSON   the whole JSON, inline (easiest in compose)
    FCM_SERVICE_ACCOUNT_FILE   a path to the JSON file

With neither set, `is_configured()` is False and every send is a silent
no-op -- the app still works, it just has no background notifications. That
keeps a deployment without Firebase from erroring on every new message.

NOTE: a new backend setting must also be named in docker-compose.yml's backend
`environment:` block, or the container never sees it (see CLAUDE.md).
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence

import jwt
import requests
from sqlalchemy.orm import Session

from app.config import settings
from app.models.device_token import DeviceToken

log = logging.getLogger(__name__)

_GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_FCM_SEND_URL = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"

# FCM error codes that mean "this token will never work again".
_DEAD_TOKEN_CODES = {"UNREGISTERED", "INVALID_ARGUMENT", "SENDER_ID_MISMATCH"}

_REQUEST_TIMEOUT = 10  # seconds


# ── Credentials ─────────────────────────────────────────────────────────────

_credentials_cache: Optional[Dict[str, Any]] = None
_credentials_checked = False


def _service_account() -> Optional[Dict[str, Any]]:
    """The parsed service-account JSON, or None when push is not configured."""
    global _credentials_cache, _credentials_checked
    if _credentials_checked:
        return _credentials_cache

    _credentials_checked = True
    raw: Optional[str] = None

    inline = getattr(settings, "FCM_SERVICE_ACCOUNT_JSON", None)
    path = getattr(settings, "FCM_SERVICE_ACCOUNT_FILE", None)

    if inline:
        raw = inline
    elif path:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError as err:
            log.warning("Push disabled: cannot read FCM_SERVICE_ACCOUNT_FILE %s (%s)", path, err)
            return None

    if not raw:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        log.warning("Push disabled: FCM service account is not valid JSON (%s)", err)
        return None

    missing = [k for k in ("client_email", "private_key", "project_id") if not data.get(k)]
    if missing:
        log.warning("Push disabled: FCM service account is missing %s", ", ".join(missing))
        return None

    _credentials_cache = data
    return data


def is_configured() -> bool:
    """True when a usable FCM service account is present."""
    return _service_account() is not None


def project_id() -> Optional[str]:
    acct = _service_account()
    return acct.get("project_id") if acct else None


# ── OAuth access token ──────────────────────────────────────────────────────

_token_lock = threading.Lock()
_access_token: Optional[str] = None
_access_token_expires_at: float = 0.0


def _get_access_token() -> Optional[str]:
    """
    A bearer token for the FCM API, minted from the service account.

    Google's tokens last an hour; we refresh a minute early and cache under a
    lock so a burst of notifications does not mint a token each.
    """
    global _access_token, _access_token_expires_at

    acct = _service_account()
    if not acct:
        return None

    with _token_lock:
        if _access_token and time.time() < _access_token_expires_at:
            return _access_token

        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": acct["client_email"],
                "scope": _FCM_SCOPE,
                "aud": _GOOGLE_TOKEN_URI,
                "iat": now,
                "exp": now + 3600,
            },
            acct["private_key"],
            algorithm="RS256",
        )

        try:
            resp = requests.post(
                _GOOGLE_TOKEN_URI,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
                timeout=_REQUEST_TIMEOUT,
            )
        except requests.RequestException as err:
            log.warning("FCM token request failed: %s", err)
            return None

        if resp.status_code != 200:
            log.warning("FCM token request rejected (%s): %s", resp.status_code, resp.text[:300])
            return None

        payload = resp.json()
        _access_token = payload.get("access_token")
        # Refresh 60s early so a token never expires mid-flight.
        _access_token_expires_at = time.time() + int(payload.get("expires_in", 3600)) - 60
        return _access_token


# ── Sending ─────────────────────────────────────────────────────────────────

def _build_message(
    token: str,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    One FCM v1 message.

    `data` values must all be strings, so everything is coerced. The same keys
    the WebView reads from a local notification are used here
    (conversation_id / ticket_number / email_id / route), so
    `routeForNotification()` in NativeShell handles both without branching.
    """
    string_data = {k: str(v) for k, v in (data or {}).items() if v is not None}

    return {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": string_data,
            "android": {
                "priority": "high",
                "notification": {
                    "icon": "ic_stat_icon_config_sample",
                    "color": "#2563EB",
                    # Collapses repeat alerts for one thread into one banner.
                    "tag": string_data.get("conversation_id") or string_data.get("ticket_number") or "inbox",
                    "default_sound": True,
                },
            },
            "apns": {
                "headers": {"apns-priority": "10"},
                "payload": {
                    "aps": {
                        "sound": "default",
                        "thread-id": string_data.get("conversation_id", "inbox"),
                    }
                },
            },
        }
    }


def send_to_tokens(
    tokens: Sequence[str],
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """
    Sends one notification to each token.

    Returns the tokens FCM rejected as permanently dead, so the caller can
    deactivate them. FCM v1 has no multicast endpoint, so this is one request
    per device; agent device counts are small (a phone or two each), and this
    runs off the request path.
    """
    if not tokens:
        return []

    access_token = _get_access_token()
    pid = project_id()
    if not access_token or not pid:
        return []

    url = _FCM_SEND_URL.format(project_id=pid)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; UTF-8",
    }

    dead: List[str] = []
    for token in tokens:
        try:
            resp = requests.post(
                url,
                headers=headers,
                json=_build_message(token, title, body, data),
                timeout=_REQUEST_TIMEOUT,
            )
        except requests.RequestException as err:
            # Network blip: keep the token, it will be tried again next time.
            log.warning("FCM send failed (network): %s", err)
            continue

        if resp.status_code == 200:
            continue

        # Pull the machine-readable reason out of the error envelope.
        code = ""
        try:
            details = resp.json().get("error", {}).get("details", [])
            for d in details:
                if d.get("@type", "").endswith("FcmError"):
                    code = d.get("errorCode", "")
                    break
            if not code:
                code = resp.json().get("error", {}).get("status", "")
        except (ValueError, AttributeError):
            pass

        if code in _DEAD_TOKEN_CODES or resp.status_code == 404:
            dead.append(token)
            log.info("FCM token is dead (%s) — deactivating", code or resp.status_code)
        else:
            log.warning("FCM send rejected (%s/%s): %s", resp.status_code, code, resp.text[:200])

    return dead


def notify_user(
    db: Session,
    user_id: int,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
) -> int:
    """
    Pushes to every active device of one agent.

    Returns the number of devices addressed. Dead tokens are deactivated in
    the same transaction. Never raises: a failed notification must not fail
    the message or assignment that triggered it.
    """
    if not is_configured() or not user_id:
        return 0

    try:
        rows = (
            db.query(DeviceToken)
            .filter(DeviceToken.user_id == user_id, DeviceToken.is_active.is_(True))
            .all()
        )
        tokens = [r.token for r in rows]
        if not tokens:
            return 0

        dead = send_to_tokens(tokens, title, body, data)

        if dead:
            for row in rows:
                if row.token in dead:
                    row.is_active = False
            db.commit()

        return len(tokens) - len(dead)
    except Exception as err:  # pragma: no cover - defensive
        log.warning("notify_user failed for user %s: %s", user_id, err)
        try:
            db.rollback()
        except Exception:
            pass
        return 0


def notify_users(
    db: Session,
    user_ids: Iterable[int],
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
) -> int:
    """notify_user for several agents (e.g. everyone watching an unassigned queue)."""
    total = 0
    for uid in {u for u in user_ids if u}:
        total += notify_user(db, uid, title, body, data)
    return total
