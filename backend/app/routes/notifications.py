"""
Notification Routes
===================
Available to admins and agents (role: admin or user).
"""
import csv
import io
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.notification_entry import NotificationEntry
from app.models.user import User
from app.schemas.notification import (
    NotificationEntryCreate,
    NotificationEntryResponse,
    NotificationEntryUpdate,
)
from app.services.notification_service import process_due_notifications

router = APIRouter(
    prefix="/admin/notifications",
    tags=["notifications"],
    responses={404: {"description": "Not found"}},
)


# ─── CRUD ───────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[NotificationEntryResponse])
def list_notifications(
    skip: int = 0,
    limit: int = 100,
    call_status: Optional[str] = Query(None),
    schedule_status: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(NotificationEntry)
    if current_user.role != "admin":
        q = q.filter(NotificationEntry.created_by == current_user.id)
    if call_status:
        q = q.filter(NotificationEntry.call_status == call_status)
    if schedule_status:
        q = q.filter(NotificationEntry.schedule_status == schedule_status)
    if phone:
        q = q.filter(NotificationEntry.phone_no.ilike(f"%{phone}%"))
    return q.order_by(NotificationEntry.created_at.desc()).offset(skip).limit(limit).all()


@router.post("/", response_model=NotificationEntryResponse, status_code=201)
def create_notification(
    payload: NotificationEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = NotificationEntry(
        **payload.model_dump(),
        created_by=current_user.id,
        call_status="pending",
        retry_count=0,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=NotificationEntryResponse)
def get_notification(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_entry_or_404(entry_id, db, current_user)


@router.put("/{entry_id}", response_model=NotificationEntryResponse)
def update_notification(
    entry_id: int,
    payload: NotificationEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = _get_entry_or_404(entry_id, db, current_user)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(entry, k, v)
    # If schedule_datetime is updated, reset call status
    if "schedule_datetime" in data:
        entry.call_status = "pending"
        entry.retry_count = 0
        entry.next_retry_at = None
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_notification(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = _get_entry_or_404(entry_id, db, current_user)
    db.delete(entry)
    db.commit()


@router.patch("/{entry_id}/toggle")
def toggle_notification(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle schedule_status between enabled/disabled."""
    entry = _get_entry_or_404(entry_id, db, current_user)
    entry.schedule_status = "disabled" if entry.schedule_status == "enabled" else "enabled"
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "schedule_status": entry.schedule_status}


# ─── Manual Trigger ─────────────────────────────────────────────────────────────

@router.post("/{entry_id}/trigger")
def trigger_notification(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually trigger a notification call right now."""
    entry = _get_entry_or_404(entry_id, db, current_user)
    if entry.schedule_status == "disabled":
        raise HTTPException(400, "Notification is disabled")
    # Force it to be due now
    entry.schedule_datetime = datetime.now(timezone.utc)
    entry.call_status = "pending"
    entry.retry_count = 0
    entry.next_retry_at = None
    entry.schedule_status = "enabled"
    db.commit()
    count = process_due_notifications(db)
    return {"message": f"Trigger complete. {count} call action(s) taken."}


# ─── CSV Import ──────────────────────────────────────────────────────────────────

@router.post("/import-csv")
async def import_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Bulk-create notifications from CSV.
    Expected columns: account_number, name, phone_no, message, schedule_datetime (ISO)
    """
    content = await file.read()
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    errors = []
    for i, row in enumerate(reader, start=2):
        try:
            phone = (row.get("phone_no") or row.get("phone") or "").strip()
            name = (row.get("name") or "").strip()
            message = (row.get("message") or "").strip()
            if not phone or not name or not message:
                errors.append(f"Row {i}: missing required field (name, phone_no, message)")
                continue
            dt_str = (row.get("schedule_datetime") or "").strip()
            dt = datetime.fromisoformat(dt_str) if dt_str else datetime.now(timezone.utc)
            entry = NotificationEntry(
                account_number=(row.get("account_number") or "").strip() or None,
                name=name,
                phone_no=phone,
                message=message,
                schedule_datetime=dt,
                schedule_status="enabled",
                call_status="pending",
                retry_count=0,
                created_by=current_user.id,
            )
            db.add(entry)
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")
    db.commit()
    return {
        "message": f"{created} notification(s) created.",
        "errors": errors,
    }


# ─── AMI Callback (call status update) ──────────────────────────────────────────

@router.post("/callback/call-status")
def ami_callback(
    pbx_call_id: str,
    status: str,
    db: Session = Depends(get_db),
):
    """
    Internal endpoint called by AMI event listener or webhook to update call status.
    status: answered | no_answer | declined | busy | failed
    """
    from app.services.notification_service import update_notification_call_status
    update_notification_call_status(db, pbx_call_id, status)
    return {"ok": True}


# ─── Helper ─────────────────────────────────────────────────────────────────────

def _get_entry_or_404(entry_id: int, db: Session, current_user: User) -> NotificationEntry:
    entry = db.query(NotificationEntry).filter(NotificationEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Notification not found")
    if current_user.role != "admin" and entry.created_by != current_user.id:
        raise HTTPException(403, "Access denied")
    return entry
