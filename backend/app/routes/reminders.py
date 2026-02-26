"""
Reminder Call Routes
=====================
Available to admins and agents (role: admin or user).
"""
import csv
import io
import os
import shutil
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.reminder_schedule import ReminderCallLog, ReminderSchedule
from app.models.user import User
from app.schemas.reminder import (
    ReminderCallLogResponse,
    ReminderScheduleCreate,
    ReminderScheduleResponse,
    ReminderScheduleUpdate,
)
from app.services.reminder_service import get_audio_files, process_due_reminders

AUDIO_STORAGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "audio_storage"
)
os.makedirs(AUDIO_STORAGE_DIR, exist_ok=True)

ALLOWED_AUDIO_EXTS = {".wav", ".mp3", ".gsm", ".ogg", ".ulaw", ".alaw"}

router = APIRouter(
    prefix="/admin/reminders",
    tags=["reminders"],
    responses={404: {"description": "Not found"}},
)


# ─── CRUD ───────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[ReminderScheduleResponse])
def list_schedules(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all reminder schedules (admin sees all; agents see their own)."""
    q = db.query(ReminderSchedule)
    if current_user.role != "admin":
        q = q.filter(ReminderSchedule.created_by == current_user.id)
    if status:
        q = q.filter(ReminderSchedule.status == status)
    return q.order_by(ReminderSchedule.schedule_datetime.desc()).offset(skip).limit(limit).all()


@router.post("/", response_model=ReminderScheduleResponse, status_code=201)
def create_schedule(
    payload: ReminderScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sched = ReminderSchedule(
        **payload.model_dump(),
        created_by=current_user.id,
        status="pending",
    )
    db.add(sched)
    db.commit()
    db.refresh(sched)
    return sched


@router.get("/{schedule_id}", response_model=ReminderScheduleResponse)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sched = _get_sched_or_404(schedule_id, db, current_user)
    return sched


@router.put("/{schedule_id}", response_model=ReminderScheduleResponse)
def update_schedule(
    schedule_id: int,
    payload: ReminderScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sched = _get_sched_or_404(schedule_id, db, current_user)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(sched, k, v)
    # If re-enabled and schedule time is in the future → reset to pending
    if data.get("is_enabled") and sched.schedule_datetime and sched.schedule_datetime > datetime.now(timezone.utc):
        sched.status = "pending"
    db.commit()
    db.refresh(sched)
    return sched


@router.delete("/{schedule_id}", status_code=204)
def delete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sched = _get_sched_or_404(schedule_id, db, current_user)
    db.delete(sched)
    db.commit()


@router.patch("/{schedule_id}/toggle")
def toggle_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Enable or disable a reminder schedule."""
    sched = _get_sched_or_404(schedule_id, db, current_user)
    sched.is_enabled = not sched.is_enabled
    if not sched.is_enabled:
        sched.status = "disabled"
    elif sched.status == "disabled":
        sched.status = "pending"
    db.commit()
    db.refresh(sched)
    return {"id": sched.id, "is_enabled": sched.is_enabled, "status": sched.status}


# ─── Call Logs ──────────────────────────────────────────────────────────────────

@router.get("/{schedule_id}/logs", response_model=List[ReminderCallLogResponse])
def get_call_logs(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_sched_or_404(schedule_id, db, current_user)
    logs = (
        db.query(ReminderCallLog)
        .filter(ReminderCallLog.schedule_id == schedule_id)
        .order_by(ReminderCallLog.phone_number, ReminderCallLog.attempt)
        .all()
    )
    return logs


# ─── Manual Trigger ─────────────────────────────────────────────────────────────

@router.post("/{schedule_id}/trigger")
def trigger_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually trigger a schedule right now (ignores schedule_datetime)."""
    sched = _get_sched_or_404(schedule_id, db, current_user)
    if not sched.is_enabled:
        raise HTTPException(status_code=400, detail="Schedule is disabled")

    # Force status to pending (override completed state)
    from app.services.reminder_service import _create_initial_logs
    sched.status = "pending"
    sched.schedule_datetime = datetime.now(timezone.utc)
    db.commit()

    count = process_due_reminders(db)
    return {"message": f"Trigger complete. {count} call action(s) taken."}


# ─── CSV Phone Import ────────────────────────────────────────────────────────────

@router.post("/{schedule_id}/import-phones")
async def import_phones_csv(
    schedule_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Upload a CSV file with phone numbers (one per row, first column used).
    Merges into the schedule's existing phone_numbers list.
    """
    sched = _get_sched_or_404(schedule_id, db, current_user)
    content = await file.read()
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    phones = set(sched.phone_numbers or [])
    added = 0
    for row in reader:
        if not row:
            continue
        phone = row[0].strip().strip("+").replace("-", "").replace(" ", "")
        if phone and phone.lstrip("0123456789") == "":  # basic digits-only check
            phones.add(phone)
            added += 1
    sched.phone_numbers = list(phones)
    db.commit()
    return {"message": f"{added} phone number(s) imported.", "total": len(phones)}


@router.post("/import-csv")
async def import_schedules_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Bulk-create schedules from CSV.
    Expected columns: name, schedule_datetime (ISO), phone_numbers (semicolon-separated), audio_file, remarks
    """
    content = await file.read()
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    for row in reader:
        try:
            phones = [p.strip() for p in (row.get("phone_numbers", "") or "").split(";") if p.strip()]
            dt_str = (row.get("schedule_datetime") or "").strip()
            dt = datetime.fromisoformat(dt_str) if dt_str else datetime.now(timezone.utc)
            sched = ReminderSchedule(
                name=row.get("name", "Imported Schedule"),
                schedule_datetime=dt,
                audio_file=row.get("audio_file", "").strip() or None,
                remarks=row.get("remarks", "").strip() or None,
                phone_numbers=phones,
                is_enabled=True,
                status="pending",
                created_by=current_user.id,
            )
            db.add(sched)
            created += 1
        except Exception:
            continue
    db.commit()
    return {"message": f"{created} schedule(s) created from CSV."}


# ─── Audio File Management ───────────────────────────────────────────────────────

@router.post("/upload-audio")
async def upload_audio(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload an audio file for use in reminder schedules."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXTS:
        raise HTTPException(
            400,
            detail=f"Unsupported audio format. Allowed: {', '.join(ALLOWED_AUDIO_EXTS)}",
        )
    # Keep original filename but dedup with uuid if collision
    safe_name = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    dest = os.path.join(AUDIO_STORAGE_DIR, safe_name)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": safe_name, "path": f"/audio/{safe_name}"}


@router.get("/audio-files")
def list_audio_files(
    current_user: User = Depends(get_current_user),
):
    """Return all uploaded audio files."""
    return get_audio_files()


# ─── AMI Callback (call status update) ──────────────────────────────────────────

@router.post("/callback/call-status")
def ami_callback(
    pbx_call_id: str,
    status: str,
    db: Session = Depends(get_db),
):
    """
    Internal endpoint called by AMI event listener to update call status.
    status: answered | no_answer | declined | busy | failed
    """
    from app.services.reminder_service import update_call_status
    update_call_status(db, pbx_call_id, status)
    return {"ok": True}


# ─── Helper ─────────────────────────────────────────────────────────────────────

def _get_sched_or_404(schedule_id: int, db: Session, current_user: User) -> ReminderSchedule:
    sched = db.query(ReminderSchedule).filter(ReminderSchedule.id == schedule_id).first()
    if not sched:
        raise HTTPException(404, "Schedule not found")
    if current_user.role != "admin" and sched.created_by != current_user.id:
        raise HTTPException(403, "Access denied")
    return sched
