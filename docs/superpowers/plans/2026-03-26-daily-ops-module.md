# Daily Ops Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified Daily Ops page with personal planner, async team standups, and real-time command center dashboard.

**Architecture:** Three new backend files (model, schema, service + route) following existing FastAPI patterns. One new frontend page with tab navigation and 8 reusable components. Data flows from existing tables (conversations, tickets, CRM tasks, PMS tasks, emails) into a unified planner view. Command center polls live KPI metrics every 30 seconds.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, Next.js 14 App Router, TypeScript, TailwindCSS, Axios

**Spec:** `docs/superpowers/specs/2026-03-26-daily-ops-module-design.md`

---

## File Structure

### Files to Create

| File | Responsibility |
|---|---|
| `backend/app/models/daily_ops.py` | SQLAlchemy models: StandupEntry, DailyPlannerItem, CommandCenterConfig |
| `backend/app/schemas/daily_ops.py` | Pydantic schemas for request validation and response shaping |
| `backend/app/services/daily_ops_service.py` | Business logic: multi-table planner aggregation, KPI metric computation |
| `backend/app/routes/daily_ops.py` | FastAPI route handlers for all daily-ops endpoints |
| `frontend/components/daily-ops/MyDayTab.tsx` | Personal planner tab with manual items + auto-pulled assigned items |
| `frontend/components/daily-ops/PlannerItemRow.tsx` | Draggable checkbox row for manual goals |
| `frontend/components/daily-ops/TeamStandupsTab.tsx` | Team standup board with agent cards |
| `frontend/components/daily-ops/StandupForm.tsx` | Post/edit standup modal form |
| `frontend/components/daily-ops/CommandCenterTab.tsx` | KPI metric cards grid |
| `frontend/components/daily-ops/CommandCenterConfig.tsx` | Admin config modal for metrics |
| `frontend/components/daily-ops/MetricCard.tsx` | Individual KPI card component |
| `frontend/app/daily-ops/page.tsx` | Main Daily Ops page with 3-tab navigation |

### Files to Modify

| File | Change |
|---|---|
| `backend/app/permissions_registry.py` | Add `daily_ops` module to `MODULE_REGISTRY` |
| `backend/app/services/events_service.py` | Add `STANDUP_POSTED`, `STANDUP_DELETED` event types; add `get_connected_user_count()` method |
| `backend/main.py` | Import daily_ops model + register daily_ops router |
| `frontend/lib/api.ts` | Add `dailyOpsApi` object with all endpoint methods |

---

## Chunk 1: Backend Models, Schemas & Permissions

### Task 1: Create SQLAlchemy Models

**Files:**
- Create: `backend/app/models/daily_ops.py`

- [ ] **Step 1: Create the model file**

```python
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class StandupEntry(Base):
    __tablename__ = "standup_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_standup_user_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    yesterday = Column(Text, nullable=False)
    today = Column(Text, nullable=False)
    blockers = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[user_id], backref="standup_entries")


class DailyPlannerItem(Base):
    __tablename__ = "daily_planner_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    title = Column(String, nullable=False)
    is_completed = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[user_id], backref="daily_planner_items")


class CommandCenterConfig(Base):
    __tablename__ = "command_center_configs"

    id = Column(Integer, primary_key=True, index=True)
    metric_key = Column(String, nullable=False, unique=True)
    label = Column(String, nullable=False)
    is_visible = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    threshold_value = Column(Integer, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/models/daily_ops.py
git commit -m "feat(daily-ops): add SQLAlchemy models for StandupEntry, DailyPlannerItem, CommandCenterConfig"
```

---

### Task 2: Create Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/daily_ops.py`

- [ ] **Step 1: Create the schema file**

```python
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict
from datetime import date, datetime


# ── Standup ──────────────────────────────────────────────────────────────────

class StandupCreate(BaseModel):
    yesterday: str
    today: str
    blockers: Optional[str] = None


class StandupUpdate(BaseModel):
    yesterday: Optional[str] = None
    today: Optional[str] = None
    blockers: Optional[str] = None


class StandupResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    user_avatar: Optional[str] = None
    date: date
    yesterday: str
    today: str
    blockers: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ── Planner ──────────────────────────────────────────────────────────────────

class PlannerItemCreate(BaseModel):
    title: str
    date: date


class PlannerItemUpdate(BaseModel):
    title: Optional[str] = None
    is_completed: Optional[bool] = None
    sort_order: Optional[int] = None


class PlannerItemResponse(BaseModel):
    id: int
    title: str
    is_completed: bool
    sort_order: int
    date: date
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AssignedItem(BaseModel):
    id: int
    type: str       # "conversation" | "ticket" | "crm_task" | "pms_task" | "email"
    title: str
    priority: Optional[str] = None
    due_date: Optional[date] = None
    link: str       # frontend path to navigate to


class PlannerResponse(BaseModel):
    manual_items: List[PlannerItemResponse]
    assigned_items: Dict[str, List[AssignedItem]]
    # keys: "conversations", "tickets", "crm_tasks", "pms_tasks", "emails"


# ── Command Center ──────────────────────────────────────────────────────────

class MetricResponse(BaseModel):
    metric_key: str
    label: str
    value: int | float
    threshold_value: Optional[int] = None
    is_exceeded: bool


class MetricConfigItem(BaseModel):
    metric_key: str
    label: str
    is_visible: bool
    sort_order: int
    threshold_value: Optional[int] = None


class CommandCenterConfigUpdate(BaseModel):
    metrics: List[MetricConfigItem]
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/daily_ops.py
git commit -m "feat(daily-ops): add Pydantic schemas for standup, planner, and command center"
```

---

### Task 3: Register Permissions

**Files:**
- Modify: `backend/app/permissions_registry.py`

- [ ] **Step 1: Add daily_ops to MODULE_REGISTRY**

In `backend/app/permissions_registry.py`, add the following entry inside the `MODULE_REGISTRY` dict, after the `"individuals"` entry (last current entry, before the closing `}`):

```python
    # Daily Ops
    "daily_ops":      {"label": "Daily Ops",           "actions": ["view_planner", "view_standups", "view_command_center", "manage_command_center"]},
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/permissions_registry.py
git commit -m "feat(daily-ops): register daily_ops permissions in MODULE_REGISTRY"
```

---

### Task 4: Add Event Types to Events Service

**Files:**
- Modify: `backend/app/services/events_service.py`

- [ ] **Step 1: Add event type constants**

In `backend/app/services/events_service.py`, add these lines inside the `EventTypes` class, after the existing PMS entries (after `PMS_TASK_UPDATED = "pms_task_updated"`):

```python
    # Daily Ops events
    STANDUP_POSTED = "standup_posted"
    STANDUP_DELETED = "standup_deleted"
```

- [ ] **Step 2: Add connected user count method**

In `backend/app/services/events_service.py`, add this method to the `EventsService` class, after the `broadcast_to_all` method:

```python
    def get_connected_user_count(self) -> int:
        """Return number of distinct users with active connections"""
        return len(self.active_connections)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/events_service.py
git commit -m "feat(daily-ops): add standup event types and connected user count to events service"
```

---

## Chunk 2: Backend Service Layer

### Task 5: Create Daily Ops Service

**Files:**
- Create: `backend/app/services/daily_ops_service.py`

- [ ] **Step 1: Create the service file with planner aggregation logic**

```python
"""
Daily Ops service — multi-table aggregation for planner assigned items
and command center KPI metric computations.
"""

import logging
from datetime import date, datetime
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func

from app.models.conversation import Conversation
from app.models.ticket import Ticket, TicketStatus
from app.models.crm import Deal, DealStage, CRMTask, TaskStatus
from app.models.pms import PMSTask
from app.models.email import Email
from app.models.message import Message
from app.models.daily_ops import CommandCenterConfig
from app.services.events_service import events_service

logger = logging.getLogger(__name__)


def get_assigned_conversations(db: Session, user_id: int) -> List[Dict[str, Any]]:
    """Get open/pending conversations assigned to user."""
    convos = db.query(Conversation).filter(
        Conversation.assigned_to == user_id,
        Conversation.status.in_(["open", "pending"])
    ).all()
    return [
        {
            "id": c.id,
            "type": "conversation",
            "title": f"{c.platform} — {c.contact_name or 'Unknown'}",
            "priority": None,
            "due_date": None,
            "link": f"/dashboard?conversation={c.id}",
        }
        for c in convos
    ]


def get_assigned_tickets(db: Session, user_id: int) -> List[Dict[str, Any]]:
    """Get open/pending tickets assigned to user."""
    tickets = db.query(Ticket).filter(
        Ticket.assigned_to == user_id,
        Ticket.status.in_([TicketStatus.PENDING])
    ).all()
    return [
        {
            "id": t.id,
            "type": "ticket",
            "title": f"#{t.ticket_number} — {t.subject}",
            "priority": t.priority.value if t.priority else None,
            "due_date": None,
            "link": f"/workspace/tickets/{t.ticket_number}",
        }
        for t in tickets
    ]


def get_assigned_crm_tasks(db: Session, user_id: int, today: date) -> List[Dict[str, Any]]:
    """Get CRM tasks assigned to user that are due today or overdue."""
    tasks = db.query(CRMTask).filter(
        CRMTask.assigned_to == user_id,
        CRMTask.due_date <= datetime.combine(today, datetime.max.time()),
        CRMTask.status.notin_([TaskStatus.COMPLETED, TaskStatus.CANCELLED])
    ).all()
    return [
        {
            "id": t.id,
            "type": "crm_task",
            "title": t.title,
            "priority": t.priority if hasattr(t, 'priority') else None,
            "due_date": t.due_date.date() if t.due_date else None,
            "link": f"/admin/crm/tasks",
        }
        for t in tasks
    ]


def get_assigned_pms_tasks(db: Session, user_id: int, today: date) -> List[Dict[str, Any]]:
    """Get PMS tasks assigned to user that are due today or overdue."""
    tasks = db.query(PMSTask).filter(
        PMSTask.assignee_id == user_id,
        PMSTask.due_date <= today,
        PMSTask.status.notin_(["done", "cancelled"])
    ).all()
    return [
        {
            "id": t.id,
            "type": "pms_task",
            "title": t.title,
            "priority": t.priority if hasattr(t, 'priority') else None,
            "due_date": t.due_date if t.due_date else None,
            "link": f"/admin/pms/{t.id}",
        }
        for t in tasks
    ]


def get_unread_emails(db: Session, user_id: int) -> List[Dict[str, Any]]:
    """Get unread emails for user's email accounts."""
    emails = db.query(Email).filter(
        Email.user_id == user_id,
        Email.is_read == False,
        Email.folder == "inbox"
    ).limit(20).all()
    return [
        {
            "id": e.id,
            "type": "email",
            "title": e.subject or "(No subject)",
            "priority": None,
            "due_date": None,
            "link": f"/email?id={e.id}",
        }
        for e in emails
    ]


def get_all_assigned_items(db: Session, user_id: int) -> Dict[str, List[Dict[str, Any]]]:
    """Aggregate all assigned items for the planner view."""
    today = date.today()
    return {
        "conversations": get_assigned_conversations(db, user_id),
        "tickets": get_assigned_tickets(db, user_id),
        "crm_tasks": get_assigned_crm_tasks(db, user_id, today),
        "pms_tasks": get_assigned_pms_tasks(db, user_id, today),
        "emails": get_unread_emails(db, user_id),
    }


# ── Command Center Metrics ──────────────────────────────────────────────────

def compute_metric(db: Session, metric_key: str) -> int | float:
    """Compute a single KPI metric value."""
    today = date.today()

    if metric_key == "open_conversations":
        return db.query(Conversation).filter(Conversation.status == "open").count()

    elif metric_key == "unassigned_conversations":
        return db.query(Conversation).filter(
            Conversation.assigned_to.is_(None),
            Conversation.status == "open"
        ).count()

    elif metric_key == "pending_tickets":
        return db.query(Ticket).filter(
            Ticket.status.in_([TicketStatus.PENDING])
        ).count()

    elif metric_key == "overdue_crm_tasks":
        return db.query(CRMTask).filter(
            CRMTask.due_date < datetime.combine(today, datetime.min.time()),
            CRMTask.status.notin_([TaskStatus.COMPLETED, TaskStatus.CANCELLED])
        ).count()

    elif metric_key == "deals_in_pipeline":
        return db.query(Deal).filter(
            Deal.stage.notin_([DealStage.WON, DealStage.LOST])
        ).count()

    elif metric_key == "unread_emails":
        return db.query(Email).filter(
            Email.is_read == False,
            Email.folder == "inbox"
        ).count()

    elif metric_key == "active_agents":
        return events_service.get_connected_user_count()

    elif metric_key == "avg_response_time_today":
        return _compute_avg_response_time(db, today)

    return 0


def _compute_avg_response_time(db: Session, today: date) -> float:
    """
    Average minutes between first customer message and first agent reply,
    for conversations that received their first agent reply today.
    """
    try:
        # Get conversations that had an agent reply today
        from sqlalchemy import and_, text
        result = db.execute(text("""
            WITH first_customer AS (
                SELECT conversation_id, MIN(created_at) AS first_msg
                FROM messages
                WHERE direction = 'inbound'
                GROUP BY conversation_id
            ),
            first_agent AS (
                SELECT conversation_id, MIN(created_at) AS first_reply
                FROM messages
                WHERE direction = 'outbound'
                GROUP BY conversation_id
            )
            SELECT AVG(EXTRACT(EPOCH FROM (fa.first_reply - fc.first_msg)) / 60) AS avg_minutes
            FROM first_customer fc
            JOIN first_agent fa ON fc.conversation_id = fa.conversation_id
            WHERE fa.first_reply::date = :today
        """), {"today": today})
        row = result.fetchone()
        return round(row[0], 1) if row and row[0] else 0.0
    except Exception as e:
        logger.error(f"Error computing avg response time: {e}")
        return 0.0


# Default metrics to seed into CommandCenterConfig on first use
DEFAULT_METRICS = [
    {"metric_key": "open_conversations", "label": "Open Conversations", "sort_order": 1, "is_visible": True},
    {"metric_key": "unassigned_conversations", "label": "Unassigned Convos", "sort_order": 2, "is_visible": True},
    {"metric_key": "pending_tickets", "label": "Pending Tickets", "sort_order": 3, "is_visible": True},
    {"metric_key": "overdue_crm_tasks", "label": "Overdue CRM Tasks", "sort_order": 4, "is_visible": True},
    {"metric_key": "deals_in_pipeline", "label": "Deals in Pipeline", "sort_order": 5, "is_visible": True},
    {"metric_key": "unread_emails", "label": "Unread Emails", "sort_order": 6, "is_visible": True},
    {"metric_key": "active_agents", "label": "Active Agents", "sort_order": 7, "is_visible": True},
    {"metric_key": "avg_response_time_today", "label": "Avg Response Time", "sort_order": 8, "is_visible": True},
]


def seed_default_metrics(db: Session):
    """Seed default command center metrics if none exist."""
    existing = db.query(CommandCenterConfig).count()
    if existing > 0:
        return
    for m in DEFAULT_METRICS:
        db.add(CommandCenterConfig(**m))
    db.commit()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/daily_ops_service.py
git commit -m "feat(daily-ops): add service layer for planner aggregation and KPI metric computation"
```

---

## Chunk 3: Backend Routes

### Task 6: Create Daily Ops Route Handlers

**Files:**
- Create: `backend/app/routes/daily_ops.py`

- [ ] **Step 1: Create the route file**

```python
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
    date: Optional[date] = Query(None, description="Filter by date (YYYY-MM-DD). Defaults to today."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Get all team standups for a given date."""
    target_date = date or datetime.utcnow().date()
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
    date: Optional[date] = Query(None, description="Filter by date (YYYY-MM-DD). Defaults to today."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Get personal planner: manual items + auto-pulled assigned items."""
    target_date = date or datetime.utcnow().date()

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
    # Auto-assign sort_order to end of list
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
    # Seed defaults if no config exists
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

    # Return updated config
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/daily_ops.py
git commit -m "feat(daily-ops): add route handlers for standups, planner, and command center"
```

---

### Task 7: Register Router and Model Import in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add model import**

At the top of `backend/main.py`, in the model import section (around lines 1-46 where other models are imported), add:

```python
from app.models.daily_ops import StandupEntry, DailyPlannerItem, CommandCenterConfig
```

- [ ] **Step 2: Add route import**

In the route import section of `backend/main.py`, add:

```python
from app.routes import daily_ops as daily_ops_routes
```

- [ ] **Step 3: Register the router**

In the router registration section (around line 2384, after `app.include_router(widget_domains.router)`), add:

```python
app.include_router(daily_ops_routes.router)
```

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(daily-ops): register daily_ops model imports and router in main.py"
```

---

## Chunk 4: Frontend API Client & Components

### Task 8: Add Daily Ops API Client

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add dailyOpsApi to the API client**

At the end of `frontend/lib/api.ts` (before the final line/closing), add:

```typescript
// ── Daily Ops ──────────────────────────────────────────────────────────────

export const dailyOpsApi = {
  // Standups
  getStandups: (date?: string) => api.get('/daily-ops/standups', { params: { date } }),
  createStandup: (data: { yesterday: string; today: string; blockers?: string }) =>
    api.post('/daily-ops/standups', data),
  updateStandup: (id: number, data: { yesterday?: string; today?: string; blockers?: string }) =>
    api.patch(`/daily-ops/standups/${id}`, data),
  deleteStandup: (id: number) => api.delete(`/daily-ops/standups/${id}`),

  // Planner
  getPlanner: (date?: string) => api.get('/daily-ops/planner', { params: { date } }),
  createPlannerItem: (data: { title: string; date: string }) =>
    api.post('/daily-ops/planner', data),
  updatePlannerItem: (id: number, data: { title?: string; is_completed?: boolean; sort_order?: number }) =>
    api.patch(`/daily-ops/planner/${id}`, data),
  deletePlannerItem: (id: number) => api.delete(`/daily-ops/planner/${id}`),

  // Command Center
  getCommandCenter: () => api.get('/daily-ops/command-center'),
  getCommandCenterConfig: () => api.get('/daily-ops/command-center/config'),
  updateCommandCenterConfig: (data: { metrics: any[] }) =>
    api.put('/daily-ops/command-center/config', data),
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(daily-ops): add dailyOpsApi client methods"
```

---

### Task 9: Create MetricCard Component

**Files:**
- Create: `frontend/components/daily-ops/MetricCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

interface MetricCardProps {
  metricKey: string
  label: string
  value: number | string
  thresholdValue?: number | null
  isExceeded: boolean
}

const METRIC_ICONS: Record<string, string> = {
  open_conversations: '💬',
  unassigned_conversations: '💬',
  pending_tickets: '🎫',
  overdue_crm_tasks: '⚠️',
  deals_in_pipeline: '📊',
  unread_emails: '📧',
  active_agents: '👥',
  avg_response_time_today: '⏱️',
}

const METRIC_SUFFIX: Record<string, string> = {
  avg_response_time_today: 'min',
}

export default function MetricCard({ metricKey, label, value, thresholdValue, isExceeded }: MetricCardProps) {
  const icon = METRIC_ICONS[metricKey] || '📈'
  const suffix = METRIC_SUFFIX[metricKey] || ''

  return (
    <div
      className={`rounded-lg border p-4 text-center transition-colors ${
        isExceeded
          ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      }`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-3xl font-bold ${isExceeded ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}{suffix && <span className="text-sm font-normal ml-1">{suffix}</span>}
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{label}</div>
      {thresholdValue !== null && thresholdValue !== undefined && (
        <div className="text-xs text-gray-400 mt-1">Threshold: {thresholdValue}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/daily-ops/MetricCard.tsx
git commit -m "feat(daily-ops): add MetricCard component"
```

---

### Task 10: Create PlannerItemRow Component

**Files:**
- Create: `frontend/components/daily-ops/PlannerItemRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useState } from 'react'
import { dailyOpsApi } from '@/lib/api'

interface PlannerItemRowProps {
  id: number
  title: string
  isCompleted: boolean
  onUpdate: () => void
  onDelete: () => void
}

export default function PlannerItemRow({ id, title, isCompleted, onUpdate, onDelete }: PlannerItemRowProps) {
  const [loading, setLoading] = useState(false)

  const toggleComplete = async () => {
    setLoading(true)
    try {
      await dailyOpsApi.updatePlannerItem(id, { is_completed: !isCompleted })
      onUpdate()
    } catch (err) {
      console.error('Failed to toggle item:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      await dailyOpsApi.deletePlannerItem(id)
      onDelete()
    } catch (err) {
      console.error('Failed to delete item:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${
      isCompleted ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-800'
    } border-gray-200 dark:border-gray-700`}>
      <button
        onClick={toggleComplete}
        disabled={loading}
        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          isCompleted
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 dark:border-gray-600 hover:border-green-400'
        }`}
      >
        {isCompleted && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <span className={`flex-1 ${isCompleted ? 'line-through text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {title}
      </span>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="text-gray-400 hover:text-red-500 transition-colors"
        title="Remove"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/daily-ops/PlannerItemRow.tsx
git commit -m "feat(daily-ops): add PlannerItemRow component with checkbox toggle and delete"
```

---

### Task 11: Create StandupForm Component

**Files:**
- Create: `frontend/components/daily-ops/StandupForm.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'

interface StandupFormProps {
  existingStandup?: {
    id: number
    yesterday: string
    today: string
    blockers?: string | null
  } | null
  onClose: () => void
  onSaved: () => void
}

export default function StandupForm({ existingStandup, onClose, onSaved }: StandupFormProps) {
  const [yesterday, setYesterday] = useState(existingStandup?.yesterday || '')
  const [today, setToday] = useState(existingStandup?.today || '')
  const [blockers, setBlockers] = useState(existingStandup?.blockers || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEdit = !!existingStandup

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!yesterday.trim() || !today.trim()) {
      setError('Yesterday and Today fields are required.')
      return
    }

    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await dailyOpsApi.updateStandup(existingStandup!.id, {
          yesterday: yesterday.trim(),
          today: today.trim(),
          blockers: blockers.trim() || undefined,
        })
      } else {
        await dailyOpsApi.createStandup({
          yesterday: yesterday.trim(),
          today: today.trim(),
          blockers: blockers.trim() || undefined,
        })
      }
      onSaved()
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError('You already posted a standup today. Edit your existing one instead.')
      } else {
        setError('Failed to save standup. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6 mx-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {isEdit ? 'Edit Standup' : 'Post Standup'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Yesterday
            </label>
            <textarea
              value={yesterday}
              onChange={e => setYesterday(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What did you accomplish yesterday?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Today
            </label>
            <textarea
              value={today}
              onChange={e => setToday(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What are you planning to do today?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Blockers <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={blockers}
              onChange={e => setBlockers(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Anything blocking your progress?"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Post Standup'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/daily-ops/StandupForm.tsx
git commit -m "feat(daily-ops): add StandupForm modal component"
```

---

## Chunk 5: Frontend Tab Components

### Task 12: Create MyDayTab Component

**Files:**
- Create: `frontend/components/daily-ops/MyDayTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'
import PlannerItemRow from './PlannerItemRow'

interface AssignedItem {
  id: number
  type: string
  title: string
  priority?: string | null
  due_date?: string | null
  link: string
}

interface PlannerItem {
  id: number
  title: string
  is_completed: boolean
  sort_order: number
  date: string
}

interface MyDayTabProps {
  selectedDate: string
}

const SECTION_LABELS: Record<string, { label: string; icon: string }> = {
  conversations: { label: 'Assigned Conversations', icon: '💬' },
  tickets: { label: 'Open Tickets', icon: '🎫' },
  crm_tasks: { label: 'CRM Tasks Due', icon: '📊' },
  pms_tasks: { label: 'PMS Tasks Due', icon: '📁' },
  emails: { label: 'Unread Emails', icon: '📧' },
}

export default function MyDayTab({ selectedDate }: MyDayTabProps) {
  const [manualItems, setManualItems] = useState<PlannerItem[]>([])
  const [assignedItems, setAssignedItems] = useState<Record<string, AssignedItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [newGoal, setNewGoal] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const fetchPlanner = async () => {
    try {
      const res = await dailyOpsApi.getPlanner(selectedDate)
      setManualItems(res.data.manual_items || [])
      setAssignedItems(res.data.assigned_items || {})
    } catch (err) {
      console.error('Failed to load planner:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchPlanner()
  }, [selectedDate])

  const addGoal = async () => {
    if (!newGoal.trim()) return
    try {
      await dailyOpsApi.createPlannerItem({ title: newGoal.trim(), date: selectedDate })
      setNewGoal('')
      fetchPlanner()
    } catch (err) {
      console.error('Failed to add goal:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addGoal()
    }
  }

  const toggleSection = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Loading planner...</div>
  }

  return (
    <div className="space-y-6">
      {/* Manual Goals Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">📋 My Goals & Notes</h3>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newGoal}
            onChange={e => setNewGoal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a goal or note..."
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addGoal}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add
          </button>
        </div>

        <div className="space-y-2">
          {manualItems.map(item => (
            <PlannerItemRow
              key={item.id}
              id={item.id}
              title={item.title}
              isCompleted={item.is_completed}
              onUpdate={fetchPlanner}
              onDelete={fetchPlanner}
            />
          ))}
          {manualItems.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No goals added for today yet.</p>
          )}
        </div>
      </div>

      {/* Assigned Items Sections */}
      {Object.entries(SECTION_LABELS).map(([key, { label, icon }]) => {
        const items = assignedItems[key] || []
        const isCollapsed = collapsed[key]

        return (
          <div key={key}>
            <button
              onClick={() => toggleSection(key)}
              className="flex items-center gap-2 w-full text-left mb-2"
            >
              <span className="text-sm">{isCollapsed ? '▶' : '▼'}</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {icon} {label}
                <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  {items.length}
                </span>
              </h3>
            </button>

            {!isCollapsed && (
              <div className="space-y-1 ml-6">
                {items.map(item => (
                  <a
                    key={`${item.type}-${item.id}`}
                    href={item.link}
                    className="block p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-300 transition-colors"
                  >
                    <span>{item.title}</span>
                    {item.priority && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        item.priority === 'high' || item.priority === 'urgent'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}>
                        {item.priority}
                      </span>
                    )}
                  </a>
                ))}
                {items.length === 0 && (
                  <p className="text-sm text-gray-400 py-1">None</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/daily-ops/MyDayTab.tsx
git commit -m "feat(daily-ops): add MyDayTab component with manual goals and assigned items"
```

---

### Task 13: Create TeamStandupsTab Component

**Files:**
- Create: `frontend/components/daily-ops/TeamStandupsTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'
import { authAPI } from '@/lib/auth'
import StandupForm from './StandupForm'

interface Standup {
  id: number
  user_id: number
  user_name: string
  user_avatar?: string | null
  date: string
  yesterday: string
  today: string
  blockers?: string | null
  created_at: string
}

interface TeamStandupsTabProps {
  selectedDate: string
}

export default function TeamStandupsTab({ selectedDate }: TeamStandupsTabProps) {
  const [standups, setStandups] = useState<Standup[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editStandup, setEditStandup] = useState<Standup | null>(null)

  const currentUser = authAPI.getUser()

  const fetchStandups = async () => {
    try {
      const res = await dailyOpsApi.getStandups(selectedDate)
      setStandups(res.data || [])
    } catch (err) {
      console.error('Failed to load standups:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchStandups()
  }, [selectedDate])

  const myStandup = standups.find(s => s.user_id === currentUser?.id)
  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  const handleDelete = async (id: number) => {
    if (!confirm('Delete your standup?')) return
    try {
      await dailyOpsApi.deleteStandup(id)
      fetchStandups()
    } catch (err) {
      console.error('Failed to delete standup:', err)
    }
  }

  const handleSaved = () => {
    setShowForm(false)
    setEditStandup(null)
    fetchStandups()
  }

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Loading standups...</div>
  }

  return (
    <div className="space-y-4">
      {/* Post / Edit Button */}
      {isToday && (
        <div className="flex justify-end">
          {myStandup ? (
            <button
              onClick={() => { setEditStandup(myStandup); setShowForm(true) }}
              className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              ✏️ Edit My Standup
            </button>
          ) : (
            <button
              onClick={() => { setEditStandup(null); setShowForm(true) }}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              📝 Post My Standup
            </button>
          )}
        </div>
      )}

      {/* Standup Cards */}
      {standups.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No standups posted for this date.
        </div>
      ) : (
        <div className="space-y-3">
          {standups.map(s => (
            <div
              key={s.id}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-semibold text-blue-600 dark:text-blue-300">
                    {s.user_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{s.user_name}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                {s.user_id === currentUser?.id && isToday && (
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-gray-400 hover:text-red-500 text-sm"
                    title="Delete"
                  >
                    🗑️
                  </button>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-400">Yesterday:</span>
                  <p className="text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap">{s.yesterday}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-400">Today:</span>
                  <p className="text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap">{s.today}</p>
                </div>
                {s.blockers && (
                  <div>
                    <span className="font-medium text-red-500">Blockers:</span>
                    <p className="text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap">{s.blockers}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Standup Form Modal */}
      {showForm && (
        <StandupForm
          existingStandup={editStandup}
          onClose={() => { setShowForm(false); setEditStandup(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/daily-ops/TeamStandupsTab.tsx
git commit -m "feat(daily-ops): add TeamStandupsTab component with standup cards and form integration"
```

---

### Task 14: Create CommandCenterTab and CommandCenterConfig Components

**Files:**
- Create: `frontend/components/daily-ops/CommandCenterTab.tsx`
- Create: `frontend/components/daily-ops/CommandCenterConfig.tsx`

- [ ] **Step 1: Create CommandCenterTab**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'
import { hasPermission } from '@/lib/permissions'
import MetricCard from './MetricCard'
import CommandCenterConfig from './CommandCenterConfig'

interface Metric {
  metric_key: string
  label: string
  value: number
  threshold_value?: number | null
  is_exceeded: boolean
}

export default function CommandCenterTab() {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [loading, setLoading] = useState(true)
  const [showConfig, setShowConfig] = useState(false)

  const canManage = hasPermission('daily_ops', 'manage_command_center')

  const fetchMetrics = async () => {
    try {
      const res = await dailyOpsApi.getCommandCenter()
      setMetrics(res.data || [])
    } catch (err) {
      console.error('Failed to load metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchMetrics, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Loading command center...</div>
  }

  return (
    <div>
      {canManage && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setShowConfig(true)}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg"
          >
            ⚙️ Configure
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map(m => (
          <MetricCard
            key={m.metric_key}
            metricKey={m.metric_key}
            label={m.label}
            value={m.value}
            thresholdValue={m.threshold_value}
            isExceeded={m.is_exceeded}
          />
        ))}
      </div>

      {metrics.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          No metrics configured.
          {canManage && ' Click Configure to set up your dashboard.'}
        </div>
      )}

      {showConfig && (
        <CommandCenterConfig
          onClose={() => setShowConfig(false)}
          onSaved={() => { setShowConfig(false); fetchMetrics() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create CommandCenterConfig**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'

interface MetricConfig {
  metric_key: string
  label: string
  is_visible: boolean
  sort_order: number
  threshold_value?: number | null
}

interface CommandCenterConfigProps {
  onClose: () => void
  onSaved: () => void
}

export default function CommandCenterConfig({ onClose, onSaved }: CommandCenterConfigProps) {
  const [configs, setConfigs] = useState<MetricConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await dailyOpsApi.getCommandCenterConfig()
        setConfigs(res.data || [])
      } catch (err) {
        console.error('Failed to load config:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const toggleVisible = (key: string) => {
    setConfigs(prev => prev.map(c =>
      c.metric_key === key ? { ...c, is_visible: !c.is_visible } : c
    ))
  }

  const updateThreshold = (key: string, value: string) => {
    const numVal = value === '' ? null : parseInt(value)
    setConfigs(prev => prev.map(c =>
      c.metric_key === key ? { ...c, threshold_value: numVal } : c
    ))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await dailyOpsApi.updateCommandCenterConfig({ metrics: configs })
      onSaved()
    } catch (err) {
      console.error('Failed to save config:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6 mx-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          ⚙️ Configure Command Center
        </h2>

        <div className="space-y-3">
          {configs.map(c => (
            <div
              key={c.metric_key}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <label className="flex items-center gap-2 flex-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.is_visible}
                  onChange={() => toggleVisible(c.metric_key)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-800 dark:text-gray-200">{c.label}</span>
              </label>
              <input
                type="number"
                value={c.threshold_value ?? ''}
                onChange={e => updateThreshold(c.metric_key, e.target.value)}
                placeholder="Threshold"
                className="w-24 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/daily-ops/CommandCenterTab.tsx frontend/components/daily-ops/CommandCenterConfig.tsx
git commit -m "feat(daily-ops): add CommandCenterTab with metric cards and admin config modal"
```

---

## Chunk 6: Main Page & Final Wiring

### Task 15: Create the Daily Ops Page

**Files:**
- Create: `frontend/app/daily-ops/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MyDayTab from '@/components/daily-ops/MyDayTab'
import TeamStandupsTab from '@/components/daily-ops/TeamStandupsTab'
import CommandCenterTab from '@/components/daily-ops/CommandCenterTab'

type Tab = 'my-day' | 'standups' | 'command-center'

export default function DailyOpsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('my-day')
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my-day', label: 'My Day' },
    { key: 'standups', label: 'Team Standups' },
    { key: 'command-center', label: 'Command Center' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Daily Ops</h1>
          {activeTab !== 'command-center' && (
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'my-day' && <MyDayTab selectedDate={selectedDate} />}
        {activeTab === 'standups' && <TeamStandupsTab selectedDate={selectedDate} />}
        {activeTab === 'command-center' && <CommandCenterTab />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/daily-ops/page.tsx
git commit -m "feat(daily-ops): add main Daily Ops page with tab navigation"
```

---

### Task 16: Verify Backend Starts Without Errors

- [ ] **Step 1: Start the backend and check for import/model errors**

```bash
cd backend && source venv/bin/activate && python -c "from app.models.daily_ops import StandupEntry, DailyPlannerItem, CommandCenterConfig; print('Models OK')"
```

Expected: `Models OK`

- [ ] **Step 2: Start the server briefly to verify router registration**

```bash
cd backend && source venv/bin/activate && timeout 5 uvicorn main:app --host 0.0.0.0 --port 8000 2>&1 | head -20
```

Expected: Server starts without import errors. Look for `Application startup complete`.

- [ ] **Step 3: Check API docs include daily-ops endpoints**

Visit http://localhost:8000/docs and confirm the `daily-ops` tag appears with all endpoints:
- GET `/daily-ops/standups`
- POST `/daily-ops/standups`
- PATCH `/daily-ops/standups/{standup_id}`
- DELETE `/daily-ops/standups/{standup_id}`
- GET `/daily-ops/planner`
- POST `/daily-ops/planner`
- PATCH `/daily-ops/planner/{item_id}`
- DELETE `/daily-ops/planner/{item_id}`
- GET `/daily-ops/command-center`
- GET `/daily-ops/command-center/config`
- PUT `/daily-ops/command-center/config`

---

### Task 17: Verify Frontend Compiles Without Errors

- [ ] **Step 1: Check TypeScript compilation**

```bash
cd frontend && npx next build 2>&1 | tail -30
```

Expected: Build completes without TypeScript errors. The daily-ops page should appear in the build output.

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat(daily-ops): complete Daily Ops module — planner, standups, command center"
```
