from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
from datetime import date, datetime, timedelta
from pydantic import BaseModel as PydanticBaseModel
import os
import csv
import io

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.worklog import (
    WorklogCategoryGroup, WorklogCategory, WorklogEntry,
    WorklogAttachment, WorklogAutoEntry, WorklogActiveTimer
)
from app.schemas.worklog import *

router = APIRouter(prefix="/api/worklog", tags=["worklog"])

ATTACHMENT_DIR = "app/attachment_storage/worklog"
os.makedirs(ATTACHMENT_DIR, exist_ok=True)


def _require_admin(user: User):
    if getattr(user, 'role', '') != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


# ── Category Groups (Admin) ──────────────────────────────

@router.get("/category-groups", response_model=List[WorklogCategoryGroupOut])
def list_category_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    groups = db.query(WorklogCategoryGroup).all()
    return groups


@router.post("/category-groups", response_model=WorklogCategoryGroupOut)
def create_category_group(data: WorklogCategoryGroupCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    group = WorklogCategoryGroup(name=data.name, color=data.color, created_by=user.id)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.put("/category-groups/{group_id}", response_model=WorklogCategoryGroupOut)
def update_category_group(group_id: int, data: WorklogCategoryGroupUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    group = db.query(WorklogCategoryGroup).filter_by(id=group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if data.name is not None:
        group.name = data.name
    if data.color is not None:
        group.color = data.color
    db.commit()
    db.refresh(group)
    return group


@router.delete("/category-groups/{group_id}")
def delete_category_group(group_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    group = db.query(WorklogCategoryGroup).filter_by(id=group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(group)
    db.commit()
    return {"ok": True}


# ── Categories (Admin) ───────────────────────────────────

@router.post("/categories", response_model=WorklogCategoryOut)
def create_category(data: WorklogCategoryCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    group = db.query(WorklogCategoryGroup).filter_by(id=data.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    cat = WorklogCategory(group_id=data.group_id, name=data.name)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/categories/{cat_id}", response_model=WorklogCategoryOut)
def update_category(cat_id: int, data: WorklogCategoryUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    cat = db.query(WorklogCategory).filter_by(id=cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if data.name is not None:
        cat.name = data.name
    if data.group_id is not None:
        cat.group_id = data.group_id
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    cat = db.query(WorklogCategory).filter_by(id=cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(cat)
    db.commit()
    return {"ok": True}


# ── Worklog Entries ──────────────────────────────────────

def _enrich_entry(entry: WorklogEntry) -> dict:
    d = {c.name: getattr(entry, c.name) for c in entry.__table__.columns}
    d["user_name"] = entry.user.full_name if entry.user else None
    d["category_name"] = entry.category.name if entry.category else None
    d["group_name"] = entry.category.group.name if entry.category and entry.category.group else None
    d["attachments"] = [
        {"id": a.id, "file_name": a.file_name, "file_size": a.file_size, "created_at": a.created_at}
        for a in entry.attachments
    ]
    return d


@router.get("/entries")
def list_entries(
    log_date: Optional[date] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    q = db.query(WorklogEntry).filter(WorklogEntry.user_id == user.id)
    if log_date:
        q = q.filter(WorklogEntry.log_date == log_date)
    if status:
        q = q.filter(WorklogEntry.status == status)
    q = q.order_by(WorklogEntry.log_date.desc(), WorklogEntry.created_at.desc())
    return [_enrich_entry(e) for e in q.all()]


@router.post("/entries")
def create_entry(data: WorklogEntryCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entry = WorklogEntry(
        user_id=user.id,
        category_id=data.category_id,
        log_date=data.log_date,
        hours=data.hours,
        summary=data.summary,
        status="pending"
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    try:
        from app.services.worklog_notifications import notify_entry_submitted
        notify_entry_submitted(entry, db)
    except Exception:
        pass
    return _enrich_entry(entry)


@router.put("/entries/{entry_id}")
def update_entry(entry_id: int, data: WorklogEntryUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entry = db.query(WorklogEntry).filter_by(id=entry_id, user_id=user.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.status == "approved":
        raise HTTPException(status_code=400, detail="Cannot edit approved entry")
    if data.category_id is not None:
        entry.category_id = data.category_id
    if data.log_date is not None:
        entry.log_date = data.log_date
    if data.hours is not None:
        entry.hours = data.hours
    if data.summary is not None:
        entry.summary = data.summary
    if entry.status == "rejected":
        entry.status = "pending"
        entry.rejection_note = None
    db.commit()
    db.refresh(entry)
    return _enrich_entry(entry)


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entry = db.query(WorklogEntry).filter_by(id=entry_id, user_id=user.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.status == "approved":
        raise HTTPException(status_code=400, detail="Cannot delete approved entry")
    db.delete(entry)
    db.commit()
    return {"ok": True}


@router.post("/entries/{entry_id}/resubmit")
def resubmit_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entry = db.query(WorklogEntry).filter_by(id=entry_id, user_id=user.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.status != "rejected":
        raise HTTPException(status_code=400, detail="Only rejected entries can be resubmitted")
    entry.status = "pending"
    entry.rejection_note = None
    entry.reviewer_id = None
    entry.reviewed_at = None
    db.commit()
    try:
        from app.services.worklog_notifications import notify_entry_resubmitted
        notify_entry_resubmitted(entry, db)
    except Exception:
        pass
    return _enrich_entry(entry)


# ── Attachments ──────────────────────────────────────────

@router.post("/entries/{entry_id}/attachments")
async def upload_attachment(
    entry_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    entry = db.query(WorklogEntry).filter_by(id=entry_id, user_id=user.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    file_path = os.path.join(ATTACHMENT_DIR, f"{entry_id}_{file.filename}")
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    att = WorklogAttachment(
        worklog_entry_id=entry_id,
        file_path=file_path,
        file_name=file.filename,
        file_size=len(content),
        uploaded_by=user.id
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return {"id": att.id, "file_name": att.file_name, "file_size": att.file_size}


@router.get("/attachments/{att_id}/download")
def download_attachment(att_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from fastapi.responses import FileResponse
    att = db.query(WorklogAttachment).filter_by(id=att_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not os.path.exists(att.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(att.file_path, filename=att.file_name)


@router.delete("/attachments/{att_id}")
def delete_attachment(att_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    att = db.query(WorklogAttachment).filter_by(id=att_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    entry = db.query(WorklogEntry).filter_by(id=att.worklog_entry_id, user_id=user.id).first()
    if not entry:
        raise HTTPException(status_code=403, detail="Not your entry")
    if os.path.exists(att.file_path):
        os.remove(att.file_path)
    db.delete(att)
    db.commit()
    return {"ok": True}


# ── Timer ────────────────────────────────────────────────


@router.post("/timer/start")
def timer_start(data: WorklogTimerStartRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    existing = db.query(WorklogActiveTimer).filter(WorklogActiveTimer.user_id == user.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Timer already running")
    timer = WorklogActiveTimer(
        user_id=user.id,
        category_id=data.category_id,
        log_date=data.log_date or date.today(),
        start_time=datetime.now()
    )
    db.add(timer)
    db.commit()
    db.refresh(timer)
    return {"status": "started", "start_time": timer.start_time}


@router.post("/timer/stop")
def timer_stop(data: WorklogTimerStopRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    timer = db.query(WorklogActiveTimer).filter(WorklogActiveTimer.user_id == user.id).first()
    if not timer:
        raise HTTPException(status_code=400, detail="No active timer")
    elapsed = (datetime.now() - timer.start_time).total_seconds() / 3600.0
    entry = WorklogEntry(
        user_id=user.id,
        category_id=timer.category_id,
        log_date=timer.log_date,
        hours=round(elapsed, 2),
        summary=data.summary,
        status="pending"
    )
    db.add(entry)
    db.delete(timer)
    db.commit()
    db.refresh(entry)
    return _enrich_entry(entry)


@router.get("/timer/status")
def timer_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    timer = db.query(WorklogActiveTimer).filter(WorklogActiveTimer.user_id == user.id).first()
    if not timer:
        return {"active": False}
    elapsed = (datetime.now() - timer.start_time).total_seconds()
    return {"active": True, "category_id": timer.category_id, "elapsed_seconds": round(elapsed)}


# ── Approval (Admin) ─────────────────────────────────────

@router.get("/approval")
def list_pending_entries(
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    q = db.query(WorklogEntry).filter(WorklogEntry.status == "pending")
    if user_id:
        q = q.filter(WorklogEntry.user_id == user_id)
    q = q.order_by(WorklogEntry.log_date.desc(), WorklogEntry.created_at.desc())
    entries = q.all()
    result = []
    for e in entries:
        d = _enrich_entry(e)
        d["is_late_entry"] = e.created_at.date() != e.log_date if e.created_at else False
        result.append(d)
    return result


@router.post("/entries/{entry_id}/approve")
def approve_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    entry = db.query(WorklogEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.status != "pending":
        raise HTTPException(status_code=400, detail="Entry is not pending")
    entry.status = "approved"
    entry.reviewer_id = user.id
    entry.reviewed_at = datetime.now()
    db.commit()
    try:
        from app.services.worklog_notifications import notify_entry_approved
        notify_entry_approved(entry, db)
    except Exception:
        pass
    return _enrich_entry(entry)


@router.post("/entries/{entry_id}/reject")
def reject_entry(entry_id: int, data: WorklogRejectRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    entry = db.query(WorklogEntry).filter_by(id=entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.status != "pending":
        raise HTTPException(status_code=400, detail="Entry is not pending")
    entry.status = "rejected"
    entry.reviewer_id = user.id
    entry.reviewed_at = datetime.now()
    entry.rejection_note = data.rejection_note
    db.commit()
    try:
        from app.services.worklog_notifications import notify_entry_rejected
        notify_entry_rejected(entry, db)
    except Exception:
        pass
    return _enrich_entry(entry)


# ── Auto-Tracking ────────────────────────────────────────

@router.post("/auto/track-open")
def track_open(
    source: str,
    reference_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    existing = db.query(WorklogAutoEntry).filter_by(
        user_id=user.id, source=source, reference_id=reference_id, end_time=None
    ).first()
    if existing:
        return {"status": "already_tracking", "id": existing.id}
    entry = WorklogAutoEntry(
        user_id=user.id,
        source=source,
        reference_id=reference_id,
        log_date=date.today(),
        hours=0,
        start_time=datetime.now()
    )
    db.add(entry)
    db.commit()
    return {"status": "tracking", "id": entry.id}


@router.post("/auto/track-reply")
def track_reply(
    source: str,
    reference_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    entry = db.query(WorklogAutoEntry).filter_by(
        user_id=user.id, source=source, reference_id=reference_id, end_time=None
    ).order_by(WorklogAutoEntry.start_time.desc()).first()
    if not entry:
        return {"status": "no_open_tracking"}
    entry.end_time = datetime.now()
    elapsed = (entry.end_time - entry.start_time).total_seconds() / 3600.0
    entry.hours = round(elapsed, 2)
    db.commit()
    return {"status": "completed", "hours": entry.hours}


# ── Reports (Admin) ──────────────────────────────────────

@router.get("/reports")
def get_report(
    start_date: date,
    end_date: date,
    user_id: Optional[int] = None,
    source: Optional[str] = None,
    group_by: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    rows = []

    # 1. Manual worklog entries (approved only)
    if not source or source == "manual":
        q = db.query(WorklogEntry).filter(
            WorklogEntry.log_date >= start_date,
            WorklogEntry.log_date <= end_date,
            WorklogEntry.status == "approved"
        )
        if user_id:
            q = q.filter(WorklogEntry.user_id == user_id)
        for e in q.all():
            rows.append({
                "user_id": e.user_id,
                "user_name": e.user.full_name if e.user else "Unknown",
                "log_date": e.log_date,
                "source": "manual",
                "category_or_project": f"{e.category.group.name} > {e.category.name}" if e.category and e.category.group else None,
                "task_or_conversation": None,
                "hours": e.hours,
                "summary": e.summary,
                "attachments": [{"id": a.id, "file_name": a.file_name, "file_size": a.file_size, "created_at": a.created_at} for a in e.attachments],
                "is_late_entry": e.created_at.date() != e.log_date if e.created_at else False,
            })

    # 2. PMS task timelogs
    if not source or source == "pms":
        from app.models.pms import PMSTaskTimeLog, PMSTask, PMSProject
        tq = db.query(PMSTaskTimeLog).filter(
            PMSTaskTimeLog.log_date >= start_date,
            PMSTaskTimeLog.log_date <= end_date,
        )
        if user_id:
            tq = tq.filter(PMSTaskTimeLog.user_id == user_id)
        for tl in tq.all():
            task = db.query(PMSTask).filter_by(id=tl.task_id).first()
            project = db.query(PMSProject).filter_by(id=task.project_id).first() if task else None
            rows.append({
                "user_id": tl.user_id,
                "user_name": tl.user.full_name if tl.user else "Unknown",
                "log_date": tl.log_date,
                "source": "pms",
                "category_or_project": project.name if project else None,
                "task_or_conversation": task.title if task else None,
                "hours": tl.hours,
                "summary": tl.note,
                "attachments": [],
                "is_late_entry": False,
            })

    # 3. Auto-tracked entries (messaging, email, call)
    if not source or source in ("messaging", "email", "call"):
        aq = db.query(WorklogAutoEntry).filter(
            WorklogAutoEntry.log_date >= start_date,
            WorklogAutoEntry.log_date <= end_date,
            WorklogAutoEntry.end_time.isnot(None),
        )
        if user_id:
            aq = aq.filter(WorklogAutoEntry.user_id == user_id)
        if source and source in ("messaging", "email", "call"):
            aq = aq.filter(WorklogAutoEntry.source == source)
        for ae in aq.all():
            rows.append({
                "user_id": ae.user_id,
                "user_name": ae.user.full_name if ae.user else "Unknown",
                "log_date": ae.log_date,
                "source": ae.source,
                "category_or_project": None,
                "task_or_conversation": f"{ae.source.title()} #{ae.reference_id}" if ae.reference_id else None,
                "hours": ae.hours,
                "summary": None,
                "attachments": [],
                "is_late_entry": False,
            })

    rows.sort(key=lambda r: (r["log_date"], r["user_name"]), reverse=True)

    total_hours = sum(r["hours"] for r in rows)
    breakdown = {}
    for r in rows:
        breakdown[r["source"]] = breakdown.get(r["source"], 0) + r["hours"]

    return {"rows": rows, "total_hours": round(total_hours, 2), "breakdown": breakdown}


# ── Call Records Sync ────────────────────────────────────

@router.post("/auto/sync-calls")
def sync_call_records(
    sync_date: Optional[date] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    target_date = sync_date or date.today()

    try:
        from app.models.call_record import CallRecord
        records = db.query(CallRecord).filter(
            sqlfunc.date(CallRecord.created_at) == target_date
        ).all()
    except Exception:
        return {"synced": 0, "message": "Call records model not available"}

    synced = 0
    for record in records:
        existing = db.query(WorklogAutoEntry).filter_by(
            source="call", reference_id=record.id
        ).first()
        if existing:
            continue
        duration_hours = (record.duration or 0) / 3600.0
        if duration_hours <= 0:
            continue
        entry = WorklogAutoEntry(
            user_id=record.agent_id if hasattr(record, 'agent_id') else record.user_id,
            source="call",
            reference_id=record.id,
            log_date=target_date,
            hours=round(duration_hours, 2),
            start_time=record.created_at,
            end_time=record.ended_at if hasattr(record, 'ended_at') else None,
        )
        db.add(entry)
        synced += 1

    db.commit()
    return {"synced": synced, "date": str(target_date)}


# ── Export (CSV/PDF) ────────────────────────────────────

def _generate_report_pdf(rows, start_date, end_date, total_hours, breakdown, db):
    from fpdf import FPDF

    company_name = "Worklog Report"
    try:
        from app.models.branding import BrandingSettings
        b = db.query(BrandingSettings).first()
        if b and b.company_name:
            company_name = b.company_name
    except Exception:
        pass

    pdf = FPDF()
    pdf.add_page(orientation='L')
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, company_name, ln=True, align="C")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, f"Worklog Report: {start_date} to {end_date}", ln=True, align="C")
    pdf.cell(0, 7, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", ln=True, align="C")
    pdf.ln(5)

    pdf.set_font("Helvetica", "B", 9)
    col_widths = [35, 22, 22, 50, 50, 15, 80]
    headers = ["Agent", "Date", "Source", "Category/Project", "Task/Conversation", "Hours", "Summary"]
    for i, h in enumerate(headers):
        pdf.cell(col_widths[i], 7, h, border=1)
    pdf.ln()

    pdf.set_font("Helvetica", "", 8)
    for r in rows:
        pdf.cell(col_widths[0], 6, str(r.get("user_name", ""))[:20], border=1)
        pdf.cell(col_widths[1], 6, str(r.get("log_date", "")), border=1)
        pdf.cell(col_widths[2], 6, str(r.get("source", "")), border=1)
        pdf.cell(col_widths[3], 6, str(r.get("category_or_project", "") or "")[:30], border=1)
        pdf.cell(col_widths[4], 6, str(r.get("task_or_conversation", "") or "")[:30], border=1)
        pdf.cell(col_widths[5], 6, str(r["hours"]), border=1)
        pdf.cell(col_widths[6], 6, str(r.get("summary", "") or "")[:50], border=1)
        pdf.ln()

    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, f"Total Hours: {total_hours}", ln=True)
    breakdown_str = " | ".join(f"{k}: {v:.1f}h" for k, v in breakdown.items())
    pdf.cell(0, 7, f"Breakdown: {breakdown_str}", ln=True)

    return pdf.output()


@router.get("/reports/export")
def export_report(
    format: str,
    start_date: date,
    end_date: date,
    user_id: Optional[int] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    report = get_report(start_date=start_date, end_date=end_date, user_id=user_id, source=source, db=db, user=user)
    rows = report["rows"]

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Agent", "Date", "Source", "Category/Project", "Task/Conversation", "Hours", "Summary", "Attachments", "Late Entry"])
        for r in rows:
            att_names = ", ".join(a["file_name"] for a in r.get("attachments", []))
            writer.writerow([r["user_name"], str(r["log_date"]), r["source"], r.get("category_or_project", ""), r.get("task_or_conversation", ""), r["hours"], r.get("summary", ""), att_names, "Yes" if r.get("is_late_entry") else ""])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=worklog-report-{start_date}-to-{end_date}.csv"}
        )

    if format == "pdf":
        pdf_bytes = _generate_report_pdf(rows, start_date, end_date, report["total_hours"], report["breakdown"], db)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=worklog-report-{start_date}-to-{end_date}.pdf"}
        )

    raise HTTPException(status_code=400, detail="format must be 'csv' or 'pdf'")


@router.get("/entries/export")
def export_entries(
    format: str = "csv",
    log_date: Optional[date] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    q = db.query(WorklogEntry).filter(WorklogEntry.user_id == user.id)
    if log_date:
        q = q.filter(WorklogEntry.log_date == log_date)
    q = q.order_by(WorklogEntry.log_date.desc())
    entries = q.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Category", "Hours", "Summary", "Status", "Attachments"])
    for e in entries:
        cat_name = f"{e.category.group.name} > {e.category.name}" if e.category and e.category.group else ""
        att_names = ", ".join(a.file_name for a in e.attachments)
        writer.writerow([str(e.log_date), cat_name, e.hours, e.summary or "", e.status, att_names])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=my-worklog-{date.today()}.csv"}
    )


@router.get("/approval/history")
def get_approval_history(
    format: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    entries = db.query(WorklogEntry).filter(
        WorklogEntry.status.in_(["approved", "rejected"])
    ).order_by(WorklogEntry.reviewed_at.desc()).all()

    history = []
    for e in entries:
        history.append({
            "id": e.id,
            "user_name": e.user.full_name if e.user else "Unknown",
            "log_date": e.log_date,
            "hours": e.hours,
            "summary": e.summary,
            "status": e.status,
            "reviewer_name": e.reviewer.full_name if e.reviewer else "Unknown",
            "reviewed_at": e.reviewed_at,
            "rejection_note": e.rejection_note,
        })

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Agent", "Date", "Hours", "Summary", "Status", "Reviewer", "Reviewed At", "Rejection Note"])
        for h in history:
            writer.writerow([h["user_name"], str(h["log_date"]), h["hours"], h["summary"] or "", h["status"], h["reviewer_name"], str(h["reviewed_at"] or ""), h["rejection_note"] or ""])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=approval-history-{date.today()}.csv"}
        )

    return history


# ── Summary Metrics ─────────────────────────────────────

@router.get("/summary")
def get_summary(
    team: Optional[bool] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    today = date.today()
    week_start = today - timedelta(days=today.weekday())

    today_hours = db.query(sqlfunc.coalesce(sqlfunc.sum(WorklogEntry.hours), 0)).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.log_date == today
    ).scalar()

    week_hours = db.query(sqlfunc.coalesce(sqlfunc.sum(WorklogEntry.hours), 0)).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.log_date >= week_start, WorklogEntry.log_date <= today
    ).scalar()

    pending_count = db.query(WorklogEntry).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.status == "pending"
    ).count()

    approved_week_count = db.query(WorklogEntry).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.status == "approved",
        WorklogEntry.log_date >= week_start
    ).count()

    timer_active = db.query(WorklogActiveTimer).filter(WorklogActiveTimer.user_id == user.id).first() is not None

    result = {
        "today_hours": float(today_hours),
        "week_hours": float(week_hours),
        "pending_count": pending_count,
        "approved_week_count": approved_week_count,
        "timer_active": timer_active,
    }

    if team and getattr(user, 'role', '') == "admin":
        team_today = db.query(sqlfunc.coalesce(sqlfunc.sum(WorklogEntry.hours), 0)).filter(
            WorklogEntry.log_date == today
        ).scalar()
        total_pending = db.query(WorklogEntry).filter(WorklogEntry.status == "pending").count()
        result["team_today_hours"] = float(team_today)
        result["total_pending"] = total_pending

    return result


# ── Bulk Approval ───────────────────────────────────────

class BulkApproveRequest(PydanticBaseModel):
    entry_ids: list

class BulkRejectRequest(PydanticBaseModel):
    entry_ids: list
    rejection_note: str


@router.post("/entries/bulk-approve")
def bulk_approve(data: BulkApproveRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    entries = db.query(WorklogEntry).filter(
        WorklogEntry.id.in_(data.entry_ids),
        WorklogEntry.status == "pending"
    ).all()
    for entry in entries:
        entry.status = "approved"
        entry.reviewer_id = user.id
        entry.reviewed_at = datetime.now()
    db.commit()
    for entry in entries:
        try:
            from app.services.worklog_notifications import notify_entry_approved
            notify_entry_approved(entry, db)
        except Exception:
            pass
    return {"affected": len(entries)}


@router.post("/entries/bulk-reject")
def bulk_reject(data: BulkRejectRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    entries = db.query(WorklogEntry).filter(
        WorklogEntry.id.in_(data.entry_ids),
        WorklogEntry.status == "pending"
    ).all()
    for entry in entries:
        entry.status = "rejected"
        entry.reviewer_id = user.id
        entry.reviewed_at = datetime.now()
        entry.rejection_note = data.rejection_note
    db.commit()
    for entry in entries:
        try:
            from app.services.worklog_notifications import notify_entry_rejected
            notify_entry_rejected(entry, db)
        except Exception:
            pass
    return {"affected": len(entries)}
