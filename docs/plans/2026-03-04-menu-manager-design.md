# Menu Manager & Menu Groups — Design Document

**Date:** 2026-03-04
**Status:** Approved

## Problem

The form builder system is fully implemented but forms are only accessible via direct URL (`/forms/{slug}`). There is no way for admins to organize links to forms (or other pages) into discoverable menus for logged-in users or public visitors.

## Solution

A general-purpose menu manager that lets admins create **Menu Groups** (e.g. "HR Forms", "IT Tools", "Quick Links"), each containing ordered **Menu Items** that can link to forms, internal app pages, or external URLs. Groups integrate into the AdminNav sidebar for logged-in users and are optionally exposed on a public portal page and within the chat widget.

## Data Model

### menu_groups

| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| name | VARCHAR(100) | e.g. "HR Forms", "Quick Links" |
| slug | VARCHAR(100) UNIQUE | URL-safe identifier |
| icon | VARCHAR(10) | Emoji icon for sidebar display |
| display_order | INT | Sort position in sidebar |
| public_access | BOOLEAN DEFAULT FALSE | If true, visible on public portal + chat widget |
| is_active | BOOLEAN DEFAULT TRUE | Toggle to hide without deleting |
| created_by | INT FK -> users.id | |
| created_at | TIMESTAMP | |

### menu_items

| Column | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| group_id | INT FK -> menu_groups.id CASCADE | |
| label | VARCHAR(200) | Display text |
| link_type | VARCHAR(20) | `form`, `internal`, `external` |
| link_value | VARCHAR(500) | Form slug, internal path, or full URL |
| icon | VARCHAR(10) | Optional emoji |
| open_in_new_tab | BOOLEAN DEFAULT FALSE | For external links |
| display_order | INT | Sort within group |
| is_active | BOOLEAN DEFAULT TRUE | |
| created_at | TIMESTAMP | |

### Link Types

- `form` — link_value is a form slug, rendered as `/forms/{slug}`
- `internal` — link_value is an app path like `/dashboard`
- `external` — link_value is a full URL like `https://example.com`

## API Endpoints

### Admin (requires `manage_menus` feature)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/menu-groups` | List all groups with items |
| POST | `/admin/menu-groups` | Create group |
| PUT | `/admin/menu-groups/{id}` | Update group |
| DELETE | `/admin/menu-groups/{id}` | Delete group (cascades items) |
| PUT | `/admin/menu-groups/reorder` | Reorder groups |
| POST | `/admin/menu-groups/{group_id}/items` | Create item |
| PUT | `/admin/menu-groups/{group_id}/items/{id}` | Update item |
| DELETE | `/admin/menu-groups/{group_id}/items/{id}` | Delete item |
| PUT | `/admin/menu-groups/{group_id}/items/reorder` | Reorder items |

### Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/menu` | Active groups where public_access=true, with active items |

### Internal (auth required)

| Method | Path | Purpose |
|---|---|---|
| GET | `/menu/all` | All active groups with active items (for sidebar) |

## Frontend UI

### 1. Admin Menu Manager (`/admin/menus`)

- Card list of menu groups showing: name, icon, item count, public_access badge, active status
- Create/Edit group modal: name, icon, slug (auto-generated), public_access toggle, is_active toggle
- Click group card to expand and show items inline
- Items show: icon, label, link type badge (Form/Internal/External), link value
- Add/Edit item modal: label, icon, link_type dropdown, link_value (form picker for `form` type, text input for others), open_in_new_tab toggle
- Move up/down buttons for reordering
- Delete with confirmation
- AdminNav sidebar entry under a new "Navigation" group with `manage_menus` permission

### 2. Public Portal (`/portal`)

- No auth required
- Fetches GET /menu (public groups only)
- Card layout: each group is a section header, items are clickable links
- Form links → `/forms/{slug}`, external links open in new tab

### 3. AdminNav Sidebar Integration

- Fetch GET /menu/all on mount (for logged-in users)
- Render each active menu group as a sidebar group after the hardcoded groups
- Items rendered as sidebar links with same styling as existing items
- Form items → `/forms/{slug}`, internal → path, external → new tab

### 4. Chat Widget Integration

- Add "Menu" tab/button to widget
- Fetch GET /menu (public groups only)
- Show clickable list of items; form links open inline or in new tab

## Files

### New Files

| File | Purpose |
|---|---|
| `backend/app/models/menu.py` | MenuGroup + MenuItem SQLAlchemy models |
| `backend/app/schemas/menu.py` | Pydantic request/response schemas |
| `backend/app/routes/menus.py` | All menu API endpoints |
| `frontend/app/admin/menus/page.tsx` | Admin Menu Manager page |
| `frontend/app/portal/page.tsx` | Public portal page |

### Modified Files

| File | Change |
|---|---|
| `backend/main.py` | CREATE TABLE IF NOT EXISTS for menu_groups + menu_items, register router |
| `frontend/components/AdminNav.tsx` | Fetch dynamic menu groups, render after hardcoded groups |
| `frontend/public/chat-widget.js` | Add menu tab fetching public groups |
| `frontend/lib/api.ts` | Add menuApi methods |

### Not Needed

- No new permission models — reuses `require_admin_feature("manage_menus")`
- No new React context providers — AdminNav fetches menus directly
