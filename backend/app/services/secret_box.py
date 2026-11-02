"""
Encrypt a secret before it is stored, decrypt it when it is used.

Used for values the server has to read back -- a support site's identity
secret signs and checks tokens, so it cannot be hashed. Fernet (AES-128-CBC +
HMAC-SHA256) with a key derived from SECRET_KEY, so nothing new has to be
configured; the label keeps these keys apart from the JWTs signed with the
same SECRET_KEY.

Changing SECRET_KEY makes every sealed value unreadable: open_() answers None
and the secret has to be made again (Widget Domains -> Make secret).
"""

import base64
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings

# The placeholder in config.py. Sealing under it would protect nothing.
_DEFAULT_KEY = "your-secret-key-change-in-production"


def _fernet(secret_key: Optional[str] = None, label: str = "support-secret") -> Fernet:
    key = secret_key if secret_key is not None else settings.SECRET_KEY
    derived = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=label.encode("utf-8"),
    ).derive(key.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(derived))


def seal(text: str, *, secret_key: Optional[str] = None, label: str = "support-secret") -> str:
    """The encrypted form of text, safe to store. Refuses the placeholder SECRET_KEY."""
    key = secret_key if secret_key is not None else settings.SECRET_KEY
    if not key or key == _DEFAULT_KEY:
        raise RuntimeError("SECRET_KEY is not set in .env, so secrets cannot be stored safely.")
    return _fernet(key, label).encrypt(text.encode("utf-8")).decode("ascii")


def open_(token: Optional[str], *, secret_key: Optional[str] = None, label: str = "support-secret") -> Optional[str]:
    """The text sealed in token, or None when it is empty, damaged or sealed under another key."""
    if not token:
        return None
    try:
        return _fernet(secret_key, label).decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        return None
