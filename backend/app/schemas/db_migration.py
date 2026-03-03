# backend/app/schemas/db_migration.py
from pydantic import BaseModel
from typing import Optional, List
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
    schedule_type: str = "recurring"          # "one_time" or "recurring"
    run_at: Optional[datetime] = None         # one_time: exact UTC datetime
    day_of_week: Optional[int] = None         # recurring: 0=Mon…6=Sun
    time_of_day: Optional[str] = None         # "HH:MM" 24h, both types
    enabled: bool = False
    notify_emails: Optional[str] = None       # comma-separated
    notify_hours_before: int = 24


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
