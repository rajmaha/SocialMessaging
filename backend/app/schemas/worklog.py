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
    source: str
    category_or_project: Optional[str] = None
    task_or_conversation: Optional[str] = None
    hours: float
    summary: Optional[str] = None
    attachments: List[WorklogAttachmentOut] = []
    is_late_entry: bool = False

class WorklogReportResponse(BaseModel):
    rows: List[WorklogReportRow]
    total_hours: float
    breakdown: dict
