# Audit Log & Error Log Design

**Date:** 2026-03-06
**Status:** Approved

## Summary

Add comprehensive audit logging (user actions + system operations) and error logging (API exceptions, integration failures, background job errors, frontend JS errors) to the SocialMedia Unified Inbox. Logs are stored in a dedicated SQLite database (`backend/logs.db`), retained for 90 days with auto-purge, viewable by admins only via two new admin panel pages, and exportable as CSV.

---

## 1. Data Layer

**Database:** SQLite at `backend/logs.db`
**Engine:** Dedicated SQLAlchemy engine + `LogSessionLocal` in `backend/app/log_database.py`, mirroring existing `database.py` pattern. Tables created via `init_log_db()` called at startup in `main.py`.

### `audit_logs` table

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| timestamp | DateTime | UTC, indexed |
| user_id | Integer | Agent/admin who acted |
| user_email | String | Denormalised for log readability |
| user_role | String | admin / agent at time of action |
| action | String | e.g. `conversation.assigned`, `message.sent`, `user.created` |
| entity_type | String | e.g. `conversation`, `user`, `email` |
| entity_id | Integer | ID of affected record (nullable) |
| detail | String | JSON — before/after values or extra context |
| ip_address | String | From request (nullable) |
| request_path | String | API path (nullable) |
| request_method | String | GET/POST/etc (nullable) |

### `error_logs` table

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| timestamp | DateTime | UTC, indexed |
| severity | String | `error` \| `warning` \| `critical` |
| source | String | `api` \| `background_job` \| `integration` \| `frontend` |
| error_type | String | Exception class name or error code |
| message | String | Human-readable error message |
| traceback | String | Full stack trace (nullable) |
| user_id | Integer | Who triggered it (nullable) |
| request_path | String | nullable |
| request_method | String | nullable |
| context | String | JSON — extra contextual data |

**Retention:** APScheduler daily job deletes rows older than 90 days from both tables.

---

## 2. Backend / API Layer

### New files

- `backend/app/log_database.py` — SQLite engine, `LogBase`, `LogSessionLocal`, `get_log_db` dependency, `init_log_db()`
- `backend/app/models/logs.py` — `AuditLog` and `ErrorLog` SQLAlchemy models
- `backend/app/services/log_service.py` — `log_audit()` and `log_error()` helpers
- `backend/app/routes/logs.py` — admin-only log API endpoints

### Audit capture points (manual `log_audit()` calls)

- Auth: login, logout, failed login, password reset
- Conversations: assigned, status changed, closed
- Messages: sent (all platforms)
- Users: created, updated, deleted, role changed
- Admin settings: branding, bot, CORS, email accounts changed
- Background jobs: start / finish / failure

### Error capture

- Global FastAPI exception handler in `main.py` → auto-writes all unhandled exceptions to `error_logs`
- Background job try/except blocks → call `log_error()` on failure
- Frontend JS errors → POST to unauthenticated (rate-limited) endpoint

### API endpoints (`/logs/*`, admin role required)

| Method | Path | Description |
|---|---|---|
| GET | `/logs/audit` | Paginated audit log; filters: user, action, date range |
| GET | `/logs/errors` | Paginated error log; filters: severity, source, date range |
| GET | `/logs/audit/export` | CSV download of filtered audit log |
| GET | `/logs/errors/export` | CSV download of filtered error log |
| POST | `/logs/frontend-error` | Receive frontend JS errors (no auth, rate-limited) |

---

## 3. Frontend / Admin UI

### New pages

- `frontend/app/admin/audit-logs/page.tsx`
- `frontend/app/admin/error-logs/page.tsx`

### Audit Log page (`/admin/audit-logs`)

- Table columns: Timestamp, User, Role, Action, Entity, Detail, IP Address
- Filters: date range picker, user dropdown, action type dropdown
- Export CSV button
- Pagination (50 rows/page)
- Admin-only guard (redirect to dashboard if not admin)

### Error Log page (`/admin/error-logs`)

- Table columns: Timestamp, Severity (color-coded badge), Source, Error Type, Message, User, Path
- Expandable row → full traceback
- Filters: date range picker, severity dropdown, source dropdown
- Export CSV button
- Pagination (50 rows/page)
- Admin-only guard

### Admin sidebar

Both pages linked in existing admin sidebar navigation.

### Frontend error capture

Global `window.onerror` + `unhandledrejection` handler added to `frontend/app/layout.tsx`. Captures: error message, stack, URL, user agent. POSTs to `/logs/frontend-error`.

---

## 4. Retention & Purge

APScheduler job added to `main.py`:
- Runs daily
- Deletes `audit_logs` rows where `timestamp < now - 90 days`
- Deletes `error_logs` rows where `timestamp < now - 90 days`
