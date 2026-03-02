# Reminders (Todos) Module — Design Document

**Date:** 2026-03-01
**Status:** Approved

## Overview

A personal reminders/todos module for all users (agents and admins). Each user manages their own reminders with priority levels, scheduling, calendar sync (Google + Microsoft), and the ability to share notes with internal users. Shared reminders support view + comment access. Users can also share reminders to their personal social media accounts.

## Data Model

### `reminders` table

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `user_id` | INTEGER FK → users(id) ON DELETE CASCADE | Owner |
| `title` | VARCHAR NOT NULL | Short title |
| `description` | TEXT | Optional detailed note |
| `priority` | VARCHAR NOT NULL DEFAULT 'as_usual' | `planning`, `low`, `as_usual`, `urgent` |
| `status` | VARCHAR NOT NULL DEFAULT 'scheduled' | `scheduled`, `pending`, `completed` |
| `due_date` | TIMESTAMP WITH TIME ZONE | NULL when priority = `planning` |
| `original_due_date` | TIMESTAMP WITH TIME ZONE | First scheduled date before any reschedules |
| `google_event_id` | VARCHAR | Synced Google Calendar event ID |
| `microsoft_event_id` | VARCHAR | Synced Microsoft Calendar event ID |
| `created_at` | TIMESTAMP WITH TIME ZONE DEFAULT NOW() | |
| `updated_at` | TIMESTAMP WITH TIME ZONE DEFAULT NOW() | |

### `reminder_shares` table

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `reminder_id` | INTEGER FK → reminders(id) ON DELETE CASCADE | |
| `shared_by` | INTEGER FK → users(id) | Who shared it |
| `shared_with` | INTEGER FK → users(id) | Recipient |
| `is_seen` | BOOLEAN DEFAULT FALSE | For badge count |
| `created_at` | TIMESTAMP WITH TIME ZONE DEFAULT NOW() | |

### `reminder_comments` table

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `reminder_id` | INTEGER FK → reminders(id) ON DELETE CASCADE | |
| `user_id` | INTEGER FK → users(id) | Comment author |
| `content` | TEXT NOT NULL | |
| `created_at` | TIMESTAMP WITH TIME ZONE DEFAULT NOW() | |

### `user_calendar_connections` table

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `user_id` | INTEGER FK → users(id) ON DELETE CASCADE | |
| `provider` | VARCHAR NOT NULL | `google` or `microsoft` |
| `access_token` | TEXT | Encrypted OAuth token |
| `refresh_token` | TEXT | Encrypted refresh token |
| `token_expires_at` | TIMESTAMP WITH TIME ZONE | |
| `calendar_id` | VARCHAR | Selected calendar ID |
| `created_at` | TIMESTAMP WITH TIME ZONE DEFAULT NOW() | |
| `updated_at` | TIMESTAMP WITH TIME ZONE DEFAULT NOW() | |

## API Endpoints

### Reminders CRUD — `/api/reminders`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reminders` | List own reminders (filterable by status, priority) |
| `POST` | `/api/reminders` | Create a reminder |
| `GET` | `/api/reminders/{id}` | Get single reminder (own or shared with you) |
| `PUT` | `/api/reminders/{id}` | Update reminder (owner only) |
| `DELETE` | `/api/reminders/{id}` | Delete reminder (owner only) |
| `PUT` | `/api/reminders/{id}/reschedule` | Reschedule — updates due_date, keeps original_due_date, syncs calendar |
| `PUT` | `/api/reminders/{id}/status` | Change status (scheduled → pending → completed) |

### Sharing — `/api/reminders/{id}/share`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/reminders/{id}/share` | Share with selected users or all. Sends email (.ics) + WebSocket notification |
| `GET` | `/api/reminders/shared-with-me` | List reminders shared with current user |
| `GET` | `/api/reminders/shared-with-me/unseen-count` | Badge count of unseen shared reminders |
| `PUT` | `/api/reminders/shared-with-me/{share_id}/seen` | Mark shared reminder as seen |

### Comments — `/api/reminders/{id}/comments`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reminders/{id}/comments` | List comments on a reminder |
| `POST` | `/api/reminders/{id}/comments` | Add comment (owner or shared recipient) |

### Calendar — `/api/calendar`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/calendar/connect/{provider}` | Initiate OAuth flow (returns redirect URL) |
| `GET` | `/api/calendar/callback/{provider}` | OAuth callback — stores tokens |
| `GET` | `/api/calendar/status` | Check which calendars are connected |
| `DELETE` | `/api/calendar/disconnect/{provider}` | Remove calendar connection |

### Internal Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users/internal` | List all active internal users (for share popup) |

## Background Jobs (APScheduler)

| Job | Interval | Logic |
|---|---|---|
| `check_overdue_reminders` | 1 min | Find reminders with status=scheduled and due_date < now() → set status=pending |
| `refresh_calendar_tokens` | 30 min | Refresh expiring OAuth tokens for Google/Microsoft |

## Real-time Events (WebSocket)

| Event Type | Trigger | Payload |
|---|---|---|
| `reminder_shared` | Someone shares a reminder with you | `{reminder_id, title, sharer_name}` |
| `reminder_comment` | Someone comments on a shared reminder | `{reminder_id, title, commenter_name}` |
| `reminder_due` | A reminder becomes overdue (background job) | `{reminder_id, title}` |

## Email Notification (on share)

- Subject: `"{sharer_name} shared a reminder: {title}"`
- Body: HTML email with title, description, due date, priority, link to app
- Attachment: `.ics` file (VEVENT) so recipient can import to any calendar
- Uses `email_service` singleton with branding SMTP config from DB

## Frontend

### Header Icon
- Bell/checklist icon in `MainHeader` with badge count (unseen shared reminders)
- Clicking navigates to `/reminders`

### Reminders Page (`/reminders/page.tsx`)
- **My Reminders tab**: Filterable list by status/priority. Create, edit, delete, reschedule.
- **Shared With Me tab**: Reminders shared by others with seen/unseen state.
- Each card shows: title, priority badge, status badge, due date, share/social icons.
- Clicking opens detail view with description + comments thread.

### Create/Edit Modal
- Title, description, priority dropdown, date/time picker
- Date/time hidden when priority = `planning`
- Status dropdown (for editing)

### Share Popup Modal
- Searchable list of all internal users with checkboxes
- "Select All" checkbox at top
- Confirm sends share + email + WebSocket notification

### Social Media Share
- Share button on each reminder card/detail
- Uses Web Share API (`navigator.share()`) on supported browsers (native share sheet)
- Fallback: direct-link buttons for WhatsApp (`wa.me`), Facebook (`facebook.com/sharer`), LinkedIn (`linkedin.com/sharing`), and copy-to-clipboard
- Shares formatted text: title, description, due date
- Purely frontend — no backend changes needed

### Calendar Settings (in `/settings`)
- Connect/disconnect Google Calendar
- Connect/disconnect Microsoft Calendar
- Shows connection status per provider

## Priority Behavior

| Priority | Due date required? | Default status |
|---|---|---|
| `planning` | No | `scheduled` (but effectively a backlog item) |
| `low` | Yes | `scheduled` |
| `as_usual` | Yes | `scheduled` |
| `urgent` | Yes | `scheduled` |

## Status Lifecycle

```
scheduled → pending (auto, when due_date passes without action)
scheduled → completed (manual)
pending → completed (manual)
pending → scheduled (reschedule — sets new due_date)
```

Overdue reminders (status changed to `pending` by background job) carry forward and appear each day until the user either completes or reschedules them.

## Calendar Sync (OAuth)

### Google Calendar
- OAuth2 via Google Cloud Console credentials
- Scopes: `https://www.googleapis.com/auth/calendar.events`
- On reminder create/update/reschedule: create/update Google Calendar event
- On reminder delete/complete: delete Google Calendar event
- Token refresh via background job

### Microsoft Calendar
- OAuth2 via Azure AD / Microsoft Entra ID
- Scopes: `Calendars.ReadWrite`
- Microsoft Graph API: `POST /me/events`, `PATCH /me/events/{id}`, `DELETE /me/events/{id}`
- Token refresh via background job

### Environment Variables (new)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
```

## Files to Create/Modify

### New files
- `backend/app/models/reminder.py` — Reminder, ReminderShare, ReminderComment models
- `backend/app/models/calendar_connection.py` — UserCalendarConnection model
- `backend/app/schemas/reminder.py` — All Pydantic schemas
- `backend/app/schemas/calendar.py` — Calendar connection schemas
- `backend/app/routes/reminders.py` — All reminder CRUD + share + comment routes
- `backend/app/routes/calendar.py` — OAuth flow + connection management routes
- `backend/app/services/reminder_service.py` — Background job logic (overdue check)
- `backend/app/services/calendar_service.py` — Google/Microsoft calendar sync logic
- `frontend/app/reminders/page.tsx` — Main reminders page
- `frontend/components/ReminderShareModal.tsx` — Share popup with user list
- `frontend/components/SocialShareButtons.tsx` — Social media share buttons

### Modified files
- `backend/main.py` — Register routers, add migrations, add APScheduler jobs
- `backend/app/services/events_service.py` — Add new EventTypes
- `backend/app/services/email_service.py` — Add share notification method with .ics
- `frontend/components/MainHeader.tsx` — Add reminder bell icon with badge
- `frontend/app/settings/page.tsx` — Add calendar connection UI
