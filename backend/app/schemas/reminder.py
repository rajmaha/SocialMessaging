from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class ReminderScheduleBase(BaseModel):
    name: str
    schedule_datetime: datetime
    audio_file: Optional[str] = None
    remarks: Optional[str] = None
    phone_numbers: List[str] = []
    is_enabled: bool = True


class ReminderScheduleCreate(ReminderScheduleBase):
    pass


class ReminderScheduleUpdate(BaseModel):
    name: Optional[str] = None
    schedule_datetime: Optional[datetime] = None
    audio_file: Optional[str] = None
    remarks: Optional[str] = None
    phone_numbers: Optional[List[str]] = None
    is_enabled: Optional[bool] = None


class ReminderScheduleResponse(ReminderScheduleBase):
    id: int
    status: str
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ReminderCallLogResponse(BaseModel):
    id: int
    schedule_id: int
    phone_number: str
    attempt: int
    call_status: str
    pbx_call_id: Optional[str] = None
    called_at: Optional[datetime] = None
    next_retry_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
