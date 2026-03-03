# backend/app/schemas/db_migration.py
import re
from pydantic import BaseModel, field_validator, model_validator
from typing import Literal, Optional, List
from datetime import datetime


class DbMigrationResponse(BaseModel):
    id: int
    filename: str
    description: Optional[str] = None
    domain_suffix: Optional[str] = None
    uploaded_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DbMigrationLogResponse(BaseModel):
    id: int
    migration_id: int
    site_id: int
    server_id: int
    status: str
    error_message: Optional[str] = None
    executed_at: datetime
    # Joined fields (populated manually in route)
    domain_name: Optional[str] = None
    server_name: Optional[str] = None

    class Config:
        from_attributes = True


class DbMigrationScheduleUpsert(BaseModel):
    schedule_type: Literal["one_time", "recurring"] = "recurring"
    run_at: Optional[datetime] = None         # one_time: exact UTC datetime
    day_of_week: Optional[int] = None         # recurring: 0=Mon…6=Sun
    time_of_day: Optional[str] = None         # "HH:MM" 24h, both types
    enabled: bool = False
    notify_emails: Optional[str] = None       # comma-separated
    notify_hours_before: int = 24

    @field_validator("time_of_day")
    @classmethod
    def validate_time_of_day(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            raise ValueError("time_of_day must be in HH:MM 24-hour format")
        return v

    @model_validator(mode="after")
    def check_required_fields(self) -> "DbMigrationScheduleUpsert":
        if self.enabled:
            if self.schedule_type == "one_time" and self.run_at is None:
                raise ValueError("run_at is required for one_time schedules when enabled=True")
            if self.schedule_type == "recurring" and self.time_of_day is None:
                raise ValueError("time_of_day is required for recurring schedules when enabled=True")
        return self


class DbMigrationScheduleResponse(BaseModel):
    id: int
    server_id: int
    schedule_type: str
    run_at: Optional[datetime] = None
    day_of_week: Optional[int] = None
    time_of_day: Optional[str] = None
    notify_emails: Optional[str] = None
    notify_hours_before: int
    status: str
    enabled: bool
    last_run_at: Optional[datetime] = None
    server_name: Optional[str] = None

    class Config:
        from_attributes = True


class MigrationRunResult(BaseModel):
    server_id: int
    total_sites: int
    skipped: int
    success: int
    failed: int
    details: List[dict]
