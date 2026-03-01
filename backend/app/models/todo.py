from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class ReminderPriority(str, enum.Enum):
    PLANNING = "planning"
    LOW = "low"
    AS_USUAL = "as_usual"
    URGENT = "urgent"


class ReminderStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    PENDING = "pending"
    COMPLETED = "completed"


class Reminder(Base):
    __tablename__ = "todos"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String, nullable=False, default="as_usual")
    status = Column(String, nullable=False, default="scheduled")
    due_date = Column(DateTime(timezone=True), nullable=True)
    original_due_date = Column(DateTime(timezone=True), nullable=True)
    google_event_id = Column(String, nullable=True)
    microsoft_event_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[user_id], backref="todos")
    shares = relationship("ReminderShare", back_populates="reminder", cascade="all, delete-orphan")
    comments = relationship("ReminderComment", back_populates="reminder", cascade="all, delete-orphan")


class ReminderShare(Base):
    __tablename__ = "reminder_shares"

    id = Column(Integer, primary_key=True, index=True)
    reminder_id = Column(Integer, ForeignKey("todos.id", ondelete="CASCADE"), nullable=False)
    shared_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    shared_with = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_seen = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reminder = relationship("Reminder", back_populates="shares")
    sharer = relationship("User", foreign_keys=[shared_by])
    recipient = relationship("User", foreign_keys=[shared_with])


class ReminderComment(Base):
    __tablename__ = "reminder_comments"

    id = Column(Integer, primary_key=True, index=True)
    reminder_id = Column(Integer, ForeignKey("todos.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reminder = relationship("Reminder", back_populates="comments")
    author = relationship("User", foreign_keys=[user_id])
