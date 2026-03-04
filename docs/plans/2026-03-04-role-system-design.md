# Role-Based Access Control (RBAC) Redesign — Design Document
**Date:** 2026-03-04
**Status:** Approved

---

## Overview

Replace the current two-value role system (`admin` / `user`) with a structured RBAC system that:

1. Controls **which pages** a user can access (global role)
2. Keeps **PMS project roles** (developer / qa / pm / client / viewer) separate — they control workflow transitions inside a project, not page access
3. Supports **fixed system roles** (cannot be edited or deleted) and **custom roles** (fully admin-manageable)

---

## Fixed System Roles

These roles are seeded at startup with `is_system = true` and cannot be renamed, edited, or deleted.

| Role | Slug | Pages |
|---|---|---|
| Admin | `admin` | All pages |
| Project Manager | `project_manager` | pms, tickets, teams, reports, crm, kb |
| Developer | `developer` | pms, tickets |
| Frontend / Designer | `frontend_designer` | pms, tickets |
| QA | `qa` | pms, tickets |
| Support | `support` | messaging, callcenter, tickets, kb |
| Sales | `sales` | crm, messaging, campaigns |
| Marketer | `marketer` | campaigns, reports |
| Viewer | `viewer` | (admin picks pages per user via custom role or viewer assignment) |

---

## Page Keys

Each page key maps to one or more frontend routes and backend module guards.

| Key | Routes | Description |
|---|---|---|
| `pms` | `/admin/pms/*` | Projects, Tasks, Gantt, Board |
| `tickets` | `/admin/tickets/*`, `/admin/ticket-fields` | Ticket management |
| `crm` | `/admin/crm/*` | Leads, pipeline, companies, deals |
| `messaging` | `/dashboard/*` | Unified inbox / conversations |
| `callcenter` | `/admin/callcenter/*`, `/admin/recordings` | Call center, SIP, telephony |
| `campaigns` | `/admin/campaigns/*`, `/admin/email-templates` | Email marketing |
| `reports` | `/admin/reports`, `/admin/usage` | Analytics and reports |
| `kb` | `/admin/kb/*` | Knowledge base |
| `teams` | `/admin/teams` | Team management |

Admin users bypass all page checks and see everything.

---

## Data Model

### `roles` table (new)

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| name | String | Display name, e.g. "Project Manager" |
| slug | String unique | Machine key, e.g. "project_manager" |
| is_system | Boolean | `true` = protected, cannot edit/delete |
| pages | JSON | Array of page keys, e.g. `["pms", "tickets"]` |
| created_at | DateTime | |

### `users` table change

- `role` column: currently stores `"admin"` or `"user"` (string)
- After migration: stores a slug from the `roles` table (e.g. `"support"`, `"developer"`)
- Migration: existing `"user"` values → `"support"`; `"admin"` values → `"admin"`
- No FK constraint — slug string reference (consistent with existing pattern)

---

## Custom Roles

Admins can create custom roles via `/admin/roles`:

- Any name and slug
- Pick any combination of page keys from a checklist
- Can be edited or deleted at any time
- If a custom role is deleted, users assigned to it fall back to `"viewer"`

---

## Role Management — Admin UI

### `/admin/roles` (rebuilt)

- Lists all roles
- System roles show a 🔒 lock icon; Edit/Delete buttons are hidden
- Custom roles: Edit (name + pages), Delete
- "+ New Role" → name input + pages checklist → Save

### `/admin/users` (small addition)

- Each user row shows their current role as a badge
- Clicking the badge opens a dropdown of all available roles
- Admin selects → saves immediately via `PATCH /admin/users/{id}/role`
- A user cannot change their own role
- Role change takes effect on next page load (no re-login required)

---

## Route Protection

### Backend

`dependencies.py` gets a new helper:

```python
def require_page(page_key: str):
    """Dependency that checks user's role has access to the given page key."""
```

All admin routes get the appropriate `require_page()` dependency. Admins bypass all checks.

### Frontend

New `middleware.ts` at the Next.js root:

```
Route prefix → required page key
/admin/pms        → pms
/admin/crm        → crm
/admin/callcenter → callcenter
/dashboard        → messaging
... etc
```

- If user's role doesn't include the page key → redirect to `/unauthorized`
- `AdminNav` hides links the current user's role can't access (clean nav, no grayed items)
- Role + page permissions cached in `localStorage` after login, refreshed on role change

---

## PMS Project Roles — Unchanged

Project-level roles (developer, qa, pm, client, viewer) remain **exactly as designed**. They are assigned per-project when adding a member and drive the workflow state machine. They have nothing to do with the global role system.

A user with global role `"developer"` can still be added to a project as `"qa"` if needed.

---

## Migration Plan

1. Create `roles` table and seed all 9 fixed roles
2. Migrate `users.role`: `"user"` → `"support"`, `"admin"` → `"admin"`
3. Add `require_page()` backend dependency to all relevant route files
4. Add `middleware.ts` to Next.js frontend
5. Rebuild `/admin/roles` page
6. Add role badge + dropdown to `/admin/users`
7. Update `AdminNav` to filter by page keys instead of UserPermission records

---

## What This Does NOT Change

- PMS project member roles (developer/qa/pm/client/viewer)
- Existing UserPermission table (kept for granular feature flags like manage_users, manage_branding etc — those remain admin-only features)
- JWT / OTP auth flow
- Any existing API contracts
