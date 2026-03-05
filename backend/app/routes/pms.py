from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
from datetime import date
import os, shutil

from app.database import get_db
from app.dependencies import get_current_user, require_page
from app.models.user import User
from app.models.pms import (
    PMSProject, PMSProjectMember, PMSMilestone, PMSTask,
    PMSTaskDependency, PMSTaskComment, PMSTaskTimeLog,
    PMSTaskAttachment, PMSTaskLabel, PMSWorkflowHistory, PMSAlert,
    PMSLabelDefinition
)
from app.schemas.pms import *

router = APIRouter(prefix="/api/pms", tags=["pms"], dependencies=[Depends(require_page("pms"))])

ATTACHMENT_DIR = "app/attachment_storage/pms"
os.makedirs(ATTACHMENT_DIR, exist_ok=True)

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

def _is_admin(user: User) -> bool:
    return getattr(user, 'role', '') == "admin"

def _get_membership(db, project_id: int, user_id: int) -> Optional[PMSProjectMember]:
    return db.query(PMSProjectMember).filter_by(project_id=project_id, user_id=user_id).first()

def _require_member(db, project_id: int, user: User) -> PMSProjectMember:
    if _is_admin(user):
        m = PMSProjectMember()
        m.role = "pm"
        return m
    m = _get_membership(db, project_id, user.id)
    if not m:
        raise HTTPException(status_code=403, detail="Not a project member")
    return m

def _enrich_task(task: PMSTask, db: Session) -> dict:
    d = {c.name: getattr(task, c.name) for c in task.__table__.columns}
    d["assignee_name"] = task.assignee.full_name if task.assignee else None
    d["labels"] = [{"id": l.id, "name": l.name, "color": l.color} for l in task.labels]
    d["subtask_count"] = db.query(PMSTask).filter_by(parent_task_id=task.id).count()
    return d

def _fire_alert(db: Session, task: PMSTask, alert_type: str, message: str):
    recipients = set()
    if task.assignee_id:
        recipients.add(task.assignee_id)
    pm_members = db.query(PMSProjectMember).filter_by(project_id=task.project_id, role="pm").all()
    for pm in pm_members:
        recipients.add(pm.user_id)
    for uid in recipients:
        db.add(PMSAlert(task_id=task.id, project_id=task.project_id, type=alert_type, message=message, notified_user_id=uid))
    db.commit()

# ── Projects ──────────────────────────────────────────────

@router.get("/projects")
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

@router.post("/projects")
def create_project(data: PMSProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admins only")
    p = PMSProject(**data.dict(), owner_id=current_user.id)
    db.add(p)
    db.flush()
    db.add(PMSProjectMember(project_id=p.id, user_id=current_user.id, role="pm", added_by=current_user.id))
    db.commit()
    db.refresh(p)
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["members"] = []
    return d

@router.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    _require_member(db, project_id, current_user)
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["members"] = [
        {"id": m.id, "user_id": m.user_id, "role": m.role,
         "user_name": m.user.full_name if m.user else None,
         "user_email": m.user.email if m.user else None}
        for m in p.members
    ]
    return d

@router.put("/projects/{project_id}")
def update_project(project_id: int, data: PMSProjectUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404)
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403, "PM or admin only")
    for k, v in data.dict(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["members"] = []
    return d

@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403)
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404)
    db.delete(p)
    db.commit()
    return {"ok": True}

# ── Members ───────────────────────────────────────────────

@router.get("/projects/{project_id}/members")
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
        existing.role = data.role
        db.commit()
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
    if not mem:
        raise HTTPException(404)
    db.delete(mem)
    db.commit()
    return {"ok": True}

# ── Milestones ────────────────────────────────────────────

@router.get("/projects/{project_id}/milestones")
def list_milestones(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    return db.query(PMSMilestone).filter_by(project_id=project_id).all()

@router.post("/projects/{project_id}/milestones")
def create_milestone(project_id: int, data: PMSMilestoneCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403)
    ms = PMSMilestone(**data.dict(), project_id=project_id)
    db.add(ms)
    db.commit()
    db.refresh(ms)
    return ms

@router.put("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, data: PMSMilestoneUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ms = db.query(PMSMilestone).filter_by(id=milestone_id).first()
    if not ms:
        raise HTTPException(404)
    _require_member(db, ms.project_id, current_user)
    for k, v in data.dict(exclude_none=True).items():
        setattr(ms, k, v)
    db.commit()
    db.refresh(ms)
    return ms

@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ms = db.query(PMSMilestone).filter_by(id=milestone_id).first()
    if not ms:
        raise HTTPException(404)
    m = _require_member(db, ms.project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403)
    db.delete(ms)
    db.commit()
    return {"ok": True}

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
    db.add(task)
    db.flush()
    db.add(PMSWorkflowHistory(task_id=task.id, from_stage=None, to_stage="development", moved_by=current_user.id, note="Task created"))
    db.commit()
    db.refresh(task)
    return _enrich_task(task, db)

@router.get("/tasks/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    return _enrich_task(task, db)

@router.put("/tasks/{task_id}")
def update_task(task_id: int, data: PMSTaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    if data.assignee_id:
        if not _get_membership(db, task.project_id, data.assignee_id) and not _is_admin(current_user):
            raise HTTPException(400, "Assignee must be a project member")
    for k, v in data.dict(exclude_none=True).items():
        setattr(task, k, v)
    db.commit()
    db.refresh(task)
    return _enrich_task(task, db)

@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    m = _require_member(db, task.project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403)
    db.delete(task)
    db.commit()
    return {"ok": True}

# ── Workflow ──────────────────────────────────────────────

@router.post("/tasks/{task_id}/transition")
def transition_task(task_id: int, data: PMSTransitionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    m = _require_member(db, task.project_id, current_user)
    allowed = WORKFLOW_TRANSITIONS.get(task.stage, {}).get(data.to_stage, [])
    if not allowed:
        raise HTTPException(400, f"No transition from {task.stage} to {data.to_stage}")
    if m.role not in allowed and not _is_admin(current_user):
        raise HTTPException(403, f"Role '{m.role}' cannot perform this transition")
    old_stage = task.stage
    task.stage = data.to_stage
    db.add(PMSWorkflowHistory(task_id=task.id, from_stage=old_stage, to_stage=data.to_stage, moved_by=current_user.id, note=data.note))
    db.commit()
    return {"ok": True, "stage": task.stage}

@router.get("/tasks/{task_id}/history")
def get_task_history(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    history = db.query(PMSWorkflowHistory).filter_by(task_id=task_id).order_by(PMSWorkflowHistory.created_at).all()
    return [{"id": h.id, "from_stage": h.from_stage, "to_stage": h.to_stage,
             "moved_by": h.moved_by, "actor_name": h.actor.full_name if h.actor else None,
             "note": h.note, "created_at": h.created_at} for h in history]

# ── Dependencies ──────────────────────────────────────────

@router.post("/tasks/{task_id}/dependencies")
def add_dependency(task_id: int, data: PMSDependencyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    if task_id == data.depends_on_id:
        raise HTTPException(400, "Cannot depend on self")
    dep = PMSTaskDependency(task_id=task_id, depends_on_id=data.depends_on_id, type=data.type)
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return {"id": dep.id, "task_id": dep.task_id, "depends_on_id": dep.depends_on_id, "type": dep.type}

@router.delete("/dependencies/{dep_id}")
def remove_dependency(dep_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    dep = db.query(PMSTaskDependency).filter_by(id=dep_id).first()
    if not dep:
        raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=dep.task_id).first()
    _require_member(db, task.project_id, current_user)
    db.delete(dep)
    db.commit()
    return {"ok": True}

# ── Comments ──────────────────────────────────────────────

@router.get("/tasks/{task_id}/comments")
def list_comments(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    comments = db.query(PMSTaskComment).filter_by(task_id=task_id).order_by(PMSTaskComment.created_at).all()
    return [{"id": c.id, "task_id": c.task_id, "user_id": c.user_id,
             "user_name": c.user.full_name if c.user else None,
             "content": c.content, "created_at": c.created_at} for c in comments]

@router.post("/tasks/{task_id}/comments")
def create_comment(task_id: int, data: PMSCommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    c = PMSTaskComment(task_id=task_id, user_id=current_user.id, content=data.content)
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "task_id": c.task_id, "user_id": c.user_id,
            "user_name": current_user.full_name, "content": c.content, "created_at": c.created_at}

@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(PMSTaskComment).filter_by(id=comment_id).first()
    if not c:
        raise HTTPException(404)
    if c.user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(403)
    db.delete(c)
    db.commit()
    return {"ok": True}

# ── Time Logs ─────────────────────────────────────────────

@router.get("/tasks/{task_id}/timelogs")
def list_timelogs(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    logs = db.query(PMSTaskTimeLog).filter_by(task_id=task_id).order_by(PMSTaskTimeLog.created_at).all()
    return [{"id": l.id, "task_id": l.task_id, "user_id": l.user_id,
             "user_name": l.user.full_name if l.user else None,
             "hours": l.hours, "log_date": l.log_date, "note": l.note, "created_at": l.created_at} for l in logs]

@router.post("/tasks/{task_id}/timelogs")
def log_time(task_id: int, data: PMSTimeLogCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    log = PMSTaskTimeLog(task_id=task_id, user_id=current_user.id, hours=data.hours, note=data.note,
                         log_date=data.log_date or date.today())
    db.add(log)
    db.flush()
    total = db.query(sqlfunc.sum(PMSTaskTimeLog.hours)).filter_by(task_id=task_id).scalar() or 0
    task.actual_hours = total
    over_hours = task.estimated_hours > 0 and total > task.estimated_hours
    db.commit()
    if over_hours:
        _fire_alert(db, task, "over_hours", f"Task '{task.title}' exceeded estimated hours ({task.estimated_hours}h). Logged: {total:.1f}h")
    return {"ok": True, "actual_hours": total, "over_hours": over_hours}

@router.delete("/timelogs/{log_id}")
def delete_timelog(log_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    log = db.query(PMSTaskTimeLog).filter_by(id=log_id).first()
    if not log:
        raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=log.task_id).first()
    _require_member(db, task.project_id, current_user)
    db.delete(log)
    db.flush()
    total = db.query(sqlfunc.sum(PMSTaskTimeLog.hours)).filter(
        PMSTaskTimeLog.task_id == task.id, PMSTaskTimeLog.id != log_id
    ).scalar() or 0
    task.actual_hours = total
    db.commit()
    return {"ok": True}

# ── Attachments ───────────────────────────────────────────

@router.post("/tasks/{task_id}/attachments")
async def upload_attachment(task_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    safe_name = file.filename.replace("/", "_").replace("..", "_")
    dest = os.path.join(ATTACHMENT_DIR, f"{task_id}_{safe_name}")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    size = os.path.getsize(dest)
    att = PMSTaskAttachment(task_id=task_id, file_path=dest, file_name=file.filename, file_size=size, uploaded_by=current_user.id)
    db.add(att)
    db.commit()
    db.refresh(att)
    return {"id": att.id, "file_name": att.file_name, "file_size": att.file_size}

@router.delete("/attachments/{att_id}")
def delete_attachment(att_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    att = db.query(PMSTaskAttachment).filter_by(id=att_id).first()
    if not att:
        raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=att.task_id).first()
    _require_member(db, task.project_id, current_user)
    if os.path.exists(att.file_path):
        os.remove(att.file_path)
    db.delete(att)
    db.commit()
    return {"ok": True}

# ── Alerts ────────────────────────────────────────────────

@router.get("/alerts")
def list_alerts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PMSAlert).filter_by(notified_user_id=current_user.id, is_read=False).order_by(PMSAlert.created_at.desc()).limit(50).all()

@router.post("/alerts/{alert_id}/read")
def mark_alert_read(alert_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    alert = db.query(PMSAlert).filter_by(id=alert_id, notified_user_id=current_user.id).first()
    if not alert:
        raise HTTPException(404)
    alert.is_read = True
    db.commit()
    return {"ok": True}

# ── Gantt ─────────────────────────────────────────────────

@router.get("/projects/{project_id}/gantt")
def get_gantt(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    p = db.query(PMSProject).filter_by(id=project_id).first()
    if not p:
        raise HTTPException(404)
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
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    _require_member(db, project_id, current_user)
    count = db.query(PMSTask).filter_by(project_id=project_id).count()
    task = PMSTask(
        project_id=project_id,
        title=f"[Ticket #{ticket.ticket_number}] {ticket.category or 'Task'}",
        description=f"Created from ticket #{ticket.ticket_number}",
        ticket_id=ticket_id,
        position=count
    )
    db.add(task)
    db.flush()
    db.add(PMSWorkflowHistory(task_id=task.id, from_stage=None, to_stage="development", moved_by=current_user.id, note="Created from ticket"))
    db.commit()
    db.refresh(task)
    return _enrich_task(task, db)

# ── Labels (Global Library) ──────────────────────────────

@router.get("/labels")
def list_labels(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PMSLabelDefinition).order_by(PMSLabelDefinition.name).all()

@router.post("/labels")
def create_label(data: PMSLabelDefCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admins only")
    existing = db.query(PMSLabelDefinition).filter_by(name=data.name).first()
    if existing:
        raise HTTPException(400, "Label name already exists")
    label = PMSLabelDefinition(name=data.name, color=data.color, created_by=current_user.id)
    db.add(label)
    db.commit()
    db.refresh(label)
    return label

@router.put("/labels/{label_id}")
def update_label(label_id: int, data: PMSLabelDefUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admins only")
    label = db.query(PMSLabelDefinition).filter_by(id=label_id).first()
    if not label:
        raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(label, k, v)
    db.commit()
    db.refresh(label)
    return label

@router.delete("/labels/{label_id}")
def delete_label(label_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403)
    label = db.query(PMSLabelDefinition).filter_by(id=label_id).first()
    if not label:
        raise HTTPException(404)
    db.delete(label)
    db.commit()
    return {"ok": True}

@router.post("/tasks/{task_id}/labels/{label_id}")
def attach_label(task_id: int, label_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    label_def = db.query(PMSLabelDefinition).filter_by(id=label_id).first()
    if not label_def:
        raise HTTPException(404, "Label not found")
    existing = db.query(PMSTaskLabel).filter_by(task_id=task_id, label_definition_id=label_id).first()
    if existing:
        return {"ok": True, "already_attached": True}
    db.add(PMSTaskLabel(task_id=task_id, name=label_def.name, color=label_def.color, label_definition_id=label_id))
    db.commit()
    return {"ok": True}

@router.delete("/tasks/{task_id}/labels/{label_id}")
def detach_label(task_id: int, label_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    tl = db.query(PMSTaskLabel).filter_by(task_id=task_id, label_definition_id=label_id).first()
    if not tl:
        raise HTTPException(404)
    db.delete(tl)
    db.commit()
    return {"ok": True}
