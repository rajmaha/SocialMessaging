# backend/app/models/db_migration.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class DbMigration(Base):
    __tablename__ = "db_migrations"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    description = Column(String, nullable=True)
    domain_suffix = Column(String, nullable=True)   # e.g. "abc.com" — NULL = all sites
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DbMigrationLog(Base):
    __tablename__ = "db_migration_logs"

    id = Column(Integer, primary_key=True, index=True)
    migration_id = Column(Integer, ForeignKey("db_migrations.id", ondelete="CASCADE"), nullable=False)
    site_id = Column(Integer, ForeignKey("cloudpanel_sites.id", ondelete="CASCADE"), nullable=False)
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending/running/success/failed
    error_message = Column(Text, nullable=True)
    executed_at = Column(DateTime(timezone=True), server_default=func.now())


class DbMigrationSchedule(Base):
    __tablename__ = "db_migration_schedules"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id", ondelete="CASCADE"),
                       nullable=False, unique=True)
    schedule_type = Column(String, nullable=False, default="recurring")  # one_time / recurring
    run_at = Column(DateTime(timezone=True), nullable=True)              # one_time only
    day_of_week = Column(Integer, nullable=True)                         # recurring: 0=Mon…6=Sun
    time_of_day = Column(String, nullable=True)                          # "HH:MM" 24h
    notify_emails = Column(Text, nullable=True)                          # comma-separated
    notify_hours_before = Column(Integer, nullable=False, default=24)
    status = Column(String, nullable=False, default="scheduled")         # scheduled/notified/completed/disabled
    enabled = Column(Boolean, nullable=False, default=False)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
