# backend/app/schemas/backup.py
from pydantic import BaseModel
from typing import Optional, Any, List
from datetime import datetime


# ── Destination ────────────────────────────────────────────────────────────────

class BackupDestinationCreate(BaseModel):
    name: str
    type: str  # local|sftp|scp|s3|google_drive|onedrive
    config: dict[str, Any] = {}
    is_active: bool = True

class BackupDestinationUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    config: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None

class BackupDestinationResponse(BaseModel):
    id: int
    name: str
    type: str
    config: dict[str, Any]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Job ────────────────────────────────────────────────────────────────────────

class BackupJobCreate(BaseModel):
    name: str
    source_type: str  # cloudpanel_server | local_app
    server_id: Optional[int] = None
    backup_scope: str = "both"  # db | files | both
    destination_id: int
    schedule_type: str = "manual"  # manual | interval | cron
    schedule_interval_hours: Optional[int] = None
    schedule_cron: Optional[str] = None
    retention_max_count: Optional[int] = None
    retention_max_days: Optional[int] = None
    notify_on_failure_emails: List[str] = []
    is_active: bool = True

class BackupJobUpdate(BaseModel):
    name: Optional[str] = None
    source_type: Optional[str] = None
    server_id: Optional[int] = None
    backup_scope: Optional[str] = None
    destination_id: Optional[int] = None
    schedule_type: Optional[str] = None
    schedule_interval_hours: Optional[int] = None
    schedule_cron: Optional[str] = None
    retention_max_count: Optional[int] = None
    retention_max_days: Optional[int] = None
    notify_on_failure_emails: Optional[List[str]] = None
    is_active: Optional[bool] = None

class BackupJobResponse(BaseModel):
    id: int
    name: str
    is_active: bool
    source_type: str
    server_id: Optional[int]
    backup_scope: str
    destination_id: int
    schedule_type: str
    schedule_interval_hours: Optional[int]
    schedule_cron: Optional[str]
    next_run_at: Optional[datetime]
    retention_max_count: Optional[int]
    retention_max_days: Optional[int]
    notify_on_failure_emails: List[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Run ────────────────────────────────────────────────────────────────────────

class BackupRunResponse(BaseModel):
    id: int
    job_id: int
    status: str
    started_at: datetime
    finished_at: Optional[datetime]
    file_size_bytes: Optional[int]
    backup_file_path: Optional[str]
    error_message: Optional[str]

    class Config:
        from_attributes = True


# ── Test connection ────────────────────────────────────────────────────────────

class DestinationTestRequest(BaseModel):
    type: str
    config: dict[str, Any]
