# PMS Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 enhancements to the PMS module: Dashboard, My Tasks, Filters, Overdue Alerts, Labels UI, and Reports.

**Architecture:** All backend endpoints follow existing FastAPI patterns (`Depends(get_db)`, `Depends(get_current_user)`, `require_page("pms")`). Frontend uses Next.js App Router client components with Axios API calls via `pmsApi`. New DB tables via inline SQL in `main.py`. No test framework — verify via Swagger and frontend.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, Next.js 14, TailwindCSS, Recharts (new dependency for charts).

---

## Phase 1: Global Labels (Backend + Frontend)

Labels are a dependency for Filters (Phase 3), so build first.

### Task 1.1: PMSLabelDefinition model + migration

**Files:**
- Modify: `backend/app/models/pms.py`
- Modify: `backend/main.py` (inline SQL migration)

**Step 1: Add PMSLabelDefinition model**

Add to `backend/app/models/pms.py` after the `PMSAlert` class:

```python
class PMSLabelDefinition(Base):
    __tablename__ = "pms_label_definitions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    color = Column(String, default="#6366f1")
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
```

**Step 2: Add `label_definition_id` to PMSTaskLabel model**

In the existing `PMSTaskLabel` class, add:

```python
label_definition_id = Column(Integer, ForeignKey("pms_label_definitions.id", ondelete="CASCADE"), nullable=True)
```

**Step 3: Add inline SQL migration in `main.py`**

Find the PMS-related migrations section in `main.py` and add:

```python
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS pms_label_definitions (
        id SERIAL PRIMARY KEY,
        name VARCHAR UNIQUE NOT NULL,
        color VARCHAR DEFAULT '#6366f1',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))
conn.execute(text("""
    ALTER TABLE pms_task_labels ADD COLUMN IF NOT EXISTS label_definition_id INTEGER REFERENCES pms_label_definitions(id) ON DELETE CASCADE
"""))
```

**Step 4: Verify** — Start backend (`cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000`), check logs for no errors.

**Step 5: Commit** — `git commit -m "feat(pms): add PMSLabelDefinition model and migration"`

---

### Task 1.2: Label CRUD endpoints

**Files:**
- Modify: `backend/app/schemas/pms.py`
- Modify: `backend/app/routes/pms.py`

**Step 1: Add schemas to `backend/app/schemas/pms.py`**

```python
# ── Label Definition ─────────────────────────────────────
class PMSLabelDefCreate(BaseModel):
    name: str
    color: str = "#6366f1"

class PMSLabelDefUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

class PMSLabelDefOut(BaseModel):
    id: int
    name: str
    color: str
    created_by: Optional[int]
    created_at: datetime
    class Config: from_attributes = True
```

**Step 2: Add label endpoints to `backend/app/routes/pms.py`**

Import `PMSLabelDefinition` in the imports from `app.models.pms`.

Add after the Gantt section:

```python
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
```

**Step 3: Verify** — Restart backend, test via Swagger: create label, list labels, attach to task, detach.

**Step 4: Commit** — `git commit -m "feat(pms): add global label CRUD and task attach/detach endpoints"`

---

### Task 1.3: Frontend API client + Labels UI

**Files:**
- Modify: `frontend/lib/api.ts` (add label API methods to `pmsApi`)
- Modify: `frontend/components/AdminNav.tsx` (add Labels nav item under PMS)
- Create: `frontend/app/admin/pms/labels/page.tsx`

**Step 1: Add to `pmsApi` in `frontend/lib/api.ts`**

Add after the `createTaskFromTicket` method:

```typescript
  // Labels (global library)
  listLabels: () => api.get('/api/pms/labels'),
  createLabel: (data: any) => api.post('/api/pms/labels', data),
  updateLabel: (id: number, data: any) => api.put(`/api/pms/labels/${id}`, data),
  deleteLabel: (id: number) => api.delete(`/api/pms/labels/${id}`),
  attachLabel: (taskId: number, labelId: number) => api.post(`/api/pms/tasks/${taskId}/labels/${labelId}`),
  detachLabel: (taskId: number, labelId: number) => api.delete(`/api/pms/tasks/${taskId}/labels/${labelId}`),
```

**Step 2: Add nav item in `frontend/components/AdminNav.tsx`**

In the PMS section of `sidebarGroups`, add after the Projects item:

```typescript
{ href: '/admin/pms/labels', label: 'Labels', icon: '🏷️', pageKey: 'pms' },
```

**Step 3: Create `frontend/app/admin/pms/labels/page.tsx`**

Full page with:
- List of global labels (color dot + name)
- "Add Label" button → inline form (name input + color picker + save)
- Edit button → inline edit of name/color
- Delete button with confirmation
- Admin-only check (redirect or hide if not admin)

Pattern: Follow existing PMS page patterns — `'use client'`, `useEffect` to fetch, `MainHeader` + `AdminNav` layout.

**Step 4: Add label chips to Board/List views**

Modify `frontend/components/pms/BoardView.tsx` — show label chips on task cards (small colored pills with label name).

Modify `frontend/components/pms/ListView.tsx` — show label chips in a new "Labels" column or inline below task title.

Modify `frontend/components/pms/GanttChart.tsx` — show label chips in the task detail sidebar with "+" button to add/remove labels.

**Step 5: Verify** — Start frontend (`cd frontend && npm run dev`), navigate to `/admin/pms/labels`, create a label, attach to a task, verify chips appear on Board/List/Gantt.

**Step 6: Commit** — `git commit -m "feat(pms): add global labels UI with management page and task label chips"`

---

## Phase 2: Dashboard + Performance Indicator

### Task 2.1: Dashboard backend endpoint

**Files:**
- Modify: `backend/app/routes/pms.py`
- Modify: `backend/app/schemas/pms.py`

**Step 1: Add helper function for business days calculation**

Add near top of `backend/app/routes/pms.py`:

```python
from datetime import date as date_type, timedelta

def _business_days(start: date_type, end: date_type) -> int:
    """Count weekdays between two dates (inclusive of start, exclusive of end)."""
    if not start or not end or end <= start:
        return 0
    days = 0
    current = start
    while current < end:
        if current.weekday() < 5:  # Mon-Fri
            days += 1
        current += timedelta(days=1)
    return max(days, 1)  # at least 1 to avoid division by zero

def _task_efficiency(task, today=None) -> float | None:
    """Calculate efficiency for a single task. Returns None if not calculable."""
    if not task.estimated_hours or task.estimated_hours <= 0 or not task.start_date:
        return None
    today = today or date_type.today()
    end = today if task.stage != "completed" else (task.updated_at.date() if task.updated_at else today)
    bdays = _business_days(task.start_date, end)
    capacity = bdays * 7
    if capacity <= 0:
        return None
    return min(round((task.estimated_hours / capacity) * 100, 1), 100.0)
```

**Step 2: Add dashboard endpoint**

```python
@router.get("/dashboard")
def get_dashboard(stale_days: int = 7, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from datetime import timedelta
    today = date_type.today()
    stale_cutoff = today - timedelta(days=stale_days)

    # Get accessible projects
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

    # My tasks (for widget)
    my_tasks = sorted(
        [t for t in all_tasks if t.assignee_id == current_user.id and t.stage != "completed"],
        key=lambda t: (0 if t.due_date and t.due_date < today else 1, t.due_date or date_type.max)
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

    # Project cards with progress
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

    # Member efficiency (for current user)
    my_active = [t for t in all_tasks if t.assignee_id == current_user.id and t.stage != "completed"]
    my_efficiencies = [_task_efficiency(t, today) for t in my_active]
    my_efficiencies = [e for e in my_efficiencies if e is not None]
    my_avg_efficiency = round(sum(my_efficiencies) / len(my_efficiencies), 1) if my_efficiencies else None

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
    }
```

**Step 3: Verify** — Swagger: `GET /api/pms/dashboard?stale_days=7`

**Step 4: Commit** — `git commit -m "feat(pms): add dashboard endpoint with metrics, efficiency, and project cards"`

---

### Task 2.2: Dashboard frontend page

**Files:**
- Modify: `frontend/app/admin/pms/page.tsx` (replace projects list with dashboard)
- Modify: `frontend/lib/api.ts` (add dashboard API method)
- Modify: `frontend/components/AdminNav.tsx` (update PMS nav items)

**Step 1: Add to `pmsApi` in `frontend/lib/api.ts`**

```typescript
  // Dashboard
  getDashboard: (staleDays?: number) => api.get('/api/pms/dashboard', { params: { stale_days: staleDays || 7 } }),
```

**Step 2: Update AdminNav PMS section**

Replace the PMS group items:

```typescript
{
    label: 'PMS',
    items: [
        { href: '/admin/pms', label: 'Dashboard', icon: '📊', pageKey: 'pms' },
        { href: '/admin/pms/my-tasks', label: 'My Tasks', icon: '✅', pageKey: 'pms' },
        { href: '/admin/pms/reports', label: 'Reports', icon: '📈', pageKey: 'pms' },
        { href: '/admin/pms/labels', label: 'Labels', icon: '🏷️', pageKey: 'pms' },
    ],
},
```

**Step 3: Rewrite `frontend/app/admin/pms/page.tsx`**

Replace the entire file with the dashboard layout:
- Top: 6 metric cards in a grid (2x3 or 3x2 depending on screen)
- Each card: icon, value, label, sub-text (e.g. "72% completed")
- Stale Tasks card has a dropdown: 3d / 7d / 14d / 30d
- Overdue and Urgent/Client cards are clickable (navigate to My Tasks with filter)
- Middle: "My Tasks" widget — compact table, 5 rows max, "View All →" link
- Show "Your avg efficiency: X%" badge in the My Tasks header
- Bottom: Projects grid with progress bars, overdue badges, efficiency badges

Follow existing patterns: `'use client'`, `useEffect` + `pmsApi.getDashboard()`, `MainHeader` + `AdminNav`.

**Step 4: Verify** — Navigate to `/admin/pms`, verify all 6 metric cards render, My Tasks widget shows data, project cards have progress bars.

**Step 5: Commit** — `git commit -m "feat(pms): replace projects list with dashboard page"`

---

## Phase 3: My Tasks (Cross-Project)

### Task 3.1: My Tasks backend endpoint

**Files:**
- Modify: `backend/app/routes/pms.py`

**Step 1: Add my-tasks endpoint**

```python
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
    today = date_type.today()
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
```

**Step 2: Verify** — Swagger: `GET /api/pms/my-tasks`, `GET /api/pms/my-tasks?priority=high`

**Step 3: Commit** — `git commit -m "feat(pms): add my-tasks cross-project endpoint with filters"`

---

### Task 3.2: My Tasks frontend page

**Files:**
- Modify: `frontend/lib/api.ts` (add myTasks method)
- Create: `frontend/app/admin/pms/my-tasks/page.tsx`

**Step 1: Add to `pmsApi`**

```typescript
  // My Tasks
  getMyTasks: (params?: any) => api.get('/api/pms/my-tasks', { params }),
```

**Step 2: Create `frontend/app/admin/pms/my-tasks/page.tsx`**

Full page with:
- Header: "My Tasks" + "Your avg efficiency: X%" badge (green/amber/red)
- Filter bar: Stage dropdown, Priority dropdown, Project dropdown (fetched from `listProjects`), Due date range (two date inputs)
- Grouping toggle: "Flat" / "By Project" buttons
- Table columns: Task title (clickable → `/admin/pms/{project_id}?task={id}`), Project (color dot + name), Priority badge, Stage badge, Due date (red if overdue, amber if <=2 days), Hours (actual/estimated), Efficiency badge
- Default sort: overdue first, then due_date ascending
- Clickable column headers for sort toggle

Pattern: `'use client'`, `MainHeader` + `AdminNav`, fetch on mount and on filter change.

**Step 3: Verify** — Navigate to `/admin/pms/my-tasks`, verify table renders, filters work, sorting works.

**Step 4: Commit** — `git commit -m "feat(pms): add My Tasks cross-project page with filters and sorting"`

---

## Phase 4: Filters & Sorting (List + Board Views)

### Task 4.1: Add filter bar component

**Files:**
- Create: `frontend/components/pms/FilterBar.tsx`

**Step 1: Create shared FilterBar component**

Reusable filter bar used by both ListView and BoardView. Props:
- `members: any[]` — project members for assignee filter
- `milestones: any[]` — project milestones
- `labels: any[]` — global labels
- `filters: FilterState` — current filter values
- `onFilterChange: (filters: FilterState) => void`
- `hideStageFilter?: boolean` — true for BoardView

FilterState type:
```typescript
type FilterState = {
  assignees: number[];
  priorities: string[];
  stages: string[];
  milestone_id: number | null;
  due_from: string;
  due_to: string;
  labels: number[];
  created_from: string;
  created_to: string;
  has_attachments: boolean | null;
};
```

UI:
- Row of dropdowns/chips for each filter
- Multi-select for assignee (checkboxes in dropdown)
- Priority chips: clickable toggle (Low / Medium / High / Urgent)
- Stage chips: same pattern (hidden when `hideStageFilter`)
- Milestone: single-select dropdown
- Due date range: two `<input type="date">` fields
- Labels: multi-select dropdown with color dots
- Created date range: two date inputs
- Has attachments: toggle switch
- Below: active filter pills with X to remove, "Clear all" button

**Step 2: Commit** — `git commit -m "feat(pms): add reusable FilterBar component"`

---

### Task 4.2: Integrate filters into ListView

**Files:**
- Modify: `frontend/components/pms/ListView.tsx`

**Step 1: Add FilterBar import and state**

Replace the simple `filter` text search with the full FilterBar. Add state:
```typescript
const [filters, setFilters] = useState<FilterState>(defaultFilters);
const [sortBy, setSortBy] = useState<string>('');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
```

**Step 2: Implement client-side filtering logic**

Filter the `tasks` array based on all active filters:
- `assignees` → `t.assignee_id` in list
- `priorities` → `t.priority` in list
- `stages` → `t.stage` in list
- `milestone_id` → `t.milestone_id === value`
- `due_from/due_to` → date comparisons on `t.due_date`
- `labels` → `t.labels.some(l => selectedLabelIds.includes(l.label_definition_id || l.id))`
- `created_from/created_to` → date comparisons on `t.created_at`
- `has_attachments` → requires attachment count (add to `_enrich_task` or check `t.attachments`)

**Step 3: Implement sortable column headers**

Clickable headers for: Priority, Due Date, Created, Hours. Toggle asc → desc → none.

**Step 4: Fetch global labels** — call `pmsApi.listLabels()` on mount, pass to FilterBar.

**Step 5: Verify** — Open a project in List view, verify all filters work, sorting toggles work.

**Step 6: Commit** — `git commit -m "feat(pms): add full filter bar and sorting to ListView"`

---

### Task 4.3: Integrate filters into BoardView

**Files:**
- Modify: `frontend/components/pms/BoardView.tsx`

**Step 1: Add FilterBar with `hideStageFilter={true}`**

Same pattern as ListView but stage filter is hidden (columns represent stages).

**Step 2: Apply same client-side filtering logic**

Filter tasks before grouping into stage columns.

**Step 3: Verify** — Open a project in Board view, apply filters, verify cards filter correctly.

**Step 4: Commit** — `git commit -m "feat(pms): add filter bar to BoardView"`

---

## Phase 5: Overdue Alerts + Visual Badges + Daily Digest + Email

### Task 5.1: Enhance overdue scheduler + add daily digest

**Files:**
- Modify: `backend/main.py` (update existing `check_pms_overdue_tasks`, add `send_pms_overdue_digest`)

**Step 1: Update `check_pms_overdue_tasks` interval**

Change from `minutes=15` to `minutes=60` (every hour as per design). The existing function logic is already correct — fires to assignees + PMs, de-duplicates.

**Step 2: Add daily digest function**

Add new function after `check_pms_overdue_tasks`:

```python
def send_pms_overdue_digest():
    """Send daily digest email of overdue PMS tasks to PM and admin users."""
    from app.models.pms import PMSTask, PMSProject, PMSProjectMember
    from app.models.user import User
    from datetime import date as date_type
    db = SessionLocal()
    try:
        today = date_type.today()
        overdue = db.query(PMSTask).filter(
            PMSTask.due_date < today,
            PMSTask.stage.notin_(["approved", "completed"])
        ).all()
        if not overdue:
            return

        # Group by project
        by_project = {}
        for t in overdue:
            if t.project_id not in by_project:
                p = db.query(PMSProject).filter_by(id=t.project_id).first()
                by_project[t.project_id] = {"project": p, "tasks": []}
            by_project[t.project_id]["tasks"].append(t)

        # Find all PM + admin recipients
        recipients = {}  # user_id -> User
        admins = db.query(User).filter_by(role="admin", is_active=True).all()
        for u in admins:
            recipients[u.id] = u
        for pid in by_project:
            pms = db.query(PMSProjectMember).filter_by(project_id=pid, role="pm").all()
            for m in pms:
                if m.user_id not in recipients:
                    u = db.query(User).filter_by(id=m.user_id).first()
                    if u:
                        recipients[u.id] = u

        if not recipients:
            return

        # Build email body
        project_count = len(by_project)
        task_count = len(overdue)
        subject = f"PMS: {task_count} overdue task{'s' if task_count != 1 else ''} across {project_count} project{'s' if project_count != 1 else ''}"

        rows = ""
        for pid, data in by_project.items():
            p = data["project"]
            for t in data["tasks"]:
                days_over = (today - t.due_date).days
                assignee_name = t.assignee.full_name if t.assignee else "Unassigned"
                rows += f"<tr><td style='padding:8px;border-bottom:1px solid #e5e7eb;'>{t.title}</td>"
                rows += f"<td style='padding:8px;border-bottom:1px solid #e5e7eb;'>{p.name if p else 'Unknown'}</td>"
                rows += f"<td style='padding:8px;border-bottom:1px solid #e5e7eb;'>{assignee_name}</td>"
                rows += f"<td style='padding:8px;border-bottom:1px solid #e5e7eb;color:#dc2626;'>{days_over} day{'s' if days_over != 1 else ''}</td>"
                rows += f"<td style='padding:8px;border-bottom:1px solid #e5e7eb;'>{t.priority}</td></tr>"

        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
            <h2 style="color:#1f2937;">PMS Overdue Tasks Summary</h2>
            <p style="color:#6b7280;">{task_count} task(s) are overdue across {project_count} project(s).</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                    <tr style="background:#f9fafb;">
                        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Task</th>
                        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Project</th>
                        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Assignee</th>
                        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Overdue</th>
                        <th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Priority</th>
                    </tr>
                </thead>
                <tbody>{rows}</tbody>
            </table>
        </div>
        """

        # Send email to each recipient using email_service
        for uid, user in recipients.items():
            try:
                email_service.send_system_email(user.email, subject, html_body)
            except Exception as e:
                logger.error("PMS digest email to %s failed: %s", user.email, e)

    except Exception as e:
        logger.error("PMS overdue digest error: %s", e)
    finally:
        db.close()
```

**Step 3: Register the scheduler job**

Add after the `check_pms_overdue_tasks` job registration:

```python
scheduler.add_job(send_pms_overdue_digest, 'cron', hour=8, minute=0, id='pms_overdue_digest')
```

**Step 4: Verify** — Check backend logs on startup for scheduler registration. Optionally call the function manually to test email sending.

**Step 5: Commit** — `git commit -m "feat(pms): add hourly overdue check and daily digest email to PM+admin"`

---

### Task 5.2: Visual overdue badges in frontend

**Files:**
- Modify: `frontend/components/pms/BoardView.tsx`
- Modify: `frontend/components/pms/ListView.tsx`
- Modify: `frontend/app/admin/pms/page.tsx` (dashboard already has overdue card from Phase 2)

**Step 1: BoardView — add overdue visual indicators**

For each task card, check `t.due_date && new Date(t.due_date) < new Date() && t.stage !== 'completed'`:
- Add `border-l-4 border-red-500` class
- Add small red "Overdue" chip below the title

**Step 2: ListView — add overdue indicators**

For the due date column:
- If overdue: red text + red dot
- If due within 2 days: amber text

**Step 3: Verify** — Create a task with a past due date, verify red indicators appear on Board and List views.

**Step 4: Commit** — `git commit -m "feat(pms): add visual overdue badges to Board and List views"`

---

## Phase 6: Reports & Analytics

### Task 6.1: Install Recharts + Reports backend endpoint

**Files:**
- Modify: `frontend/package.json` (add recharts)
- Modify: `backend/app/routes/pms.py`

**Step 1: Install Recharts**

```bash
cd frontend && npm install recharts
```

**Step 2: Add reports endpoint**

```python
@router.get("/reports")
def get_reports(
    project_id: Optional[int] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import timedelta
    from collections import defaultdict
    today = date_type.today()
    start = start_date or (today - timedelta(days=56))  # 8 weeks
    end = end_date or today

    # Get tasks
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

    # Stage cycle time (average days in each stage from workflow history)
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

    # Velocity (tasks completed per week, last 8 weeks)
    velocity = []
    for w in range(8):
        week_start = today - timedelta(days=(7 * (8 - w)))
        week_end = week_start + timedelta(days=7)
        count = sum(1 for t in tasks if t.stage == "completed" and t.updated_at and week_start <= t.updated_at.date() < week_end)
        velocity.append({"week": week_start.isoformat(), "completed": count})

    # Burndown (remaining tasks over time — weekly snapshots, approximated)
    burndown = []
    total_created_before_start = sum(1 for t in tasks if t.created_at and t.created_at.date() <= start)
    remaining = total_created_before_start
    for w in range(9):
        snap_date = start + timedelta(days=(7 * w))
        if snap_date > today:
            break
        new_tasks = sum(1 for t in tasks if t.created_at and start + timedelta(days=(7*(w-1) if w > 0 else 0)) < t.created_at.date() <= snap_date)
        completed = sum(1 for t in tasks if t.stage == "completed" and t.updated_at and start + timedelta(days=(7*(w-1) if w > 0 else 0)) < t.updated_at.date() <= snap_date)
        remaining = remaining + new_tasks - completed
        total_at_point = total_created_before_start + sum(1 for t in tasks if t.created_at and t.created_at.date() <= snap_date)
        ideal_remaining = max(0, total_at_point - round(total_at_point * (w / 8)))
        burndown.append({"date": snap_date.isoformat(), "remaining": max(remaining, 0), "ideal": ideal_remaining})

    # Hours estimated vs actual by project
    hours_by_project = defaultdict(lambda: {"estimated": 0, "actual": 0, "name": ""})
    for t in tasks:
        p = db.query(PMSProject).filter_by(id=t.project_id).first()
        hours_by_project[t.project_id]["estimated"] += t.estimated_hours or 0
        hours_by_project[t.project_id]["actual"] += t.actual_hours or 0
        hours_by_project[t.project_id]["name"] = p.name if p else f"Project {t.project_id}"
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

    # Per-member workload + completion + efficiency
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

    member_workload = []
    member_completion = []
    member_efficiency = []
    for uid, s in member_stats.items():
        member_workload.append({"name": s["name"], "total": s["assigned"], **dict(s["by_priority"])})
        member_completion.append({"name": s["name"], "assigned": s["assigned"], "completed": s["completed"]})
        avg_eff = round(sum(s["efficiencies"]) / len(s["efficiencies"]), 1) if s["efficiencies"] else None
        member_efficiency.append({"name": s["name"], "efficiency": avg_eff})

    # Overall project efficiency
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
```

**Step 3: Verify** — Swagger: `GET /api/pms/reports`, `GET /api/pms/reports?project_id=1`

**Step 4: Commit** — `git commit -m "feat(pms): add reports analytics endpoint with burndown, velocity, efficiency"`

---

### Task 6.2: Reports frontend page

**Files:**
- Modify: `frontend/lib/api.ts` (add reports method)
- Create: `frontend/app/admin/pms/reports/page.tsx`

**Step 1: Add to `pmsApi`**

```typescript
  // Reports
  getReports: (params?: any) => api.get('/api/pms/reports', { params }),
```

**Step 2: Create `frontend/app/admin/pms/reports/page.tsx`**

Full page with:
- Header: "Reports & Analytics"
- Top bar: Project selector (dropdown from `listProjects()`, with "All Projects" option) + date range picker (start/end date inputs)
- 2-column grid of charts:

| Chart | Recharts Component | Data Key |
|-------|-------------------|----------|
| Burndown | `<LineChart>` with two `<Line>`s (remaining + ideal) | `burndown` |
| Velocity | `<BarChart>` | `velocity` |
| Stage Cycle Time | `<BarChart layout="vertical">` | `avg_stage_times` |
| Priority Distribution | `<PieChart>` with `<Pie>` | `priority_distribution` |
| Milestone Progress | Custom progress bars (no Recharts needed, use TailwindCSS) | `milestone_progress` |
| Hours: Est vs Actual | `<BarChart>` with two `<Bar>`s grouped | `hours_comparison` |
| Per-Member Workload | `<BarChart layout="vertical">` stacked by priority | `member_workload` |
| Per-Member Completion | `<BarChart>` with assigned vs completed | `member_completion` |
| Per-Member Efficiency | `<BarChart>` | `member_efficiency` |
| Project Efficiency | Large centered number + gauge (custom CSS) | `project_efficiency` |

Each chart wrapped in a white card with title, border, rounded corners.

Recharts imports needed:
```typescript
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
```

**Step 3: Verify** — Navigate to `/admin/pms/reports`, verify all charts render with data. Test project filter and date range.

**Step 4: Commit** — `git commit -m "feat(pms): add Reports & Analytics page with Recharts"`

---

## Phase 7: Final Integration & Polish

### Task 7.1: Efficiency badges on existing views

**Files:**
- Modify: `backend/app/routes/pms.py` — add `efficiency` field to `_enrich_task()` return
- Modify: `frontend/components/pms/BoardView.tsx` — show efficiency badge on cards
- Modify: `frontend/components/pms/ListView.tsx` — show efficiency column
- Modify: `frontend/components/pms/GanttChart.tsx` — show efficiency in sidebar

**Step 1: Update `_enrich_task` in backend**

Add efficiency calculation:
```python
d["efficiency"] = _task_efficiency(task)
```

**Step 2: Add efficiency badge component** (can be inline)

```tsx
function EfficiencyBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const color = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${color}`}>{value}%</span>;
}
```

Add this to Board cards, List rows, and Gantt sidebar.

**Step 3: Verify** — Check all 3 views show efficiency badges.

**Step 4: Commit** — `git commit -m "feat(pms): add efficiency badges to Board, List, and Gantt views"`

---

### Task 7.2: Ensure `email_service.send_system_email` exists

**Files:**
- Check: `backend/app/services/email_service.py`

**Step 1: Verify `send_system_email` method exists**

Check if `email_service` has a method to send system emails (not user-account-based). If it doesn't exist, add a simple SMTP-based method using the system's default SMTP config (from settings or env vars).

If it exists, no changes needed.

**Step 2: If needed, add the method**

```python
def send_system_email(self, to_email: str, subject: str, html_body: str):
    """Send email using system SMTP config (not user email accounts)."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    smtp_host = settings.SMTP_HOST or "localhost"
    smtp_port = settings.SMTP_PORT or 587
    smtp_user = settings.SMTP_USER or ""
    smtp_pass = settings.SMTP_PASS or ""
    from_email = settings.SMTP_FROM or smtp_user

    msg = MIMEMultipart("alternative")
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        if smtp_user:
            server.login(smtp_user, smtp_pass)
        server.send_message(msg)
```

**Step 3: Commit** (if changes made) — `git commit -m "feat(email): add send_system_email method for system notifications"`

---

### Task 7.3: Final verification

**Step 1:** Start backend and frontend (`./start.sh`)

**Step 2:** Walk through each feature:
1. `/admin/pms` — Dashboard loads with 6 metric cards, My Tasks widget, project cards with progress/efficiency
2. `/admin/pms/my-tasks` — Table renders, filters work, efficiency badges show
3. `/admin/pms/labels` — Create/edit/delete labels, attach to tasks
4. Open a project → Board view: filter bar works, overdue badges show, label chips show, efficiency badges
5. Open a project → List view: same as above + sortable columns
6. `/admin/pms/reports` — All 10 charts render with data

**Step 3:** Check backend logs for scheduler registration (overdue check hourly, digest daily 8AM).

**Step 4: Final commit** — `git commit -m "feat(pms): complete PMS enhancements - dashboard, my-tasks, filters, labels, overdue alerts, reports"`
