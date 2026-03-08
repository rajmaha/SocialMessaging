# backend/app/routes/logs.py
import csv
import io
import json
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.log_database import get_log_db
from app.models.logs import AuditLog, ErrorLog
from app.database import get_db
from app.models.user import User

class FrontendErrorPayload(BaseModel):
    message: str
    error_type: Optional[str] = None
    stack: Optional[str] = None
    url: Optional[str] = None
    line: Optional[int] = None
    col: Optional[int] = None
    user_id: Optional[int] = None


router = APIRouter(prefix="/logs", tags=["logs"])


def _require_admin(authorization: str = Header(None), db: Session = Depends(get_db)) -> User:
    """Verify the caller is an admin. Raises 401/403 otherwise."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid auth header")
    token = parts[1]
    try:
        user_id = int(token)
        user = db.query(User).filter(User.id == user_id).first()
    except ValueError:
        import jwt as _jwt
        from app.config import settings
        payload = _jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/audit")
def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    log_db: Session = Depends(get_log_db),
    _admin: User = Depends(_require_admin),
):
    q = log_db.query(AuditLog)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if action:
        q = q.filter(AuditLog.action.contains(action))
    if date_from:
        q = q.filter(AuditLog.timestamp >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(AuditLog.timestamp <= datetime.fromisoformat(date_to))
    total = q.count()
    items = q.order_by(AuditLog.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": r.id,
                "timestamp": r.timestamp.strftime("%Y-%m-%dT%H:%M:%S") if r.timestamp else None,
                "user_id": r.user_id,
                "user_email": r.user_email,
                "user_role": r.user_role,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "detail": json.loads(r.detail) if r.detail else None,
                "ip_address": r.ip_address,
                "request_path": r.request_path,
                "request_method": r.request_method,
            }
            for r in items
        ],
    }


@router.get("/errors")
def list_error_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    severity: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    log_db: Session = Depends(get_log_db),
    _admin: User = Depends(_require_admin),
):
    q = log_db.query(ErrorLog)
    if severity:
        q = q.filter(ErrorLog.severity == severity)
    if source:
        q = q.filter(ErrorLog.source == source)
    if date_from:
        q = q.filter(ErrorLog.timestamp >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(ErrorLog.timestamp <= datetime.fromisoformat(date_to))
    total = q.count()
    items = q.order_by(ErrorLog.timestamp.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": r.id,
                "timestamp": r.timestamp.strftime("%Y-%m-%dT%H:%M:%S") if r.timestamp else None,
                "severity": r.severity,
                "source": r.source,
                "error_type": r.error_type,
                "message": r.message,
                "traceback": r.traceback,
                "user_id": r.user_id,
                "request_path": r.request_path,
                "request_method": r.request_method,
                "context": json.loads(r.context) if r.context else None,
            }
            for r in items
        ],
    }


@router.get("/audit/export")
def export_audit_logs(
    user_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    log_db: Session = Depends(get_log_db),
    _admin: User = Depends(_require_admin),
):
    q = log_db.query(AuditLog)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if action:
        q = q.filter(AuditLog.action.contains(action))
    if date_from:
        q = q.filter(AuditLog.timestamp >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(AuditLog.timestamp <= datetime.fromisoformat(date_to))
    rows = q.order_by(AuditLog.timestamp.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "timestamp", "user_id", "user_email", "user_role", "action",
                     "entity_type", "entity_id", "detail", "ip_address", "request_path", "request_method"])
    for r in rows:
        writer.writerow([r.id, r.timestamp, r.user_id, r.user_email, r.user_role, r.action,
                         r.entity_type, r.entity_id, r.detail, r.ip_address, r.request_path, r.request_method])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_logs.csv"},
    )


@router.get("/errors/export")
def export_error_logs(
    severity: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    log_db: Session = Depends(get_log_db),
    _admin: User = Depends(_require_admin),
):
    q = log_db.query(ErrorLog)
    if severity:
        q = q.filter(ErrorLog.severity == severity)
    if source:
        q = q.filter(ErrorLog.source == source)
    if date_from:
        q = q.filter(ErrorLog.timestamp >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(ErrorLog.timestamp <= datetime.fromisoformat(date_to))
    rows = q.order_by(ErrorLog.timestamp.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "timestamp", "severity", "source", "error_type", "message", "traceback",
                     "user_id", "request_path", "request_method", "context"])
    for r in rows:
        writer.writerow([r.id, r.timestamp, r.severity, r.source, r.error_type, r.message, r.traceback,
                         r.user_id, r.request_path, r.request_method, r.context])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=error_logs.csv"},
    )


@router.post("/frontend-error")
def receive_frontend_error(
    payload: FrontendErrorPayload,
    request: Request,
    log_db: Session = Depends(get_log_db),
):
    """Unauthenticated endpoint for frontend JS error capture."""
    from app.services.log_service import log_error
    log_error(
        log_db,
        message=payload.message,
        source="frontend",
        severity="error",
        error_type=payload.error_type or "JavaScriptError",
        user_id=payload.user_id,
        request_path=payload.url,
        context={
            "stack": payload.stack,
            "user_agent": request.headers.get("user-agent"),
            "col": payload.col,
            "line": payload.line,
        },
    )
    return {"ok": True}
