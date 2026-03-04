# PMS with Gantt Chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full Project Management System with interactive SVG Gantt chart as a new module inside the existing SocialMedia Unified Inbox admin panel.

**Architecture:** Custom SVG Gantt (react-dnd + SVG), FastAPI backend with role-based workflow state machine, PostgreSQL via inline SQL migrations. No external Gantt library — full custom implementation.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, Next.js 14 App Router, TailwindCSS, react-dnd, SVG

**Note on Testing:** This project has no pytest/Jest setup. Verify backend routes via Swagger at http://localhost:8000/docs. Verify frontend via browser at http://localhost:3000.

---

## Phase 1: Database Migrations & Models

### Task 1: Add PMS inline SQL migrations to main.py

**Files:**
- Modify: `backend/main.py` (inside `_run_inline_migrations()`)

**Step 1: Add PMS table migrations**

Find the `_run_inline_migrations()` function and add before the final `conn.commit()`:

```python
# PMS Tables
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL,
        description TEXT,
        status VARCHAR DEFAULT 'planning',
        start_date DATE,
        end_date DATE,
        color VARCHAR DEFAULT '#6366f1',
        owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_project_members (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES pms_projects(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR DEFAULT 'developer',
        added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        added_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, user_id)
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_milestones (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES pms_projects(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        due_date DATE,
        status VARCHAR DEFAULT 'pending',
        color VARCHAR DEFAULT '#f59e0b'
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_tasks (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES pms_projects(id) ON DELETE CASCADE,
        milestone_id INTEGER REFERENCES pms_milestones(id) ON DELETE SET NULL,
        parent_task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        title VARCHAR NOT NULL,
        description TEXT,
        stage VARCHAR DEFAULT 'development',
        priority VARCHAR DEFAULT 'medium',
        assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        start_date DATE,
        due_date DATE,
        estimated_hours FLOAT DEFAULT 0,
        actual_hours FLOAT DEFAULT 0,
        position INTEGER DEFAULT 0,
        ticket_id INTEGER,
        crm_deal_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_task_dependencies (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        depends_on_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        type VARCHAR DEFAULT 'finish_to_start',
        UNIQUE(task_id, depends_on_id)
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_task_comments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_task_timelogs (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        hours FLOAT NOT NULL,
        log_date DATE DEFAULT CURRENT_DATE,
        note VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_task_attachments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        file_path VARCHAR NOT NULL,
        file_name VARCHAR NOT NULL,
        file_size INTEGER DEFAULT 0,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_task_labels (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        color VARCHAR DEFAULT '#6366f1'
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_workflow_history (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        from_stage VARCHAR,
        to_stage VARCHAR NOT NULL,
        moved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_alerts (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES pms_tasks(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES pms_projects(id) ON DELETE CASCADE,
        type VARCHAR NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        notified_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))
```

**Step 2: Restart backend and verify tables exist**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Run in psql: `\dt pms_*` — expect 11 tables listed.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(pms): add PMS table migrations"
```

---

### Task 2: Create SQLAlchemy models

**Files:**
- Create: `backend/app/models/pms.py`

**Step 1: Write the models file**

```python
from sqlalchemy import Column, Integer, String, Text, Boolean, Float, Date, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from app.database import Base


class PMSProject(Base):
    __tablename__ = "pms_projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    status = Column(String, default="planning")  # planning|active|on_hold|completed
    start_date = Column(Date)
    end_date = Column(Date)
    color = Column(String, default="#6366f1")
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("PMSProjectMember", back_populates="project", cascade="all, delete-orphan")
    milestones = relationship("PMSMilestone", back_populates="project", cascade="all, delete-orphan")
    tasks = relationship("PMSTask", back_populates="project", cascade="all, delete-orphan")


class PMSProjectMember(Base):
    __tablename__ = "pms_project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    role = Column(String, default="developer")  # developer|qa|pm|client|viewer
    added_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    added_at = Column(DateTime, server_default=func.now())

    project = relationship("PMSProject", back_populates="members")
    user = relationship("User", foreign_keys=[user_id])


class PMSMilestone(Base):
    __tablename__ = "pms_milestones"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    due_date = Column(Date)
    status = Column(String, default="pending")  # pending|reached|missed
    color = Column(String, default="#f59e0b")

    project = relationship("PMSProject", back_populates="milestones")
    tasks = relationship("PMSTask", back_populates="milestone")


class PMSTask(Base):
    __tablename__ = "pms_tasks"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    milestone_id = Column(Integer, ForeignKey("pms_milestones.id", ondelete="SET NULL"), nullable=True)
    parent_task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    stage = Column(String, default="development")
    priority = Column(String, default="medium")
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    start_date = Column(Date)
    due_date = Column(Date)
    estimated_hours = Column(Float, default=0)
    actual_hours = Column(Float, default=0)
    position = Column(Integer, default=0)
    ticket_id = Column(Integer, nullable=True)
    crm_deal_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    project = relationship("PMSProject", back_populates="tasks")
    milestone = relationship("PMSMilestone", back_populates="tasks")
    assignee = relationship("User", foreign_keys=[assignee_id])
    subtasks = relationship("PMSTask", back_populates="parent", foreign_keys=[parent_task_id])
    parent = relationship("PMSTask", back_populates="subtasks", remote_side=[id])
    dependencies = relationship("PMSTaskDependency", foreign_keys="PMSTaskDependency.task_id", cascade="all, delete-orphan")
    comments = relationship("PMSTaskComment", back_populates="task", cascade="all, delete-orphan")
    timelogs = relationship("PMSTaskTimeLog", back_populates="task", cascade="all, delete-orphan")
    attachments = relationship("PMSTaskAttachment", back_populates="task", cascade="all, delete-orphan")
    labels = relationship("PMSTaskLabel", back_populates="task", cascade="all, delete-orphan")
    workflow_history = relationship("PMSWorkflowHistory", back_populates="task", cascade="all, delete-orphan")


class PMSTaskDependency(Base):
    __tablename__ = "pms_task_dependencies"
    __table_args__ = (UniqueConstraint("task_id", "depends_on_id"),)
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    depends_on_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    type = Column(String, default="finish_to_start")


class PMSTaskComment(Base):
    __tablename__ = "pms_task_comments"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="comments")
    user = relationship("User", foreign_keys=[user_id])


class PMSTaskTimeLog(Base):
    __tablename__ = "pms_task_timelogs"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    hours = Column(Float, nullable=False)
    log_date = Column(Date, server_default=func.current_date())
    note = Column(String)
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="timelogs")
    user = relationship("User", foreign_keys=[user_id])


class PMSTaskAttachment(Base):
    __tablename__ = "pms_task_attachments"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="attachments")


class PMSTaskLabel(Base):
    __tablename__ = "pms_task_labels"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    color = Column(String, default="#6366f1")

    task = relationship("PMSTask", back_populates="labels")


class PMSWorkflowHistory(Base):
    __tablename__ = "pms_workflow_history"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    from_stage = Column(String)
    to_stage = Column(String, nullable=False)
    moved_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    note = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("PMSTask", back_populates="workflow_history")
    actor = relationship("User", foreign_keys=[moved_by])


class PMSAlert(Base):
    __tablename__ = "pms_alerts"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("pms_tasks.id", ondelete="CASCADE"))
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    type = Column(String, nullable=False)  # overdue|over_hours|stage_transition|assigned
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    notified_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    created_at = Column(DateTime, server_default=func.now())
```

**Step 2: Import model in main.py**

Add to imports at top of `main.py`:
```python
from app.models import pms  # noqa: F401 — registers PMS models with SQLAlchemy
```

**Step 3: Commit**

```bash
git add backend/app/models/pms.py backend/main.py
git commit -m "feat(pms): add SQLAlchemy ORM models"
```

---

## Phase 2: Backend Schemas

### Task 3: Create Pydantic schemas

**Files:**
- Create: `backend/app/schemas/pms.py`

```python
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
    id: int; name: str; color: str
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
    id: int; task_id: int; depends_on_id: int; type: str
    class Config: from_attributes = True


# ── Comment ───────────────────────────────────────────────
class PMSCommentCreate(BaseModel):
    content: str

class PMSCommentOut(BaseModel):
    id: int; task_id: int; user_id: Optional[int]
    user_name: Optional[str] = None
    content: str; created_at: datetime
    class Config: from_attributes = True


# ── Time Log ──────────────────────────────────────────────
class PMSTimeLogCreate(BaseModel):
    hours: float
    log_date: Optional[date] = None
    note: Optional[str] = None

class PMSTimeLogOut(BaseModel):
    id: int; task_id: int; user_id: Optional[int]
    user_name: Optional[str] = None
    hours: float; log_date: Optional[date]; note: Optional[str]
    created_at: datetime
    class Config: from_attributes = True


# ── Alert ─────────────────────────────────────────────────
class PMSAlertOut(BaseModel):
    id: int; task_id: Optional[int]; project_id: Optional[int]
    type: str; message: str; is_read: bool; created_at: datetime
    class Config: from_attributes = True


# ── Gantt ─────────────────────────────────────────────────
class PMSGanttDependency(BaseModel):
    id: int; task_id: int; depends_on_id: int; type: str

class PMSGanttTask(BaseModel):
    id: int; title: str; stage: str; priority: str
    start_date: Optional[date]; due_date: Optional[date]
    milestone_id: Optional[int]; parent_task_id: Optional[int]
    assignee_id: Optional[int]; assignee_name: Optional[str]
    estimated_hours: float; actual_hours: float
    dependencies: List[PMSGanttDependency] = []

class PMSGanttPayload(BaseModel):
    project: PMSProjectOut
    milestones: List[PMSMilestoneOut]
    tasks: List[PMSGanttTask]
```

**Commit:**
```bash
git add backend/app/schemas/pms.py
git commit -m "feat(pms): add Pydantic schemas"
```

---

## Phase 3: Backend Routes

### Task 4: Create PMS router — projects & members

**Files:**
- Create: `backend/app/routes/pms.py`

```python
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
from datetime import date, datetime
import os, shutil

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.pms import (
    PMSProject, PMSProjectMember, PMSMilestone, PMSTask,
    PMSTaskDependency, PMSTaskComment, PMSTaskTimeLog,
    PMSTaskAttachment, PMSTaskLabel, PMSWorkflowHistory, PMSAlert
)
from app.schemas.pms import *

router = APIRouter(prefix="/api/pms", tags=["pms"])

ATTACHMENT_DIR = "app/attachment_storage/pms"
os.makedirs(ATTACHMENT_DIR, exist_ok=True)

# ── Helpers ───────────────────────────────────────────────

def _is_admin(user: User) -> bool:
    return user.role == "admin"

def _get_membership(db, project_id: int, user_id: int) -> Optional[PMSProjectMember]:
    return db.query(PMSProjectMember).filter_by(project_id=project_id, user_id=user_id).first()

def _require_member(db, project_id: int, user: User) -> PMSProjectMember:
    if _is_admin(user):
        # Return a fake membership with pm role for admins
        m = PMSProjectMember(); m.role = "pm"; return m
    m = _get_membership(db, project_id, user.id)
    if not m:
        raise HTTPException(status_code=403, detail="Not a project member")
    return m

WORKFLOW_TRANSITIONS = {
    "development": {"qa": ["developer", "pm", "admin"]},
    "qa": {
        "pm_review": ["qa", "pm", "admin"],
        "development": ["qa", "pm", "admin"],
    },
    "pm_review": {
        "client_review": ["pm", "admin"],
        "development": ["pm", "admin"],
    },
    "client_review": {
        "approved": ["pm", "admin", "client"],
        "development": ["pm", "admin", "client"],
    },
    "approved": {"completed": ["pm", "admin"]},
}

def _enrich_task(task: PMSTask, db: Session) -> dict:
    d = {c.name: getattr(task, c.name) for c in task.__table__.columns}
    d["assignee_name"] = task.assignee.full_name if task.assignee else None
    d["labels"] = [{"id": l.id, "name": l.name, "color": l.color} for l in task.labels]
    d["subtask_count"] = db.query(PMSTask).filter_by(parent_task_id=task.id).count()
    return d

# ── Projects ──────────────────────────────────────────────

@router.get("/projects", response_model=List[PMSProjectOut])
def list_projects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if _is_admin(current_user):
        projects = db.query(PMSProject).all()
    else:
        memberships = db.query(PMSProjectMember).filter_by(user_id=current_user.id).all()
        project_ids = [m.project_id for m in memberships]
        projects = db.query(PMSProject).filter(PMSProject.id.in_(project_ids)).all()
    result = []
    for p in projects:
        d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        d["members"] = [
            {"id": m.id, "user_id": m.user_id, "role": m.role,
             "user_name": m.user.full_name if m.user else None,
             "user_email": m.user.email if m.user else None}
            for m in p.members
        ]
        result.append(d)
    return result

@router.post("/projects", response_model=PMSProjectOut)
def create_project(data: PMSProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admins only")
    p = PMSProject(**data.dict(), owner_id=current_user.id)
    db.add(p)
    db.flush()
    # Auto-add creator as PM member
    db.add(PMSProjectMember(project_id=p.id, user_id=current_user.id, role="pm", added_by=current_user.id))
    db.commit(); db.refresh(p)
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["members"] = []
    return d

@router.get("/projects/{project_id}", response_model=PMSProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    _require_member(db, project_id, current_user)
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["members"] = [
        {"id": m.id, "user_id": m.user_id, "role": m.role,
         "user_name": m.user.full_name if m.user else None,
         "user_email": m.user.email if m.user else None}
        for m in p.members
    ]
    return d

@router.put("/projects/{project_id}", response_model=PMSProjectOut)
def update_project(project_id: int, data: PMSProjectUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p: raise HTTPException(404)
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm", "admin") and not _is_admin(current_user):
        raise HTTPException(403, "PM or admin only")
    for k, v in data.dict(exclude_none=True).items():
        setattr(p, k, v)
    db.commit(); db.refresh(p)
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["members"] = []
    return d

@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user): raise HTTPException(403)
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p: raise HTTPException(404)
    db.delete(p); db.commit()
    return {"ok": True}

# ── Members ───────────────────────────────────────────────

@router.get("/projects/{project_id}/members", response_model=List[PMSProjectMemberOut])
def list_members(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    members = db.query(PMSProjectMember).filter_by(project_id=project_id).all()
    return [{"id": m.id, "user_id": m.user_id, "role": m.role,
             "user_name": m.user.full_name if m.user else None,
             "user_email": m.user.email if m.user else None} for m in members]

@router.post("/projects/{project_id}/members")
def add_member(project_id: int, data: PMSMemberAdd, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403, "PM or admin only")
    existing = _get_membership(db, project_id, data.user_id)
    if existing:
        existing.role = data.role; db.commit()
        return {"ok": True, "updated": True}
    db.add(PMSProjectMember(project_id=project_id, user_id=data.user_id, role=data.role, added_by=current_user.id))
    db.commit()
    return {"ok": True}

@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: int, user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403)
    mem = _get_membership(db, project_id, user_id)
    if not mem: raise HTTPException(404)
    db.delete(mem); db.commit()
    return {"ok": True}
```

**Commit:**
```bash
git add backend/app/routes/pms.py
git commit -m "feat(pms): add project and member routes"
```

---

### Task 5: Add milestones, tasks, and workflow routes to pms.py

**Files:**
- Modify: `backend/app/routes/pms.py`

Append to the file:

```python
# ── Milestones ────────────────────────────────────────────

@router.get("/projects/{project_id}/milestones", response_model=List[PMSMilestoneOut])
def list_milestones(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    return db.query(PMSMilestone).filter_by(project_id=project_id).all()

@router.post("/projects/{project_id}/milestones", response_model=PMSMilestoneOut)
def create_milestone(project_id: int, data: PMSMilestoneCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user): raise HTTPException(403)
    ms = PMSMilestone(**data.dict(), project_id=project_id)
    db.add(ms); db.commit(); db.refresh(ms)
    return ms

@router.put("/milestones/{milestone_id}", response_model=PMSMilestoneOut)
def update_milestone(milestone_id: int, data: PMSMilestoneUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ms = db.query(PMSMilestone).filter_by(id=milestone_id).first()
    if not ms: raise HTTPException(404)
    _require_member(db, ms.project_id, current_user)
    for k, v in data.dict(exclude_none=True).items(): setattr(ms, k, v)
    db.commit(); db.refresh(ms); return ms

@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ms = db.query(PMSMilestone).filter_by(id=milestone_id).first()
    if not ms: raise HTTPException(404)
    m = _require_member(db, ms.project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user): raise HTTPException(403)
    db.delete(ms); db.commit(); return {"ok": True}

# ── Tasks ─────────────────────────────────────────────────

@router.get("/projects/{project_id}/tasks")
def list_tasks(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    tasks = db.query(PMSTask).filter_by(project_id=project_id).order_by(PMSTask.position).all()
    return [_enrich_task(t, db) for t in tasks]

@router.post("/projects/{project_id}/tasks")
def create_task(project_id: int, data: PMSTaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    if data.assignee_id:
        if not _get_membership(db, project_id, data.assignee_id) and not _is_admin(current_user):
            raise HTTPException(400, "Assignee must be a project member")
    count = db.query(PMSTask).filter_by(project_id=project_id).count()
    task = PMSTask(**data.dict(), project_id=project_id, position=count)
    db.add(task); db.flush()
    db.add(PMSWorkflowHistory(task_id=task.id, from_stage=None, to_stage="development", moved_by=current_user.id, note="Task created"))
    db.commit(); db.refresh(task)
    return _enrich_task(task, db)

@router.get("/tasks/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    return _enrich_task(task, db)

@router.put("/tasks/{task_id}")
def update_task(task_id: int, data: PMSTaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    if data.assignee_id:
        if not _get_membership(db, task.project_id, data.assignee_id) and not _is_admin(current_user):
            raise HTTPException(400, "Assignee must be a project member")
    for k, v in data.dict(exclude_none=True).items(): setattr(task, k, v)
    db.commit(); db.refresh(task)
    return _enrich_task(task, db)

@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    m = _require_member(db, task.project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user): raise HTTPException(403)
    db.delete(task); db.commit(); return {"ok": True}

# ── Workflow ──────────────────────────────────────────────

@router.post("/tasks/{task_id}/transition")
def transition_task(task_id: int, data: PMSTransitionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    m = _require_member(db, task.project_id, current_user)
    allowed = WORKFLOW_TRANSITIONS.get(task.stage, {}).get(data.to_stage, [])
    if not allowed: raise HTTPException(400, f"No transition from {task.stage} to {data.to_stage}")
    if m.role not in allowed and not _is_admin(current_user):
        raise HTTPException(403, f"Role '{m.role}' cannot perform this transition")
    old_stage = task.stage
    task.stage = data.to_stage
    db.add(PMSWorkflowHistory(task_id=task.id, from_stage=old_stage, to_stage=data.to_stage, moved_by=current_user.id, note=data.note))
    db.commit()
    return {"ok": True, "stage": task.stage}

@router.get("/tasks/{task_id}/history", response_model=List[PMSWorkflowHistoryOut])
def get_task_history(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    history = db.query(PMSWorkflowHistory).filter_by(task_id=task_id).order_by(PMSWorkflowHistory.created_at).all()
    return [{"id": h.id, "from_stage": h.from_stage, "to_stage": h.to_stage,
             "moved_by": h.moved_by, "actor_name": h.actor.full_name if h.actor else None,
             "note": h.note, "created_at": h.created_at} for h in history]
```

**Commit:**
```bash
git add backend/app/routes/pms.py
git commit -m "feat(pms): add milestone, task, and workflow routes"
```

---

### Task 6: Add dependencies, comments, timelogs, attachments, alerts, gantt routes

**Files:**
- Modify: `backend/app/routes/pms.py`

Append:

```python
# ── Dependencies ──────────────────────────────────────────

@router.post("/tasks/{task_id}/dependencies")
def add_dependency(task_id: int, data: PMSDependencyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    if task_id == data.depends_on_id: raise HTTPException(400, "Cannot depend on self")
    dep = PMSTaskDependency(task_id=task_id, depends_on_id=data.depends_on_id, type=data.type)
    db.add(dep); db.commit(); db.refresh(dep)
    return {"id": dep.id, "task_id": dep.task_id, "depends_on_id": dep.depends_on_id, "type": dep.type}

@router.delete("/dependencies/{dep_id}")
def remove_dependency(dep_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    dep = db.query(PMSTaskDependency).filter_by(id=dep_id).first()
    if not dep: raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=dep.task_id).first()
    _require_member(db, task.project_id, current_user)
    db.delete(dep); db.commit(); return {"ok": True}

# ── Comments ──────────────────────────────────────────────

@router.get("/tasks/{task_id}/comments", response_model=List[PMSCommentOut])
def list_comments(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    comments = db.query(PMSTaskComment).filter_by(task_id=task_id).order_by(PMSTaskComment.created_at).all()
    return [{"id": c.id, "task_id": c.task_id, "user_id": c.user_id,
             "user_name": c.user.full_name if c.user else None,
             "content": c.content, "created_at": c.created_at} for c in comments]

@router.post("/tasks/{task_id}/comments", response_model=PMSCommentOut)
def create_comment(task_id: int, data: PMSCommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    c = PMSTaskComment(task_id=task_id, user_id=current_user.id, content=data.content)
    db.add(c); db.commit(); db.refresh(c)
    return {"id": c.id, "task_id": c.task_id, "user_id": c.user_id,
            "user_name": current_user.full_name, "content": c.content, "created_at": c.created_at}

@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(PMSTaskComment).filter_by(id=comment_id).first()
    if not c: raise HTTPException(404)
    if c.user_id != current_user.id and not _is_admin(current_user): raise HTTPException(403)
    db.delete(c); db.commit(); return {"ok": True}

# ── Time Logs ─────────────────────────────────────────────

@router.get("/tasks/{task_id}/timelogs", response_model=List[PMSTimeLogOut])
def list_timelogs(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    logs = db.query(PMSTaskTimeLog).filter_by(task_id=task_id).order_by(PMSTaskTimeLog.created_at).all()
    return [{"id": l.id, "task_id": l.task_id, "user_id": l.user_id,
             "user_name": l.user.full_name if l.user else None,
             "hours": l.hours, "log_date": l.log_date, "note": l.note, "created_at": l.created_at} for l in logs]

@router.post("/tasks/{task_id}/timelogs")
def log_time(task_id: int, data: PMSTimeLogCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    log = PMSTaskTimeLog(task_id=task_id, user_id=current_user.id, hours=data.hours, note=data.note,
                         log_date=data.log_date or date.today())
    db.add(log); db.flush()
    # Recompute actual_hours
    total = db.query(sqlfunc.sum(PMSTaskTimeLog.hours)).filter_by(task_id=task_id).scalar() or 0
    task.actual_hours = total
    over_hours = task.estimated_hours > 0 and total > task.estimated_hours
    db.commit()
    if over_hours:
        _fire_alert(db, task, "over_hours", f"Task '{task.title}' has exceeded estimated hours ({task.estimated_hours}h). Logged: {total:.1f}h")
    return {"ok": True, "actual_hours": total, "over_hours": over_hours}

@router.delete("/timelogs/{log_id}")
def delete_timelog(log_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    log = db.query(PMSTaskTimeLog).filter_by(id=log_id).first()
    if not log: raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=log.task_id).first()
    _require_member(db, task.project_id, current_user)
    db.delete(log)
    total = db.query(sqlfunc.sum(PMSTaskTimeLog.hours)).filter(PMSTaskTimeLog.task_id == task.id, PMSTaskTimeLog.id != log_id).scalar() or 0
    task.actual_hours = total
    db.commit(); return {"ok": True}

# ── Attachments ───────────────────────────────────────────

@router.post("/tasks/{task_id}/attachments")
async def upload_attachment(task_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task: raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    dest = os.path.join(ATTACHMENT_DIR, f"{task_id}_{file.filename}")
    with open(dest, "wb") as f: shutil.copyfileobj(file.file, f)
    size = os.path.getsize(dest)
    att = PMSTaskAttachment(task_id=task_id, file_path=dest, file_name=file.filename, file_size=size, uploaded_by=current_user.id)
    db.add(att); db.commit(); db.refresh(att)
    return {"id": att.id, "file_name": att.file_name, "file_size": att.file_size}

@router.delete("/attachments/{att_id}")
def delete_attachment(att_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    att = db.query(PMSTaskAttachment).filter_by(id=att_id).first()
    if not att: raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=att.task_id).first()
    _require_member(db, task.project_id, current_user)
    if os.path.exists(att.file_path): os.remove(att.file_path)
    db.delete(att); db.commit(); return {"ok": True}

# ── Alerts ────────────────────────────────────────────────

def _fire_alert(db: Session, task: PMSTask, alert_type: str, message: str):
    """Create alert records for assignee and project PM."""
    recipients = set()
    if task.assignee_id: recipients.add(task.assignee_id)
    pm_members = db.query(PMSProjectMember).filter_by(project_id=task.project_id, role="pm").all()
    for pm in pm_members: recipients.add(pm.user_id)
    for uid in recipients:
        db.add(PMSAlert(task_id=task.id, project_id=task.project_id, type=alert_type, message=message, notified_user_id=uid))
    db.commit()

@router.get("/alerts", response_model=List[PMSAlertOut])
def list_alerts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PMSAlert).filter_by(notified_user_id=current_user.id, is_read=False).order_by(PMSAlert.created_at.desc()).limit(50).all()

@router.post("/alerts/{alert_id}/read")
def mark_alert_read(alert_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    alert = db.query(PMSAlert).filter_by(id=alert_id, notified_user_id=current_user.id).first()
    if not alert: raise HTTPException(404)
    alert.is_read = True; db.commit(); return {"ok": True}

# ── Gantt ─────────────────────────────────────────────────

@router.get("/projects/{project_id}/gantt")
def get_gantt(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p: raise HTTPException(404)
    _require_member(db, project_id, current_user)
    milestones = db.query(PMSMilestone).filter_by(project_id=project_id).all()
    tasks = db.query(PMSTask).filter_by(project_id=project_id).order_by(PMSTask.position).all()
    task_list = []
    for t in tasks:
        deps = db.query(PMSTaskDependency).filter_by(task_id=t.id).all()
        task_list.append({
            "id": t.id, "title": t.title, "stage": t.stage, "priority": t.priority,
            "start_date": t.start_date, "due_date": t.due_date,
            "milestone_id": t.milestone_id, "parent_task_id": t.parent_task_id,
            "assignee_id": t.assignee_id,
            "assignee_name": t.assignee.full_name if t.assignee else None,
            "estimated_hours": t.estimated_hours, "actual_hours": t.actual_hours,
            "dependencies": [{"id": d.id, "task_id": d.task_id, "depends_on_id": d.depends_on_id, "type": d.type} for d in deps],
        })
    project_d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    project_d["members"] = []
    return {"project": project_d, "milestones": milestones, "tasks": task_list}

# ── Integration ───────────────────────────────────────────

@router.post("/tasks/from-ticket/{ticket_id}")
def create_task_from_ticket(ticket_id: int, project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from app.models.ticket import Ticket
    ticket = db.query(Ticket).filter_by(id=ticket_id).first()
    if not ticket: raise HTTPException(404, "Ticket not found")
    _require_member(db, project_id, current_user)
    count = db.query(PMSTask).filter_by(project_id=project_id).count()
    task = PMSTask(project_id=project_id, title=f"[Ticket #{ticket.ticket_number}] {ticket.category or 'Task'}",
                   description=f"Created from ticket #{ticket.ticket_number}", ticket_id=ticket_id, position=count)
    db.add(task); db.flush()
    db.add(PMSWorkflowHistory(task_id=task.id, from_stage=None, to_stage="development", moved_by=current_user.id, note="Created from ticket"))
    db.commit(); db.refresh(task)
    return _enrich_task(task, db)
```

**Commit:**
```bash
git add backend/app/routes/pms.py
git commit -m "feat(pms): add dependencies, comments, timelogs, attachments, alerts, gantt routes"
```

---

### Task 7: Register PMS router in main.py + add overdue scheduler job

**Files:**
- Modify: `backend/main.py`

**Step 1: Add import and router registration**

Find the block of `app.include_router(...)` calls and add:
```python
from app.routes import pms as pms_routes
# ...
app.include_router(pms_routes.router)
```

**Step 2: Add overdue check function and scheduler job**

Add the function near other scheduler job functions:
```python
def check_pms_overdue_tasks():
    """Fire alerts for PMS tasks past their due date."""
    from app.models.pms import PMSTask, PMSAlert, PMSProjectMember
    from sqlalchemy import func as sqlfunc
    from datetime import date
    db = SessionLocal()
    try:
        overdue = db.query(PMSTask).filter(
            PMSTask.due_date < date.today(),
            PMSTask.stage.notin_(["approved", "completed"])
        ).all()
        for task in overdue:
            existing = db.query(PMSAlert).filter_by(
                task_id=task.id, type="overdue", is_read=False
            ).first()
            if existing:
                continue  # Don't spam
            from app.routes.pms import _fire_alert
            _fire_alert(db, task, "overdue", f"Task '{task.title}' is overdue (due: {task.due_date})")
    finally:
        db.close()
```

Add to the scheduler block:
```python
scheduler.add_job(check_pms_overdue_tasks, 'interval', minutes=15, id='pms_overdue_check')
```

**Step 3: Restart and verify route appears in Swagger**

Visit http://localhost:8000/docs — look for `/api/pms/projects` section.

**Commit:**
```bash
git add backend/main.py
git commit -m "feat(pms): register router and add overdue scheduler job"
```

---

## Phase 4: Frontend API Client

### Task 8: Add PMS API calls to lib/api.ts

**Files:**
- Modify: `frontend/lib/api.ts`

Append to the api object (or add as a new `pms` namespace):

```typescript
// ── PMS ──────────────────────────────────────────────────
export const pmsApi = {
  // Projects
  listProjects: () => api.get('/api/pms/projects'),
  createProject: (data: any) => api.post('/api/pms/projects', data),
  getProject: (id: number) => api.get(`/api/pms/projects/${id}`),
  updateProject: (id: number, data: any) => api.put(`/api/pms/projects/${id}`, data),
  deleteProject: (id: number) => api.delete(`/api/pms/projects/${id}`),

  // Members
  listMembers: (projectId: number) => api.get(`/api/pms/projects/${projectId}/members`),
  addMember: (projectId: number, data: any) => api.post(`/api/pms/projects/${projectId}/members`, data),
  removeMember: (projectId: number, userId: number) => api.delete(`/api/pms/projects/${projectId}/members/${userId}`),

  // Milestones
  listMilestones: (projectId: number) => api.get(`/api/pms/projects/${projectId}/milestones`),
  createMilestone: (projectId: number, data: any) => api.post(`/api/pms/projects/${projectId}/milestones`, data),
  updateMilestone: (id: number, data: any) => api.put(`/api/pms/milestones/${id}`, data),
  deleteMilestone: (id: number) => api.delete(`/api/pms/milestones/${id}`),

  // Tasks
  listTasks: (projectId: number) => api.get(`/api/pms/projects/${projectId}/tasks`),
  createTask: (projectId: number, data: any) => api.post(`/api/pms/projects/${projectId}/tasks`, data),
  getTask: (id: number) => api.get(`/api/pms/tasks/${id}`),
  updateTask: (id: number, data: any) => api.put(`/api/pms/tasks/${id}`, data),
  deleteTask: (id: number) => api.delete(`/api/pms/tasks/${id}`),
  transitionTask: (id: number, data: any) => api.post(`/api/pms/tasks/${id}/transition`, data),
  getTaskHistory: (id: number) => api.get(`/api/pms/tasks/${id}/history`),

  // Dependencies
  addDependency: (taskId: number, data: any) => api.post(`/api/pms/tasks/${taskId}/dependencies`, data),
  removeDependency: (depId: number) => api.delete(`/api/pms/dependencies/${depId}`),

  // Comments
  listComments: (taskId: number) => api.get(`/api/pms/tasks/${taskId}/comments`),
  createComment: (taskId: number, data: any) => api.post(`/api/pms/tasks/${taskId}/comments`, data),
  deleteComment: (id: number) => api.delete(`/api/pms/comments/${id}`),

  // Time logs
  listTimeLogs: (taskId: number) => api.get(`/api/pms/tasks/${taskId}/timelogs`),
  logTime: (taskId: number, data: any) => api.post(`/api/pms/tasks/${taskId}/timelogs`, data),
  deleteTimeLog: (id: number) => api.delete(`/api/pms/timelogs/${id}`),

  // Attachments
  uploadAttachment: (taskId: number, file: File) => {
    const form = new FormData(); form.append('file', file);
    return api.post(`/api/pms/tasks/${taskId}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  deleteAttachment: (id: number) => api.delete(`/api/pms/attachments/${id}`),

  // Alerts
  listAlerts: () => api.get('/api/pms/alerts'),
  markAlertRead: (id: number) => api.post(`/api/pms/alerts/${id}/read`),

  // Gantt
  getGantt: (projectId: number) => api.get(`/api/pms/projects/${projectId}/gantt`),

  // Integration
  createTaskFromTicket: (ticketId: number, projectId: number) =>
    api.post(`/api/pms/tasks/from-ticket/${ticketId}?project_id=${projectId}`),
};
```

**Commit:**
```bash
git add frontend/lib/api.ts
git commit -m "feat(pms): add PMS API client functions"
```

---

## Phase 5: Frontend Pages

### Task 9: Project list page

**Files:**
- Create: `frontend/app/admin/pms/page.tsx`

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import MainHeader from '@/components/MainHeader';
import { pmsApi } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
};

export default function PMSPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#6366f1', status: 'planning' });

  useEffect(() => {
    pmsApi.listProjects().then(r => { setProjects(r.data); setLoading(false); });
  }, []);

  const handleCreate = async () => {
    await pmsApi.createProject(form);
    const r = await pmsApi.listProjects();
    setProjects(r.data);
    setShowCreate(false);
    setForm({ name: '', description: '', color: '#6366f1', status: 'planning' });
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminNav />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MainHeader title="Project Management" />
        <div className="flex-1 overflow-auto p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
            <button onClick={() => setShowCreate(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium">
              + New Project
            </button>
          </div>

          {loading ? (
            <div className="text-gray-400 text-center py-20">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map(p => (
                <div key={p.id} onClick={() => router.push(`/admin/pms/${p.id}`)}
                  className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                    <h2 className="font-semibold text-gray-900 flex-1 truncate">{p.name}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status]}`}>
                      {p.status.replace('_', ' ')}
                    </span>
                  </div>
                  {p.description && <p className="text-sm text-gray-500 mb-3 line-clamp-2">{p.description}</p>}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{p.members?.length || 0} members</span>
                    {p.start_date && <><span>·</span><span>{p.start_date} → {p.end_date || '?'}</span></>}
                  </div>
                </div>
              ))}
              {projects.length === 0 && (
                <div className="col-span-3 text-center text-gray-400 py-20">No projects yet. Create your first one.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">New Project</h2>
            <div className="space-y-3">
              <input className="w-full border rounded-lg px-3 py-2" placeholder="Project name"
                value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              <textarea className="w-full border rounded-lg px-3 py-2" placeholder="Description" rows={3}
                value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              <div className="flex gap-3">
                <div>
                  <label className="text-sm text-gray-600">Color</label>
                  <input type="color" className="block mt-1 w-10 h-8 rounded cursor-pointer"
                    value={form.color} onChange={e => setForm({...form, color: e.target.value})} />
                </div>
                <div className="flex-1">
                  <label className="text-sm text-gray-600">Status</label>
                  <select className="block mt-1 w-full border rounded-lg px-3 py-2"
                    value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="on_hold">On Hold</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg px-4 py-2">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Commit:**
```bash
git add frontend/app/admin/pms/page.tsx
git commit -m "feat(pms): add project list page"
```

---

### Task 10: Project detail page shell with tabs

**Files:**
- Create: `frontend/app/admin/pms/[id]/page.tsx`

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import MainHeader from '@/components/MainHeader';
import { pmsApi } from '@/lib/api';

const TABS = ['Gantt', 'Board', 'List', 'Milestones', 'Files', 'Time', 'Settings'];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Gantt');
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const [pRes, tRes, mRes] = await Promise.all([
      pmsApi.getProject(Number(id)),
      pmsApi.listTasks(Number(id)),
      pmsApi.listMilestones(Number(id)),
    ]);
    setProject(pRes.data);
    setTasks(tRes.data);
    setMilestones(mRes.data);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [id]);

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading...</div>;

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminNav />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MainHeader title={project?.name || 'Project'} />
        <div className="border-b border-gray-200 bg-white px-6">
          <div className="flex items-center gap-1">
            {TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === 'Gantt' && <GanttTab projectId={Number(id)} tasks={tasks} milestones={milestones} onReload={reload} />}
          {activeTab === 'Board' && <BoardTab projectId={Number(id)} tasks={tasks} onReload={reload} />}
          {activeTab === 'List' && <ListTab projectId={Number(id)} tasks={tasks} milestones={milestones} members={project?.members || []} onReload={reload} />}
          {activeTab === 'Milestones' && <MilestonesTab projectId={Number(id)} milestones={milestones} onReload={reload} />}
          {activeTab === 'Files' && <FilesTab projectId={Number(id)} tasks={tasks} />}
          {activeTab === 'Time' && <TimeTab projectId={Number(id)} tasks={tasks} />}
          {activeTab === 'Settings' && <SettingsTab project={project} onReload={reload} />}
        </div>
      </div>
    </div>
  );
}

// Placeholder tab components — replaced in subsequent tasks
function GanttTab({ projectId, tasks, milestones, onReload }: any) {
  return <div className="p-6 text-gray-400">Gantt chart — implemented in Task 11</div>;
}
function BoardTab({ projectId, tasks, onReload }: any) {
  return <div className="p-6 text-gray-400">Board — implemented in Task 12</div>;
}
function ListTab({ projectId, tasks, milestones, members, onReload }: any) {
  return <div className="p-6 text-gray-400">List — implemented in Task 13</div>;
}
function MilestonesTab({ projectId, milestones, onReload }: any) {
  return <div className="p-6 text-gray-400">Milestones</div>;
}
function FilesTab({ projectId, tasks }: any) {
  return <div className="p-6 text-gray-400">Files</div>;
}
function TimeTab({ projectId, tasks }: any) {
  return <div className="p-6 text-gray-400">Time Tracking</div>;
}
function SettingsTab({ project, onReload }: any) {
  return <div className="p-6 text-gray-400">Settings</div>;
}
```

**Commit:**
```bash
git add frontend/app/admin/pms/[id]/page.tsx
git commit -m "feat(pms): add project detail page shell with tab layout"
```

---

## Phase 6: Gantt Chart (SVG)

### Task 11: GanttChart component

**Files:**
- Create: `frontend/components/pms/GanttChart.tsx`
- Modify: `frontend/app/admin/pms/[id]/page.tsx` (replace GanttTab placeholder)

**Step 1: Install react-dnd**

```bash
cd frontend && npm install react-dnd react-dnd-html5-backend
```

**Step 2: Create the GanttChart component**

Create `frontend/components/pms/GanttChart.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { pmsApi } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────
interface GanttTask {
  id: number; title: string; stage: string; priority: string;
  start_date: string | null; due_date: string | null;
  milestone_id: number | null; parent_task_id: number | null;
  assignee_name: string | null; estimated_hours: number; actual_hours: number;
  dependencies: { id: number; task_id: number; depends_on_id: number; type: string }[];
}
interface Milestone {
  id: number; name: string; due_date: string; color: string;
}

type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

// ── Constants ─────────────────────────────────────────────
const ROW_H = 36;
const LEFT_W = 260;
const STAGE_COLORS: Record<string, string> = {
  development: '#6366f1', qa: '#f59e0b', pm_review: '#8b5cf6',
  client_review: '#06b6d4', approved: '#10b981', completed: '#6b7280', blocked: '#ef4444',
};
const ZOOM_DAY_PX: Record<ZoomLevel, number> = { day: 40, week: 14, month: 4, quarter: 2 };

function parseDate(d: string | null): Date | null {
  return d ? new Date(d) : null;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ── Critical path calculation ─────────────────────────────
function computeCriticalPath(tasks: GanttTask[]): Set<number> {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const duration = (t: GanttTask) => {
    const s = parseDate(t.start_date), e = parseDate(t.due_date);
    return s && e ? Math.max(1, diffDays(s, e)) : 1;
  };
  // Build adjacency (depends_on → task)
  const children = new Map<number, number[]>();
  tasks.forEach(t => {
    t.dependencies.forEach(d => {
      if (!children.has(d.depends_on_id)) children.set(d.depends_on_id, []);
      children.get(d.depends_on_id)!.push(t.id);
    });
  });
  // Topological longest path
  const es = new Map<number, number>(); // earliest start
  const ef = new Map<number, number>(); // earliest finish
  const visited = new Set<number>();
  function visit(id: number) {
    if (visited.has(id)) return;
    visited.add(id);
    const t = taskMap.get(id)!;
    const maxPredEF = t.dependencies.length
      ? Math.max(...t.dependencies.map(d => { visit(d.depends_on_id); return ef.get(d.depends_on_id) || 0; }))
      : 0;
    es.set(id, maxPredEF);
    ef.set(id, maxPredEF + duration(t));
  }
  tasks.forEach(t => visit(t.id));
  const maxEF = Math.max(...Array.from(ef.values()));
  // Tasks on critical path: ef === maxEF (simplified)
  const critical = new Set<number>();
  tasks.forEach(t => { if ((ef.get(t.id) || 0) === maxEF) critical.add(t.id); });
  return critical;
}

// ── Main component ────────────────────────────────────────
export default function GanttChart({ projectId, tasks: initialTasks, milestones }: {
  projectId: number; tasks: GanttTask[]; milestones: Milestone[];
}) {
  const [tasks, setTasks] = useState<GanttTask[]>(initialTasks);
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [chartStart, setChartStart] = useState<Date>(() => {
    const dates = initialTasks.flatMap(t => [parseDate(t.start_date), parseDate(t.due_date)]).filter(Boolean) as Date[];
    if (!dates.length) return new Date();
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    return addDays(min, -7);
  });
  const [selectedTask, setSelectedTask] = useState<GanttTask | null>(null);
  const [dragging, setDragging] = useState<{ taskId: number; type: 'move' | 'resize'; startX: number; origStart: Date | null; origEnd: Date | null } | null>(null);
  const [depDrag, setDepDrag] = useState<{ fromId: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pxPerDay = ZOOM_DAY_PX[zoom];
  const chartDays = 365;
  const chartWidth = chartDays * pxPerDay;
  const critical = computeCriticalPath(tasks);

  const dayToX = useCallback((d: Date) => diffDays(chartStart, d) * pxPerDay, [chartStart, pxPerDay]);
  const xToDay = useCallback((x: number) => addDays(chartStart, Math.round(x / pxPerDay)), [chartStart, pxPerDay]);

  // Mouse move handler for dragging task bars
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - LEFT_W;
    const dx = x - dragging.startX;
    const daysDelta = Math.round(dx / pxPerDay);
    setTasks(prev => prev.map(t => {
      if (t.id !== dragging.taskId) return t;
      if (dragging.type === 'move') {
        const ns = dragging.origStart ? fmtDate(addDays(dragging.origStart, daysDelta)) : t.start_date;
        const ne = dragging.origEnd ? fmtDate(addDays(dragging.origEnd, daysDelta)) : t.due_date;
        return { ...t, start_date: ns, due_date: ne };
      } else { // resize
        const ne = dragging.origEnd ? fmtDate(addDays(dragging.origEnd, daysDelta)) : t.due_date;
        return { ...t, due_date: ne };
      }
    }));
  }, [dragging, pxPerDay]);

  const onMouseUp = useCallback(async () => {
    if (!dragging) return;
    const task = tasks.find(t => t.id === dragging.taskId);
    if (task) {
      await pmsApi.updateTask(task.id, { start_date: task.start_date, due_date: task.due_date });
    }
    setDragging(null);
  }, [dragging, tasks]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [onMouseMove, onMouseUp]);

  const startDrag = (e: React.MouseEvent, taskId: number, type: 'move' | 'resize') => {
    e.stopPropagation();
    const task = tasks.find(t => t.id === taskId)!;
    const rect = svgRef.current!.getBoundingClientRect();
    setDragging({
      taskId, type,
      startX: e.clientX - rect.left - LEFT_W,
      origStart: parseDate(task.start_date),
      origEnd: parseDate(task.due_date),
    });
  };

  const startDepDrag = (e: React.MouseEvent, fromId: number, rowIdx: number) => {
    e.stopPropagation();
    const rect = svgRef.current!.getBoundingClientRect();
    setDepDrag({ fromId, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const dropDepOn = async (toId: number) => {
    if (!depDrag || depDrag.fromId === toId) { setDepDrag(null); return; }
    await pmsApi.addDependency(depDrag.fromId, { depends_on_id: toId, type: 'finish_to_start' });
    const r = await pmsApi.listTasks(projectId);
    setTasks(r.data);
    setDepDrag(null);
  };

  // ── Render time axis ──────────────────────────────────
  const timeHeaders = () => {
    const headers = [];
    let cur = new Date(chartStart);
    while (diffDays(chartStart, cur) < chartDays) {
      const x = dayToX(cur);
      let label = '';
      if (zoom === 'day') label = cur.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      else if (zoom === 'week') label = `W${getWeek(cur)} ${cur.getFullYear()}`;
      else if (zoom === 'month') label = cur.toLocaleDateString('en', { month: 'short', year: '2-digit' });
      else label = `Q${Math.ceil((cur.getMonth() + 1) / 3)} ${cur.getFullYear()}`;
      headers.push({ x, label });
      if (zoom === 'day') cur = addDays(cur, 1);
      else if (zoom === 'week') cur = addDays(cur, 7);
      else if (zoom === 'month') { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
      else { cur = new Date(cur.getFullYear(), cur.getMonth() + 3, 1); }
    }
    return headers;
  };

  function getWeek(d: Date): number {
    const jan1 = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  }

  const today = new Date();
  const todayX = dayToX(today);

  const svgH = tasks.length * ROW_H + 40;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200">
        <span className="text-sm text-gray-500 font-medium">Zoom:</span>
        {(['day', 'week', 'month', 'quarter'] as ZoomLevel[]).map(z => (
          <button key={z} onClick={() => setZoom(z)}
            className={`px-3 py-1 rounded text-sm font-medium ${zoom === z ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        ))}
        <div className="flex items-center gap-3 ml-4 text-xs">
          {Object.entries(STAGE_COLORS).slice(0, 4).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />
              {s.replace('_', ' ')}
            </span>
          ))}
          <span className="flex items-center gap-1 text-red-500">
            <span className="w-3 h-3 rounded-sm inline-block bg-red-500" />
            critical path
          </span>
        </div>
      </div>

      {/* Gantt body */}
      <div className="flex flex-1 overflow-auto">
        {/* Left: task list */}
        <div className="flex-none border-r border-gray-200" style={{ width: LEFT_W }}>
          <div className="h-10 border-b border-gray-200 flex items-center px-3 bg-gray-50">
            <span className="text-xs font-semibold text-gray-500 uppercase">Task</span>
          </div>
          {tasks.map((t, i) => (
            <div key={t.id}
              style={{ height: ROW_H }}
              className="flex items-center px-3 border-b border-gray-100 text-sm cursor-pointer hover:bg-gray-50"
              onClick={() => setSelectedTask(t)}>
              <span className="w-2 h-2 rounded-full mr-2 flex-none" style={{ background: STAGE_COLORS[t.stage] }} />
              <span className="truncate text-gray-800">{t.title}</span>
            </div>
          ))}
        </div>

        {/* Right: SVG chart */}
        <div className="flex-1 overflow-x-auto">
          <svg ref={svgRef} width={chartWidth} height={svgH}
            onMouseMove={e => {
              if (depDrag) {
                const rect = svgRef.current!.getBoundingClientRect();
                setDepDrag({ ...depDrag, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }
            }}>
            {/* Time axis */}
            <g>
              {timeHeaders().map((h, i) => (
                <g key={i}>
                  <line x1={h.x} y1={0} x2={h.x} y2={svgH} stroke="#e5e7eb" strokeWidth={1} />
                  <text x={h.x + 4} y={14} fontSize={10} fill="#9ca3af">{h.label}</text>
                </g>
              ))}
              {/* Axis separator */}
              <line x1={0} y1={20} x2={chartWidth} y2={20} stroke="#e5e7eb" strokeWidth={1} />
            </g>

            {/* Today line */}
            {todayX > 0 && todayX < chartWidth && (
              <line x1={todayX} y1={0} x2={todayX} y2={svgH} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 3" />
            )}

            {/* Milestone diamonds */}
            {milestones.map(m => {
              const mx = dayToX(new Date(m.due_date));
              return (
                <g key={m.id} transform={`translate(${mx}, 20)`}>
                  <polygon points="0,-8 8,0 0,8 -8,0" fill={m.color} opacity={0.85} />
                  <title>{m.name}</title>
                </g>
              );
            })}

            {/* Dependency arrows */}
            {tasks.map((t, ti) =>
              t.dependencies.map(dep => {
                const fromTask = tasks.find(x => x.id === dep.depends_on_id);
                if (!fromTask) return null;
                const fromIdx = tasks.indexOf(fromTask);
                const toIdx = ti;
                const fromX = fromTask.due_date ? dayToX(new Date(fromTask.due_date)) : 0;
                const toX = t.start_date ? dayToX(new Date(t.start_date)) : 0;
                const fromY = 20 + fromIdx * ROW_H + ROW_H / 2;
                const toY = 20 + toIdx * ROW_H + ROW_H / 2;
                const midX = (fromX + toX) / 2;
                return (
                  <g key={dep.id}>
                    <path d={`M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}`}
                      fill="none" stroke="#94a3b8" strokeWidth={1.5} markerEnd="url(#arrow)" />
                  </g>
                );
              })
            )}

            {/* Arrow marker */}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
              </marker>
            </defs>

            {/* Task bars */}
            {tasks.map((t, i) => {
              const s = parseDate(t.start_date);
              const e = parseDate(t.due_date);
              if (!s || !e) return null;
              const x = dayToX(s);
              const w = Math.max(8, dayToX(e) - x);
              const y = 20 + i * ROW_H + 6;
              const h = ROW_H - 12;
              const isCrit = critical.has(t.id);
              const color = isCrit ? '#ef4444' : (STAGE_COLORS[t.stage] || '#6366f1');

              return (
                <g key={t.id}>
                  {/* Bar */}
                  <rect x={x} y={y} width={w} height={h} rx={4}
                    fill={color} opacity={0.85} style={{ cursor: 'grab' }}
                    onMouseDown={e2 => startDrag(e2, t.id, 'move')}
                    onMouseUp={() => depDrag && dropDepOn(t.id)}
                  />
                  {/* Label inside bar */}
                  {w > 40 && (
                    <text x={x + 6} y={y + h / 2 + 4} fontSize={11} fill="white" style={{ pointerEvents: 'none' }}>
                      {t.title.slice(0, Math.floor(w / 7))}
                    </text>
                  )}
                  {/* Resize handle */}
                  <rect x={x + w - 6} y={y} width={6} height={h} rx={2} fill="rgba(0,0,0,0.2)"
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={e2 => startDrag(e2, t.id, 'resize')} />
                  {/* Dep drag handle (right edge circle) */}
                  <circle cx={x + w} cy={y + h / 2} r={5} fill="white" stroke={color} strokeWidth={2}
                    style={{ cursor: 'crosshair' }}
                    onMouseDown={e2 => startDepDrag(e2, t.id, i)} />
                </g>
              );
            })}

            {/* Dep drag preview line */}
            {depDrag && (
              <line
                x1={(() => { const t = tasks.find(x => x.id === depDrag.fromId); return t?.due_date ? dayToX(new Date(t.due_date)) : 0; })()}
                y1={(() => { const i = tasks.findIndex(x => x.id === depDrag.fromId); return 20 + i * ROW_H + ROW_H / 2; })()}
                x2={depDrag.x} y2={depDrag.y}
                stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 3"
              />
            )}
          </svg>
        </div>
      </div>

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetailPanel task={selectedTask} projectId={projectId}
          onClose={() => setSelectedTask(null)}
          onUpdated={async () => { const r = await pmsApi.listTasks(projectId); setTasks(r.data); }} />
      )}
    </div>
  );
}

// ── Task Detail Panel ─────────────────────────────────────
function TaskDetailPanel({ task, projectId, onClose, onUpdated }: any) {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [timelogs, setTimelogs] = useState<any[]>([]);
  const [logHours, setLogHours] = useState('');
  const [tab, setTab] = useState('details');

  useEffect(() => {
    pmsApi.listComments(task.id).then(r => setComments(r.data));
    pmsApi.getTaskHistory(task.id).then(r => setHistory(r.data));
    pmsApi.listTimeLogs(task.id).then(r => setTimelogs(r.data));
  }, [task.id]);

  const NEXT_STAGES: Record<string, string[]> = {
    development: ['qa'], qa: ['pm_review', 'development'],
    pm_review: ['client_review', 'development'],
    client_review: ['approved', 'development'], approved: ['completed'],
  };

  const transition = async (to: string) => {
    await pmsApi.transitionTask(task.id, { to_stage: to });
    onUpdated();
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-gray-200 flex flex-col z-40">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold text-gray-900 truncate">{task.title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
      </div>
      <div className="flex border-b px-4">
        {['details', 'comments', 'time', 'history'].map(t2 => (
          <button key={t2} onClick={() => setTab(t2)}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === t2 ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>
            {t2.charAt(0).toUpperCase() + t2.slice(1)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'details' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded text-xs font-medium text-white" style={{ background: STAGE_COLORS[task.stage] }}>
                {task.stage.replace('_', ' ')}
              </span>
              <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700">{task.priority}</span>
            </div>
            {task.description && <p className="text-sm text-gray-600">{task.description}</p>}
            <div className="text-xs text-gray-500 space-y-1">
              {task.assignee_name && <div>Assignee: <span className="text-gray-800">{task.assignee_name}</span></div>}
              <div>Due: <span className="text-gray-800">{task.due_date || '—'}</span></div>
              <div>Hours: <span className="text-gray-800">{task.actual_hours}/{task.estimated_hours}h</span></div>
            </div>
            {NEXT_STAGES[task.stage]?.length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">Move to:</div>
                <div className="flex flex-wrap gap-2">
                  {NEXT_STAGES[task.stage].map(s => (
                    <button key={s} onClick={() => transition(s)}
                      className="px-3 py-1 rounded text-xs font-medium text-white"
                      style={{ background: STAGE_COLORS[s] || '#6366f1' }}>
                      {s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'comments' && (
          <div className="space-y-3">
            {comments.map(c => (
              <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs font-medium text-gray-700 mb-1">{c.user_name}</div>
                <div className="text-sm text-gray-600">{c.content}</div>
              </div>
            ))}
            <div className="flex gap-2 mt-3">
              <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="Add comment..."
                value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={async e2 => {
                  if (e2.key === 'Enter' && newComment.trim()) {
                    await pmsApi.createComment(task.id, { content: newComment });
                    const r = await pmsApi.listComments(task.id);
                    setComments(r.data); setNewComment('');
                  }
                }} />
            </div>
          </div>
        )}
        {tab === 'time' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input type="number" className="flex-1 border rounded px-2 py-1 text-sm" placeholder="Hours"
                value={logHours} onChange={e => setLogHours(e.target.value)} />
              <button className="bg-indigo-600 text-white px-3 py-1 rounded text-sm"
                onClick={async () => {
                  if (!logHours) return;
                  await pmsApi.logTime(task.id, { hours: parseFloat(logHours) });
                  const r = await pmsApi.listTimeLogs(task.id); setTimelogs(r.data); setLogHours('');
                }}>Log</button>
            </div>
            {timelogs.map(l => (
              <div key={l.id} className="flex justify-between text-sm text-gray-600 border-b pb-2">
                <span>{l.user_name} — {l.hours}h</span>
                <span className="text-gray-400">{l.log_date}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'history' && (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="text-xs text-gray-500 border-l-2 border-indigo-200 pl-2">
                <span className="font-medium text-gray-700">{h.actor_name || 'System'}</span>
                {' moved '}
                <span className="text-indigo-600">{h.from_stage || '—'} → {h.to_stage}</span>
                {h.note && <span className="block text-gray-400 italic">{h.note}</span>}
                <span className="block text-gray-300">{new Date(h.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Wire GanttChart into the project detail page**

Replace the `GanttTab` placeholder in `frontend/app/admin/pms/[id]/page.tsx`:

```tsx
import GanttChart from '@/components/pms/GanttChart';

function GanttTab({ projectId, tasks, milestones, onReload }: any) {
  return <GanttChart projectId={projectId} tasks={tasks} milestones={milestones} />;
}
```

**Commit:**
```bash
git add frontend/components/pms/GanttChart.tsx frontend/app/admin/pms/[id]/page.tsx
git commit -m "feat(pms): add interactive SVG Gantt chart with drag, resize, dependencies, critical path"
```

---

## Phase 7: Board & List Views

### Task 12: Board (Kanban) view

**Files:**
- Create: `frontend/components/pms/BoardView.tsx`
- Modify: `frontend/app/admin/pms/[id]/page.tsx`

```tsx
'use client';
import { useState } from 'react';
import { pmsApi } from '@/lib/api';

const STAGES = ['development', 'qa', 'pm_review', 'client_review', 'approved', 'completed'];
const STAGE_LABELS: Record<string, string> = {
  development: 'Development', qa: 'QA', pm_review: 'PM Review',
  client_review: 'Client Review', approved: 'Approved', completed: 'Completed',
};
const STAGE_COLORS: Record<string, string> = {
  development: 'bg-indigo-50 border-indigo-200',
  qa: 'bg-amber-50 border-amber-200',
  pm_review: 'bg-purple-50 border-purple-200',
  client_review: 'bg-cyan-50 border-cyan-200',
  approved: 'bg-green-50 border-green-200',
  completed: 'bg-gray-50 border-gray-200',
};
const PRIORITY_DOT: Record<string, string> = { low: 'bg-gray-300', medium: 'bg-yellow-400', high: 'bg-orange-400', urgent: 'bg-red-500' };

export default function BoardView({ projectId, tasks, onReload }: { projectId: number; tasks: any[]; onReload: () => void }) {
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);

  const onDrop = async (stage: string) => {
    if (!dragTaskId) return;
    const task = tasks.find(t => t.id === dragTaskId);
    if (!task || task.stage === stage) { setDragTaskId(null); return; }
    try {
      await pmsApi.transitionTask(dragTaskId, { to_stage: stage });
      await onReload();
    } catch {}
    setDragTaskId(null);
  };

  return (
    <div className="flex gap-4 p-4 h-full overflow-x-auto">
      {STAGES.map(stage => {
        const stageTasks = tasks.filter(t => t.stage === stage);
        return (
          <div key={stage} className={`flex-none w-64 rounded-xl border ${STAGE_COLORS[stage]} flex flex-col`}
            onDragOver={e => e.preventDefault()} onDrop={() => onDrop(stage)}>
            <div className="px-3 py-2 border-b border-inherit flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">{STAGE_LABELS[stage]}</span>
              <span className="text-xs bg-white rounded-full px-2 py-0.5 text-gray-500">{stageTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {stageTasks.map(t => (
                <div key={t.id} draggable
                  onDragStart={() => setDragTaskId(t.id)}
                  className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing">
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full mt-1 flex-none ${PRIORITY_DOT[t.priority]}`} />
                    <span className="text-sm font-medium text-gray-800 leading-tight">{t.title}</span>
                  </div>
                  {t.assignee_name && <div className="text-xs text-gray-400 ml-4">{t.assignee_name}</div>}
                  {t.due_date && <div className="text-xs text-gray-400 ml-4 mt-1">Due {t.due_date}</div>}
                  {t.labels?.map((l: any) => (
                    <span key={l.id} className="inline-block text-xs px-1.5 py-0.5 rounded ml-4 mt-1 text-white"
                      style={{ background: l.color }}>{l.name}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Wire into page: replace `BoardTab` placeholder:
```tsx
import BoardView from '@/components/pms/BoardView';
function BoardTab({ projectId, tasks, onReload }: any) {
  return <BoardView projectId={projectId} tasks={tasks} onReload={onReload} />;
}
```

**Commit:**
```bash
git add frontend/components/pms/BoardView.tsx frontend/app/admin/pms/[id]/page.tsx
git commit -m "feat(pms): add Kanban board view with drag-to-stage"
```

---

### Task 13: List view with task create

**Files:**
- Create: `frontend/components/pms/ListView.tsx`
- Modify: `frontend/app/admin/pms/[id]/page.tsx`

```tsx
'use client';
import { useState } from 'react';
import { pmsApi } from '@/lib/api';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400', medium: 'text-yellow-500', high: 'text-orange-500', urgent: 'text-red-500'
};
const STAGE_BADGE: Record<string, string> = {
  development: 'bg-indigo-100 text-indigo-700', qa: 'bg-amber-100 text-amber-700',
  pm_review: 'bg-purple-100 text-purple-700', client_review: 'bg-cyan-100 text-cyan-700',
  approved: 'bg-green-100 text-green-700', completed: 'bg-gray-100 text-gray-600',
};

export default function ListView({ projectId, tasks, milestones, members, onReload }: {
  projectId: number; tasks: any[]; milestones: any[]; members: any[]; onReload: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ title: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' });

  const filtered = tasks.filter(t => !t.parent_task_id && t.title.toLowerCase().includes(filter.toLowerCase()));

  const handleCreate = async () => {
    await pmsApi.createTask(projectId, {
      ...form,
      milestone_id: form.milestone_id ? Number(form.milestone_id) : null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : 0,
    });
    onReload(); setShowCreate(false);
    setForm({ title: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <input className="border rounded-lg px-3 py-1.5 text-sm w-56" placeholder="Search tasks..."
          value={filter} onChange={e => setFilter(e.target.value)} />
        <button onClick={() => setShowCreate(true)}
          className="ml-auto bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + Add Task
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
            <tr>
              <th className="text-left px-4 py-2">Task</th>
              <th className="text-left px-4 py-2">Stage</th>
              <th className="text-left px-4 py-2">Priority</th>
              <th className="text-left px-4 py-2">Assignee</th>
              <th className="text-left px-4 py-2">Due</th>
              <th className="text-left px-4 py-2">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-800">{t.title}
                  {t.subtask_count > 0 && <span className="ml-1 text-xs text-gray-400">+{t.subtask_count}</span>}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_BADGE[t.stage]}`}>
                    {t.stage.replace('_', ' ')}
                  </span>
                </td>
                <td className={`px-4 py-2 font-medium ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</td>
                <td className="px-4 py-2 text-gray-500">{t.assignee_name || '—'}</td>
                <td className="px-4 py-2 text-gray-500">{t.due_date || '—'}</td>
                <td className="px-4 py-2 text-gray-500">{t.actual_hours}/{t.estimated_hours}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg space-y-3">
            <h2 className="text-lg font-semibold">New Task</h2>
            <input className="w-full border rounded-lg px-3 py-2" placeholder="Task title"
              value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <select className="border rounded-lg px-3 py-2" value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}>
                {['low', 'medium', 'high', 'urgent'].map(p => <option key={p}>{p}</option>)}
              </select>
              <select className="border rounded-lg px-3 py-2" value={form.milestone_id}
                onChange={e => setForm({ ...form, milestone_id: e.target.value })}>
                <option value="">No milestone</option>
                {milestones.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select className="border rounded-lg px-3 py-2" value={form.assignee_id}
                onChange={e => setForm({ ...form, assignee_id: e.target.value })}>
                <option value="">Unassigned</option>
                {members.map((m: any) => <option key={m.user_id} value={m.user_id}>{m.user_name}</option>)}
              </select>
              <input type="date" className="border rounded-lg px-3 py-2" value={form.due_date}
                onChange={e => setForm({ ...form, due_date: e.target.value })} />
              <input type="number" className="border rounded-lg px-3 py-2" placeholder="Est. hours"
                value={form.estimated_hours} onChange={e => setForm({ ...form, estimated_hours: e.target.value })} />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg px-4 py-2">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Wire into page — replace `ListTab`:
```tsx
import ListView from '@/components/pms/ListView';
function ListTab({ projectId, tasks, milestones, members, onReload }: any) {
  return <ListView projectId={projectId} tasks={tasks} milestones={milestones} members={members} onReload={onReload} />;
}
```

**Commit:**
```bash
git add frontend/components/pms/ListView.tsx frontend/app/admin/pms/[id]/page.tsx
git commit -m "feat(pms): add list view with task create form"
```

---

## Phase 8: Add PMS to Admin Navigation

### Task 14: Add PMS link to AdminNav

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

Find the navigation items array and add a PMS entry:

```tsx
{ href: '/admin/pms', label: 'Projects', icon: <LayoutGrid size={16} /> }
```

Import `LayoutGrid` from `lucide-react` if not already imported.

**Commit:**
```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat(pms): add Projects link to admin navigation"
```

---

## Phase 9: Final Verification

### Task 15: End-to-end smoke test

**Step 1:** Start backend and frontend
```bash
./start.sh
```

**Step 2:** Verify via Swagger (http://localhost:8000/docs)
- `POST /api/pms/projects` — create a project
- `POST /api/pms/projects/{id}/members` — add a member
- `POST /api/pms/projects/{id}/tasks` — create a task
- `POST /api/pms/tasks/{id}/transition` — move stage to `qa`
- `GET /api/pms/projects/{id}/gantt` — verify Gantt payload returns

**Step 3:** Verify frontend (http://localhost:3000/admin/pms)
- Project list loads
- Create project → card appears
- Click project → tabbed detail page
- Gantt tab → tasks render as bars
- Board tab → columns with tasks
- List tab → table with tasks + create form
- Move task bar (drag) → bar repositions
- Drag right edge → duration changes

**Step 4:** Commit
```bash
git add .
git commit -m "feat(pms): complete PMS with Gantt chart implementation"
```
