# backend/app/routes/backups.py
from datetime import datetime, timezone, timedelta
import html
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
