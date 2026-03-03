# Todos Sidebar Design

**Date:** 2026-03-02
**Status:** Approved

## Problem

The My Todos feature (`/reminders`) only exists as a full-page view. Users want to access full todos functionality from a right sidebar panel without navigating away from their current page.

## Approach

Extract todos logic into a shared `TodosPanel` component rendered in two contexts:
1. The existing full page at `/reminders`
2. A new slide-in right sidebar toggled from the header icon

## Components

### `frontend/components/TodosPanel.tsx` (new)
All todos state, API calls, and rendering extracted from `/reminders/page.tsx`. Accepts a `mode: 'page' | 'sidebar'` prop for layout differences (scroll/height behaviour).

### `frontend/app/reminders/page.tsx` (modified)
Becomes a thin wrapper: `<MainHeader>` + `<TodosPanel mode="page" />`.

### `frontend/components/TodosSidebar.tsx` (new)
Fixed right drawer (`right-0`, `z-50`, `w-96`, full viewport height minus header). Renders `<TodosPanel mode="sidebar" />`. Closes on backdrop click or X button. Slides in with CSS transition.

### `frontend/components/MainHeader.tsx` (modified)
- Restore `FiCheckSquare` icon **button** (not Link) on the right side with unseen badge — clicking toggles the sidebar open/closed.
- Nav tab "My Todos" keeps its `<Link href="/reminders">` for full-page access.
- Sidebar open/closed state lives in `MainHeaderInner`.

## Data Flow

Each panel instance manages independent local state, fetching from the same API endpoints. No shared state needed — sidebar and full page are never open simultaneously in practice.

## What Stays the Same

All API calls to `/api/todos/*`, all modals (create, edit, detail, reschedule, share), comment flows, real-time SSE subscriptions — unchanged, just moved into `TodosPanel`.
