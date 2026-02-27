from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SQLEnum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base

class TicketStatus(str, enum.Enum):
    PENDING = "pending"
    SOLVED = "solved"
    FORWARDED = "forwarded"

class TicketPriority(str, enum.Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    ticket_number = Column(String, index=True, unique=True, nullable=False)
    phone_number = Column(String, index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    
    # Core Fields
    customer_name = Column(String, nullable=True)
    customer_gender = Column(String, nullable=True)  # Male, Female, Other
    category = Column(String, nullable=True)
    
    # Forwarding Tracking
    forward_target = Column(String, nullable=True)
    forward_reason = Column(String, nullable=True)
    
    status = Column(SQLEnum(TicketStatus), default=TicketStatus.PENDING, nullable=False)
    priority = Column(SQLEnum(TicketPriority), default=TicketPriority.NORMAL, nullable=False)
    
    # assigned to a user (agent/team member)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Dynamic fields for different application types (e.g. ISP, Hospital, etc)
    app_type_data = Column(JSON, nullable=True)
    
    # For threaded issues
    parent_ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    # Relationships
    parent_ticket = relationship("Ticket", remote_side=[id], backref="child_tickets")
    assignee = relationship("User", backref="assigned_tickets")
