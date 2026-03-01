from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class ReminderBase(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "as_usual"  # planning, low, as_usual, urgent
    due_date: Optional[datetime] = None


class ReminderCreate(ReminderBase):
    pass


class ReminderUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[datetime] = None


class ReminderReschedule(BaseModel):
    due_date: datetime


class ReminderStatusUpdate(BaseModel):
    status: str  # scheduled, pending, completed


class ReminderResponse(ReminderBase):
    id: int
    user_id: int
    status: str
    original_due_date: Optional[datetime] = None
    google_event_id: Optional[str] = None
    microsoft_event_id: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    owner_name: Optional[str] = None
    share_count: int = 0
    comment_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ReminderShareRequest(BaseModel):
    user_ids: List[int] = []  # list of user IDs to share with
    share_all: bool = False


class ReminderShareResponse(BaseModel):
    id: int
    reminder_id: int
    shared_by: int
    shared_with: int
    is_seen: bool
    created_at: datetime
    sharer_name: Optional[str] = None
    reminder_title: Optional[str] = None
    reminder_description: Optional[str] = None
    reminder_priority: Optional[str] = None
    reminder_due_date: Optional[datetime] = None
    reminder_status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ReminderCommentCreate(BaseModel):
    content: str


class ReminderCommentResponse(BaseModel):
    id: int
    reminder_id: int
    user_id: int
    content: str
    created_at: datetime
    author_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UnseenCountResponse(BaseModel):
    count: int
