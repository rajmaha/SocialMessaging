# backend/app/routes/db_migrations.py
import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.dependencies import require_admin_feature
from app.models.user import User
from app.models.db_migration import DbMigration, DbMigrationLog, DbMigrationSchedule
from app.models.cloudpanel_server import CloudPanelServer
from app.models.cloudpanel_site import CloudPanelSite
from app.schemas.db_migration import (
    DbMigrationResponse, DbMigrationLogResponse, DbMigrationBackup,
    DbMigrationScheduleUpsert, DbMigrationScheduleResponse, MigrationRunResult,
)
from app.services.migration_service import (
    run_server_migrations, _upsert_job, MIGRATION_DIR,
    send_migration_notification, list_backups, stream_backup, delete_backup,
    restore_backup,
)
import app.scheduler_ref as sched_ref

router = APIRouter(prefix="/cloudpanel/migrations", tags=["DB Migrations"])
require_cp = require_admin_feature("feature_manage_cloudpanel")


def _unique_dest(filename: str) -> str:
    """
    Give every upload its own file on disk. Re-uploading a name that already
    exists used to overwrite the stored SQL, so two migration rows could point at
    one file and the older row would silently run the newer file's contents.
    """
    dest = os.path.join(MIGRATION_DIR, filename)
    if not os.path.exists(dest):
        return dest
    stem, ext = os.path.splitext(filename)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(MIGRATION_DIR, f"{stem}-{stamp}{ext}")
    counter = 2
    while os.path.exists(dest):
        dest = os.path.join(MIGRATION_DIR, f"{stem}-{stamp}-{counter}{ext}")
        counter += 1
    return dest


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DbMigrationResponse)
def upload_migration(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    domain_suffix: Optional[str] = Form(None),
    drop_before_run: bool = Form(False),
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    if not file.filename.endswith(".sql"):
        raise HTTPException(status_code=400, detail="Only .sql files are allowed")

    suffix = domain_suffix.strip() if domain_suffix and domain_suffix.strip() else None

    # A drop-first migration wipes the database of every site it matches. Left blank
    # it would match every site on the server, so refuse that outright. Drop
    # migrations match on the exact domain only — see site_matches().
    if drop_before_run and not suffix:
        raise HTTPException(
            status_code=400,
            detail="An exact domain is required when 'Drop database contents first' is "
                   "enabled, so the wipe cannot affect every site on the server.",
        )

    os.makedirs(MIGRATION_DIR, exist_ok=True)
    dest_path = _unique_dest(file.filename)
    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    migration = DbMigration(
        filename=file.filename,
        file_path=dest_path,
        description=description or None,
        domain_suffix=suffix,
        drop_before_run=drop_before_run,
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
    force: bool = False,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    """
    Delete a migration. Run history blocks this by default — deleting it means a
    re-upload of the same file would be treated as never having run, and for a
    drop & import that is a second wipe. `force=true` deletes the logs too, which
    is the only way to clear a mis-uploaded row that has already been attempted.
    """
    migration = db.query(DbMigration).filter(DbMigration.id == migration_id).first()
    if not migration:
        raise HTTPException(status_code=404, detail="Migration not found")

    logs = db.query(DbMigrationLog).filter(
        DbMigrationLog.migration_id == migration_id
    ).all()
    succeeded = [log for log in logs if log.status == "success"]
    if logs and not force:
        detail = f"{len(logs)} log entr{'y' if len(logs) == 1 else 'ies'} exist"
        if succeeded:
            databases = sorted({log.db_name for log in succeeded if log.db_name})
            detail += f", including successful runs against {', '.join(databases) or 'a database'}"
        raise HTTPException(status_code=409, detail=detail)

    # Duplicate uploads of one filename used to share a path, so only unlink the
    # file when no other migration row still points at it.
    others = db.query(DbMigration).filter(
        DbMigration.file_path == migration.file_path,
        DbMigration.id != migration.id,
    ).count()
    if others == 0 and os.path.exists(migration.file_path):
        os.remove(migration.file_path)

    for log in logs:
        db.delete(log)
    db.delete(migration)
    db.commit()
    return {"ok": True, "logs_deleted": len(logs)}


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
        site = (db.query(CloudPanelSite).filter(CloudPanelSite.id == log.site_id).first()
                if log.site_id else None)
        server = db.query(CloudPanelServer).filter(CloudPanelServer.id == log.server_id).first()
        item = DbMigrationLogResponse(
            id=log.id,
            migration_id=log.migration_id,
            site_id=log.site_id,
            server_id=log.server_id,
            status=log.status,
            error_message=log.error_message,
            executed_at=log.executed_at,
            db_name=log.db_name,
            # Prefer the live site, fall back to the name recorded at run time so a
            # deleted site still reads as more than a blank row.
            domain_name=site.domain_name if site else log.domain_name,
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

    # Manual, admin-triggered run — drop_before_run migrations are permitted here
    # (the scheduled job passes allow_drop=False).
    result = run_server_migrations(server_id, db, allow_drop=True)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# ── Backups ───────────────────────────────────────────────────────────────────

def _get_server(server_id: int, db: Session) -> CloudPanelServer:
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@router.get("/backups/{server_id}", response_model=List[DbMigrationBackup])
def list_server_backups(
    server_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    """The pre-drop dumps kept in /var/backups/db_migrations on this server."""
    backups, err = list_backups(_get_server(server_id, db))
    if err:
        raise HTTPException(status_code=502, detail=err)
    return backups


@router.get("/backups/{server_id}/{filename}")
def download_server_backup(
    server_id: int,
    filename: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    """
    Stream a dump straight from the server to the browser. The filename is
    validated against the backup naming pattern, so it cannot escape BACKUP_DIR.
    """
    server = _get_server(server_id, db)
    try:
        chunks, size = stream_backup(server, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read backup: {e}")

    return StreamingResponse(
        chunks,
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(size),
        },
    )


@router.post("/backups/{server_id}/{filename}/restore")
def restore_server_backup(
    server_id: int,
    filename: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    """
    Roll a database back to this dump. Wipes the current contents after taking a
    safety dump, and un-marks any migration the restore undid.
    """
    server = _get_server(server_id, db)
    try:
        return restore_backup(server, filename, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/backups/{server_id}/{filename}")
def delete_server_backup(
    server_id: int,
    filename: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    """Remove a dump from the server. It is the only copy — there is no undo."""
    server = _get_server(server_id, db)
    try:
        delete_backup(server, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not delete backup: {e}")
    return {"ok": True}


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
