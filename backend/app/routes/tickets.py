from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
import uuid

from app.database import get_db
from app.dependencies import get_current_user, require_module, require_admin_feature, require_page
from app.models.user import User
from app.models.ticket import Ticket, TicketStatus, TicketPriority
from app.models.call_records import CallRecording
from app.schemas.ticket import TicketCreate, TicketUpdate, TicketResponse

router = APIRouter(
    prefix="/api/tickets",
    tags=["tickets"],
    responses={404: {"description": "Not found"}},
    dependencies=[Depends(require_page("tickets"))],
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
        organization_id=ticket_in.organization_id,
        conversation_id=ticket_in.conversation_id,   # NEW
        email_id=ticket_in.email_id,                 # NEW
        source=ticket_in.source,                     # NEW
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
    if not ticket_in.parent_ticket_id and ticket_in.source == "call":
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
    current_user: User = Depends(get_current_user),
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

@router.get("/context-by-email")
def get_ticket_context_by_email(
    email: str = Query(..., description="Full email address to look up org by domain"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve org context by email address — matches on email domain."""
    from app.models.organization import Organization, OrganizationContact

    result = {
        "found": False,
        "customer_type": None,
        "customer_name": None,
        "organization_name": None,
        "organization_id": None,
        "contact_person": None,
        "email": email,
    }

    # 1. Try exact match on org contact email
    org_contact = db.query(OrganizationContact).filter(
        OrganizationContact.email.ilike(email)
    ).first()
    if org_contact and org_contact.organization:
        result.update({
            "found": True,
            "customer_type": "organization",
            "contact_person": org_contact.full_name,
            "customer_name": org_contact.organization.organization_name,
            "organization_name": org_contact.organization.organization_name,
            "organization_id": org_contact.organization.id,
        })
        return result

    # 2. Try exact match on org primary email
    org = db.query(Organization).filter(
        Organization.email.ilike(email)
    ).first()
    if org:
        result.update({
            "found": True,
            "customer_type": "organization",
            "customer_name": org.organization_name,
            "organization_name": org.organization_name,
            "organization_id": org.id,
        })
        return result

    # 3. Try domain match on org domain_name field
    if "@" in email:
        domain = email.split("@", 1)[1].lower()
        org = db.query(Organization).filter(
            Organization.domain_name.ilike(f"%{domain}%")
        ).first()
        if org:
            result.update({
                "found": True,
                "customer_type": "organization",
                "customer_name": org.organization_name,
                "organization_name": org.organization_name,
                "organization_id": org.id,
            })
            return result

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
    # A support request's status is changed by support_service.set_status, which
    # adds the line to the customer's thread, emails them and tells their site.
    new_support_status = update_data.pop("status", None) if ticket.support_site_id else None
    for key, value in update_data.items():
        setattr(ticket, key, value)

    db.commit()
    if new_support_status is not None:
        _support_status(db, ticket, new_support_status, current_user)
    db.refresh(ticket)
    return ticket

from pydantic import BaseModel

class TicketNoteCreate(BaseModel):
    note: Optional[str] = None
    action_taken: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    # status "forwarded": the agent it goes to (a user id) and why; the ticket becomes theirs
    forward_to: Optional[int] = None
    forward_reason: Optional[str] = None

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

    # Forwarding hands the ticket to another agent: checked before anything is written
    target = None
    forward_reason = (note_data.forward_reason or "").strip()[:500]
    if note_data.status == TicketStatus.FORWARDED.value:
        if not note_data.forward_to:
            raise HTTPException(status_code=422, detail="Choose the agent to forward this ticket to.")
        if not forward_reason:
            raise HTTPException(status_code=422, detail="Say why it is being forwarded.")
        target = db.query(User).filter(User.id == note_data.forward_to, User.is_active == True).first()  # noqa: E712
        if target is None:
            raise HTTPException(status_code=422, detail="That agent was not found or is not active.")
        if target.id == current_user.id:
            raise HTTPException(status_code=422, detail="Choose another agent: the ticket is already yours.")

    # 1. Update Parent Ticket if status/priority changed
    if note_data.status and parent_ticket.support_site_id:
        _support_status(db, parent_ticket, note_data.status, current_user)
    elif note_data.status and note_data.status != parent_ticket.status:
        parent_ticket.status = note_data.status
    if note_data.priority and note_data.priority != parent_ticket.priority:
        parent_ticket.priority = note_data.priority
    target_name = None
    if target is not None:
        target_name = target.display_name or target.full_name or target.username or target.email
        parent_ticket.assigned_to = target.id
        parent_ticket.forward_target = target_name
        parent_ticket.forward_reason = forward_reason

    db.commit()
    db.refresh(parent_ticket)

    if target is not None:
        # the agent it went to hears at once (a toast and a chime on any workspace page)
        from app.services.events_service import events_service
        by = getattr(current_user, 'display_name', None) or current_user.full_name or current_user.username or current_user.email
        event = events_service.create_event("ticket_forwarded", {
            "ticket_number": parent_ticket.ticket_number,
            "subject": parent_ticket.support_subject or parent_ticket.category,
            "customer": parent_ticket.customer_name,
            "by": by,
            "reason": forward_reason,
        })
        _tid = target.id
        _support.run_later(lambda: _support._broadcast([_tid], event))
        if not note_data.note:
            note_data.note = f"Forwarded to {target_name}: {forward_reason}"

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
    """List tickets with optional filtering. Non-admins see only their own
    (created by them or assigned to them)."""
    query = db.query(Ticket)

    # Scope for non-admin users: only own tickets
    if current_user.role != "admin":
        from sqlalchemy import or_
        # Ticket has no created_by column (referencing it raised on every
        # non-admin call); a new ticket is assigned to whoever creates it.
        query = query.filter(Ticket.assigned_to == current_user.id)

    if status:
        query = query.filter(Ticket.status == status)
    if priority:
        query = query.filter(Ticket.priority == priority)
    if organization_id:
        query = query.filter(Ticket.organization_id == organization_id)

    return query.order_by(Ticket.created_at.desc()).offset(skip).limit(limit).all()



# ─────────────────────────────────────────────────────────────────────────────
# Support desk: tickets raised from a site's widget or app (source support_*).
# Every rule is app/services/support_service.py.
# ─────────────────────────────────────────────────────────────────────────────

from app.models.domain_agent import DomainAgent  # noqa: E402
from app.services import support_service as _support  # noqa: E402
from app.services import support_webhooks as _support_webhooks  # noqa: E402
from app.services.support_service import SupportError as _SupportError, SupportFile as _SupportFile  # noqa: E402


def _support_status(db: Session, ticket: Ticket, status, agent: User) -> None:
    try:
        _support.set_status(db, ticket, status, agent)
    except _SupportError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message)


def _support_ticket(db: Session, ticket_number: str) -> Ticket:
    t = db.query(Ticket).filter(Ticket.ticket_number == ticket_number).first()
    if t is None or not t.support_site_id:
        raise HTTPException(status_code=404, detail="Support request not found")
    return t


def _linked_domain_ids(db: Session, user: User) -> Optional[List[int]]:
    """The widget domains an agent is linked to; None for an admin (every domain)."""
    if user.role == "admin":
        return None
    return [r.widget_domain_id for r in db.query(DomainAgent).filter(DomainAgent.user_id == user.id)]


@router.get("/support-queue", response_model=List[TicketResponse])
def support_queue(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Open support requests nobody has taken, on the sites this agent is linked to (an admin: all)."""
    q = db.query(Ticket).filter(
        Ticket.support_site_id.isnot(None),
        Ticket.assigned_to.is_(None),
        Ticket.status.in_([TicketStatus.PENDING, TicketStatus.FORWARDED]),
    )
    ids = _linked_domain_ids(db, current_user)
    if ids is not None:
        if not ids:
            return []
        q = q.filter(Ticket.support_site_id.in_(ids))
    return q.order_by(Ticket.created_at.asc()).limit(200).all()


@router.get("/support-counts")
def support_counts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """For the header badge: requests waiting to be taken (as the Support queue lists them), and
    the agent's own open requests whose last word is the customer's (waiting for a reply)."""
    from sqlalchemy import false, func
    from app.models.support import SupportMessage
    q = db.query(func.count(Ticket.id)).filter(
        Ticket.support_site_id.isnot(None),
        Ticket.assigned_to.is_(None),
        Ticket.status.in_([TicketStatus.PENDING, TicketStatus.FORWARDED]),
    )
    ids = _linked_domain_ids(db, current_user)
    if ids is not None:
        q = q.filter(Ticket.support_site_id.in_(ids)) if ids else q.filter(false())
    queue = q.scalar() or 0

    last = (db.query(SupportMessage.ticket_id, func.max(SupportMessage.id).label("mid"))
            .filter(SupportMessage.author_type.in_(["customer", "agent"]))
            .group_by(SupportMessage.ticket_id).subquery())
    waiting = (db.query(func.count(Ticket.id))
               .join(last, last.c.ticket_id == Ticket.id)
               .join(SupportMessage, SupportMessage.id == last.c.mid)
               .filter(Ticket.support_site_id.isnot(None),
                       Ticket.assigned_to == current_user.id,
                       Ticket.status != TicketStatus.SOLVED,
                       SupportMessage.author_type == "customer")
               .scalar() or 0)
    return {"queue": int(queue), "waiting": int(waiting), "total": int(queue) + int(waiting)}


@router.post("/{ticket_number}/take", response_model=TicketResponse)
def take_support_ticket(ticket_number: str, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    """Take a request from the shared queue. Two agents pressing at once: one gets it."""
    t = _support_ticket(db, ticket_number)
    taken = (db.query(Ticket)
             .filter(Ticket.id == t.id, Ticket.assigned_to.is_(None))
             .update({Ticket.assigned_to: current_user.id}, synchronize_session=False))
    db.commit()
    db.refresh(t)
    if not taken and t.assigned_to != current_user.id:
        holder = t.assignee_name or "another agent"
        raise HTTPException(status_code=409, detail=f"{holder} has already taken this request.")
    return t


@router.get("/{ticket_number}/conversation")
def support_conversation(ticket_number: str, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    """The customer's thread, the site, the customer, and whether the site was told of the last change."""
    from app.routes.support_public import file_link
    t = _support_ticket(db, ticket_number)
    view = _support.agent_conversation(db, t)
    for m in view["messages"]:
        for a in m["attachments"]:
            a["url"] = file_link(m["id"], a["index"])
    last = _support_webhooks.last_delivery(db, t)
    view["delivery"] = ({"status": last.status, "event": last.event, "error": last.last_error,
                         "tries": last.tries, "sent_at": last.sent_at.isoformat() if last.sent_at else None}
                        if last else None)
    view["assigned_to"] = t.assigned_to
    view["assignee_name"] = t.assignee_name
    return view


@router.post("/{ticket_number}/conversation")
async def support_reply(
    ticket_number: str,
    body: str = Form(""),
    request_id: str = Form(""),
    files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """An agent's reply to the customer: they are emailed and their site is told."""
    t = _support_ticket(db, ticket_number)
    uploads = []
    for up in files or []:
        if up is None or not up.filename:
            continue
        if len(uploads) >= _support.MAX_FILES:
            raise HTTPException(status_code=422, detail=f"Attach at most {_support.MAX_FILES} files.")
        uploads.append(_SupportFile(up.filename, await up.read(_support.MAX_FILE_BYTES + 1), up.content_type or ""))
    try:
        _support.reply(db, t, body, uploads, agent=current_user, request_id=request_id or None)
    except _SupportError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message)
    return support_conversation(ticket_number, db, current_user)


@router.post("/{ticket_number}/webhook-resend")
def support_webhook_resend(ticket_number: str, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    """Send the latest failed notice to the customer's site again."""
    t = _support_ticket(db, ticket_number)
    row = _support_webhooks.resend(db, t)
    if row is None:
        raise HTTPException(status_code=409, detail="There is no failed notice to send again.")
    return {"status": "queued", "event": row.event}


# --- live help: Call phone, Ask to talk, Ask to see screen (app/services/support_live.py) ---

from fastapi import Body, Query, WebSocket  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.dependencies import verify_token  # noqa: E402
from app.models.widget_domain import WidgetDomain as _WidgetDomain  # noqa: E402
from app.services import support_live as _live  # noqa: E402
from app.services import support_live_relay as _relay  # noqa: E402


def _live_error(err: _SupportError):
    raise HTTPException(status_code=err.status_code, detail=err.message)


@router.get("/{ticket_number}/live")
def support_live_state(ticket_number: str, db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    """The ticket's live help: the open session (or the last one), and whether the site allows it."""
    t = _support_ticket(db, ticket_number)
    domain = db.get(_WidgetDomain, t.support_site_id)
    row = _live.current(db, t) or _live.latest(db, t)
    return {
        "enabled": bool(domain and domain.live_help_enabled),
        "holder": t.assigned_to == current_user.id,
        "phone": t.phone_number if t.phone_number and t.phone_number != "-" else None,
        "live": _live.agent_view(row),
        "ice_servers": _live.ice_servers(db),
    }


@router.post("/{ticket_number}/live")
def support_live_ask(ticket_number: str, body: dict = Body(default_factory=dict), db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    """Ask the customer to talk ({"kind": "talk"}) or to show their screen ({"kind": "screen"})."""
    t = _support_ticket(db, ticket_number)
    try:
        row = _live.ask(db, t, current_user, (body or {}).get("kind") if isinstance(body, dict) else None)
    except _SupportError as err:
        _live_error(err)
    return {"live": _live.agent_view(row)}


@router.post("/{ticket_number}/live/{live_id}/cancel")
async def support_live_cancel(ticket_number: str, live_id: int, db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    """Call a request off, or end a session under way."""
    t = _support_ticket(db, ticket_number)
    try:
        row = _live.for_agent(db, t, live_id)
    except _SupportError as err:
        _live_error(err)
    if row.requested_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the agent who asked can end this live help.")
    row = _live.cancel(db, row, current_user)
    await _relay.hub.send(row.id, "customer", {"type": "bye"})
    return {"live": _live.agent_view(row)}


@router.post("/{ticket_number}/call-link")
def support_call_link(ticket_number: str, body: dict = Body(default_factory=dict), db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    """Call phone: the next call this agent places to that number takes the ticket number."""
    t = _support_ticket(db, ticket_number)
    phone = (body or {}).get("phone") if isinstance(body, dict) else None
    try:
        _live.call_link(db, t, current_user, phone or t.phone_number)
    except _SupportError as err:
        _live_error(err)
    return {"status": "ok"}


# Its own router: the tickets router's require_page() reads a Bearer header, which a
# browser's WebSocket cannot send. The token rides in the query instead.
live_socket_router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@live_socket_router.websocket("/live/ws/{live_id}")
async def support_live_socket(websocket: WebSocket, live_id: int, token: str = Query("")):
    """The agent's signalling socket: open from the moment they ask, so they hear the answer at once."""
    await websocket.accept()
    agent = await verify_token(token)
    db = SessionLocal()
    try:
        row = db.get(_live.SupportLiveSession, live_id)
        if row is None or not _live.agent_may_join(db, row, agent):
            await websocket.close(code=4403, reason="Not your live help session.")
            return
        hello = {"role": "agent", "live": _live.agent_view(row), "ice_servers": _live.ice_servers(db)}
    finally:
        db.close()
    await _relay.run(websocket, live_id, "agent", hello)
