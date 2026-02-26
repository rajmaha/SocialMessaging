from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class NotificationEntryBase(BaseModel):
    account_number: Optional[str] = None
    name: str
    phone_no: str
    message: str
    schedule_datetime: Optional[datetime] = None
    schedule_status: str = "enabled"


class NotificationEntryCreate(NotificationEntryBase):
    pass


class NotificationEntryUpdate(BaseModel):
    account_number: Optional[str] = None
    name: Optional[str] = None
    phone_no: Optional[str] = None
    message: Optional[str] = None
    schedule_datetime: Optional[datetime] = None
    schedule_status: Optional[str] = None


class NotificationEntryResponse(NotificationEntryBase):
    id: int
    call_status: str
    retry_count: int
    next_retry_at: Optional[datetime] = None
    pbx_call_id: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
