from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class BackupJob(Base):
    __tablename__ = "backup_jobs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

    # Source
    source_type = Column(String, nullable=False)  # cloudpanel_server | local_app
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id", ondelete="SET NULL"), nullable=True)
    backup_scope = Column(String, default="both")  # db | files | both

    # Destination
    destination_id = Column(Integer, ForeignKey("backup_destinations.id", ondelete="RESTRICT"), nullable=False)

    # Schedule
    schedule_type = Column(String, default="manual")  # manual | interval | cron
    schedule_interval_hours = Column(Integer, nullable=True)
    schedule_cron = Column(String, nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)

    # Retention
    retention_max_count = Column(Integer, nullable=True)
    retention_max_days = Column(Integer, nullable=True)

    # Notifications
    notify_on_failure_emails = Column(JSON, default=list)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    destination = relationship("BackupDestination", foreign_keys=[destination_id])
    server = relationship("CloudPanelServer", foreign_keys=[server_id])
