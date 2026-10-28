# backend/app/routes/backups.py
from datetime import datetime, timezone, timedelta
import html
import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.dependencies import get_admin_user
from app.models.user import User
from app.models.backup_destination import BackupDestination
from app.models.backup_job import BackupJob
from app.models.backup_run import BackupRun
from app.schemas.backup import (
    BackupDestinationCreate, BackupDestinationUpdate, BackupDestinationResponse,
    BackupJobCreate, BackupJobUpdate, BackupJobResponse,
    BackupRunResponse, DestinationTestRequest
)

router = APIRouter(prefix="/backups", tags=["Backups"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_next_run(job: BackupJob) -> Optional[datetime]:
    if job.schedule_type == "manual":
        return None
    elif job.schedule_type == "interval" and job.schedule_interval_hours:
        return datetime.now(timezone.utc) + timedelta(hours=job.schedule_interval_hours)
    elif job.schedule_type == "cron" and job.schedule_cron:
        from croniter import croniter
        return croniter(job.schedule_cron, datetime.now(timezone.utc)).get_next(datetime)
    return None


# ── Destinations ──────────────────────────────────────────────────────────────

@router.get("/destinations", response_model=List[BackupDestinationResponse])
def list_destinations(db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    return db.query(BackupDestination).all()


@router.post("/destinations/test")
def test_destination(data: DestinationTestRequest, admin: User = Depends(get_admin_user)):
    from app.services.destinations.base import get_destination
    try:
        plugin = get_destination(data.type, data.config)
        plugin.test_connection()
        return {"ok": True, "message": "Connection successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/google/connect")
def google_drive_connect(nonce: str = Query(..., min_length=8, max_length=64), admin: User = Depends(get_admin_user)):
    """The Google sign-in link the destination form opens in a popup."""
    from app.services import google_drive_auth
    try:
        return {"auth_url": google_drive_auth.auth_url(admin.id, nonce)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/google/callback", response_class=HTMLResponse)
def google_drive_callback(code: str = "", state: str = "", error: str = ""):
    """
    Google sends the popup here. No login: the signed state proves an admin
    asked for it. The page hands the result to the form that opened it (only
    to FRONTEND_URL) and closes.
    """
    import json as _json
    from app.config import settings
    from app.services import google_drive_auth

    nonce = ""
    try:
        nonce = google_drive_auth.read_state(state)["n"]
        if error:
            raise ValueError("Google sign-in was cancelled." if error == "access_denied" else f"Google sign-in failed ({error}).")
        if not code:
            raise ValueError("Google sent no sign-in code.")
        message = {"type": "gdrive-connected", "nonce": nonce, "token": google_drive_auth.exchange_code(code)}
        text = "Google Drive is connected. You can close this window."
    except ValueError as e:
        message = {"type": "gdrive-connected", "nonce": nonce, "error": str(e)}
        text = str(e)
    except Exception:
        message = {"type": "gdrive-connected", "nonce": nonce, "error": "Connecting Google Drive failed. Try again."}
        text = message["error"]

    payload = _json.dumps(message).replace("<", "\\u003c")
    origin = _json.dumps(settings.FRONTEND_URL.rstrip("/"))
    safe_text = html.escape(text)
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8"><title>Google Drive</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;color:#374151">
<p>{safe_text}</p>
<script>
  try {{ if (window.opener) {{ window.opener.postMessage({payload}, {origin}); window.close(); }} }} catch (e) {{}}
</script>
</body></html>""", headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@router.post("/destinations", response_model=BackupDestinationResponse)
def create_destination(data: BackupDestinationCreate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    dest = BackupDestination(**data.model_dump())
    db.add(dest)
    db.commit()
    db.refresh(dest)
    return dest


@router.put("/destinations/{dest_id}", response_model=BackupDestinationResponse)
def update_destination(dest_id: int, data: BackupDestinationUpdate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    dest = db.query(BackupDestination).filter(BackupDestination.id == dest_id).first()
    if not dest:
        raise HTTPException(status_code=404, detail="Destination not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(dest, k, v)
    db.commit()
    db.refresh(dest)
    return dest


@router.delete("/destinations/{dest_id}")
def delete_destination(dest_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    dest = db.query(BackupDestination).filter(BackupDestination.id == dest_id).first()
    if not dest:
        raise HTTPException(status_code=404, detail="Destination not found")
    db.delete(dest)
    db.commit()
    return {"ok": True}


# ── Jobs ──────────────────────────────────────────────────────────────────────

@router.get("/jobs", response_model=List[BackupJobResponse])
def list_jobs(db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    return db.query(BackupJob).all()


@router.post("/jobs", response_model=BackupJobResponse)
def create_job(data: BackupJobCreate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    job = BackupJob(**data.model_dump())
    job.next_run_at = _compute_next_run(job)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.put("/jobs/{job_id}", response_model=BackupJobResponse)
def update_job(job_id: int, data: BackupJobUpdate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(job, k, v)
    job.next_run_at = _compute_next_run(job)
    db.commit()
    db.refresh(job)
    return job


@router.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"ok": True}


@router.post("/jobs/{job_id}/run", response_model=BackupRunResponse)
def run_job_now(job_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    from app.services.backup_engine import backup_engine
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    run = backup_engine.run(job_id, db)
    return run


# ── Runs / History ────────────────────────────────────────────────────────────

@router.get("/runs", response_model=List[BackupRunResponse])
def list_all_runs(
    job_id: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    q = db.query(BackupRun)
    if job_id:
        q = q.filter(BackupRun.job_id == job_id)
    if status:
        q = q.filter(BackupRun.status == status)
    return q.order_by(BackupRun.started_at.desc()).limit(limit).all()


@router.get("/jobs/{job_id}/runs", response_model=List[BackupRunResponse])
def list_job_runs(job_id: int, limit: int = 20, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    return db.query(BackupRun).filter(BackupRun.job_id == job_id).order_by(BackupRun.started_at.desc()).limit(limit).all()


@router.get("/runs/{run_id}", response_model=BackupRunResponse)
def get_run(run_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    run = db.query(BackupRun).filter(BackupRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


# ── Download and delete a run's backup ─────────────────────────────────────────
#
# The admin API authenticates with a Bearer header from localStorage, which a
# plain browser download cannot send, and fetching a multi-gigabyte backup into
# a JavaScript blob would hold all of it in memory. So the page asks for a
# signed link valid for a few minutes and the browser downloads that directly.

DOWNLOAD_LINK_SECONDS = 300


def _download_sig(run_id: int, expires: int) -> str:
    import hashlib
    import hmac
    from app.config import settings
    msg = f"backup-download|{run_id}|{expires}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def _run_with_file(run_id: int, db: Session) -> BackupRun:
    run = db.query(BackupRun).filter(BackupRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Backup not found")
    if run.status != "success" or not run.backup_file_path:
        raise HTTPException(status_code=404, detail="This run has no backup file.")
    if run.file_deleted_at:
        raise HTTPException(status_code=410, detail="This backup's file was removed from the destination by retention.")
    return run


def _plugin_for(run: BackupRun, db: Session):
    from app.services.destinations.base import get_destination
    job = db.query(BackupJob).filter(BackupJob.id == run.job_id).first()
    dest = job and db.query(BackupDestination).filter(BackupDestination.id == job.destination_id).first()
    if not dest:
        raise HTTPException(status_code=404, detail="The destination of this backup no longer exists.")
    return get_destination(dest.type, dest.config), dest


def _download_name(run: BackupRun, local_path: str) -> str:
    """The file's own name where the path has one, else job + time + the
    extension its first bytes show (Drive and OneDrive store ids)."""
    base = os.path.basename(run.backup_file_path.rstrip("/"))
    if base.startswith("job") and "." in base:
        return base
    with open(local_path, "rb") as f:
        head = f.read(4)
    ext = ".zip" if head.startswith(b"PK\x03\x04") else ".tar.gz" if head.startswith(b"\x1f\x8b") else ".sql"
    stamp = run.started_at.strftime("%Y%m%d_%H%M%S") if run.started_at else str(run.id)
    return f"job{run.job_id}_{stamp}{ext}"


@router.post("/runs/{run_id}/download-link")
def backup_download_link(run_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    import time
    _run_with_file(run_id, db)
    expires = int(time.time()) + DOWNLOAD_LINK_SECONDS
    return {"url": f"/backups/runs/{run_id}/file?e={expires}&s={_download_sig(run_id, expires)}"}


@router.get("/runs/{run_id}/file")
def backup_download_file(run_id: int, e: int = 0, s: str = "", db: Session = Depends(get_db)):
    """The backup file itself. No login: the signed link is the permission."""
    import hmac
    import tempfile
    import time
    from fastapi.responses import FileResponse
    from starlette.background import BackgroundTask

    if e < time.time() or not hmac.compare_digest(s, _download_sig(run_id, e)):
        raise HTTPException(status_code=403, detail="This download link has expired. Press Download again.")
    run = _run_with_file(run_id, db)
    plugin, dest = _plugin_for(run, db)
    headers = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}

    if plugin.is_local_file(run.backup_file_path):
        path = os.path.realpath(run.backup_file_path)
        return FileResponse(path, filename=_download_name(run, path), media_type="application/octet-stream", headers=headers)

    fd, tmp = tempfile.mkstemp(prefix="backup_dl_")
    os.close(fd)
    try:
        plugin.download(run.backup_file_path, tmp)
    except Exception as ex:
        os.remove(tmp)
        raise HTTPException(status_code=502 if not isinstance(ex, (ValueError, NotImplementedError)) else 400,
                            detail=f"Could not fetch the backup from {dest.name}: {ex}")
    return FileResponse(tmp, filename=_download_name(run, tmp), media_type="application/octet-stream",
                        headers=headers, background=BackgroundTask(os.remove, tmp))


@router.delete("/runs/{run_id}")
def delete_run(run_id: int, force: bool = False, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    """
    Delete a backup: its file at the destination, then the History row. When
    the file cannot be deleted the row is kept and the reason answered (409);
    force=true then removes the row anyway, leaving the file where it is.
    """
    run = db.query(BackupRun).filter(BackupRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Backup not found")
    if run.status == "running":
        raise HTTPException(status_code=400, detail="This backup is still running.")

    file_note = None
    if run.status == "success" and run.backup_file_path and not run.file_deleted_at:
        try:
            plugin, dest = _plugin_for(run, db)
            plugin.delete(run.backup_file_path)
            file_note = f"File deleted from {dest.name}."
        except Exception as ex:
            detail = ex.detail if isinstance(ex, HTTPException) else str(ex)
            if not force:
                raise HTTPException(status_code=409, detail=f"Could not delete the file: {detail}")
            file_note = f"The file could not be deleted and was left in place: {detail}"

    db.delete(run)
    db.commit()
    return {"ok": True, "message": file_note or "Removed from History."}
