from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, Enum, JSON, Index
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime
import enum


class LeadStatus(str, enum.Enum):
    NEW = "new"
    CONTACTED = "contacted"
    QUALIFIED = "qualified"
    LOST = "lost"
    CONVERTED = "converted"


class LeadSource(str, enum.Enum):
    CONVERSATION = "conversation"
    EMAIL = "email"
    WEBSITE = "website"
    REFERRAL = "referral"
    OTHER = "other"
    SEARCH_ENGINE = "search_engine"
    FACEBOOK_POST = "facebook_post"
    FACEBOOK_BOOST = "facebook_boost"
    LINKEDIN = "linkedin"
    X_POST = "x_post"
    EMAIL_MARKETING = "email_marketing"
    WORD_OF_MOUTH = "word_of_mouth"
    LOCAL_AGENT = "local_agent"
    STAFF_REFERENCE = "staff_reference"
    PHONE_CALL = "phone_call"
    EXISTING_CLIENT = "existing_client"
    CLIENT_REFERENCE = "client_reference"


class DealStage(str, enum.Enum):
    PROSPECT = "prospect"
    QUALIFIED = "qualified"
    PROPOSAL = "proposal"
    NEGOTIATION = "negotiation"
    CLOSE = "close"
    WON = "won"
    LOST = "lost"


class TaskStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ActivityType(str, enum.Enum):
    CALL = "call"
    EMAIL = "email"
    MEETING = "meeting"
    MESSAGE = "message"
    NOTE = "note"
    TASK_CREATED = "task_created"
    DEAL_STAGE_CHANGE = "deal_stage_change"


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True)
    
    # Basic info
    first_name = Column(String, nullable=False)
    last_name = Column(String)
    email = Column(String)
    phone = Column(String)
    company = Column(String)
    position = Column(String)
    address = Column(String)
    inquiry_for = Column(String)
    remarks = Column(Text)

    # Lead management
    status = Column(Enum(LeadStatus, values_callable=lambda x: [e.value for e in x], native_enum=True), default=LeadStatus.NEW)
    source = Column(Enum(LeadSource, values_callable=lambda x: [e.value for e in x], native_enum=True), default=LeadSource.OTHER)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Lead scoring
    score = Column(Integer, default=0)
    qualification = Column(String, default="cold")  # cold / warm / hot
    
    # Lead value
    estimated_value = Column(Float)
    
    # Relationship to conversation (optional source)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)

    # Tags
    tags = Column(JSON, default=[])

    # Email validation
    email_valid = Column(Boolean, nullable=True)  # NULL=unchecked, True=passed, False=failed

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    deals = relationship("Deal", back_populates="lead", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="lead", cascade="all, delete-orphan")
    activities = relationship("Activity", back_populates="lead", cascade="all, delete-orphan")
    assigned_user = relationship("User", foreign_keys=[assigned_to])
    organization = relationship("Organization", back_populates="leads", foreign_keys="[Lead.organization_id]")
    notes = relationship("LeadNote", back_populates="lead", cascade="all, delete-orphan")

    @property
    def organization_name(self):
        return self.organization.organization_name if self.organization else None


class Deal(Base):
    __tablename__ = "deals"

    id = Column(Integer, primary_key=True)
    
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    
    # Deal tracking
    stage = Column(Enum(DealStage, values_callable=lambda x: [e.value for e in x], native_enum=True), default=DealStage.PROSPECT)
    amount = Column(Float)
    probability = Column(Integer, default=50)  # 0-100%
    currency = Column(String(3), default="USD")
    
    # Timeline
    expected_close_date = Column(DateTime)
    closed_at = Column(DateTime, nullable=True)
    
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    lead = relationship("Lead", back_populates="deals")
    assigned_user = relationship("User", foreign_keys=[assigned_to])


class Task(Base):
    __tablename__ = "crm_tasks"

    id = Column(Integer, primary_key=True)
    
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    deal_id = Column(Integer, ForeignKey("deals.id"), nullable=True)
    
    title = Column(String, nullable=False)
    description = Column(Text)
    status = Column(Enum(TaskStatus, values_callable=lambda x: [e.value for e in x], native_enum=True), default=TaskStatus.OPEN)
    
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    due_date = Column(DateTime)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    lead = relationship("Lead", back_populates="tasks")
    assigned_user = relationship("User", foreign_keys=[assigned_to])


class Activity(Base):
    __tablename__ = "crm_activities"

    id = Column(Integer, primary_key=True)
    
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    type = Column(Enum(ActivityType, values_callable=lambda x: [e.value for e in x], native_enum=True), nullable=False)
    
    title = Column(String, nullable=False)
    description = Column(Text)
    
    # Link to conversation message if activity was triggered by one
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=True)
    
    # Who performed the activity
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    activity_date = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    lead = relationship("Lead", back_populates="activities")
    user = relationship("User", foreign_keys=[created_by])


class LeadNote(Base):
    __tablename__ = "crm_lead_notes"

    id = Column(Integer, primary_key=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    content = Column(Text, nullable=False)
    is_pinned = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    lead = relationship("Lead", back_populates="notes")
    user = relationship("User", foreign_keys=[created_by])


class CRMAuditLog(Base):
    __tablename__ = "crm_audit_log"

    id = Column(Integer, primary_key=True)
    entity_type = Column(String, nullable=False)  # lead, deal, task
    entity_id = Column(Integer, nullable=False)
    field_name = Column(String, nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    changed_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[changed_by])

    __table_args__ = (
        Index("idx_crm_audit_entity", "entity_type", "entity_id"),
    )


class CRMWorkflowRule(Base):
    __tablename__ = "crm_workflow_rules"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    trigger_type = Column(String, nullable=False)  # deal_stage_change, lead_status_change, task_overdue
    conditions = Column(JSON, default={})
    action_type = Column(String, nullable=False)  # create_task, change_status, send_notification
    action_config = Column(JSON, default={})
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
