# Daily Ops Module — Design Spec

**Date:** 2026-03-26
**Status:** Approved

## Overview

A unified Daily Ops page (`/daily-ops`) with three tabs: personal daily planner, async team standups, and a real-time command center dashboard. Designed for teams that handle customer support, sales, and internal operations daily.

## Goals

- Give agents one page to start their day — see what's assigned, post standup updates, and monitor live KPIs.
- Improve team visibility with async standups (yesterday/today/blockers).
- Provide admins a real-time command center with configurable metric cards.
- Role-based access: admins configure and see everything; agents see the command center read-only and team standups, plus their own planner.

## Data Models

### StandupEntry

| Field | Type | Purpose |
|---|---|---|
| id | Integer, PK | |
| user_id | FK → User | Agent who posted |
| date | Date | The standup date |
| yesterday | Text | What was done yesterday |
| today | Text | Plan for today |
| blockers | Text (nullable) | Any blockers |
| created_at | DateTime | When posted |
| updated_at | DateTime | Last edit |

One entry per agent per day. Unique constraint on `(user_id, date)`.

### DailyPlannerItem

| Field | Type | Purpose |
|---|---|---|
| id | Integer, PK | |
| user_id | FK → User | Agent who owns it |
| date | Date | The day it belongs to |
| title | String | Goal/note description |
| is_completed | Boolean | Checked off or not |
| sort_order | Integer | Drag-to-reorder |
| created_at | DateTime | |
| updated_at | DateTime | Last edit |

Manual personal goals/notes only. Auto-pulled items (tickets, conversations, CRM tasks, PMS tasks, emails) are queried live from existing tables, not stored here.

### CommandCenterConfig

| Field | Type | Purpose |
|---|---|---|
| id | Integer, PK | |
| metric_key | String | e.g. `open_conversations`, `pending_tickets` |
| label | String | Display name |
| is_visible | Boolean | Admin toggle |
| sort_order | Integer | Display order |
| threshold_value | Integer (nullable) | Alert threshold — card highlights red when metric exceeds this value |
| created_by | FK → User | Admin who configured it |

Admins control which metrics appear, their order, and alert thresholds.

## Pydantic Schemas

File: `backend/app/schemas/daily_ops.py`

### Standup Schemas

```python
class StandupCreate(BaseModel):
    yesterday: str
    today: str
    blockers: Optional[str] = None

class StandupResponse(BaseModel):
    id: int
    user_id: int
    user_name: str          # joined from User table
    user_avatar: Optional[str]
    date: date
    yesterday: str
    today: str
    blockers: Optional[str]
    created_at: datetime
    updated_at: datetime
```

### Planner Schemas

```python
class PlannerItemCreate(BaseModel):
    title: str
    date: date

class PlannerItemUpdate(BaseModel):
    title: Optional[str] = None
    is_completed: Optional[bool] = None
    sort_order: Optional[int] = None

class AssignedItem(BaseModel):
    id: int
    type: str               # "conversation" | "ticket" | "crm_task" | "pms_task" | "email"
    title: str
    priority: Optional[str]
    due_date: Optional[date]
    link: str               # frontend URL to navigate to

class PlannerResponse(BaseModel):
    manual_items: List[PlannerItemResponse]
    assigned_items: Dict[str, List[AssignedItem]]
    # keys: "conversations", "tickets", "crm_tasks", "pms_tasks", "emails"
```

### Command Center Schemas

```python
class MetricResponse(BaseModel):
    metric_key: str
    label: str
    value: int | float
    threshold_value: Optional[int]
    is_exceeded: bool       # True if value > threshold_value

class CommandCenterConfigUpdate(BaseModel):
    metrics: List[MetricConfigItem]

class MetricConfigItem(BaseModel):
    metric_key: str
    label: str
    is_visible: bool
    sort_order: int
    threshold_value: Optional[int] = None
```

## Backend API

### Files

- Route file: `backend/app/routes/daily_ops.py`
- Service file: `backend/app/services/daily_ops_service.py` — handles multi-table aggregation for planner assigned items and command center metric computations.
- Schema file: `backend/app/schemas/daily_ops.py`
- Model file: `backend/app/models/daily_ops.py`

### Standup Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/daily-ops/standups?date=YYYY-MM-DD` | All agents | Get all team standups for a date |
| POST | `/daily-ops/standups` | All agents | Create own standup for today |
| PATCH | `/daily-ops/standups/{id}` | Owner only | Update own standup entry |
| DELETE | `/daily-ops/standups/{id}` | Owner only | Delete own standup entry |

POST creates a new entry; returns 409 if one already exists for that user+date. PATCH updates an existing entry.

### Planner Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/daily-ops/planner?date=YYYY-MM-DD` | Own data | Get personal planner items + auto-pulled assigned items |
| POST | `/daily-ops/planner` | Own data | Add a manual goal/note |
| PATCH | `/daily-ops/planner/{id}` | Own data | Toggle completion / reorder / edit |
| DELETE | `/daily-ops/planner/{id}` | Own data | Remove a manual item |

The GET `/planner` response returns two sections:
- `manual_items` — from DailyPlannerItem table
- `assigned_items` — live queries from existing tables grouped by type:
  - Conversations: `assigned_to = current_user.id` AND status in (open, pending)
  - Tickets: `assigned_to = current_user.id` AND status is open
  - CRM Tasks: `assigned_to = current_user.id` AND due_date <= today
  - PMS Tasks: `assignee_id = current_user.id` AND due_date <= today (note: PMS uses `assignee_id`, not `assigned_to`)
  - Emails: unread emails for the current user's email account

### Command Center Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/daily-ops/command-center` | All (read-only for agents) | Live KPI metrics |
| PUT | `/daily-ops/command-center/config` | Admin only | Update visible metrics and order |
| GET | `/daily-ops/command-center/config` | Admin only | Get current config |

### Live KPI Metrics

| Metric Key | Source | Definition |
|---|---|---|
| `open_conversations` | Conversations table | Count where status = open |
| `unassigned_conversations` | Conversations table | Count where assigned_to IS NULL and status = open |
| `pending_tickets` | Tickets table | Count where status in (open, pending) |
| `overdue_crm_tasks` | CRM Tasks table | Count where due_date < today and status != completed |
| `deals_in_pipeline` | CRM Deals table | Count where stage NOT IN (won, lost) |
| `unread_emails` | Emails table | Count where is_read = false across all accounts |
| `active_agents` | SSE connection tracking | Count of distinct user IDs with active SSE connections in events_service.py. If not already tracked, add a `connected_users: Set[int]` to the events service. |
| `avg_response_time_today` | Messages table | Average time (in minutes) between the first customer message in a conversation and the first agent reply, for conversations that received their first agent reply today. |

## Permissions

Register in `backend/app/permissions_registry.py` under `MODULE_REGISTRY`:

```python
"daily_ops": {
    "label": "Daily Ops",
    "permissions": {
        "view_planner": "View personal daily planner",
        "view_standups": "View team standups",
        "view_command_center": "View command center dashboard",
        "manage_command_center": "Configure command center metrics (admin)",
    }
}
```

Route guards:
- Planner endpoints: `Depends(require_permission("daily_ops", "view_planner"))`
- Standup endpoints: `Depends(require_permission("daily_ops", "view_standups"))`
- Command center GET: `Depends(require_permission("daily_ops", "view_command_center"))`
- Command center PUT config: `Depends(require_permission("daily_ops", "manage_command_center"))`

## Frontend

### Page Structure

One new page at `frontend/app/daily-ops/page.tsx` with 3 tabs:

**Tab 1 — My Day (Personal Planner)**
- Manual goals/notes section with add, drag-to-reorder, checkbox toggle
- Auto-pulled assigned items grouped by type (conversations, tickets, emails, CRM tasks, PMS tasks)
- Each item clickable, navigates to its actual page
- Sections are collapsible with item count badges

**Tab 2 — Team Standups**
- Card per agent showing yesterday/today/blockers
- Date navigation (prev/next) to view past standups
- Shows who hasn't posted yet (gentle nudge)
- Post/edit standup form modal
- Agents can only edit their own entry
- SSE integration: listen for `standup_posted` events to update the board in real-time when teammates post

**Tab 3 — Command Center**
- Grid of KPI metric cards with icon, value, label
- Cards refresh every 30 seconds via polling
- Red highlight on cards where value exceeds configured threshold
- Admins see gear icon to configure visible cards, order, and thresholds
- Agents see read-only view

### New Components

| Component | Location | Purpose |
|---|---|---|
| DailyOpsPage.tsx | `frontend/app/daily-ops/page.tsx` | Main page with tab navigation |
| MyDayTab.tsx | `frontend/components/daily-ops/MyDayTab.tsx` | Personal planner with manual + assigned items |
| TeamStandupsTab.tsx | `frontend/components/daily-ops/TeamStandupsTab.tsx` | Standup board with cards |
| StandupForm.tsx | `frontend/components/daily-ops/StandupForm.tsx` | Post/edit standup modal |
| CommandCenterTab.tsx | `frontend/components/daily-ops/CommandCenterTab.tsx` | KPI metric cards grid |
| CommandCenterConfig.tsx | `frontend/components/daily-ops/CommandCenterConfig.tsx` | Admin config modal for metrics |
| MetricCard.tsx | `frontend/components/daily-ops/MetricCard.tsx` | Individual KPI card with icon, value, label |
| PlannerItemRow.tsx | `frontend/components/daily-ops/PlannerItemRow.tsx` | Draggable checkbox row for goals |

## Access Control

- **Admins:** Full access to all 3 tabs. Can configure command center metrics (visibility, order, thresholds). All permissions granted by default.
- **Agents:** Full access to My Day and Team Standups. Read-only access to Command Center. Cannot configure metrics. Permissions: `view_planner`, `view_standups`, `view_command_center`.

## SSE Events

Emit these events via `events_service.py` for real-time updates:

| Event | Trigger | Data |
|---|---|---|
| `standup_posted` | Agent creates/updates a standup | `{ user_id, user_name, date }` |
| `standup_deleted` | Agent deletes a standup | `{ standup_id, date }` |

Command center does NOT use SSE — 30-second polling is sufficient and simpler.

## Technical Notes

- Models created via `Base.metadata.create_all()` in main.py (follows existing pattern, no Alembic).
- Any new columns added via inline SQL migrations in main.py using `text()` + `IF NOT EXISTS`.
- Service layer (`daily_ops_service.py`) handles multi-table queries for planner and metric computations, keeping routes thin.
- Planner assigned items are queried live, not cached — ensures real-time accuracy.
- Router registered in main.py alongside existing routers.
- Unique constraint on StandupEntry `(user_id, date)` enforced at DB level.
- Pagination is not required for v1 endpoints because all responses are naturally bounded — standups are scoped per date (team size), planner items per user per day, and command center returns a small fixed set of metrics.
