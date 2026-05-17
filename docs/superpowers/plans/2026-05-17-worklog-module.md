# Worklog Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily worklog module that unifies manual time entries, PMS task timelogs, and auto-tracked inbox/call time into a single approval and reporting system.

**Architecture:** New SQLAlchemy models for worklog categories (two-level hierarchy), entries, attachments, and auto-tracked entries. FastAPI routes following existing pattern (prefix `/api/worklog`, `Depends(get_current_user)`). Next.js pages under `/admin/worklog/` with category management, daily entry, approval queue, and unified reports.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, Next.js 14 App Router, TypeScript, TailwindCSS, Axios

---

## Chunk 1: Backend Models & Migrations

### Task 1: Create Worklog Models

**Files:**
- Create: `backend/app/models/worklog.py`

- [ ] **Step 1: Create the worklog models file**

```python
from sqlalchemy import Column, Integer, String, Text, Float, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base


class WorklogCategoryGroup(Base):
    __tablename__ = "worklog_category_groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    color = Column(String, default="#6366f1")
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    categories = relationship("WorklogCategory", back_populates="group", cascade="all, delete-orphan")


class WorklogCategory(Base):
    __tablename__ = "worklog_categories"
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("worklog_category_groups.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    group = relationship("WorklogCategoryGroup", back_populates="categories")


class WorklogEntry(Base):
    __tablename__ = "worklog_entries"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    category_id = Column(Integer, ForeignKey("worklog_categories.id", ondelete="SET NULL"), nullable=True)
    log_date = Column(Date, nullable=False)
    hours = Column(Float, nullable=False)
    summary = Column(Text)
    status = Column(String, default="pending")  # pending, approved, rejected
    reviewer_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    rejection_note = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])
    category = relationship("WorklogCategory")
    attachments = relationship("WorklogAttachment", back_populates="entry", cascade="all, delete-orphan")


class WorklogAttachment(Base):
    __tablename__ = "worklog_attachments"
    id = Column(Integer, primary_key=True, index=True)
    worklog_entry_id = Column(Integer, ForeignKey("worklog_entries.id", ondelete="CASCADE"))
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    entry = relationship("WorklogEntry", back_populates="attachments")


class WorklogAutoEntry(Base):
    __tablename__ = "worklog_auto_entries"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    source = Column(String, nullable=False)  # messaging, email, call
    reference_id = Column(Integer, nullable=True)
    log_date = Column(Date, nullable=False)
    hours = Column(Float, nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
```

- [ ] **Step 2: Register models in main.py for table creation**

Add to `backend/main.py` imports (near line 34 where other model imports are):
```python
from app.models import worklog  # noqa: F401
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/worklog.py backend/main.py
git commit -m "feat(worklog): add SQLAlchemy models for worklog module"
```

---

### Task 2: Create Worklog Schemas

**Files:**
- Create: `backend/app/schemas/worklog.py`

- [ ] **Step 1: Create Pydantic schemas**

```python
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


# ── Category Groups ──────────────────────────────────────
class WorklogCategoryGroupCreate(BaseModel):
    name: str
    color: str = "#6366f1"

class WorklogCategoryGroupUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

class WorklogCategoryGroupOut(BaseModel):
    id: int
    name: str
    color: str
    created_at: datetime
    categories: List["WorklogCategoryOut"] = []
    class Config: from_attributes = True


# ── Categories ───────────────────────────────────────────
class WorklogCategoryCreate(BaseModel):
    group_id: int
    name: str

class WorklogCategoryUpdate(BaseModel):
    name: Optional[str] = None
    group_id: Optional[int] = None

class WorklogCategoryOut(BaseModel):
    id: int
    group_id: int
    name: str
    created_at: datetime
    class Config: from_attributes = True


# ── Attachments ──────────────────────────────────────────
class WorklogAttachmentOut(BaseModel):
    id: int
    file_name: str
    file_size: int
    created_at: datetime
    class Config: from_attributes = True


# ── Entries ──────────────────────────────────────────────
class WorklogEntryCreate(BaseModel):
    category_id: int
    log_date: date
    hours: float
    summary: Optional[str] = None

class WorklogEntryUpdate(BaseModel):
    category_id: Optional[int] = None
    log_date: Optional[date] = None
    hours: Optional[float] = None
    summary: Optional[str] = None

class WorklogEntryOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    category_id: Optional[int]
    category_name: Optional[str] = None
    group_name: Optional[str] = None
    log_date: date
    hours: float
    summary: Optional[str]
    status: str
    reviewer_id: Optional[int]
    reviewed_at: Optional[datetime]
    rejection_note: Optional[str]
    created_at: datetime
    attachments: List[WorklogAttachmentOut] = []
    class Config: from_attributes = True


# ── Approval ─────────────────────────────────────────────
class WorklogApproveRequest(BaseModel):
    pass

class WorklogRejectRequest(BaseModel):
    rejection_note: str


# ── Timer ────────────────────────────────────────────────
class WorklogTimerStartRequest(BaseModel):
    category_id: int
    log_date: Optional[date] = None

class WorklogTimerStopRequest(BaseModel):
    summary: Optional[str] = None


# ── Auto Entry ───────────────────────────────────────────
class WorklogAutoEntryOut(BaseModel):
    id: int
    user_id: int
    source: str
    reference_id: Optional[int]
    log_date: date
    hours: float
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    created_at: datetime
    class Config: from_attributes = True


# ── Reports ──────────────────────────────────────────────
class WorklogReportRow(BaseModel):
    user_id: int
    user_name: str
    log_date: date
    source: str  # manual, pms, messaging, email, call
    category_or_project: Optional[str] = None
    task_or_conversation: Optional[str] = None
    hours: float
    summary: Optional[str] = None
    attachments: List[WorklogAttachmentOut] = []
    is_late_entry: bool = False

class WorklogReportResponse(BaseModel):
    rows: List[WorklogReportRow]
    total_hours: float
    breakdown: dict  # {source: total_hours}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/worklog.py
git commit -m "feat(worklog): add Pydantic schemas for worklog API"
```

---

## Chunk 2: Backend Routes — Categories & Entries

### Task 3: Create Worklog Routes — Category Management

**Files:**
- Create: `backend/app/routes/worklog.py`

- [ ] **Step 1: Create routes file with category CRUD (admin-only)**

```python
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, timedelta
import os

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.worklog import (
    WorklogCategoryGroup, WorklogCategory, WorklogEntry,
    WorklogAttachment, WorklogAutoEntry
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/worklog.py
git commit -m "feat(worklog): add category group and category CRUD routes"
```

---

### Task 4: Add Entry CRUD & Timer Routes

**Files:**
- Modify: `backend/app/routes/worklog.py`

- [ ] **Step 1: Add entry CRUD endpoints to worklog.py**

Append to `backend/app/routes/worklog.py`:

```python
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
# Timer state is stored in-memory per user (simple dict). For production, use Redis.
_active_timers: dict = {}  # user_id -> {category_id, log_date, start_time}


@router.post("/timer/start")
def timer_start(data: WorklogTimerStartRequest, user: User = Depends(get_current_user)):
    if user.id in _active_timers:
        raise HTTPException(status_code=400, detail="Timer already running")
    _active_timers[user.id] = {
        "category_id": data.category_id,
        "log_date": data.log_date or date.today(),
        "start_time": datetime.now()
    }
    return {"status": "started", "start_time": _active_timers[user.id]["start_time"]}


@router.post("/timer/stop")
def timer_stop(data: WorklogTimerStopRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.id not in _active_timers:
        raise HTTPException(status_code=400, detail="No active timer")
    timer = _active_timers.pop(user.id)
    end_time = datetime.now()
    elapsed = (end_time - timer["start_time"]).total_seconds() / 3600.0
    entry = WorklogEntry(
        user_id=user.id,
        category_id=timer["category_id"],
        log_date=timer["log_date"],
        hours=round(elapsed, 2),
        summary=data.summary,
        status="pending"
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _enrich_entry(entry)


@router.get("/timer/status")
def timer_status(user: User = Depends(get_current_user)):
    if user.id not in _active_timers:
        return {"active": False}
    timer = _active_timers[user.id]
    elapsed = (datetime.now() - timer["start_time"]).total_seconds()
    return {"active": True, "category_id": timer["category_id"], "elapsed_seconds": round(elapsed)}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/worklog.py
git commit -m "feat(worklog): add entry CRUD, attachments, and timer endpoints"
```

---

### Task 5: Add Approval & Auto-Tracking Routes

**Files:**
- Modify: `backend/app/routes/worklog.py`

- [ ] **Step 1: Add approval endpoints (admin-only)**

Append to `backend/app/routes/worklog.py`:

```python
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
    return _enrich_entry(entry)


# ── Auto-Tracking ────────────────────────────────────────

@router.post("/auto/track-open")
def track_open(
    source: str,
    reference_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Record when agent opens a conversation/email (frontend calls this)."""
    # Store temporary open event — will be matched when reply is sent
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
    """Record when agent sends a reply — completes the time entry."""
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/worklog.py
git commit -m "feat(worklog): add approval and auto-tracking endpoints"
```

---

### Task 6: Add Unified Report Endpoint

**Files:**
- Modify: `backend/app/routes/worklog.py`

- [ ] **Step 1: Add report endpoint that merges all sources**

Append to `backend/app/routes/worklog.py`:

```python
# ── Reports (Admin) ──────────────────────────────────────

@router.get("/reports")
def get_report(
    start_date: date,
    end_date: date,
    user_id: Optional[int] = None,
    source: Optional[str] = None,
    group_by: Optional[str] = None,  # agent, category, source
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

    # Sort by date desc, then user
    rows.sort(key=lambda r: (r["log_date"], r["user_name"]), reverse=True)

    # Compute totals
    total_hours = sum(r["hours"] for r in rows)
    breakdown = {}
    for r in rows:
        breakdown[r["source"]] = breakdown.get(r["source"], 0) + r["hours"]

    return {"rows": rows, "total_hours": round(total_hours, 2), "breakdown": breakdown}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/worklog.py
git commit -m "feat(worklog): add unified report endpoint merging all time sources"
```

---

### Task 7: Register Worklog Router in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Import and register the worklog router**

Add import near line 14 (with other route imports):
```python
from app.routes import worklog as worklog_routes
```

Add router registration near line 1988 (end of router list):
```python
app.include_router(worklog_routes.router)
```

- [ ] **Step 2: Commit**

```bash
git add backend/main.py
git commit -m "feat(worklog): register worklog router in main app"
```

---

## Chunk 3: Frontend — API Client & Category Management

### Task 8: Add Worklog API Client

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add worklogApi object to api.ts**

Add after the `pmsApi` export block:

```typescript
export const worklogApi = {
  // Category Groups
  listCategoryGroups: () => api.get('/api/worklog/category-groups'),
  createCategoryGroup: (data: any) => api.post('/api/worklog/category-groups', data),
  updateCategoryGroup: (id: number, data: any) => api.put(`/api/worklog/category-groups/${id}`, data),
  deleteCategoryGroup: (id: number) => api.delete(`/api/worklog/category-groups/${id}`),

  // Categories
  createCategory: (data: any) => api.post('/api/worklog/categories', data),
  updateCategory: (id: number, data: any) => api.put(`/api/worklog/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/api/worklog/categories/${id}`),

  // Entries
  listEntries: (params?: any) => api.get('/api/worklog/entries', { params }),
  createEntry: (data: any) => api.post('/api/worklog/entries', data),
  updateEntry: (id: number, data: any) => api.put(`/api/worklog/entries/${id}`, data),
  deleteEntry: (id: number) => api.delete(`/api/worklog/entries/${id}`),
  resubmitEntry: (id: number) => api.post(`/api/worklog/entries/${id}/resubmit`),

  // Attachments
  uploadAttachment: (entryId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/api/worklog/entries/${entryId}/attachments`, fd);
  },
  deleteAttachment: (id: number) => api.delete(`/api/worklog/attachments/${id}`),

  // Timer
  startTimer: (data: any) => api.post('/api/worklog/timer/start', data),
  stopTimer: (data: any) => api.post('/api/worklog/timer/stop', data),
  getTimerStatus: () => api.get('/api/worklog/timer/status'),

  // Approval (admin)
  listPendingEntries: (params?: any) => api.get('/api/worklog/approval', { params }),
  approveEntry: (id: number) => api.post(`/api/worklog/entries/${id}/approve`),
  rejectEntry: (id: number, data: any) => api.post(`/api/worklog/entries/${id}/reject`, data),

  // Auto-tracking
  trackOpen: (source: string, referenceId: number) =>
    api.post(`/api/worklog/auto/track-open?source=${source}&reference_id=${referenceId}`),
  trackReply: (source: string, referenceId: number) =>
    api.post(`/api/worklog/auto/track-reply?source=${source}&reference_id=${referenceId}`),

  // Reports (admin)
  getReport: (params: any) => api.get('/api/worklog/reports', { params }),
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(worklog): add worklog API client methods"
```

---

### Task 9: Create Category Management Page

**Files:**
- Create: `frontend/app/admin/worklog/categories/page.tsx`

- [ ] **Step 1: Create categories admin page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

interface Category { id: number; name: string; group_id: number; created_at: string; }
interface CategoryGroup { id: number; name: string; color: string; created_at: string; categories: Category[]; }

export default function WorklogCategories() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState<number | null>(null);
  const [groupForm, setGroupForm] = useState({ name: '', color: '#6366f1' });
  const [catForm, setCatForm] = useState({ name: '' });
  const [editGroup, setEditGroup] = useState<CategoryGroup | null>(null);

  const load = () => {
    setLoading(true);
    worklogApi.listCategoryGroups().then(r => { setGroups(r.data); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleCreateGroup = async () => {
    await worklogApi.createCategoryGroup(groupForm);
    setGroupForm({ name: '', color: '#6366f1' });
    setShowGroupForm(false);
    load();
  };

  const handleUpdateGroup = async () => {
    if (!editGroup) return;
    await worklogApi.updateCategoryGroup(editGroup.id, groupForm);
    setEditGroup(null);
    setGroupForm({ name: '', color: '#6366f1' });
    load();
  };

  const handleDeleteGroup = async (id: number) => {
    if (!confirm('Delete this group and all its categories?')) return;
    await worklogApi.deleteCategoryGroup(id);
    load();
  };

  const handleCreateCategory = async (groupId: number) => {
    await worklogApi.createCategory({ group_id: groupId, name: catForm.name });
    setCatForm({ name: '' });
    setShowCatForm(null);
    load();
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('Delete this category?')) return;
    await worklogApi.deleteCategory(id);
    load();
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Worklog Categories</h1>
          <button onClick={() => { setShowGroupForm(true); setEditGroup(null); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            + Add Group
          </button>
        </div>

        {(showGroupForm || editGroup) && (
          <div className="bg-white border rounded-lg p-4 mb-4">
            <h3 className="font-medium mb-3">{editGroup ? 'Edit Group' : 'New Group'}</h3>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-sm text-gray-600">Name</label>
                <input value={groupForm.name} onChange={e => setGroupForm({ ...groupForm, name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g., Development" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Color</label>
                <input type="color" value={groupForm.color} onChange={e => setGroupForm({ ...groupForm, color: e.target.value })} className="w-12 h-9 border rounded cursor-pointer" />
              </div>
              <button onClick={editGroup ? handleUpdateGroup : handleCreateGroup} className="px-4 py-2 bg-indigo-600 text-white rounded text-sm">
                {editGroup ? 'Update' : 'Create'}
              </button>
              <button onClick={() => { setShowGroupForm(false); setEditGroup(null); }} className="px-4 py-2 bg-gray-200 rounded text-sm">Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No category groups yet. Create one to get started.</div>
        ) : (
          <div className="space-y-4">
            {groups.map(group => (
              <div key={group.id} className="bg-white border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderLeftWidth: 4, borderLeftColor: group.color }}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
                    <span className="font-medium text-gray-900">{group.name}</span>
                    <span className="text-xs text-gray-500">({group.categories.length} categories)</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCatForm(group.id)} className="text-xs text-indigo-600 hover:underline">+ Category</button>
                    <button onClick={() => { setEditGroup(group); setGroupForm({ name: group.name, color: group.color }); }} className="text-xs text-gray-500 hover:underline">Edit</button>
                    <button onClick={() => handleDeleteGroup(group.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>

                {showCatForm === group.id && (
                  <div className="px-4 py-3 bg-gray-50 border-b flex gap-2 items-end">
                    <input value={catForm.name} onChange={e => setCatForm({ name: e.target.value })} className="flex-1 border rounded px-3 py-1.5 text-sm" placeholder="Category name" />
                    <button onClick={() => handleCreateCategory(group.id)} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">Add</button>
                    <button onClick={() => setShowCatForm(null)} className="px-3 py-1.5 bg-gray-200 rounded text-sm">Cancel</button>
                  </div>
                )}

                {group.categories.length > 0 && (
                  <div className="divide-y">
                    {group.categories.map(cat => (
                      <div key={cat.id} className="flex items-center justify-between px-4 py-2.5 pl-8">
                        <span className="text-sm text-gray-700">{cat.name}</span>
                        <button onClick={() => handleDeleteCategory(cat.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/worklog/categories/page.tsx
git commit -m "feat(worklog): add category management admin page"
```

---

## Chunk 4: Frontend — Daily Entry Page

### Task 10: Create Daily Worklog Entry Page

**Files:**
- Create: `frontend/app/admin/worklog/page.tsx`

- [ ] **Step 1: Create the main worklog entry page with timer + manual entry**

```tsx
'use client';
import { useEffect, useState, useRef } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

interface CategoryGroup { id: number; name: string; color: string; categories: { id: number; name: string; }[]; }
interface Entry { id: number; category_id: number; category_name: string; group_name: string; log_date: string; hours: number; summary: string; status: string; rejection_note: string | null; attachments: any[]; created_at: string; }

export default function WorklogPage() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [form, setForm] = useState({ category_id: 0, hours: '', summary: '' });
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerCategoryId, setTimerCategoryId] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const load = async () => {
    setLoading(true);
    const [groupsRes, entriesRes, timerRes] = await Promise.all([
      worklogApi.listCategoryGroups(),
      worklogApi.listEntries({ log_date: selectedDate }),
      worklogApi.getTimerStatus(),
    ]);
    setGroups(groupsRes.data);
    setEntries(entriesRes.data);
    if (timerRes.data.active) {
      setTimerActive(true);
      setTimerSeconds(timerRes.data.elapsed_seconds);
      setTimerCategoryId(timerRes.data.category_id);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [selectedDate]);

  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerActive]);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartTimer = async () => {
    if (!timerCategoryId) return alert('Select a category first');
    await worklogApi.startTimer({ category_id: timerCategoryId, log_date: selectedDate });
    setTimerActive(true);
    setTimerSeconds(0);
  };

  const handleStopTimer = async () => {
    const summary = prompt('Summary for this time entry:') || '';
    await worklogApi.stopTimer({ summary });
    setTimerActive(false);
    setTimerSeconds(0);
    load();
  };

  const handleManualEntry = async () => {
    if (!form.category_id || !form.hours) return;
    await worklogApi.createEntry({ category_id: form.category_id, log_date: selectedDate, hours: parseFloat(form.hours), summary: form.summary });
    setForm({ category_id: 0, hours: '', summary: '' });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this entry?')) return;
    await worklogApi.deleteEntry(id);
    load();
  };

  const handleResubmit = async (id: number) => {
    await worklogApi.resubmitEntry(id);
    load();
  };

  const handleFileUpload = async (entryId: number, file: File) => {
    await worklogApi.uploadAttachment(entryId, file);
    load();
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || ''}`}>{status}</span>;
  };

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader />
      <AdminNav />
      <div className="p-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Daily Worklog</h1>
          <div className="flex items-center gap-3">
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border rounded px-3 py-2 text-sm" />
            <span className="text-sm text-gray-500">Total: <strong>{totalHours.toFixed(1)}h</strong></span>
          </div>
        </div>

        {/* Timer Section */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Timer</h3>
          <div className="flex items-center gap-4">
            <select value={timerCategoryId} onChange={e => setTimerCategoryId(Number(e.target.value))} className="border rounded px-3 py-2 text-sm flex-1" disabled={timerActive}>
              <option value={0}>Select category...</option>
              {groups.map(g => (
                <optgroup key={g.id} label={g.name}>
                  {g.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
            <span className="font-mono text-xl font-bold text-gray-900 w-28 text-center">{formatTime(timerSeconds)}</span>
            {!timerActive ? (
              <button onClick={handleStartTimer} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Start</button>
            ) : (
              <button onClick={handleStopTimer} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Stop</button>
            )}
          </div>
        </div>

        {/* Manual Entry Form */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Manual Entry</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Category</label>
              <select value={form.category_id} onChange={e => setForm({ ...form, category_id: Number(e.target.value) })} className="w-full border rounded px-3 py-2 text-sm">
                <option value={0}>Select...</option>
                {groups.map(g => (
                  <optgroup key={g.id} label={g.name}>
                    {g.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="text-xs text-gray-500">Hours</label>
              <input type="number" step="0.25" min="0" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="2.5" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500">Summary</label>
              <input value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="What did you work on?" />
            </div>
            <button onClick={handleManualEntry} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Add</button>
          </div>
        </div>

        {/* Entries List */}
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h3 className="text-sm font-medium text-gray-700">Today's Entries</h3>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No entries for this date.</div>
          ) : (
            <div className="divide-y">
              {entries.map(entry => (
                <div key={entry.id} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{entry.group_name} &gt; {entry.category_name}</span>
                      {statusBadge(entry.status)}
                    </div>
                    {entry.summary && <p className="text-sm text-gray-600 mt-0.5">{entry.summary}</p>}
                    {entry.rejection_note && <p className="text-xs text-red-600 mt-1">Rejection: {entry.rejection_note}</p>}
                    {entry.attachments.length > 0 && (
                      <div className="flex gap-2 mt-1">
                        {entry.attachments.map((a: any) => (
                          <span key={a.id} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{a.file_name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-900 w-16 text-right">{entry.hours}h</span>
                  <div className="flex gap-2">
                    {entry.status === 'pending' && (
                      <>
                        <label className="text-xs text-indigo-600 hover:underline cursor-pointer">
                          Attach
                          <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload(entry.id, e.target.files[0])} />
                        </label>
                        <button onClick={() => handleDelete(entry.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </>
                    )}
                    {entry.status === 'rejected' && (
                      <button onClick={() => handleResubmit(entry.id)} className="text-xs text-indigo-600 hover:underline">Resubmit</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/worklog/page.tsx
git commit -m "feat(worklog): add daily worklog entry page with timer"
```

---

## Chunk 5: Frontend — Approval Queue & Reports

### Task 11: Create Approval Queue Page

**Files:**
- Create: `frontend/app/admin/worklog/approval/page.tsx`

- [ ] **Step 1: Create approval queue page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

interface PendingEntry {
  id: number; user_id: number; user_name: string; category_name: string; group_name: string;
  log_date: string; hours: number; summary: string; attachments: any[]; created_at: string; is_late_entry: boolean;
}

export default function WorklogApproval() {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = () => {
    setLoading(true);
    worklogApi.listPendingEntries().then(r => { setEntries(r.data); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: number) => {
    await worklogApi.approveEntry(id);
    load();
  };

  const handleReject = async () => {
    if (!rejectId || !rejectNote.trim()) return;
    await worklogApi.rejectEntry(rejectId, { rejection_note: rejectNote });
    setRejectId(null);
    setRejectNote('');
    load();
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader />
      <AdminNav />
      <div className="p-6 max-w-6xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Worklog Approval Queue</h1>

        {rejectId && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="font-medium mb-3">Rejection Reason</h3>
              <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} className="w-full border rounded px-3 py-2 text-sm h-24" placeholder="Explain why this entry is rejected..." />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => { setRejectId(null); setRejectNote(''); }} className="px-3 py-2 bg-gray-200 rounded text-sm">Cancel</button>
                <button onClick={handleReject} className="px-3 py-2 bg-red-600 text-white rounded text-sm">Reject</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No pending entries to approve.</div>
        ) : (
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Agent</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Hours</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Summary</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Attachments</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map(entry => (
                  <tr key={entry.id} className={entry.is_late_entry ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{entry.user_name}</span>
                      {entry.is_late_entry && <span className="ml-2 text-xs text-amber-600" title="Late entry">&#9888;</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{entry.log_date}</td>
                    <td className="px-4 py-3 text-gray-600">{entry.group_name} &gt; {entry.category_name}</td>
                    <td className="px-4 py-3 text-right font-bold">{entry.hours}h</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{entry.summary || '—'}</td>
                    <td className="px-4 py-3">
                      {entry.attachments.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {entry.attachments.map((a: any) => (
                            <span key={a.id} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{a.file_name}</span>
                          ))}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => handleApprove(entry.id)} className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium">Approve</button>
                        <button onClick={() => setRejectId(entry.id)} className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/worklog/approval/page.tsx
git commit -m "feat(worklog): add approval queue page for admins"
```

---

### Task 12: Create Unified Reports Page

**Files:**
- Create: `frontend/app/admin/worklog/reports/page.tsx`

- [ ] **Step 1: Create reports page with filters and unified table**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

type Period = 'daily' | 'weekly' | 'monthly' | 'custom';

function getDateRange(period: Period, refDate: string): { start_date: string; end_date: string } {
  const d = new Date(refDate);
  if (period === 'daily') return { start_date: refDate, end_date: refDate };
  if (period === 'weekly') {
    const day = d.getDay();
    const start = new Date(d); start.setDate(d.getDate() - day);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start_date: start.toISOString().split('T')[0], end_date: end.toISOString().split('T')[0] };
  }
  if (period === 'monthly') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start_date: start.toISOString().split('T')[0], end_date: end.toISOString().split('T')[0] };
  }
  return { start_date: refDate, end_date: refDate };
}

const SOURCE_COLORS: Record<string, string> = {
  manual: 'bg-indigo-100 text-indigo-700',
  pms: 'bg-purple-100 text-purple-700',
  messaging: 'bg-green-100 text-green-700',
  email: 'bg-blue-100 text-blue-700',
  call: 'bg-orange-100 text-orange-700',
};

export default function WorklogReports() {
  const [period, setPeriod] = useState<Period>('daily');
  const [refDate, setRefDate] = useState(new Date().toISOString().split('T')[0]);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    let params: any;
    if (period === 'custom') {
      params = { start_date: customStart, end_date: customEnd };
    } else {
      params = getDateRange(period, refDate);
    }
    if (sourceFilter) params.source = sourceFilter;
    const res = await worklogApi.getReport(params);
    setReport(res.data);
    setLoading(false);
  };

  useEffect(() => {
    if (period === 'custom' && (!customStart || !customEnd)) return;
    loadReport();
  }, [period, refDate, customStart, customEnd, sourceFilter]);

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader />
      <AdminNav />
      <div className="p-6 max-w-7xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Worklog Report</h1>

        {/* Filters */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Period</label>
              <select value={period} onChange={e => setPeriod(e.target.value as Period)} className="border rounded px-3 py-2 text-sm">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {period !== 'custom' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reference Date</label>
                <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="border rounded px-3 py-2 text-sm" />
              </div>
            )}
            {period === 'custom' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Start</label>
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="border rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End</label>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="border rounded px-3 py-2 text-sm" />
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Source</label>
              <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
                <option value="">All Sources</option>
                <option value="manual">Manual</option>
                <option value="pms">PMS Tasks</option>
                <option value="messaging">Messaging</option>
                <option value="email">Email</option>
                <option value="call">Calls</option>
              </select>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{report.total_hours}h</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            {Object.entries(report.breakdown as Record<string, number>).map(([src, hrs]) => (
              <div key={src} className="bg-white border rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-gray-900">{(hrs as number).toFixed(1)}h</div>
                <div className="text-xs text-gray-500 capitalize">{src}</div>
              </div>
            ))}
          </div>
        )}

        {/* Report Table */}
        <div className="bg-white border rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading report...</div>
          ) : !report || report.rows.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No data for selected period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Agent</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category / Project</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Task / Conversation</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Hours</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Summary</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Attachments</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.map((row: any, i: number) => (
                  <tr key={i} className={row.is_late_entry ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.user_name}
                      {row.is_late_entry && <span className="ml-1 text-amber-600" title="Late entry">&#9888;</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.log_date}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[row.source] || ''}`}>{row.source}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.category_or_project || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{row.task_or_conversation || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold">{row.hours}h</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{row.summary || '—'}</td>
                    <td className="px-4 py-3">
                      {row.attachments?.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {row.attachments.map((a: any) => (
                            <span key={a.id} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{a.file_name}</span>
                          ))}
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/worklog/reports/page.tsx
git commit -m "feat(worklog): add unified reports page with period filters"
```

---

## Chunk 6: Auto-Tracking Integration

### Task 13: Add Auto-Tracking Hooks to Messaging & Email Components

**Files:**
- Modify: Frontend messaging/email components to call `worklogApi.trackOpen()` and `worklogApi.trackReply()`

- [ ] **Step 1: Identify the conversation view component**

Search for the component that opens/displays a conversation:
```bash
grep -rn "setActiveConversation\|ConversationView\|MessagePanel" frontend/app/dashboard/ frontend/components/ --include="*.tsx" | head -20
```

- [ ] **Step 2: Add trackOpen call when a conversation is opened**

In the conversation view component, add at the point where a conversation is selected/opened:
```typescript
import { worklogApi } from '@/lib/api';

// When conversation is opened/focused:
worklogApi.trackOpen('messaging', conversationId).catch(() => {});
```

- [ ] **Step 3: Add trackReply call when a message is sent**

In the message send handler, add after successful send:
```typescript
// After message is sent successfully:
worklogApi.trackReply('messaging', conversationId).catch(() => {});
```

- [ ] **Step 4: Add trackOpen/trackReply to email compose/reply**

In the email view component, add similar hooks:
```typescript
// When email is opened:
worklogApi.trackOpen('email', emailThreadId).catch(() => {});

// When reply is sent:
worklogApi.trackReply('email', emailThreadId).catch(() => {});
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(worklog): integrate auto-tracking into messaging and email views"
```

---

### Task 14: Add Workspace Call Records Sync

**Files:**
- Modify: `backend/app/routes/worklog.py`

- [ ] **Step 1: Add call sync endpoint**

Append to `backend/app/routes/worklog.py`:

```python
# ── Call Records Sync ────────────────────────────────────

@router.post("/auto/sync-calls")
def sync_call_records(
    sync_date: Optional[date] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Sync call records from workspace call recordings into worklog auto entries."""
    _require_admin(user)
    target_date = sync_date or date.today()

    # Pull from existing call records in DB (from telephony/recordings module)
    from app.models.user import User as UserModel
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
            user_id=record.agent_id or record.user_id,
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/worklog.py
git commit -m "feat(worklog): add call records sync endpoint"
```

---

## Chunk 7: Final Wiring & Navigation

### Task 15: Add Worklog Navigation Links

**Files:**
- Modify: `frontend/components/AdminNav.tsx` (or wherever sidebar nav is defined)

- [ ] **Step 1: Find and read the admin navigation component**

```bash
grep -rn "worklog\|pms\|Worklog" frontend/components/AdminNav.tsx
```

- [ ] **Step 2: Add worklog section to admin navigation**

Add a new nav group for Worklog with links:
- `/admin/worklog` — My Worklog
- `/admin/worklog/approval` — Approval Queue (admin only)
- `/admin/worklog/reports` — Reports (admin only)
- `/admin/worklog/categories` — Categories (admin only)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat(worklog): add worklog links to admin navigation"
```

---

### Task 16: Verify Backend Startup & Frontend Build

- [ ] **Step 1: Start backend and verify no import errors**

```bash
cd backend && source venv/bin/activate && python -c "from app.routes.worklog import router; print('OK')"
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

- [ ] **Step 3: Start both services and test in browser**

```bash
./start.sh
```

Navigate to:
- `http://localhost:3000/admin/worklog` — daily entry page
- `http://localhost:3000/admin/worklog/categories` — category management
- `http://localhost:3000/admin/worklog/approval` — approval queue
- `http://localhost:3000/admin/worklog/reports` — unified reports

- [ ] **Step 4: Test API via Swagger**

Open `http://localhost:8000/docs`, find worklog endpoints, and test:
- Create a category group + category
- Create a manual entry
- Approve/reject it
- Fetch reports

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(worklog): address any startup or build issues"
```
