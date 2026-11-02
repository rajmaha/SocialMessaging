"""
Who is raising a support request.

A site with its own logins (OMS, or any other) signs the signed-in person on
its own server and hands the token to the widget or its app:

    payload = base64url(json({"site": <widget key>, "uid": "...", "name": "...",
                              "email": "...", "phone": "...", "exp": <unix seconds>}))
              -- URL-safe alphabet, no "=" padding
    token   = payload + "." + hex(HMAC-SHA256(identity secret, payload))

`exp` may be at most 10 minutes ahead. The signature is over the base64 text
exactly as sent, so the JSON's key order and spacing do not matter. The
identity secret is the widget domain's (Widget Domains -> Support -> Make
secret); only the site's server and SocialMessaging know it.

A site without logins leaves visitors anonymous: they verify an email with the
webchat code (/webchat/request-otp, verify-otp) and support_user_for_email()
finds them by it.
"""

import base64
import binascii
import hashlib
import hmac
import json
import re
import time
from datetime import datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.support import SupportUser
from app.models.widget_domain import WidgetDomain
from app.services import secret_box

MAX_TOKEN_LENGTH = 4096
MAX_AHEAD_SECONDS = 600       # a token may live 10 minutes
CLOCK_LEEWAY_SECONDS = 60     # the site's clock may be a minute off ours
UID_MAX = 200
NAME_MAX = 200
EMAIL_MAX = 255
PHONE_MAX = 30

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SIG_RE = re.compile(r"^[0-9a-f]{64}$")


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(secret: str, payload: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).hexdigest()


def sign(secret: str, claims: dict) -> str:
    """A token for claims, as a site's server makes one. Used by tests and the docs' examples."""
    payload = _b64encode(json.dumps(claims, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    return payload + "." + _mac(secret, payload)


def _clean_text(value, limit: int) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, (str, int)):
        return None
    text = re.sub(r"<[^>]*>", "", str(value)).strip()
    return text[:limit] or None


def _clean_email(value) -> Optional[str]:
    text = _clean_text(value, EMAIL_MAX)
    if not text:
        return None
    text = text.lower()
    return text if _EMAIL_RE.match(text) else None


def verify_with_secret(secret: Optional[str], widget_key: str, token, now: Optional[float] = None) -> Optional[dict]:
    """
    The token's claims, tidied, when it is genuine and current for this widget
    key; otherwise None. Never raises: every way a token can be wrong answers
    the same None, so a caller cannot tell a bad signature from an expired one.
    """
    if not secret or not widget_key or not isinstance(token, str):
        return None
    if not token or len(token) > MAX_TOKEN_LENGTH or token.count(".") != 1:
        return None
    payload, sig = token.split(".", 1)
    if not payload or not _SIG_RE.match(sig):
        return None
    if not hmac.compare_digest(_mac(secret, payload), sig):
        return None
    try:
        claims = json.loads(_b64decode(payload).decode("utf-8"))
    except (binascii.Error, ValueError, UnicodeError):
        return None
    if not isinstance(claims, dict):
        return None

    now = time.time() if now is None else now
    exp = claims.get("exp")
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return None
    if exp <= now - CLOCK_LEEWAY_SECONDS or exp > now + MAX_AHEAD_SECONDS + CLOCK_LEEWAY_SECONDS:
        return None

    site = claims.get("site")
    if not isinstance(site, str) or not hmac.compare_digest(site, widget_key):
        return None

    uid = claims.get("uid")
    if not isinstance(uid, (str, int)) or isinstance(uid, bool):
        return None
    uid = str(uid).strip()
    if not uid or len(uid) > UID_MAX:
        return None

    return {
        "site": site,
        "uid": uid,
        "name": _clean_text(claims.get("name"), NAME_MAX),
        "email": _clean_email(claims.get("email")),
        "phone": _clean_text(claims.get("phone"), PHONE_MAX),
        "exp": int(exp),
    }


def verify(domain: WidgetDomain, token, now: Optional[float] = None) -> Optional[dict]:
    """verify_with_secret() against this widget domain's own sealed secret."""
    if domain is None or not domain.is_active:
        return None
    return verify_with_secret(secret_box.open_(domain.identity_secret), domain.widget_key, token, now)


def _find_or_make(db: Session, domain: WidgetDomain, conditions: list, fields: dict) -> SupportUser:
    """
    The SupportUser matching conditions, made if missing, with fields refreshed
    (a None field leaves what is stored). Two requests at once make one row:
    the unique indexes refuse the second insert and it reads the first.
    """
    def find():
        return (db.query(SupportUser)
                .filter(SupportUser.widget_domain_id == domain.id, *conditions)
                .first())

    user = find()
    if user is None:
        try:
            with db.begin_nested():
                user = SupportUser(widget_domain_id=domain.id, **fields)
                db.add(user)
        except IntegrityError:
            user = find()
            if user is None:
                raise
    for key, value in fields.items():
        if value is not None and getattr(user, key) != value:
            setattr(user, key, value)
    user.last_seen_at = datetime.utcnow()
    db.flush()
    return user


def support_user_for(db: Session, domain: WidgetDomain, claims: dict) -> SupportUser:
    """The person a verified token names, with name, email and phone refreshed from it."""
    return _find_or_make(
        db, domain,
        [SupportUser.uid == claims["uid"]],
        {"uid": claims["uid"], "name": claims.get("name"),
         "email": claims.get("email"), "phone": claims.get("phone")},
    )


def support_user_for_email(db: Session, domain: WidgetDomain, email, name=None) -> Optional[SupportUser]:
    """An anonymous visitor, by the email the webchat code verified. None for a bad address."""
    email = _clean_email(email)
    if not email:
        return None
    return _find_or_make(
        db, domain,
        [SupportUser.uid.is_(None), SupportUser.email == email],
        {"email": email, "name": _clean_text(name, NAME_MAX)},
    )
