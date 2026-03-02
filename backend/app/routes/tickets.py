from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
import uuid

from app.database import get_db
from app.dependencies import get_current_user, require_module, require_admin_feature
from app.models.user import User
from app.models.ticket import Ticket, TicketStatus, TicketPriority
from app.models.call_records import CallRecording
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
        customer_type=ticket_in.customer_type,
        contact_person=ticket_in.contact_person,
        customer_email=ticket_in.customer_email,
        category=ticket_in.category,
        forward_target=ticket_in.forward_target,
        forward_reason=ticket_in.forward_reason,
        status=ticket_in.status,
        priority=ticket_in.priority,
        assigned_to=ticket_in.assigned_to or current_user.id,
        app_type_data=ticket_in.app_type_data,
        parent_ticket_id=ticket_in.parent_ticket_id,
        organization_id=ticket_in.organization_id
    )
    db.add(new_ticket)
    db.commit()
    db.refresh(new_ticket)

    # Auto-insert org/individual if caller was not already in the system
    if ticket_in.customer_name and ticket_in.customer_type:
        from app.models.organization import Organization, OrganizationContact
        from app.models.individual import Individual
        from sqlalchemy import cast, String

        phone_search = ticket_in.phone_number

        # Check if this phone already exists in any record
        existing_org_contact = db.query(OrganizationContact).filter(
            cast(OrganizationContact.phone_no, String).ilike(f"%{phone_search}%")
        ).first()
        existing_org = db.query(Organization).filter(
            cast(Organization.contact_numbers, String).ilike(f"%{phone_search}%")
        ).first()
        existing_individual = db.query(Individual).filter(
            cast(Individual.phone_numbers, String).ilike(f"%{phone_search}%")
        ).first()

        already_exists = existing_org_contact or existing_org or existing_individual

        if not already_exists:
            if ticket_in.customer_type == "organization":
                new_org = Organization(
                    organization_name=ticket_in.customer_name,
                    contact_numbers=[ticket_in.phone_number],
                    email=ticket_in.customer_email,
                    is_active=1,
                )
                db.add(new_org)
                db.commit()
                db.refresh(new_org)
                # Link ticket to the new org
                new_ticket.organization_id = new_org.id

                if ticket_in.contact_person:
                    new_contact = OrganizationContact(
                        organization_id=new_org.id,
                        full_name=ticket_in.contact_person,
                        gender=ticket_in.customer_gender,
                        email=ticket_in.customer_email,
                        phone_no=[ticket_in.phone_number],
                    )
                    db.add(new_contact)

                db.commit()
                db.refresh(new_ticket)

            elif ticket_in.customer_type == "individual":
                new_individual = Individual(
                    full_name=ticket_in.customer_name,
                    gender=ticket_in.customer_gender or "Other",
                    phone_numbers=[ticket_in.phone_number],
                    email=ticket_in.customer_email,
                    is_active=1,
                )
                db.add(new_individual)
                db.commit()

    # Auto-log a call record for origin tickets (not follow-ups) so the call
    # appears in Call Records even when FreePBX CDR sync is not in use.
    # Dedup: skip if an existing record for this agent + phone exists within 30 min
    # (prevents duplicates when a real FreePBX CDR is later synced for the same call).
    if not ticket_in.parent_ticket_id:
        recent_cutoff = datetime.utcnow() - timedelta(minutes=30)
        existing_call = db.query(CallRecording).filter(
            CallRecording.phone_number == ticket_in.phone_number,
            CallRecording.agent_id == current_user.id,
            CallRecording.created_at >= recent_cutoff
        ).first()
        if not existing_call:
            call_log = CallRecording(
                agent_id=current_user.id,
                agent_name=getattr(current_user, 'display_name', None) or getattr(current_user, 'full_name', None) or current_user.email,
                phone_number=ticket_in.phone_number,
                organization_id=ticket_in.organization_id,
                direction="inbound",
                disposition="ANSWERED",
                duration_seconds=0,
                ticket_number=new_ticket.ticket_number,
            )
            db.add(call_log)
            db.commit()

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

@router.get("/context/{phone_number}")
def get_ticket_context(
    phone_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve caller context by phone number for auto-filling the ticket form."""
    from app.models.organization import Organization, OrganizationContact
    from app.models.individual import Individual
    from app.models.email import Contact
    from sqlalchemy import cast, String

    clean_phone = "".join(filter(str.isdigit, phone_number))
    search_terms = [phone_number]
    if clean_phone and clean_phone != phone_number:
        search_terms.append(clean_phone)

    result = {
        "found": False,
        "customer_type": None,
        "customer_name": None,
        "caller_name": None,
        "organization_name": None,
        "organization_id": None,
        "contact_person": None,
        "gender": None,
        "email": None,
    }

    for term in search_terms:
        if result["found"]:
            break

        # 1. Search Organization Contacts
        org_contact = db.query(OrganizationContact).filter(
            cast(OrganizationContact.phone_no, String).ilike(f"%{term}%")
        ).first()
        if org_contact:
            result["found"] = True
            result["customer_type"] = "organization"
            result["contact_person"] = org_contact.full_name
            result["caller_name"] = org_contact.full_name
            result["gender"] = org_contact.gender
            result["email"] = org_contact.email
            if org_contact.organization:
                result["customer_name"] = org_contact.organization.organization_name
                result["organization_name"] = org_contact.organization.organization_name
                result["organization_id"] = org_contact.organization.id
            break

        # 2. Search Organizations directly
        org = db.query(Organization).filter(
            cast(Organization.contact_numbers, String).ilike(f"%{term}%")
        ).first()
        if org:
            result["found"] = True
            result["customer_type"] = "organization"
            result["customer_name"] = org.organization_name
            result["organization_name"] = org.organization_name
            result["organization_id"] = org.id
            result["email"] = org.email
            result["caller_name"] = "Valued Customer"
            break

        # 3. Search Individuals
        individual = db.query(Individual).filter(
            cast(Individual.phone_numbers, String).ilike(f"%{term}%")
        ).first()
        if individual:
            result["found"] = True
            result["customer_type"] = "individual"
            result["customer_name"] = individual.full_name
            result["caller_name"] = individual.full_name
            result["gender"] = individual.gender
            result["email"] = individual.email
            break

        # 4. Fallback: email contacts
        contact = db.query(Contact).filter(Contact.phone.ilike(f"%{term}%")).first()
        if contact:
            result["found"] = True
            result["caller_name"] = contact.name
            result["customer_name"] = contact.name
            break

    return result

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

from pydantic import BaseModel

class TicketNoteCreate(BaseModel):
    note: Optional[str] = None
    action_taken: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None

@router.post("/{ticket_number}/notes", response_model=TicketResponse)
def add_ticket_note(
    ticket_number: str,
    note_data: TicketNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Add a follow-up note to a ticket and optionally update its status/priority.
    This creates a new child ticket linked to the original.
    """
    parent_ticket = db.query(Ticket).filter(Ticket.ticket_number == ticket_number).first()
    if not parent_ticket:
        raise HTTPException(status_code=404, detail="Parent ticket not found")

    # 1. Update Parent Ticket if status/priority changed
    if note_data.status and note_data.status != parent_ticket.status:
        parent_ticket.status = note_data.status
    if note_data.priority and note_data.priority != parent_ticket.priority:
        parent_ticket.priority = note_data.priority

    db.commit()
    db.refresh(parent_ticket)

    # 2. If a note or action was provided, create a child ticket to log it in history
    if note_data.note or note_data.action_taken:
        import datetime as _dt
        timestamp_str = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        child_number = f"FLW-{timestamp_str}"

        app_data = {}
        if note_data.note:
            app_data["follow_up_note"] = note_data.note
        if note_data.action_taken:
            app_data["action_taken"] = note_data.action_taken

        child = Ticket(
            ticket_number=child_number,
            phone_number=parent_ticket.phone_number,
            organization_id=parent_ticket.organization_id,
            customer_name=parent_ticket.customer_name,
            customer_gender=parent_ticket.customer_gender,
            category=parent_ticket.category,
            status=parent_ticket.status,
            priority=parent_ticket.priority,
            assigned_to=current_user.id,
            parent_ticket_id=parent_ticket.id,
            app_type_data=app_data
        )
        db.add(child)
        db.commit()

        # Auto-log an outbound call record for this follow-up interaction.
        # Dedup: skip if agent already has a record for this phone within 30 min.
        recent_cutoff = datetime.utcnow() - timedelta(minutes=30)
        existing_fu_call = db.query(CallRecording).filter(
            CallRecording.phone_number == parent_ticket.phone_number,
            CallRecording.agent_id == current_user.id,
            CallRecording.created_at >= recent_cutoff
        ).first()
        if not existing_fu_call:
            fu_call_log = CallRecording(
                agent_id=current_user.id,
                agent_name=getattr(current_user, 'display_name', None) or getattr(current_user, 'full_name', None) or current_user.email,
                phone_number=parent_ticket.phone_number,
                organization_id=parent_ticket.organization_id,
                direction="outbound",
                disposition="ANSWERED",
                duration_seconds=0,
                ticket_number=child_number,   # FLW-... ticket number
            )
            db.add(fu_call_log)
            db.commit()

    return parent_ticket

@router.get("/{ticket_id}/thread", response_model=List[TicketResponse])
def get_ticket_thread(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get the full thread for a ticket: walks up to the root origin ticket,
    then returns the root + all descendants (follow-ups at any depth).
    """
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Walk up parent chain to find the root
    root = ticket
    while root.parent_ticket_id:
        parent = db.query(Ticket).filter(Ticket.id == root.parent_ticket_id).first()
        if not parent:
            break
        root = parent

    # Collect root + all descendants via BFS
    thread = [root]
    queue = [root.id]
    visited = {root.id}
    while queue:
        parent_id = queue.pop(0)
        children = db.query(Ticket).filter(Ticket.parent_ticket_id == parent_id).order_by(Ticket.created_at.asc()).all()
        for child in children:
            if child.id not in visited:
                visited.add(child.id)
                thread.append(child)
                queue.append(child.id)

    return thread

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
    admin_user: User = Depends(require_admin_feature("feature_manage_tickets"))
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
    organization_id: Optional[int] = Query(None, description="Filter by organization ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all tickets with optional filtering."""
    query = db.query(Ticket)
    
    if status:
        query = query.filter(Ticket.status == status)
    if priority:
        query = query.filter(Ticket.priority == priority)
    if organization_id:
        query = query.filter(Ticket.organization_id == organization_id)
        
    return query.order_by(Ticket.created_at.desc()).offset(skip).limit(limit).all()

