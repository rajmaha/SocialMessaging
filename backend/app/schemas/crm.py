from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime
from typing import Optional
import re
from app.models.crm import LeadStatus, LeadSource, DealStage, TaskStatus, ActivityType


# ========== LEAD SCHEMAS ==========

class LeadCreate(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    position: Optional[str] = None
    address: Optional[str] = None
    inquiry_for: Optional[str] = None
    remarks: Optional[str] = None
    status: Optional[LeadStatus] = LeadStatus.NEW
    source: Optional[LeadSource] = LeadSource.OTHER
    assigned_to: Optional[int] = None
    estimated_value: Optional[float] = None
    conversation_id: Optional[int] = None
    organization_id: Optional[int] = None
    tags: Optional[list[str]] = []

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, v):
        if v is None:
            return v
        digits = re.sub(r'\D', '', v)
        if len(digits) < 7 or len(digits) > 15:
            raise ValueError('Phone number must have 7-15 digits')
        return v


class LeadUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    position: Optional[str] = None
    address: Optional[str] = None
    inquiry_for: Optional[str] = None
    remarks: Optional[str] = None
    status: Optional[LeadStatus] = None
    source: Optional[LeadSource] = None
    assigned_to: Optional[int] = None
    estimated_value: Optional[float] = None
    score: Optional[int] = None
    tags: Optional[list[str]] = None
    organization_id: Optional[int] = None

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, v):
        if v is None:
            return v
        digits = re.sub(r'\D', '', v)
        if len(digits) < 7 or len(digits) > 15:
            raise ValueError('Phone number must have 7-15 digits')
        return v


class LeadResponse(BaseModel):
    id: int
    first_name: str
    last_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    company: Optional[str]
    position: Optional[str]
    address: Optional[str]
    inquiry_for: Optional[str]
    remarks: Optional[str]
    status: LeadStatus
    source: LeadSource
    assigned_to: Optional[int]
    score: int
    qualification: Optional[str] = "cold"
    estimated_value: Optional[float]
    conversation_id: Optional[int]
    organization_id: Optional[int]
    organization_name: Optional[str] = None
    tags: Optional[list[str]] = []
    email_valid: Optional[bool] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ========== DEAL SCHEMAS ==========

class DealCreate(BaseModel):
    lead_id: int
    name: str
    description: Optional[str] = None
    stage: Optional[DealStage] = DealStage.PROSPECT
    amount: Optional[float] = None
    probability: Optional[int] = 50
    expected_close_date: Optional[datetime] = None
    assigned_to: Optional[int] = None
    currency: Optional[str] = "USD"


class DealUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    stage: Optional[DealStage] = None
    amount: Optional[float] = None
    probability: Optional[int] = None
    expected_close_date: Optional[datetime] = None
    assigned_to: Optional[int] = None
    currency: Optional[str] = None


class DealResponse(BaseModel):
    id: int
    lead_id: int
    name: str
    description: Optional[str]
    stage: DealStage
    amount: Optional[float]
    probability: int
    currency: Optional[str] = "USD"
    expected_close_date: Optional[datetime]
    closed_at: Optional[datetime]
    assigned_to: Optional[int]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ========== TASK SCHEMAS ==========

class TaskCreate(BaseModel):
    lead_id: int
    deal_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    status: Optional[TaskStatus] = TaskStatus.OPEN
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None


class TaskResponse(BaseModel):
    id: int
    lead_id: int
    deal_id: Optional[int]
    title: str
    description: Optional[str]
    status: TaskStatus
    assigned_to: Optional[int]
    due_date: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ========== ACTIVITY SCHEMAS ==========

class ActivityCreate(BaseModel):
    lead_id: int
    type: ActivityType
    title: str
    description: Optional[str] = None
    message_id: Optional[int] = None


class ActivityResponse(BaseModel):
    id: int
    lead_id: int
    type: ActivityType
    title: str
    description: Optional[str]
    message_id: Optional[int]
    created_by: Optional[int]
    created_at: datetime
    activity_date: datetime

    class Config:
        from_attributes = True


# ========== COMPOSITE RESPONSES ==========

class LeadDetailResponse(LeadResponse):
    """Lead with deals, tasks, and recent activities"""
    deals: list[DealResponse] = []
    tasks: list[TaskResponse] = []
    activities: list[ActivityResponse] = []


class DealDetailResponse(DealResponse):
    """Deal with lead info, tasks, and activities"""
    lead: Optional[LeadResponse] = None
    tasks: list[TaskResponse] = []
    activities: list[ActivityResponse] = []


# ========== NOTE SCHEMAS ==========

class NoteCreate(BaseModel):
    content: str
    is_pinned: Optional[bool] = False

class NoteUpdate(BaseModel):
    content: Optional[str] = None
    is_pinned: Optional[bool] = None

class NoteResponse(BaseModel):
    id: int
    lead_id: int
    content: str
    is_pinned: bool
    created_by: int
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ========== AUDIT LOG SCHEMAS ==========

class AuditLogResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    field_name: str
    old_value: Optional[str]
    new_value: Optional[str]
    changed_by: int
    changed_by_name: Optional[str] = None
    changed_at: datetime

    class Config:
        from_attributes = True


# ========== WORKFLOW RULE SCHEMAS ==========

class WorkflowRuleCreate(BaseModel):
    name: str
    is_active: Optional[bool] = True
    trigger_type: str  # deal_stage_change, lead_status_change, task_overdue
    conditions: Optional[dict] = {}
    action_type: str  # create_task, change_status, send_notification
    action_config: Optional[dict] = {}


class WorkflowRuleUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    trigger_type: Optional[str] = None
    conditions: Optional[dict] = None
    action_type: Optional[str] = None
    action_config: Optional[dict] = None


class WorkflowRuleResponse(BaseModel):
    id: int
    name: str
    is_active: bool
    trigger_type: str
    conditions: Optional[dict] = {}
    action_type: str
    action_config: Optional[dict] = {}
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ========== IMPORT SCHEMAS ==========

class ImportResult(BaseModel):
    imported: int
    errors: list[dict]
    total_rows: int
