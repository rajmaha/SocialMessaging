"""
Counting attempts for rate limits, in the support_attempts table.

    if rate_limit.count(db, "otp_wrong", email, minutes=15) >= 5: refuse
    rate_limit.hit(db, "otp_wrong", email)

Rows older than a day are swept now and then by hit(); nothing reads them.
"""

import random
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.support import SupportAttempt

KEY_MAX = 255


def client_ip(request) -> str:
    """The caller's address: nginx's X-Real-IP where it set one, else the socket's."""
    if request is None:
        return ""
    real = (request.headers.get("x-real-ip") or "").strip()
    if real:
        return real[:64]
    return (request.client.host if request.client else "")[:64]


def count(db: Session, kind: str, key: str, minutes: int) -> int:
    if not key:
        return 0
    since = datetime.utcnow() - timedelta(minutes=minutes)
    return (db.query(SupportAttempt)
            .filter(SupportAttempt.kind == kind, SupportAttempt.key == str(key)[:KEY_MAX],
                    SupportAttempt.created_at >= since)
            .count())


def hit(db: Session, kind: str, key: str, commit: bool = True) -> None:
    if not key:
        return
    db.add(SupportAttempt(kind=kind, key=str(key)[:KEY_MAX], created_at=datetime.utcnow()))
    if random.random() < 0.02:
        db.query(SupportAttempt).filter(
            SupportAttempt.created_at < datetime.utcnow() - timedelta(days=1)).delete(synchronize_session=False)
    if commit:
        db.commit()


def clear(db: Session, kind: str, key: str, commit: bool = True) -> None:
    if not key:
        return
    db.query(SupportAttempt).filter(SupportAttempt.kind == kind,
                                    SupportAttempt.key == str(key)[:KEY_MAX]).delete(synchronize_session=False)
    if commit:
        db.commit()
