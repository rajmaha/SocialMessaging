# Remote Backup System — Design Document

**Date:** 2026-03-04
**Status:** Approved
**Approach:** Plugin-based Destination Architecture (Approach B)

---

## Overview

A remote server backup system manageable from the admin UI. Backs up:
- **CloudPanel servers** (DB + files) via existing SSH/paramiko infrastructure
- **Local SocialMedia app** PostgreSQL database to a remote destination

Supports scheduled and manual triggers, multiple destination types, configurable retention, and email alerts on failure.

---

## Architecture

```
Admin UI (Next.js)
  └── /admin/backups/
        ├── Jobs tab        — create, edit, delete, manually trigger backup jobs
        ├── Destinations tab — saved destination configs (SFTP, S3, GDrive, etc.)
        └── History tab      — per-run logs with status, size, duration, errors

FastAPI Backend
  ├── routes/backups.py
  ├── services/backup_engine.py       — orchestrates: SSH → dump/tar → pull → send
  └── services/destinations/
        ├── base.py                   — BaseDestination interface
        ├── local.py                  — local FastAPI server storage
        ├── sftp.py
        ├── scp.py
        ├── s3.py                     — boto3
        ├── google_drive.py           — Google Drive API (OAuth2)
        └── onedrive.py               — Microsoft Graph API (OAuth2)

APScheduler (existing in main.py)
  └── Polls active BackupJobs every 1 min → triggers BackupEngine → logs BackupRun
```

**Data flow:**
1. APScheduler fires for a due job (or admin clicks Run Now)
2. `BackupEngine` SSHes into server (paramiko, reuses `CloudPanelService` pattern) OR runs locally
3. Executes `mysqldump`/`pg_dump` + `tar` commands, pulls files to a temp dir
4. Destination plugin uploads/copies the file
5. Retention policy runs — deletes old runs per job rules (max count + max days)
6. `BackupRun` row written with status, size, duration
7. On failure → email sent to `notify_on_failure_emails`

---

## Data Models

### `BackupDestination`
Saved, reusable destination configurations (like saved email accounts).

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| name | String | Human-readable label |
| type | String | `local`, `sftp`, `scp`, `s3`, `google_drive`, `onedrive` |
| config | JSON | Type-specific credentials/settings (see below) |
| is_active | Boolean | |
| created_at | DateTime | |

**Config shapes by type:**
```json
// sftp / scp
{ "host": "", "port": 22, "username": "", "password": "", "ssh_key": "", "remote_path": "" }

// s3
{ "bucket": "", "region": "", "access_key": "", "secret_key": "", "endpoint_url": "", "prefix": "" }

// google_drive
{ "folder_id": "", "oauth_token": "" }

// onedrive
{ "folder_path": "", "oauth_token": "" }

// local
{ "path": "/var/backups/socialmedia" }
```

### `BackupJob`
One job = one backup task with a schedule and destination.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| name | String | |
| is_active | Boolean | |
| source_type | String | `cloudpanel_server` or `local_app` |
| server_id | Integer FK | → `CloudPanelServer`, nullable for `local_app` |
| backup_scope | String | `db`, `files`, `both` |
| destination_id | Integer FK | → `BackupDestination` |
| schedule_type | String | `manual`, `interval`, `cron` |
| schedule_interval_hours | Integer | Nullable |
| schedule_cron | String | Nullable, e.g. `"0 2 * * *"` |
| next_run_at | DateTime | Updated after each run |
| retention_max_count | Integer | Nullable, e.g. 10 |
| retention_max_days | Integer | Nullable, e.g. 30 |
| notify_on_failure_emails | JSON | Array of email strings |
| created_at | DateTime | |
| updated_at | DateTime | |

### `BackupRun`
Immutable log of every execution.

| Column | Type | Notes |
|---|---|---|
| id | Integer PK | |
| job_id | Integer FK | → `BackupJob` |
| status | String | `running`, `success`, `failed` |
| started_at | DateTime | |
| finished_at | DateTime | Nullable |
| file_size_bytes | Integer | Nullable |
| backup_file_path | String | Where it landed at the destination |
| error_message | String | Nullable |

---

## Backend Components

### `BackupEngine` (`services/backup_engine.py`)

```python
class BackupEngine:
    def run(self, job: BackupJob, db: Session) -> BackupRun:
        # 1. Create BackupRun(status=running)
        # 2. SSH into server OR run locally
        # 3. Execute dump/tar → pull to temp dir
        # 4. Load destination plugin → upload
        # 5. Apply retention policy
        # 6. Update BackupRun(status=success/failed)
        # 7. On failure → send email to notify_on_failure_emails
```

**SSH commands for CloudPanel servers:**
```bash
# MySQL (CloudPanel default)
mysqldump -u root --all-databases > /tmp/backup_db_<timestamp>.sql

# Files
tar -czf /tmp/backup_files_<timestamp>.tar.gz /home/*/htdocs/

# Pull via SFTP then clean remote /tmp
```

**Local app DB backup:**
```bash
pg_dump $DATABASE_URL > /tmp/backup_app_<timestamp>.sql
```

### `BaseDestination` (`services/destinations/base.py`)

```python
class BaseDestination:
    def upload(self, local_path: str, job: BackupJob) -> str:
        raise NotImplementedError  # returns remote path/URL

    def delete(self, remote_path: str):
        raise NotImplementedError

    def list_backups(self, job: BackupJob) -> list[str]:
        raise NotImplementedError  # for retention cleanup

    def test_connection(self) -> bool:
        raise NotImplementedError
```

### APScheduler Integration (existing `main.py` pattern)
- On startup: load all active jobs, schedule based on `next_run_at`
- Every 1 min: poll `BackupJob` where `next_run_at <= now AND is_active = true`
- After each run: update `next_run_at` based on `schedule_type`

### API Routes (`routes/backups.py`)

```
# Destinations
POST   /backups/destinations           create
GET    /backups/destinations           list
PUT    /backups/destinations/{id}      update
DELETE /backups/destinations/{id}      delete
POST   /backups/destinations/test      test connection before saving

# OAuth
GET    /backups/oauth/google/connect   initiate OAuth2 for Google Drive
GET    /backups/oauth/google/callback  OAuth2 callback
GET    /backups/oauth/onedrive/connect initiate OAuth2 for OneDrive
GET    /backups/oauth/onedrive/callback OAuth2 callback

# Jobs
POST   /backups/jobs                   create
GET    /backups/jobs                   list
PUT    /backups/jobs/{id}              update
DELETE /backups/jobs/{id}             delete
POST   /backups/jobs/{id}/run         manual trigger

# History
GET    /backups/jobs/{id}/runs        history for a specific job
GET    /backups/runs                  all history (admin overview)
GET    /backups/runs/{id}             single run detail
```

All routes protected by `require_admin` dependency.

---

## Admin UI (`frontend/app/admin/backups/`)

### Tab 1: Jobs
- Table: Name, Source, Scope, Schedule, Last Run, Status, Actions (Run Now / Edit / Delete)
- **Create/Edit Job modal fields:**
  - Name
  - Source: `Local App DB` | CloudPanel Server (dropdown)
  - Backup scope: `Database` | `Files` | `Both` (hidden for local app)
  - Destination: dropdown of saved destinations
  - Schedule: `Manual` | `Every N hours` | `Cron expression`
  - Retention: max count (optional) + max days (optional)
  - Notify on failure: comma-separated emails

### Tab 2: Destinations
- Table: Name, Type, Status, Actions (Edit / Delete)
- **Create Destination modal** with type selector; fields change per type:
  - `SFTP/SCP`: host, port, username, password or SSH key, remote path → Test Connection
  - `S3`: bucket, region, access key, secret key, optional endpoint URL, prefix → Test
  - `Google Drive`: → Connect with Google (OAuth2)
  - `OneDrive`: → Connect with Microsoft (OAuth2)
  - `Local`: directory path

### Tab 3: History
- Table: Job name, Started, Duration, Size, Status (success/failed badge)
- Filterable by job and status
- Click row → expand error message and file path

---

## Error Handling & Notifications

- Failed runs: error message stored in `BackupRun.error_message`
- On failure: email sent to all addresses in `notify_on_failure_emails` (reuses existing email service)
- SSH errors, destination upload errors, and dump failures all caught and logged to the run
- Partial backups (e.g. DB succeeded, files failed): run marked `failed`, partial files cleaned up

---

## Dependencies

| Package | Purpose |
|---|---|
| `paramiko` | SSH/SFTP (already installed) |
| `boto3` | S3 destinations |
| `google-api-python-client` + `google-auth-oauthlib` | Google Drive |
| `msal` | Microsoft OneDrive (Microsoft Authentication Library) |

---

## Out of Scope (for now)

- Backup encryption at rest
- Backup restore via UI (manual restore from downloaded files)
- Per-site granular file selection (backs up all sites on a server)
- Backup diff / incremental backups
