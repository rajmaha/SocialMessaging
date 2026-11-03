"""
Signed sign-in tokens for agents and admins.

A token is a JWT (HS256 under SECRET_KEY) carrying the user id, an expiry and
a short fingerprint of the user's password hash. It is the ONLY thing the API
accepts as an agent's or admin's bearer value: a bare user id, or JSON the
browser wrote, used to be taken at its word, so `Authorization: Bearer 1`
acted as user 1.

- Expiry: TOKEN_TTL_DAYS, matching how long the browser keeps the user signed in.
- Changing the password ends every token issued before it (the fingerprint
  no longer matches), without a new column.
- A deactivated user's token stops working at once (checked on every use).
- Changing SECRET_KEY ends every token: everybody signs in again once.
"""
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from sqlalchemy.orm import Session

from app.config import PLACEHOLDER_SECRET_KEYS, settings
from app.models.user import User

TOKEN_TTL_DAYS = 30
_AUDIENCE = "sm-agent"


def _secret() -> str:
    key = settings.SECRET_KEY or ""
    if not key or key in PLACEHOLDER_SECRET_KEYS:
        raise RuntimeError("SECRET_KEY is not set in .env, so sign-in tokens cannot be issued or checked.")
    return key


def _password_fingerprint(user: User) -> str:
    return hashlib.sha256((user.password_hash or "").encode()).hexdigest()[:16]


def issue_token(user: User, ttl: Optional[timedelta] = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "aud": _AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + (ttl or timedelta(days=TOKEN_TTL_DAYS))).timestamp()),
        "pwd": _password_fingerprint(user),
    }
    return jwt.encode(payload, _secret(), algorithm=settings.ALGORITHM or "HS256")


def user_from_token(token: Optional[str], db: Session) -> Optional[User]:
    """The active user a token names, or None. Never raises on a bad token."""
    if not token or not isinstance(token, str) or token.count(".") != 2:
        return None
    try:
        payload = jwt.decode(
            token,
            _secret(),
            algorithms=[settings.ALGORITHM or "HS256"],
            audience=_AUDIENCE,
            options={"require": ["exp", "sub", "aud"]},
        )
        user_id = int(payload["sub"])
    except Exception:
        # A bad token, or no usable SECRET_KEY: either way nobody is signed in.
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        return None
    if payload.get("pwd") != _password_fingerprint(user):
        return None
    return user


def bearer_value(authorization: Optional[str]) -> Optional[str]:
    """The token from an `Authorization: Bearer <token>` header, or None."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1]
