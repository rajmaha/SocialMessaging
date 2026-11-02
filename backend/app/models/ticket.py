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
    customer_type = Column(String, nullable=True)  # individual / organization
    contact_person = Column(String, nullable=True)
    customer_email = Column(String, nullable=True)
    category = Column(String, nullable=True)
    
    # Forwarding Tracking
    forward_target = Column(String, nullable=True)
    forward_reason = Column(String, nullable=True)
    
    status = Column(SQLEnum(TicketStatus, values_callable=lambda x: [e.value for e in x]), default=TicketStatus.PENDING, nullable=False)
    priority = Column(SQLEnum(TicketPriority, values_callable=lambda x: [e.value for e in x]), default=TicketPriority.NORMAL, nullable=False)
    
    # assigned to a user (agent/team member)
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Dynamic fields for different application types (e.g. ISP, Hospital, etc)
    app_type_data = Column(JSON, nullable=True)
    
    # For threaded issues
    parent_ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)

    # Source tracking and cross-system links
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    email_id = Column(Integer, ForeignKey("emails.id", ondelete="SET NULL"), nullable=True)
    source = Column(String, nullable=False, server_default="call")

    # Support desk (app/support_schema.py adds these on existing databases)
    support_site_id = Column(Integer, ForeignKey("widget_domains.id", ondelete="SET NULL"), nullable=True, index=True)
    support_user_id = Column(Integer, ForeignKey("support_users.id", ondelete="SET NULL"), nullable=True, index=True)
    support_subject = Column(String, nullable=True)
    support_screen = Column(String, nullable=True)
    support_url = Column(String, nullable=True)
    solved_at = Column(DateTime(timezone=True), nullable=True)
    last_author = Column(String, nullable=True)   # customer | agent: who wrote last in the thread

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    # Relationships
    parent_ticket = relationship("Ticket", remote_side=[id], backref="child_tickets")
    assignee = relationship("User", backref="assigned_tickets")
    support_site = relationship("WidgetDomain", foreign_keys=[support_site_id])

    @property
    def assignee_name(self) -> str | None:
        return self.assignee.full_name if self.assignee else None

    @property
    def parent_ticket_number(self) -> str | None:
        return self.parent_ticket.ticket_number if self.parent_ticket else None

    @property
    def support_site_name(self) -> str | None:
        return self.support_site.display_name if self.support_site else None


# Ticket.support_user_id points at support_users: register that table whenever
# Ticket is imported, so metadata (create_all, flushes) can always resolve it.
from app.models import support as _support_models  # noqa: E402,F401
