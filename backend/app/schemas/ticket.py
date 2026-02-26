from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Any, Dict, List
from datetime import datetime
from app.models.ticket import TicketStatus, TicketPriority

class TicketBase(BaseModel):
    phone_number: str
    customer_name: Optional[str] = None
    customer_gender: Optional[str] = None
    category: Optional[str] = None
    status: TicketStatus = TicketStatus.PENDING
    priority: TicketPriority = TicketPriority.NORMAL
    assigned_to: Optional[int] = None
    forward_target: Optional[str] = None
    forward_reason: Optional[str] = None
    app_type_data: Optional[Dict[str, Any]] = None
    parent_ticket_id: Optional[int] = None

class TicketCreate(TicketBase):
    pass

class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    customer_name: Optional[str] = None
    customer_gender: Optional[str] = None
    category: Optional[str] = None
    assigned_to: Optional[int] = None
    forward_target: Optional[str] = None
    forward_reason: Optional[str] = None
    app_type_data: Optional[Dict[str, Any]] = None
    parent_ticket_id: Optional[int] = None

class TicketResponse(TicketBase):
    id: int
    ticket_number: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
