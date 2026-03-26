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
    type: str
    title: str
    priority: Optional[str] = None
    due_date: Optional[date] = None
    link: str


class PlannerResponse(BaseModel):
    manual_items: List[PlannerItemResponse]
    assigned_items: Dict[str, List[AssignedItem]]


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
