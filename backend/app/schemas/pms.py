from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


# ── Project ──────────────────────────────────────────────
class PMSProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    status: str = "planning"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    color: str = "#6366f1"
    team_id: Optional[int] = None

class PMSProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    color: Optional[str] = None
    team_id: Optional[int] = None

class PMSProjectMemberOut(BaseModel):
    id: int
    user_id: int
    role: str
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    class Config: from_attributes = True

class PMSProjectOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    status: str
    start_date: Optional[date]
    end_date: Optional[date]
    color: str
    owner_id: Optional[int]
    team_id: Optional[int]
    created_at: datetime
    members: List[PMSProjectMemberOut] = []
    class Config: from_attributes = True


# ── Member ────────────────────────────────────────────────
class PMSMemberAdd(BaseModel):
    user_id: int
    role: str = "developer"


# ── Milestone ─────────────────────────────────────────────
class PMSMilestoneCreate(BaseModel):
    name: str
    due_date: Optional[date] = None
    status: str = "pending"
    color: str = "#f59e0b"

class PMSMilestoneUpdate(BaseModel):
    name: Optional[str] = None
    due_date: Optional[date] = None
    status: Optional[str] = None
    color: Optional[str] = None

class PMSMilestoneOut(BaseModel):
    id: int
    project_id: int
    name: str
    due_date: Optional[date]
    status: str
    color: str
    class Config: from_attributes = True


# ── Task ──────────────────────────────────────────────────
class PMSTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    milestone_id: Optional[int] = None
    parent_task_id: Optional[int] = None
    priority: str = "medium"
    assignee_id: Optional[int] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    estimated_hours: float = 0
    ticket_id: Optional[int] = None
    crm_deal_id: Optional[int] = None

class PMSTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    milestone_id: Optional[int] = None
    priority: Optional[str] = None
    assignee_id: Optional[int] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    estimated_hours: Optional[float] = None
    position: Optional[int] = None

class PMSTaskLabelOut(BaseModel):
    id: int
    name: str
    color: str
    class Config: from_attributes = True

class PMSTaskOut(BaseModel):
    id: int
    project_id: int
    milestone_id: Optional[int]
    parent_task_id: Optional[int]
    title: str
    description: Optional[str]
    stage: str
    priority: str
    assignee_id: Optional[int]
    assignee_name: Optional[str] = None
    start_date: Optional[date]
    due_date: Optional[date]
    estimated_hours: float
    actual_hours: float
    position: int
    ticket_id: Optional[int]
    crm_deal_id: Optional[int]
    labels: List[PMSTaskLabelOut] = []
    subtask_count: int = 0
    created_at: datetime
    updated_at: datetime
    class Config: from_attributes = True


# ── Workflow ──────────────────────────────────────────────
class PMSTransitionRequest(BaseModel):
    to_stage: str
    note: Optional[str] = None

class PMSWorkflowHistoryOut(BaseModel):
    id: int
    from_stage: Optional[str]
    to_stage: str
    moved_by: Optional[int]
    actor_name: Optional[str] = None
    note: Optional[str]
    created_at: datetime
    class Config: from_attributes = True


# ── Dependency ────────────────────────────────────────────
class PMSDependencyCreate(BaseModel):
    depends_on_id: int
    type: str = "finish_to_start"

class PMSDependencyOut(BaseModel):
    id: int
    task_id: int
    depends_on_id: int
    type: str
    class Config: from_attributes = True


# ── Comment ───────────────────────────────────────────────
class PMSCommentCreate(BaseModel):
    content: str

class PMSCommentOut(BaseModel):
    id: int
    task_id: int
    user_id: Optional[int]
    user_name: Optional[str] = None
    content: str
    created_at: datetime
    class Config: from_attributes = True


# ── Time Log ──────────────────────────────────────────────
class PMSTimeLogCreate(BaseModel):
    hours: float
    log_date: Optional[date] = None
    note: Optional[str] = None

class PMSTimeLogOut(BaseModel):
    id: int
    task_id: int
    user_id: Optional[int]
    user_name: Optional[str] = None
    hours: float
    log_date: Optional[date]
    note: Optional[str]
    created_at: datetime
    class Config: from_attributes = True


# ── Alert ─────────────────────────────────────────────────
class PMSAlertOut(BaseModel):
    id: int
    task_id: Optional[int]
    project_id: Optional[int]
    type: str
    message: str
    is_read: bool
    created_at: datetime
    class Config: from_attributes = True


# ── Gantt ─────────────────────────────────────────────────
class PMSGanttDependency(BaseModel):
    id: int
    task_id: int
    depends_on_id: int
    type: str

class PMSGanttTask(BaseModel):
    id: int
    title: str
    stage: str
    priority: str
    start_date: Optional[date]
    due_date: Optional[date]
    milestone_id: Optional[int]
    parent_task_id: Optional[int]
    assignee_id: Optional[int]
    assignee_name: Optional[str]
    estimated_hours: float
    actual_hours: float
    dependencies: List[PMSGanttDependency] = []

class PMSGanttPayload(BaseModel):
    project: PMSProjectOut
    milestones: List[PMSMilestoneOut]
    tasks: List[PMSGanttTask]
