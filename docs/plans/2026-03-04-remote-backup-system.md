# Remote Backup System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a remote server backup system (DB + files for CloudPanel servers, local app DB) with multiple destination types (SFTP, SCP, S3, Google Drive, OneDrive, local), scheduled + manual triggers, retention policies, and failure email alerts — all manageable from the admin UI.

**Architecture:** Plugin-based destination architecture. A `BackupEngine` orchestrates SSH-based backup creation (reusing existing paramiko/`CloudPanelService` pattern), then delegates storage to a `BaseDestination` subclass. `BackupJob` rows drive APScheduler, `BackupRun` rows log every execution.

**Tech Stack:** FastAPI, SQLAlchemy, paramiko (SSH/SFTP, already installed), boto3 (S3), google-api-python-client + google-auth-oauthlib (Google Drive), msal (OneDrive), APScheduler (already in main.py), Next.js 14, TailwindCSS

> **No test framework.** This project has no pytest/Jest setup. Verification steps use Swagger UI at http://localhost:8000/docs and manual UI checks.

---

## Task 1: SQLAlchemy Models

**Files:**
- Create: `backend/app/models/backup_destination.py`
- Create: `backend/app/models/backup_job.py`
- Create: `backend/app/models/backup_run.py`

**Step 1: Create BackupDestination model**

```python
# backend/app/models/backup_destination.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base

class BackupDestination(Base):
    __tablename__ = "backup_destinations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # local|sftp|scp|s3|google_drive|onedrive
    config = Column(JSON, nullable=False, default={})
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
```

**Step 2: Create BackupJob model**

```python
# backend/app/models/backup_job.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class BackupJob(Base):
    __tablename__ = "backup_jobs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

    # Source
    source_type = Column(String, nullable=False)  # cloudpanel_server | local_app
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id"), nullable=True)
    backup_scope = Column(String, default="both")  # db | files | both

    # Destination
    destination_id = Column(Integer, ForeignKey("backup_destinations.id"), nullable=False)

    # Schedule
    schedule_type = Column(String, default="manual")  # manual | interval | cron
    schedule_interval_hours = Column(Integer, nullable=True)
    schedule_cron = Column(String, nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)

    # Retention
    retention_max_count = Column(Integer, nullable=True)
    retention_max_days = Column(Integer, nullable=True)

    # Notifications
    notify_on_failure_emails = Column(JSON, default=list)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    destination = relationship("BackupDestination", foreign_keys=[destination_id])
    server = relationship("CloudPanelServer", foreign_keys=[server_id])
```

**Step 3: Create BackupRun model**

```python
# backend/app/models/backup_run.py
from sqlalchemy import Column, Integer, String, DateTime, BigInteger, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class BackupRun(Base):
    __tablename__ = "backup_runs"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("backup_jobs.id"), nullable=False)
    status = Column(String, default="running")  # running | success | failed
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    file_size_bytes = Column(BigInteger, nullable=True)
    backup_file_path = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)

    job = relationship("BackupJob", foreign_keys=[job_id])
```

**Step 4: Commit**

```bash
git add backend/app/models/backup_destination.py backend/app/models/backup_job.py backend/app/models/backup_run.py
git commit -m "feat: add BackupDestination, BackupJob, BackupRun SQLAlchemy models"
```

---

## Task 2: Inline SQL Migrations + Table Registration in main.py

**Files:**
- Modify: `backend/main.py`

**Step 1: Import the new models** (so `Base.metadata.create_all()` picks them up)

Find the block of model imports near the top of main.py (look for lines like `from app.models.db_migration import ...`). Add after them:

```python
from app.models.backup_destination import BackupDestination  # noqa: F401
from app.models.backup_job import BackupJob  # noqa: F401
from app.models.backup_run import BackupRun  # noqa: F401
```

**Step 2: Add inline SQL migration** for any future column additions

Find the section in main.py where inline `text()` migrations run (search for `IF NOT EXISTS` in main.py — it will be inside a startup function). Add this block:

```python
# Backup system tables — created via ORM but guard extra columns here
with engine.connect() as conn:
    conn.execute(text("""
        ALTER TABLE backup_jobs
        ADD COLUMN IF NOT EXISTS notify_on_failure_emails JSON DEFAULT '[]'::json
    """))
    conn.commit()
```

**Step 3: Verify tables exist**

Start backend: `cd backend && source venv/bin/activate && uvicorn main:app --reload`

Check logs — should see no errors. Then confirm in psql:
```sql
\dt backup_*
```
Expected: `backup_destinations`, `backup_jobs`, `backup_runs`

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: register backup models and inline SQL migration"
```

---

## Task 3: Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/backup.py`

**Step 1: Write schemas**

```python
# backend/app/schemas/backup.py
from pydantic import BaseModel
from typing import Optional, Any, List
from datetime import datetime


# ── Destination ────────────────────────────────────────────────────────────────

class BackupDestinationCreate(BaseModel):
    name: str
    type: str  # local|sftp|scp|s3|google_drive|onedrive
    config: dict[str, Any] = {}
    is_active: bool = True

class BackupDestinationUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    config: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None

class BackupDestinationResponse(BaseModel):
    id: int
    name: str
    type: str
    config: dict[str, Any]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Job ────────────────────────────────────────────────────────────────────────

class BackupJobCreate(BaseModel):
    name: str
    source_type: str  # cloudpanel_server | local_app
    server_id: Optional[int] = None
    backup_scope: str = "both"  # db | files | both
    destination_id: int
    schedule_type: str = "manual"  # manual | interval | cron
    schedule_interval_hours: Optional[int] = None
    schedule_cron: Optional[str] = None
    retention_max_count: Optional[int] = None
    retention_max_days: Optional[int] = None
    notify_on_failure_emails: List[str] = []
    is_active: bool = True

class BackupJobUpdate(BaseModel):
    name: Optional[str] = None
    source_type: Optional[str] = None
    server_id: Optional[int] = None
    backup_scope: Optional[str] = None
    destination_id: Optional[int] = None
    schedule_type: Optional[str] = None
    schedule_interval_hours: Optional[int] = None
    schedule_cron: Optional[str] = None
    retention_max_count: Optional[int] = None
    retention_max_days: Optional[int] = None
    notify_on_failure_emails: Optional[List[str]] = None
    is_active: Optional[bool] = None

class BackupJobResponse(BaseModel):
    id: int
    name: str
    is_active: bool
    source_type: str
    server_id: Optional[int]
    backup_scope: str
    destination_id: int
    schedule_type: str
    schedule_interval_hours: Optional[int]
    schedule_cron: Optional[str]
    next_run_at: Optional[datetime]
    retention_max_count: Optional[int]
    retention_max_days: Optional[int]
    notify_on_failure_emails: List[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Run ────────────────────────────────────────────────────────────────────────

class BackupRunResponse(BaseModel):
    id: int
    job_id: int
    status: str
    started_at: datetime
    finished_at: Optional[datetime]
    file_size_bytes: Optional[int]
    backup_file_path: Optional[str]
    error_message: Optional[str]

    class Config:
        from_attributes = True


# ── Test connection ────────────────────────────────────────────────────────────

class DestinationTestRequest(BaseModel):
    type: str
    config: dict[str, Any]
```

**Step 2: Commit**

```bash
git add backend/app/schemas/backup.py
git commit -m "feat: add Pydantic schemas for backup system"
```

---

## Task 4: BaseDestination Interface + Local Plugin

**Files:**
- Create: `backend/app/services/destinations/__init__.py`
- Create: `backend/app/services/destinations/base.py`
- Create: `backend/app/services/destinations/local.py`

**Step 1: Create package init**

```python
# backend/app/services/destinations/__init__.py
```

**Step 2: Create BaseDestination**

```python
# backend/app/services/destinations/base.py
from abc import ABC, abstractmethod
from typing import List


class BaseDestination(ABC):
    """All destination plugins implement this interface."""

    @abstractmethod
    def upload(self, local_path: str, remote_filename: str) -> str:
        """Upload file to destination. Returns path/URL where file was stored."""
        raise NotImplementedError

    @abstractmethod
    def delete(self, remote_path: str) -> None:
        """Delete a backup file at the given remote path."""
        raise NotImplementedError

    @abstractmethod
    def list_backups(self, prefix: str) -> List[str]:
        """List backup file paths for a given job prefix (for retention cleanup)."""
        raise NotImplementedError

    @abstractmethod
    def test_connection(self) -> bool:
        """Test that credentials/connection work. Raises on failure."""
        raise NotImplementedError


def get_destination(destination_type: str, config: dict) -> BaseDestination:
    """Factory: return the correct destination plugin for a given type."""
    if destination_type == "local":
        from app.services.destinations.local import LocalDestination
        return LocalDestination(config)
    elif destination_type == "sftp":
        from app.services.destinations.sftp import SftpDestination
        return SftpDestination(config)
    elif destination_type == "scp":
        from app.services.destinations.scp import ScpDestination
        return ScpDestination(config)
    elif destination_type == "s3":
        from app.services.destinations.s3 import S3Destination
        return S3Destination(config)
    elif destination_type == "google_drive":
        from app.services.destinations.google_drive import GoogleDriveDestination
        return GoogleDriveDestination(config)
    elif destination_type == "onedrive":
        from app.services.destinations.onedrive import OneDriveDestination
        return OneDriveDestination(config)
    else:
        raise ValueError(f"Unknown destination type: {destination_type}")
```

**Step 3: Create LocalDestination**

```python
# backend/app/services/destinations/local.py
import os
import shutil
from typing import List
from app.services.destinations.base import BaseDestination


class LocalDestination(BaseDestination):
    def __init__(self, config: dict):
        self.path = config.get("path", "/var/backups/socialmedia")

    def upload(self, local_path: str, remote_filename: str) -> str:
        os.makedirs(self.path, exist_ok=True)
        dest = os.path.join(self.path, remote_filename)
        shutil.copy2(local_path, dest)
        return dest

    def delete(self, remote_path: str) -> None:
        if os.path.exists(remote_path):
            os.remove(remote_path)

    def list_backups(self, prefix: str) -> List[str]:
        if not os.path.exists(self.path):
            return []
        return sorted([
            os.path.join(self.path, f)
            for f in os.listdir(self.path)
            if f.startswith(prefix)
        ])

    def test_connection(self) -> bool:
        os.makedirs(self.path, exist_ok=True)
        test_file = os.path.join(self.path, ".test_write")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return True
```

**Step 4: Commit**

```bash
git add backend/app/services/destinations/
git commit -m "feat: add BaseDestination interface and LocalDestination plugin"
```

---

## Task 5: SFTP and SCP Destination Plugins

**Files:**
- Create: `backend/app/services/destinations/sftp.py`
- Create: `backend/app/services/destinations/scp.py`

**Step 1: Create SftpDestination**

```python
# backend/app/services/destinations/sftp.py
import os
from io import StringIO
from typing import List
import paramiko
from app.services.destinations.base import BaseDestination


class SftpDestination(BaseDestination):
    def __init__(self, config: dict):
        self.host = config["host"]
        self.port = int(config.get("port", 22))
        self.username = config["username"]
        self.password = config.get("password")
        self.ssh_key = config.get("ssh_key")
        self.remote_path = config.get("remote_path", "/backups")

    def _get_client(self) -> paramiko.SFTPClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {"hostname": self.host, "port": self.port, "username": self.username}
        if self.ssh_key:
            pkey = paramiko.RSAKey.from_private_key(StringIO(self.ssh_key))
            kwargs["pkey"] = pkey
        else:
            kwargs["password"] = self.password
        client.connect(**kwargs)
        return client.open_sftp(), client

    def upload(self, local_path: str, remote_filename: str) -> str:
        sftp, ssh = self._get_client()
        try:
            try:
                sftp.mkdir(self.remote_path)
            except OSError:
                pass
            remote_full = f"{self.remote_path}/{remote_filename}"
            sftp.put(local_path, remote_full)
            return remote_full
        finally:
            sftp.close()
            ssh.close()

    def delete(self, remote_path: str) -> None:
        sftp, ssh = self._get_client()
        try:
            sftp.remove(remote_path)
        finally:
            sftp.close()
            ssh.close()

    def list_backups(self, prefix: str) -> List[str]:
        sftp, ssh = self._get_client()
        try:
            files = sftp.listdir(self.remote_path)
            return sorted([
                f"{self.remote_path}/{f}" for f in files if f.startswith(prefix)
            ])
        finally:
            sftp.close()
            ssh.close()

    def test_connection(self) -> bool:
        sftp, ssh = self._get_client()
        sftp.close()
        ssh.close()
        return True
```

**Step 2: Create ScpDestination**

SCP uses paramiko's `exec_command` since there's no native SCP client in paramiko:

```python
# backend/app/services/destinations/scp.py
import os
from io import StringIO
from typing import List
import paramiko
from app.services.destinations.base import BaseDestination


class ScpDestination(BaseDestination):
    def __init__(self, config: dict):
        self.host = config["host"]
        self.port = int(config.get("port", 22))
        self.username = config["username"]
        self.password = config.get("password")
        self.ssh_key = config.get("ssh_key")
        self.remote_path = config.get("remote_path", "/backups")

    def _get_ssh(self) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {"hostname": self.host, "port": self.port, "username": self.username}
        if self.ssh_key:
            pkey = paramiko.RSAKey.from_private_key(StringIO(self.ssh_key))
            kwargs["pkey"] = pkey
        else:
            kwargs["password"] = self.password
        client.connect(**kwargs)
        return client

    def upload(self, local_path: str, remote_filename: str) -> str:
        # Use SFTP channel for reliable file transfer (SCP protocol is not standardized)
        ssh = self._get_ssh()
        try:
            sftp = ssh.open_sftp()
            ssh.exec_command(f"mkdir -p {self.remote_path}")
            remote_full = f"{self.remote_path}/{remote_filename}"
            sftp.put(local_path, remote_full)
            sftp.close()
            return remote_full
        finally:
            ssh.close()

    def delete(self, remote_path: str) -> None:
        ssh = self._get_ssh()
        try:
            ssh.exec_command(f"rm -f {remote_path}")
        finally:
            ssh.close()

    def list_backups(self, prefix: str) -> List[str]:
        ssh = self._get_ssh()
        try:
            stdin, stdout, stderr = ssh.exec_command(
                f"ls {self.remote_path}/{prefix}* 2>/dev/null || true"
            )
            output = stdout.read().decode().strip()
            return sorted(output.splitlines()) if output else []
        finally:
            ssh.close()

    def test_connection(self) -> bool:
        ssh = self._get_ssh()
        ssh.close()
        return True
```

**Step 3: Commit**

```bash
git add backend/app/services/destinations/sftp.py backend/app/services/destinations/scp.py
git commit -m "feat: add SFTP and SCP destination plugins"
```

---

## Task 6: S3 Destination Plugin

**Files:**
- Create: `backend/app/services/destinations/s3.py`

**Step 1: Install boto3**

```bash
cd backend && source venv/bin/activate && pip install boto3
```

Add `boto3` to `backend/requirements.txt`.

**Step 2: Create S3Destination**

```python
# backend/app/services/destinations/s3.py
from typing import List
from app.services.destinations.base import BaseDestination


class S3Destination(BaseDestination):
    def __init__(self, config: dict):
        self.bucket = config["bucket"]
        self.prefix = config.get("prefix", "backups")
        self.region = config.get("region", "us-east-1")
        self.access_key = config["access_key"]
        self.secret_key = config["secret_key"]
        self.endpoint_url = config.get("endpoint_url")  # for R2/MinIO

    def _get_client(self):
        import boto3
        kwargs = {
            "aws_access_key_id": self.access_key,
            "aws_secret_access_key": self.secret_key,
            "region_name": self.region,
        }
        if self.endpoint_url:
            kwargs["endpoint_url"] = self.endpoint_url
        return boto3.client("s3", **kwargs)

    def upload(self, local_path: str, remote_filename: str) -> str:
        s3 = self._get_client()
        key = f"{self.prefix}/{remote_filename}"
        s3.upload_file(local_path, self.bucket, key)
        return f"s3://{self.bucket}/{key}"

    def delete(self, remote_path: str) -> None:
        # remote_path is "s3://bucket/prefix/file" — strip prefix
        key = remote_path.replace(f"s3://{self.bucket}/", "")
        s3 = self._get_client()
        s3.delete_object(Bucket=self.bucket, Key=key)

    def list_backups(self, prefix: str) -> List[str]:
        s3 = self._get_client()
        resp = s3.list_objects_v2(Bucket=self.bucket, Prefix=f"{self.prefix}/{prefix}")
        contents = resp.get("Contents", [])
        return sorted([f"s3://{self.bucket}/{obj['Key']}" for obj in contents])

    def test_connection(self) -> bool:
        s3 = self._get_client()
        s3.head_bucket(Bucket=self.bucket)
        return True
```

**Step 3: Commit**

```bash
git add backend/app/services/destinations/s3.py backend/requirements.txt
git commit -m "feat: add S3 destination plugin (supports AWS S3, R2, MinIO)"
```

---

## Task 7: Google Drive Destination Plugin

**Files:**
- Create: `backend/app/services/destinations/google_drive.py`

**Step 1: Install Google Drive libraries**

```bash
cd backend && source venv/bin/activate && pip install google-api-python-client google-auth-oauthlib google-auth-httplib2
```

Add to `backend/requirements.txt`:
```
google-api-python-client
google-auth-oauthlib
google-auth-httplib2
```

**Step 2: Create GoogleDriveDestination**

```python
# backend/app/services/destinations/google_drive.py
import os
from typing import List
from app.services.destinations.base import BaseDestination


class GoogleDriveDestination(BaseDestination):
    def __init__(self, config: dict):
        self.folder_id = config.get("folder_id", "root")
        self.oauth_token = config.get("oauth_token")  # JSON string of token dict

    def _get_service(self):
        import json
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        token_data = json.loads(self.oauth_token) if isinstance(self.oauth_token, str) else self.oauth_token
        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=["https://www.googleapis.com/auth/drive.file"],
        )
        return build("drive", "v3", credentials=creds)

    def upload(self, local_path: str, remote_filename: str) -> str:
        from googleapiclient.http import MediaFileUpload
        service = self._get_service()
        meta = {"name": remote_filename, "parents": [self.folder_id]}
        media = MediaFileUpload(local_path, resumable=True)
        file = service.files().create(body=meta, media_body=media, fields="id").execute()
        return f"gdrive://{file['id']}"

    def delete(self, remote_path: str) -> None:
        file_id = remote_path.replace("gdrive://", "")
        service = self._get_service()
        service.files().delete(fileId=file_id).execute()

    def list_backups(self, prefix: str) -> List[str]:
        service = self._get_service()
        query = f"'{self.folder_id}' in parents and name contains '{prefix}' and trashed=false"
        resp = service.files().list(q=query, fields="files(id,name)").execute()
        return sorted([f"gdrive://{f['id']}" for f in resp.get("files", [])])

    def test_connection(self) -> bool:
        service = self._get_service()
        service.files().get(fileId=self.folder_id).execute()
        return True
```

**Step 3: Commit**

```bash
git add backend/app/services/destinations/google_drive.py backend/requirements.txt
git commit -m "feat: add Google Drive destination plugin"
```

---

## Task 8: OneDrive Destination Plugin

**Files:**
- Create: `backend/app/services/destinations/onedrive.py`

**Step 1: Install MSAL**

```bash
cd backend && source venv/bin/activate && pip install msal requests
```

Add `msal` to `backend/requirements.txt`.

**Step 2: Create OneDriveDestination**

```python
# backend/app/services/destinations/onedrive.py
import os
import json
import requests
from typing import List
from app.services.destinations.base import BaseDestination

GRAPH_API = "https://graph.microsoft.com/v1.0"


class OneDriveDestination(BaseDestination):
    def __init__(self, config: dict):
        self.folder_path = config.get("folder_path", "/backups")
        self.oauth_token = config.get("oauth_token")  # JSON string

    def _get_token(self) -> str:
        token_data = json.loads(self.oauth_token) if isinstance(self.oauth_token, str) else self.oauth_token
        return token_data["access_token"]

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._get_token()}"}

    def upload(self, local_path: str, remote_filename: str) -> str:
        remote = f"{self.folder_path}/{remote_filename}"
        url = f"{GRAPH_API}/me/drive/root:{remote}:/content"
        with open(local_path, "rb") as f:
            resp = requests.put(url, headers={**self._headers(), "Content-Type": "application/octet-stream"}, data=f)
        resp.raise_for_status()
        item_id = resp.json()["id"]
        return f"onedrive://{item_id}"

    def delete(self, remote_path: str) -> None:
        item_id = remote_path.replace("onedrive://", "")
        url = f"{GRAPH_API}/me/drive/items/{item_id}"
        resp = requests.delete(url, headers=self._headers())
        resp.raise_for_status()

    def list_backups(self, prefix: str) -> List[str]:
        url = f"{GRAPH_API}/me/drive/root:{self.folder_path}:/children"
        resp = requests.get(url, headers=self._headers())
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        items = resp.json().get("value", [])
        return sorted([f"onedrive://{i['id']}" for i in items if i["name"].startswith(prefix)])

    def test_connection(self) -> bool:
        url = f"{GRAPH_API}/me/drive"
        resp = requests.get(url, headers=self._headers())
        resp.raise_for_status()
        return True
```

**Step 3: Commit**

```bash
git add backend/app/services/destinations/onedrive.py backend/requirements.txt
git commit -m "feat: add OneDrive destination plugin"
```

---

## Task 9: BackupEngine Service

**Files:**
- Create: `backend/app/services/backup_engine.py`

**Step 1: Write BackupEngine**

```python
# backend/app/services/backup_engine.py
import os
import logging
import tempfile
import subprocess
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from app.models.backup_job import BackupJob
from app.models.backup_run import BackupRun
from app.models.backup_destination import BackupDestination
from app.models.cloudpanel_server import CloudPanelServer
from app.services.destinations.base import get_destination
from app.services.email_service import email_service

logger = logging.getLogger(__name__)


class BackupEngine:

    def run(self, job_id: int, db: Session) -> BackupRun:
        job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
        if not job:
            raise ValueError(f"BackupJob {job_id} not found")

        run = BackupRun(job_id=job.id, status="running", started_at=datetime.now(timezone.utc))
        db.add(run)
        db.commit()
        db.refresh(run)

        try:
            destination_obj = db.query(BackupDestination).filter(BackupDestination.id == job.destination_id).first()
            plugin = get_destination(destination_obj.type, destination_obj.config)

            with tempfile.TemporaryDirectory() as tmpdir:
                files = self._create_backup_files(job, db, tmpdir)
                timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
                prefix = f"job{job.id}"

                total_size = 0
                last_remote_path = None
                for local_path in files:
                    filename = f"{prefix}_{timestamp}_{os.path.basename(local_path)}"
                    remote_path = plugin.upload(local_path, filename)
                    last_remote_path = remote_path
                    total_size += os.path.getsize(local_path)

            self._apply_retention(job, plugin, prefix)

            run.status = "success"
            run.finished_at = datetime.now(timezone.utc)
            run.file_size_bytes = total_size
            run.backup_file_path = last_remote_path
            db.commit()

        except Exception as e:
            logger.error(f"Backup job {job.id} failed: {e}")
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.error_message = str(e)
            db.commit()
            self._notify_failure(job, str(e))

        return run

    def _create_backup_files(self, job: BackupJob, db: Session, tmpdir: str) -> list[str]:
        if job.source_type == "local_app":
            return self._backup_local_app(tmpdir)
        else:
            server = db.query(CloudPanelServer).filter(CloudPanelServer.id == job.server_id).first()
            if not server:
                raise ValueError(f"Server {job.server_id} not found")
            return self._backup_cloudpanel_server(server, job.backup_scope, tmpdir)

    def _backup_local_app(self, tmpdir: str) -> list[str]:
        from app.config import settings
        db_url = settings.database_url
        out_path = os.path.join(tmpdir, "app_db.sql")
        result = subprocess.run(
            ["pg_dump", db_url, "-f", out_path],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise Exception(f"pg_dump failed: {result.stderr}")
        return [out_path]

    def _backup_cloudpanel_server(self, server: CloudPanelServer, scope: str, tmpdir: str) -> list[str]:
        import paramiko
        from io import StringIO

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        kwargs = {"hostname": server.host, "port": server.ssh_port, "username": server.ssh_user}
        if server.ssh_key:
            pkey = paramiko.RSAKey.from_private_key(StringIO(server.ssh_key))
            kwargs["pkey"] = pkey
        else:
            kwargs["password"] = server.ssh_password
        ssh.connect(**kwargs)

        files = []
        try:
            if scope in ("db", "both"):
                remote_db = f"/tmp/backup_db_{server.id}.sql"
                self._exec(ssh, f"mysqldump -u root --all-databases > {remote_db}")
                local_db = os.path.join(tmpdir, f"db_{server.id}.sql")
                ssh.open_sftp().get(remote_db, local_db)
                self._exec(ssh, f"rm -f {remote_db}")
                files.append(local_db)

            if scope in ("files", "both"):
                remote_tar = f"/tmp/backup_files_{server.id}.tar.gz"
                self._exec(ssh, f"tar -czf {remote_tar} /home/*/htdocs/ 2>/dev/null || true")
                local_tar = os.path.join(tmpdir, f"files_{server.id}.tar.gz")
                ssh.open_sftp().get(remote_tar, local_tar)
                self._exec(ssh, f"rm -f {remote_tar}")
                files.append(local_tar)
        finally:
            ssh.close()

        return files

    def _exec(self, ssh, command: str) -> str:
        stdin, stdout, stderr = ssh.exec_command(command)
        exit_code = stdout.channel.recv_exit_status()
        out = stdout.read().decode()
        err = stderr.read().decode()
        if exit_code != 0:
            raise Exception(f"Command failed ({exit_code}): {err}")
        return out

    def _apply_retention(self, job: BackupJob, plugin, prefix: str) -> None:
        if not job.retention_max_count and not job.retention_max_days:
            return

        backups = plugin.list_backups(prefix)

        if job.retention_max_count and len(backups) > job.retention_max_count:
            to_delete = backups[: len(backups) - job.retention_max_count]
            for path in to_delete:
                try:
                    plugin.delete(path)
                except Exception as e:
                    logger.warning(f"Retention delete failed for {path}: {e}")

    def _notify_failure(self, job: BackupJob, error: str) -> None:
        emails = job.notify_on_failure_emails or []
        if not emails:
            return
        subject = f"[Backup Failed] {job.name}"
        body = f"Backup job '{job.name}' failed.\n\nError:\n{error}"
        for email in emails:
            try:
                email_service.send_email(to=email, subject=subject, body=body)
            except Exception as e:
                logger.warning(f"Failed to send failure notification to {email}: {e}")


backup_engine = BackupEngine()
```

**Step 2: Commit**

```bash
git add backend/app/services/backup_engine.py
git commit -m "feat: add BackupEngine service (SSH dump, destination upload, retention, failure notify)"
```

---

## Task 10: API Routes — Destinations CRUD

**Files:**
- Create: `backend/app/routes/backups.py`

**Step 1: Create routes file with Destination endpoints**

```python
# backend/app/routes/backups.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.dependencies import get_admin_user
from app.models.user import User
from app.models.backup_destination import BackupDestination
from app.models.backup_job import BackupJob
from app.models.backup_run import BackupRun
from app.schemas.backup import (
    BackupDestinationCreate, BackupDestinationUpdate, BackupDestinationResponse,
    BackupJobCreate, BackupJobUpdate, BackupJobResponse,
    BackupRunResponse, DestinationTestRequest
)

router = APIRouter(prefix="/backups", tags=["Backups"])


# ── Destinations ──────────────────────────────────────────────────────────────

@router.get("/destinations", response_model=List[BackupDestinationResponse])
def list_destinations(db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    return db.query(BackupDestination).all()


@router.post("/destinations", response_model=BackupDestinationResponse)
def create_destination(data: BackupDestinationCreate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    dest = BackupDestination(**data.model_dump())
    db.add(dest)
    db.commit()
    db.refresh(dest)
    return dest


@router.put("/destinations/{dest_id}", response_model=BackupDestinationResponse)
def update_destination(dest_id: int, data: BackupDestinationUpdate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    dest = db.query(BackupDestination).filter(BackupDestination.id == dest_id).first()
    if not dest:
        raise HTTPException(status_code=404, detail="Destination not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(dest, k, v)
    db.commit()
    db.refresh(dest)
    return dest


@router.delete("/destinations/{dest_id}")
def delete_destination(dest_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    dest = db.query(BackupDestination).filter(BackupDestination.id == dest_id).first()
    if not dest:
        raise HTTPException(status_code=404, detail="Destination not found")
    db.delete(dest)
    db.commit()
    return {"ok": True}


@router.post("/destinations/test")
def test_destination(data: DestinationTestRequest, admin: User = Depends(get_admin_user)):
    from app.services.destinations.base import get_destination
    try:
        plugin = get_destination(data.type, data.config)
        plugin.test_connection()
        return {"ok": True, "message": "Connection successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
```

**Step 2: Register router in main.py**

Find the imports block in `main.py` where other routes are imported, add:
```python
from app.routes.backups import router as backups_router
```

Find the `app.include_router(...)` block, add:
```python
app.include_router(backups_router)
```

**Step 3: Verify via Swagger**

Start backend, open http://localhost:8000/docs, find `POST /backups/destinations`, create a local destination:
```json
{ "name": "Local Test", "type": "local", "config": { "path": "/tmp/test_backups" } }
```
Expected: 200 with `id` field.

**Step 4: Commit**

```bash
git add backend/app/routes/backups.py backend/main.py
git commit -m "feat: add backup destination CRUD routes and register router"
```

---

## Task 11: API Routes — Jobs CRUD + Manual Trigger

**Files:**
- Modify: `backend/app/routes/backups.py`

**Step 1: Add Job routes to backups.py**

Append to `backend/app/routes/backups.py`:

```python
# ── Jobs ──────────────────────────────────────────────────────────────────────

from datetime import datetime, timezone
from croniter import croniter


def _compute_next_run(job: BackupJob) -> datetime | None:
    if job.schedule_type == "manual":
        return None
    elif job.schedule_type == "interval" and job.schedule_interval_hours:
        from datetime import timedelta
        return datetime.now(timezone.utc) + timedelta(hours=job.schedule_interval_hours)
    elif job.schedule_type == "cron" and job.schedule_cron:
        return croniter(job.schedule_cron, datetime.now(timezone.utc)).get_next(datetime)
    return None


@router.get("/jobs", response_model=List[BackupJobResponse])
def list_jobs(db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    return db.query(BackupJob).all()


@router.post("/jobs", response_model=BackupJobResponse)
def create_job(data: BackupJobCreate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    job = BackupJob(**data.model_dump())
    job.next_run_at = _compute_next_run(job)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.put("/jobs/{job_id}", response_model=BackupJobResponse)
def update_job(job_id: int, data: BackupJobUpdate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(job, k, v)
    job.next_run_at = _compute_next_run(job)
    db.commit()
    db.refresh(job)
    return job


@router.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"ok": True}


@router.post("/jobs/{job_id}/run", response_model=BackupRunResponse)
def run_job_now(job_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    from app.services.backup_engine import backup_engine
    job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    run = backup_engine.run(job_id, db)
    return run
```

**Step 2: Install croniter**

```bash
cd backend && source venv/bin/activate && pip install croniter
```

Add `croniter` to `backend/requirements.txt`.

**Step 3: Verify via Swagger**

Open http://localhost:8000/docs, `POST /backups/jobs`:
```json
{
  "name": "Test Local Backup",
  "source_type": "local_app",
  "backup_scope": "db",
  "destination_id": 1,
  "schedule_type": "manual"
}
```
Expected: 200 with `id` and `next_run_at: null`.

**Step 4: Commit**

```bash
git add backend/app/routes/backups.py backend/requirements.txt
git commit -m "feat: add backup job CRUD routes and manual trigger endpoint"
```

---

## Task 12: API Routes — History

**Files:**
- Modify: `backend/app/routes/backups.py`

**Step 1: Add history routes**

Append to `backend/app/routes/backups.py`:

```python
# ── Runs / History ────────────────────────────────────────────────────────────

@router.get("/runs", response_model=List[BackupRunResponse])
def list_all_runs(
    job_id: int | None = None,
    status: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    q = db.query(BackupRun)
    if job_id:
        q = q.filter(BackupRun.job_id == job_id)
    if status:
        q = q.filter(BackupRun.status == status)
    return q.order_by(BackupRun.started_at.desc()).limit(limit).all()


@router.get("/jobs/{job_id}/runs", response_model=List[BackupRunResponse])
def list_job_runs(job_id: int, limit: int = 20, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    return db.query(BackupRun).filter(BackupRun.job_id == job_id).order_by(BackupRun.started_at.desc()).limit(limit).all()


@router.get("/runs/{run_id}", response_model=BackupRunResponse)
def get_run(run_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    run = db.query(BackupRun).filter(BackupRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
```

**Step 2: Commit**

```bash
git add backend/app/routes/backups.py
git commit -m "feat: add backup history routes"
```

---

## Task 13: APScheduler Integration

**Files:**
- Modify: `backend/main.py`

**Step 1: Add backup scheduler function**

Find the `init_scheduler` function in main.py. Before `scheduler.start()`, add:

```python
def run_due_backup_jobs():
    """Poll BackupJob table every minute and run any jobs whose next_run_at is due."""
    from app.database import SessionLocal
    from app.models.backup_job import BackupJob
    from app.services.backup_engine import backup_engine
    from datetime import datetime, timezone

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due_jobs = db.query(BackupJob).filter(
            BackupJob.is_active == True,
            BackupJob.next_run_at != None,
            BackupJob.next_run_at <= now
        ).all()
        for job in due_jobs:
            try:
                backup_engine.run(job.id, db)
                # Update next_run_at
                from croniter import croniter
                from datetime import timedelta
                if job.schedule_type == "interval" and job.schedule_interval_hours:
                    job.next_run_at = now + timedelta(hours=job.schedule_interval_hours)
                elif job.schedule_type == "cron" and job.schedule_cron:
                    job.next_run_at = croniter(job.schedule_cron, now).get_next(datetime)
                else:
                    job.next_run_at = None
                db.commit()
            except Exception as e:
                logger.error(f"Scheduled backup job {job.id} error: {e}")
    finally:
        db.close()

scheduler.add_job(run_due_backup_jobs, 'interval', minutes=1, id='run_due_backup_jobs')
```

**Step 2: Verify scheduler starts without errors**

Restart backend. Check logs for:
```
✅ Email auto-sync scheduler started
```
No errors about `run_due_backup_jobs`.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: add APScheduler job to poll and run due backup jobs every minute"
```

---

## Task 14: Frontend — API Client Functions

**Files:**
- Modify: `frontend/lib/api.ts`

**Step 1: Add backup API functions**

Open `frontend/lib/api.ts`. Add at the end of the file (before any final export if present):

```typescript
// ── Backups ────────────────────────────────────────────────────────────────

export const getBackupDestinations = () =>
  api.get('/backups/destinations').then(r => r.data);

export const createBackupDestination = (data: any) =>
  api.post('/backups/destinations', data).then(r => r.data);

export const updateBackupDestination = (id: number, data: any) =>
  api.put(`/backups/destinations/${id}`, data).then(r => r.data);

export const deleteBackupDestination = (id: number) =>
  api.delete(`/backups/destinations/${id}`).then(r => r.data);

export const testBackupDestination = (data: any) =>
  api.post('/backups/destinations/test', data).then(r => r.data);

export const getBackupJobs = () =>
  api.get('/backups/jobs').then(r => r.data);

export const createBackupJob = (data: any) =>
  api.post('/backups/jobs', data).then(r => r.data);

export const updateBackupJob = (id: number, data: any) =>
  api.put(`/backups/jobs/${id}`, data).then(r => r.data);

export const deleteBackupJob = (id: number) =>
  api.delete(`/backups/jobs/${id}`).then(r => r.data);

export const runBackupJobNow = (id: number) =>
  api.post(`/backups/jobs/${id}/run`).then(r => r.data);

export const getBackupRuns = (jobId?: number, status?: string) =>
  api.get('/backups/runs', { params: { job_id: jobId, status } }).then(r => r.data);

export const getJobBackupRuns = (jobId: number) =>
  api.get(`/backups/jobs/${jobId}/runs`).then(r => r.data);
```

**Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add backup system API client functions"
```

---

## Task 15: Frontend — Admin Page Structure

**Files:**
- Create: `frontend/app/admin/backups/page.tsx`

**Step 1: Create the backups admin page with three tabs**

```tsx
// frontend/app/admin/backups/page.tsx
'use client';

import { useState } from 'react';
import BackupJobsTab from './JobsTab';
import BackupDestinationsTab from './DestinationsTab';
import BackupHistoryTab from './HistoryTab';

const TABS = ['Jobs', 'Destinations', 'History'] as const;
type Tab = typeof TABS[number];

export default function BackupsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Jobs');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Remote Backups</h1>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'Jobs' && <BackupJobsTab />}
      {activeTab === 'Destinations' && <BackupDestinationsTab />}
      {activeTab === 'History' && <BackupHistoryTab />}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/backups/page.tsx
git commit -m "feat: add /admin/backups page shell with tab navigation"
```

---

## Task 16: Frontend — Destinations Tab

**Files:**
- Create: `frontend/app/admin/backups/DestinationsTab.tsx`

**Step 1: Create DestinationsTab component**

```tsx
// frontend/app/admin/backups/DestinationsTab.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  getBackupDestinations, createBackupDestination,
  updateBackupDestination, deleteBackupDestination, testBackupDestination
} from '@/lib/api';

const DEST_TYPES = ['local', 'sftp', 'scp', 's3', 'google_drive', 'onedrive'];

const defaultConfig: Record<string, any> = {
  local: { path: '/var/backups/socialmedia' },
  sftp: { host: '', port: 22, username: '', password: '', ssh_key: '', remote_path: '/backups' },
  scp: { host: '', port: 22, username: '', password: '', ssh_key: '', remote_path: '/backups' },
  s3: { bucket: '', region: 'us-east-1', access_key: '', secret_key: '', endpoint_url: '', prefix: 'backups' },
  google_drive: { folder_id: '' },
  onedrive: { folder_path: '/backups' },
};

export default function BackupDestinationsTab() {
  const [destinations, setDestinations] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', type: 'local', config: defaultConfig.local });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await getBackupDestinations();
    setDestinations(data);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'local', config: defaultConfig.local });
    setTestResult(null);
    setShowModal(true);
  };

  const openEdit = (d: any) => {
    setEditing(d);
    setForm({ name: d.name, type: d.type, config: d.config });
    setTestResult(null);
    setShowModal(true);
  };

  const handleTypeChange = (type: string) => {
    setForm(f => ({ ...f, type, config: defaultConfig[type] || {} }));
  };

  const handleConfigChange = (key: string, val: any) => {
    setForm(f => ({ ...f, config: { ...f.config, [key]: val } }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testBackupDestination({ type: form.type, config: form.config });
      setTestResult('success');
    } catch (e: any) {
      setTestResult(e.response?.data?.detail || 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await updateBackupDestination(editing.id, form);
      } else {
        await createBackupDestination(form);
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this destination?')) return;
    await deleteBackupDestination(id);
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-700">Destinations</h2>
        <button onClick={openCreate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + New Destination
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {destinations.map(d => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                <td className="px-4 py-3 text-gray-500 uppercase text-xs">{d.type.replace('_', ' ')}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {d.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 flex gap-2">
                  <button onClick={() => openEdit(d)} className="text-indigo-600 hover:underline text-xs">Edit</button>
                  <button onClick={() => handleDelete(d.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
            {destinations.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No destinations yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editing ? 'Edit Destination' : 'New Destination'}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.type} onChange={e => handleTypeChange(e.target.value)}>
                  {DEST_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').toUpperCase()}</option>)}
                </select>
              </div>

              {/* Dynamic config fields */}
              {Object.entries(form.config).map(([key, val]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">{key.replace(/_/g, ' ')}</label>
                  {key === 'ssh_key' ? (
                    <textarea className="w-full border rounded-lg px-3 py-2 text-xs font-mono" rows={4} value={val as string} onChange={e => handleConfigChange(key, e.target.value)} placeholder="Paste private key here (optional)" />
                  ) : (
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      type={key.includes('password') || key.includes('secret') || key.includes('key') ? 'password' : 'text'}
                      value={val as string}
                      onChange={e => handleConfigChange(key, e.target.value)}
                    />
                  )}
                </div>
              ))}

              {testResult && (
                <div className={`rounded-lg px-3 py-2 text-sm ${testResult === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {testResult === 'success' ? '✓ Connection successful' : testResult}
                </div>
              )}
            </div>

            <div className="flex justify-between mt-6">
              <button onClick={handleTest} disabled={testing} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowModal(false)} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify in browser**

Navigate to http://localhost:3000/admin/backups, click Destinations tab. Click "+ New Destination", switch types — config fields should update. Create a local destination.

**Step 3: Commit**

```bash
git add frontend/app/admin/backups/DestinationsTab.tsx
git commit -m "feat: add Destinations tab with create/edit/delete/test-connection UI"
```

---

## Task 17: Frontend — Jobs Tab

**Files:**
- Create: `frontend/app/admin/backups/JobsTab.tsx`

**Step 1: Create JobsTab component**

```tsx
// frontend/app/admin/backups/JobsTab.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  getBackupJobs, getBackupDestinations, createBackupJob,
  updateBackupJob, deleteBackupJob, runBackupJobNow
} from '@/lib/api';

export default function BackupJobsTab() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [destinations, setDestinations] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '', source_type: 'local_app', server_id: '', backup_scope: 'both',
    destination_id: '', schedule_type: 'manual', schedule_interval_hours: '',
    schedule_cron: '', retention_max_count: '', retention_max_days: '',
    notify_on_failure_emails: '', is_active: true
  });

  const load = async () => {
    const [j, d] = await Promise.all([getBackupJobs(), getBackupDestinations()]);
    setJobs(j);
    setDestinations(d);
  };

  useEffect(() => {
    load();
    // Load CloudPanel servers for the source dropdown
    fetch('/cloudpanel/servers', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.json()).then(setServers).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', source_type: 'local_app', server_id: '', backup_scope: 'both', destination_id: '', schedule_type: 'manual', schedule_interval_hours: '', schedule_cron: '', retention_max_count: '', retention_max_days: '', notify_on_failure_emails: '', is_active: true });
    setShowModal(true);
  };

  const openEdit = (job: any) => {
    setEditing(job);
    setForm({
      name: job.name, source_type: job.source_type, server_id: job.server_id || '',
      backup_scope: job.backup_scope, destination_id: job.destination_id,
      schedule_type: job.schedule_type, schedule_interval_hours: job.schedule_interval_hours || '',
      schedule_cron: job.schedule_cron || '', retention_max_count: job.retention_max_count || '',
      retention_max_days: job.retention_max_days || '', notify_on_failure_emails: (job.notify_on_failure_emails || []).join(', '),
      is_active: job.is_active
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    const payload = {
      ...form,
      server_id: form.server_id ? Number(form.server_id) : null,
      destination_id: Number(form.destination_id),
      schedule_interval_hours: form.schedule_interval_hours ? Number(form.schedule_interval_hours) : null,
      retention_max_count: form.retention_max_count ? Number(form.retention_max_count) : null,
      retention_max_days: form.retention_max_days ? Number(form.retention_max_days) : null,
      notify_on_failure_emails: form.notify_on_failure_emails.split(',').map(e => e.trim()).filter(Boolean),
    };
    if (editing) {
      await updateBackupJob(editing.id, payload);
    } else {
      await createBackupJob(payload);
    }
    setShowModal(false);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this job?')) return;
    await deleteBackupJob(id);
    load();
  };

  const handleRunNow = async (id: number) => {
    setRunningId(id);
    try {
      await runBackupJobNow(id);
      alert('Backup started successfully');
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Backup failed');
    } finally {
      setRunningId(null);
      load();
    }
  };

  const formatSchedule = (job: any) => {
    if (job.schedule_type === 'manual') return 'Manual';
    if (job.schedule_type === 'interval') return `Every ${job.schedule_interval_hours}h`;
    return job.schedule_cron || 'Cron';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-700">Backup Jobs</h2>
        <button onClick={openCreate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + New Job
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Source</th>
              <th className="px-4 py-3 text-left">Scope</th>
              <th className="px-4 py-3 text-left">Schedule</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map(job => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{job.name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{job.source_type === 'local_app' ? 'App (local)' : `Server #${job.server_id}`}</td>
                <td className="px-4 py-3 text-gray-500 text-xs capitalize">{job.backup_scope}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatSchedule(job)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${job.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {job.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 flex gap-2 items-center">
                  <button onClick={() => handleRunNow(job.id)} disabled={runningId === job.id} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100 disabled:opacity-50">
                    {runningId === job.id ? '...' : '▶ Run'}
                  </button>
                  <button onClick={() => openEdit(job)} className="text-indigo-600 hover:underline text-xs">Edit</button>
                  <button onClick={() => handleDelete(job.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No backup jobs yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editing ? 'Edit Job' : 'New Backup Job'}</h3>

            <div className="space-y-4">
              <Field label="Name">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </Field>

              <Field label="Source">
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}>
                  <option value="local_app">Local App (this server's DB)</option>
                  <option value="cloudpanel_server">CloudPanel Server</option>
                </select>
              </Field>

              {form.source_type === 'cloudpanel_server' && (
                <>
                  <Field label="Server">
                    <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.server_id} onChange={e => setForm(f => ({ ...f, server_id: e.target.value }))}>
                      <option value="">Select server...</option>
                      {servers.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                    </select>
                  </Field>
                  <Field label="Backup Scope">
                    <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.backup_scope} onChange={e => setForm(f => ({ ...f, backup_scope: e.target.value }))}>
                      <option value="both">Database + Files</option>
                      <option value="db">Database only</option>
                      <option value="files">Files only</option>
                    </select>
                  </Field>
                </>
              )}

              <Field label="Destination">
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.destination_id} onChange={e => setForm(f => ({ ...f, destination_id: e.target.value }))}>
                  <option value="">Select destination...</option>
                  {destinations.map((d: any) => <option key={d.id} value={d.id}>{d.name} ({d.type})</option>)}
                </select>
              </Field>

              <Field label="Schedule">
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.schedule_type} onChange={e => setForm(f => ({ ...f, schedule_type: e.target.value }))}>
                  <option value="manual">Manual only</option>
                  <option value="interval">Every N hours</option>
                  <option value="cron">Cron expression</option>
                </select>
              </Field>

              {form.schedule_type === 'interval' && (
                <Field label="Interval (hours)">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.schedule_interval_hours} onChange={e => setForm(f => ({ ...f, schedule_interval_hours: e.target.value }))} />
                </Field>
              )}

              {form.schedule_type === 'cron' && (
                <Field label="Cron expression (e.g. 0 2 * * *)">
                  <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" value={form.schedule_cron} onChange={e => setForm(f => ({ ...f, schedule_cron: e.target.value }))} placeholder="0 2 * * *" />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Keep last N backups">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.retention_max_count} onChange={e => setForm(f => ({ ...f, retention_max_count: e.target.value }))} placeholder="e.g. 10" />
                </Field>
                <Field label="Keep for N days">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.retention_max_days} onChange={e => setForm(f => ({ ...f, retention_max_days: e.target.value }))} placeholder="e.g. 30" />
                </Field>
              </div>

              <Field label="Notify on failure (comma-separated emails)">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.notify_on_failure_emails} onChange={e => setForm(f => ({ ...f, notify_on_failure_emails: e.target.value }))} placeholder="admin@example.com, ops@example.com" />
              </Field>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
```

**Step 2: Verify in browser**

Navigate to http://localhost:3000/admin/backups → Jobs tab. Create a job. Confirm it appears in the table. Click ▶ Run — confirm success/failure alert.

**Step 3: Commit**

```bash
git add frontend/app/admin/backups/JobsTab.tsx
git commit -m "feat: add Jobs tab with create/edit/delete/run-now UI"
```

---

## Task 18: Frontend — History Tab

**Files:**
- Create: `frontend/app/admin/backups/HistoryTab.tsx`

**Step 1: Create HistoryTab component**

```tsx
// frontend/app/admin/backups/HistoryTab.tsx
'use client';

import { useEffect, useState } from 'react';
import { getBackupRuns, getBackupJobs } from '@/lib/api';

function formatBytes(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(start: string, end: string | null) {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function BackupHistoryTab() {
  const [runs, setRuns] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [filterJobId, setFilterJobId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = async () => {
    const [r, j] = await Promise.all([
      getBackupRuns(filterJobId ? Number(filterJobId) : undefined, filterStatus || undefined),
      getBackupJobs()
    ]);
    setRuns(r);
    setJobs(j);
  };

  useEffect(() => { load(); }, [filterJobId, filterStatus]);

  const jobName = (jobId: number) => jobs.find(j => j.id === jobId)?.name || `Job #${jobId}`;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-700">Backup History</h2>
        <div className="flex gap-2">
          <select className="border rounded-lg px-3 py-2 text-sm" value={filterJobId} onChange={e => setFilterJobId(e.target.value)}>
            <option value="">All Jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
          <select className="border rounded-lg px-3 py-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Job</th>
              <th className="px-4 py-3 text-left">Started</th>
              <th className="px-4 py-3 text-left">Duration</th>
              <th className="px-4 py-3 text-left">Size</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.map(run => (
              <>
                <tr
                  key={run.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{jobName(run.job_id)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(run.started_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDuration(run.started_at, run.finished_at)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatBytes(run.file_size_bytes)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      run.status === 'success' ? 'bg-green-100 text-green-800'
                      : run.status === 'failed' ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {run.status === 'success' ? '✓ Success' : run.status === 'failed' ? '✗ Failed' : '⟳ Running'}
                    </span>
                  </td>
                </tr>
                {expanded === run.id && (
                  <tr key={`${run.id}-detail`} className="bg-gray-50">
                    <td colSpan={5} className="px-4 py-3">
                      {run.backup_file_path && (
                        <p className="text-xs text-gray-600 mb-1"><span className="font-medium">File:</span> {run.backup_file_path}</p>
                      )}
                      {run.error_message && (
                        <p className="text-xs text-red-600 font-mono bg-red-50 rounded px-2 py-1">{run.error_message}</p>
                      )}
                      {!run.backup_file_path && !run.error_message && (
                        <p className="text-xs text-gray-400">No details available</p>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No backup runs yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/backups/HistoryTab.tsx
git commit -m "feat: add History tab with filterable run log and expandable error details"
```

---

## Task 19: Admin Sidebar Link

**Files:**
- Find the admin sidebar nav file (likely `frontend/app/admin/page.tsx` or a shared `AdminSidebar` component — search for the existing CloudPanel link to find the right file)

**Step 1: Locate sidebar**

```bash
grep -rn "cloudpanel\|CloudPanel" frontend/app/admin/ --include="*.tsx" -l
```

Open the file containing the sidebar nav items.

**Step 2: Add backups link**

Find the list of nav items (look for the CloudPanel entry). Add alongside it:

```tsx
{ href: '/admin/backups', label: 'Backups', icon: '🗄️' }
```

Match the exact pattern used for other nav items in that file.

**Step 3: Verify**

Open http://localhost:3000/admin — confirm "Backups" appears in the sidebar and links to `/admin/backups`.

**Step 4: Commit**

```bash
git add frontend/app/admin/
git commit -m "feat: add Backups link to admin sidebar"
```

---

## Task 20: End-to-End Smoke Test

**Step 1: Start both services**

```bash
./start.sh
```

**Step 2: Test via Swagger (http://localhost:8000/docs)**

1. `POST /backups/destinations` — create a local destination with path `/tmp/test_backups`
2. `POST /backups/destinations/test` — confirm connection test returns `{"ok": true}`
3. `POST /backups/jobs` — create a `local_app` job with `destination_id` from step 1, `schedule_type: manual`
4. `POST /backups/jobs/{id}/run` — trigger manual run
5. `GET /backups/runs` — confirm a run appears with `status: success` or `status: failed` (check `error_message` if failed)

**Step 3: Test via UI (http://localhost:3000/admin/backups)**

1. Destinations tab → create, edit, delete a destination
2. Jobs tab → create a job, click ▶ Run Now
3. History tab → confirm the run appears, click row to expand details

**Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete remote backup system — engine, destinations, routes, admin UI"
```
