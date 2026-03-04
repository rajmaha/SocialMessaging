# PMS with Gantt Chart — Design Document
**Date:** 2026-03-04
**Status:** Approved

---

## Overview

A full Project Management System (PMS) module integrated into the existing SocialMedia Unified Inbox admin panel. Gives staff a single platform for managing projects, tasks, and workflows without switching between external tools.

**Core capabilities:**
- Projects → Milestones → Tasks → Subtasks hierarchy
- Role-based workflow state machine (Dev → QA → PM → Client loop)
- Interactive SVG Gantt chart with drag-to-reschedule, drag-to-resize, drag-to-create-dependencies, and critical path highlighting
- Project-level access control (non-members cannot see or interact with a project)
- Overdue and over-hours alerting via APScheduler + SSE
- Deep integration with Tickets and CRM modules

---

## Data Model

### `pms_projects`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| name | String | |
| description | Text | |
| status | String | planning \| active \| on_hold \| completed |
| start_date | Date | |
| end_date | Date | |
| color | String | hex color for UI |
| owner_id | FK → users | admin/PM who owns it |
| team_id | FK → teams | optional team assignment |
| created_at | DateTime | |
| updated_at | DateTime | |

### `pms_milestones`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| project_id | FK → pms_projects | |
| name | String | |
| due_date | Date | |
| status | String | pending \| reached \| missed |
| color | String | |

### `pms_tasks`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| project_id | FK → pms_projects | |
| milestone_id | FK → pms_milestones | nullable |
| parent_task_id | FK → pms_tasks | nullable — subtasks |
| title | String | |
| description | Text | |
| stage | String | development \| qa \| pm_review \| client_review \| approved \| completed |
| priority | String | low \| medium \| high \| urgent |
| assignee_id | FK → users | must be a ProjectMember |
| start_date | Date | |
| due_date | Date | |
| estimated_hours | Float | |
| actual_hours | Float | computed from time logs |
| position | Integer | ordering within list/board |
| ticket_id | FK → tickets | nullable — integration |
| crm_deal_id | Integer | nullable — CRM integration |
| created_at | DateTime | |
| updated_at | DateTime | |

### `pms_task_dependencies`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| task_id | FK → pms_tasks | dependent task |
| depends_on_id | FK → pms_tasks | prerequisite task |
| type | String | finish_to_start \| start_to_start \| finish_to_finish |

### `pms_task_comments`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| task_id | FK → pms_tasks | |
| user_id | FK → users | |
| content | Text | |
| created_at | DateTime | |

### `pms_task_timelogs`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| task_id | FK → pms_tasks | |
| user_id | FK → users | |
| hours | Float | |
| date | Date | |
| note | String | nullable |

### `pms_task_attachments`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| task_id | FK → pms_tasks | |
| file_path | String | |
| file_name | String | |
| file_size | Integer | bytes |
| uploaded_by | FK → users | |
| created_at | DateTime | |

### `pms_task_labels`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| task_id | FK → pms_tasks | |
| name | String | |
| color | String | hex |

### `pms_workflow_history`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| task_id | FK → pms_tasks | |
| from_stage | String | |
| to_stage | String | |
| moved_by | FK → users | |
| note | Text | reason / comment |
| created_at | DateTime | |

### `pms_project_members`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| project_id | FK → pms_projects | |
| user_id | FK → users | |
| role | String | developer \| qa \| pm \| client \| viewer |
| added_by | FK → users | |
| added_at | DateTime | |

### `pms_alerts`
| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| task_id | FK → pms_tasks | |
| project_id | FK → pms_projects | |
| type | String | overdue \| over_hours \| stage_transition \| assigned |
| message | Text | |
| is_read | Boolean | default false |
| notified_user_id | FK → users | |
| created_at | DateTime | |

---

## Workflow State Machine

```
development → qa
qa → pm_review          (QA passes)
qa → development        (QA finds issues)
pm_review → client_review
pm_review → development (PM finds issues)
client_review → approved
client_review → development  (Client finds issues)
approved → completed
```

**Role-based transition permissions:**

| From | To | Allowed Role |
|---|---|---|
| development | qa | developer |
| qa | pm_review | qa |
| qa | development | qa |
| pm_review | client_review | pm, admin |
| pm_review | development | pm, admin |
| client_review | approved | pm, admin, client |
| client_review | development | pm, admin, client |
| approved | completed | pm, admin |

Every transition is recorded in `pms_workflow_history` with the user and an optional note.

---

## Project-Level Access Control

- `pms_project_members` defines who can access each project
- Non-members: project is invisible in the list and all API routes return 403
- Admins bypass membership checks (see all projects)
- Task assignee must be an existing ProjectMember
- Stage transitions respect the member's role (a `developer` member cannot trigger QA → PM)
- Only admin or a `pm` member can add/remove project members

---

## Backend API Routes

All routes prefixed `/pms/`

```
# Projects
GET    /pms/projects                         list (filtered by membership)
POST   /pms/projects                         create (admin only)
GET    /pms/projects/{id}                    detail
PUT    /pms/projects/{id}                    update
DELETE /pms/projects/{id}                    delete (admin only)

# Members
GET    /pms/projects/{id}/members            list members
POST   /pms/projects/{id}/members            add member
DELETE /pms/projects/{id}/members/{user_id}  remove member

# Milestones
GET    /pms/projects/{id}/milestones         list
POST   /pms/projects/{id}/milestones         create
PUT    /pms/milestones/{id}                  update
DELETE /pms/milestones/{id}                  delete

# Tasks
GET    /pms/projects/{id}/tasks              list (flat + tree)
POST   /pms/projects/{id}/tasks              create
GET    /pms/tasks/{id}                       detail
PUT    /pms/tasks/{id}                       update
DELETE /pms/tasks/{id}                       delete
POST   /pms/tasks/{id}/transition            workflow stage transition
GET    /pms/tasks/{id}/history               workflow audit trail

# Dependencies
POST   /pms/tasks/{id}/dependencies          add dependency
DELETE /pms/tasks/{id}/dependencies/{dep_id} remove dependency

# Comments
GET    /pms/tasks/{id}/comments              list
POST   /pms/tasks/{id}/comments              create
DELETE /pms/comments/{id}                    delete

# Time Logs
GET    /pms/tasks/{id}/timelogs              list
POST   /pms/tasks/{id}/timelogs              log time (triggers over-hours check)
DELETE /pms/timelogs/{id}                    delete

# Attachments
POST   /pms/tasks/{id}/attachments           upload
DELETE /pms/attachments/{id}                 delete

# Alerts
GET    /pms/alerts                           list unread alerts for current user
POST   /pms/alerts/{id}/read                 mark as read

# Integration
POST   /pms/tasks/from-ticket/{ticket_id}    create task from ticket
POST   /pms/projects/from-crm/{deal_id}      create project linked to CRM deal

# Gantt data
GET    /pms/projects/{id}/gantt              full gantt payload (tasks + deps + milestones)
```

---

## Frontend Pages & Components

```
/admin/pms                        Project list grid
/admin/pms/new                    Create project form
/admin/pms/[id]                   Project detail — tabbed:
  ├── Gantt                       SVG interactive Gantt
  ├── Board                       Kanban by workflow stage
  ├── List                        Flat filterable task list
  ├── Milestones                  Milestone timeline
  ├── Files                       All task attachments
  ├── Time Tracking               Hours per task/member
  └── Settings                    Members, project config
```

### Gantt Chart (SVG)

- **Left panel:** collapsible task tree (project → milestones → tasks → subtasks)
- **Right panel:** SVG canvas with time axis
- **Zoom levels:** day / week / month / quarter (toggle buttons)
- **Today line:** vertical blue dashed line
- **Milestone diamonds:** on the time axis
- **Task bars:**
  - Drag horizontally to reschedule (updates start_date + due_date)
  - Drag right edge to resize duration
  - Click to open task detail drawer
- **Dependency arrows:** SVG bezier curves with arrowheads
- **Drag to create dependency:** drag from task bar edge → drop on another task bar
- **Critical path:** longest chain of dependent tasks highlighted in red/orange
- **Stage color coding:** bar color reflects current workflow stage

### Task Detail Drawer

- Workflow stage progress bar with transition buttons (role-aware — only shows valid next stages for current user)
- Assignee, priority, dates, estimated hours
- Subtasks list (inline create)
- Dependencies list
- Time log entries + "Log Time" button (shows over-hours warning if exceeded)
- Attachments
- Comments thread
- Workflow history (full audit trail)

---

## Alerting & Notifications

### Triggers

| Event | When | Notifies |
|---|---|---|
| Task overdue | APScheduler every 15min: `due_date < now()` and stage ≠ approved/completed | assignee + project PM |
| Over hours | On every time log save: `sum(actual_hours) > estimated_hours` | assignee + project PM |
| Stage transition | On every workflow transition | new stage assignee |
| Task assigned | On task create/update assignee | new assignee |

### Delivery

1. `pms_alerts` record created (persistent, unread badge in UI)
2. SSE event pushed to relevant users (real-time bell notification)
3. Optional: daily email digest for overdue tasks

### APScheduler Job

New job added to `main.py`:
```python
scheduler.add_job(check_pms_overdue_tasks, 'interval', minutes=15, id='pms_overdue_check')
```

---

## Integration Points

| Module | Integration |
|---|---|
| Tickets | "Create PMS Task" button on ticket detail; task stores `ticket_id` |
| CRM | "Link to Project" on deal/contact; project stores `crm_deal_id` |
| SSE events | All alerts pushed to existing `events-context.tsx` stream |
| Teams | Project can be assigned to an existing Team |
| Users | Assignees, members, workflow actors all reference existing `users` table |

---

## Access Control Summary

| Role | Can Do |
|---|---|
| Admin | Everything — all projects, all actions, add/remove members |
| PM (project member) | Manage tasks, transitions, add members within their projects |
| Developer (project member) | Work on tasks, log time, submit to QA |
| QA (project member) | Pass/fail tasks back to dev or forward to PM |
| Client (project member) | Approve or reject at client_review stage |
| Viewer (project member) | Read-only access to project |
| Non-member | Project is invisible — 403 on all routes |

---

## Implementation Approach

- **Backend:** Custom SVG Gantt — no commercial library
- **Gantt rendering:** SVG with `react-dnd` for all drag interactions
- **DB migrations:** Inline SQL in `main.py` using `text()` + `IF NOT EXISTS` (existing pattern)
- **No Alembic**
- **File storage:** Task attachments in `backend/app/attachment_storage/pms/`
