# Worklog Module Design

## Overview

A daily worklog module where staff register work logs with time, summaries, attachments, and categories. Unifies time tracking from multiple sources into a single report.

## Time Sources

1. **Manual worklogs** — non-project agents enter time with two-level category, summary, and attachments
2. **PMS task timelogs** — project-assigned agents' task time (existing `pms_task_timelogs` table)
3. **Auto-tracked messaging** — time between opening a conversation and sending a reply
4. **Auto-tracked email** — time between opening an email and sending a reply
5. **Workspace calls** — duration pulled from existing call records API (`workspace.saraloms.com/admin/recordings`)

## Visibility & Approval

- Agents see only their own worklogs
- Admins see everyone's worklogs
- Manual worklog entries require admin approval: `pending` → `approved` / `rejected`
- Rejected entries return to agent with a comment for revision and resubmission
- Auto-tracked entries (messaging, email, calls) are system-generated and not subject to approval
- Late entry detection: flag when `created_at` date differs from `log_date`

## Data Model

### New Tables

#### `worklog_category_groups`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| name | String | e.g., "Development", "Support", "Meeting" |
| color | String | Hex color for report visuals |
| created_by | FK → users.id | |
| created_at | DateTime | |

#### `worklog_categories`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| group_id | FK → worklog_category_groups.id | |
| name | String | e.g., "Bug Fix", "Code Review" under "Development" |
| created_at | DateTime | |

#### `worklog_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| user_id | FK → users.id | |
| category_id | FK → worklog_categories.id | |
| log_date | Date | The date the work was performed |
| hours | Float | Duration (manual or timer) |
| summary | Text | Work description |
| status | String | pending / approved / rejected |
| reviewer_id | FK → users.id | Admin who approved/rejected |
| reviewed_at | DateTime | |
| rejection_note | Text | Reason for rejection |
| created_at | DateTime | For late-entry detection |
| updated_at | DateTime | |

#### `worklog_attachments`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| worklog_entry_id | FK → worklog_entries.id | |
| file_path | String | |
| file_name | String | |
| file_size | Integer | |
| uploaded_by | FK → users.id | |
| created_at | DateTime | |

#### `worklog_auto_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| user_id | FK → users.id | |
| source | String | "messaging" / "email" / "call" |
| reference_id | Integer | Conversation ID, email thread ID, or call record ID |
| log_date | Date | |
| hours | Float | Computed duration |
| start_time | DateTime | When agent opened the item |
| end_time | DateTime | When agent sent reply |
| created_at | DateTime | |

### Existing Tables Used

- `pms_task_timelogs` — task time for project-assigned agents
- `messages` / `emails` — for computing reply time deltas
- External: workspace call records API

## Frontend Pages

### Agent Pages

#### `/admin/worklog` — Daily Entry Page
- Timer (start/stop) or manual time input
- Two-level category selector (group → category)
- Summary text field
- File attachment upload
- Today's entries list with edit/delete (while pending)
- Status badges: pending, approved, rejected
- Rejection note visible on rejected entries
- Resubmit action on rejected entries

### Admin Pages

#### `/admin/worklog/approval` — Approval Queue
- Pending entries with: agent name, date, category, hours, summary, attachments
- Late entry flag (created_at date ≠ log_date)
- Approve / Reject (with comment) actions
- Attachments visible inline with category and agent

#### `/admin/worklog/reports` — Unified Time Report
- Period filters: daily / weekly / monthly / custom date range
- Group by: agent, category, source type, project
- Filter by: specific agent, team, category group, source type
- All sources combined in one table
- Totals per agent per day with breakdown by source
- Late entry indicator for manual entries
- Attachments visible alongside category and agent
- Export: CSV / PDF

#### `/admin/worklog/categories` — Category Management
- CRUD for groups and sub-categories
- Color coding per group

## Report Table Structure

| Agent | Date | Source | Category/Project | Task/Conversation | Hours | Summary | Attachments |
|---|---|---|---|---|---|---|---|
| Agent name | Date | Manual/PMS/Messaging/Email/Call | Group > Category or Project name | Task title or conversation ref | Duration | Text | File links |

## Auto-Tracking Logic

### Messaging (WhatsApp, FB, Viber, LinkedIn, Webchat)
- Agent opens/focuses conversation → record `start_time`
- Agent sends reply → record `end_time`, compute duration
- No reply sent → discard (no entry created)

### Email
- Agent opens email → record `start_time`
- Agent sends reply → record `end_time`, compute duration

### Workspace Calls
- Pull call duration from existing call records API
- Sync periodically or on-demand when viewing reports

### Rules
- Auto-tracked entries are read-only (agents cannot edit)
- Auto-tracked entries skip approval flow
- Source type clearly labeled in reports

## API Endpoints

### Worklog Entries
- `POST /worklog/entries` — create manual entry
- `GET /worklog/entries` — list own entries (with date filter)
- `PUT /worklog/entries/{id}` — update pending/rejected entry
- `DELETE /worklog/entries/{id}` — delete pending entry
- `POST /worklog/entries/{id}/resubmit` — resubmit rejected entry

### Timer
- `POST /worklog/timer/start` — start timer (store start_time)
- `POST /worklog/timer/stop` — stop timer, create entry with computed duration

### Attachments
- `POST /worklog/entries/{id}/attachments` — upload file
- `DELETE /worklog/attachments/{id}` — remove file

### Approval (admin)
- `GET /worklog/approval` — list pending entries (all users)
- `POST /worklog/entries/{id}/approve` — approve entry
- `POST /worklog/entries/{id}/reject` — reject with comment

### Categories (admin)
- CRUD: `/worklog/category-groups` and `/worklog/categories`

### Reports (admin)
- `GET /worklog/reports` — unified report with filters (period, group_by, agent, source)
- `GET /worklog/reports/export` — CSV/PDF export

### Auto-tracking
- `POST /worklog/auto/track-open` — record when agent opens a conversation/email
- `POST /worklog/auto/track-reply` — record when agent sends reply (computes duration)
- `GET /worklog/auto/sync-calls` — pull latest call records from workspace API
