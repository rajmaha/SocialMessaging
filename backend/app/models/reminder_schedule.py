from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, JSON, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base


class ReminderSchedule(Base):
    """Admin-created reminder schedule that auto-calls a list of phone numbers."""
    __tablename__ = "reminder_schedules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    schedule_datetime = Column(DateTime(timezone=True), nullable=False)
    audio_file = Column(String, nullable=True)          # path relative to audio_storage/
    remarks = Column(Text, nullable=True)
    phone_numbers = Column(JSON, default=list)          # ["0981234567", "0977654321", ...]
    is_enabled = Column(Boolean, default=True)
    # pending | running | completed | disabled
    status = Column(String, default="pending")
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    call_logs = relationship("ReminderCallLog", back_populates="schedule", cascade="all, delete-orphan")


class ReminderCallLog(Base):
    """Per-phone attempt log for a reminder schedule."""
    __tablename__ = "reminder_call_logs"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("reminder_schedules.id", ondelete="CASCADE"), nullable=False)
    phone_number = Column(String, nullable=False, index=True)
    attempt = Column(Integer, default=1)               # 1–5
    # pending | answered | no_answer | declined | failed | busy
    call_status = Column(String, default="pending")
    pbx_call_id = Column(String, nullable=True)        # AMI UniqueID for correlation
    called_at = Column(DateTime(timezone=True), nullable=True)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)

    # Relationship
    schedule = relationship("ReminderSchedule", back_populates="call_logs")
