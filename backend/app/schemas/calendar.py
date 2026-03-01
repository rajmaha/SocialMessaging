from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class CalendarConnectionResponse(BaseModel):
    id: int
    provider: str
    calendar_id: Optional[str] = None
    connected: bool = True
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CalendarStatusResponse(BaseModel):
    google: Optional[CalendarConnectionResponse] = None
    microsoft: Optional[CalendarConnectionResponse] = None
