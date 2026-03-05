# PMS PM/Admin Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 10 PM/Admin management features to the PMS: team workload, approval queue, escalation queue, capacity planning, audit trail, enhanced admin dashboard, team performance charts, cross-project timeline, weekly digest, and role-gated navigation.

**Architecture:** 5 new pages + enhanced existing pages. 1 new model (PMSAuditLog) + 1 model change (hours_per_day on PMSProjectMember). 5 new backend endpoints. Navigation role-gated by system role (admin) and project role (pm). Dashboard returns `is_pm` flag.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL, Next.js 14, TailwindCSS, Recharts

---

## Context for the Implementer

### Key Files
- **Backend routes:** `backend/app/routes/pms.py` (all PMS endpoints, currently ~882 lines)
- **Backend models:** `backend/app/models/pms.py` (all PMS models)
- **Backend schemas:** `backend/app/schemas/pms.py` (Pydantic schemas)
- **DB migrations:** `backend/main.py` (inline SQL migrations around line 1125)
- **Frontend API:** `frontend/lib/api.ts` (pmsApi object at line 107-184)
- **Sidebar nav:** `frontend/components/AdminNav.tsx` (PMS section at lines 107-114)
- **Dashboard page:** `frontend/app/admin/pms/page.tsx`
- **My Tasks page:** `frontend/app/admin/pms/my-tasks/page.tsx`
- **Reports page:** `frontend/app/admin/pms/reports/page.tsx`
- **Permissions:** `frontend/lib/permissions.ts`

### Existing Patterns
- All PMS routes use `dependencies=[Depends(require_page("pms"))]`
- Admin check: `_is_admin(user)` returns `user.role == "admin"`
- Member check: `_require_member(db, project_id, user)` — admins get virtual PM membership
- PM role: `PMSProjectMember.role == "pm"` in a project
- Frontend auth: `authAPI.getUser()` returns user object with `.role`
- Frontend permissions: `hasPageAccess('pms')` checks RBAC
- Efficiency: `_task_efficiency(task, today)` returns percentage or None
- Business days: `_business_days(start, end)` counts Mon-Fri only

### Workflow Stages
`development → qa → pm_review → client_review → approved → completed`

---

## Task 1: Model Changes & Migrations

**Files:**
- Modify: `backend/app/models/pms.py` — add PMSAuditLog class, add hours_per_day to PMSProjectMember
- Modify: `backend/main.py` — add migration SQL
- Modify: `backend/app/routes/pms.py` — add import for PMSAuditLog

### Step 1: Add PMSAuditLog model and hours_per_day column

In `backend/app/models/pms.py`, after the `PMSAlert` class (line 179), add:

```python
class PMSAuditLog(Base):
    __tablename__ = "pms_audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("pms_projects.id", ondelete="CASCADE"))
    task_id = Column(Integer, nullable=True)
    action_type = Column(String, nullable=False)  # stage_change, assignee_change, member_added, member_removed, milestone_change
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    details = Column(Text)  # JSON string with action details
    created_at = Column(DateTime, server_default=func.now())

    actor = relationship("User", foreign_keys=[actor_id])
```

In `PMSProjectMember` class (line 26-37), add after the `added_at` column:

```python
    hours_per_day = Column(Float, default=7.0)
```

### Step 2: Add migration SQL

In `backend/main.py`, in the migrations section (after the pms_label_definitions migration around line 1134), add:

```python
        # PMS audit log table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pms_audit_logs (
                id SERIAL PRIMARY KEY,
                project_id INTEGER REFERENCES pms_projects(id) ON DELETE CASCADE,
                task_id INTEGER,
                action_type VARCHAR NOT NULL,
                actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                details TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))

        # hours_per_day on project members
        conn.execute(text("""
            ALTER TABLE pms_project_members ADD COLUMN IF NOT EXISTS hours_per_day FLOAT DEFAULT 7.0
        """))
```

### Step 3: Update imports in routes

In `backend/app/routes/pms.py` line 11-16, add `PMSAuditLog` to the import:

```python
from app.models.pms import (
    PMSProject, PMSProjectMember, PMSMilestone, PMSTask,
    PMSTaskDependency, PMSTaskComment, PMSTaskTimeLog,
    PMSTaskAttachment, PMSTaskLabel, PMSWorkflowHistory, PMSAlert,
    PMSLabelDefinition, PMSAuditLog
)
```

### Step 4: Add audit logging helper

In `backend/app/routes/pms.py`, after the `_fire_alert` function (around line 74), add:

```python
import json as _json

def _audit_log(db: Session, project_id: int, action_type: str, actor_id: int, details: dict, task_id: int = None):
    db.add(PMSAuditLog(
        project_id=project_id,
        task_id=task_id,
        action_type=action_type,
        actor_id=actor_id,
        details=_json.dumps(details),
    ))
```

### Step 5: Wire audit logging into existing routes

Add `_audit_log()` calls in these existing endpoints:

**Transition endpoint** (the `transition_task` function) — after the workflow history entry is committed, add:
```python
_audit_log(db, task.project_id, "stage_change", current_user.id,
           {"task_title": task.title, "from": old_stage, "to": body.to_stage, "note": body.note}, task.id)
```

**Update task endpoint** (the `update_task` function) — when `assignee_id` changes, add:
```python
if body.assignee_id is not None and body.assignee_id != task.assignee_id:
    old_name = task.assignee.full_name if task.assignee else None
    # (after updating the task)
    new_assignee = db.query(User).filter_by(id=body.assignee_id).first()
    _audit_log(db, task.project_id, "assignee_change", current_user.id,
               {"task_title": task.title, "from": old_name, "to": new_assignee.full_name if new_assignee else None}, task.id)
```

**Add member endpoint** — after adding a member:
```python
_audit_log(db, project_id, "member_added", current_user.id,
           {"user_id": body.user_id, "role": body.role})
```

**Remove member endpoint** — after removing:
```python
_audit_log(db, project_id, "member_removed", current_user.id,
           {"user_id": user_id})
```

**Update milestone endpoint** — after status change:
```python
_audit_log(db, ms.project_id, "milestone_change", current_user.id,
           {"milestone": ms.name, "changes": body.dict(exclude_unset=True)})
```

### Step 6: Verify backend starts

Run: `cd backend && source venv/bin/activate && timeout 10 python -c "from app.models.pms import PMSAuditLog; print('OK')" 2>&1 || echo "Import check"`

### Step 7: Commit

```bash
git add backend/app/models/pms.py backend/main.py backend/app/routes/pms.py
git commit -m "feat(pms): add PMSAuditLog model, hours_per_day column, audit logging"
```

---

## Task 2: Backend Endpoints — Team Workload, Approval Queue, Escalations

**Files:**
- Modify: `backend/app/routes/pms.py` — add 3 new endpoints after the reports endpoint (line 881)

### Step 1: Add helper to check if user is PM

After the `_audit_log` helper, add:

```python
def _is_pm(db: Session, user: User) -> bool:
    """Check if user has PM role in any project."""
    if _is_admin(user):
        return True
    return db.query(PMSProjectMember).filter_by(user_id=user.id, role="pm").first() is not None

def _pm_project_ids(db: Session, user: User) -> list:
    """Get project IDs where user is PM (or all if admin)."""
    if _is_admin(user):
        return [p.id for p in db.query(PMSProject.id).all()]
    return [m.project_id for m in db.query(PMSProjectMember).filter_by(user_id=user.id, role="pm").all()]

def _require_pm_or_admin(db: Session, user: User):
    if not _is_pm(db, user):
        raise HTTPException(403, "PM or admin role required")
```

### Step 2: Team Workload endpoint

After the reports endpoint (line 881), add:

```python
# ── Team Workload ─────────────────────────────────────────

@router.get("/team-workload")
def get_team_workload(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_pm_or_admin(db, current_user)
    today = date.today()

    # Get accessible project IDs
    if project_id:
        _require_member(db, project_id, current_user)
        pids = [project_id]
    else:
        pids = _pm_project_ids(db, current_user)

    if not pids:
        return {"members": [], "projects": []}

    # Get all members across these projects
    members = db.query(PMSProjectMember).filter(PMSProjectMember.project_id.in_(pids)).all()
    tasks = db.query(PMSTask).filter(PMSTask.project_id.in_(pids), PMSTask.stage != "completed").all()

    # Aggregate by user
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

    # Also capture role from membership
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

    # Project list for filter dropdown
    projects = db.query(PMSProject).filter(PMSProject.id.in_(pids)).all()
    project_options = [{"id": p.id, "name": p.name, "color": p.color} for p in projects]

    return {"members": result, "projects": project_options}
```

### Step 3: Approval Queue endpoint

```python
# ── Approval Queue ────────────────────────────────────────

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
        PMSTask.project_id.in_(pids),
        PMSTask.stage == "pm_review"
    ).order_by(PMSTask.due_date.asc().nullslast()).all()

    client_tasks = db.query(PMSTask).filter(
        PMSTask.project_id.in_(pids),
        PMSTask.stage == "client_review"
    ).order_by(PMSTask.due_date.asc().nullslast()).all()

    today = date.today()
    now = datetime.utcnow()

    def _enrich_approval_task(t):
        # Calculate time in current stage
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
```

### Step 4: Escalation Queue endpoint

```python
# ── Escalations ───────────────────────────────────────────

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
        # Rule 1: Overdue 3+ days
        if t.due_date and (today - t.due_date).days >= 3:
            triggers.append({"type": "overdue", "detail": f"{(today - t.due_date).days}d overdue"})

        # Rule 2: Hours > 150% of estimated
        if t.estimated_hours and t.estimated_hours > 0 and t.actual_hours > t.estimated_hours * 1.5:
            pct = round(t.actual_hours / t.estimated_hours * 100)
            triggers.append({"type": "over_hours", "detail": f"{pct}% of estimated hours"})

        # Rule 3: Stuck 7+ days (development/qa only)
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

    # Sort: critical first, then high, then medium
    severity_order = {"critical": 0, "high": 1, "medium": 2}
    escalated.sort(key=lambda x: severity_order.get(x["severity"], 3))

    counts = {"critical": 0, "high": 0, "medium": 0}
    for e in escalated:
        counts[e["severity"]] += 1

    return {"escalations": escalated, "counts": counts}
```

### Step 5: Commit

```bash
git add backend/app/routes/pms.py
git commit -m "feat(pms): add team workload, approval queue, escalation endpoints"
```

---

## Task 3: Backend Endpoints — Capacity Planning, Audit Trail, Enhanced Dashboard

**Files:**
- Modify: `backend/app/routes/pms.py`

### Step 1: Capacity Planning endpoint

Add after the escalations endpoint:

```python
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

    # Determine date range
    if range == "this_week":
        # Monday of this week to Friday
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=4)
    elif range == "next_2_weeks":
        start = today
        end = today + timedelta(days=13)
    elif range == "this_month":
        start = today.replace(day=1)
        import calendar
        _, last_day = calendar.monthrange(today.year, today.month)
        end = today.replace(day=last_day)
    elif range == "next_month":
        import calendar
        if today.month == 12:
            start = today.replace(year=today.year + 1, month=1, day=1)
        else:
            start = today.replace(month=today.month + 1, day=1)
        _, last_day = calendar.monthrange(start.year, start.month)
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
    bdays = _business_days(start, end + timedelta(days=1))  # inclusive end

    # Group by user
    from collections import defaultdict
    user_map = {}
    for m in members:
        uid = m.user_id
        if uid not in user_map:
            user_map[uid] = {
                "user_id": uid,
                "name": m.user.full_name if m.user else f"User {uid}",
                "role": m.role,
                "hours_per_day": m.hours_per_day or 7.0,
            }
        # Use highest hours_per_day if member of multiple projects
        if (m.hours_per_day or 7.0) > user_map[uid]["hours_per_day"]:
            user_map[uid]["hours_per_day"] = m.hours_per_day or 7.0

    # Get committed hours (estimated hours for non-completed tasks with due_date in range)
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

    # Project list for filter
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
```

### Step 2: Update member hours_per_day endpoint

Add a PATCH endpoint for updating hours_per_day:

```python
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
```

### Step 3: Audit Trail endpoint

```python
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

    # Get filter options
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
```

### Step 4: Enhance Dashboard endpoint

Modify the existing `get_dashboard` function (line 624) to add `is_pm` flag, admin-only metrics, weekly digest, and cross-project deadlines.

Add these to the return dict at the end of the dashboard endpoint (before `return {`):

```python
    # PM/Admin enhancements
    is_pm = _is_pm(db, current_user)
    is_admin = _is_admin(current_user)

    # Approval queue counts (for PM/Admin)
    approval_counts = {"pm_review": 0, "client_review": 0}
    if is_pm:
        pm_pids = _pm_project_ids(db, current_user)
        approval_counts["pm_review"] = db.query(PMSTask).filter(
            PMSTask.project_id.in_(pm_pids), PMSTask.stage == "pm_review"
        ).count() if pm_pids else 0
        approval_counts["client_review"] = db.query(PMSTask).filter(
            PMSTask.project_id.in_(pm_pids), PMSTask.stage == "client_review"
        ).count() if pm_pids else 0

    # Escalation count (admin only)
    escalation_count = 0
    if is_admin:
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

    # Team Health Score (admin only)
    health_score = None
    if is_admin and total_tasks > 0:
        completion_rate = completed_tasks / total_tasks * 100
        on_time_completed = sum(1 for t in all_tasks if t.stage == "completed" and t.due_date and t.updated_at and t.updated_at.date() <= t.due_date)
        on_time_rate = on_time_completed / completed_tasks * 100 if completed_tasks else 0
        all_eff = [_task_efficiency(t, today) for t in all_tasks if t.stage != "completed"]
        all_eff = [e for e in all_eff if e is not None]
        avg_eff = sum(all_eff) / len(all_eff) if all_eff else 50
        health_score = round(completion_rate * 0.4 + on_time_rate * 0.3 + avg_eff * 0.3, 1)

    # Weekly digest (PM/Admin)
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

    # Cross-project deadlines (PM only — next 30 days)
    upcoming_deadlines = []
    if is_pm:
        deadline_cutoff = today + timedelta(days=30)
        pm_pids_list = _pm_project_ids(db, current_user)
        # Milestones
        upcoming_ms = db.query(PMSMilestone).filter(
            PMSMilestone.project_id.in_(pm_pids_list),
            PMSMilestone.due_date >= today,
            PMSMilestone.due_date <= deadline_cutoff,
            PMSMilestone.status != "reached",
        ).order_by(PMSMilestone.due_date).all() if pm_pids_list else []
        for ms in upcoming_ms:
            proj = next((p for p in projects if p.id == ms.project_id), None)
            upcoming_deadlines.append({
                "type": "milestone", "title": ms.name, "due_date": ms.due_date,
                "project_name": proj.name if proj else None, "project_color": proj.color if proj else None,
            })
        # Tasks with due dates
        upcoming_tasks = db.query(PMSTask).filter(
            PMSTask.project_id.in_(pm_pids_list),
            PMSTask.due_date >= today,
            PMSTask.due_date <= deadline_cutoff,
            PMSTask.stage.notin_(["approved", "completed"]),
        ).order_by(PMSTask.due_date).limit(20).all() if pm_pids_list else []
        for t in upcoming_tasks:
            proj = next((p for p in projects if p.id == t.project_id), None)
            upcoming_deadlines.append({
                "type": "task", "title": t.title, "due_date": t.due_date,
                "project_name": proj.name if proj else None, "project_color": proj.color if proj else None,
                "priority": t.priority,
            })
        upcoming_deadlines.sort(key=lambda x: x["due_date"])

    # Cross-project summary table (admin only)
    cross_project_summary = []
    if is_admin:
        for p in projects:
            p_tasks = [t for t in all_tasks if t.project_id == p.id]
            p_total = len(p_tasks)
            p_completed = sum(1 for t in p_tasks if t.stage == "completed")
            p_overdue = sum(1 for t in p_tasks if t.due_date and t.due_date < today and t.stage not in ("approved", "completed"))
            p_efficiencies = [_task_efficiency(t, today) for t in p_tasks if t.stage != "completed"]
            p_efficiencies = [e for e in p_efficiencies if e is not None]
            p_eff = round(sum(p_efficiencies) / len(p_efficiencies), 1) if p_efficiencies else None

            # Find PM name
            pm_member = next((m for m in p.members if m.role == "pm"), None)
            pm_name = pm_member.user.full_name if pm_member and pm_member.user else None

            # On-time rate for health
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
```

Then modify the return dict to include these new fields:

```python
    return {
        "metrics": { ... },  # existing
        "my_tasks": my_tasks_data,
        "my_avg_efficiency": my_avg_efficiency,
        "projects": project_cards,
        "is_pm": is_pm,
        "is_admin": is_admin,
        "approval_counts": approval_counts,
        "escalation_count": escalation_count,
        "health_score": health_score,
        "weekly_digest": weekly_digest,
        "upcoming_deadlines": upcoming_deadlines,
        "cross_project_summary": cross_project_summary,
    }
```

### Step 5: Commit

```bash
git add backend/app/routes/pms.py
git commit -m "feat(pms): add capacity, audit trail endpoints, enhance dashboard for PM/admin"
```

---

## Task 4: Backend — Enhanced Reports for Admin

**Files:**
- Modify: `backend/app/routes/pms.py` — enhance the reports endpoint

### Step 1: Add admin-only charts to reports

In the `get_reports` function (line 755), before the final `return`, add:

```python
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

        # Team velocity per project (last 8 weeks)
        for p in all_projects:
            p_tasks = db.query(PMSTask).filter_by(project_id=p.id).all()
            series = []
            for w in range(8):
                week_start = today - timedelta(days=(7 * (8 - w)))
                week_end = week_start + timedelta(days=7)
                count = sum(1 for t in p_tasks if t.stage == "completed" and t.updated_at and week_start <= t.updated_at.date() < week_end)
                series.append({"week": week_start.isoformat(), "completed": count})
            team_velocity.append({"project": p.name, "data": series})
```

Then add to the return dict:

```python
        "project_comparison": project_comparison,
        "team_velocity": team_velocity,
```

### Step 2: Commit

```bash
git add backend/app/routes/pms.py
git commit -m "feat(pms): add admin-only project comparison and velocity charts to reports"
```

---

## Task 5: Frontend API Client Updates

**Files:**
- Modify: `frontend/lib/api.ts` — add new pmsApi methods (after line 183)

### Step 1: Add new API methods

Add before the closing `};` of pmsApi (line 184):

```typescript
  // PM/Admin features
  getTeamWorkload: (params?: any) => api.get('/api/pms/team-workload', { params }),
  getApprovalQueue: () => api.get('/api/pms/approval-queue'),
  getEscalations: () => api.get('/api/pms/escalations'),
  getCapacity: (params?: any) => api.get('/api/pms/capacity', { params }),
  updateMemberHours: (memberId: number, hoursPerDay: number) =>
    api.patch(`/api/pms/members/${memberId}/hours`, null, { params: { hours_per_day: hoursPerDay } }),
  getAuditTrail: (params?: any) => api.get('/api/pms/audit-trail', { params }),
```

### Step 2: Commit

```bash
git add frontend/lib/api.ts
git commit -m "feat(pms): add PM/Admin API client methods"
```

---

## Task 6: Navigation Role-Gating

**Files:**
- Modify: `frontend/components/AdminNav.tsx` — update PMS sidebar items with role-based visibility

### Step 1: Add PM role detection and update PMS nav items

Replace the PMS section in `sidebarGroups` (lines 107-114) with:

```typescript
    {
        label: 'PMS',
        items: [
            { href: '/admin/pms', label: 'Dashboard', icon: '📊', pageKey: 'pms' },
            { href: '/admin/pms/my-tasks', label: 'My Tasks', icon: '✅', pageKey: 'pms' },
            { href: '/admin/pms/approval-queue', label: 'Approval Queue', icon: '👁️', pageKey: 'pms', pmOnly: true },
            { href: '/admin/pms/team-workload', label: 'Team Workload', icon: '👥', pageKey: 'pms', pmOnly: true },
            { href: '/admin/pms/capacity', label: 'Capacity Planning', icon: '📐', pageKey: 'pms', pmOnly: true },
            { href: '/admin/pms/escalations', label: 'Escalations', icon: '🚨', pageKey: 'pms', adminOnly: true },
            { href: '/admin/pms/audit-trail', label: 'Audit Trail', icon: '📜', pageKey: 'pms', adminOnly: true },
            { href: '/admin/pms/reports', label: 'Reports', icon: '📈', pageKey: 'pms' },
            { href: '/admin/pms/labels', label: 'Labels', icon: '🏷️', pageKey: 'pms' },
        ],
    },
```

Then in the `AdminNavInner` component, add a state for `isPm`:

```typescript
const [isPm, setIsPm] = useState(false)
```

In the existing `useEffect` that reads user from localStorage (around line 152-161), after setting `userRole`, add a check by fetching the dashboard:

```typescript
// Check PM status from dashboard
if (hasPageAccess('pms')) {
    api.get('/api/pms/dashboard', { params: { stale_days: 7 } })
        .then(r => setIsPm(r.data?.is_pm || false))
        .catch(() => {})
}
```

You'll need to import `api` from `@/lib/api` at the top (add `import { api } from '@/lib/api'` if not already imported — note: `api` is the axios instance).

Then update the `visibleItems` filter (line 247-260) to also check `pmOnly` and `adminOnly`:

```typescript
const visibleItems = group.items.filter((item: any) => {
    if (userRole === 'admin') return true;
    if (item.adminOnly) return false;
    if (item.pmOnly) return isPm;
    if (item.pageKey) return hasPageAccess(item.pageKey);
    if (item.permission) return item.permission();
    return true;
});
```

### Step 2: Commit

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat(pms): role-gated PMS navigation for PM and Admin"
```

---

## Task 7: Frontend — Team Workload Page

**Files:**
- Create: `frontend/app/admin/pms/team-workload/page.tsx`

### Step 1: Create Team Workload page

Create the file with the full component (follow same layout pattern as my-tasks page):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const STAGE_COLORS: Record<string, string> = {
  development: '#6366f1', qa: '#f59e0b', pm_review: '#a855f7',
  client_review: '#06b6d4', approved: '#22c55e',
};

function EffBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-gray-400">—</span>;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

export default function TeamWorkloadPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string>('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<any[]>([]);
  const [sortBy, setSortBy] = useState('active_tasks');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    setLoading(true);
    pmsApi.getTeamWorkload({ project_id: projectId || undefined })
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  const handleExpand = (userId: number) => {
    if (expanded === userId) { setExpanded(null); return; }
    setExpanded(userId);
    // Fetch tasks for this user (using my-tasks endpoint won't work for other users)
    // We'll show the data we already have from the workload endpoint
    setExpandedTasks([]);
  };

  const sorted = (data?.members || []).slice().sort((a: any, b: any) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Team Workload</h1>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All Projects</option>
            {(data?.projects || []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : sorted.length === 0 ? (
          <div className="text-gray-400 text-center py-20">No team members found.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sorted.map((m: any) => (
              <div key={m.user_id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleExpand(m.user_id)}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
                    {(m.name || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{m.name}</h3>
                    <p className="text-xs text-gray-500 capitalize">{m.role}</p>
                  </div>
                  <EffBadge value={m.efficiency} />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div>
                    <p className="text-lg font-bold text-gray-900">{m.active_tasks}</p>
                    <p className="text-xs text-gray-500">Tasks</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-gray-900">{m.actual_hours}<span className="text-sm text-gray-400">/{m.estimated_hours}</span></p>
                    <p className="text-xs text-gray-500">Hours</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold ${m.overdue_count > 0 ? 'text-red-600' : 'text-gray-900'}`}>{m.overdue_count}</p>
                    <p className="text-xs text-gray-500">Overdue</p>
                  </div>
                </div>

                {/* Stage breakdown bar */}
                {m.active_tasks > 0 && (
                  <div className="flex rounded-full overflow-hidden h-2 bg-gray-100">
                    {Object.entries(m.stage_breakdown || {}).map(([stage, count]: [string, any]) => (
                      <div key={stage} style={{
                        width: `${(count / m.active_tasks) * 100}%`,
                        backgroundColor: STAGE_COLORS[stage] || '#9ca3af',
                      }} title={`${stage}: ${count}`} />
                    ))}
                  </div>
                )}
                {m.active_tasks > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    {Object.entries(m.stage_breakdown || {}).map(([stage, count]: [string, any]) => (
                      <span key={stage} className="text-xs text-gray-400">{stage.replace('_', ' ')}: {count}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
git add frontend/app/admin/pms/team-workload/page.tsx
git commit -m "feat(pms): add Team Workload page"
```

---

## Task 8: Frontend — Approval Queue Page

**Files:**
- Create: `frontend/app/admin/pms/approval-queue/page.tsx`

### Step 1: Create Approval Queue page

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const PRIORITY_DOT: Record<string, string> = { low: 'bg-gray-400', medium: 'bg-yellow-500', high: 'bg-orange-500', urgent: 'bg-red-500' };

export default function ApprovalQueuePage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pm_review' | 'client_review'>('pm_review');
  const [actionNote, setActionNote] = useState('');
  const [actingOn, setActingOn] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    pmsApi.getApprovalQueue()
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleTransition = async (taskId: number, toStage: string) => {
    setActingOn(taskId);
    try {
      await pmsApi.transitionTask(taskId, { to_stage: toStage, note: actionNote || undefined });
      setActionNote('');
      load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Transition failed');
    }
    setActingOn(null);
  };

  if (!user) return null;

  const tasks = tab === 'pm_review' ? (data?.pm_review || []) : (data?.client_review || []);

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Approval Queue</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => setTab('pm_review')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'pm_review' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Awaiting My Review
            {(data?.counts?.pm_review || 0) > 0 && (
              <span className="ml-2 bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">{data.counts.pm_review}</span>
            )}
          </button>
          <button onClick={() => setTab('client_review')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'client_review' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Client Review
            {(data?.counts?.client_review || 0) > 0 && (
              <span className="ml-2 bg-cyan-100 text-cyan-700 text-xs px-2 py-0.5 rounded-full">{data.counts.client_review}</span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="text-gray-400 text-center py-20">No tasks awaiting review.</div>
        ) : (
          <div className="space-y-3">
            {tasks.map((t: any) => (
              <div key={t.id} className={`bg-white rounded-xl border p-5 ${t.is_overdue ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2.5 h-2.5 rounded-full ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} />
                      <Link href={`/admin/pms/${t.project_id}`} className="font-semibold text-gray-900 hover:text-indigo-600 truncate">
                        {t.title}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        {t.project_color && <span className="w-2 h-2 rounded-full" style={{ background: t.project_color }} />}
                        {t.project_name}
                      </span>
                      <span>&middot;</span>
                      <span>{t.assignee_name || 'Unassigned'}</span>
                      {t.days_in_stage != null && (
                        <>
                          <span>&middot;</span>
                          <span className={t.days_in_stage >= 3 ? 'text-amber-600 font-medium' : ''}>
                            {t.days_in_stage}d in {t.stage?.replace('_', ' ')}
                          </span>
                        </>
                      )}
                      {t.due_date && (
                        <>
                          <span>&middot;</span>
                          <span className={t.is_overdue ? 'text-red-600 font-medium' : ''}>Due: {t.due_date}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {tab === 'pm_review' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input value={actingOn === t.id ? actionNote : ''} onChange={e => { setActingOn(t.id); setActionNote(e.target.value); }}
                        placeholder="Note (optional)" className="border rounded px-2 py-1.5 text-xs w-40" />
                      <button onClick={() => handleTransition(t.id, 'client_review')}
                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700">
                        Approve
                      </button>
                      <button onClick={() => handleTransition(t.id, 'development')}
                        className="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-100">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
git add frontend/app/admin/pms/approval-queue/page.tsx
git commit -m "feat(pms): add Approval Queue page"
```

---

## Task 9: Frontend — Escalation Queue Page

**Files:**
- Create: `frontend/app/admin/pms/escalations/page.tsx`

### Step 1: Create Escalations page

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'border-red-400 bg-red-50',
  high: 'border-orange-300 bg-orange-50',
  medium: 'border-yellow-200 bg-yellow-50',
};
const TRIGGER_BADGE: Record<string, string> = {
  overdue: 'bg-red-100 text-red-700',
  over_hours: 'bg-orange-100 text-orange-700',
  stuck: 'bg-amber-100 text-amber-700',
};

export default function EscalationsPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pmsApi.getEscalations()
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (!user) return null;
  const escalations = data?.escalations || [];
  const counts = data?.counts || {};

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Escalations</h1>

        {/* Summary bar */}
        <div className="flex gap-4 mb-6">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            <span className="text-2xl font-bold text-red-700">{counts.critical || 0}</span>
            <span className="text-sm text-red-600 ml-2">Critical</span>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2">
            <span className="text-2xl font-bold text-orange-700">{counts.high || 0}</span>
            <span className="text-sm text-orange-600 ml-2">High</span>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
            <span className="text-2xl font-bold text-yellow-700">{counts.medium || 0}</span>
            <span className="text-sm text-yellow-600 ml-2">Medium</span>
          </div>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : escalations.length === 0 ? (
          <div className="text-green-600 text-center py-20 font-medium">No escalations. All clear!</div>
        ) : (
          <div className="space-y-3">
            {escalations.map((e: any) => (
              <div key={e.id} className={`rounded-xl border-l-4 p-5 ${SEVERITY_COLORS[e.severity] || 'border-gray-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <Link href={`/admin/pms/${e.project_id}`}
                      className="font-semibold text-gray-900 hover:text-indigo-600">
                      {e.title}
                    </Link>
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                      {e.project_color && <span className="w-2 h-2 rounded-full" style={{ background: e.project_color }} />}
                      <span>{e.project_name}</span>
                      <span>&middot;</span>
                      <span>{e.assignee_name || 'Unassigned'}</span>
                      <span>&middot;</span>
                      <span className="capitalize">{e.stage?.replace('_', ' ')}</span>
                      {e.due_date && <><span>&middot;</span><span>Due: {e.due_date}</span></>}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {e.triggers.map((tr: any, i: number) => (
                        <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${TRIGGER_BADGE[tr.type] || 'bg-gray-100 text-gray-600'}`}>
                          {tr.detail}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500 flex-shrink-0">
                    <p>{e.actual_hours || 0}h / {e.estimated_hours || 0}h</p>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full font-semibold uppercase text-xs ${
                      e.severity === 'critical' ? 'bg-red-600 text-white' :
                      e.severity === 'high' ? 'bg-orange-500 text-white' : 'bg-yellow-400 text-yellow-900'
                    }`}>{e.severity}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
git add frontend/app/admin/pms/escalations/page.tsx
git commit -m "feat(pms): add Escalations page"
```

---

## Task 10: Frontend — Capacity Planning Page

**Files:**
- Create: `frontend/app/admin/pms/capacity/page.tsx`

### Step 1: Create Capacity Planning page

```tsx
'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const RANGES = [
  { value: 'this_week', label: 'This Week' },
  { value: 'next_2_weeks', label: 'Next 2 Weeks' },
  { value: 'this_month', label: 'This Month' },
  { value: 'next_month', label: 'Next Month' },
];

function UtilBar({ pct }: { pct: number }) {
  const color = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-medium ${pct > 100 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : 'text-green-600'}`}>
        {pct}%
      </span>
    </div>
  );
}

export default function CapacityPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('this_week');
  const [projectId, setProjectId] = useState('');
  const [editingHours, setEditingHours] = useState<Record<number, string>>({});

  useEffect(() => {
    setLoading(true);
    pmsApi.getCapacity({ project_id: projectId || undefined, range })
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [range, projectId]);

  const handleHoursUpdate = async (memberId: number, userId: number) => {
    const val = parseFloat(editingHours[userId] || '7');
    if (isNaN(val) || val < 1 || val > 24) return;
    await pmsApi.updateMemberHours(memberId, val);
    setEditingHours(prev => { const n = { ...prev }; delete n[userId]; return n; });
    // Reload
    pmsApi.getCapacity({ project_id: projectId || undefined, range })
      .then(r => setData(r.data));
  };

  if (!user) return null;
  const members = data?.members || [];
  const summary = data?.summary || {};

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Capacity Planning</h1>
          <div className="flex gap-3">
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm">
              <option value="">All Projects</option>
              {(data?.projects || []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {RANGES.map(r => (
                <button key={r.value} onClick={() => setRange(r.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    range === r.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{r.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary */}
        {data?.range && (
          <div className="flex gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-3">
              <p className="text-xs text-gray-500">Business Days</p>
              <p className="text-xl font-bold">{summary.business_days}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-3">
              <p className="text-xs text-gray-500">Team Capacity</p>
              <p className="text-xl font-bold">{summary.total_capacity}h</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-3">
              <p className="text-xs text-gray-500">Committed</p>
              <p className="text-xl font-bold">{summary.total_committed}h</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-3">
              <p className="text-xs text-gray-500">Available</p>
              <p className={`text-xl font-bold ${summary.total_available < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {summary.total_available}h
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Hours/Day</th>
                  <th className="px-5 py-3">Capacity</th>
                  <th className="px-5 py-3">Committed</th>
                  <th className="px-5 py-3">Available</th>
                  <th className="px-5 py-3">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m: any) => (
                  <tr key={m.user_id} className="border-t hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{m.name}</td>
                    <td className="px-5 py-3 text-gray-500 capitalize">{m.role}</td>
                    <td className="px-5 py-3">
                      {editingHours[m.user_id] !== undefined ? (
                        <div className="flex items-center gap-1">
                          <input type="number" min={1} max={24} step={0.5}
                            value={editingHours[m.user_id]}
                            onChange={e => setEditingHours(prev => ({ ...prev, [m.user_id]: e.target.value }))}
                            className="border rounded px-2 py-1 w-16 text-xs" />
                          <button onClick={() => handleHoursUpdate(0, m.user_id)}
                            className="text-xs text-indigo-600 hover:text-indigo-800">Save</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingHours(prev => ({ ...prev, [m.user_id]: String(m.hours_per_day) }))}
                          className="text-gray-700 hover:text-indigo-600">{m.hours_per_day}h</button>
                      )}
                    </td>
                    <td className="px-5 py-3">{m.capacity}h</td>
                    <td className="px-5 py-3">{m.committed}h</td>
                    <td className={`px-5 py-3 font-medium ${m.available < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {m.available}h
                    </td>
                    <td className="px-5 py-3"><UtilBar pct={m.utilization_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
git add frontend/app/admin/pms/capacity/page.tsx
git commit -m "feat(pms): add Capacity Planning page"
```

---

## Task 11: Frontend — Audit Trail Page

**Files:**
- Create: `frontend/app/admin/pms/audit-trail/page.tsx`

### Step 1: Create Audit Trail page

```tsx
'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const ACTION_ICONS: Record<string, string> = {
  stage_change: '🔄',
  assignee_change: '👤',
  member_added: '➕',
  member_removed: '➖',
  milestone_change: '🏁',
};
const ACTION_COLORS: Record<string, string> = {
  stage_change: 'bg-indigo-100 text-indigo-700',
  assignee_change: 'bg-blue-100 text-blue-700',
  member_added: 'bg-green-100 text-green-700',
  member_removed: 'bg-red-100 text-red-700',
  milestone_change: 'bg-amber-100 text-amber-700',
};

function formatDetails(actionType: string, details: any): string {
  if (!details) return '';
  switch (actionType) {
    case 'stage_change':
      return `moved "${details.task_title}" from ${details.from || '—'} → ${details.to}${details.note ? ` (${details.note})` : ''}`;
    case 'assignee_change':
      return `reassigned "${details.task_title}" from ${details.from || 'unassigned'} → ${details.to || 'unassigned'}`;
    case 'member_added':
      return `added user #${details.user_id} as ${details.role}`;
    case 'member_removed':
      return `removed user #${details.user_id}`;
    case 'milestone_change':
      return `updated milestone "${details.milestone}"`;
    default:
      return JSON.stringify(details);
  }
}

export default function AuditTrailPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<any>({ project_id: '', action_type: '', actor_id: '', date_from: '', date_to: '' });
  const [page, setPage] = useState(1);

  const load = (p: number = 1) => {
    setLoading(true);
    const params: any = { page: p };
    if (filters.project_id) params.project_id = filters.project_id;
    if (filters.action_type) params.action_type = filters.action_type;
    if (filters.actor_id) params.actor_id = filters.actor_id;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    pmsApi.getAuditTrail(params)
      .then(r => { setData(r.data); setPage(p); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleFilterChange = (key: string, val: string) => {
    setFilters((prev: any) => ({ ...prev, [key]: val }));
  };

  const applyFilters = () => load(1);

  if (!user) return null;
  const logs = data?.logs || [];
  const filterOpts = data?.filters || {};

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Audit Trail</h1>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Project</label>
            <select value={filters.project_id} onChange={e => handleFilterChange('project_id', e.target.value)}
              className="border rounded px-3 py-1.5 text-sm">
              <option value="">All</option>
              {(filterOpts.projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Action</label>
            <select value={filters.action_type} onChange={e => handleFilterChange('action_type', e.target.value)}
              className="border rounded px-3 py-1.5 text-sm">
              <option value="">All</option>
              {(filterOpts.action_types || []).map((a: string) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Actor</label>
            <select value={filters.actor_id} onChange={e => handleFilterChange('actor_id', e.target.value)}
              className="border rounded px-3 py-1.5 text-sm">
              <option value="">All</option>
              {(filterOpts.actors || []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">From</label>
            <input type="date" value={filters.date_from} onChange={e => handleFilterChange('date_from', e.target.value)}
              className="border rounded px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">To</label>
            <input type="date" value={filters.date_to} onChange={e => handleFilterChange('date_to', e.target.value)}
              className="border rounded px-3 py-1.5 text-sm" />
          </div>
          <button onClick={applyFilters}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">
            Apply
          </button>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="text-gray-400 text-center py-20">No audit logs found.</div>
        ) : (
          <>
            <div className="space-y-2">
              {logs.map((log: any) => (
                <div key={log.id} className="bg-white rounded-lg border border-gray-200 px-5 py-3 flex items-start gap-3">
                  <span className="text-lg mt-0.5">{ACTION_ICONS[log.action_type] || '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{log.actor_name || 'System'}</span>
                      {' '}
                      {formatDetails(log.action_type, log.details)}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                      <span className={`px-1.5 py-0.5 rounded-full ${ACTION_COLORS[log.action_type] || 'bg-gray-100 text-gray-600'}`}>
                        {log.action_type?.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {(data?.pages || 0) > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                <button disabled={page <= 1} onClick={() => load(page - 1)}
                  className="px-3 py-1.5 rounded border text-sm disabled:opacity-50">Prev</button>
                <span className="px-3 py-1.5 text-sm text-gray-500">Page {page} of {data.pages}</span>
                <button disabled={page >= data.pages} onClick={() => load(page + 1)}
                  className="px-3 py-1.5 rounded border text-sm disabled:opacity-50">Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Commit

```bash
git add frontend/app/admin/pms/audit-trail/page.tsx
git commit -m "feat(pms): add Audit Trail page"
```

---

## Task 12: Frontend — Enhanced Dashboard (PM/Admin widgets)

**Files:**
- Modify: `frontend/app/admin/pms/page.tsx` — add admin metrics, weekly digest, cross-project timeline, cross-project summary table

### Step 1: Add PM/Admin sections to dashboard

After the existing metrics cards grid (around line 122), add these conditional sections:

**Admin-only extra metric cards** (add 3 more cards to the grid for admin):
- Health Score card
- Escalations card (links to `/admin/pms/escalations`)
- Pending Approvals card (links to `/admin/pms/approval-queue`)

**PM weekly digest card** (after metrics, before My Tasks):
- Collapsible "This Week Summary" card showing completed, new overdue, created, transitions

**PM cross-project deadlines** (after My Tasks, before Projects):
- "My Deadlines" timeline list for next 30 days

**Admin cross-project summary table** (after Projects grid):
- Sortable table with all projects: name, PM, tasks, completion %, overdue, efficiency, health

These all use data already returned by the enhanced dashboard endpoint (`is_pm`, `is_admin`, `health_score`, `approval_counts`, `escalation_count`, `weekly_digest`, `upcoming_deadlines`, `cross_project_summary`).

The dashboard page needs to be updated to:
1. Read `data?.is_pm`, `data?.is_admin` from the response
2. Conditionally render the new widgets
3. Add the cross-project summary table at the bottom

### Step 2: Commit

```bash
git add frontend/app/admin/pms/page.tsx
git commit -m "feat(pms): add PM/Admin widgets to dashboard"
```

---

## Task 13: Frontend — Enhanced Reports (Admin-only charts)

**Files:**
- Modify: `frontend/app/admin/pms/reports/page.tsx` — add 2 admin-only charts

### Step 1: Add admin-only charts

At the bottom of the reports page, add conditionally (if user is admin):

1. **Project Comparison Bar Chart** — uses `data?.project_comparison` with Recharts BarChart showing completion_pct, efficiency, on_time_pct per project

2. **Team Velocity Comparison** — uses `data?.team_velocity` with Recharts LineChart showing multiple series (one per project) of completed tasks/week

Check admin status from `authAPI.getUser()?.role === 'admin'`.

### Step 2: Commit

```bash
git add frontend/app/admin/pms/reports/page.tsx
git commit -m "feat(pms): add admin-only charts to Reports page"
```

---

## Task 14: Build Verification

### Step 1: Verify frontend builds

Run: `cd frontend && npm run build 2>&1 | tail -30`

Check for errors in PMS files specifically. Pre-existing errors in other modules are acceptable.

### Step 2: Verify backend imports

Run: `cd backend && source venv/bin/activate && python -c "from app.routes.pms import router; print('Routes OK')" && python -c "from app.models.pms import PMSAuditLog, PMSProjectMember; print('Models OK')"`

### Step 3: Final commit if any fixes needed

```bash
git add -A && git commit -m "fix(pms): build fixes for PM/Admin features"
```
