from sqlalchemy import Column, Integer, String, DateTime, BigInteger, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class BackupRun(Base):
    __tablename__ = "backup_runs"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("backup_jobs.id"), nullable=False)
    status = Column(String, default="running")  # running | success | failed
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    file_size_bytes = Column(BigInteger, nullable=True)
    backup_file_path = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)

    job = relationship("BackupJob", foreign_keys=[job_id])
