from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
from datetime import date, datetime, timedelta
import os, shutil
import csv, io
from fastapi.responses import StreamingResponse

from app.database import get_db
from app.dependencies import get_current_user, require_page, require_permission
from app.models.user import User
from app.models.pms import (
    PMSProject, PMSProjectMember, PMSMilestone, PMSTask,
    PMSTaskDependency, PMSTaskComment, PMSTaskTimeLog,
    PMSTaskAttachment, PMSTaskLabel, PMSWorkflowHistory, PMSAlert,
    PMSLabelDefinition, PMSAuditLog,
    PMSTaskChecklist, PMSSprint, PMSRecurringTask,
    PMSTaskWatcher, PMSCustomFieldDef, PMSCustomFieldValue,
    PMSTaskTemplate, PMSTemplateItem, PMSFavorite,
    PMSProjectTemplate, PMSProjectTemplateMilestone, PMSProjectTemplateTask,
    PMSAutomation, PMSTaskConversationLink
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

def _has_permission(user: User, db: Session, module_key: str, action: str) -> bool:
    """Inline permission check (for places where we need membership + permission)."""
    if _is_admin(user):
        return True
    from app.models.role import Role
    from app.models.user_permission_override import UserPermissionOverride
    role = db.query(Role).filter(Role.slug == user.role).first()
    role_actions = (role.permissions or {}).get(module_key, []) if role else []
    override = db.query(UserPermissionOverride).filter(
        UserPermissionOverride.user_id == user.id,
        UserPermissionOverride.module_key == module_key
    ).first()
    if override:
        effective = set(role_actions) | set(override.granted_actions or []) - set(override.revoked_actions or [])
    else:
        effective = set(role_actions)
    return action in effective

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
    d["watcher_names"] = [w.user.full_name for w in task.watchers if w.user]
    d["checklist_total"] = db.query(PMSTaskChecklist).filter_by(task_id=task.id).count()
    d["checklist_done"] = db.query(PMSTaskChecklist).filter_by(task_id=task.id, is_checked=True).count()
    return d

def _fire_alert(db: Session, task: PMSTask, alert_type: str, message: str):
    recipients = set()
    if task.assignee_id:
        recipients.add(task.assignee_id)
    pm_members = db.query(PMSProjectMember).filter_by(project_id=task.project_id, role="pm").all()
    for pm in pm_members:
        recipients.add(pm.user_id)
    # Also notify watchers
    watchers = db.query(PMSTaskWatcher).filter_by(task_id=task.id).all()
    for w in watchers:
        recipients.add(w.user_id)
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

import asyncio
import threading

def _broadcast_pms_event(event_type: str, data: dict, user_ids: list, db: Session):
    """Fire-and-forget PMS event broadcast to specified users. Works from both sync and async contexts."""
    from app.services.events_service import events_service
    tz = events_service.get_timezone(db)
    event = events_service.create_event(event_type, data, db, tz)

    async def _send():
        for uid in user_ids:
            try:
                await events_service.broadcast_to_user(uid, event)
            except Exception:
                pass

    # Try to schedule on running loop (async context)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_send())
        return
    except RuntimeError:
        pass

    # Sync context: run in a new thread with its own loop
    def _run():
        asyncio.run(_send())
    threading.Thread(target=_run, daemon=True).start()

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
def create_project(data: PMSProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("pms", "add"))):
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
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403, "PM or edit permission required")
    for k, v in data.dict(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["members"] = []
    return d

@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _has_permission(current_user, db, "pms", "delete"):
        raise HTTPException(403, "Delete permission required")
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
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403, "PM or edit permission required")
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
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403, "PM or edit permission required")
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
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms_milestones", "add"):
        raise HTTPException(403, "PM or milestone add permission required")
    ms = PMSMilestone(**data.dict(), project_id=project_id)
    db.add(ms)
    db.commit()
    db.refresh(ms)
    return ms

@router.put("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, data: PMSMilestoneUpdateV2, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms_milestones", "delete"):
        raise HTTPException(403, "PM or milestone delete permission required")
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
        if not _get_membership(db, project_id, data.assignee_id) and not _has_permission(current_user, db, "pms_tasks", "assign"):
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
        if not _get_membership(db, task.project_id, data.assignee_id) and not _has_permission(current_user, db, "pms_tasks", "assign"):
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
        _broadcast_pms_event("pms_task_assigned", {"task_id": task.id, "task_title": task.title, "assigned_by": current_user.full_name, "project_name": task.project.name}, [data.assignee_id], db)
    # Check automations: if this task is completed and has a parent, check all_subtasks_complete on parent
    if task.stage == "completed" and task.parent_task_id:
        parent = db.query(PMSTask).filter_by(id=task.parent_task_id).first()
        if parent:
            _evaluate_automations(db, parent, "all_subtasks_complete", {})
    return _enrich_task(task, db)

@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    m = _require_member(db, task.project_id, current_user)
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms_tasks", "delete"):
        raise HTTPException(403, "PM or task delete permission required")
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
    if m.role not in allowed and not _has_permission(current_user, db, "pms_tasks", "edit"):
        raise HTTPException(403, f"Role '{m.role}' cannot perform this transition")
    old_stage = task.stage
    task.stage = data.to_stage
    wh = PMSWorkflowHistory(task_id=task.id, from_stage=old_stage, to_stage=data.to_stage, moved_by=current_user.id, note=data.note)
    db.add(wh)
    db.commit()
    _audit_log(db, task.project_id, "stage_change", current_user.id,
               {"task_title": task.title, "from": wh.from_stage, "to": data.to_stage, "note": data.note}, task.id)
    db.commit()
    # Broadcast transition event
    notify_ids = set()
    if task.assignee_id:
        notify_ids.add(task.assignee_id)
    pm_ids = [m.user_id for m in db.query(PMSProjectMember).filter_by(project_id=task.project_id, role="pm").all()]
    notify_ids.update(pm_ids)
    watcher_ids = [w.user_id for w in db.query(PMSTaskWatcher).filter_by(task_id=task.id).all()]
    notify_ids.update(watcher_ids)
    notify_ids.discard(current_user.id)
    _broadcast_pms_event("pms_task_transitioned", {"task_id": task.id, "task_title": task.title, "from_stage": old_stage, "to_stage": data.to_stage, "moved_by": current_user.full_name}, list(notify_ids), db)
    _evaluate_automations(db, task, "stage_change", {"from_stage": old_stage, "to_stage": data.to_stage})
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
    if task.assignee_id and task.assignee_id != current_user.id:
        _broadcast_pms_event("pms_comment_added", {"task_id": task.id, "task_title": task.title, "comment_by": current_user.full_name, "content_preview": data.content[:80]}, [task.assignee_id], db)
    return {"id": c.id, "task_id": c.task_id, "user_id": c.user_id,
            "user_name": current_user.full_name, "content": c.content, "created_at": c.created_at}

@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(PMSTaskComment).filter_by(id=comment_id).first()
    if not c:
        raise HTTPException(404)
    if c.user_id != current_user.id and not _has_permission(current_user, db, "pms_tasks", "delete"):
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
    # Check for existing file with same name (versioning)
    existing = db.query(PMSTaskAttachment).filter_by(task_id=task_id, file_name=file.filename, replaced_by=None).first()
    version = 1
    if existing:
        version = (existing.version or 1) + 1
    att = PMSTaskAttachment(task_id=task_id, file_path=dest, file_name=file.filename, file_size=size, uploaded_by=current_user.id, version=version)
    db.add(att)
    db.flush()
    if existing:
        existing.replaced_by = att.id
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

@router.get("/tasks/{task_id}/attachments")
def list_attachments(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    atts = db.query(PMSTaskAttachment).filter_by(task_id=task_id, replaced_by=None).order_by(PMSTaskAttachment.created_at.desc()).all()
    result = []
    for a in atts:
        uploader = db.query(User).filter_by(id=a.uploaded_by).first()
        result.append({
            "id": a.id,
            "file_name": a.file_name,
            "file_size": a.file_size,
            "version": a.version,
            "uploaded_by": a.uploaded_by,
            "uploaded_by_name": uploader.full_name if uploader else None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return result

@router.get("/attachments/{att_id}/download")
def download_attachment(att_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from fastapi.responses import FileResponse
    att = db.query(PMSTaskAttachment).filter_by(id=att_id).first()
    if not att:
        raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=att.task_id).first()
    _require_member(db, task.project_id, current_user)
    if not os.path.exists(att.file_path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(att.file_path, filename=att.file_name, media_type="application/octet-stream")

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
    if not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403, "Edit permission required")
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
    if not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403, "Edit permission required")
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
    if not _has_permission(current_user, db, "pms", "delete"):
        raise HTTPException(403, "Delete permission required")
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

    # Admin-only: Project comparison and team velocity comparison
    project_comparison = []
    team_velocity = []
    if _is_admin(current_user):
        all_projects = db.query(PMSProject).all()
        for p in all_projects:
            p_tasks = db.query(PMSTask).filter_by(project_id=p.id).all()
            p_total = len(p_tasks)
            p_completed = sum(1 for t in p_tasks if t.stage == "completed")
            p_on_time = sum(1 for t in p_tasks if t.stage == "completed" and t.due_date and t.updated_at and t.updated_at.date() <= t.due_date)
            p_effs = [_task_efficiency(t, today) for t in p_tasks if t.stage != "completed"]
            p_effs = [e for e in p_effs if e is not None]
            project_comparison.append({
                "name": p.name,
                "completion_pct": round(p_completed / p_total * 100, 1) if p_total else 0,
                "efficiency": round(sum(p_effs) / len(p_effs), 1) if p_effs else 0,
                "on_time_pct": round(p_on_time / p_completed * 100, 1) if p_completed else 0,
            })

        for p in all_projects:
            p_tasks = db.query(PMSTask).filter_by(project_id=p.id).all()
            series = []
            for w in range(8):
                week_start = today - timedelta(days=(7 * (8 - w)))
                week_end = week_start + timedelta(days=7)
                count = sum(1 for t in p_tasks if t.stage == "completed" and t.updated_at and week_start <= t.updated_at.date() < week_end)
                series.append({"week": week_start.isoformat(), "completed": count})
            team_velocity.append({"project": p.name, "data": series})

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
        "project_comparison": project_comparison,
        "team_velocity": team_velocity,
        "time_variance": [
            {"task_id": t.id, "title": t.title, "estimated": t.estimated_hours, "actual": t.actual_hours,
             "variance_pct": round(((t.actual_hours - t.estimated_hours) / t.estimated_hours) * 100, 1) if t.estimated_hours else 0,
             "over_budget": t.actual_hours > t.estimated_hours}
            for t in tasks if t.estimated_hours and t.estimated_hours > 0
        ],
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


# ── Checklists ───────────────────────────────────────────

@router.get("/tasks/{task_id}/checklists")
def list_checklists(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    items = db.query(PMSTaskChecklist).filter_by(task_id=task_id).order_by(PMSTaskChecklist.position).all()
    return [{"id": i.id, "task_id": i.task_id, "text": i.text, "is_checked": i.is_checked, "position": i.position} for i in items]

@router.post("/tasks/{task_id}/checklists")
def create_checklist_item(task_id: int, data: PMSChecklistCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    pos = db.query(PMSTaskChecklist).filter_by(task_id=task_id).count()
    item = PMSTaskChecklist(task_id=task_id, text=data.text, position=pos)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "task_id": item.task_id, "text": item.text, "is_checked": item.is_checked, "position": item.position}

@router.put("/checklists/{item_id}")
def update_checklist_item(item_id: int, data: PMSChecklistUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PMSTaskChecklist).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=item.task_id).first()
    _require_member(db, task.project_id, current_user)
    for k, v in data.dict(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "task_id": item.task_id, "text": item.text, "is_checked": item.is_checked, "position": item.position}

@router.delete("/checklists/{item_id}")
def delete_checklist_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PMSTaskChecklist).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=item.task_id).first()
    _require_member(db, task.project_id, current_user)
    db.delete(item)
    db.commit()
    return {"ok": True}


# ── Activity Feed ────────────────────────────────────────

@router.get("/projects/{project_id}/activity")
def get_project_activity(project_id: int, limit: int = 50, offset: int = 0, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    items = []
    # Audit logs
    for log in db.query(PMSAuditLog).filter_by(project_id=project_id).all():
        items.append({"type": "audit", "action": log.action_type, "actor_name": log.actor.full_name if log.actor else None,
                       "task_id": log.task_id, "details": _json.loads(log.details) if log.details else {}, "created_at": log.created_at})
    # Comments
    task_ids = [t.id for t in db.query(PMSTask.id).filter_by(project_id=project_id).all()]
    if task_ids:
        for c in db.query(PMSTaskComment).filter(PMSTaskComment.task_id.in_(task_ids)).all():
            items.append({"type": "comment", "action": "comment_added", "actor_name": c.user.full_name if c.user else None,
                           "task_id": c.task_id, "details": {"content": c.content[:120]}, "created_at": c.created_at})
        # Workflow history
        for wh in db.query(PMSWorkflowHistory).filter(PMSWorkflowHistory.task_id.in_(task_ids)).all():
            items.append({"type": "transition", "action": "stage_change", "actor_name": wh.actor.full_name if wh.actor else None,
                           "task_id": wh.task_id, "details": {"from": wh.from_stage, "to": wh.to_stage, "note": wh.note}, "created_at": wh.created_at})
    items.sort(key=lambda x: x["created_at"] or datetime.min, reverse=True)
    return items[offset:offset + limit]


# ── Sprints ──────────────────────────────────────────────

@router.get("/projects/{project_id}/sprints")
def list_sprints(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    sprints = db.query(PMSSprint).filter_by(project_id=project_id).order_by(PMSSprint.start_date.desc()).all()
    return [{"id": s.id, "project_id": s.project_id, "name": s.name, "start_date": s.start_date,
             "end_date": s.end_date, "goal": s.goal, "status": s.status, "created_at": s.created_at} for s in sprints]

@router.post("/projects/{project_id}/sprints")
def create_sprint(project_id: int, data: PMSSprintCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403, "PM or edit permission required")
    sprint = PMSSprint(project_id=project_id, **data.dict())
    db.add(sprint)
    db.commit()
    db.refresh(sprint)
    _audit_log(db, project_id, "sprint_created", current_user.id, {"sprint_name": sprint.name})
    db.commit()
    return {"id": sprint.id, "project_id": sprint.project_id, "name": sprint.name, "start_date": sprint.start_date,
            "end_date": sprint.end_date, "goal": sprint.goal, "status": sprint.status, "created_at": sprint.created_at}

@router.put("/sprints/{sprint_id}")
def update_sprint(sprint_id: int, data: PMSSprintUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sprint = db.query(PMSSprint).filter_by(id=sprint_id).first()
    if not sprint:
        raise HTTPException(404)
    m = _require_member(db, sprint.project_id, current_user)
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403)
    for k, v in data.dict(exclude_none=True).items():
        setattr(sprint, k, v)
    db.commit()
    db.refresh(sprint)
    return {"id": sprint.id, "project_id": sprint.project_id, "name": sprint.name, "start_date": sprint.start_date,
            "end_date": sprint.end_date, "goal": sprint.goal, "status": sprint.status}

@router.delete("/sprints/{sprint_id}")
def delete_sprint(sprint_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sprint = db.query(PMSSprint).filter_by(id=sprint_id).first()
    if not sprint:
        raise HTTPException(404)
    m = _require_member(db, sprint.project_id, current_user)
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "delete"):
        raise HTTPException(403)
    db.delete(sprint)
    db.commit()
    return {"ok": True}

@router.get("/sprints/{sprint_id}/burndown")
def get_sprint_burndown(sprint_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sprint = db.query(PMSSprint).filter_by(id=sprint_id).first()
    if not sprint:
        raise HTTPException(404)
    _require_member(db, sprint.project_id, current_user)
    tasks = db.query(PMSTask).filter_by(project_id=sprint.project_id, sprint_id=sprint_id).all()
    total = len(tasks)
    if not sprint.start_date or not sprint.end_date:
        return {"total": total, "burndown": []}
    burndown = []
    current = sprint.start_date
    while current <= min(sprint.end_date, date.today()):
        remaining = sum(1 for t in tasks if not (t.stage == "completed" and t.updated_at and t.updated_at.date() <= current))
        burndown.append({"date": str(current), "remaining": remaining})
        current += timedelta(days=1)
    days_total = (sprint.end_date - sprint.start_date).days or 1
    ideal = [{"date": str(sprint.start_date + timedelta(days=i)), "ideal": round(total - (total * i / days_total), 1)} for i in range(days_total + 1)]
    return {"total": total, "burndown": burndown, "ideal": ideal}


# ── Recurring Tasks ──────────────────────────────────────

@router.get("/projects/{project_id}/recurring-tasks")
def list_recurring_tasks(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    items = db.query(PMSRecurringTask).filter_by(project_id=project_id).order_by(PMSRecurringTask.created_at.desc()).all()
    return [{"id": r.id, "project_id": r.project_id, "title": r.title, "description": r.description,
             "assignee_id": r.assignee_id, "priority": r.priority, "recurrence_type": r.recurrence_type,
             "recurrence_day": r.recurrence_day, "next_run_date": r.next_run_date, "is_active": r.is_active,
             "estimated_hours": r.estimated_hours, "created_at": r.created_at} for r in items]

@router.post("/projects/{project_id}/recurring-tasks")
def create_recurring_task(project_id: int, data: PMSRecurringTaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    rt = PMSRecurringTask(project_id=project_id, created_by=current_user.id, **data.dict())
    db.add(rt)
    db.commit()
    db.refresh(rt)
    return {"id": rt.id, "title": rt.title, "recurrence_type": rt.recurrence_type, "next_run_date": rt.next_run_date, "is_active": rt.is_active}

@router.put("/recurring-tasks/{rt_id}")
def update_recurring_task(rt_id: int, data: PMSRecurringTaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rt = db.query(PMSRecurringTask).filter_by(id=rt_id).first()
    if not rt:
        raise HTTPException(404)
    _require_member(db, rt.project_id, current_user)
    for k, v in data.dict(exclude_none=True).items():
        setattr(rt, k, v)
    db.commit()
    db.refresh(rt)
    return {"id": rt.id, "title": rt.title, "recurrence_type": rt.recurrence_type, "next_run_date": rt.next_run_date, "is_active": rt.is_active}

@router.delete("/recurring-tasks/{rt_id}")
def delete_recurring_task(rt_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rt = db.query(PMSRecurringTask).filter_by(id=rt_id).first()
    if not rt:
        raise HTTPException(404)
    _require_member(db, rt.project_id, current_user)
    db.delete(rt)
    db.commit()
    return {"ok": True}


# ── Watchers ─────────────────────────────────────────────

@router.get("/tasks/{task_id}/watchers")
def list_watchers(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    watchers = db.query(PMSTaskWatcher).filter_by(task_id=task_id).all()
    return [{"id": w.id, "task_id": w.task_id, "user_id": w.user_id, "user_name": w.user.full_name if w.user else None, "watch_type": w.watch_type} for w in watchers]

@router.post("/tasks/{task_id}/watchers")
def add_watcher(task_id: int, data: PMSWatcherAdd, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    existing = db.query(PMSTaskWatcher).filter_by(task_id=task_id, user_id=data.user_id).first()
    if existing:
        return {"id": existing.id, "already_exists": True}
    w = PMSTaskWatcher(task_id=task_id, user_id=data.user_id, watch_type=data.watch_type)
    db.add(w)
    db.commit()
    db.refresh(w)
    return {"id": w.id, "task_id": w.task_id, "user_id": w.user_id, "watch_type": w.watch_type}

@router.delete("/tasks/{task_id}/watchers/{user_id}")
def remove_watcher(task_id: int, user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    w = db.query(PMSTaskWatcher).filter_by(task_id=task_id, user_id=user_id).first()
    if not w:
        raise HTTPException(404)
    db.delete(w)
    db.commit()
    return {"ok": True}


# ── Custom Fields ────────────────────────────────────────

@router.get("/projects/{project_id}/custom-fields")
def list_custom_fields(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    fields = db.query(PMSCustomFieldDef).filter_by(project_id=project_id).order_by(PMSCustomFieldDef.position).all()
    return [{"id": f.id, "project_id": f.project_id, "name": f.name, "field_type": f.field_type,
             "options": f.options, "required": f.required, "position": f.position} for f in fields]

@router.post("/projects/{project_id}/custom-fields")
def create_custom_field(project_id: int, data: PMSCustomFieldDefCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403)
    f = PMSCustomFieldDef(project_id=project_id, **data.dict())
    db.add(f)
    db.commit()
    db.refresh(f)
    return {"id": f.id, "name": f.name, "field_type": f.field_type, "options": f.options, "required": f.required, "position": f.position}

@router.put("/custom-fields/{field_id}")
def update_custom_field(field_id: int, data: PMSCustomFieldDefUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    f = db.query(PMSCustomFieldDef).filter_by(id=field_id).first()
    if not f:
        raise HTTPException(404)
    m = _require_member(db, f.project_id, current_user)
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "edit"):
        raise HTTPException(403)
    for k, v in data.dict(exclude_none=True).items():
        setattr(f, k, v)
    db.commit()
    return {"id": f.id, "name": f.name, "field_type": f.field_type, "options": f.options, "required": f.required, "position": f.position}

@router.delete("/custom-fields/{field_id}")
def delete_custom_field(field_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    f = db.query(PMSCustomFieldDef).filter_by(id=field_id).first()
    if not f:
        raise HTTPException(404)
    m = _require_member(db, f.project_id, current_user)
    if m.role not in ("pm",) and not _has_permission(current_user, db, "pms", "delete"):
        raise HTTPException(403)
    db.delete(f)
    db.commit()
    return {"ok": True}

@router.get("/tasks/{task_id}/custom-values")
def get_custom_values(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    values = db.query(PMSCustomFieldValue).filter_by(task_id=task_id).all()
    return [{"id": v.id, "field_def_id": v.field_def_id, "value": v.value} for v in values]

@router.put("/tasks/{task_id}/custom-values")
def set_custom_values(task_id: int, data: List[PMSCustomFieldValueSet], db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    for item in data:
        existing = db.query(PMSCustomFieldValue).filter_by(task_id=task_id, field_def_id=item.field_def_id).first()
        if existing:
            existing.value = item.value
        else:
            db.add(PMSCustomFieldValue(task_id=task_id, field_def_id=item.field_def_id, value=item.value))
    db.commit()
    return {"ok": True}


# ── Task Templates ───────────────────────────────────────

@router.get("/task-templates")
def list_task_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    templates = db.query(PMSTaskTemplate).order_by(PMSTaskTemplate.created_at.desc()).all()
    return [{"id": t.id, "name": t.name, "description": t.description, "item_count": len(t.items), "created_at": t.created_at} for t in templates]

@router.post("/task-templates")
def create_task_template(data: PMSTaskTemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = PMSTaskTemplate(name=data.name, description=data.description, created_by=current_user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "name": t.name, "description": t.description}

@router.get("/task-templates/{template_id}")
def get_task_template(template_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(PMSTaskTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    items = [{"id": i.id, "title": i.title, "description": i.description, "priority": i.priority,
              "estimated_hours": i.estimated_hours, "parent_index": i.parent_index, "position": i.position} for i in t.items]
    return {"id": t.id, "name": t.name, "description": t.description, "items": items}

@router.put("/task-templates/{template_id}")
def update_task_template(template_id: int, data: PMSTaskTemplateUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(PMSTaskTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(t, k, v)
    db.commit()
    return {"id": t.id, "name": t.name, "description": t.description}

@router.delete("/task-templates/{template_id}")
def delete_task_template(template_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(PMSTaskTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}

@router.post("/task-templates/{template_id}/items")
def add_template_item(template_id: int, data: PMSTemplateItemCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(PMSTaskTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    item = PMSTemplateItem(template_id=template_id, **data.dict())
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "title": item.title, "position": item.position}

@router.put("/template-items/{item_id}")
def update_template_item(item_id: int, data: PMSTemplateItemUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PMSTemplateItem).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    return {"id": item.id, "title": item.title}

@router.delete("/template-items/{item_id}")
def delete_template_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PMSTemplateItem).filter_by(id=item_id).first()
    if not item:
        raise HTTPException(404)
    db.delete(item)
    db.commit()
    return {"ok": True}

@router.post("/projects/{project_id}/apply-template/{template_id}")
def apply_task_template(project_id: int, template_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    template = db.query(PMSTaskTemplate).filter_by(id=template_id).first()
    if not template:
        raise HTTPException(404)
    items = sorted(template.items, key=lambda i: i.position)
    count = db.query(PMSTask).filter_by(project_id=project_id).count()
    id_map = {}
    for idx, item in enumerate(items):
        parent_id = id_map.get(item.parent_index) if item.parent_index is not None else None
        task = PMSTask(project_id=project_id, title=item.title, description=item.description,
                       priority=item.priority, estimated_hours=item.estimated_hours,
                       parent_task_id=parent_id, position=count + idx)
        db.add(task)
        db.flush()
        id_map[idx] = task.id
        db.add(PMSWorkflowHistory(task_id=task.id, from_stage=None, to_stage="development", moved_by=current_user.id, note=f"Created from template '{template.name}'"))
    db.commit()
    _audit_log(db, project_id, "template_applied", current_user.id, {"template_name": template.name, "tasks_created": len(items)})
    db.commit()
    return {"ok": True, "tasks_created": len(items)}


# ── Task Duplication ─────────────────────────────────────

@router.post("/tasks/{task_id}/duplicate")
def duplicate_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    count = db.query(PMSTask).filter_by(project_id=task.project_id).count()
    new_task = PMSTask(
        project_id=task.project_id, milestone_id=task.milestone_id, sprint_id=task.sprint_id,
        title=f"Copy of {task.title}", description=task.description, priority=task.priority,
        assignee_id=task.assignee_id, start_date=task.start_date, due_date=task.due_date,
        estimated_hours=task.estimated_hours, position=count,
    )
    db.add(new_task)
    db.flush()
    db.add(PMSWorkflowHistory(task_id=new_task.id, from_stage=None, to_stage="development", moved_by=current_user.id, note="Duplicated"))
    # Copy labels
    for label in task.labels:
        db.add(PMSTaskLabel(task_id=new_task.id, name=label.name, color=label.color, label_definition_id=label.label_definition_id))
    # Copy checklists
    for cl in db.query(PMSTaskChecklist).filter_by(task_id=task_id).all():
        db.add(PMSTaskChecklist(task_id=new_task.id, text=cl.text, is_checked=False, position=cl.position))
    # Copy subtasks
    for sub in db.query(PMSTask).filter_by(parent_task_id=task_id).all():
        sub_count = db.query(PMSTask).filter_by(project_id=task.project_id).count()
        new_sub = PMSTask(
            project_id=task.project_id, parent_task_id=new_task.id,
            title=f"Copy of {sub.title}", description=sub.description, priority=sub.priority,
            estimated_hours=sub.estimated_hours, position=sub_count,
        )
        db.add(new_sub)
        db.flush()
        db.add(PMSWorkflowHistory(task_id=new_sub.id, from_stage=None, to_stage="development", moved_by=current_user.id, note="Duplicated"))
    db.commit()
    db.refresh(new_task)
    return _enrich_task(new_task, db)


# ── Bulk Operations ──────────────────────────────────────

@router.post("/tasks/bulk-action")
def bulk_task_action(data: PMSBulkAction, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tasks = db.query(PMSTask).filter(PMSTask.id.in_(data.task_ids)).all()
    if not tasks:
        raise HTTPException(404, "No tasks found")
    # Verify membership in all affected projects
    project_ids = set(t.project_id for t in tasks)
    for pid in project_ids:
        _require_member(db, pid, current_user)
    affected = 0
    params = data.params or {}
    for task in tasks:
        if data.action == "assign":
            task.assignee_id = params.get("assignee_id")
            affected += 1
        elif data.action == "move_stage":
            to_stage = params.get("to_stage")
            allowed = WORKFLOW_TRANSITIONS.get(task.stage, {}).get(to_stage)
            if allowed:
                old = task.stage
                task.stage = to_stage
                db.add(PMSWorkflowHistory(task_id=task.id, from_stage=old, to_stage=to_stage, moved_by=current_user.id, note="Bulk action"))
                affected += 1
        elif data.action == "set_priority":
            task.priority = params.get("priority", task.priority)
            affected += 1
        elif data.action == "delete":
            db.delete(task)
            affected += 1
        elif data.action == "set_milestone":
            task.milestone_id = params.get("milestone_id")
            affected += 1
        elif data.action == "set_sprint":
            task.sprint_id = params.get("sprint_id")
            affected += 1
    db.commit()
    return {"ok": True, "affected": affected}


# ── File Versioning ──────────────────────────────────────

@router.get("/attachments/{att_id}/versions")
def get_attachment_versions(att_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    att = db.query(PMSTaskAttachment).filter_by(id=att_id).first()
    if not att:
        raise HTTPException(404)
    task = db.query(PMSTask).filter_by(id=att.task_id).first()
    _require_member(db, task.project_id, current_user)
    # Find all versions of this file
    versions = db.query(PMSTaskAttachment).filter_by(task_id=att.task_id, file_name=att.file_name).order_by(PMSTaskAttachment.version.desc()).all()
    return [{"id": v.id, "file_name": v.file_name, "file_size": v.file_size, "version": v.version, "created_at": v.created_at} for v in versions]


# ── Favorites ────────────────────────────────────────────

@router.get("/favorites")
def list_favorites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    favs = db.query(PMSFavorite).filter_by(user_id=current_user.id).order_by(PMSFavorite.created_at.desc()).all()
    result = []
    for f in favs:
        item = {"id": f.id, "project_id": f.project_id, "task_id": f.task_id}
        if f.project_id:
            p = db.query(PMSProject).filter_by(id=f.project_id).first()
            if p:
                item["project_name"] = p.name
                item["project_color"] = p.color
        if f.task_id:
            t = db.query(PMSTask).filter_by(id=f.task_id).first()
            if t:
                item["task_title"] = t.title
                item["task_stage"] = t.stage
        result.append(item)
    return result

@router.post("/favorites")
def toggle_favorite(data: PMSFavoriteToggle, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(PMSFavorite).filter_by(user_id=current_user.id)
    if data.project_id:
        q = q.filter_by(project_id=data.project_id, task_id=None)
    elif data.task_id:
        q = q.filter_by(task_id=data.task_id, project_id=None)
    else:
        raise HTTPException(400, "project_id or task_id required")
    existing = q.first()
    if existing:
        db.delete(existing)
        db.commit()
        return {"ok": True, "favorited": False}
    fav = PMSFavorite(user_id=current_user.id, project_id=data.project_id, task_id=data.task_id)
    db.add(fav)
    db.commit()
    return {"ok": True, "favorited": True}

@router.delete("/favorites/{fav_id}")
def remove_favorite(fav_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    fav = db.query(PMSFavorite).filter_by(id=fav_id, user_id=current_user.id).first()
    if not fav:
        raise HTTPException(404)
    db.delete(fav)
    db.commit()
    return {"ok": True}


# ── Export ────────────────────────────────────────────────

def _generate_pdf_table(title: str, headers: list, rows: list) -> bytes:
    """Generate a PDF with a table using reportlab."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=30, bottomMargin=30)
    styles = getSampleStyleSheet()
    elements = []
    elements.append(Paragraph(title, styles['Title']))
    elements.append(Spacer(1, 12))
    # Truncate long strings for PDF
    def trunc(v, n=40):
        s = str(v) if v is not None else ""
        return s[:n] + "..." if len(s) > n else s
    table_data = [headers] + [[trunc(c) for c in row] for row in rows]
    t = Table(table_data, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#6366f1')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(t)
    doc.build(elements)
    buf.seek(0)
    return buf.getvalue()

@router.get("/projects/{project_id}/export")
def export_project_tasks(project_id: int, format: str = "csv", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    project = db.query(PMSProject).filter_by(id=project_id).first()
    tasks = db.query(PMSTask).filter_by(project_id=project_id).order_by(PMSTask.position).all()
    headers = ["ID", "Title", "Stage", "Priority", "Assignee", "Due Date", "Est. Hours", "Actual Hours", "Milestone", "Sprint"]
    rows = []
    for t in tasks:
        rows.append([t.id, t.title, t.stage, t.priority,
                     t.assignee.full_name if t.assignee else "",
                     t.due_date or "", t.estimated_hours, t.actual_hours,
                     t.milestone.name if t.milestone else "",
                     t.sprint.name if t.sprint else ""])
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        for row in rows:
            writer.writerow(row)
        output.seek(0)
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f"attachment; filename=project_{project_id}_tasks.csv"})
    elif format == "pdf":
        pdf_bytes = _generate_pdf_table(f"Project: {project.name if project else project_id}", headers, rows)
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                                 headers={"Content-Disposition": f"attachment; filename=project_{project_id}_tasks.pdf"})
    raise HTTPException(400, "Unsupported format. Use 'csv' or 'pdf'.")

@router.get("/my-tasks/export")
def export_my_tasks(format: str = "csv", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tasks = db.query(PMSTask).filter_by(assignee_id=current_user.id).filter(PMSTask.stage.notin_(["completed"])).order_by(PMSTask.due_date).all()
    headers = ["ID", "Title", "Project", "Stage", "Priority", "Due Date", "Est. Hours", "Actual Hours"]
    rows = []
    for t in tasks:
        rows.append([t.id, t.title, t.project.name if t.project else "", t.stage, t.priority, t.due_date or "", t.estimated_hours, t.actual_hours])
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        for row in rows:
            writer.writerow(row)
        output.seek(0)
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=my_tasks.csv"})
    elif format == "pdf":
        pdf_bytes = _generate_pdf_table(f"My Tasks — {current_user.full_name}", headers, rows)
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                                 headers={"Content-Disposition": "attachment; filename=my_tasks.pdf"})
    raise HTTPException(400, "Unsupported format. Use 'csv' or 'pdf'.")


# ── Project Templates ────────────────────────────────────

@router.get("/project-templates")
def list_project_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    templates = db.query(PMSProjectTemplate).order_by(PMSProjectTemplate.created_at.desc()).all()
    return [{"id": t.id, "name": t.name, "description": t.description,
             "milestone_count": len(t.milestones), "task_count": len(t.tasks), "created_at": t.created_at} for t in templates]

@router.post("/project-templates")
def create_project_template(data: PMSProjectTemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403, "Admin only")
    t = PMSProjectTemplate(name=data.name, description=data.description, created_by=current_user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "name": t.name}

@router.get("/project-templates/{template_id}")
def get_project_template(template_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(PMSProjectTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    milestones = [{"id": m.id, "name": m.name, "offset_days": m.offset_days, "color": m.color} for m in t.milestones]
    tasks = [{"id": tk.id, "title": tk.title, "description": tk.description, "priority": tk.priority,
              "estimated_hours": tk.estimated_hours, "milestone_index": tk.milestone_index, "position": tk.position, "parent_index": tk.parent_index} for tk in t.tasks]
    return {"id": t.id, "name": t.name, "description": t.description, "milestones": milestones, "tasks": tasks}

@router.put("/project-templates/{template_id}")
def update_project_template(template_id: int, data: PMSProjectTemplateUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403)
    t = db.query(PMSProjectTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    for k, v in data.dict(exclude_none=True).items():
        setattr(t, k, v)
    db.commit()
    return {"id": t.id, "name": t.name}

@router.delete("/project-templates/{template_id}")
def delete_project_template(template_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not _is_admin(current_user):
        raise HTTPException(403)
    t = db.query(PMSProjectTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}

@router.post("/project-templates/{template_id}/milestones")
def add_project_template_milestone(template_id: int, data: PMSProjectTemplateMilestoneCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(PMSProjectTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    m = PMSProjectTemplateMilestone(template_id=template_id, **data.dict())
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "name": m.name, "offset_days": m.offset_days, "color": m.color}

@router.post("/project-templates/{template_id}/tasks")
def add_project_template_task(template_id: int, data: PMSProjectTemplateTaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(PMSProjectTemplate).filter_by(id=template_id).first()
    if not t:
        raise HTTPException(404)
    tk = PMSProjectTemplateTask(template_id=template_id, **data.dict())
    db.add(tk)
    db.commit()
    db.refresh(tk)
    return {"id": tk.id, "title": tk.title}

@router.post("/projects/from-template/{template_id}")
def create_project_from_template(template_id: int, name: str = "New Project", start_date: Optional[date] = None, color: str = "#6366f1",
                                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    template = db.query(PMSProjectTemplate).filter_by(id=template_id).first()
    if not template:
        raise HTTPException(404)
    s_date = start_date or date.today()
    project = PMSProject(name=name, color=color, status="planning", start_date=s_date, owner_id=current_user.id)
    db.add(project)
    db.flush()
    # Add creator as PM member
    db.add(PMSProjectMember(project_id=project.id, user_id=current_user.id, role="pm", added_by=current_user.id))
    # Create milestones
    ms_map = {}
    for idx, tm in enumerate(sorted(template.milestones, key=lambda m: m.offset_days)):
        ms = PMSMilestone(project_id=project.id, name=tm.name, due_date=s_date + timedelta(days=tm.offset_days), color=tm.color)
        db.add(ms)
        db.flush()
        ms_map[idx] = ms.id
    # Create tasks
    task_map = {}
    for idx, tt in enumerate(sorted(template.tasks, key=lambda t: t.position)):
        milestone_id = ms_map.get(tt.milestone_index) if tt.milestone_index is not None else None
        parent_id = task_map.get(tt.parent_index) if tt.parent_index is not None else None
        task = PMSTask(project_id=project.id, title=tt.title, description=tt.description, priority=tt.priority,
                       estimated_hours=tt.estimated_hours, milestone_id=milestone_id, parent_task_id=parent_id, position=idx)
        db.add(task)
        db.flush()
        task_map[idx] = task.id
        db.add(PMSWorkflowHistory(task_id=task.id, from_stage=None, to_stage="development", moved_by=current_user.id, note=f"From template '{template.name}'"))
    db.commit()
    return {"ok": True, "project_id": project.id, "milestones_created": len(ms_map), "tasks_created": len(task_map)}


# ── Automations ──────────────────────────────────────────

@router.get("/projects/{project_id}/automations")
def list_automations(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_member(db, project_id, current_user)
    autos = db.query(PMSAutomation).filter_by(project_id=project_id).order_by(PMSAutomation.created_at.desc()).all()
    return [{"id": a.id, "name": a.name, "trigger_type": a.trigger_type, "trigger_config": a.trigger_config,
             "action_type": a.action_type, "action_config": a.action_config, "is_active": a.is_active} for a in autos]

@router.post("/projects/{project_id}/automations")
def create_automation(project_id: int, data: PMSAutomationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = _require_member(db, project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403)
    a = PMSAutomation(project_id=project_id, **data.dict())
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"id": a.id, "name": a.name, "trigger_type": a.trigger_type, "action_type": a.action_type, "is_active": a.is_active}

@router.put("/automations/{auto_id}")
def update_automation(auto_id: int, data: PMSAutomationUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    a = db.query(PMSAutomation).filter_by(id=auto_id).first()
    if not a:
        raise HTTPException(404)
    m = _require_member(db, a.project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403)
    for k, v in data.dict(exclude_none=True).items():
        setattr(a, k, v)
    db.commit()
    return {"id": a.id, "name": a.name, "is_active": a.is_active}

@router.delete("/automations/{auto_id}")
def delete_automation(auto_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    a = db.query(PMSAutomation).filter_by(id=auto_id).first()
    if not a:
        raise HTTPException(404)
    m = _require_member(db, a.project_id, current_user)
    if m.role not in ("pm",) and not _is_admin(current_user):
        raise HTTPException(403)
    db.delete(a)
    db.commit()
    return {"ok": True}


def _evaluate_automations(db: Session, task: PMSTask, trigger_type: str, context: dict = {}):
    """Check and execute matching automations for a task."""
    autos = db.query(PMSAutomation).filter_by(project_id=task.project_id, trigger_type=trigger_type, is_active=True).all()
    for auto in autos:
        trigger_cfg = _json.loads(auto.trigger_config) if auto.trigger_config else {}
        action_cfg = _json.loads(auto.action_config) if auto.action_config else {}
        # Check trigger conditions
        if trigger_type == "stage_change":
            if trigger_cfg.get("from_stage") and trigger_cfg["from_stage"] != context.get("from_stage"):
                continue
            if trigger_cfg.get("to_stage") and trigger_cfg["to_stage"] != context.get("to_stage"):
                continue
        elif trigger_type == "all_subtasks_complete":
            incomplete = db.query(PMSTask).filter_by(parent_task_id=task.id).filter(PMSTask.stage != "completed").count()
            if incomplete > 0:
                continue
        # Execute action
        if auto.action_type == "set_stage":
            new_stage = action_cfg.get("stage")
            if new_stage and new_stage != task.stage:
                old = task.stage
                task.stage = new_stage
                db.add(PMSWorkflowHistory(task_id=task.id, from_stage=old, to_stage=new_stage, moved_by=None, note=f"Automation: {auto.name}"))
        elif auto.action_type == "assign":
            task.assignee_id = action_cfg.get("user_id")
        elif auto.action_type == "notify":
            notify_user_id = action_cfg.get("user_id")
            if notify_user_id:
                _fire_alert(db, task, "automation", f"Automation '{auto.name}': {action_cfg.get('message', 'Triggered')}")
    db.commit()


# ── Conversation Links ───────────────────────────────────

@router.get("/tasks/{task_id}/links")
def list_task_links(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    from app.models.conversation import Conversation
    links = db.query(PMSTaskConversationLink).filter_by(task_id=task_id).all()
    result = []
    for link in links:
        conv = db.query(Conversation).filter_by(id=link.conversation_id).first()
        result.append({"id": link.id, "conversation_id": link.conversation_id,
                        "contact_name": conv.contact_name if conv else None,
                        "platform": conv.platform if conv else None,
                        "created_at": link.created_at})
    return result

@router.post("/tasks/{task_id}/links")
def add_task_link(task_id: int, data: PMSConversationLinkCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    existing = db.query(PMSTaskConversationLink).filter_by(task_id=task_id, conversation_id=data.conversation_id).first()
    if existing:
        return {"id": existing.id, "already_exists": True}
    link = PMSTaskConversationLink(task_id=task_id, conversation_id=data.conversation_id, linked_by=current_user.id)
    db.add(link)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "task_id": link.task_id, "conversation_id": link.conversation_id}

@router.delete("/tasks/{task_id}/links/{conversation_id}")
def remove_task_link(task_id: int, conversation_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(PMSTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404)
    _require_member(db, task.project_id, current_user)
    link = db.query(PMSTaskConversationLink).filter_by(task_id=task_id, conversation_id=conversation_id).first()
    if not link:
        raise HTTPException(404)
    db.delete(link)
    db.commit()
    return {"ok": True}


# ── Milestone Dependencies ───────────────────────────────

@router.put("/milestones/{milestone_id}/dependency")
def set_milestone_dependency(milestone_id: int, depends_on_id: Optional[int] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ms = db.query(PMSMilestone).filter_by(id=milestone_id).first()
    if not ms:
        raise HTTPException(404)
    _require_member(db, ms.project_id, current_user)
    if depends_on_id:
        dep = db.query(PMSMilestone).filter_by(id=depends_on_id).first()
        if not dep or dep.project_id != ms.project_id:
            raise HTTPException(400, "Invalid dependency")
        if depends_on_id == milestone_id:
            raise HTTPException(400, "Cannot depend on self")
        # Check circular deps
        check_id = depends_on_id
        visited = {milestone_id}
        while check_id:
            if check_id in visited:
                raise HTTPException(400, "Circular dependency detected")
            visited.add(check_id)
            parent = db.query(PMSMilestone).filter_by(id=check_id).first()
            check_id = parent.depends_on_id if parent else None
    ms.depends_on_id = depends_on_id
    db.commit()
    return {"ok": True, "depends_on_id": ms.depends_on_id}
