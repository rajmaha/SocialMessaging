from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON, Enum
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime
import enum


class TriggerType(str, enum.Enum):
    LEAD_CREATED = "lead_created"
    NO_ACTIVITY = "no_activity"
    SCORE_BELOW = "score_below"
    DEAL_STAGE_CHANGE = "deal_stage_change"
    LEAD_STATUS_CHANGE = "lead_status_change"


class EnrollmentStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    trigger_type = Column(String, nullable=False)
    conditions = Column(JSON, default=dict)
    actions = Column(JSON, default=list)
    is_active = Column(Boolean, default=True)
    last_run_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailSequence(Base):
    __tablename__ = "email_sequences"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    steps = relationship("EmailSequenceStep", back_populates="sequence", cascade="all, delete-orphan", order_by="EmailSequenceStep.step_order")
    enrollments = relationship("EmailSequenceEnrollment", back_populates="sequence", cascade="all, delete-orphan")


class EmailSequenceStep(Base):
    __tablename__ = "email_sequence_steps"

    id = Column(Integer, primary_key=True)
    sequence_id = Column(Integer, ForeignKey("email_sequences.id"), nullable=False)
    step_order = Column(Integer, nullable=False, default=1)
    delay_days = Column(Integer, nullable=False, default=1)
    subject = Column(String, nullable=False)
    body_html = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    sequence = relationship("EmailSequence", back_populates="steps")


class EmailSequenceEnrollment(Base):
    __tablename__ = "email_sequence_enrollments"

    id = Column(Integer, primary_key=True)
    sequence_id = Column(Integer, ForeignKey("email_sequences.id"), nullable=False)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    status = Column(String, default="active")
    current_step = Column(Integer, default=0)
    enrolled_at = Column(DateTime, default=datetime.utcnow)
    next_send_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    sequence = relationship("EmailSequence", back_populates="enrollments")
    lead = relationship("Lead")
