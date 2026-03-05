from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, Enum, JSON
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
    email = Column(String, unique=True)
    phone = Column(String)
    company = Column(String)
    position = Column(String)
    
    # Lead management
    status = Column(Enum(LeadStatus), default=LeadStatus.NEW)
    source = Column(Enum(LeadSource), default=LeadSource.OTHER)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Lead scoring
    score = Column(Integer, default=0)
    
    # Lead value
    estimated_value = Column(Float)
    
    # Relationship to conversation (optional source)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)

    # Tags
    tags = Column(JSON, default=[])

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


class Deal(Base):
    __tablename__ = "deals"

    id = Column(Integer, primary_key=True)
    
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    
    # Deal tracking
    stage = Column(Enum(DealStage), default=DealStage.PROSPECT)
    amount = Column(Float)
    probability = Column(Integer, default=50)  # 0-100%
    
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
    status = Column(Enum(TaskStatus), default=TaskStatus.OPEN)
    
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
    type = Column(Enum(ActivityType), nullable=False)
    
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
