# backend/app/schemas/ci_cd.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Server (read-only view — sourced from cloudpanel_servers) ──────────────────

class CICDServerOut(BaseModel):
    id: int
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    has_ssh_key: bool = False
    has_ssh_password: bool = False
    is_cloudpanel: bool = True      # always True — these are CloudPanel servers
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CICDCloudPanelSite(BaseModel):
    domain: str
    path: str
    user: str


# ── Repo ──────────────────────────────────────────────────────────────────────

class CICDRepoCreate(BaseModel):
    name: str
    repo_url: str
    branch: str = "main"
    local_path: str
    server_id: Optional[int] = None
    auth_type: str = "https"
    ssh_private_key: Optional[str] = None
    access_token: Optional[str] = None
    db_host: Optional[str] = None
    db_port: Optional[int] = 5432
    schedule_enabled: bool = False
    schedule_cron: Optional[str] = None


class CICDRepoUpdate(BaseModel):
    name: Optional[str] = None
    repo_url: Optional[str] = None
    branch: Optional[str] = None
    local_path: Optional[str] = None
    server_id: Optional[int] = None
    auth_type: Optional[str] = None
    ssh_private_key: Optional[str] = None
    access_token: Optional[str] = None
    db_host: Optional[str] = None
    db_port: Optional[int] = None
    schedule_enabled: Optional[bool] = None
    schedule_cron: Optional[str] = None


class CICDRepoOut(BaseModel):
    id: int
    name: str
    repo_url: str
    branch: str
    local_path: str
    server_id: Optional[int] = None
    server_name: Optional[str] = None
    auth_type: str
    has_ssh_key: bool = False
    has_access_token: bool = False
    db_host: Optional[str] = None
    db_port: Optional[int] = None
    schedule_enabled: bool
    schedule_cron: Optional[str] = None
    last_deployed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_masked(cls, obj, server=None):
        return cls(
            id=obj.id,
            name=obj.name,
            repo_url=obj.repo_url,
            branch=obj.branch,
            local_path=obj.local_path,
            server_id=obj.server_id,
            server_name=server.name if server else None,
            auth_type=obj.auth_type,
            has_ssh_key=bool(obj.ssh_private_key),
            has_access_token=bool(obj.access_token),
            db_host=obj.db_host,
            db_port=obj.db_port,
            schedule_enabled=obj.schedule_enabled,
            schedule_cron=obj.schedule_cron,
            last_deployed_at=obj.last_deployed_at,
            created_at=obj.created_at,
        )


# ── Deployment ────────────────────────────────────────────────────────────────

class CICDDeploymentOut(BaseModel):
    id: int
    repo_id: int
    status: str
    triggered_by: str
    git_output: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Script log ────────────────────────────────────────────────────────────────

class CICDScriptLogOut(BaseModel):
    id: int
    repo_id: int
    deployment_id: int
    script_filename: str
    exit_code: Optional[int] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    executed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Migration log ─────────────────────────────────────────────────────────────

class CICDMigrationLogOut(BaseModel):
    id: int
    repo_id: int
    deployment_id: int
    database_name: str
    sql_filename: str
    status: str
    error: Optional[str] = None
    executed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Deployment detail (with nested logs) ──────────────────────────────────────

class CICDDeploymentDetailOut(CICDDeploymentOut):
    script_logs: List[CICDScriptLogOut] = []
    migration_logs: List[CICDMigrationLogOut] = []
