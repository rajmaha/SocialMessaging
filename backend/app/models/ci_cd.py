# backend/app/models/ci_cd.py
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
)
from app.database import Base


class CICDRepo(Base):
    __tablename__ = "cicd_repos"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    repo_url = Column(String, nullable=False)
    branch = Column(String, nullable=False, default="main")
    local_path = Column(String, nullable=False)          # absolute path on the target server
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id", ondelete="SET NULL"), nullable=True)
    auth_type = Column(String, nullable=False, default="https")  # "ssh" | "https"
    ssh_private_key = Column(Text, nullable=True)        # PEM key (SSH auth for git)
    access_token = Column(String, nullable=True)         # PAT (HTTPS auth for git)
    db_host = Column(String, nullable=True)              # PostgreSQL host (on target server)
    db_port = Column(Integer, nullable=True, default=5432)
    schedule_enabled = Column(Boolean, nullable=False, default=False)
    schedule_cron = Column(String, nullable=True)        # e.g. "0 2 * * *"
    last_deployed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class CICDDeployment(Base):
    __tablename__ = "cicd_deployments"

    id = Column(Integer, primary_key=True, index=True)
    repo_id = Column(Integer, ForeignKey("cicd_repos.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String, nullable=False, default="running")   # running / success / failed
    triggered_by = Column(String, nullable=False, default="manual")  # manual / scheduled
    git_output = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)


class CICDScriptLog(Base):
    """Tracks which shell scripts have been executed per repository (never re-run)."""
    __tablename__ = "cicd_script_logs"

    id = Column(Integer, primary_key=True, index=True)
    repo_id = Column(Integer, ForeignKey("cicd_repos.id", ondelete="CASCADE"), nullable=False, index=True)
    deployment_id = Column(Integer, ForeignKey("cicd_deployments.id", ondelete="CASCADE"), nullable=False)
    script_filename = Column(String, nullable=False)
    exit_code = Column(Integer, nullable=True)
    stdout = Column(Text, nullable=True)
    stderr = Column(Text, nullable=True)
    executed_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("repo_id", "script_filename", name="uq_cicd_script_repo"),
    )


class CICDMigrationLog(Base):
    """Tracks which SQL files have been executed on which database (never re-run per db)."""
    __tablename__ = "cicd_migration_logs"

    id = Column(Integer, primary_key=True, index=True)
    repo_id = Column(Integer, ForeignKey("cicd_repos.id", ondelete="CASCADE"), nullable=False, index=True)
    deployment_id = Column(Integer, ForeignKey("cicd_deployments.id", ondelete="CASCADE"), nullable=False)
    database_name = Column(String, nullable=False)
    sql_filename = Column(String, nullable=False)
    status = Column(String, nullable=False, default="success")  # success / failed
    error = Column(Text, nullable=True)
    executed_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("repo_id", "database_name", "sql_filename", name="uq_cicd_migration_repo_db"),
    )
