# PMS Enhancements Design

**Date:** 2026-03-05
**Status:** Approved

## Overview

Six enhancements to the existing PMS module to make project management more structured and actionable.

---

## 1. Dashboard with Metrics (replaces `/admin/pms`)

**Layout:** Top metrics bar → My Tasks widget → Projects grid

### Top Metrics Bar (6 cards)

| Card | What it shows |
|------|---------------|
| Total Tasks | Count with % completed |
| Overdue Tasks | Past due date, red highlight, clickable to filtered view |
| Urgent/Client Issues | Tasks in `client_review` stage OR priority `urgent` |
| Stale Tasks | Low/medium priority, created > N days ago, still in `development`/`qa`. Dropdown on card: 3d / 7d / 14d / 30d (default 7d) |
| Hours Utilization | Estimated vs actual hours across all projects |
| Active Projects | Count with mini sparkline of completion trend |

Urgent/Client Issues and Stale Tasks cards are clickable — navigate to filtered task views.

### My Tasks Widget

Compact table: 5 most urgent tasks for logged-in user across all projects.
Columns: task title, project name (color dot), priority dot, due date, stage badge.
"View all" link → `/admin/pms/my-tasks`.

### Projects Grid

Existing project cards enhanced with:
- Mini progress bar (completed / total tasks)
- Overdue count badge (red)
- Project efficiency % badge

### Backend

New endpoint: `GET /api/pms/dashboard`
- Returns aggregated stats for current user in a single response
- Accepts `stale_days` query param (default 7)

---

## 2. My Tasks (Cross-Project)

### Full Page: `/admin/pms/my-tasks`

**Filter bar:** Stage, Priority, Project, Due date range — dropdown selects in a single row.

**Table columns:**

| Column | Details |
|--------|---------|
| Task title | Clickable → opens task in its project |
| Project | Name with color dot |
| Priority | Color-coded badge |
| Stage | Badge |
| Due date | Red if overdue, amber if due within 2 days |
| Hours | Actual / Estimated |
| Efficiency | Green/amber/red badge |

**Sorting:** Click column headers. Default: overdue first, then due date ascending.

**Grouping toggle:** Flat list (default) or grouped by project.

**Header:** Shows "Your avg efficiency: X%" across all active assigned tasks.

### Backend

New endpoint: `GET /api/pms/my-tasks`
- Queries tasks where `assignee_id = current_user.id`
- Accepts query params: `stage`, `priority`, `project_id`, `due_from`, `due_to`

---

## 3. Filters & Sorting (List + Board Views)

### Filter Bar (added to both ListView and BoardView)

| Filter | Type | Notes |
|--------|------|-------|
| Assignee | Multi-select dropdown | Project members |
| Priority | Multi-select chips | Low, Medium, High, Urgent |
| Stage | Multi-select chips | Hidden on Board (columns are stages) |
| Milestone | Dropdown | Project milestones |
| Due date range | Date range picker | Start → End |
| Labels | Multi-select dropdown | From global label library |
| Created date | Date range picker | Start → End |
| Has attachments | Toggle | Yes/No |

### Sorting (List view only)

Click column headers to toggle: ascending → descending → none.
Sortable by: priority, due date, created date, hours.

### Active Filter Pills

Below filter bar — removable pills for each active filter. "Clear all" button.

### Backend

No new endpoints. Filtering is client-side (task counts per project are manageable).

---

## 4. Overdue Alerts + Visual Badges + Daily Digest + Email

### Visual Badges (frontend)

- Board task cards: Red border-left + "Overdue" chip
- List rows: Red text on due date + red dot indicator
- Dashboard: Overdue count card (red, clickable)
- Project cards: Red badge with overdue task count

### In-App Alerts (backend)

- New APScheduler job: `check_overdue_tasks` — runs every 1 hour
- Scans: `due_date < today`, stage not `completed`, no existing unread `overdue` alert for task+user
- Fires `PMSAlert` to: task assignee + PM-role members of the project
- New alert type: `overdue`

### Daily Digest Email (backend)

- New APScheduler job: `send_overdue_digest` — runs daily at 8:00 AM
- Groups overdue tasks by project
- One email per user (PM + Admin roles)
- Email table: task title, project, assignee, days overdue, priority
- Subject: `"PMS: {X} overdue tasks across {Y} projects"`
- Uses existing SMTP infrastructure
- New alert type: `overdue_digest`

---

## 5. Performance Efficiency Indicator

### Calculation

```
efficiency = (estimated_hours / (business_days_elapsed * 7)) * 100
```

- `business_days_elapsed` = weekdays between `start_date` and today (or completion date)
- Capped at 100%
- Tasks without `estimated_hours` or `start_date` excluded

### Color Coding

| Efficiency | Color | Meaning |
|-----------|-------|---------|
| >= 80% | Green | On track or ahead |
| 50-79% | Amber | Slower than expected |
| < 50% | Red | Significantly behind |

### Display Locations

- **Task level:** Efficiency badge on Board cards, List rows, Gantt sidebar
- **Member level:** Avg efficiency on My Tasks page header and dashboard widget
- **Project level:** Project efficiency % on dashboard project cards and Reports page

### Backend

Efficiency computed server-side in dashboard, my-tasks, and reports endpoints.

---

## 6. Labels UI (Global Label Library)

### Backend

**New model: `PMSLabelDefinition`**
- `id`, `name` (unique), `color`, `created_by`, `created_at`

**Modified model: `PMSTaskLabel`**
- Add `label_definition_id` FK to `PMSLabelDefinition`

**New endpoints:**
- `GET /api/pms/labels` — list all global labels
- `POST /api/pms/labels` — create (admin only)
- `PUT /api/pms/labels/{id}` — update (admin only)
- `DELETE /api/pms/labels/{id}` — delete (admin only, cascades)
- `POST /api/pms/tasks/{task_id}/labels/{label_id}` — attach label
- `DELETE /api/pms/tasks/{task_id}/labels/{label_id}` — remove label

### Frontend — Label Management (admin)

Settings area within PMS: list of labels with color dot + name + edit/delete. Inline create.

### Frontend — Task Labeling

- Board/List cards: colored label chips below title
- Gantt sidebar: label chips with "+" button
- "+" opens dropdown of global labels with checkboxes + search

---

## 7. Reports & Analytics

### New Page: `/admin/pms/reports`

**Top bar:** Project selector (All / specific) + Date range picker.

### Charts (2-column grid)

| Chart | Type | Shows |
|-------|------|-------|
| Burndown | Line | Remaining tasks over time vs ideal line |
| Velocity | Bar | Tasks completed per week (last 8 weeks) |
| Stage Cycle Time | Horizontal bar | Avg days per stage |
| Priority Distribution | Pie/donut | Tasks by priority |
| Milestone Progress | Progress bars | Completed / total per milestone |
| Hours: Est vs Actual | Grouped bar | Side-by-side per project or milestone |
| Per-Member Workload | Horizontal bar | Tasks per member, colored by priority |
| Per-Member Completion | Bar | Completed vs assigned per member |
| Per-Member Efficiency | Bar | Avg efficiency % per member |
| Project Efficiency | Gauge | Overall project efficiency % |

### Backend

New endpoint: `GET /api/pms/reports`
- Query params: `project_id` (optional), `start_date`, `end_date`
- Returns all aggregated data in one response
- SQL aggregations server-side

### Charting Library

Recharts (lightweight, composable, standard for Next.js).

---

## Technical Notes

- All new endpoints follow existing patterns: `Depends(get_db)`, `Depends(get_current_user)`, `require_page("pms")`
- New DB tables/columns via inline SQL in `main.py` (project convention — no Alembic)
- APScheduler jobs added in `main.py` alongside existing ones
- Performance indicator uses Python `numpy`-free business day calculation (weekday check loop)
- Stale threshold is a frontend-only concern (query param to dashboard endpoint)
