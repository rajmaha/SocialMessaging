# CRM Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement three CRM enhancements: (1) CRM contact card in the chat window, (2) real-time CRM WebSocket notifications with AdminNav badge, and (3) auto lead scoring based on activity.

**Architecture:** Backend adds a `by-conversation` lookup endpoint, a `crm_scoring.py` service, three new `EventTypes` constants broadcast from CRM routes, and an APScheduler job for overdue task events. Frontend adds a contact card panel in `ChatWindow`, a badge counter in `AdminNav`, and dismissable toast notifications in `MainHeader`.

**Tech Stack:** FastAPI (Python), Next.js 14 App Router, TypeScript, TailwindCSS, APScheduler, WebSocket via `events_service`.

**Note:** No Alembic, no Jest. Backend unchanged tables. Verify manually via browser at http://localhost:3000 and Swagger at http://localhost:8000/docs.

---

### Task 1: Add `GET /crm/leads/by-conversation/{conversation_id}` endpoint

**Files:**
- Modify: `backend/app/routes/crm.py`

**Step 1: Add endpoint after the existing `create_lead_from_conversation` route (after line ~178)**

Find this comment block:
```python
# ========== DEAL ENDPOINTS ==========
```

Insert BEFORE it:

```python
@router.get("/leads/by-conversation/{conversation_id}", response_model=LeadDetailResponse)
def get_lead_by_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the CRM lead linked to a specific conversation (for ChatWindow contact card)."""
    lead = db.query(Lead).filter(Lead.conversation_id == conversation_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="No lead linked to this conversation")

    deals = db.query(Deal).filter(Deal.lead_id == lead.id).all()
    tasks = db.query(Task).filter(Task.lead_id == lead.id).all()
    activities = db.query(Activity).filter(Activity.lead_id == lead.id).order_by(desc(Activity.created_at)).limit(5).all()

    return LeadDetailResponse(
        **lead.__dict__,
        deals=deals,
        tasks=tasks,
        activities=activities,
    )
```

**Step 2: Verify**

Go to http://localhost:8000/docs → find `GET /crm/leads/by-conversation/{conversation_id}` → confirm it appears.

**Step 3: Commit**

```bash
git add backend/app/routes/crm.py
git commit -m "feat: add GET /crm/leads/by-conversation/{id} endpoint for chat contact card"
```

---

### Task 2: Create Lead Scoring Service

**Files:**
- Create: `backend/app/services/crm_scoring.py`
- Modify: `backend/app/routes/crm.py`

**Step 1: Create `backend/app/services/crm_scoring.py`**

```python
"""
Lead scoring service — auto-increment lead score based on CRM activity.
"""
from sqlalchemy.orm import Session
from app.models.crm import Lead

# Points awarded per action type
SCORE_MAP = {
    "note": 5,
    "message": 5,
    "email": 10,
    "task_created": 10,
    "call": 20,
    "meeting": 30,
    "deal_created": 25,
    "deal_won": 50,
    "deal_lost": -10,
}


def apply_score(lead_id: int, action: str, db: Session) -> int:
    """
    Add or subtract points from a lead's score based on the action performed.
    Score is clamped to a minimum of 0.
    Returns the new score.
    """
    delta = SCORE_MAP.get(action, 0)
    if delta == 0:
        return 0

    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        return 0

    new_score = max(0, lead.score + delta)
    lead.score = new_score
    db.commit()
    return new_score
```

**Step 2: Wire scoring into `create_activity` in `crm.py`**

Find the `create_activity` endpoint (around line 428). It currently ends with:
```python
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)
    return db_activity
```

Add the scoring import at the top of `crm.py` (after existing imports):
```python
from app.services.crm_scoring import apply_score
```

Then in `create_activity`, insert scoring call before the `return`:
```python
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)

    # Update lead score based on activity type
    apply_score(lead_id, activity.type.value if hasattr(activity.type, 'value') else str(activity.type), db)

    return db_activity
```

**Step 3: Wire scoring into `create_deal` in `crm.py`**

Find `create_deal`. It ends with:
```python
    db.add(activity)
    db.commit()

    return db_deal
```

Insert before `return db_deal`:
```python
    apply_score(lead.id, "deal_created", db)
```

**Step 4: Wire scoring into `update_deal` for won/lost in `crm.py`**

Find `update_deal`. The stage-change activity block looks like:
```python
    if "stage" in update_data and old_stage != deal.stage:
        activity = Activity(...)
        db.add(activity)
```

After `db.add(activity)` and inside that same `if` block, add:
```python
        if deal.stage == "won":
            apply_score(deal.lead_id, "deal_won", db)
        elif deal.stage == "lost":
            apply_score(deal.lead_id, "deal_lost", db)
```

**Step 5: Verify**

1. Restart backend
2. Log an activity on any lead via `POST /crm/activities/{lead_id}` in Swagger with type `call`
3. Fetch the lead via `GET /crm/leads/{id}` — score should have increased by 20

**Step 6: Commit**

```bash
git add backend/app/services/crm_scoring.py backend/app/routes/crm.py
git commit -m "feat: add lead scoring service — auto-score on activity, deal create/won/lost"
```

---

### Task 3: Add CRM Event Types and Broadcast from Routes

**Files:**
- Modify: `backend/app/services/events_service.py`
- Modify: `backend/app/routes/crm.py`

**Step 1: Add three new event type constants to `EventTypes` in `events_service.py`**

Find the `EventTypes` class (around line 110). After the last line (`REMINDER_DUE = "reminder_due"`), add:

```python
    # CRM events
    CRM_LEAD_ASSIGNED = "crm_lead_assigned"
    CRM_DEAL_STAGE_CHANGED = "crm_deal_stage_changed"
    CRM_TASK_OVERDUE = "crm_task_overdue"
```

**Step 2: Import events_service in `crm.py`**

Add to the imports section at the top of `crm.py`:
```python
from app.services.events_service import events_service, EventTypes
import asyncio
```

**Step 3: Broadcast `CRM_LEAD_ASSIGNED` from `update_lead`**

Find the `update_lead` function. After `db.commit()` and `db.refresh(lead)`, add:

```python
    # Broadcast assignment event if assigned_to changed
    if "assigned_to" in update_data and update_data["assigned_to"] is not None:
        event = EventTypes.create_event(
            EventTypes.CRM_LEAD_ASSIGNED,
            {
                "lead_id": lead.id,
                "lead_name": f"{lead.first_name} {lead.last_name or ''}".strip(),
                "assigned_to": lead.assigned_to,
            },
        )
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(events_service.broadcast_to_user(lead.assigned_to, event))
        except RuntimeError:
            pass
```

**Step 4: Broadcast `CRM_DEAL_STAGE_CHANGED` from `update_deal`**

Find `update_deal`. The stage-change block is:
```python
    if "stage" in update_data and old_stage != deal.stage:
        activity = Activity(...)
        db.add(activity)
```

After the activity is added (and inside the same `if`), append:
```python
        stage_event = EventTypes.create_event(
            EventTypes.CRM_DEAL_STAGE_CHANGED,
            {
                "deal_id": deal.id,
                "deal_name": deal.name,
                "old_stage": old_stage,
                "new_stage": deal.stage,
                "lead_id": deal.lead_id,
            },
        )
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(events_service.broadcast_to_all(stage_event))
        except RuntimeError:
            pass
```

**Step 5: Verify**

1. Restart backend
2. Update a deal's stage via Swagger `PATCH /crm/deals/{id}` with `{"stage": "won"}`
3. Check backend logs — no errors is enough (WebSocket broadcast only fires if clients are connected)

**Step 6: Commit**

```bash
git add backend/app/services/events_service.py backend/app/routes/crm.py
git commit -m "feat: add CRM WebSocket event types and broadcast on lead assignment and deal stage change"
```

---

### Task 4: Add `CRM_TASK_OVERDUE` Background Job

**Files:**
- Modify: `backend/main.py`

**Step 1: Add the job function**

In `main.py`, find the `check_overdue_reminders` function definition (around line 1045). AFTER that entire function block (before `scheduler.add_job(check_overdue_reminders, ...)`), insert a new function:

```python
        def check_overdue_crm_tasks():
            """Broadcast CRM_TASK_OVERDUE for any open/in_progress tasks past their due date."""
            from app.models.crm import Task as CrmTask
            from app.services.events_service import events_service, EventTypes
            from datetime import datetime, timezone
            import asyncio

            db = SessionLocal()
            try:
                now = datetime.utcnow()
                overdue = db.query(CrmTask).filter(
                    CrmTask.due_date < now,
                    CrmTask.status.in_(["open", "in_progress"]),
                ).all()

                for task in overdue:
                    event = EventTypes.create_event(
                        EventTypes.CRM_TASK_OVERDUE,
                        {
                            "task_id": task.id,
                            "task_title": task.title,
                            "lead_id": task.lead_id,
                            "due_date": task.due_date.isoformat() if task.due_date else None,
                        },
                    )
                    if task.assigned_to:
                        try:
                            loop = asyncio.get_event_loop()
                            if loop.is_running():
                                asyncio.run_coroutine_threadsafe(
                                    events_service.broadcast_to_user(task.assigned_to, event),
                                    loop,
                                )
                        except Exception as e:
                            logger.warning(f"CRM task overdue broadcast error: {e}")
            except Exception as e:
                logger.error(f"check_overdue_crm_tasks error: {e}")
            finally:
                db.close()
```

**Step 2: Register the scheduler job**

After the line:
```python
        scheduler.add_job(check_overdue_reminders, 'interval', minutes=1, id='check_overdue_reminders')
```

Add:
```python
        scheduler.add_job(check_overdue_crm_tasks, 'interval', minutes=5, id='check_overdue_crm_tasks')
```

**Step 3: Verify**

Restart backend. Check logs on startup — should see `✅ Email auto-sync scheduler started` with no errors. No crash = success.

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: add CRM_TASK_OVERDUE APScheduler background job (5 min interval)"
```

---

### Task 5: CRM Contact Card Panel in `ChatWindow`

**Files:**
- Modify: `frontend/components/ChatWindow.tsx`

**Step 1: Add state for the CRM lead card**

In `ChatWindow`, after the `leadCreated` state (around line 89), add:

```tsx
const [crmLead, setCrmLead] = useState<any>(null)
const [crmCardOpen, setCrmCardOpen] = useState(false)
```

**Step 2: Add `fetchCrmLead` effect**

After the existing `useEffect` blocks (but still inside the component), add:

```tsx
// Fetch linked CRM lead whenever conversation changes
useEffect(() => {
  if (!conversation?.id) { setCrmLead(null); return }
  const token = getAuthToken()
  fetch(`${API_URL}/crm/leads/by-conversation/${conversation.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(res => res.ok ? res.json() : null)
    .then(data => setCrmLead(data))
    .catch(() => setCrmLead(null))
}, [conversation?.id])
```

**Step 3: Add the CRM contact card banner**

In the JSX, find the closing `</div>` of the `{/* Chat Header */}` block:
```tsx
      </div>

      {/* Search bar */}
```

Between those two elements, insert:

```tsx
      {/* CRM Contact Card — shown when this conversation is linked to a lead */}
      {crmLead && (
        <div className="border-b bg-purple-50 px-6 py-2 flex items-center justify-between gap-3">
          <button
            onClick={() => setCrmCardOpen(o => !o)}
            className="flex items-center gap-2 text-sm font-medium text-purple-800 hover:text-purple-900"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>{crmLead.first_name} {crmLead.last_name || ''}</span>
            {crmLead.company && <span className="text-purple-500 font-normal">· {crmLead.company}</span>}
            <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              crmLead.status === 'new' ? 'bg-blue-100 text-blue-700' :
              crmLead.status === 'contacted' ? 'bg-yellow-100 text-yellow-700' :
              crmLead.status === 'qualified' ? 'bg-green-100 text-green-700' :
              crmLead.status === 'converted' ? 'bg-purple-100 text-purple-700' :
              'bg-red-100 text-red-700'
            }`}>{crmLead.status}</span>
            <span className="text-xs text-purple-400">Score: {crmLead.score}</span>
            <svg className={`w-3 h-3 ml-1 transition-transform ${crmCardOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <a
            href={`/admin/crm/leads/${crmLead.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap"
          >
            View Lead →
          </a>
        </div>
      )}

      {/* CRM expanded card */}
      {crmLead && crmCardOpen && (
        <div className="border-b bg-white px-6 py-3 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Contact</p>
            {crmLead.email && <p className="text-gray-700">📧 {crmLead.email}</p>}
            {crmLead.phone && <p className="text-gray-700">📞 {crmLead.phone}</p>}
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Active Deals</p>
            {crmLead.deals && crmLead.deals.length > 0 ? (
              crmLead.deals.slice(0, 2).map((d: any) => (
                <p key={d.id} className="text-gray-700 truncate">
                  {d.name} <span className="text-xs text-gray-400">({d.stage})</span>
                </p>
              ))
            ) : (
              <p className="text-gray-400 text-xs">No deals</p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Open Tasks</p>
            {crmLead.tasks && crmLead.tasks.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled').length > 0 ? (
              crmLead.tasks.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled').slice(0, 2).map((t: any) => (
                <p key={t.id} className="text-gray-700 truncate text-xs">{t.title}</p>
              ))
            ) : (
              <p className="text-gray-400 text-xs">No open tasks</p>
            )}
          </div>
        </div>
      )}
```

**Step 4: Verify in browser**

1. Open a conversation that was previously converted to a lead using the "Convert to Lead" button
2. The purple CRM banner should appear below the header
3. Click the banner to expand — shows email, deals, tasks
4. Click "View Lead →" — opens lead detail in new tab

**Step 5: Commit**

```bash
git add frontend/components/ChatWindow.tsx
git commit -m "feat: add CRM contact card panel in ChatWindow for linked leads"
```

---

### Task 6: AdminNav CRM Badge Counter

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Add imports**

At the top of `AdminNav.tsx`, after existing imports, add:

```tsx
import { useEvents } from '@/lib/events-context'
```

**Step 2: Add badge state in `AdminNavInner`**

Inside `AdminNavInner`, after the existing state declarations, add:

```tsx
const { subscribe } = useEvents()
const [crmBadge, setCrmBadge] = useState(0)
```

**Step 3: Subscribe to CRM events + auto-clear on CRM page visit**

Inside `AdminNavInner`, after the existing `useEffect`, add:

```tsx
// Increment badge on any CRM event
useEffect(() => {
  const unsub1 = subscribe('crm_lead_assigned', () => setCrmBadge(n => n + 1))
  const unsub2 = subscribe('crm_deal_stage_changed', () => setCrmBadge(n => n + 1))
  const unsub3 = subscribe('crm_task_overdue', () => setCrmBadge(n => n + 1))
  return () => { unsub1(); unsub2(); unsub3() }
}, [subscribe])

// Clear badge when user is on a CRM page
useEffect(() => {
  if (pathname.startsWith('/admin/crm')) {
    setCrmBadge(0)
  }
}, [pathname])
```

**Step 4: Show badge on CRM nav items**

Find the JSX that renders each nav item link (the `<Link>` inside `visibleItems.map`). Currently it renders:

```tsx
<span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
<span className="truncate">{item.label}</span>
{active && (
    <span className="ml-auto w-2 h-2 rounded-full bg-indigo-300 flex-shrink-0" />
)}
```

Replace with:

```tsx
<span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
<span className="truncate">{item.label}</span>
{crmBadge > 0 && item.href.startsWith('/admin/crm') && (
    <span className="ml-auto bg-red-500 text-white text-xs rounded-full h-5 min-w-[20px] flex items-center justify-center px-1 flex-shrink-0">
        {crmBadge > 99 ? '99+' : crmBadge}
    </span>
)}
{active && crmBadge === 0 && (
    <span className="ml-auto w-2 h-2 rounded-full bg-indigo-300 flex-shrink-0" />
)}
```

**Step 5: Verify in browser**

1. Open browser dev tools → Application → Local Storage — ensure user is logged in
2. Navigate to dashboard (non-CRM page)
3. Trigger a deal stage change via Swagger — badge should appear on all CRM nav items
4. Navigate to `/admin/crm/leads` — badge clears to 0

**Step 6: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: add CRM badge counter on AdminNav sidebar items"
```

---

### Task 7: CRM Notification Toasts in MainHeader

**Files:**
- Modify: `frontend/components/MainHeader.tsx`

**Step 1: Add toast state in `MainHeaderInner`**

After existing state declarations (e.g. after `todosSidebarOpen`), add:

```tsx
const [crmToasts, setCrmToasts] = useState<Array<{id: number; message: string; link: string}>>([])
```

**Step 2: Subscribe to CRM events and show toasts**

After the existing `useEffect(() => setIsMounted(true), [])`, add:

```tsx
// CRM real-time notification toasts
useEffect(() => {
  const addToast = (message: string, link: string) => {
    const id = Date.now()
    setCrmToasts(prev => [...prev, { id, message, link }])
    setTimeout(() => {
      setCrmToasts(prev => prev.filter(t => t.id !== id))
    }, 6000)
  }

  const unsub1 = subscribe('crm_lead_assigned', (data: any) => {
    addToast(
      `🎯 Lead assigned to you: ${data?.lead_name || 'Unknown'}`,
      `/admin/crm/leads/${data?.lead_id || ''}`
    )
  })
  const unsub2 = subscribe('crm_deal_stage_changed', (data: any) => {
    addToast(
      `💼 Deal "${data?.deal_name || ''}" → ${data?.new_stage || ''}`,
      `/admin/crm/deals/${data?.deal_id || ''}`
    )
  })
  const unsub3 = subscribe('crm_task_overdue', (data: any) => {
    addToast(
      `⚠️ Overdue task: ${data?.task_title || 'Unknown'}`,
      `/admin/crm/tasks`
    )
  })

  return () => { unsub1(); unsub2(); unsub3() }
}, [subscribe])
```

**Step 3: Render toasts in JSX**

Find the closing `</header>` tag in the returned JSX. Just before it, add:

```tsx
{/* CRM notification toasts */}
{crmToasts.length > 0 && (
  <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
    {crmToasts.map(toast => (
      <a
        key={toast.id}
        href={toast.link}
        className="pointer-events-auto flex items-center gap-3 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-xl hover:bg-gray-800 transition max-w-sm animate-fade-in"
      >
        <span className="flex-1">{toast.message}</span>
        <span className="text-gray-400 text-xs whitespace-nowrap">View →</span>
      </a>
    ))}
  </div>
)}
```

**Step 4: Add fade-in animation to `tailwind.config.js` (if not already present)**

Check `frontend/tailwind.config.js` or `frontend/tailwind.config.ts`. In the `extend` section, add:

```js
keyframes: {
  'fade-in': {
    '0%': { opacity: '0', transform: 'translateY(8px)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
},
animation: {
  'fade-in': 'fade-in 0.2s ease-out',
},
```

If the tailwind config already has `keyframes`/`animation` entries, merge into the existing objects.

**Step 5: Verify in browser**

1. Open any page in the app
2. In Swagger, `PATCH /crm/deals/{id}` and change the stage
3. A dark toast notification should pop up in the bottom-right with "💼 Deal '...' → [new stage]" and auto-dismiss after 6 seconds

**Step 6: Commit**

```bash
git add frontend/components/MainHeader.tsx frontend/tailwind.config.js
git commit -m "feat: add CRM real-time notification toasts in header"
```
