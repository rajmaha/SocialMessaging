# Audit Log & Error Log Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a comprehensive audit log (user actions + system operations) and error log (API exceptions, integration failures, background job errors, frontend JS errors) stored in a dedicated SQLite database, retained 90 days, viewable and exportable by admins via two new admin panel pages.

**Architecture:** SQLite at `backend/logs.db` with its own SQLAlchemy engine (`log_database.py`). A `log_service.py` provides `log_audit()` and `log_error()` helpers. A FastAPI global exception handler auto-captures all unhandled errors. Two admin-only frontend pages at `/admin/audit-logs` and `/admin/error-logs` show paginated, filterable, exportable logs. A daily APScheduler job purges entries older than 90 days.

**Tech Stack:** FastAPI, SQLAlchemy (SQLite), Python `traceback` module, APScheduler, Next.js 14 App Router, TailwindCSS, `window.onerror` browser API.

**No test framework exists** — verification is done via Swagger UI at `http://localhost:8000/docs` and browser inspection.

---

## Task 1: Create the SQLite log database module

**Files:**
- Create: `backend/app/log_database.py`

**Step 1: Create the file**

```python
# backend/app/log_database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# SQLite file at backend/logs.db (one level above app/)
_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'logs.db')
LOGS_DATABASE_URL = f"sqlite:///{os.path.abspath(_DB_PATH)}"

log_engine = create_engine(
    LOGS_DATABASE_URL,
    connect_args={"check_same_thread": False}  # required for SQLite with FastAPI
)
LogSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=log_engine)
LogBase = declarative_base()


def get_log_db():
    db = LogSessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_log_db():
    """Create tables in logs.db. Call from main.py at startup."""
    LogBase.metadata.create_all(bind=log_engine)
```

**Step 2: Verify the file saved correctly**

Open `backend/app/log_database.py` and confirm all 5 exports are present: `log_engine`, `LogSessionLocal`, `LogBase`, `get_log_db`, `init_log_db`.

**Step 3: Commit**

```bash
git add backend/app/log_database.py
git commit -m "feat(logs): add SQLite log database engine and session"
```

---

## Task 2: Create the AuditLog and ErrorLog models

**Files:**
- Create: `backend/app/models/logs.py`

**Step 1: Create the models file**

```python
# backend/app/models/logs.py
from sqlalchemy import Column, Integer, String, DateTime, Text
from datetime import datetime
from app.log_database import LogBase


class AuditLog(LogBase):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    user_id = Column(Integer, nullable=True)
    user_email = Column(String, nullable=True)
    user_role = Column(String, nullable=True)
    action = Column(String, nullable=False, index=True)   # e.g. "conversation.assigned"
    entity_type = Column(String, nullable=True)            # e.g. "conversation"
    entity_id = Column(Integer, nullable=True)
    detail = Column(Text, nullable=True)                   # JSON string
    ip_address = Column(String, nullable=True)
    request_path = Column(String, nullable=True)
    request_method = Column(String, nullable=True)


class ErrorLog(LogBase):
    __tablename__ = "error_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    severity = Column(String, nullable=False, default="error")  # error | warning | critical
    source = Column(String, nullable=False, default="api")      # api | background_job | integration | frontend
    error_type = Column(String, nullable=True)
    message = Column(Text, nullable=False)
    traceback = Column(Text, nullable=True)
    user_id = Column(Integer, nullable=True)
    request_path = Column(String, nullable=True)
    request_method = Column(String, nullable=True)
    context = Column(Text, nullable=True)                       # JSON string
```

**Step 2: Register the import in `backend/main.py`**

Find the block of `# noqa: F401` model imports near the top of `main.py` (around line 21–31). Add this line immediately after the last `# noqa` import:

```python
from app.models.logs import AuditLog, ErrorLog  # noqa: F401 — ensures log table creation
```

**Step 3: Call `init_log_db()` in `main.py` startup**

Find the line `_run_inline_migrations()` call (around line 1417). Right before it, add:

```python
# ── Log DB Init ────────────────────────────────────────────────────────────
from app.log_database import init_log_db
init_log_db()
```

**Step 4: Start the backend and verify**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

After startup, confirm `backend/logs.db` exists:
```bash
ls -la backend/logs.db
```
Expected: file exists with non-zero size.

Also confirm the tables:
```bash
cd backend && python3 -c "
import sqlite3, os
conn = sqlite3.connect('logs.db')
print(conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall())
conn.close()
"
```
Expected output: `[('audit_logs',), ('error_logs',)]`

**Step 5: Commit**

```bash
git add backend/app/models/logs.py backend/main.py
git commit -m "feat(logs): add AuditLog and ErrorLog SQLite models"
```

---

## Task 3: Create the log service helpers

**Files:**
- Create: `backend/app/services/log_service.py`

**Step 1: Create the service**

```python
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
```

**Step 2: Verify by importing in a quick test**

```bash
cd backend && python3 -c "from app.services.log_service import log_audit, log_error; print('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/log_service.py
git commit -m "feat(logs): add log_audit and log_error service helpers"
```

---

## Task 4: Add global exception handler + audit calls in auth routes

**Files:**
- Modify: `backend/main.py` (global exception handler + auth audit points)
- Modify: `backend/app/routes/auth.py` (login/logout audit)

**Step 1: Add global exception handler in `main.py`**

Find the line `app = FastAPI(` in `main.py` (around line 1498). After the `app = FastAPI(...)` block closes (after version line), and after the CORS middleware setup, find where routers are included. Add the global handler right after `app = FastAPI(...)` is defined but before routers are included:

```python
# ── Global error handler → writes to error_logs ────────────────────────────
from fastapi import Request as _Request
from fastapi.responses import JSONResponse as _JSONResponse
from app.log_database import LogSessionLocal as _LogSessionLocal
from app.services.log_service import log_error as _log_error

@app.exception_handler(Exception)
async def global_exception_handler(_request: _Request, exc: Exception):
    try:
        _db = _LogSessionLocal()
        _log_error(
            _db,
            message=str(exc),
            source="api",
            severity="error",
            exc=exc,
            request_path=str(_request.url.path),
            request_method=_request.method,
        )
        _db.close()
    except Exception:
        pass
    return _JSONResponse(status_code=500, content={"detail": "Internal server error"})
```

**Step 2: Add audit logging to `auth.py` login endpoint**

Open `backend/app/routes/auth.py`. Find the `/auth/login` route handler. Add these imports at the top of the file (after existing imports):

```python
from app.log_database import LogSessionLocal as _LogSessionLocal
from app.services.log_service import log_audit as _log_audit
```

Inside the login route, after a successful login (where a user is returned/token is set), add:

```python
try:
    _ldb = _LogSessionLocal()
    _log_audit(
        _ldb,
        action="auth.login",
        user_id=user.id,
        user_email=user.email,
        user_role=user.role,
        entity_type="user",
        entity_id=user.id,
    )
    _ldb.close()
except Exception:
    pass
```

For failed login attempts (where HTTPException 401 is raised), add before the raise:

```python
try:
    _ldb = _LogSessionLocal()
    _log_audit(
        _ldb,
        action="auth.login_failed",
        detail={"email": user_data.email},
    )
    _ldb.close()
except Exception:
    pass
```

**Step 3: Verify via Swagger**

Start the backend. Go to `http://localhost:8000/docs`. Try the `/auth/login` endpoint with valid credentials. Then run:

```bash
cd backend && python3 -c "
import sqlite3
conn = sqlite3.connect('logs.db')
rows = conn.execute('SELECT action, user_email, timestamp FROM audit_logs ORDER BY id DESC LIMIT 5').fetchall()
for r in rows: print(r)
conn.close()
"
```
Expected: at least one row with `action='auth.login'`.

**Step 4: Commit**

```bash
git add backend/main.py backend/app/routes/auth.py
git commit -m "feat(logs): add global exception handler and auth audit logging"
```

---

## Task 5: Add audit logging to conversations, messages, and admin routes

**Files:**
- Modify: `backend/app/routes/conversations.py`
- Modify: `backend/app/routes/messages.py`
- Modify: `backend/app/routes/admin.py`

**Step 1: Add imports to each file**

Add at the top of `conversations.py`, `messages.py`, and `admin.py`:

```python
from app.log_database import LogSessionLocal as _LogSessionLocal
from app.services.log_service import log_audit as _log_audit
```

**Step 2: Audit conversation assignment in `conversations.py`**

Find the route that assigns a conversation (look for `assigned_to` update). After the DB commit, add:

```python
try:
    _ldb = _LogSessionLocal()
    _log_audit(
        _ldb,
        action="conversation.assigned",
        entity_type="conversation",
        entity_id=conversation.id,
        detail={"assigned_to": assigned_user_id},
    )
    _ldb.close()
except Exception:
    pass
```

Also audit conversation status changes (open/closed/snoozed). Find where `status` is set on a conversation and add:

```python
try:
    _ldb = _LogSessionLocal()
    _log_audit(
        _ldb,
        action=f"conversation.{new_status}",
        entity_type="conversation",
        entity_id=conversation.id,
    )
    _ldb.close()
except Exception:
    pass
```

**Step 3: Audit message sends in `messages.py`**

Find the route that creates/sends a message. After successful DB commit, add:

```python
try:
    _ldb = _LogSessionLocal()
    _log_audit(
        _ldb,
        action="message.sent",
        entity_type="message",
        entity_id=new_message.id,
        detail={"platform": new_message.platform, "conversation_id": new_message.conversation_id},
    )
    _ldb.close()
except Exception:
    pass
```

**Step 4: Audit user create/update/delete in `admin.py`**

Find the admin routes for creating users, updating users, and deleting users. After each DB commit, add the appropriate audit call:

```python
# After user creation:
_log_audit(_ldb, action="user.created", entity_type="user", entity_id=new_user.id,
           detail={"email": new_user.email, "role": new_user.role})

# After user update:
_log_audit(_ldb, action="user.updated", entity_type="user", entity_id=user.id)

# After user deletion:
_log_audit(_ldb, action="user.deleted", entity_type="user", entity_id=user_id,
           detail={"email": user.email})
```

**Step 5: Commit**

```bash
git add backend/app/routes/conversations.py backend/app/routes/messages.py backend/app/routes/admin.py
git commit -m "feat(logs): add audit logging for conversations, messages, and user admin actions"
```

---

## Task 6: Create the logs API routes

**Files:**
- Create: `backend/app/routes/logs.py`

**Step 1: Create the routes file**

```python
# backend/app/routes/logs.py
import csv
import io
import json
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.log_database import get_log_db
from app.models.logs import AuditLog, ErrorLog
from app.database import get_db
from app.models.user import User

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
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
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
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
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
    writer.writerow(["id", "timestamp", "severity", "source", "error_type", "message",
                     "user_id", "request_path", "request_method", "context"])
    for r in rows:
        writer.writerow([r.id, r.timestamp, r.severity, r.source, r.error_type, r.message,
                         r.user_id, r.request_path, r.request_method, r.context])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=error_logs.csv"},
    )


@router.post("/frontend-error")
def receive_frontend_error(
    payload: dict,
    request: Request,
    log_db: Session = Depends(get_log_db),
):
    """Unauthenticated endpoint for frontend JS error capture."""
    from app.services.log_service import log_error
    log_error(
        log_db,
        message=payload.get("message", "Unknown frontend error"),
        source="frontend",
        severity="error",
        error_type=payload.get("error_type", "JavaScriptError"),
        request_path=payload.get("url"),
        context={
            "stack": payload.get("stack"),
            "user_agent": request.headers.get("user-agent"),
            "col": payload.get("col"),
            "line": payload.get("line"),
        },
    )
    return {"ok": True}
```

**Step 2: Register the router in `main.py`**

At the top of `main.py`, add to the imports block:

```python
from app.routes.logs import router as logs_router
```

In the router include section (where all `app.include_router(...)` calls are), add:

```python
app.include_router(logs_router)
```

**Step 3: Verify via Swagger**

Restart the backend. Go to `http://localhost:8000/docs`. Confirm these endpoints appear:
- `GET /logs/audit`
- `GET /logs/errors`
- `GET /logs/audit/export`
- `GET /logs/errors/export`
- `POST /logs/frontend-error`

Test `GET /logs/audit` with an admin Bearer token. Expected: 200 response with `{"total": ..., "items": [...]}`.

**Step 4: Commit**

```bash
git add backend/app/routes/logs.py backend/main.py
git commit -m "feat(logs): add logs API routes with pagination, filters, and CSV export"
```

---

## Task 7: Add APScheduler daily purge job

**Files:**
- Modify: `backend/main.py`

**Step 1: Add the purge function**

Find the scheduler functions in `main.py` (around the `auto_sync_emails` function area, ~line 1668). Add a new purge function:

```python
def purge_old_logs():
    """Delete audit and error log entries older than 90 days."""
    try:
        from app.log_database import LogSessionLocal as _LogSess
        from app.models.logs import AuditLog, ErrorLog
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(days=90)
        _ldb = _LogSess()
        audit_deleted = _ldb.query(AuditLog).filter(AuditLog.timestamp < cutoff).delete()
        error_deleted = _ldb.query(ErrorLog).filter(ErrorLog.timestamp < cutoff).delete()
        _ldb.commit()
        _ldb.close()
        logger.info("Log purge: deleted %d audit entries, %d error entries older than 90 days",
                    audit_deleted, error_deleted)
    except Exception as e:
        logger.error("Log purge error: %s", e)
```

**Step 2: Register the scheduler job**

Find the section where `scheduler.add_job(...)` calls are made. Add:

```python
scheduler.add_job(purge_old_logs, 'interval', hours=24, id='purge_old_logs')
```

**Step 3: Verify the job is registered**

Start the backend and check logs output on startup. You should see the scheduler starting without errors. The purge itself only runs after 24 hours, but confirm no import errors appear.

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(logs): add daily APScheduler job to purge logs older than 90 days"
```

---

## Task 8: Add frontend global JS error capture

**Files:**
- Modify: `frontend/app/layout.tsx`

**Step 1: Read the current layout.tsx to understand its structure**

Open `frontend/app/layout.tsx` and find where the `<body>` tag and providers are set up.

**Step 2: Add a client component for error capture**

Create a new minimal client component:

```tsx
// frontend/components/GlobalErrorCapture.tsx
'use client';

import { useEffect } from 'react';
import { API_URL } from '@/lib/config';

export default function GlobalErrorCapture() {
  useEffect(() => {
    const sendError = (message: string, stack?: string, url?: string, line?: number, col?: number) => {
      fetch(`${API_URL}/logs/frontend-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, stack, url, line, col, error_type: 'JavaScriptError' }),
      }).catch(() => {}); // swallow any fetch errors silently
    };

    const onError = (event: ErrorEvent) => {
      sendError(event.message, event.error?.stack, event.filename, event.lineno, event.colno);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      sendError(
        reason?.message || String(reason),
        reason?.stack,
        window.location.href,
      );
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
```

**Step 3: Import and render in `layout.tsx`**

In `frontend/app/layout.tsx`, import and add `<GlobalErrorCapture />` inside the `<body>` tag (can be alongside other top-level providers):

```tsx
import GlobalErrorCapture from '@/components/GlobalErrorCapture';

// Inside the JSX body:
<GlobalErrorCapture />
```

**Step 4: Commit**

```bash
git add frontend/components/GlobalErrorCapture.tsx frontend/app/layout.tsx
git commit -m "feat(logs): add global frontend JS error capture and POST to backend"
```

---

## Task 9: Create the Audit Log admin page

**Files:**
- Create: `frontend/app/admin/audit-logs/page.tsx`

**Step 1: Create the page**

```tsx
// frontend/app/admin/audit-logs/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authAPI, getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import MainHeader from '@/components/MainHeader';
import { API_URL } from '@/lib/config';

interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: number | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  request_path: string | null;
  request_method: string | null;
}

export default function AuditLogsPage() {
  const router = useRouter();
  const user = authAPI.getUser();

  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      router.push('/dashboard');
    }
  }, [user, router]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (filterAction) params.set('action', filterAction);
      if (filterUserId) params.set('user_id', filterUserId);
      if (filterFrom) params.set('date_from', filterFrom);
      if (filterTo) params.set('date_to', filterTo);
      const res = await fetch(`${API_URL}/logs/audit?${params}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, filterAction, filterUserId, filterFrom, filterTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (filterAction) params.set('action', filterAction);
    if (filterUserId) params.set('user_id', filterUserId);
    if (filterFrom) params.set('date_from', filterFrom);
    if (filterTo) params.set('date_to', filterTo);
    window.open(`${API_URL}/logs/audit/export?${params}&token=${getAuthToken()}`, '_blank');
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader />
      <div className="flex">
        <AdminNav />
        <main className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">Audit Logs</h1>
            <button
              onClick={exportCsv}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
            >
              Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 bg-white p-4 rounded shadow-sm">
            <input
              type="text"
              placeholder="Filter by action (e.g. auth.login)"
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm w-64"
            />
            <input
              type="text"
              placeholder="Filter by user ID"
              value={filterUserId}
              onChange={e => { setFilterUserId(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm w-36"
            />
            <input
              type="datetime-local"
              value={filterFrom}
              onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={filterTo}
              onChange={e => { setFilterTo(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={() => { setFilterAction(''); setFilterUserId(''); setFilterFrom(''); setFilterTo(''); setPage(1); }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Clear
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                  <th className="px-4 py-3 text-left">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No entries found.</td></tr>
                ) : items.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500 text-xs">{new Date(row.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-2 text-gray-700">{row.user_email || row.user_id || '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{row.user_role || '—'}</td>
                    <td className="px-4 py-2 font-mono text-blue-700">{row.action}</td>
                    <td className="px-4 py-2 text-gray-500">{row.entity_type ? `${row.entity_type} #${row.entity_id}` : '—'}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs max-w-xs truncate">{row.detail ? JSON.stringify(row.detail) : '—'}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs">{row.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <span>{total} total entries</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40">Previous</button>
              <span className="px-3 py-1">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/audit-logs/page.tsx
git commit -m "feat(logs): add admin audit logs page with filters, pagination, and export"
```

---

## Task 10: Create the Error Log admin page

**Files:**
- Create: `frontend/app/admin/error-logs/page.tsx`

**Step 1: Create the page**

```tsx
// frontend/app/admin/error-logs/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authAPI, getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import MainHeader from '@/components/MainHeader';
import { API_URL } from '@/lib/config';

interface ErrorEntry {
  id: number;
  timestamp: string;
  severity: string;
  source: string;
  error_type: string | null;
  message: string;
  traceback: string | null;
  user_id: number | null;
  request_path: string | null;
  request_method: string | null;
  context: Record<string, unknown> | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  error: 'bg-red-100 text-red-700',
  warning: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-200 text-red-900 font-bold',
};

export default function ErrorLogsPage() {
  const router = useRouter();
  const user = authAPI.getUser();

  const [items, setItems] = useState<ErrorEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Filters
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!user || user.role !== 'admin') router.push('/dashboard');
  }, [user, router]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (filterSeverity) params.set('severity', filterSeverity);
      if (filterSource) params.set('source', filterSource);
      if (filterFrom) params.set('date_from', filterFrom);
      if (filterTo) params.set('date_to', filterTo);
      const res = await fetch(`${API_URL}/logs/errors?${params}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, filterSeverity, filterSource, filterFrom, filterTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (filterSeverity) params.set('severity', filterSeverity);
    if (filterSource) params.set('source', filterSource);
    if (filterFrom) params.set('date_from', filterFrom);
    if (filterTo) params.set('date_to', filterTo);
    window.open(`${API_URL}/logs/errors/export?${params}&token=${getAuthToken()}`, '_blank');
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader />
      <div className="flex">
        <AdminNav />
        <main className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">Error Logs</h1>
            <button
              onClick={exportCsv}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
            >
              Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 bg-white p-4 rounded shadow-sm">
            <select
              value={filterSeverity}
              onChange={e => { setFilterSeverity(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="">All Severities</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </select>
            <select
              value={filterSource}
              onChange={e => { setFilterSource(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="">All Sources</option>
              <option value="api">API</option>
              <option value="background_job">Background Job</option>
              <option value="integration">Integration</option>
              <option value="frontend">Frontend</option>
            </select>
            <input
              type="datetime-local"
              value={filterFrom}
              onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={filterTo}
              onChange={e => { setFilterTo(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={() => { setFilterSeverity(''); setFilterSource(''); setFilterFrom(''); setFilterTo(''); setPage(1); }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Clear
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">Severity</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-left">Error Type</th>
                  <th className="px-4 py-3 text-left">Message</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Path</th>
                  <th className="px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No entries found.</td></tr>
                ) : items.map(row => (
                  <>
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-500 text-xs">{new Date(row.timestamp).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${SEVERITY_COLORS[row.severity] || 'bg-gray-100 text-gray-600'}`}>
                          {row.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-500">{row.source}</td>
                      <td className="px-4 py-2 font-mono text-gray-700 text-xs">{row.error_type || '—'}</td>
                      <td className="px-4 py-2 text-gray-700 max-w-xs truncate">{row.message}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs">{row.user_id || '—'}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs">{row.request_path || '—'}</td>
                      <td className="px-4 py-2">
                        {row.traceback && (
                          <button
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {expanded === row.id ? 'Hide' : 'Traceback'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === row.id && (
                      <tr key={`${row.id}-tb`} className="bg-gray-50">
                        <td colSpan={8} className="px-6 py-3">
                          <pre className="text-xs text-red-800 bg-red-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">{row.traceback}</pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <span>{total} total entries</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40">Previous</button>
              <span className="px-3 py-1">Page {page} of {totalPages || 1}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/error-logs/page.tsx
git commit -m "feat(logs): add admin error logs page with severity badges, traceback expand, filters, and export"
```

---

## Task 11: Add links to the admin sidebar

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Add a "Logs" group to the sidebar**

Open `frontend/components/AdminNav.tsx`. Find the `sidebarGroups` array. Find the `Security` group (which has "Role Permissions" and "CORS"). Add a new group after it:

```tsx
{
    label: 'Logs',
    items: [
        { href: '/admin/audit-logs', label: 'Audit Log', icon: '📋' },
        { href: '/admin/error-logs', label: 'Error Log', icon: '🚨' },
    ],
},
```

**Step 2: Verify in browser**

Start the frontend (`npm run dev` in the `frontend/` directory). Go to `http://localhost:3000/admin`. Confirm "Logs" group with "Audit Log" and "Error Log" links appears in the left sidebar.

**Step 3: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat(logs): add Audit Log and Error Log links to admin sidebar"
```

---

## Task 12: End-to-end smoke test

**Goal:** Confirm the full feature works together.

**Step 1: Start both services**

```bash
./start.sh
```

**Step 2: Trigger some audit events**

- Log in via the frontend — this writes an `auth.login` audit entry
- As an admin, navigate to the admin panel and create or update a user

**Step 3: Check the audit log page**

Go to `http://localhost:3000/admin/audit-logs`. Confirm:
- The login entry appears in the table
- Filters work (type `auth` in the action filter — only auth entries show)
- "Export CSV" downloads a file

**Step 4: Trigger an error**

Go to `http://localhost:8000/docs`. Try a request with a bad payload to force a 500 error.

**Step 5: Check the error log page**

Go to `http://localhost:3000/admin/error-logs`. Confirm:
- The error appears with correct severity badge
- Clicking "Traceback" shows the Python traceback
- "Export CSV" downloads a file

**Step 6: Verify frontend error capture**

Open browser dev tools console on any page. Run:
```js
throw new Error("test frontend error")
```
Go to `http://localhost:3000/admin/error-logs` and confirm a new `frontend` source entry with `source=frontend` appeared.

**Step 7: Final commit (if any last tweaks)**

```bash
git add -A
git commit -m "feat(logs): complete audit and error log system"
```
