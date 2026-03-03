# DB Migration Schedule v2 — Design Doc

**Date:** 2026-03-03
**Status:** Approved

## Problem

The existing `DbMigrationSchedule` only supports an `interval_minutes` field (e.g. every 30 min, every 24h). Admins need to:

1. Schedule migrations at a specific **date + time** (one-time) or a **recurring weekly day + time**.
2. **Notify clients by email** before the migration runs, so they're aware of the maintenance window.

---

## Decisions

| Question | Decision |
|---|---|
| Where do notification emails come from? | Free-text comma-separated list stored on the schedule |
| Schedule types supported? | Both one-time (specific date+time) and recurring weekly (day-of-week + time) |
| When is notification sent? | Auto-send X hours before run (configurable) + manual re-send button |
| Scheduling model? | Structured fields (Option B) — maps cleanly to APScheduler triggers |

---

## Data Model

Replace `interval_minutes` on `db_migration_schedules` with:

```sql
ALTER TABLE db_migration_schedules
  DROP COLUMN IF EXISTS interval_minutes,
  ADD COLUMN IF NOT EXISTS schedule_type    VARCHAR   NOT NULL DEFAULT 'recurring',
  ADD COLUMN IF NOT EXISTS run_at           TIMESTAMPTZ,          -- one_time only
  ADD COLUMN IF NOT EXISTS day_of_week      INTEGER,              -- recurring: 0=Mon…6=Sun
  ADD COLUMN IF NOT EXISTS time_of_day      VARCHAR,              -- "HH:MM" 24h, both types
  ADD COLUMN IF NOT EXISTS notify_emails    TEXT,                 -- comma-separated
  ADD COLUMN IF NOT EXISTS notify_hours_before INTEGER DEFAULT 24,
  ADD COLUMN IF NOT EXISTS status           VARCHAR DEFAULT 'scheduled';
  -- status values: scheduled / notified / completed / disabled
```

Keep existing: `id`, `server_id`, `enabled`, `last_run_at`.

---

## APScheduler Logic

### One-time schedule
- **Migration job**: APScheduler `date` trigger at `run_at`.
  - Job ID: `db_migration_server_{server_id}`
  - After run: set `status = completed`, `last_run_at = now()`
- **Notification job**: APScheduler `date` trigger at `run_at - notify_hours_before hours`.
  - Job ID: `db_migration_notify_{server_id}`
  - Sends the notification email; sets `status = notified`

### Recurring schedule
- **Migration job**: APScheduler `cron` trigger.
  - `day_of_week = day_of_week`, `hour = HH`, `minute = MM` (parsed from `time_of_day`)
  - Job ID: `db_migration_server_{server_id}`
- **Notification job**: APScheduler `cron` trigger, same `day_of_week`, `notify_hours_before` hours earlier.
  - If notify time crosses midnight into the previous day, decrement `day_of_week` accordingly.
  - Job ID: `db_migration_notify_{server_id}`

---

## Notification Email

**Subject:** `Scheduled Database Maintenance — {server_name} — {date} at {time}`

**Body (plain text):**
```
Dear Client,

This is an advance notice that a scheduled database maintenance will be performed on:

  Server:      {server_name}
  Date:        {date}
  Time:        {time} (UTC)
  Scope:       {domain_suffix or "all sites"}

During this window, your database may be briefly unavailable.

Thank you for your patience.
```

Sent via the existing `email_service` SMTP infrastructure.

---

## API Changes

### Updated: `POST /cloudpanel/migrations/schedules/{server_id}`

New payload (`DbMigrationScheduleUpsert`):
```json
{
  "schedule_type": "one_time",       // or "recurring"
  "run_at": "2026-03-10T02:00:00Z", // one_time only
  "day_of_week": 6,                  // recurring only (0=Mon, 6=Sun)
  "time_of_day": "02:00",            // both types
  "enabled": true,
  "notify_emails": "client@example.com, team@company.com",
  "notify_hours_before": 24
}
```

Response: `DbMigrationScheduleResponse` (updated to include new fields + `status`).

### New: `POST /cloudpanel/migrations/schedules/{server_id}/notify`

Immediately sends the notification email to `notify_emails`. No body required.
Returns `{"ok": true, "sent_to": ["client@example.com", "team@company.com"]}`.

---

## Frontend

The schedule row in the admin page expands into a form with:

- **Schedule Type** toggle: `One-time` / `Recurring`
- **One-time fields**: date picker + time picker → combined into `run_at`
- **Recurring fields**: day-of-week dropdown (Monday–Sunday) + time picker → `day_of_week` + `time_of_day`
- **Notify emails**: text input, placeholder `client@example.com, another@example.com`
- **Notify X hours before**: number input (default 24)
- **Enabled** checkbox
- **Status badge** (one-time only): `scheduled` / `notified` / `completed`
- **Save** button
- **Send Notification Now** button — calls `POST .../notify` manually

---

## Files Changed

| File | Change |
|---|---|
| `backend/app/models/db_migration.py` | Replace `interval_minutes` with new columns |
| `backend/app/schemas/db_migration.py` | Update `DbMigrationScheduleUpsert` and `DbMigrationScheduleResponse` |
| `backend/app/services/migration_service.py` | Update `_upsert_job`, `register_migration_jobs`; add `send_migration_notification()` |
| `backend/main.py` | Add `ALTER TABLE` inline migrations for schema change |
| `backend/app/routes/db_migrations.py` | Update `upsert_schedule`; add `POST .../notify` endpoint |
| `frontend/app/admin/cloudpanel/migrations/page.tsx` | Replace `ScheduleRow` interval dropdown with new schedule form |
