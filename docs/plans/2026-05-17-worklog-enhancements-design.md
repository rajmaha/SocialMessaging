# Worklog Module Enhancements Design

## Overview

Four feature additions to the existing worklog module: CSV/PDF export, email notifications, dashboard widget, and bulk approval.

---

## 1. CSV/PDF Export

### CSV Export
- Available on reports page (admin) and agent's own worklog page
- Exports rows matching current filters (date range, source, agent)
- Columns: agent, date, source, category/project, task/conversation, hours, summary, attachment filenames
- Button: "Export CSV" in top-right of report table

### PDF Export
- Same data as CSV, formatted as printable report
- Header: company name (from branding), report title, date range, generated timestamp
- Footer: total hours, breakdown by source
- Server-side generation using reportlab or weasyprint
- Button next to CSV: "Export PDF"

### Approval History Export (admin)
- Endpoint: `GET /api/worklog/approval/history` — all reviewed entries (approved + rejected) with reviewer name and timestamp
- Exportable as CSV from approval page via "Export History" button

### Agent's Own Export
- On `/admin/worklog`, "Export" dropdown with CSV for own entries (filtered by current date selection)

### API Endpoints
- `GET /api/worklog/reports/export?format=csv&start_date=...&end_date=...` — CSV download
- `GET /api/worklog/reports/export?format=pdf&start_date=...&end_date=...` — PDF download
- `GET /api/worklog/entries/export?format=csv&log_date=...` — agent's own entries CSV
- `GET /api/worklog/approval/history?format=csv` — approval history CSV

---

## 2. Email Notifications

### Triggers

| Event | Recipient | Content |
|-------|-----------|---------|
| Entry submitted | All admins | "Agent X submitted 2.5h worklog for [date]" |
| Entry approved | The agent | "Your worklog for [date] was approved by [admin]" |
| Entry rejected | The agent | "Your worklog for [date] was rejected: [reason]" |
| Entry resubmitted | All admins | "Agent X resubmitted worklog for [date]" |
| Daily digest (pending) | All admins | "You have N pending worklog entries awaiting approval" |

### Implementation
- Reuse existing `app/services/email_service.py`
- New service: `app/services/worklog_notifications.py`
  - `send_worklog_notification(event_type, entry, recipient_emails)`
- HTML email template — clean, with action button linking to relevant page
- Daily digest: APScheduler job at 8 AM (configurable), only fires if pending entries exist

### Settings
- New model or JSON field on BrandingSettings: `worklog_notification_settings`
- Per-notification-type toggle (default: all enabled)
- Admin-configurable via settings page

---

## 3. Dashboard/Summary Widget

### Worklog Page Summary Cards (`/admin/worklog`)
Row of metric cards above the timer section:
- Today's hours
- This week's hours (Mon–Sun)
- Pending entries count
- Approved this week count
- Timer status (elapsed if active)

### Main Admin Dashboard Widget
Compact card in dashboard grid:
- **Agent view:** today's hours, weekly total, pending count
- **Admin view:** total pending awaiting approval, today's team hours, link to approval queue
- Click navigates to `/admin/worklog` (agent) or `/admin/worklog/approval` (admin)

### API Endpoint
- `GET /api/worklog/summary` — aggregated metrics for current user
  - Returns: `today_hours`, `week_hours`, `pending_count`, `approved_week_count`, `timer_active`
- `GET /api/worklog/summary?team=true` (admin) — adds `team_today_hours`, `total_pending`

---

## 4. Bulk Approval

### UI Controls
- Checkbox on each row + "Select All" in header
- Shift+click range selection
- Floating action bar (bottom) when 1+ selected:
  - "[N] entries selected" | "Approve All" | "Reject All" | "Clear Selection"

### Group Actions
- Table groupable by agent or date (toggle)
- Each group header has "Select Group" checkbox
- "Approve all from [agent] on [date]" quick-action link

### Reject All Flow
- Single rejection note modal — note applies to all selected
- Confirmation: "Reject [N] entries with this reason?"

### Keyboard Shortcuts
- `A` — approve selected (with confirmation)
- `R` — reject selected (opens note modal)
- `Ctrl/Cmd + A` — select all visible

### API Endpoints
- `POST /api/worklog/entries/bulk-approve` — `{ entry_ids: [1, 2, 3] }`
- `POST /api/worklog/entries/bulk-reject` — `{ entry_ids: [1, 2, 3], rejection_note: "..." }`
- Both return `{ affected: N }`
