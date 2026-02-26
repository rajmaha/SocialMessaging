from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base


class NotificationEntry(Base):
    """Notification record with TTS message – auto-calls phone and plays voice message."""
    __tablename__ = "notification_entries"

    id = Column(Integer, primary_key=True, index=True)
    account_number = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    phone_no = Column(String, nullable=False, index=True)
    message = Column(Text, nullable=False)             # Text to be converted to speech
    schedule_datetime = Column(DateTime(timezone=True), nullable=True)

    # enabled | disabled
    schedule_status = Column(String, default="enabled")

    # pending | answered | no_answer | declined | failed | busy
    call_status = Column(String, default="pending")

    retry_count = Column(Integer, default=0)           # 0–5 (max retries)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)
    pbx_call_id = Column(String, nullable=True)        # AMI UniqueID for correlation

    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationship
    creator = relationship("User", foreign_keys=[created_by])
