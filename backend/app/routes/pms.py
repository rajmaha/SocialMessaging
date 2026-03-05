from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
from datetime import date, datetime, timedelta
import os, shutil

from app.database import get_db
from app.dependencies import get_current_user, require_page
from app.models.user import User
from app.models.pms import (
    PMSProject, PMSProjectMember, PMSMilestone, PMSTask,
    PMSTaskDependency, PMSTaskComment, PMSTaskTimeLog,
    PMSTaskAttachment, PMSTaskLabel, PMSWorkflowHistory, PMSAlert,
    PMSLabelDefinition, PMSAuditLog
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
    d["efficiency"] = _task_efficiency(task)
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

def _business_days(start: date, end: date) -> int:
    if not start or not end or end <= start:
        return 0
    days = 0
    current = start
    while current < end:
        if current.weekday() < 5:
            days += 1
        current += timedelta(days=1)
    return max(days, 1)

def _task_efficiency(task, today=None):
    if not task.estimated_hours or task.estimated_hours <= 0 or not task.start_date:
        return None
    today = today or date.today()
    end = today if task.stage != "completed" else (task.updated_at.date() if task.updated_at else today)
    bdays = _business_days(task.start_date, end)
    capacity = bdays * 7
    if capacity <= 0:
        return None
    return min(round((task.estimated_hours / capacity) * 100, 1), 100.0)

import json as _json

def _audit_log(db: Session, project_id: int, action_type: str, actor_id: int, details: dict, task_id: int = None):
    db.add(PMSAuditLog(
        project_id=project_id,
        task_id=task_id,
        action_type=action_type,
        actor_id=actor_id,
        details=_json.dumps(details),
    ))

def _is_pm(db: Session, user: User) -> bool:
    if _is_admin(user):
        return True
    return db.query(PMSProjectMember).filter_by(user_id=user.id, role="pm").first() is not None

def _pm_project_ids(db: Session, user: User) -> list:
    if _is_admin(user):
        return [p.id for p in db.query(PMSProject.id).all()]
    return [m.project_id for m in db.query(PMSProjectMember).filter_by(user_id=user.id, role="pm").all()]

def _require_pm_or_admin(db: Session, user: User):
    if not _is_pm(db, user):
        raise HTTPException(403, "PM or admin role required")

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
    _audit_log(db, project_id, "member_added", current_user.id,
               {"user_id": data.user_id, "role": data.role})
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
    _audit_log(db, project_id, "member_removed", current_user.id,
               {"user_id": user_id})
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
    _audit_log(db, ms.project_id, "milestone_change", current_user.id,
               {"milestone": ms.name, "changes": data.dict(exclude_unset=True)})
    db.commit()
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
    # Before updates: capture old assignee
    old_assignee_name = task.assignee.full_name if task.assignee else None
    old_assignee_id = task.assignee_id
    for k, v in data.dict(exclude_none=True).items():
        setattr(task, k, v)
    db.commit()
    db.refresh(task)
    if data.assignee_id is not None and data.assignee_id != old_assignee_id:
        new_assignee = db.query(User).filter_by(id=data.assignee_id).first()
        _audit_log(db, task.project_id, "assignee_change", current_user.id,
                   {"task_title": task.title, "from": old_assignee_name, "to": new_assignee.full_name if new_assignee else None}, task.id)
        db.commit()
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
    wh = PMSWorkflowHistory(task_id=task.id, from_stage=old_stage, to_stage=data.to_stage, moved_by=current_user.id, note=data.note)
    db.add(wh)
    db.commit()
    _audit_log(db, task.project_id, "stage_change", current_user.id,
               {"task_title": task.title, "from": wh.from_stage, "to": data.to_stage, "note": data.note}, task.id)
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

# ── Dashboard ─────────────────────────────────────────────

@router.get("/dashboard")
def get_dashboard(stale_days: int = 7, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    stale_cutoff = today - timedelta(days=stale_days)

    if _is_admin(current_user):
        projects = db.query(PMSProject).all()
        all_tasks = db.query(PMSTask).all()
    else:
        memberships = db.query(PMSProjectMember).filter_by(user_id=current_user.id).all()
        project_ids = [m.project_id for m in memberships]
        projects = db.query(PMSProject).filter(PMSProject.id.in_(project_ids)).all() if project_ids else []
        all_tasks = db.query(PMSTask).filter(PMSTask.project_id.in_(project_ids)).all() if project_ids else []

    total_tasks = len(all_tasks)
    completed_tasks = sum(1 for t in all_tasks if t.stage == "completed")
    overdue_tasks = [t for t in all_tasks if t.due_date and t.due_date < today and t.stage not in ("approved", "completed")]
    urgent_client = [t for t in all_tasks if (t.stage == "client_review" or t.priority == "urgent") and t.stage != "completed"]
    stale_tasks = [t for t in all_tasks if t.priority in ("low", "medium") and t.created_at and t.created_at.date() <= stale_cutoff and t.stage in ("development", "qa")]

    total_estimated = sum(t.estimated_hours or 0 for t in all_tasks)
    total_actual = sum(t.actual_hours or 0 for t in all_tasks)
    active_projects = sum(1 for p in projects if p.status == "active")

    my_tasks = sorted(
        [t for t in all_tasks if t.assignee_id == current_user.id and t.stage != "completed"],
        key=lambda t: (0 if t.due_date and t.due_date < today else 1, t.due_date or date.max)
    )[:5]
    my_tasks_data = []
    for t in my_tasks:
        project = next((p for p in projects if p.id == t.project_id), None)
        my_tasks_data.append({
            "id": t.id, "title": t.title, "priority": t.priority, "stage": t.stage,
            "due_date": t.due_date,
            "project_id": t.project_id,
            "project_name": project.name if project else None,
            "project_color": project.color if project else None,
            "efficiency": _task_efficiency(t, today),
        })

    project_cards = []
    for p in projects:
        p_tasks = [t for t in all_tasks if t.project_id == p.id]
        p_total = len(p_tasks)
        p_completed = sum(1 for t in p_tasks if t.stage == "completed")
        p_overdue = sum(1 for t in p_tasks if t.due_date and t.due_date < today and t.stage not in ("approved", "completed"))
        efficiencies = [_task_efficiency(t, today) for t in p_tasks if t.stage != "completed"]
        efficiencies = [e for e in efficiencies if e is not None]
        p_efficiency = round(sum(efficiencies) / len(efficiencies), 1) if efficiencies else None
        d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        d["total_tasks"] = p_total
        d["completed_tasks"] = p_completed
        d["overdue_count"] = p_overdue
        d["efficiency"] = p_efficiency
        d["members"] = [{"user_id": m.user_id, "role": m.role, "user_name": m.user.full_name if m.user else None} for m in p.members]
        project_cards.append(d)

    my_active = [t for t in all_tasks if t.assignee_id == current_user.id and t.stage != "completed"]
    my_efficiencies = [_task_efficiency(t, today) for t in my_active]
    my_efficiencies = [e for e in my_efficiencies if e is not None]
    my_avg_efficiency = round(sum(my_efficiencies) / len(my_efficiencies), 1) if my_efficiencies else None

    # PM/Admin enhancements
    is_pm = _is_pm(db, current_user)
    is_admin_user = _is_admin(current_user)

    approval_counts = {"pm_review": 0, "client_review": 0}
    if is_pm:
        pm_pids = _pm_project_ids(db, current_user)
        if pm_pids:
            approval_counts["pm_review"] = db.query(PMSTask).filter(
                PMSTask.project_id.in_(pm_pids), PMSTask.stage == "pm_review"
            ).count()
            approval_counts["client_review"] = db.query(PMSTask).filter(
                PMSTask.project_id.in_(pm_pids), PMSTask.stage == "client_review"
            ).count()

    escalation_count = 0
    if is_admin_user:
        esc_tasks = db.query(PMSTask).filter(PMSTask.stage.notin_(["approved", "completed"])).all()
        for t in esc_tasks:
            has_trigger = False
            if t.due_date and (today - t.due_date).days >= 3:
                has_trigger = True
            if t.estimated_hours and t.estimated_hours > 0 and t.actual_hours > t.estimated_hours * 1.5:
                has_trigger = True
            if t.stage in ("development", "qa"):
                last_wh = db.query(PMSWorkflowHistory).filter_by(task_id=t.id).order_by(
                    PMSWorkflowHistory.created_at.desc()).first()
                stuck_since = last_wh.created_at if last_wh else t.created_at
                if stuck_since and (datetime.utcnow() - stuck_since).days >= 7:
                    has_trigger = True
            if has_trigger:
                escalation_count += 1

    health_score = None
    if is_admin_user and total_tasks > 0:
        completion_rate = completed_tasks / total_tasks * 100
        on_time_completed = sum(1 for t in all_tasks if t.stage == "completed" and t.due_date and t.updated_at and t.updated_at.date() <= t.due_date)
        on_time_rate = on_time_completed / completed_tasks * 100 if completed_tasks else 0
        all_eff = [_task_efficiency(t, today) for t in all_tasks if t.stage != "completed"]
        all_eff = [e for e in all_eff if e is not None]
        avg_eff = sum(all_eff) / len(all_eff) if all_eff else 50
        health_score = round(completion_rate * 0.4 + on_time_rate * 0.3 + avg_eff * 0.3, 1)

    week_start = today - timedelta(days=today.weekday())
    weekly_digest = None
    if is_pm:
        week_completed = sum(1 for t in all_tasks if t.stage == "completed" and t.updated_at and t.updated_at.date() >= week_start)
        week_new_overdue = sum(1 for t in all_tasks if t.due_date and week_start <= t.due_date < today and t.stage not in ("approved", "completed"))
        week_created = sum(1 for t in all_tasks if t.created_at and t.created_at.date() >= week_start)
        week_transitions = db.query(PMSWorkflowHistory).filter(
            PMSWorkflowHistory.created_at >= datetime.combine(week_start, datetime.min.time())
        ).count()
        weekly_digest = {
            "completed": week_completed,
            "new_overdue": week_new_overdue,
            "created": week_created,
            "transitions": week_transitions,
        }

    upcoming_deadlines = []
    if is_pm:
        deadline_cutoff = today + timedelta(days=30)
        pm_pids_list = _pm_project_ids(db, current_user)
        if pm_pids_list:
            upcoming_ms = db.query(PMSMilestone).filter(
                PMSMilestone.project_id.in_(pm_pids_list),
                PMSMilestone.due_date >= today,
                PMSMilestone.due_date <= deadline_cutoff,
                PMSMilestone.status != "reached",
            ).order_by(PMSMilestone.due_date).all()
            for ms in upcoming_ms:
                proj = next((p for p in projects if p.id == ms.project_id), None)
                upcoming_deadlines.append({
                    "type": "milestone", "title": ms.name, "due_date": ms.due_date,
                    "project_name": proj.name if proj else None, "project_color": proj.color if proj else None,
                })
            upcoming_tasks_list = db.query(PMSTask).filter(
                PMSTask.project_id.in_(pm_pids_list),
                PMSTask.due_date >= today,
                PMSTask.due_date <= deadline_cutoff,
                PMSTask.stage.notin_(["approved", "completed"]),
            ).order_by(PMSTask.due_date).limit(20).all()
            for t in upcoming_tasks_list:
                proj = next((p for p in projects if p.id == t.project_id), None)
                upcoming_deadlines.append({
                    "type": "task", "title": t.title, "due_date": t.due_date,
                    "project_name": proj.name if proj else None, "project_color": proj.color if proj else None,
                    "priority": t.priority,
                })
            upcoming_deadlines.sort(key=lambda x: x["due_date"])

    cross_project_summary = []
    if is_admin_user:
        for p in projects:
            p_tasks = [t for t in all_tasks if t.project_id == p.id]
            p_total = len(p_tasks)
            p_completed = sum(1 for t in p_tasks if t.stage == "completed")
            p_overdue = sum(1 for t in p_tasks if t.due_date and t.due_date < today and t.stage not in ("approved", "completed"))
            p_efficiencies = [_task_efficiency(t, today) for t in p_tasks if t.stage != "completed"]
            p_efficiencies = [e for e in p_efficiencies if e is not None]
            p_eff = round(sum(p_efficiencies) / len(p_efficiencies), 1) if p_efficiencies else None
            pm_member = next((m for m in p.members if m.role == "pm"), None)
            pm_name = pm_member.user.full_name if pm_member and pm_member.user else None
            p_on_time = sum(1 for t in p_tasks if t.stage == "completed" and t.due_date and t.updated_at and t.updated_at.date() <= t.due_date)
            p_on_time_rate = round(p_on_time / p_completed * 100, 1) if p_completed else 0
            p_completion_rate = round(p_completed / p_total * 100, 1) if p_total else 0
            p_health = round(p_completion_rate * 0.4 + p_on_time_rate * 0.3 + (p_eff or 50) * 0.3, 1)
            cross_project_summary.append({
                "id": p.id, "name": p.name, "color": p.color, "status": p.status,
                "pm_name": pm_name,
                "total_tasks": p_total, "completed_tasks": p_completed,
                "completion_pct": p_completion_rate,
                "overdue_count": p_overdue,
                "efficiency": p_eff,
                "health_score": p_health,
            })

    return {
        "metrics": {
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "completion_pct": round(completed_tasks / total_tasks * 100, 1) if total_tasks else 0,
            "overdue_count": len(overdue_tasks),
            "urgent_client_count": len(urgent_client),
            "stale_count": len(stale_tasks),
            "stale_days": stale_days,
            "total_estimated_hours": round(total_estimated, 1),
            "total_actual_hours": round(total_actual, 1),
            "hours_utilization_pct": round(total_actual / total_estimated * 100, 1) if total_estimated else 0,
            "active_projects": active_projects,
            "total_projects": len(projects),
        },
        "my_tasks": my_tasks_data,
        "my_avg_efficiency": my_avg_efficiency,
        "projects": project_cards,
        "is_pm": is_pm,
        "is_admin": is_admin_user,
        "approval_counts": approval_counts,
        "escalation_count": escalation_count,
        "health_score": health_score,
        "weekly_digest": weekly_digest,
        "upcoming_deadlines": upcoming_deadlines,
        "cross_project_summary": cross_project_summary,
    }

# ── My Tasks ──────────────────────────────────────────────

@router.get("/my-tasks")
def get_my_tasks(
    stage: Optional[str] = None,
    priority: Optional[str] = None,
    project_id: Optional[int] = None,
    due_from: Optional[date] = None,
    due_to: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    q = db.query(PMSTask).filter(PMSTask.assignee_id == current_user.id)
    if stage:
        q = q.filter(PMSTask.stage == stage)
    if priority:
        q = q.filter(PMSTask.priority == priority)
    if project_id:
        q = q.filter(PMSTask.project_id == project_id)
    if due_from:
        q = q.filter(PMSTask.due_date >= due_from)
    if due_to:
        q = q.filter(PMSTask.due_date <= due_to)
    tasks = q.order_by(PMSTask.due_date.asc().nullslast()).all()

    result = []
    project_cache = {}
    for t in tasks:
        if t.project_id not in project_cache:
            p = db.query(PMSProject).filter_by(id=t.project_id).first()
            project_cache[t.project_id] = p
        p = project_cache[t.project_id]
        result.append({
            "id": t.id, "title": t.title, "description": t.description,
            "stage": t.stage, "priority": t.priority,
            "due_date": t.due_date, "start_date": t.start_date,
            "estimated_hours": t.estimated_hours, "actual_hours": t.actual_hours,
            "project_id": t.project_id,
            "project_name": p.name if p else None,
            "project_color": p.color if p else None,
            "labels": [{"id": l.id, "name": l.name, "color": l.color} for l in t.labels],
            "efficiency": _task_efficiency(t, today),
            "is_overdue": bool(t.due_date and t.due_date < today and t.stage not in ("approved", "completed")),
            "created_at": t.created_at,
        })
    return result


@router.get("/reports")
def get_reports(
    project_id: Optional[int] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from collections import defaultdict
    today = date.today()
    start = start_date or (today - timedelta(days=56))
    end = end_date or today

    q = db.query(PMSTask)
    if project_id:
        _require_member(db, project_id, current_user)
        q = q.filter(PMSTask.project_id == project_id)
    elif not _is_admin(current_user):
        memberships = db.query(PMSProjectMember).filter_by(user_id=current_user.id).all()
        pids = [m.project_id for m in memberships]
        q = q.filter(PMSTask.project_id.in_(pids)) if pids else q.filter(False)
    tasks = q.all()

    # Priority distribution
    priority_dist = defaultdict(int)
    for t in tasks:
        priority_dist[t.priority] += 1

    # Stage cycle time
    stages = ["development", "qa", "pm_review", "client_review", "approved", "completed"]
    stage_times = {s: [] for s in stages}
    for t in tasks:
        history = db.query(PMSWorkflowHistory).filter_by(task_id=t.id).order_by(PMSWorkflowHistory.created_at).all()
        for i, h in enumerate(history):
            if h.to_stage in stage_times:
                entered = h.created_at
                exited = history[i+1].created_at if i+1 < len(history) else (datetime.utcnow() if t.stage == h.to_stage else None)
                if entered and exited:
                    days = (exited - entered).total_seconds() / 86400
                    stage_times[h.to_stage].append(days)
    avg_stage_times = {s: round(sum(v)/len(v), 1) if v else 0 for s, v in stage_times.items()}

    # Velocity (last 8 weeks)
    velocity = []
    for w in range(8):
        week_start = today - timedelta(days=(7 * (8 - w)))
        week_end = week_start + timedelta(days=7)
        count = sum(1 for t in tasks if t.stage == "completed" and t.updated_at and week_start <= t.updated_at.date() < week_end)
        velocity.append({"week": week_start.isoformat(), "completed": count})

    # Burndown
    burndown = []
    total_created_before_start = sum(1 for t in tasks if t.created_at and t.created_at.date() <= start)
    remaining = total_created_before_start
    for w in range(9):
        snap_date = start + timedelta(days=(7 * w))
        if snap_date > today:
            break
        prev_date = start + timedelta(days=(7*(w-1))) if w > 0 else start
        new_tasks = sum(1 for t in tasks if t.created_at and prev_date < t.created_at.date() <= snap_date)
        completed = sum(1 for t in tasks if t.stage == "completed" and t.updated_at and prev_date < t.updated_at.date() <= snap_date)
        remaining = remaining + new_tasks - completed
        total_at_point = total_created_before_start + sum(1 for t in tasks if t.created_at and t.created_at.date() <= snap_date)
        ideal_remaining = max(0, total_at_point - round(total_at_point * (w / 8)))
        burndown.append({"date": snap_date.isoformat(), "remaining": max(remaining, 0), "ideal": ideal_remaining})

    # Hours by project
    hours_by_project = defaultdict(lambda: {"estimated": 0, "actual": 0, "name": ""})
    project_name_cache = {}
    for t in tasks:
        if t.project_id not in project_name_cache:
            p = db.query(PMSProject).filter_by(id=t.project_id).first()
            project_name_cache[t.project_id] = p.name if p else f"Project {t.project_id}"
        hours_by_project[t.project_id]["estimated"] += t.estimated_hours or 0
        hours_by_project[t.project_id]["actual"] += t.actual_hours or 0
        hours_by_project[t.project_id]["name"] = project_name_cache[t.project_id]
    hours_comparison = [{"project": v["name"], "estimated": round(v["estimated"], 1), "actual": round(v["actual"], 1)} for v in hours_by_project.values()]

    # Milestone progress
    milestones_q = db.query(PMSMilestone)
    if project_id:
        milestones_q = milestones_q.filter_by(project_id=project_id)
    milestones = milestones_q.all()
    milestone_progress = []
    for ms in milestones:
        ms_tasks = [t for t in tasks if t.milestone_id == ms.id]
        total = len(ms_tasks)
        completed = sum(1 for t in ms_tasks if t.stage == "completed")
        milestone_progress.append({
            "id": ms.id, "name": ms.name, "total": total, "completed": completed,
            "pct": round(completed / total * 100, 1) if total else 0,
        })

    # Per-member stats
    member_stats = defaultdict(lambda: {"name": "", "assigned": 0, "completed": 0, "by_priority": defaultdict(int), "efficiencies": []})
    for t in tasks:
        if t.assignee_id:
            name = t.assignee.full_name if t.assignee else f"User {t.assignee_id}"
            member_stats[t.assignee_id]["name"] = name
            member_stats[t.assignee_id]["assigned"] += 1
            member_stats[t.assignee_id]["by_priority"][t.priority] += 1
            if t.stage == "completed":
                member_stats[t.assignee_id]["completed"] += 1
            eff = _task_efficiency(t, today)
            if eff is not None:
                member_stats[t.assignee_id]["efficiencies"].append(eff)

    member_workload = [{"name": s["name"], "total": s["assigned"], **dict(s["by_priority"])} for uid, s in member_stats.items()]
    member_completion = [{"name": s["name"], "assigned": s["assigned"], "completed": s["completed"]} for uid, s in member_stats.items()]
    member_efficiency = [{"name": s["name"], "efficiency": round(sum(s["efficiencies"]) / len(s["efficiencies"]), 1) if s["efficiencies"] else None} for uid, s in member_stats.items()]

    all_eff = [_task_efficiency(t, today) for t in tasks if t.stage != "completed"]
    all_eff = [e for e in all_eff if e is not None]
    project_efficiency = round(sum(all_eff) / len(all_eff), 1) if all_eff else None

    return {
        "burndown": burndown,
        "velocity": velocity,
        "avg_stage_times": avg_stage_times,
        "priority_distribution": dict(priority_dist),
        "milestone_progress": milestone_progress,
        "hours_comparison": hours_comparison,
        "member_workload": member_workload,
        "member_completion": member_completion,
        "member_efficiency": member_efficiency,
        "project_efficiency": project_efficiency,
    }


# ── Team Workload ─────────────────────────────────────────────────────

@router.get("/team-workload")
def get_team_workload(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_pm_or_admin(db, current_user)
    today = date.today()

    if project_id:
        _require_member(db, project_id, current_user)
        pids = [project_id]
    else:
        pids = _pm_project_ids(db, current_user)

    if not pids:
        return {"members": [], "projects": []}

    members = db.query(PMSProjectMember).filter(PMSProjectMember.project_id.in_(pids)).all()
    tasks = db.query(PMSTask).filter(PMSTask.project_id.in_(pids), PMSTask.stage != "completed").all()

    from collections import defaultdict
    user_data = defaultdict(lambda: {
        "user_id": 0, "name": "", "role": "", "active_tasks": 0,
        "estimated_hours": 0, "actual_hours": 0, "overdue_count": 0,
        "stage_breakdown": defaultdict(int), "efficiencies": [],
    })

    for t in tasks:
        if not t.assignee_id:
            continue
        uid = t.assignee_id
        user_data[uid]["user_id"] = uid
        user_data[uid]["name"] = t.assignee.full_name if t.assignee else f"User {uid}"
        user_data[uid]["active_tasks"] += 1
        user_data[uid]["estimated_hours"] += t.estimated_hours or 0
        user_data[uid]["actual_hours"] += t.actual_hours or 0
        user_data[uid]["stage_breakdown"][t.stage] += 1
        if t.due_date and t.due_date < today:
            user_data[uid]["overdue_count"] += 1
        eff = _task_efficiency(t, today)
        if eff is not None:
            user_data[uid]["efficiencies"].append(eff)

    for m in members:
        uid = m.user_id
        if uid in user_data:
            user_data[uid]["role"] = m.role
        elif m.user:
            user_data[uid] = {
                "user_id": uid, "name": m.user.full_name if m.user else f"User {uid}",
                "role": m.role, "active_tasks": 0, "estimated_hours": 0,
                "actual_hours": 0, "overdue_count": 0,
                "stage_breakdown": {}, "efficiencies": [],
            }

    result = []
    for uid, d in user_data.items():
        effs = d.pop("efficiencies")
        d["efficiency"] = round(sum(effs) / len(effs), 1) if effs else None
        d["estimated_hours"] = round(d["estimated_hours"], 1)
        d["actual_hours"] = round(d["actual_hours"], 1)
        d["stage_breakdown"] = dict(d["stage_breakdown"])
        result.append(d)

    projects = db.query(PMSProject).filter(PMSProject.id.in_(pids)).all()
    project_options = [{"id": p.id, "name": p.name, "color": p.color} for p in projects]

    return {"members": result, "projects": project_options}


# ── Approval Queue ────────────────────────────────────────────────────

@router.get("/approval-queue")
def get_approval_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_pm_or_admin(db, current_user)
    pids = _pm_project_ids(db, current_user)
    if not pids:
        return {"pm_review": [], "client_review": [], "counts": {"pm_review": 0, "client_review": 0}}

    pm_tasks = db.query(PMSTask).filter(
        PMSTask.project_id.in_(pids), PMSTask.stage == "pm_review"
    ).order_by(PMSTask.due_date.asc().nullslast()).all()

    client_tasks = db.query(PMSTask).filter(
        PMSTask.project_id.in_(pids), PMSTask.stage == "client_review"
    ).order_by(PMSTask.due_date.asc().nullslast()).all()

    today = date.today()
    now = datetime.utcnow()

    def _enrich_approval_task(t):
        last_transition = db.query(PMSWorkflowHistory).filter_by(
            task_id=t.id, to_stage=t.stage
        ).order_by(PMSWorkflowHistory.created_at.desc()).first()
        days_in_stage = round((now - last_transition.created_at).total_seconds() / 86400, 1) if last_transition else None
        project = db.query(PMSProject).filter_by(id=t.project_id).first()
        return {
            "id": t.id, "title": t.title, "priority": t.priority,
            "stage": t.stage, "due_date": t.due_date,
            "assignee_name": t.assignee.full_name if t.assignee else None,
            "assignee_id": t.assignee_id,
            "project_id": t.project_id,
            "project_name": project.name if project else None,
            "project_color": project.color if project else None,
            "is_overdue": bool(t.due_date and t.due_date < today),
            "days_in_stage": days_in_stage,
        }

    return {
        "pm_review": [_enrich_approval_task(t) for t in pm_tasks],
        "client_review": [_enrich_approval_task(t) for t in client_tasks],
        "counts": {"pm_review": len(pm_tasks), "client_review": len(client_tasks)},
    }


# ── Escalation Queue ─────────────────────────────────────────────────

@router.get("/escalations")
def get_escalations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin only")

    today = date.today()
    now = datetime.utcnow()
    tasks = db.query(PMSTask).filter(PMSTask.stage.notin_(["approved", "completed"])).all()

    escalated = []
    for t in tasks:
        triggers = []
        if t.due_date and (today - t.due_date).days >= 3:
            triggers.append({"type": "overdue", "detail": f"{(today - t.due_date).days}d overdue"})
        if t.estimated_hours and t.estimated_hours > 0 and t.actual_hours > t.estimated_hours * 1.5:
            pct = round(t.actual_hours / t.estimated_hours * 100)
            triggers.append({"type": "over_hours", "detail": f"{pct}% of estimated hours"})
        if t.stage in ("development", "qa"):
            last_change = db.query(PMSWorkflowHistory).filter_by(task_id=t.id).order_by(
                PMSWorkflowHistory.created_at.desc()
            ).first()
            stuck_since = last_change.created_at if last_change else t.created_at
            if stuck_since and (now - stuck_since).days >= 7:
                triggers.append({"type": "stuck", "detail": f"stuck {(now - stuck_since).days}d"})

        if not triggers:
            continue

        project = db.query(PMSProject).filter_by(id=t.project_id).first()
        escalated.append({
            "id": t.id, "title": t.title, "priority": t.priority,
            "stage": t.stage, "due_date": t.due_date,
            "assignee_id": t.assignee_id,
            "assignee_name": t.assignee.full_name if t.assignee else None,
            "project_id": t.project_id,
            "project_name": project.name if project else None,
            "project_color": project.color if project else None,
            "triggers": triggers,
            "severity": "critical" if len(triggers) >= 3 else "high" if len(triggers) == 2 else "medium",
            "estimated_hours": t.estimated_hours,
            "actual_hours": t.actual_hours,
        })

    severity_order = {"critical": 0, "high": 1, "medium": 2}
    escalated.sort(key=lambda x: severity_order.get(x["severity"], 3))

    counts = {"critical": 0, "high": 0, "medium": 0}
    for e in escalated:
        counts[e["severity"]] += 1

    return {"escalations": escalated, "counts": counts}


# ── Capacity Planning ─────────────────────────────────────

@router.get("/capacity")
def get_capacity(
    project_id: Optional[int] = None,
    range: str = "this_week",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_pm_or_admin(db, current_user)
    today = date.today()
    import calendar as _cal

    if range == "this_week":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=4)
    elif range == "next_2_weeks":
        start = today
        end = today + timedelta(days=13)
    elif range == "this_month":
        start = today.replace(day=1)
        _, last_day = _cal.monthrange(today.year, today.month)
        end = today.replace(day=last_day)
    elif range == "next_month":
        if today.month == 12:
            start = today.replace(year=today.year + 1, month=1, day=1)
        else:
            start = today.replace(month=today.month + 1, day=1)
        _, last_day = _cal.monthrange(start.year, start.month)
        end = start.replace(day=last_day)
    else:
        start = today
        end = today + timedelta(days=6)

    if project_id:
        _require_member(db, project_id, current_user)
        pids = [project_id]
    else:
        pids = _pm_project_ids(db, current_user)

    if not pids:
        return {"members": [], "summary": {}, "range": {"start": start, "end": end}}

    members = db.query(PMSProjectMember).filter(PMSProjectMember.project_id.in_(pids)).all()
    bdays = _business_days(start, end + timedelta(days=1))

    user_map = {}
    for m in members:
        uid = m.user_id
        if uid not in user_map:
            user_map[uid] = {
                "user_id": uid,
                "name": m.user.full_name if m.user else f"User {uid}",
                "role": m.role,
                "hours_per_day": m.hours_per_day or 7.0,
                "member_id": m.id,
            }
        if (m.hours_per_day or 7.0) > user_map[uid]["hours_per_day"]:
            user_map[uid]["hours_per_day"] = m.hours_per_day or 7.0

    tasks = db.query(PMSTask).filter(
        PMSTask.project_id.in_(pids),
        PMSTask.stage != "completed",
        PMSTask.assignee_id.isnot(None),
    ).all()

    for uid, data in user_map.items():
        capacity = data["hours_per_day"] * bdays
        committed = sum(
            t.estimated_hours or 0 for t in tasks
            if t.assignee_id == uid and t.due_date and start <= t.due_date <= end
        )
        data["capacity"] = round(capacity, 1)
        data["committed"] = round(committed, 1)
        data["available"] = round(capacity - committed, 1)
        data["utilization_pct"] = round(committed / capacity * 100, 1) if capacity > 0 else 0

    result = list(user_map.values())
    total_capacity = sum(m["capacity"] for m in result)
    total_committed = sum(m["committed"] for m in result)

    projects = db.query(PMSProject).filter(PMSProject.id.in_(pids)).all()
    project_options = [{"id": p.id, "name": p.name} for p in projects]

    return {
        "members": result,
        "summary": {
            "total_capacity": round(total_capacity, 1),
            "total_committed": round(total_committed, 1),
            "total_available": round(total_capacity - total_committed, 1),
            "business_days": bdays,
        },
        "range": {"start": start, "end": end},
        "projects": project_options,
    }


@router.patch("/members/{member_id}/hours")
def update_member_hours(
    member_id: int,
    hours_per_day: float,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = db.query(PMSProjectMember).filter_by(id=member_id).first()
    if not member:
        raise HTTPException(404, "Member not found")
    _require_pm_or_admin(db, current_user)
    if hours_per_day < 1 or hours_per_day > 24:
        raise HTTPException(400, "hours_per_day must be between 1 and 24")
    member.hours_per_day = hours_per_day
    db.commit()
    return {"ok": True, "hours_per_day": hours_per_day}


# ── Audit Trail ───────────────────────────────────────────

@router.get("/audit-trail")
def get_audit_trail(
    project_id: Optional[int] = None,
    action_type: Optional[str] = None,
    actor_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = 1,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin only")

    q = db.query(PMSAuditLog)
    if project_id:
        q = q.filter(PMSAuditLog.project_id == project_id)
    if action_type:
        q = q.filter(PMSAuditLog.action_type == action_type)
    if actor_id:
        q = q.filter(PMSAuditLog.actor_id == actor_id)
    if date_from:
        q = q.filter(PMSAuditLog.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(PMSAuditLog.created_at <= datetime.combine(date_to, datetime.max.time()))

    total = q.count()
    per_page = 50
    logs = q.order_by(PMSAuditLog.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for log in logs:
        result.append({
            "id": log.id,
            "project_id": log.project_id,
            "task_id": log.task_id,
            "action_type": log.action_type,
            "actor_id": log.actor_id,
            "actor_name": log.actor.full_name if log.actor else None,
            "details": _json.loads(log.details) if log.details else {},
            "created_at": log.created_at,
        })

    projects = db.query(PMSProject).all()
    actors_ids = db.query(PMSAuditLog.actor_id).distinct().all()
    actors = []
    for (aid,) in actors_ids:
        if aid:
            u = db.query(User).filter_by(id=aid).first()
            if u:
                actors.append({"id": u.id, "name": u.full_name})

    return {
        "logs": result,
        "total": total,
        "page": page,
        "pages": (total + per_page - 1) // per_page,
        "filters": {
            "projects": [{"id": p.id, "name": p.name} for p in projects],
            "actors": actors,
            "action_types": ["stage_change", "assignee_change", "member_added", "member_removed", "milestone_change"],
        },
    }
