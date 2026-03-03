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
    run_server_migrations, _upsert_job, MIGRATION_DIR,
    send_migration_notification,
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
                schedule_type=schedule.schedule_type,
                run_at=schedule.run_at,
                day_of_week=schedule.day_of_week,
                time_of_day=schedule.time_of_day,
                notify_emails=schedule.notify_emails,
                notify_hours_before=schedule.notify_hours_before,
                status=schedule.status,
                enabled=schedule.enabled,
                last_run_at=schedule.last_run_at,
                server_name=server.name,
            )
        else:
            item = DbMigrationScheduleResponse(
                id=0,
                server_id=server.id,
                schedule_type="recurring",
                run_at=None,
                day_of_week=None,
                time_of_day=None,
                notify_emails=None,
                notify_hours_before=24,
                status="scheduled",
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
        schedule.schedule_type = payload.schedule_type
        schedule.run_at = payload.run_at
        schedule.day_of_week = payload.day_of_week
        schedule.time_of_day = payload.time_of_day
        schedule.notify_emails = payload.notify_emails
        schedule.notify_hours_before = payload.notify_hours_before
        schedule.enabled = payload.enabled
        # Reset status when schedule changes
        schedule.status = "scheduled"
    else:
        schedule = DbMigrationSchedule(
            server_id=server_id,
            schedule_type=payload.schedule_type,
            run_at=payload.run_at,
            day_of_week=payload.day_of_week,
            time_of_day=payload.time_of_day,
            notify_emails=payload.notify_emails,
            notify_hours_before=payload.notify_hours_before,
            enabled=payload.enabled,
            status="scheduled",
        )
        db.add(schedule)
    db.commit()
    db.refresh(schedule)

    # Update APScheduler live
    import app.scheduler_ref as sched_ref
    if sched_ref.scheduler:
        _upsert_job(sched_ref.scheduler, server_id, schedule)

    return DbMigrationScheduleResponse(
        id=schedule.id,
        server_id=schedule.server_id,
        schedule_type=schedule.schedule_type,
        run_at=schedule.run_at,
        day_of_week=schedule.day_of_week,
        time_of_day=schedule.time_of_day,
        notify_emails=schedule.notify_emails,
        notify_hours_before=schedule.notify_hours_before,
        status=schedule.status,
        enabled=schedule.enabled,
        last_run_at=schedule.last_run_at,
        server_name=server.name,
    )


@router.post("/schedules/{server_id}/notify")
def send_notification_now(
    server_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    """Manually send the maintenance notification email right now."""
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    sent_to = send_migration_notification(server_id, db)
    if not sent_to:
        raise HTTPException(status_code=400, detail="No notify_emails configured or send failed")
    return {"ok": True, "sent_to": sent_to}
