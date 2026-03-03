from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime

from app.database import get_db
from app.models.crm import Lead, Deal, Task, Activity, LeadStatus, DealStage, TaskStatus, ActivityType
from app.models.user import User
from app.models.conversation import Conversation
from app.schemas.crm import (
    LeadCreate, LeadUpdate, LeadResponse, LeadDetailResponse,
    DealCreate, DealUpdate, DealResponse,
    TaskCreate, TaskUpdate, TaskResponse,
    ActivityCreate, ActivityResponse,
)
from app.dependencies import get_current_user, require_admin_feature
from app.services.crm_scoring import apply_score
from app.services.events_service import events_service, EventTypes
import asyncio

router = APIRouter(prefix="/crm", tags=["crm"])

require_crm = require_admin_feature("feature_manage_crm")


# ========== LEAD ENDPOINTS ==========

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

    return query.order_by(desc(Lead.created_at)).offset(skip).limit(limit).all()


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

@router.get("/deals/{deal_id}")
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
    
    return {
        **deal.__dict__,
        "lead": lead.__dict__ if lead else None,
        "tasks": tasks,
        "activities": activities,
    }

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
