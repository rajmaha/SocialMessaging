from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import uuid
from typing import List, Optional
from datetime import datetime

from app.database import get_db
from app.dependencies import get_current_user, get_admin_user
from app.models.user import User
from app.models.ticket import Ticket, TicketStatus, TicketPriority
from app.schemas.ticket import TicketCreate, TicketUpdate, TicketResponse

router = APIRouter(
    prefix="/api/tickets",
    tags=["tickets"],
    responses={404: {"description": "Not found"}},
)

@router.post("", response_model=TicketResponse)
def create_ticket(
    ticket_in: TicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new ticket."""
    # Generate ticket number (TCK-YYYYMMDD-XXXX)
    date_str = datetime.utcnow().strftime("%Y%m%d")
    short_uuid = str(uuid.uuid4()).split("-")[0].upper()
    ticket_number = f"TCK-{date_str}-{short_uuid}"

    new_ticket = Ticket(
        ticket_number=ticket_number,
        phone_number=ticket_in.phone_number,
        customer_name=ticket_in.customer_name,
        customer_gender=ticket_in.customer_gender,
        category=ticket_in.category,
        forward_target=ticket_in.forward_target,
        forward_reason=ticket_in.forward_reason,
        status=ticket_in.status,
        priority=ticket_in.priority,
        assigned_to=ticket_in.assigned_to or current_user.id,
        app_type_data=ticket_in.app_type_data,
        parent_ticket_id=ticket_in.parent_ticket_id
    )
    db.add(new_ticket)
    db.commit()
    db.refresh(new_ticket)
    return new_ticket

@router.get("/history/{phone_number}", response_model=List[TicketResponse])
def get_ticket_history(
    phone_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all tickets associated with a specific phone number, ordered by most recent first."""
    tickets = db.query(Ticket).filter(
        Ticket.phone_number == phone_number
    ).order_by(Ticket.created_at.desc()).all()
    return tickets

@router.put("/{ticket_id}", response_model=TicketResponse)
def update_ticket(
    ticket_id: int,
    ticket_update: TicketUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an existing ticket's details."""
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    update_data = ticket_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(ticket, key, value)
        
    db.commit()
    db.refresh(ticket)
    return ticket

@router.get("/my-tickets", response_model=List[TicketResponse])
def get_my_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve open or forwarded tickets assigned to the current user."""
    return db.query(Ticket).filter(
        Ticket.assigned_to == current_user.id,
        Ticket.status.in_([TicketStatus.PENDING, TicketStatus.FORWARDED])
    ).order_by(Ticket.created_at.desc()).all()

@router.get("/all", response_model=List[TicketResponse])
def get_all_tickets_admin(
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    """Retrieve all tickets in the system for admin viewing."""
    return db.query(Ticket).order_by(Ticket.created_at.desc()).all()

@router.get("/find", response_model=TicketResponse)
def find_ticket_by_number(
    number: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Find a ticket by its ticket_number string."""
    ticket = db.query(Ticket).filter(Ticket.ticket_number == number).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket

@router.get("", response_model=List[TicketResponse])
def list_tickets(
    skip: int = 0,
    limit: int = 100,
    status: Optional[TicketStatus] = None,
    priority: Optional[TicketPriority] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all tickets with optional filtering."""
    query = db.query(Ticket)
    
    if status:
        query = query.filter(Ticket.status == status)
    if priority:
        query = query.filter(Ticket.priority == priority)
        
    return query.order_by(Ticket.created_at.desc()).offset(skip).limit(limit).all()

