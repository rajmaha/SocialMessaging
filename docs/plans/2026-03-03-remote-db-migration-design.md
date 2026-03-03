# Remote Database Migration Module — Design Doc
**Date:** 2026-03-03
**Status:** Approved

---

## Overview

A remote database migration module that allows admins to upload SQL migration files via the Admin UI and run them against deployed CloudPanel sites — either manually or on a per-server schedule. Migrations are tracked in local PostgreSQL and executed remotely via SSH + MySQL root.

---

## Architecture

```
Admin UI (upload + trigger)
        ↓
FastAPI Routes (/cloudpanel/migrations)
        ↓
MigrationService (SSH → SFTP upload → mysql -u root)
        ↓
db_migration_logs (local PostgreSQL tracking)

APScheduler (per-server interval jobs)
        ↓
MigrationService (same execution path)
```

---

## Data Models (Local PostgreSQL)

### `db_migrations`
Stores uploaded migration file metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `filename` | String | e.g. `0001.add_column.sql` |
| `file_path` | String | Path on backend disk (`migration_storage/`) |
| `description` | String (nullable) | Optional label |
| `domain_suffix` | String (nullable) | e.g. `abc.com` — blank = all sites |
| `uploaded_by` | FK → users.id | |
| `created_at` | DateTime | |

### `db_migration_logs`
Tracks execution status per migration per site.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `migration_id` | FK → db_migrations.id | |
| `site_id` | FK → cloudpanel_sites.id | |
| `server_id` | FK → cloudpanel_servers.id | |
| `status` | Enum | `pending / running / success / failed` |
| `error_message` | Text (nullable) | SSH/MySQL error output |
| `executed_at` | DateTime | |

### `db_migration_schedules`
Per-server auto-run configuration.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `server_id` | FK → cloudpanel_servers.id (unique) | One schedule per server |
| `interval_minutes` | Integer | e.g. 60, 1440 |
| `enabled` | Boolean | On/off toggle |
| `last_run_at` | DateTime (nullable) | |

---

## File Storage

`backend/app/migration_storage/`
Mirrors the existing `attachment_storage` pattern. Uploaded `.sql` files are saved here with their original filename (or a safe sanitised version).

---

## API Endpoints

All under prefix `/cloudpanel`, protected by `require_cloudpanel` (admin only).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/cloudpanel/migrations/upload` | Upload a `.sql` migration file |
| `GET` | `/cloudpanel/migrations` | List all migrations |
| `DELETE` | `/cloudpanel/migrations/{id}` | Delete (only if no logs exist) |
| `GET` | `/cloudpanel/migrations/{id}/logs` | Execution logs for one migration |
| `POST` | `/cloudpanel/migrations/run/{server_id}` | Manually run all pending migrations on a server |
| `GET` | `/cloudpanel/migration-schedules` | List all server schedules |
| `POST` | `/cloudpanel/migration-schedules/{server_id}` | Create or update a server schedule |

---

## Execution Logic

Triggered by either manual API call or APScheduler job.

**Per-server run:**
1. SSH into the server using `CloudPanelServer` credentials (existing SSH client pattern)
2. Fetch all `CloudPanelSite` records for that server
3. For each site:
   - If `migration.domain_suffix` is set and `site.domain_name` does not end with it → **skip**
   - If a `db_migration_log` with `status = success` already exists for this migration+site → **skip**
   - Otherwise: proceed
4. Upload SQL file to remote `/tmp/{filename}` via SFTP
5. Execute: `mysql -u root {db_name} < /tmp/{filename}`
6. Delete temp file from remote
7. Write result to `db_migration_logs`:
   - On success: `status = success`, `executed_at = now()`
   - On failure: `status = failed`, `error_message = stderr output`

**Domain suffix filtering:**
- `domain_suffix = null` or `""` → runs on all sites on the server
- `domain_suffix = "abc.com"` → only runs on sites where `domain_name` ends with `abc.com`
- Handles both `*.abc.com` and `*.xyz.com` independently

---

## Scheduling (APScheduler)

- On backend startup: load all `db_migration_schedules` where `enabled = true` and register interval jobs dynamically
- Job ID format: `migration_server_{server_id}`
- When a schedule is created or updated via API: add/replace the APScheduler job live (no restart needed)
- When `enabled` is toggled off: remove the job from the scheduler
- Each job calls the same execution logic as the manual trigger

---

## Frontend

**New page:** `/admin/cloudpanel/migrations`
Added to the existing CloudPanel admin nav section.

### Upload Panel
- `.sql` file input
- Optional description text field
- Optional domain suffix field (hint: `e.g. abc.com — leave blank for all sites`)
- Upload button

### Migrations Table
- Columns: filename | description | domain suffix | uploaded by | date | actions
- **Logs** button per row → drawer showing per-site execution log (domain, server, status, error, executed_at)
- **Run on Server** per row → dropdown to pick server, then confirm and trigger
- **Delete** button per row (disabled if logs exist)
- Status badge: aggregate across all logs — `All Success / X Failed / X Pending`

### Schedules Panel
- One row per server
- Columns: server name | interval dropdown (30 min / 1 hr / 6 hr / 12 hr / 24 hr) | enabled toggle | last run | save button

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| SQL file storage | Filesystem (`migration_storage/`) | Mirrors existing patterns, avoids DB bloat |
| DB auth for remote execution | MySQL root via SSH | No per-site password storage needed; SSH root already available |
| Migration tracking | Local PostgreSQL only | Single source of truth, no remote state |
| Domain targeting | Optional suffix match on `domain_name` | Simple, covers `*.abc.com` vs `*.xyz.com` use case |
| Schedule management | APScheduler with dynamic job registration | Consistent with existing background job pattern in `main.py` |

---

## Out of Scope

- Rollback / down migrations
- Per-site manual override (run is always server-wide)
- Migration dry-run / preview
