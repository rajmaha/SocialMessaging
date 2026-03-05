# PMS PM/Admin Features Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 10 management-level features to the PMS for Project Managers and Admins, including team workload visibility, approval queues, escalation detection, capacity planning, and audit trails.

**Architecture:** 5 new pages + enhanced existing pages + 1 new model + 1 model change + role-gated navigation. All data comes from existing PMS tables with new aggregation endpoints.

---

## Decisions

- **Workload scope:** Role-scoped (PMs see their projects' members; Admins see everyone)
- **Approval queue:** Shows both pm_review and client_review stages
- **Escalation triggers:** Auto-escalate only (overdue 3+ days, hours > 150% estimated, stuck 7+ days)
- **Navigation:** Extend existing PMS sidebar with role-gated items
- **Capacity:** Configurable hours_per_day per member per project (default 7.0)
- **Audit trail:** Workflow + assignment changes (stage transitions, reassignments, member add/remove, milestone changes)

---

## Feature 1: Team Workload View

**Page:** `/admin/pms/team-workload`
**Access:** PM (their projects), Admin (all)
**Endpoint:** `GET /api/pms/team-workload?project_id=`

**UI:**
- Project filter dropdown (role-scoped)
- Member cards grid, each showing:
  - Name, avatar, role
  - Active task count, hours (actual/estimated), efficiency badge
  - Stage breakdown (mini horizontal bar)
  - Overdue count (red badge)
- Click member to expand task list
- Sortable by: name, task count, hours, efficiency, overdue count

---

## Feature 2: Approval Queue

**Page:** `/admin/pms/approval-queue`
**Access:** PM, Admin
**Endpoint:** `GET /api/pms/approval-queue`

**UI:**
- Two tabs: "Awaiting My Review" (pm_review) and "Client Review" (client_review)
- Task cards: title, project, assignee, priority, due date, time-in-stage
- Quick actions: Approve (next stage) / Reject (back to development) with optional note
- Sorted: overdue first, then oldest-in-stage
- Badge count on nav item

---

## Feature 3: Escalation Queue

**Page:** `/admin/pms/escalations`
**Access:** Admin only
**Endpoint:** `GET /api/pms/escalations`

**Auto-escalation rules:**
1. Overdue 3+ days
2. Actual hours > 150% estimated
3. Stuck in same stage 7+ days (development/qa only)

**UI:**
- Three severity sections: Critical (3 triggers), High (2), Medium (1)
- Each task: title, project, assignee, triggered rules as red badges
- Quick actions: reassign, change priority, add comment
- Summary bar at top

---

## Feature 4: Capacity Planning

**Page:** `/admin/pms/capacity`
**Access:** PM (their projects), Admin (all)
**Endpoint:** `GET /api/pms/capacity?project_id=&range=this_week`

**Model change:** Add `hours_per_day` (float, default 7.0) to `PMSProjectMember`

**UI:**
- Time range selector: this week / next 2 weeks / this month / next month
- Project filter (role-scoped)
- Member table: name, role, hours_per_day (editable), total capacity, committed hours, available hours, utilization bar
  - Green: < 80%, Amber: 80-100%, Red: > 100%
- Summary row: team totals

---

## Feature 5: Audit Trail

**Page:** `/admin/pms/audit-trail`
**Access:** Admin only
**Endpoint:** `GET /api/pms/audit-trail?project_id=&action_type=&actor_id=&from=&to=&page=1`

**New model:** `PMSAuditLog`
- Fields: id, project_id, task_id (nullable), action_type, actor_id, details (text/JSON), created_at
- Action types: stage_change, assignee_change, member_added, member_removed, milestone_change

**UI:**
- Timeline view, newest first
- Filters: project, action type, actor, date range
- Each entry: timestamp, actor, action description, project/task context
- Pagination: 50 per page

**Integration:** Auto-log entries when relevant actions occur in existing routes.

---

## Feature 6: Enhanced Admin Dashboard

**On existing `/admin/pms` page, admin-only additions:**

**Extra metric cards:**
- Team Health Score: (completion_rate * 0.4) + (on_time_rate * 0.3) + (avg_efficiency * 0.3)
- Escalations count (links to escalation queue)
- Pending Approvals count (links to approval queue)

**Cross-Project Summary Table** (below project grid):
- All projects: name, PM, task count, completion %, overdue count, efficiency, health score
- Sortable columns

---

## Feature 7: Team Performance Comparison (Reports page)

**On existing `/admin/pms/reports` page, admin-only charts:**
- Project Comparison Bar Chart: completion %, efficiency %, on-time rate per project
- Team Velocity Comparison: completed tasks/week per project (multi-series line)

---

## Feature 8: Cross-Project Timeline (Dashboard)

**PM-only widget on dashboard:**
- "My Deadlines" timeline: upcoming milestones and task due dates across all managed projects
- Next 30 days, chronological list

---

## Feature 9: Weekly Digest View (Dashboard)

**PM + Admin collapsible card on dashboard:**
- Tasks completed this week
- Tasks newly overdue this week
- New tasks created this week
- Stage transitions count this week

---

## Feature 10: Navigation Role-Gating

| Item | Everyone | PM | Admin |
|------|----------|-----|-------|
| Dashboard | yes | yes | yes |
| My Tasks | yes | yes | yes |
| Approval Queue | - | yes | yes |
| Team Workload | - | yes | yes |
| Capacity Planning | - | yes | yes |
| Escalations | - | - | yes |
| Audit Trail | - | - | yes |
| Reports | yes | yes | yes |
| Labels | yes | yes | yes |

**Role detection:** System admin via `user.role === "admin"`. PM detection via checking if user has `pm` role in any PMSProjectMember record (new endpoint or dashboard response includes `is_pm` flag).
