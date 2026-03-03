# Remote DB Migration Module — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a remote database migration module that lets admins upload SQL files, run them against deployed CloudPanel sites via SSH/MySQL-root, and schedule auto-runs per server.

**Architecture:** File-based SQL storage in `migration_storage/`, three new PostgreSQL tables for metadata and tracking, SSH+SFTP execution via the existing CloudPanelService SSH pattern, APScheduler jobs loaded dynamically from DB at startup and updated live from routes via a shared scheduler reference module.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Paramiko (SSH/SFTP), APScheduler, Next.js 14 App Router, TailwindCSS

**Design doc:** `docs/plans/2026-03-03-remote-db-migration-design.md`

---

## Task 1: Shared Scheduler Reference Module

Without this, routes can't access the APScheduler instance without circular imports.

**Files:**
- Create: `backend/app/scheduler_ref.py`

**Step 1: Create the module**

```python
# backend/app/scheduler_ref.py
"""
Holds a reference to the running APScheduler instance so that routes
can register/remove jobs without circular imports from main.py.
"""
from typing import Optional

scheduler = None  # Set by main.py at startup
```

**Step 2: Commit**

```bash
git add backend/app/scheduler_ref.py
git commit -m "feat: add scheduler_ref module for cross-module APScheduler access"
```

---

## Task 2: SQLAlchemy Models

**Files:**
- Create: `backend/app/models/db_migration.py`

**Step 1: Write the models**

```python
# backend/app/models/db_migration.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class DbMigration(Base):
    __tablename__ = "db_migrations"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    description = Column(String, nullable=True)
    domain_suffix = Column(String, nullable=True)   # e.g. "abc.com" — NULL = all sites
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DbMigrationLog(Base):
    __tablename__ = "db_migration_logs"

    id = Column(Integer, primary_key=True, index=True)
    migration_id = Column(Integer, ForeignKey("db_migrations.id", ondelete="CASCADE"), nullable=False)
    site_id = Column(Integer, ForeignKey("cloudpanel_sites.id", ondelete="CASCADE"), nullable=False)
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending/running/success/failed
    error_message = Column(Text, nullable=True)
    executed_at = Column(DateTime(timezone=True), server_default=func.now())


class DbMigrationSchedule(Base):
    __tablename__ = "db_migration_schedules"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id", ondelete="CASCADE"),
                       nullable=False, unique=True)
    interval_minutes = Column(Integer, nullable=False, default=1440)  # default: 24h
    enabled = Column(Boolean, nullable=False, default=False)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
```

**Step 2: Commit**

```bash
git add backend/app/models/db_migration.py
git commit -m "feat: add DbMigration, DbMigrationLog, DbMigrationSchedule models"
```

---

## Task 3: Inline DB Migrations in main.py

Adds the three tables to the startup migration block. Also imports the models so `create_all` picks them up, and wires the scheduler ref.

**Files:**
- Modify: `backend/main.py`

**Step 1: Add model import near the top (after existing cloudpanel imports, line ~12)**

```python
from app.models.db_migration import DbMigration, DbMigrationLog, DbMigrationSchedule  # noqa: F401
```

**Step 2: Add tables inside `_run_inline_migrations()`, before the final `conn.commit()` in the last `with engine.connect()` block (around line 708)**

```python
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS db_migrations (
                id SERIAL PRIMARY KEY,
                filename VARCHAR NOT NULL,
                file_path VARCHAR NOT NULL,
                description VARCHAR,
                domain_suffix VARCHAR,
                uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS db_migration_logs (
                id SERIAL PRIMARY KEY,
                migration_id INTEGER NOT NULL REFERENCES db_migrations(id) ON DELETE CASCADE,
                site_id INTEGER NOT NULL REFERENCES cloudpanel_sites(id) ON DELETE CASCADE,
                server_id INTEGER NOT NULL REFERENCES cloudpanel_servers(id) ON DELETE CASCADE,
                status VARCHAR NOT NULL DEFAULT 'pending',
                error_message TEXT,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS db_migration_schedules (
                id SERIAL PRIMARY KEY,
                server_id INTEGER NOT NULL UNIQUE REFERENCES cloudpanel_servers(id) ON DELETE CASCADE,
                interval_minutes INTEGER NOT NULL DEFAULT 1440,
                enabled BOOLEAN NOT NULL DEFAULT FALSE,
                last_run_at TIMESTAMP WITH TIME ZONE
            )
        """))
```

**Step 3: Set the scheduler ref after `scheduler.start()` in `startup_event()` (after line ~1355)**

```python
        # Wire scheduler reference for routes
        import app.scheduler_ref as _sched_ref
        _sched_ref.scheduler = scheduler

        # Load DB migration schedules and register jobs
        from app.services.migration_service import run_server_migrations_job, register_migration_jobs
        register_migration_jobs(scheduler)
        logger.info("✅ DB migration scheduler jobs loaded")
```

**Step 4: Add migration_storage directory (after the existing storage dir blocks, around line ~958)**

```python
# Serve nothing from migration_storage — files are private SQL, not served publicly
MIGRATION_DIR = os.path.join(os.path.dirname(__file__), "migration_storage")
os.makedirs(MIGRATION_DIR, exist_ok=True)
```

**Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat: wire db_migration tables, storage dir, and scheduler into main.py"
```

---

## Task 4: Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/db_migration.py`

**Step 1: Write the schemas**

```python
# backend/app/schemas/db_migration.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class DbMigrationResponse(BaseModel):
    id: int
    filename: str
    description: Optional[str] = None
    domain_suffix: Optional[str] = None
    uploaded_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DbMigrationLogResponse(BaseModel):
    id: int
    migration_id: int
    site_id: int
    server_id: int
    status: str
    error_message: Optional[str] = None
    executed_at: datetime
    # Joined fields (populated manually in route)
    domain_name: Optional[str] = None
    server_name: Optional[str] = None

    class Config:
        from_attributes = True


class DbMigrationScheduleUpsert(BaseModel):
    interval_minutes: int = 1440
    enabled: bool = False


class DbMigrationScheduleResponse(BaseModel):
    id: int
    server_id: int
    interval_minutes: int
    enabled: bool
    last_run_at: Optional[datetime] = None
    # Joined
    server_name: Optional[str] = None

    class Config:
        from_attributes = True


class MigrationRunResult(BaseModel):
    server_id: int
    total_sites: int
    skipped: int
    success: int
    failed: int
    details: List[dict]
```

**Step 2: Commit**

```bash
git add backend/app/schemas/db_migration.py
git commit -m "feat: add Pydantic schemas for db migration module"
```

---

## Task 5: Migration Service

This is the core execution engine.

**Files:**
- Create: `backend/app/services/migration_service.py`

**Step 1: Write the service**

```python
# backend/app/services/migration_service.py
import os
import logging
import paramiko
from datetime import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.db_migration import DbMigration, DbMigrationLog, DbMigrationSchedule
from app.models.cloudpanel_server import CloudPanelServer
from app.models.cloudpanel_site import CloudPanelSite

logger = logging.getLogger(__name__)

MIGRATION_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "migration_storage")


def _get_ssh_client(server: CloudPanelServer) -> paramiko.SSHClient:
    """Open and return an SSH connection to the given server."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs = {
        "hostname": server.host,
        "port": server.ssh_port or 22,
        "username": server.ssh_user or "root",
        "timeout": 30,
    }
    if server.ssh_key:
        import io
        pkey = paramiko.RSAKey.from_private_key(io.StringIO(server.ssh_key))
        connect_kwargs["pkey"] = pkey
    else:
        connect_kwargs["password"] = server.ssh_password
    client.connect(**connect_kwargs)
    return client


def run_server_migrations(server_id: int, db: Session) -> dict:
    """
    Run all pending migrations on all matching sites on the given server.
    Returns a summary dict.
    """
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        return {"error": f"Server {server_id} not found"}

    sites = db.query(CloudPanelSite).filter(CloudPanelSite.server_id == server_id).all()
    migrations = db.query(DbMigration).order_by(DbMigration.filename).all()

    if not sites:
        return {"server_id": server_id, "total_sites": 0, "skipped": 0, "success": 0, "failed": 0, "details": []}

    # Build set of (migration_id, site_id) that already succeeded
    existing_success = set(
        (row.migration_id, row.site_id)
        for row in db.query(DbMigrationLog).filter(
            DbMigrationLog.server_id == server_id,
            DbMigrationLog.status == "success",
        ).all()
    )

    summary = {"server_id": server_id, "total_sites": len(sites),
               "skipped": 0, "success": 0, "failed": 0, "details": []}

    if not migrations:
        return summary

    # Open SSH once for the whole server run
    try:
        client = _get_ssh_client(server)
    except Exception as e:
        logger.error(f"SSH connect failed for server {server_id}: {e}")
        return {"error": str(e)}

    try:
        sftp = client.open_sftp()

        for migration in migrations:
            local_path = migration.file_path
            if not os.path.exists(local_path):
                logger.warning(f"Migration file missing: {local_path}")
                continue

            remote_tmp = f"/tmp/dbmig_{migration.id}_{migration.filename}"

            for site in sites:
                # Domain suffix filter
                if migration.domain_suffix:
                    if not site.domain_name.endswith(migration.domain_suffix):
                        summary["skipped"] += 1
                        continue

                # Already ran successfully
                if (migration.id, site.id) in existing_success:
                    summary["skipped"] += 1
                    continue

                # No db_name stored — skip
                if not site.db_name:
                    summary["skipped"] += 1
                    continue

                # Upload SQL to remote /tmp/
                try:
                    sftp.put(local_path, remote_tmp)
                except Exception as e:
                    _write_log(db, migration.id, site.id, server_id, "failed", f"SFTP upload failed: {e}")
                    summary["failed"] += 1
                    summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                               "status": "failed", "error": str(e)})
                    continue

                # Run mysql
                cmd = f"mysql -u root {site.db_name} < {remote_tmp}"
                try:
                    stdin, stdout, stderr = client.exec_command(cmd)
                    exit_code = stdout.channel.recv_exit_status()
                    err_output = stderr.read().decode("utf-8", errors="replace").strip()

                    if exit_code == 0:
                        _write_log(db, migration.id, site.id, server_id, "success", None)
                        summary["success"] += 1
                        summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                                   "status": "success"})
                    else:
                        _write_log(db, migration.id, site.id, server_id, "failed", err_output)
                        summary["failed"] += 1
                        summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                                   "status": "failed", "error": err_output})
                except Exception as e:
                    _write_log(db, migration.id, site.id, server_id, "failed", str(e))
                    summary["failed"] += 1
                    summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                               "status": "failed", "error": str(e)})
                finally:
                    # Always clean up temp file
                    try:
                        client.exec_command(f"rm -f {remote_tmp}")
                    except Exception:
                        pass

        sftp.close()
    finally:
        client.close()

    # Update last_run_at
    schedule = db.query(DbMigrationSchedule).filter(
        DbMigrationSchedule.server_id == server_id
    ).first()
    if schedule:
        schedule.last_run_at = datetime.utcnow()
        db.commit()

    return summary


def _write_log(db: Session, migration_id: int, site_id: int,
               server_id: int, status: str, error: str | None):
    """Insert or update a migration log entry."""
    existing = db.query(DbMigrationLog).filter(
        DbMigrationLog.migration_id == migration_id,
        DbMigrationLog.site_id == site_id,
    ).first()
    if existing:
        existing.status = status
        existing.error_message = error
        existing.executed_at = datetime.utcnow()
    else:
        log = DbMigrationLog(
            migration_id=migration_id,
            site_id=site_id,
            server_id=server_id,
            status=status,
            error_message=error,
        )
        db.add(log)
    db.commit()


def run_server_migrations_job(server_id: int):
    """APScheduler-compatible wrapper (opens its own DB session)."""
    db = SessionLocal()
    try:
        result = run_server_migrations(server_id, db)
        logger.info(f"Scheduled migration run server={server_id}: {result}")
    except Exception as e:
        logger.error(f"Scheduled migration error server={server_id}: {e}")
    finally:
        db.close()


def register_migration_jobs(scheduler):
    """Load all enabled schedules from DB and register APScheduler jobs."""
    db = SessionLocal()
    try:
        schedules = db.query(DbMigrationSchedule).filter(
            DbMigrationSchedule.enabled == True
        ).all()
        for s in schedules:
            _upsert_job(scheduler, s.server_id, s.interval_minutes)
        logger.info(f"Loaded {len(schedules)} migration schedule job(s)")
    except Exception as e:
        logger.warning(f"Could not load migration schedules: {e}")
    finally:
        db.close()


def _upsert_job(scheduler, server_id: int, interval_minutes: int):
    """Add or replace an APScheduler interval job for a server."""
    job_id = f"db_migration_server_{server_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    scheduler.add_job(
        run_server_migrations_job,
        "interval",
        minutes=interval_minutes,
        id=job_id,
        args=[server_id],
    )


def remove_job(scheduler, server_id: int):
    """Remove a migration job if it exists."""
    job_id = f"db_migration_server_{server_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
```

**Step 2: Commit**

```bash
git add backend/app/services/migration_service.py
git commit -m "feat: add migration_service with SSH execution and APScheduler helpers"
```

---

## Task 6: API Routes

**Files:**
- Create: `backend/app/routes/db_migrations.py`

**Step 1: Write the routes**

```python
# backend/app/routes/db_migrations.py
import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.dependencies import require_admin_feature
from app.models.user import User
from app.models.db_migration import DbMigration, DbMigrationLog, DbMigrationSchedule
from app.models.cloudpanel_server import CloudPanelServer
from app.models.cloudpanel_site import CloudPanelSite
from app.schemas.db_migration import (
    DbMigrationResponse, DbMigrationLogResponse,
    DbMigrationScheduleUpsert, DbMigrationScheduleResponse, MigrationRunResult,
)
from app.services.migration_service import (
    run_server_migrations, _upsert_job, remove_job, MIGRATION_DIR
)

router = APIRouter(prefix="/cloudpanel/migrations", tags=["DB Migrations"])
require_cp = require_admin_feature("feature_manage_cloudpanel")


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DbMigrationResponse)
def upload_migration(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    domain_suffix: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    if not file.filename.endswith(".sql"):
        raise HTTPException(status_code=400, detail="Only .sql files are allowed")

    os.makedirs(MIGRATION_DIR, exist_ok=True)
    dest_path = os.path.join(MIGRATION_DIR, file.filename)
    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    migration = DbMigration(
        filename=file.filename,
        file_path=dest_path,
        description=description or None,
        domain_suffix=domain_suffix.strip() if domain_suffix and domain_suffix.strip() else None,
        uploaded_by=admin.id,
    )
    db.add(migration)
    db.commit()
    db.refresh(migration)
    return migration


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[DbMigrationResponse])
def list_migrations(
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    return db.query(DbMigration).order_by(DbMigration.filename).all()


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{migration_id}")
def delete_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    migration = db.query(DbMigration).filter(DbMigration.id == migration_id).first()
    if not migration:
        raise HTTPException(status_code=404, detail="Migration not found")

    log_count = db.query(DbMigrationLog).filter(
        DbMigrationLog.migration_id == migration_id
    ).count()
    if log_count > 0:
        raise HTTPException(status_code=400, detail="Cannot delete migration with existing logs")

    # Remove file from disk
    if os.path.exists(migration.file_path):
        os.remove(migration.file_path)

    db.delete(migration)
    db.commit()
    return {"ok": True}


# ── Logs ──────────────────────────────────────────────────────────────────────

@router.get("/{migration_id}/logs", response_model=List[DbMigrationLogResponse])
def get_migration_logs(
    migration_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    logs = db.query(DbMigrationLog).filter(
        DbMigrationLog.migration_id == migration_id
    ).order_by(DbMigrationLog.executed_at.desc()).all()

    result = []
    for log in logs:
        site = db.query(CloudPanelSite).filter(CloudPanelSite.id == log.site_id).first()
        server = db.query(CloudPanelServer).filter(CloudPanelServer.id == log.server_id).first()
        item = DbMigrationLogResponse(
            id=log.id,
            migration_id=log.migration_id,
            site_id=log.site_id,
            server_id=log.server_id,
            status=log.status,
            error_message=log.error_message,
            executed_at=log.executed_at,
            domain_name=site.domain_name if site else None,
            server_name=server.name if server else None,
        )
        result.append(item)
    return result


# ── Manual Run ────────────────────────────────────────────────────────────────

@router.post("/run/{server_id}", response_model=MigrationRunResult)
def run_migrations_on_server(
    server_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    result = run_server_migrations(server_id, db)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# ── Schedules ─────────────────────────────────────────────────────────────────

@router.get("/schedules", response_model=List[DbMigrationScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    servers = db.query(CloudPanelServer).all()
    result = []
    for server in servers:
        schedule = db.query(DbMigrationSchedule).filter(
            DbMigrationSchedule.server_id == server.id
        ).first()
        if schedule:
            item = DbMigrationScheduleResponse(
                id=schedule.id,
                server_id=schedule.server_id,
                interval_minutes=schedule.interval_minutes,
                enabled=schedule.enabled,
                last_run_at=schedule.last_run_at,
                server_name=server.name,
            )
        else:
            item = DbMigrationScheduleResponse(
                id=0,
                server_id=server.id,
                interval_minutes=1440,
                enabled=False,
                last_run_at=None,
                server_name=server.name,
            )
        result.append(item)
    return result


@router.post("/schedules/{server_id}", response_model=DbMigrationScheduleResponse)
def upsert_schedule(
    server_id: int,
    payload: DbMigrationScheduleUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    schedule = db.query(DbMigrationSchedule).filter(
        DbMigrationSchedule.server_id == server_id
    ).first()

    if schedule:
        schedule.interval_minutes = payload.interval_minutes
        schedule.enabled = payload.enabled
    else:
        schedule = DbMigrationSchedule(
            server_id=server_id,
            interval_minutes=payload.interval_minutes,
            enabled=payload.enabled,
        )
        db.add(schedule)
    db.commit()
    db.refresh(schedule)

    # Update APScheduler live
    import app.scheduler_ref as sched_ref
    if sched_ref.scheduler:
        if payload.enabled:
            _upsert_job(sched_ref.scheduler, server_id, payload.interval_minutes)
        else:
            remove_job(sched_ref.scheduler, server_id)

    return DbMigrationScheduleResponse(
        id=schedule.id,
        server_id=schedule.server_id,
        interval_minutes=schedule.interval_minutes,
        enabled=schedule.enabled,
        last_run_at=schedule.last_run_at,
        server_name=server.name,
    )
```

**Step 2: Commit**

```bash
git add backend/app/routes/db_migrations.py
git commit -m "feat: add db migration API routes (upload, list, delete, logs, run, schedules)"
```

---

## Task 7: Register Router in main.py

**Files:**
- Modify: `backend/main.py`

**Step 1: Add import at the top with other route imports (line ~7)**

```python
from app.routes.db_migrations import router as db_migrations_router
```

**Step 2: Register router after cloudpanel routers (after line ~926)**

```python
app.include_router(db_migrations_router)
```

**Step 3: Verify at Swagger**

Start backend: `cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000`

Open http://localhost:8000/docs and confirm the following endpoints appear under **DB Migrations**:
- `POST /cloudpanel/migrations/upload`
- `GET /cloudpanel/migrations`
- `DELETE /cloudpanel/migrations/{migration_id}`
- `GET /cloudpanel/migrations/{migration_id}/logs`
- `POST /cloudpanel/migrations/run/{server_id}`
- `GET /cloudpanel/migrations/schedules`
- `POST /cloudpanel/migrations/schedules/{server_id}`

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: register db_migrations router in main.py"
```

---

## Task 8: Frontend Admin Page

**Files:**
- Create: `frontend/app/admin/cloudpanel/migrations/page.tsx`

**Step 1: Write the page**

```tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from '@/lib/auth'

interface Migration {
    id: number
    filename: string
    description: string | null
    domain_suffix: string | null
    uploaded_by: number | null
    created_at: string
}

interface MigrationLog {
    id: number
    migration_id: number
    site_id: number
    server_id: number
    status: string
    error_message: string | null
    executed_at: string
    domain_name: string | null
    server_name: string | null
}

interface Server {
    id: number
    name: string
    host: string
}

interface Schedule {
    id: number
    server_id: number
    interval_minutes: number
    enabled: boolean
    last_run_at: string | null
    server_name: string | null
}

interface RunResult {
    server_id: number
    total_sites: number
    skipped: number
    success: number
    failed: number
    details: { site: string; migration: string; status: string; error?: string }[]
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function authHeaders(): Record<string, string> {
    const token = getAuthToken() || ''
    return { Authorization: `Bearer ${token}` }
}

const INTERVAL_OPTIONS = [
    { label: '30 minutes', value: 30 },
    { label: '1 hour', value: 60 },
    { label: '6 hours', value: 360 },
    { label: '12 hours', value: 720 },
    { label: '24 hours', value: 1440 },
]

export default function MigrationsPage() {
    const [user, setUser] = useState<any>(null)
    const [migrations, setMigrations] = useState<Migration[]>([])
    const [servers, setServers] = useState<Server[]>([])
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState({ type: '', text: '' })

    // Upload form
    const [uploadFile, setUploadFile] = useState<File | null>(null)
    const [uploadDesc, setUploadDesc] = useState('')
    const [uploadSuffix, setUploadSuffix] = useState('')
    const [uploading, setUploading] = useState(false)

    // Logs drawer
    const [logsDrawer, setLogsDrawer] = useState<{ open: boolean; migration: Migration | null; logs: MigrationLog[] }>({
        open: false, migration: null, logs: []
    })

    // Run result modal
    const [runResult, setRunResult] = useState<RunResult | null>(null)
    const [running, setRunning] = useState<number | null>(null)

    useEffect(() => {
        setUser(authAPI.getUser())
        loadAll()
    }, [])

    async function loadAll() {
        setLoading(true)
        try {
            const [mRes, sRes, schRes] = await Promise.all([
                fetch(`${API}/cloudpanel/migrations`, { headers: authHeaders() }),
                fetch(`${API}/cloudpanel/servers`, { headers: authHeaders() }),
                fetch(`${API}/cloudpanel/migrations/schedules`, { headers: authHeaders() }),
            ])
            if (mRes.ok) setMigrations(await mRes.json())
            if (sRes.ok) setServers(await sRes.json())
            if (schRes.ok) setSchedules(await schRes.json())
        } catch (e) {
            showMsg('error', 'Failed to load data')
        }
        setLoading(false)
    }

    function showMsg(type: string, text: string) {
        setMessage({ type, text })
        setTimeout(() => setMessage({ type: '', text: '' }), 4000)
    }

    // ── Upload ──────────────────────────────────────────────────────────────

    async function handleUpload(e: React.FormEvent) {
        e.preventDefault()
        if (!uploadFile) return
        setUploading(true)
        const fd = new FormData()
        fd.append('file', uploadFile)
        if (uploadDesc) fd.append('description', uploadDesc)
        if (uploadSuffix.trim()) fd.append('domain_suffix', uploadSuffix.trim())
        const res = await fetch(`${API}/cloudpanel/migrations/upload`, {
            method: 'POST',
            headers: authHeaders(),
            body: fd,
        })
        if (res.ok) {
            showMsg('success', 'Migration uploaded successfully')
            setUploadFile(null)
            setUploadDesc('')
            setUploadSuffix('')
            loadAll()
        } else {
            const err = await res.json()
            showMsg('error', err.detail || 'Upload failed')
        }
        setUploading(false)
    }

    // ── Delete ──────────────────────────────────────────────────────────────

    async function handleDelete(migration: Migration) {
        if (!confirm(`Delete migration "${migration.filename}"? This cannot be undone.`)) return
        const res = await fetch(`${API}/cloudpanel/migrations/${migration.id}`, {
            method: 'DELETE',
            headers: authHeaders(),
        })
        if (res.ok) {
            showMsg('success', 'Migration deleted')
            loadAll()
        } else {
            const err = await res.json()
            showMsg('error', err.detail || 'Delete failed')
        }
    }

    // ── Logs ────────────────────────────────────────────────────────────────

    async function openLogs(migration: Migration) {
        const res = await fetch(`${API}/cloudpanel/migrations/${migration.id}/logs`, {
            headers: authHeaders(),
        })
        const logs = res.ok ? await res.json() : []
        setLogsDrawer({ open: true, migration, logs })
    }

    // ── Run ─────────────────────────────────────────────────────────────────

    async function handleRun(server_id: number) {
        setRunning(server_id)
        const res = await fetch(`${API}/cloudpanel/migrations/run/${server_id}`, {
            method: 'POST',
            headers: authHeaders(),
        })
        if (res.ok) {
            setRunResult(await res.json())
            loadAll()
        } else {
            const err = await res.json()
            showMsg('error', err.detail || 'Run failed')
        }
        setRunning(null)
    }

    // ── Schedules ────────────────────────────────────────────────────────────

    async function saveSchedule(server_id: number, interval_minutes: number, enabled: boolean) {
        const res = await fetch(`${API}/cloudpanel/migrations/schedules/${server_id}`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval_minutes, enabled }),
        })
        if (res.ok) {
            showMsg('success', 'Schedule saved')
            loadAll()
        } else {
            showMsg('error', 'Failed to save schedule')
        }
    }

    const statusColor = (status: string) => {
        if (status === 'success') return 'text-green-400'
        if (status === 'failed') return 'text-red-400'
        if (status === 'running') return 'text-yellow-400'
        return 'text-gray-400'
    }

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--primary-color)' }}>
            <MainHeader user={user} />
            <div className="flex" style={{ paddingTop: 56 }}>
                <AdminNav />
                <main className="flex-1 p-6 overflow-auto" style={{ marginLeft: 240 }}>
                    <h1 className="text-2xl font-bold text-white mb-6">DB Migrations</h1>

                    {message.text && (
                        <div className={`mb-4 p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                            {message.text}
                        </div>
                    )}

                    {/* ── Upload Panel ── */}
                    <div className="bg-gray-800 rounded-lg p-5 mb-6">
                        <h2 className="text-lg font-semibold text-white mb-4">Upload Migration</h2>
                        <form onSubmit={handleUpload} className="flex flex-wrap gap-3 items-end">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">SQL File *</label>
                                <input
                                    type="file"
                                    accept=".sql"
                                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                                    className="text-sm text-gray-300"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Description</label>
                                <input
                                    type="text"
                                    value={uploadDesc}
                                    onChange={e => setUploadDesc(e.target.value)}
                                    placeholder="Optional note"
                                    className="bg-gray-700 text-white text-sm rounded px-3 py-2 w-48"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Domain Suffix</label>
                                <input
                                    type="text"
                                    value={uploadSuffix}
                                    onChange={e => setUploadSuffix(e.target.value)}
                                    placeholder="e.g. abc.com (blank = all)"
                                    className="bg-gray-700 text-white text-sm rounded px-3 py-2 w-52"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={uploading || !uploadFile}
                                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
                            >
                                {uploading ? 'Uploading…' : 'Upload'}
                            </button>
                        </form>
                    </div>

                    {/* ── Migrations Table ── */}
                    <div className="bg-gray-800 rounded-lg p-5 mb-6">
                        <h2 className="text-lg font-semibold text-white mb-4">Migrations</h2>
                        {loading ? (
                            <p className="text-gray-400 text-sm">Loading…</p>
                        ) : migrations.length === 0 ? (
                            <p className="text-gray-400 text-sm">No migrations uploaded yet.</p>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-2 pr-4">Filename</th>
                                        <th className="py-2 pr-4">Description</th>
                                        <th className="py-2 pr-4">Domain Suffix</th>
                                        <th className="py-2 pr-4">Uploaded</th>
                                        <th className="py-2">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {migrations.map(m => (
                                        <tr key={m.id} className="border-b border-gray-700 text-gray-300">
                                            <td className="py-2 pr-4 font-mono">{m.filename}</td>
                                            <td className="py-2 pr-4">{m.description || <span className="text-gray-600">—</span>}</td>
                                            <td className="py-2 pr-4">
                                                {m.domain_suffix
                                                    ? <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded text-xs">{m.domain_suffix}</span>
                                                    : <span className="text-gray-500 text-xs">all sites</span>}
                                            </td>
                                            <td className="py-2 pr-4 text-gray-400 text-xs">
                                                {new Date(m.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="py-2 flex gap-2 flex-wrap">
                                                <button
                                                    onClick={() => openLogs(m)}
                                                    className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1 rounded"
                                                >
                                                    Logs
                                                </button>
                                                {servers.map(srv => (
                                                    <button
                                                        key={srv.id}
                                                        onClick={() => handleRun(srv.id)}
                                                        disabled={running === srv.id}
                                                        className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs px-3 py-1 rounded"
                                                    >
                                                        {running === srv.id ? '…' : `Run on ${srv.name}`}
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => handleDelete(m)}
                                                    className="bg-red-800 hover:bg-red-700 text-white text-xs px-3 py-1 rounded"
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* ── Schedules Panel ── */}
                    <div className="bg-gray-800 rounded-lg p-5">
                        <h2 className="text-lg font-semibold text-white mb-4">Auto-Run Schedules</h2>
                        {schedules.length === 0 ? (
                            <p className="text-gray-400 text-sm">No servers found.</p>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-2 pr-4">Server</th>
                                        <th className="py-2 pr-4">Interval</th>
                                        <th className="py-2 pr-4">Enabled</th>
                                        <th className="py-2 pr-4">Last Run</th>
                                        <th className="py-2">Save</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {schedules.map(sch => (
                                        <ScheduleRow
                                            key={sch.server_id}
                                            schedule={sch}
                                            onSave={saveSchedule}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </main>
            </div>

            {/* ── Logs Drawer ── */}
            {logsDrawer.open && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-end z-50">
                    <div className="w-full max-w-2xl bg-gray-900 h-full overflow-y-auto p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-white font-semibold">
                                Logs — {logsDrawer.migration?.filename}
                            </h3>
                            <button onClick={() => setLogsDrawer({ open: false, migration: null, logs: [] })}
                                className="text-gray-400 hover:text-white text-xl">✕</button>
                        </div>
                        {logsDrawer.logs.length === 0 ? (
                            <p className="text-gray-400 text-sm">No logs yet.</p>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-2 pr-3">Domain</th>
                                        <th className="py-2 pr-3">Server</th>
                                        <th className="py-2 pr-3">Status</th>
                                        <th className="py-2">Executed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logsDrawer.logs.map(log => (
                                        <tr key={log.id} className="border-b border-gray-800 text-gray-300">
                                            <td className="py-2 pr-3 text-xs font-mono">{log.domain_name}</td>
                                            <td className="py-2 pr-3 text-xs">{log.server_name}</td>
                                            <td className={`py-2 pr-3 font-semibold text-xs ${statusColor(log.status)}`}>
                                                {log.status.toUpperCase()}
                                                {log.error_message && (
                                                    <div className="text-red-400 font-normal mt-0.5 break-all">{log.error_message}</div>
                                                )}
                                            </td>
                                            <td className="py-2 text-xs text-gray-400">
                                                {new Date(log.executed_at).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* ── Run Result Modal ── */}
            {runResult && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-screen overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-white font-semibold">Migration Run Result</h3>
                            <button onClick={() => setRunResult(null)} className="text-gray-400 hover:text-white text-xl">✕</button>
                        </div>
                        <div className="flex gap-6 mb-4 text-sm">
                            <span className="text-gray-300">Sites: <strong className="text-white">{runResult.total_sites}</strong></span>
                            <span className="text-green-400">Success: <strong>{runResult.success}</strong></span>
                            <span className="text-red-400">Failed: <strong>{runResult.failed}</strong></span>
                            <span className="text-gray-400">Skipped: <strong>{runResult.skipped}</strong></span>
                        </div>
                        {runResult.details.length > 0 && (
                            <table className="w-full text-xs text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-1 pr-3">Site</th>
                                        <th className="py-1 pr-3">Migration</th>
                                        <th className="py-1">Status / Error</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {runResult.details.map((d, i) => (
                                        <tr key={i} className="border-b border-gray-700 text-gray-300">
                                            <td className="py-1 pr-3 font-mono">{d.site}</td>
                                            <td className="py-1 pr-3">{d.migration}</td>
                                            <td className={`py-1 ${d.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {d.status}{d.error ? `: ${d.error}` : ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

function ScheduleRow({ schedule, onSave }: {
    schedule: Schedule
    onSave: (server_id: number, interval: number, enabled: boolean) => void
}) {
    const [interval, setInterval] = useState(schedule.interval_minutes)
    const [enabled, setEnabled] = useState(schedule.enabled)

    return (
        <tr className="border-b border-gray-700 text-gray-300">
            <td className="py-2 pr-4">{schedule.server_name}</td>
            <td className="py-2 pr-4">
                <select
                    value={interval}
                    onChange={e => setInterval(Number(e.target.value))}
                    className="bg-gray-700 text-white text-sm rounded px-2 py-1"
                >
                    {INTERVAL_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </td>
            <td className="py-2 pr-4">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setEnabled(e.target.checked)}
                    className="w-4 h-4"
                />
            </td>
            <td className="py-2 pr-4 text-xs text-gray-400">
                {schedule.last_run_at ? new Date(schedule.last_run_at).toLocaleString() : '—'}
            </td>
            <td className="py-2">
                <button
                    onClick={() => onSave(schedule.server_id, interval, enabled)}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded"
                >
                    Save
                </button>
            </td>
        </tr>
    )
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/cloudpanel/migrations/page.tsx
git commit -m "feat: add DB migrations admin page with upload, logs drawer, and schedules"
```

---

## Task 9: Add Nav Link

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Add entry to the Applications group (after the SSL Monitor line ~71)**

```tsx
{ href: '/admin/cloudpanel/migrations', label: 'DB Migrations', icon: '🗄️', permission: () => hasAdminFeature('manage_cloudpanel') },
```

**Step 2: Verify in browser**

Open http://localhost:3000/admin/cloudpanel/migrations — confirm the three panels render.

**Step 3: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: add DB Migrations link to admin nav"
```

---

## Task 10: End-to-End Smoke Test

**Step 1: Start both services**
```bash
./start.sh
```

**Step 2: Test upload via Swagger**
- Go to http://localhost:8000/docs
- `POST /cloudpanel/migrations/upload` — upload a small test `.sql` file (e.g. `SELECT 1;`)
- Expect `200` with migration object

**Step 3: Test list**
- `GET /cloudpanel/migrations` — confirm the uploaded file appears

**Step 4: Test run (if a server + site exists)**
- `POST /cloudpanel/migrations/run/{server_id}`
- Expect result with `success` or `failed` counts

**Step 5: Test schedule save**
- `POST /cloudpanel/migrations/schedules/{server_id}` with `{"interval_minutes": 60, "enabled": true}`
- Restart backend and check logs — confirm the job was re-registered on startup

**Step 6: Test delete**
- `DELETE /cloudpanel/migrations/{id}` on a migration with no logs — expect `{"ok": true}`
- Try deleting one with logs — expect `400` error

**Step 7: Final commit**
```bash
git add .
git commit -m "feat: remote DB migration module complete"
```
