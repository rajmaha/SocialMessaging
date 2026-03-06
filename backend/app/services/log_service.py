# backend/app/services/log_service.py
import json
import traceback as tb
from datetime import datetime
from typing import Optional, Any
from sqlalchemy.orm import Session
from app.models.logs import AuditLog, ErrorLog


def log_audit(
    db: Session,
    action: str,
    user_id: Optional[int] = None,
    user_email: Optional[str] = None,
    user_role: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    detail: Optional[dict] = None,
    ip_address: Optional[str] = None,
    request_path: Optional[str] = None,
    request_method: Optional[str] = None,
) -> None:
    """Write one audit log entry. Never raises — errors are silently swallowed."""
    try:
        entry = AuditLog(
            timestamp=datetime.utcnow(),
            user_id=user_id,
            user_email=user_email,
            user_role=user_role,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=json.dumps(detail) if detail else None,
            ip_address=ip_address,
            request_path=request_path,
            request_method=request_method,
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()


def log_error(
    db: Session,
    message: str,
    source: str = "api",
    severity: str = "error",
    error_type: Optional[str] = None,
    exc: Optional[Exception] = None,
    user_id: Optional[int] = None,
    request_path: Optional[str] = None,
    request_method: Optional[str] = None,
    context: Optional[dict] = None,
) -> None:
    """Write one error log entry. Never raises."""
    try:
        traceback_str = None
        if exc is not None:
            traceback_str = "".join(tb.format_exception(type(exc), exc, exc.__traceback__))
            if error_type is None:
                error_type = type(exc).__name__
        entry = ErrorLog(
            timestamp=datetime.utcnow(),
            severity=severity,
            source=source,
            error_type=error_type,
            message=message,
            traceback=traceback_str,
            user_id=user_id,
            request_path=request_path,
            request_method=request_method,
            context=json.dumps(context) if context else None,
        )
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()
