from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime
import logging

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.user import User
from app.models.daily_ops import StandupEntry, DailyPlannerItem, CommandCenterConfig
from app.schemas.daily_ops import (
    StandupCreate, StandupUpdate, StandupResponse,
    PlannerItemCreate, PlannerItemUpdate, PlannerItemResponse,
    PlannerResponse, AssignedItem,
    MetricResponse, CommandCenterConfigUpdate, MetricConfigItem,
)
from app.services.daily_ops_service import (
    get_all_assigned_items, compute_metric, seed_default_metrics,
)
from app.services.events_service import events_service, EventTypes

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/daily-ops",
    tags=["daily-ops"],
    responses={404: {"description": "Not found"}},
)


# ── Helper ───────────────────────────────────────────────────────────────────

def _standup_to_response(entry: StandupEntry) -> dict:
    """Build standup response with user info."""
    user = entry.owner
    user_name = "Unknown"
    user_avatar = None
    if user:
        user_name = user.display_name or user.full_name or user.email
        user_avatar = user.avatar if hasattr(user, "avatar") else None
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "user_name": user_name,
        "user_avatar": user_avatar,
        "date": entry.date,
        "yesterday": entry.yesterday,
        "today": entry.today,
        "blockers": entry.blockers,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }


# ── Standup Endpoints ────────────────────────────────────────────────────────

@router.get("/standups", response_model=List[StandupResponse])
async def get_standups(
    query_date: Optional[date] = Query(None, alias="date", description="Filter by date (YYYY-MM-DD). Defaults to today."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Get all team standups for a given date."""
    target_date = query_date or datetime.utcnow().date()
    entries = db.query(StandupEntry).filter(
        StandupEntry.date == target_date
    ).order_by(StandupEntry.created_at.asc()).all()
    return [_standup_to_response(e) for e in entries]


@router.post("/standups", response_model=StandupResponse, status_code=201)
async def create_standup(
    payload: StandupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Create a standup entry for today. Returns 409 if one already exists."""
    today = datetime.utcnow().date()
    existing = db.query(StandupEntry).filter(
        StandupEntry.user_id == current_user.id,
        StandupEntry.date == today,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Standup already exists for today. Use PATCH to update.")

    entry = StandupEntry(
        user_id=current_user.id,
        date=today,
        yesterday=payload.yesterday,
        today=payload.today,
        blockers=payload.blockers,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    # Broadcast SSE event
    event = events_service.create_event(EventTypes.STANDUP_POSTED, {
        "user_id": current_user.id,
        "user_name": current_user.display_name or current_user.full_name or current_user.email,
        "date": str(today),
    })
    await events_service.broadcast_to_all(event)

    return _standup_to_response(entry)


@router.patch("/standups/{standup_id}", response_model=StandupResponse)
async def update_standup(
    standup_id: int,
    payload: StandupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Update own standup entry."""
    entry = db.query(StandupEntry).filter(StandupEntry.id == standup_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Standup not found")
    if entry.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own standup")

    if payload.yesterday is not None:
        entry.yesterday = payload.yesterday
    if payload.today is not None:
        entry.today = payload.today
    if payload.blockers is not None:
        entry.blockers = payload.blockers

    db.commit()
    db.refresh(entry)

    # Broadcast SSE event
    event = events_service.create_event(EventTypes.STANDUP_POSTED, {
        "user_id": current_user.id,
        "user_name": current_user.display_name or current_user.full_name or current_user.email,
        "date": str(entry.date),
    })
    await events_service.broadcast_to_all(event)

    return _standup_to_response(entry)


@router.delete("/standups/{standup_id}", status_code=204)
async def delete_standup(
    standup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Delete own standup entry."""
    entry = db.query(StandupEntry).filter(StandupEntry.id == standup_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Standup not found")
    if entry.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own standup")

    entry_date = str(entry.date)
    db.delete(entry)
    db.commit()

    # Broadcast SSE event
    event = events_service.create_event(EventTypes.STANDUP_DELETED, {
        "standup_id": standup_id,
        "date": entry_date,
    })
    await events_service.broadcast_to_all(event)


# ── Planner Endpoints ────────────────────────────────────────────────────────

@router.get("/planner", response_model=PlannerResponse)
def get_planner(
    query_date: Optional[date] = Query(None, alias="date", description="Filter by date (YYYY-MM-DD). Defaults to today."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Get personal planner: manual items + auto-pulled assigned items."""
    target_date = query_date or datetime.utcnow().date()

    manual_items = db.query(DailyPlannerItem).filter(
        DailyPlannerItem.user_id == current_user.id,
        DailyPlannerItem.date == target_date,
    ).order_by(DailyPlannerItem.sort_order.asc()).all()

    assigned_items = get_all_assigned_items(db, current_user.id)

    return {
        "manual_items": manual_items,
        "assigned_items": assigned_items,
    }


@router.post("/planner", response_model=PlannerItemResponse, status_code=201)
def create_planner_item(
    payload: PlannerItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Add a manual goal/note to the planner."""
    max_order = db.query(DailyPlannerItem).filter(
        DailyPlannerItem.user_id == current_user.id,
        DailyPlannerItem.date == payload.date,
    ).count()

    item = DailyPlannerItem(
        user_id=current_user.id,
        date=payload.date,
        title=payload.title,
        sort_order=max_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/planner/{item_id}", response_model=PlannerItemResponse)
def update_planner_item(
    item_id: int,
    payload: PlannerItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Update a manual planner item (title, completion, sort order)."""
    item = db.query(DailyPlannerItem).filter(DailyPlannerItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Planner item not found")
    if item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own planner items")

    if payload.title is not None:
        item.title = payload.title
    if payload.is_completed is not None:
        item.is_completed = payload.is_completed
    if payload.sort_order is not None:
        item.sort_order = payload.sort_order

    db.commit()
    db.refresh(item)
    return item


@router.delete("/planner/{item_id}", status_code=204)
def delete_planner_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Remove a manual planner item."""
    item = db.query(DailyPlannerItem).filter(DailyPlannerItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Planner item not found")
    if item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own planner items")

    db.delete(item)
    db.commit()


# ── Command Center Endpoints ─────────────────────────────────────────────────

@router.get("/command-center", response_model=List[MetricResponse])
def get_command_center(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_command_center")),
):
    """Get live KPI metrics for the command center dashboard."""
    seed_default_metrics(db)

    configs = db.query(CommandCenterConfig).filter(
        CommandCenterConfig.is_visible == True
    ).order_by(CommandCenterConfig.sort_order.asc()).all()

    results = []
    for cfg in configs:
        value = compute_metric(db, cfg.metric_key)
        is_exceeded = cfg.threshold_value is not None and value > cfg.threshold_value
        results.append({
            "metric_key": cfg.metric_key,
            "label": cfg.label,
            "value": value,
            "threshold_value": cfg.threshold_value,
            "is_exceeded": is_exceeded,
        })
    return results


@router.get("/command-center/config", response_model=List[MetricConfigItem])
def get_command_center_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "manage_command_center")),
):
    """Get command center configuration (admin only)."""
    seed_default_metrics(db)
    configs = db.query(CommandCenterConfig).order_by(
        CommandCenterConfig.sort_order.asc()
    ).all()
    return [
        {
            "metric_key": c.metric_key,
            "label": c.label,
            "is_visible": c.is_visible,
            "sort_order": c.sort_order,
            "threshold_value": c.threshold_value,
        }
        for c in configs
    ]


@router.put("/command-center/config", response_model=List[MetricConfigItem])
def update_command_center_config(
    payload: CommandCenterConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "manage_command_center")),
):
    """Update command center configuration (admin only)."""
    for item in payload.metrics:
        config = db.query(CommandCenterConfig).filter(
            CommandCenterConfig.metric_key == item.metric_key
        ).first()
        if config:
            config.label = item.label
            config.is_visible = item.is_visible
            config.sort_order = item.sort_order
            config.threshold_value = item.threshold_value
            config.created_by = current_user.id

    db.commit()

    configs = db.query(CommandCenterConfig).order_by(
        CommandCenterConfig.sort_order.asc()
    ).all()
    return [
        {
            "metric_key": c.metric_key,
            "label": c.label,
            "is_visible": c.is_visible,
            "sort_order": c.sort_order,
            "threshold_value": c.threshold_value,
        }
        for c in configs
    ]
