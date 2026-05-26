# CI/CD Manager — Complete Guide

The CI/CD Manager is a built-in deployment pipeline system that lets you deploy Git repositories to remote CloudPanel servers (or locally) — including running one-time shell scripts and SQL migrations — entirely from the admin panel.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Models](#database-models)
4. [Repository Structure Convention](#repository-structure-convention)
5. [API Reference](#api-reference)
6. [Deployment Pipeline](#deployment-pipeline)
7. [Git Authentication](#git-authentication)
8. [Shell Scripts](#shell-scripts)
9. [Database Migrations](#database-migrations)
10. [Scheduled Deployments](#scheduled-deployments)
11. [CloudPanel Integration](#cloudpanel-integration)
12. [Frontend UI](#frontend-ui)
13. [Adding a New Repository (Step-by-Step)](#adding-a-new-repository-step-by-step)
14. [Viewing Deployment Logs](#viewing-deployment-logs)
15. [How Idempotency Works](#how-idempotency-works)
16. [Limitations & Notes](#limitations--notes)

---

## Overview

The CI/CD Manager allows admins to:

- Register Git repositories (GitHub, GitLab, Bitbucket, self-hosted)
- Deploy to **remote CloudPanel servers via SSH** or to the **local machine**
- Run **one-time shell scripts** after each git pull (e.g., `npm install`, `pip install`)
- Run **SQL migration files** against one or more databases (run only once per DB, never repeated)
- Schedule deployments via **cron expressions** (using APScheduler)
- Trigger **manual deploys** from the UI with a single button click
- View full deployment history with git output, script logs, and migration logs

Access: **Admin only** — all CI/CD endpoints require admin authentication.

---

## Architecture

```
Admin UI (/admin/cicd)
       │
       ▼
FastAPI Routes (/cicd/*)          → backend/app/routes/ci_cd.py
       │
       ▼
CI/CD Service                     → backend/app/services/ci_cd_service.py
       │
       ├── SSH (Paramiko-style via subprocess)   → CloudPanel server
       │         ├── git clone / git pull
       │         ├── run bash_script field (if not empty)
       │         ├── bash scripts/ (only if run_default_scripts = true)
       │         └── psql / mysql migrations
       │
       └── Local subprocess
                 ├── git clone / git pull
                 ├── run bash_script field (if not empty)
                 ├── bash scripts/ (only if run_default_scripts = true)
                 └── psql / mysql migrations
```

Deployments run **in a background thread** so the API returns immediately with a `deployment_id`. Poll the deployment detail endpoint to check status.

---

## Database Models

All models are in `backend/app/models/ci_cd.py`. Tables are auto-created at startup via `Base.metadata.create_all()` in `main.py`.

### `cicd_repos` — Repository Configuration

| Column | Type | Description |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `name` | String | Human-readable label |
| `repo_url` | String | Git remote URL (HTTPS or SSH) |
| `branch` | String | Branch to deploy (default: `main`) |
| `local_path` | String | Absolute path on the target server |
| `server_id` | FK → `cloudpanel_servers.id` | If set, deploy via SSH to this server; `NULL` = local |
| `auth_type` | String | `"https"` or `"ssh"` |
| `ssh_private_key` | Text | PEM private key for SSH git auth |
| `access_token` | String | Personal Access Token for HTTPS git auth |
| `bash_script` | Text | Custom bash script to run after git pull (optional) |
| `run_default_scripts` | Boolean | Whether to run `scripts/*.sh` files from the repo (default: `false`) |
| `db_type` | String | `"postgres"` or `"mysql"` (default: `"postgres"`) |
| `db_host` | String | Database host on the target server (default: `localhost`) |
| `db_port` | Integer | Database port (default: 5432 / 3306) |
| `schedule_enabled` | Boolean | Whether auto-deploy is on |
| `schedule_cron` | String | Cron expression (e.g. `"0 2 * * *"`) |
| `last_deployed_at` | DateTime | Timestamp of most recent deployment |
| `created_at` | DateTime | Row creation timestamp |

### `cicd_deployments` — Deployment Runs

| Column | Type | Description |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `repo_id` | FK → `cicd_repos.id` | Parent repository |
| `status` | String | `"running"` / `"success"` / `"failed"` |
| `triggered_by` | String | `"manual"` / `"scheduled"` |
| `git_output` | Text | Combined stdout/stderr from git operations |
| `error` | Text | Error message if status is `"failed"` |
| `started_at` | DateTime | When the deployment began |
| `finished_at` | DateTime | When the deployment completed |

### `cicd_script_logs` — Script Execution Tracking

Tracks which `.sh` files have been executed for each repo. A script is **never re-run** once it has a record here.

| Column | Type | Description |
|---|---|---|
| `id` | Integer PK | |
| `repo_id` | FK → `cicd_repos.id` | |
| `deployment_id` | FK → `cicd_deployments.id` | |
| `script_filename` | String | e.g. `"01_install.sh"` |
| `exit_code` | Integer | 0 = success |
| `stdout` | Text | Capped at 50 000 chars |
| `stderr` | Text | Capped at 50 000 chars |
| `executed_at` | DateTime | |

**Unique constraint:** `(repo_id, script_filename)` — enforces once-only execution per repo.

### `cicd_migration_logs` — SQL Migration Tracking

Tracks which `.sql` files have been run against each database. A migration is **never re-run** for the same (repo, database, file) combination.

| Column | Type | Description |
|---|---|---|
| `id` | Integer PK | |
| `repo_id` | FK → `cicd_repos.id` | |
| `deployment_id` | FK → `cicd_deployments.id` | |
| `database_name` | String | DB name from `db.csv` |
| `sql_filename` | String | e.g. `"001_create_users.sql"` |
| `status` | String | `"success"` / `"failed"` |
| `error` | Text | Error output if failed |
| `executed_at` | DateTime | |

**Unique constraint:** `(repo_id, database_name, sql_filename)` — enforces once-only per DB per repo.

---

## Repository Structure Convention

The CI/CD manager expects a specific directory layout inside your deployed repository:

```
your-repo/
├── scripts/                  # Shell scripts (run once per repo, alphabetical order)
│   ├── 01_install_deps.sh
│   ├── 02_build.sh
│   └── 03_configure.sh
│
└── database/                 # SQL migrations (run once per DB)
    ├── db.csv                # List of database names to migrate
    ├── 001_create_tables.sql
    ├── 002_add_column.sql
    └── 003_seed_data.sql
```

### `scripts/` directory

- Any `.sh` file in `scripts/` is discovered and sorted **alphabetically**
- Scripts run with `bash` in the `local_path` working directory
- Each script runs **exactly once** per repository (tracked in `cicd_script_logs`)
- To re-run a script, delete its record from `cicd_script_logs`
- Timeout: 600 seconds per script
- stdout/stderr are captured and stored (capped at 50 000 chars each)

### `database/` directory

- **`db.csv`** — comma-separated or newline-separated database names. Example:
  ```
  myapp_production,myapp_staging
  ```
  or:
  ```
  myapp_production
  myapp_staging
  ```
- Any `.sql` file in `database/` is discovered, sorted alphabetically, and applied to **each** database listed in `db.csv`
- Each `(database, sql_file)` pair runs exactly once (tracked in `cicd_migration_logs`)
- If a migration fails, subsequent migrations for that database are stopped
- Timeout: 120 seconds per migration

---

## API Reference

All routes are prefixed `/cicd` and require `Authorization: Bearer <token>` with admin role.

### Servers

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/cicd/servers` | List all CloudPanel servers (read-only, sourced from `cloudpanel_servers`) |
| `GET` | `/cicd/servers/{server_id}/cloudpanel-sites` | SSH into the server and list its CloudPanel sites |

### Repositories (CRUD)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/cicd/repos` | List all repositories |
| `POST` | `/cicd/repos` | Create a new repository config |
| `GET` | `/cicd/repos/{repo_id}` | Get a single repository |
| `PUT` | `/cicd/repos/{repo_id}` | Update a repository |
| `DELETE` | `/cicd/repos/{repo_id}` | Delete a repository (cascades deployments, scripts, migration logs) |

#### Create / Update Payload

```json
{
  "name": "My App",
  "repo_url": "https://github.com/org/repo.git",
  "branch": "main",
  "local_path": "/var/www/myapp",
  "server_id": 1,
  "auth_type": "https",
  "access_token": "ghp_xxxxxxxxxxxx",
  "ssh_private_key": null,
  "bash_script": "#!/bin/bash\nnpm install\nnpm run build",
  "run_default_scripts": false,
  "db_type": "postgres",
  "db_host": "localhost",
  "db_port": 5432,
  "schedule_enabled": false,
  "schedule_cron": null
}
```

> **Security note:** `ssh_private_key` and `access_token` are stored in the database. The response schema masks these fields — it returns `has_ssh_key: true/false` and `has_access_token: true/false` instead of the raw values. Pass a new value to update; omit to keep existing.

### Deployments

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/cicd/repos/{repo_id}/deploy` | Trigger a manual deployment (returns immediately, runs in background) |
| `GET` | `/cicd/repos/{repo_id}/deployments` | List deployments (paginated: `?page=1&page_size=20`) |
| `GET` | `/cicd/repos/{repo_id}/deployments/{dep_id}` | Get deployment detail with nested script + migration logs |

#### Deploy Response

```json
{
  "deployment_id": 42,
  "status": "running"
}
```

#### Deployment Detail Response

```json
{
  "id": 42,
  "repo_id": 1,
  "status": "success",
  "triggered_by": "manual",
  "git_output": "$ git pull/clone on 1.2.3.4\n...",
  "error": null,
  "started_at": "2026-03-14T10:00:00",
  "finished_at": "2026-03-14T10:00:45",
  "script_logs": [
    {
      "id": 5,
      "script_filename": "01_install.sh",
      "exit_code": 0,
      "stdout": "...",
      "stderr": "",
      "executed_at": "2026-03-14T10:00:12"
    }
  ],
  "migration_logs": [
    {
      "id": 3,
      "database_name": "myapp_production",
      "sql_filename": "001_create_tables.sql",
      "status": "success",
      "error": null,
      "executed_at": "2026-03-14T10:00:30"
    }
  ]
}
```

### Log Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/cicd/repos/{repo_id}/script-logs` | All script logs for a repo (most recent first) |
| `GET` | `/cicd/repos/{repo_id}/migration-logs` | All migration logs for a repo (optional `?database_name=mydb`) |

---

## Deployment Pipeline

When a deployment is triggered (manually or by scheduler), it executes in this order:

```
1. CREATE deployment record (status: "running")
2. GIT PULL / CLONE
   └── If .git exists:  git fetch origin <branch> + git reset --hard origin/<branch>
   └── If not:          git clone --branch <branch> --single-branch <url> <path>
3. RUN CUSTOM BASH SCRIPT (bash_script field, if not empty)
   └── Executed in full on every deployment — not idempotent-guarded
4. RUN DEFAULT SCRIPTS (scripts/*.sh, only if run_default_scripts = true)
   └── Alphabetical order, each file runs only once per repo
   └── Skip if already in cicd_script_logs for this repo
5. RUN MIGRATIONS (database/*.sql, alphabetical order, each once per DB)
   └── Read database/db.csv for target DB names
   └── Skip if already in cicd_migration_logs for this (repo, db, file)
6. UPDATE deployment status → "success" or "failed"
7. UPDATE repo.last_deployed_at
```

If **any step fails**, the error is recorded in `deployment.error` and status is set to `"failed"`. Scripts and migrations that were already run before the failure are **not** rolled back.

---

## Git Authentication

### HTTPS (Personal Access Token)

The token is injected into the URL:
```
https://<token>@github.com/org/repo.git
```

Works with GitHub (`ghp_*`), GitLab, Bitbucket, and any standard Git HTTP server.

### SSH (Private Key)

The PEM key is written to a temporary file with `chmod 600`, used via `GIT_SSH_COMMAND`, then deleted. Works with standard RSA/ECDSA/Ed25519 keys.

```bash
GIT_SSH_COMMAND="ssh -i /tmp/cicd_ssh_xxxxx.pem -o StrictHostKeyChecking=no -o BatchMode=yes"
git clone git@github.com:org/repo.git /var/www/myapp
```

### No Auth (Public repos)

Leave `auth_type` as `https` and `access_token` blank. The repo URL is used as-is.

---

## Bash Script (Custom — runs every deploy)

The **Bash Script** field in the repo form lets you write a script inline that runs on **every deployment**, immediately after git pull. Use this for common build steps like installing dependencies or restarting a process.

Example:
```bash
#!/bin/bash
set -e
cd /var/www/myapp
npm install --production
npm run build
pm2 restart myapp || pm2 start ecosystem.config.js
```

**Key behaviour:**
- Runs on **every** deploy (not idempotency-guarded)
- Runs before the `scripts/` directory files
- Script content is base64-encoded and piped to `bash` on remote servers (handles any script content safely)
- Output is appended to `deployment.git_output` under a `--- Custom Script ---` header
- Timeout: 600 seconds
- If the script exits non-zero, the deployment is marked `"failed"` and subsequent steps are skipped

---

## Default Scripts (`scripts/` directory — runs once each)

If **Run Default Scripts** is enabled on the repo, the CI/CD manager also discovers and runs `.sh` files from the `scripts/` directory inside the deployed repo. Each file runs **exactly once** per repository lifetime (tracked in `cicd_script_logs`).

Example `scripts/01_install.sh`:
```bash
#!/bin/bash
set -e
cd /var/www/myapp
npm install --production
```

Example `scripts/02_seed.sh`:
```bash
#!/bin/bash
node /var/www/myapp/seed.js
```

**Important rules:**
- Only runs when **Run Default Scripts** toggle is enabled for the repo
- Scripts run with the SSH user's environment (when remote) or the backend process user (when local)
- Scripts run exactly **once** per repo lifetime. To re-run, delete its record from `cicd_script_logs`
- Timeout is 600 seconds; a timeout results in `exit_code = -1`
- stdout/stderr are captured and stored (capped at 50 000 chars each)

---

## Database Migrations

### `database/db.csv`

List one or more database names (comma or newline separated):
```
myapp_production,myapp_analytics
```

### SQL Files

Named with numeric prefixes for ordering:
```
database/
├── 001_initial_schema.sql
├── 002_add_users_table.sql
└── 003_add_indexes.sql
```

Each `.sql` file is applied to **every** database in `db.csv` exactly once.

### How migrations run (no credentials needed)

Migrations use the OS-level database clients that are already present on the server:

**PostgreSQL:**
```bash
psql -h localhost -p 5432 -d myapp_production -f /var/www/myapp/database/001_initial_schema.sql
```

**MySQL:**
```bash
mysql -h localhost -P 3306 myapp_production < /var/www/myapp/database/001_initial_schema.sql
```

This works because CloudPanel typically configures `psql` / `mysql` with peer authentication or a local trust rule for the site user. No password is required.

### Failure handling

- If a migration fails, that migration's log is recorded as `"failed"` with the error output
- All remaining migrations for that same database are **skipped** (fail-fast per database)
- Other databases in `db.csv` may still have their pending migrations run (each database is processed independently)

---

## Scheduled Deployments

Enable scheduled auto-deployment using a standard cron expression.

### Cron format

```
┌───── minute (0-59)
│ ┌─── hour (0-23)
│ │ ┌─ day of month (1-31)
│ │ │ ┌ month (1-12)
│ │ │ │ ┌ day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

**Examples:**

| Cron | Description |
|---|---|
| `0 2 * * *` | Every day at 2:00 AM |
| `0 */6 * * *` | Every 6 hours |
| `30 3 * * 1` | Every Monday at 3:30 AM |
| `0 0 1 * *` | First of every month at midnight |

### How scheduling works

- Backed by **APScheduler** (`BackgroundScheduler`) initialized in `main.py`
- When a repo is created or updated with `schedule_enabled=true` and a valid `schedule_cron`, the scheduler registers a `CronTrigger` job
- Job ID: `cicd_deploy_{repo_id}` — updates replace the existing job
- When `schedule_enabled=false` or the repo is deleted, the scheduler job is removed
- Scheduled deploys set `triggered_by = "scheduled"` in the deployment record

---

## CloudPanel Integration

The CI/CD system integrates with the CloudPanel server registry (`cloudpanel_servers` table) for remote deployments.

### How it works

1. Go to **Admin → CloudPanel → Servers** and add your server(s)
2. In the CI/CD repo form, select a server from the dropdown
3. The system SSHes into that server using the server's stored SSH key or password
4. All git, script, and migration commands are executed remotely via SSH

### CloudPanel site picker

When you select a server in the repo form, the UI automatically:
1. Calls `GET /cicd/servers/{server_id}/cloudpanel-sites`
2. SSHes into the server and queries the CloudPanel SQLite DB at `/home/cloudpanel/service/cloud-panel.db`
3. Returns a list of sites: `{ domain, path, user }`
4. Clicking a site auto-fills the `local_path` field

### SSH command execution

All remote operations use:
```bash
ssh -o StrictHostKeyChecking=no -o BatchMode=yes -p <port> [-i <key>] user@host '<command>'
```

- `StrictHostKeyChecking=no` — avoids host key prompts
- `BatchMode=yes` — prevents interactive password prompts
- SSH key is written to a temp file with `chmod 600` and deleted after use

---

## Frontend UI

**Route:** `/admin/cicd`

**Source:** `frontend/app/admin/cicd/page.tsx`

### Repository list

The main view shows a table of all configured repositories with:
- Name + git URL
- Branch
- Server (or "Local")
- Auth type (SSH / HTTPS)
- Schedule (cron or —)
- Last deployed timestamp
- Status badge (Never deployed / Deployed)
- Action buttons: **Deploy**, **Logs**, **Edit**, **Delete**

### Add / Edit modal

Fields:
- **Name** — display label
- **Branch** — git branch (default: `main`)
- **Git URL** — HTTPS or SSH remote URL
- **Deployment Server** — dropdown of CloudPanel servers (or "Local")
- **CloudPanel site picker** — appears after selecting a server; click a site to auto-fill the path
- **Local Path** — absolute path on the target server
- **Bash Script** — inline script textarea; runs on every deploy after git pull (leave blank to skip)
- **Run Default Scripts** — toggle to enable running `scripts/*.sh` files from the repo (once each)
- **Git Authentication** — toggle between HTTPS Token and SSH Key
- **Database Migrations** — select PostgreSQL or MySQL
- **Scheduled Deployment** — toggle + cron input

### Deploy button behavior

Clicking **Deploy** calls `POST /cicd/repos/{id}/deploy`, shows a flash message with the deployment ID, then refreshes the repo list. The deployment itself runs in the background.

To view deployment logs, click **Logs** which navigates to `/admin/cicd/{repo_id}`.

---

## Adding a New Repository (Step-by-Step)

### Prerequisites

1. A CloudPanel server must be registered under **Admin → CloudPanel → Servers** (for remote deploys)
2. The SSH user on that server must have:
   - Access to `git`
   - `psql` or `mysql` installed and configured for passwordless local access
   - Write permission to the `local_path` directory

### Step 1: Prepare your repository

Add the required directory structure:
```bash
mkdir -p scripts database
echo "myapp_db" > database/db.csv
# Add your .sh and .sql files
```

Commit and push to your git remote.

### Step 2: Add the repository in the UI

1. Go to **Admin → CI/CD Pipelines**
2. Click **+ Add Repository**
3. Fill in:
   - **Name**: e.g., `My App`
   - **Git URL**: `https://github.com/org/myapp.git`
   - **Branch**: `main`
   - **Server**: select your CloudPanel server
   - **Local Path**: pick from the CloudPanel site picker or type manually, e.g. `/var/www/myapp`
   - **Auth**: select HTTPS and paste your PAT, or select SSH and paste your private key
   - **Bash Script**: (optional) paste your build/restart commands — runs on every deploy
   - **Run Default Scripts**: enable if your repo has a `scripts/` directory with one-time setup scripts
   - **Database Type**: PostgreSQL or MySQL
4. Click **Add Repository**

### Step 3: Deploy

Click **▶ Deploy** next to the repository. A flash message confirms the deployment started. Click **Logs** to watch the result.

---

## Viewing Deployment Logs

Navigate to `/admin/cicd/{repo_id}` to see the full deployment history for a repository.

Each deployment record shows:
- Status badge (running / success / failed)
- Trigger source (manual / scheduled)
- Start and end timestamps
- Git output (fetch + reset output)
- Error message (if failed)

Expand a deployment to see:
- **Script logs** — per-script: filename, exit code, stdout, stderr
- **Migration logs** — per-(database, file): filename, status, error

---

## How Idempotency Works

The CI/CD system is designed to be **safe to run multiple times** without accidentally re-executing one-time operations.

| Operation | Idempotency mechanism |
|---|---|
| `git pull` | Always runs on every deployment — idempotent by nature |
| Custom bash script (`bash_script` field) | **Runs every deployment** — no deduplication; design it to be safe to re-run |
| Default scripts (`scripts/*.sh`) | `cicd_script_logs` unique constraint on `(repo_id, script_filename)` — each file runs once |
| SQL migrations | `cicd_migration_logs` unique constraint on `(repo_id, database_name, sql_filename)` — each file runs once per DB |

**To force a re-run of a script or migration**, delete its record from `cicd_script_logs` or `cicd_migration_logs` directly in the database.

---

## Limitations & Notes

- **Admin only** — there is no per-user or per-team CI/CD access
- **No webhook / push trigger** — deployments must be triggered manually or via cron; there is no GitHub/GitLab webhook receiver
- **No rollback** — the system does not track previous git SHAs or support reverting a deployment
- **No parallel deploys** — each deployment runs sequentially in a thread; there is no queue or lock preventing concurrent deploys for the same repo
- **Script output capped** at 50 000 characters per script (stdout + stderr separately)
- **Migration error cap** at 4 000 characters
- **SSH key for server vs. SSH key for git** — these are separate:
  - Server SSH key: stored in `cloudpanel_servers.ssh_key` — used to SSH into the deployment server
  - Git SSH key: stored in `cicd_repos.ssh_private_key` — used to authenticate with the git remote
- **No Alembic** — migrations here are application-level SQL files you write yourself, not Python migration files
- **DB credentials not stored** — migrations rely on the server's local `psql`/`mysql` peer auth; no DB username/password is stored in the CI/CD config
- **Deployment thread is daemon** — if the server restarts mid-deployment, the deployment record will remain in `"running"` status indefinitely. You must manually update it to `"failed"` if needed.





Git Authentication: HTTPS Token & SSH Key Guide
🔒 HTTPS — Personal Access Token (PAT)
GitHub
Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
https://github.com/settings/tokens

Click "Generate new token (classic)"

Set:

Note: e.g., CI/CD Deploy
Expiration: choose or set "No expiration"
Scopes: check repo (full control of private repos)
Click Generate token — copy it immediately (shown only once)

Token format: ghp_xxxxxxxxxxxxxxxxxxxx

GitLab
Go to GitLab → User Settings → Access Tokens
https://gitlab.com/-/profile/personal_access_tokens

Set name, expiry, and scopes: read_repository + write_repository

Click Create personal access token — copy it

Bitbucket
Go to Bitbucket → Personal Settings → App passwords
https://bitbucket.org/account/settings/app-passwords/

Click Create app password, check Repositories: Read + Write

Use your Bitbucket username as the username and the app password as the token

🔑 SSH — Private Key
Step 1: Generate the key pair
# Ed25519 (recommended, modern)
ssh-keygen -t ed25519 -C "cicd-deploy" -f ~/.ssh/cicd_deploy

# RSA (fallback for older servers)
ssh-keygen -t rsa -b 4096 -C "cicd-deploy" -f ~/.ssh/cicd_deploy

When asked for a passphrase — press Enter (leave empty, CI/CD needs no passphrase)
This creates two files:
~/.ssh/cicd_deploy → private key (paste this into the CI/CD form)
~/.ssh/cicd_deploy.pub → public key (add this to GitHub/GitLab)
Step 2: Add the public key to your Git provider
GitHub:

Go to your repo → Settings → Deploy keys → Add deploy key
Paste the contents of ~/.ssh/cicd_deploy.pub
Check Allow write access if you need push
Click Add key
Or use a user-level key: GitHub → Settings → SSH and GPG keys → New SSH key

GitLab:

Go to your repo → Settings → Repository → Deploy keys
Paste the public key contents
Bitbucket:

Go to repo → Repository settings → Access keys → Add key
Paste the public key contents
Step 3: Copy the private key for the CI/CD form
cat ~/.ssh/cicd_deploy

Copy the entire output including headers:

-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAA...
...
-----END OPENSSH PRIVATE KEY-----

Paste this into the SSH Private Key field in the CI/CD repo form.

Quick Comparison
HTTPS Token	SSH Key
Ease of setup	✅ Easier	Slightly more steps
Security	✅ Good (expiry support)	✅ Good (key-based)
Token/key rotation	Manual (update token in form)	Manual (rotate key pair)
Best for	GitHub/GitLab public repos	Private servers, self-hosted Git
URL format	https://github.com/org/repo.git	git@github.com:org/repo.git
✅ Tips
Use SSH for private/self-hosted repos — no token expiry to manage
Use HTTPS for simplicity — easy to rotate via GitHub UI
Never commit private keys — only paste them into the CI/CD form, they're stored encrypted in the DB
Deploy keys are repo-scoped (recommended) vs. user-level keys which have broader access
When editing a repo in CI/CD, leave the token/key field blank to keep the existing stored value