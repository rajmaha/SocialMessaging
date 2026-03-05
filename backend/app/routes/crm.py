from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_, func
from datetime import datetime

from app.database import get_db
from app.models.crm import Lead, Deal, Task, Activity, LeadNote, LeadStatus, DealStage, TaskStatus, ActivityType
from app.models.user import User
from app.models.conversation import Conversation
from app.schemas.crm import (
    LeadCreate, LeadUpdate, LeadResponse, LeadDetailResponse,
    DealCreate, DealUpdate, DealResponse, DealDetailResponse,
    TaskCreate, TaskUpdate, TaskResponse,
    ActivityCreate, ActivityResponse,
    NoteCreate, NoteUpdate, NoteResponse,
)
from app.dependencies import get_current_user, require_admin_feature, require_page
from app.services.crm_scoring import apply_score
from app.services.events_service import events_service, EventTypes
import asyncio

router = APIRouter(prefix="/crm", tags=["crm"], dependencies=[Depends(require_page("crm"))])

require_crm = require_admin_feature("feature_manage_crm")


# ========== LEAD ENDPOINTS ==========

@router.get("/leads/auto-match")
def auto_match_lead(
    phone: str = Query(None),
    email: str = Query(None),
    name: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find leads matching by phone, email, or name (exact match)."""
    if phone:
        leads = db.query(Lead).filter(Lead.phone == phone).all()
        if leads:
            return leads
    if email:
        leads = db.query(Lead).filter(Lead.email == email).all()
        if leads:
            return leads
    if name:
        leads = db.query(Lead).filter(
            or_(
                func.concat(Lead.first_name, ' ', Lead.last_name).ilike(f"%{name}%"),
                Lead.first_name.ilike(f"%{name}%"),
            )
        ).all()
        if leads:
            return leads
    return []


@router.get("/tags")
def get_all_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all unique tags across leads."""
    leads = db.query(Lead.tags).filter(Lead.tags.isnot(None)).all()
    all_tags = set()
    for (tags,) in leads:
        if isinstance(tags, list):
            all_tags.update(tags)
    return sorted(all_tags)


@router.post("/leads", response_model=LeadResponse)
def create_lead(
    lead: LeadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new lead."""
    db_lead = Lead(**lead.model_dump())
    db.add(db_lead)
    db.commit()
    db.refresh(db_lead)
    
    # Create initial activity
    activity = Activity(
        lead_id=db_lead.id,
        type="note",
        title="Lead created",
        description=f"Lead created by {current_user.email}",
        created_by=current_user.id,
    )
    db.add(activity)
    db.commit()
    
    return db_lead


@router.get("/leads", response_model=list[LeadResponse])
def list_leads(
    status: str = Query(None),
    assigned_to: int = Query(None),
    search: str = Query(None),
    tag: str = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List leads with optional filtering."""
    query = db.query(Lead)
    if status:
        query = query.filter(Lead.status == status)
    if assigned_to:
        query = query.filter(Lead.assigned_to == assigned_to)
    if search:
        query = query.filter(
            Lead.first_name.ilike(f"%{search}%") |
            Lead.last_name.ilike(f"%{search}%") |
            Lead.email.ilike(f"%{search}%") |
            Lead.company.ilike(f"%{search}%")
        )
    if tag:
        query = query.filter(Lead.tags.contains([tag]))

    return query.order_by(desc(Lead.created_at)).offset(skip).limit(limit).all()


@router.post("/leads/bulk")
def bulk_lead_action(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Perform bulk actions on multiple leads."""
    lead_ids = payload.get("lead_ids", [])
    action = payload.get("action")
    value = payload.get("value")

    if not lead_ids or not action:
        raise HTTPException(status_code=400, detail="lead_ids and action required")

    results = {"success": [], "failed": []}
    leads = db.query(Lead).filter(Lead.id.in_(lead_ids)).all()

    for lead in leads:
        try:
            if action == "assign":
                lead.assigned_to = int(value) if value else None
            elif action == "status":
                lead.status = LeadStatus(value)
            elif action == "add_tag":
                current_tags = lead.tags or []
                if value not in current_tags:
                    lead.tags = current_tags + [value]
            elif action == "remove_tag":
                current_tags = lead.tags or []
                lead.tags = [t for t in current_tags if t != value]
            else:
                results["failed"].append({"id": lead.id, "error": f"Unknown action: {action}"})
                continue
            results["success"].append(lead.id)
        except Exception as e:
            results["failed"].append({"id": lead.id, "error": str(e)})

    db.commit()
    return results


@router.post("/leads/merge")
def merge_leads(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merge two leads: transfer related records from secondary into primary, then delete secondary."""
    primary_id = payload.get("primary_lead_id")
    secondary_id = payload.get("secondary_lead_id")

    if not primary_id or not secondary_id or primary_id == secondary_id:
        raise HTTPException(status_code=400, detail="Two different lead IDs required")

    primary = db.query(Lead).filter(Lead.id == primary_id).first()
    secondary = db.query(Lead).filter(Lead.id == secondary_id).first()

    if not primary or not secondary:
        raise HTTPException(status_code=404, detail="One or both leads not found")

    # Fill in blank fields on primary from secondary
    for field in ["last_name", "email", "phone", "company", "position", "estimated_value", "organization_id"]:
        if not getattr(primary, field) and getattr(secondary, field):
            setattr(primary, field, getattr(secondary, field))

    # Merge tags
    primary_tags = primary.tags or []
    secondary_tags = secondary.tags or []
    primary.tags = list(set(primary_tags + secondary_tags))

    # Move related records
    db.query(Deal).filter(Deal.lead_id == secondary_id).update({"lead_id": primary_id})
    db.query(Task).filter(Task.lead_id == secondary_id).update({"lead_id": primary_id})
    db.query(Activity).filter(Activity.lead_id == secondary_id).update({"lead_id": primary_id})
    db.query(LeadNote).filter(LeadNote.lead_id == secondary_id).update({"lead_id": primary_id})

    # Log merge activity
    merge_activity = Activity(
        lead_id=primary_id,
        type=ActivityType.NOTE,
        title=f"Merged with lead #{secondary_id} ({secondary.first_name} {secondary.last_name or ''})",
        description=f"All deals, tasks, activities, and notes transferred from lead #{secondary_id}",
        created_by=current_user.id,
    )
    db.add(merge_activity)

    db.delete(secondary)
    db.commit()

    return {"detail": f"Lead #{secondary_id} merged into #{primary_id}", "primary_lead_id": primary_id}


@router.get("/leads/{lead_id}", response_model=LeadDetailResponse)
def get_lead_detail(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get lead with deals, tasks, and activities."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    # Fetch related data
    deals = db.query(Deal).filter(Deal.lead_id == lead_id).all()
    tasks = db.query(Task).filter(Task.lead_id == lead_id).all()
    activities = db.query(Activity).filter(Activity.lead_id == lead_id).order_by(desc(Activity.created_at)).all()
    
    return LeadDetailResponse(
        **lead.__dict__,
        deals=deals,
        tasks=tasks,
        activities=activities,
    )


@router.patch("/leads/{lead_id}", response_model=LeadResponse)
def update_lead(
    lead_id: int,
    lead_update: LeadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    update_data = lead_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(lead, field, value)
    
    lead.updated_at = datetime.utcnow()

    # record an activity about the update
    if update_data:
        changes = ", ".join(f"{k}: {v}" for k, v in update_data.items())
        activity = Activity(
            lead_id=lead.id,
            type="note",
            title="Lead updated",
            description=f"{current_user.email} updated lead ({changes})",
            created_by=current_user.id,
        )
        db.add(activity)
    
    db.commit()
    db.refresh(lead)

    # Broadcast assignment event if assigned_to changed
    if "assigned_to" in update_data and update_data["assigned_to"] is not None:
        event = EventTypes.create_event(
            EventTypes.CRM_LEAD_ASSIGNED,
            {
                "lead_id": lead.id,
                "lead_name": f"{lead.first_name} {lead.last_name or ''}".strip(),
                "assigned_to": lead.assigned_to,
            },
        )
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(events_service.broadcast_to_user(lead.assigned_to, event))
        except RuntimeError:
            pass

    return lead


@router.delete("/leads/{lead_id}")
def delete_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a lead and all related deals, tasks, activities."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    db.delete(lead)
    db.commit()
    return {"status": "deleted"}


@router.post("/leads/from-conversation/{conversation_id}", response_model=LeadResponse)
def create_lead_from_conversation(
    conversation_id: int,
    lead_data: LeadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Convert a conversation to a lead by extracting contact info."""
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Create lead linked to conversation
    lead_data.conversation_id = conversation_id
    lead_data.source = "conversation"
    
    db_lead = Lead(**lead_data.model_dump())
    db.add(db_lead)
    db.commit()
    db.refresh(db_lead)
    
    # Create activity linking to the conversation
    activity = Activity(
        lead_id=db_lead.id,
        type="message",
        title="Lead created from conversation",
        description=f"Lead created from conversation with {conversation.contact_info}",
        created_by=current_user.id,
    )
    db.add(activity)
    db.commit()
    
    return db_lead


@router.get("/leads/by-conversation/{conversation_id}", response_model=LeadDetailResponse)
def get_lead_by_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the CRM lead linked to a specific conversation (for ChatWindow contact card)."""
    lead = db.query(Lead).filter(Lead.conversation_id == conversation_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="No lead linked to this conversation")

    deals = db.query(Deal).filter(Deal.lead_id == lead.id).all()
    tasks = db.query(Task).filter(Task.lead_id == lead.id).all()
    activities = db.query(Activity).filter(Activity.lead_id == lead.id).order_by(desc(Activity.created_at)).limit(5).all()

    return LeadDetailResponse(
        **lead.__dict__,
        deals=deals,
        tasks=tasks,
        activities=activities,
    )


# ========== DEAL ENDPOINTS ==========

@router.post("/deals", response_model=DealResponse)
def create_deal(
    deal: DealCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new deal."""
    lead = db.query(Lead).filter(Lead.id == deal.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    db_deal = Deal(**deal.model_dump())
    db.add(db_deal)
    db.commit()
    db.refresh(db_deal)
    
    # Create activity for deal creation
    activity = Activity(
        lead_id=lead.id,
        type="deal_stage_change",
        title=f"Deal created: {db_deal.name}",
        description=f"New deal at stage: {db_deal.stage}",
        created_by=current_user.id,
    )
    db.add(activity)
    db.commit()

    apply_score(lead.id, "deal_created", db)

    return db_deal


@router.get("/deals", response_model=list[DealResponse])
def list_deals(
    stage: str = Query(None),
    lead_id: int = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List deals with optional filtering."""
    query = db.query(Deal)
    if stage:
        query = query.filter(Deal.stage == stage)
    if lead_id:
        query = query.filter(Deal.lead_id == lead_id)
    
    return query.order_by(desc(Deal.created_at)).offset(skip).limit(limit).all()

@router.get("/deals/{deal_id}", response_model=DealDetailResponse)
def get_deal_detail(
    deal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get deal with lead info, tasks, and activities."""
    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    lead = db.query(Lead).filter(Lead.id == deal.lead_id).first()
    tasks = db.query(Task).filter(Task.deal_id == deal_id).all()
    activities = db.query(Activity).filter(Activity.lead_id == deal.lead_id).order_by(desc(Activity.created_at)).all()

    deal_data = DealDetailResponse.model_validate(deal)
    deal_data.lead = LeadResponse.model_validate(lead) if lead else None
    deal_data.tasks = [TaskResponse.model_validate(t) for t in tasks]
    deal_data.activities = [ActivityResponse.model_validate(a) for a in activities]
    return deal_data

@router.patch("/deals/{deal_id}", response_model=DealResponse)
def update_deal(
    deal_id: int,
    deal_update: DealUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a deal."""
    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    
    old_stage = deal.stage
    update_data = deal_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(deal, field, value)
    
    deal.updated_at = datetime.utcnow()
    
    # If stage changed, create activity
    if "stage" in update_data and old_stage != deal.stage:
        activity = Activity(
            lead_id=deal.lead_id,
            type="deal_stage_change",
            title=f"Deal stage changed: {old_stage} → {deal.stage}",
            description=f"{deal.name}: {old_stage} → {deal.stage}",
            created_by=current_user.id,
        )
        db.add(activity)
        if deal.stage == "won":
            apply_score(deal.lead_id, "deal_won", db)
        elif deal.stage == "lost":
            apply_score(deal.lead_id, "deal_lost", db)
        stage_event = EventTypes.create_event(
            EventTypes.CRM_DEAL_STAGE_CHANGED,
            {
                "deal_id": deal.id,
                "deal_name": deal.name,
                "old_stage": old_stage,
                "new_stage": deal.stage,
                "lead_id": deal.lead_id,
            },
        )
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(events_service.broadcast_to_all(stage_event))
        except RuntimeError:
            pass

    db.commit()
    db.refresh(deal)
    
    return deal


@router.delete("/deals/{deal_id}")
def delete_deal(
    deal_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a deal."""
    deal = db.query(Deal).filter(Deal.id == deal_id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    
    db.delete(deal)
    db.commit()
    return {"status": "deleted"}


# ========== TASK ENDPOINTS ==========

@router.post("/tasks", response_model=TaskResponse)
def create_task(
    task: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new task."""
    lead = db.query(Lead).filter(Lead.id == task.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    db_task = Task(**task.model_dump())
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    
    # Create activity for task creation
    activity = Activity(
        lead_id=lead.id,
        type="task_created",
        title=f"Task created: {db_task.title}",
        description=f"Due: {db_task.due_date}",
        created_by=current_user.id,
    )
    db.add(activity)
    db.commit()
    
    return db_task


@router.get("/tasks", response_model=list[TaskResponse])
def list_tasks(
    status: str = Query(None),
    assigned_to: int = Query(None),
    lead_id: int = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List tasks with optional filtering."""
    query = db.query(Task)
    if status:
        query = query.filter(Task.status == status)
    if assigned_to:
        query = query.filter(Task.assigned_to == assigned_to)
    if lead_id:
        query = query.filter(Task.lead_id == lead_id)
    
    return query.order_by(Task.due_date).offset(skip).limit(limit).all()


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    task_update: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a task."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    update_data = task_update.model_dump(exclude_unset=True)
    
    # Handle completion
    if "status" in update_data and update_data["status"] == TaskStatus.COMPLETED:
        task.completed_at = datetime.utcnow()
    
    for field, value in update_data.items():
        setattr(task, field, value)
    
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    
    return task


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a task."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    db.delete(task)
    db.commit()
    return {"status": "deleted"}


# ========== ACTIVITY ENDPOINTS ==========

@router.get("/activities/{lead_id}", response_model=list[ActivityResponse])
def get_lead_activities(
    lead_id: int,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get activities for a lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    return (
        db.query(Activity)
        .filter(Activity.lead_id == lead_id)
        .order_by(desc(Activity.created_at))
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("/activities/{lead_id}", response_model=ActivityResponse)
def create_activity(
    lead_id: int,
    activity: ActivityCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually log an activity for a lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    db_activity = Activity(
        lead_id=lead_id,
        type=activity.type,
        title=activity.title,
        description=activity.description,
        message_id=activity.message_id,
        created_by=current_user.id,
    )
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)

    # Update lead score based on activity type
    apply_score(lead_id, activity.type.value if hasattr(activity.type, 'value') else str(activity.type), db)

    return db_activity


# ========== NOTE ENDPOINTS ==========

@router.get("/leads/{lead_id}/notes", response_model=list[NoteResponse])
def get_lead_notes(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    notes = (
        db.query(LeadNote)
        .filter(LeadNote.lead_id == lead_id)
        .order_by(LeadNote.is_pinned.desc(), LeadNote.created_at.desc())
        .all()
    )
    result = []
    for note in notes:
        user = db.query(User).filter(User.id == note.created_by).first()
        result.append(NoteResponse(
            id=note.id,
            lead_id=note.lead_id,
            content=note.content,
            is_pinned=note.is_pinned,
            created_by=note.created_by,
            created_by_name=user.full_name if user else None,
            created_at=note.created_at,
            updated_at=note.updated_at,
        ))
    return result


@router.post("/leads/{lead_id}/notes", response_model=NoteResponse)
def create_note(
    lead_id: int,
    note: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db_note = LeadNote(
        lead_id=lead_id,
        content=note.content,
        is_pinned=note.is_pinned,
        created_by=current_user.id,
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return NoteResponse(
        id=db_note.id,
        lead_id=db_note.lead_id,
        content=db_note.content,
        is_pinned=db_note.is_pinned,
        created_by=db_note.created_by,
        created_by_name=current_user.full_name,
        created_at=db_note.created_at,
        updated_at=db_note.updated_at,
    )


@router.patch("/leads/notes/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: int,
    note_update: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(LeadNote).filter(LeadNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    update_data = note_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(note, key, value)
    db.commit()
    db.refresh(note)
    user = db.query(User).filter(User.id == note.created_by).first()
    return NoteResponse(
        id=note.id,
        lead_id=note.lead_id,
        content=note.content,
        is_pinned=note.is_pinned,
        created_by=note.created_by,
        created_by_name=user.full_name if user else None,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.delete("/leads/notes/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(LeadNote).filter(LeadNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"detail": "Note deleted"}


# ========== ANALYTICS ENDPOINTS ==========

@router.get("/analytics/pipeline-summary")
def get_pipeline_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get deal pipeline summary: total by stage."""
    stages = [stage.value for stage in DealStage]
    result = {}
    
    for stage in stages:
        deals = db.query(Deal).filter(Deal.stage == stage).all()
        result[stage] = {
            "count": len(deals),
            "total_amount": sum(d.amount or 0 for d in deals),
            "avg_probability": sum(d.probability for d in deals) / len(deals) if deals else 0,
        }
    
    return result


@router.get("/analytics/lead-sources")
def get_lead_sources(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get lead distribution by source."""
    sources = {}
    for source_enum in ["conversation", "email", "website", "referral", "other"]:
        leads = db.query(Lead).filter(Lead.source == source_enum).all()
        sources[source_enum] = len(leads)
    
    return sources


@router.get("/analytics/lead-scoring")
def get_top_leads_by_score(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get top leads by score."""
    leads = (
        db.query(Lead)
        .order_by(desc(Lead.score))
        .limit(limit)
        .all()
    )
    
    return [
        {
            "id": lead.id,
            "name": f"{lead.first_name} {lead.last_name or ''}",
            "score": lead.score,
            "status": lead.status,
            "email": lead.email,
            "estimated_value": lead.estimated_value,
        }
        for lead in leads
    ]


@router.get("/analytics/forecast")
def revenue_forecast(
    months: int = Query(6),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Probability-weighted revenue forecast by month."""
    import calendar as cal
    result = []
    now = datetime.utcnow()
    for i in range(months):
        month_num = (now.month - 1 + i) % 12 + 1
        year_offset = (now.month - 1 + i) // 12
        month_year = now.year + year_offset
        month_start = datetime(month_year, month_num, 1)
        last_day = cal.monthrange(month_year, month_num)[1]
        month_end = datetime(month_year, month_num, last_day, 23, 59, 59)

        deals = db.query(Deal).filter(
            Deal.expected_close_date >= month_start,
            Deal.expected_close_date <= month_end,
            Deal.stage.notin_(["won", "lost"]),
        ).all()

        forecasted = sum((d.amount or 0) * (d.probability or 50) / 100 for d in deals)
        result.append({
            "month": month_start.strftime("%Y-%m"),
            "month_label": month_start.strftime("%b %Y"),
            "forecasted": round(forecasted, 2),
            "pipeline_count": len(deals),
        })
    return result


@router.get("/analytics/win-loss")
def win_loss_analysis(
    days: int = Query(90),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Win rate and loss rate for the given lookback period."""
    from datetime import timedelta
    since = datetime.utcnow() - timedelta(days=days)
    won = db.query(Deal).filter(Deal.stage == "won", Deal.closed_at >= since).all()
    lost = db.query(Deal).filter(Deal.stage == "lost", Deal.closed_at >= since).all()
    total = len(won) + len(lost)
    return {
        "period_days": days,
        "won_count": len(won),
        "lost_count": len(lost),
        "total_closed": total,
        "win_rate": round(len(won) / total * 100, 1) if total else 0,
        "loss_rate": round(len(lost) / total * 100, 1) if total else 0,
        "avg_won_value": round(sum(d.amount or 0 for d in won) / len(won), 2) if won else 0,
        "total_won_revenue": round(sum(d.amount or 0 for d in won), 2),
    }


@router.get("/analytics/deal-velocity")
def deal_velocity(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Average days deals spend in each stage."""
    stages = ["prospect", "qualified", "proposal", "negotiation", "close", "won", "lost"]
    result = []
    for stage in stages:
        deals = db.query(Deal).filter(Deal.stage == stage).all()
        if not deals:
            result.append({"stage": stage, "avg_days": 0, "count": 0})
            continue
        ages = [(datetime.utcnow() - d.created_at).days for d in deals]
        result.append({
            "stage": stage,
            "avg_days": round(sum(ages) / len(ages), 1),
            "count": len(deals),
        })
    return result


@router.get("/analytics/conversion-funnel")
def conversion_funnel(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lead to Deal to Won conversion percentages."""
    total_leads = db.query(func.count(Lead.id)).scalar() or 0
    leads_with_deals = db.query(func.count(func.distinct(Deal.lead_id))).scalar() or 0
    won_deals = db.query(func.count(Deal.id)).filter(Deal.stage == "won").scalar() or 0
    return {
        "total_leads": total_leads,
        "leads_with_deals": leads_with_deals,
        "won_deals": won_deals,
        "lead_to_deal_rate": round(leads_with_deals / total_leads * 100, 1) if total_leads else 0,
        "deal_to_won_rate": round(won_deals / leads_with_deals * 100, 1) if leads_with_deals else 0,
        "overall_conversion": round(won_deals / total_leads * 100, 1) if total_leads else 0,
    }


# ========== DASHBOARD ENDPOINTS ==========

@router.get("/dashboard/my-day")
def get_my_day(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Aggregated daily dashboard for the current agent."""
    from datetime import timedelta
    from sqlalchemy import and_, exists, select

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    seven_days_ago = now - timedelta(days=7)
    seven_days_ahead = now + timedelta(days=7)

    # Overdue tasks
    overdue_tasks = (
        db.query(Task)
        .filter(
            Task.assigned_to == current_user.id,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
            Task.due_date < now,
            Task.due_date.isnot(None),
        )
        .order_by(Task.due_date)
        .limit(20)
        .all()
    )

    # Today's tasks
    today_tasks = (
        db.query(Task)
        .filter(
            Task.assigned_to == current_user.id,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
            Task.due_date >= today_start,
            Task.due_date < today_end,
        )
        .order_by(Task.due_date)
        .all()
    )

    # Stale leads (no activity in 7+ days)
    recent_activity_subq = (
        select(Activity.id)
        .where(
            and_(
                Activity.lead_id == Lead.id,
                Activity.created_at >= seven_days_ago,
            )
        )
        .correlate(Lead)
        .exists()
    )
    stale_leads = (
        db.query(Lead)
        .filter(
            Lead.assigned_to == current_user.id,
            Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED]),
            ~recent_activity_subq,
        )
        .limit(20)
        .all()
    )

    # Deals closing soon
    deals_closing_soon = (
        db.query(Deal)
        .filter(
            Deal.assigned_to == current_user.id,
            Deal.stage.notin_([DealStage.WON, DealStage.LOST]),
            Deal.expected_close_date <= seven_days_ahead,
            Deal.expected_close_date >= now,
        )
        .order_by(Deal.expected_close_date)
        .limit(10)
        .all()
    )

    # Recent activity across agent's leads
    agent_lead_ids = [l.id for l in db.query(Lead.id).filter(Lead.assigned_to == current_user.id).all()]
    recent_activity = []
    if agent_lead_ids:
        recent_activity = (
            db.query(Activity)
            .filter(Activity.lead_id.in_(agent_lead_ids))
            .order_by(Activity.created_at.desc())
            .limit(20)
            .all()
        )

    # Stats
    open_leads_count = db.query(Lead).filter(
        Lead.assigned_to == current_user.id,
        Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED]),
    ).count()

    pipeline_value = db.query(func.sum(Deal.amount)).filter(
        Deal.assigned_to == current_user.id,
        Deal.stage.notin_([DealStage.WON, DealStage.LOST]),
    ).scalar() or 0

    tasks_completed_today = db.query(Task).filter(
        Task.assigned_to == current_user.id,
        Task.status == TaskStatus.COMPLETED,
        Task.completed_at >= today_start,
    ).count()

    conversations_active = 0
    try:
        conversations_active = db.query(Conversation).filter(
            Conversation.assigned_to == current_user.id,
            Conversation.status == "open",
        ).count()
    except Exception:
        pass

    return {
        "overdue_tasks": [{"id": t.id, "title": t.title, "due_date": t.due_date.isoformat() if t.due_date else None, "lead_id": t.lead_id, "status": t.status.value} for t in overdue_tasks],
        "today_tasks": [{"id": t.id, "title": t.title, "due_date": t.due_date.isoformat() if t.due_date else None, "lead_id": t.lead_id, "status": t.status.value} for t in today_tasks],
        "stale_leads": [{"id": l.id, "first_name": l.first_name, "last_name": l.last_name, "company": l.company, "status": l.status.value, "score": l.score} for l in stale_leads],
        "deals_closing_soon": [{"id": d.id, "name": d.name, "stage": d.stage.value, "amount": d.amount, "probability": d.probability, "expected_close_date": d.expected_close_date.isoformat() if d.expected_close_date else None} for d in deals_closing_soon],
        "recent_activity": [{"id": a.id, "type": a.type.value, "title": a.title, "description": a.description, "lead_id": a.lead_id, "created_at": a.created_at.isoformat()} for a in recent_activity],
        "stats": {
            "open_leads_count": open_leads_count,
            "pipeline_value": float(pipeline_value),
            "tasks_completed_today": tasks_completed_today,
            "conversations_active": conversations_active,
        },
    }


@router.get("/dashboard/team-feed")
def get_team_feed(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recent activity across the entire team — for managers."""
    from datetime import timedelta
    now = datetime.utcnow()
    seven_days_ago = now - timedelta(days=7)

    # Recent activity across all leads
    recent_activity = (
        db.query(Activity)
        .filter(Activity.created_at >= seven_days_ago)
        .order_by(Activity.created_at.desc())
        .limit(50)
        .all()
    )

    # Enrich with lead names
    lead_ids = list({a.lead_id for a in recent_activity})
    leads_map = {}
    if lead_ids:
        leads_list = db.query(Lead).filter(Lead.id.in_(lead_ids)).all()
        leads_map = {l.id: f"{l.first_name} {l.last_name or ''}".strip() for l in leads_list}

    # Enrich with user names
    user_ids = list({a.created_by for a in recent_activity if a.created_by})
    users_map = {}
    if user_ids:
        users_list = db.query(User).filter(User.id.in_(user_ids)).all()
        users_map = {u.id: u.full_name for u in users_list}

    # Team stats
    total_open_leads = db.query(Lead).filter(
        Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED]),
    ).count()

    total_pipeline_value = db.query(func.sum(Deal.amount)).filter(
        Deal.stage.notin_([DealStage.WON, DealStage.LOST]),
    ).scalar() or 0

    deals_won_this_week = db.query(Deal).filter(
        Deal.stage == DealStage.WON,
        Deal.closed_at >= seven_days_ago,
    ).count()

    return {
        "recent_activity": [
            {
                "id": a.id,
                "type": a.type.value,
                "title": a.title,
                "description": a.description,
                "lead_id": a.lead_id,
                "lead_name": leads_map.get(a.lead_id, "Unknown"),
                "created_by": a.created_by,
                "created_by_name": users_map.get(a.created_by, "Unknown") if a.created_by else None,
                "created_at": a.created_at.isoformat(),
            }
            for a in recent_activity
        ],
        "stats": {
            "total_open_leads": total_open_leads,
            "total_pipeline_value": float(total_pipeline_value),
            "deals_won_this_week": deals_won_this_week,
            "team_activities_this_week": len(recent_activity),
        },
    }
