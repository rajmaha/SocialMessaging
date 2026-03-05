# Dynamic Form Builder — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dynamic form builder supporting local DB storage and remote API-backed CRUD with per-user authentication, conditional field visibility, and 13 field types with validation.

**Architecture:** New standalone module with backend models/routes/services + frontend admin pages + public form renderer. API-backed forms proxy through the backend using cached per-user tokens (X-Api-Key + X-Token pattern). Local forms store submissions as JSON in PostgreSQL.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, Next.js 14 App Router, TailwindCSS, Axios

**Design Doc:** `docs/plans/2026-03-04-dynamic-form-builder-design.md`

**Note:** This project has no test framework (no pytest/Jest). Steps reference manual verification via Swagger UI and browser. No TDD steps.

---

## Task 1: Backend Models — ApiServer & UserApiCredential

**Files:**
- Create: `backend/app/models/api_server.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/main.py` (inline SQL migration + router registration)

**Step 1: Create the model file**

Create `backend/app/models/api_server.py`:

```python
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func
from app.database import Base


class ApiServer(Base):
    __tablename__ = "api_servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False)
    auth_type = Column(String, nullable=False, default="none")  # none, api_key_plus_token, basic, bearer, api_key_only
    api_key_header = Column(String, nullable=True)
    api_key_value = Column(String, nullable=True)
    token_header = Column(String, nullable=True)
    login_endpoint = Column(String, nullable=True)
    login_username_field = Column(String, nullable=True, default="username")
    login_password_field = Column(String, nullable=True, default="password")
    token_response_path = Column(String, nullable=True, default="data.token")
    request_content_type = Column(String, nullable=False, default="json")  # json, formdata
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserApiCredential(Base):
    __tablename__ = "user_api_credentials"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    api_server_id = Column(Integer, ForeignKey("api_servers.id"), nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    token = Column(String, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)

    __table_args__ = (
        UniqueConstraint("user_id", "api_server_id", name="uq_user_api_server"),
    )
```

**Step 2: Add inline SQL migration in `backend/main.py`**

Find the migration section (around line 515+) and add after existing migrations:

```python
# API Servers table
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS api_servers (
        id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL,
        base_url VARCHAR NOT NULL,
        auth_type VARCHAR NOT NULL DEFAULT 'none',
        api_key_header VARCHAR,
        api_key_value VARCHAR,
        token_header VARCHAR,
        login_endpoint VARCHAR,
        login_username_field VARCHAR DEFAULT 'username',
        login_password_field VARCHAR DEFAULT 'password',
        token_response_path VARCHAR DEFAULT 'data.token',
        request_content_type VARCHAR NOT NULL DEFAULT 'json',
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))

# User API Credentials table
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS user_api_credentials (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        api_server_id INTEGER NOT NULL REFERENCES api_servers(id),
        username VARCHAR NOT NULL,
        password VARCHAR NOT NULL,
        token VARCHAR,
        token_expires_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        UNIQUE(user_id, api_server_id)
    )
"""))
```

**Step 3: Export models in `__init__.py`**

Add to `backend/app/models/__init__.py`:

```python
from .api_server import ApiServer, UserApiCredential
```

And add `"ApiServer", "UserApiCredential"` to the `__all__` list.

**Step 4: Verify — restart backend**

Run: `cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000`

Expected: Server starts without errors, tables created.

**Step 5: Commit**

```bash
git add backend/app/models/api_server.py backend/app/models/__init__.py backend/main.py
git commit -m "feat(forms): add ApiServer and UserApiCredential models"
```

---

## Task 2: Backend Models — Form, FormField, FormSubmission

**Files:**
- Create: `backend/app/models/form.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/main.py` (inline SQL migration)

**Step 1: Create the model file**

Create `backend/app/models/form.py`:

```python
from sqlalchemy import Column, Integer, String, Text, Boolean, JSON, DateTime, ForeignKey, UniqueConstraint, func
from app.database import Base


class Form(Base):
    __tablename__ = "forms"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    success_message = Column(Text, default="Thank you for your submission!")
    storage_type = Column(String, nullable=False, default="local")  # local, api
    is_published = Column(Boolean, default=False)
    require_otp = Column(Boolean, default=False)
    api_server_id = Column(Integer, ForeignKey("api_servers.id"), nullable=True)
    api_create_method = Column(String, nullable=True)
    api_list_method = Column(String, nullable=True)
    api_detail_method = Column(String, nullable=True)
    api_update_method = Column(String, nullable=True)
    api_delete_method = Column(String, nullable=True)
    api_list_columns = Column(JSON, nullable=True)
    api_record_id_path = Column(String, nullable=True, default="data.id")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class FormField(Base):
    __tablename__ = "form_fields"

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("forms.id", ondelete="CASCADE"), nullable=False, index=True)
    field_label = Column(String, nullable=False)
    field_key = Column(String, nullable=False)
    field_type = Column(String, nullable=False, default="text")
    placeholder = Column(String, nullable=True)
    is_required = Column(Boolean, default=False)
    display_order = Column(Integer, default=0)
    default_value = Column(String, nullable=True)
    options = Column(JSON, nullable=True)
    validation_rules = Column(JSON, nullable=True)
    api_endpoint = Column(String, nullable=True)
    api_value_key = Column(String, nullable=True)
    api_label_key = Column(String, nullable=True)
    condition = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("form_id", "field_key", name="uq_form_field_key"),
    )


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id = Column(Integer, primary_key=True, index=True)
    form_id = Column(Integer, ForeignKey("forms.id", ondelete="CASCADE"), nullable=False, index=True)
    data = Column(JSON, nullable=False)
    submitter_email = Column(String, nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
```

**Step 2: Add inline SQL migration in `backend/main.py`**

Add after the api_servers migrations:

```python
# Forms table
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS forms (
        id SERIAL PRIMARY KEY,
        title VARCHAR NOT NULL,
        slug VARCHAR UNIQUE NOT NULL,
        description TEXT,
        success_message TEXT DEFAULT 'Thank you for your submission!',
        storage_type VARCHAR NOT NULL DEFAULT 'local',
        is_published BOOLEAN DEFAULT FALSE,
        require_otp BOOLEAN DEFAULT FALSE,
        api_server_id INTEGER REFERENCES api_servers(id),
        api_create_method VARCHAR,
        api_list_method VARCHAR,
        api_detail_method VARCHAR,
        api_update_method VARCHAR,
        api_delete_method VARCHAR,
        api_list_columns JSON,
        api_record_id_path VARCHAR DEFAULT 'data.id',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )
"""))

# Form Fields table
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS form_fields (
        id SERIAL PRIMARY KEY,
        form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        field_label VARCHAR NOT NULL,
        field_key VARCHAR NOT NULL,
        field_type VARCHAR NOT NULL DEFAULT 'text',
        placeholder VARCHAR,
        is_required BOOLEAN DEFAULT FALSE,
        display_order INTEGER DEFAULT 0,
        default_value VARCHAR,
        options JSON,
        validation_rules JSON,
        api_endpoint VARCHAR,
        api_value_key VARCHAR,
        api_label_key VARCHAR,
        condition JSON,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(form_id, field_key)
    )
"""))

# Form Submissions table
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS form_submissions (
        id SERIAL PRIMARY KEY,
        form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        data JSON NOT NULL,
        submitter_email VARCHAR,
        submitted_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    )
"""))
```

**Step 3: Export models in `__init__.py`**

Add to `backend/app/models/__init__.py`:

```python
from .form import Form, FormField, FormSubmission
```

And add `"Form", "FormField", "FormSubmission"` to the `__all__` list.

**Step 4: Verify — restart backend**

Expected: Server starts, all 6 new tables created.

**Step 5: Commit**

```bash
git add backend/app/models/form.py backend/app/models/__init__.py backend/main.py
git commit -m "feat(forms): add Form, FormField, FormSubmission models"
```

---

## Task 3: Backend Schemas — ApiServer & Form

**Files:**
- Create: `backend/app/schemas/api_server.py`
- Create: `backend/app/schemas/form.py`

**Step 1: Create API server schemas**

Create `backend/app/schemas/api_server.py`:

```python
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class ApiServerCreate(BaseModel):
    name: str
    base_url: str
    auth_type: str = "none"
    api_key_header: Optional[str] = None
    api_key_value: Optional[str] = None
    token_header: Optional[str] = None
    login_endpoint: Optional[str] = None
    login_username_field: Optional[str] = "username"
    login_password_field: Optional[str] = "password"
    token_response_path: Optional[str] = "data.token"
    request_content_type: str = "json"


class ApiServerUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    auth_type: Optional[str] = None
    api_key_header: Optional[str] = None
    api_key_value: Optional[str] = None
    token_header: Optional[str] = None
    login_endpoint: Optional[str] = None
    login_username_field: Optional[str] = None
    login_password_field: Optional[str] = None
    token_response_path: Optional[str] = None
    request_content_type: Optional[str] = None


class ApiServerResponse(ApiServerCreate):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class UserApiCredentialCreate(BaseModel):
    user_id: int
    username: str
    password: str


class UserApiCredentialUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


class UserApiCredentialResponse(BaseModel):
    id: int
    user_id: int
    api_server_id: int
    username: str
    is_active: bool
    token_expires_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class ApiLoginRequest(BaseModel):
    username: str
    password: str
```

**Step 2: Create form schemas**

Create `backend/app/schemas/form.py`:

```python
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime


# --- Form ---

class FormCreate(BaseModel):
    title: str
    slug: str
    description: Optional[str] = None
    success_message: Optional[str] = "Thank you for your submission!"
    storage_type: str = "local"
    is_published: bool = False
    require_otp: bool = False
    api_server_id: Optional[int] = None
    api_create_method: Optional[str] = None
    api_list_method: Optional[str] = None
    api_detail_method: Optional[str] = None
    api_update_method: Optional[str] = None
    api_delete_method: Optional[str] = None
    api_list_columns: Optional[List[Dict[str, Any]]] = None
    api_record_id_path: Optional[str] = "data.id"


class FormUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    success_message: Optional[str] = None
    storage_type: Optional[str] = None
    is_published: Optional[bool] = None
    require_otp: Optional[bool] = None
    api_server_id: Optional[int] = None
    api_create_method: Optional[str] = None
    api_list_method: Optional[str] = None
    api_detail_method: Optional[str] = None
    api_update_method: Optional[str] = None
    api_delete_method: Optional[str] = None
    api_list_columns: Optional[List[Dict[str, Any]]] = None
    api_record_id_path: Optional[str] = None


class FormResponse(FormCreate):
    id: int
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    submission_count: Optional[int] = 0
    model_config = ConfigDict(from_attributes=True)


# --- FormField ---

class FormFieldCreate(BaseModel):
    field_label: str
    field_key: str
    field_type: str = "text"
    placeholder: Optional[str] = None
    is_required: bool = False
    display_order: int = 0
    default_value: Optional[str] = None
    options: Optional[List[Dict[str, str]]] = None
    validation_rules: Optional[Dict[str, Any]] = None
    api_endpoint: Optional[str] = None
    api_value_key: Optional[str] = None
    api_label_key: Optional[str] = None
    condition: Optional[Any] = None  # single object or array of conditions


class FormFieldUpdate(BaseModel):
    field_label: Optional[str] = None
    field_key: Optional[str] = None
    field_type: Optional[str] = None
    placeholder: Optional[str] = None
    is_required: Optional[bool] = None
    display_order: Optional[int] = None
    default_value: Optional[str] = None
    options: Optional[List[Dict[str, str]]] = None
    validation_rules: Optional[Dict[str, Any]] = None
    api_endpoint: Optional[str] = None
    api_value_key: Optional[str] = None
    api_label_key: Optional[str] = None
    condition: Optional[Any] = None


class FormFieldResponse(FormFieldCreate):
    id: int
    form_id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class FormFieldReorder(BaseModel):
    field_ids: List[int]  # ordered list of field IDs


# --- FormSubmission ---

class FormSubmissionCreate(BaseModel):
    data: Dict[str, Any]
    submitter_email: Optional[str] = None


class FormSubmissionUpdate(BaseModel):
    data: Dict[str, Any]


class FormSubmissionResponse(BaseModel):
    id: int
    form_id: int
    data: Dict[str, Any]
    submitter_email: Optional[str] = None
    submitted_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
```

**Step 3: Commit**

```bash
git add backend/app/schemas/api_server.py backend/app/schemas/form.py
git commit -m "feat(forms): add Pydantic schemas for ApiServer and Form"
```

---

## Task 4: Backend Service — API Proxy

**Files:**
- Create: `backend/app/services/api_proxy.py`

**Step 1: Create the API proxy service**

This service handles all remote API communication: authentication, request building, and response parsing.

Create `backend/app/services/api_proxy.py`:

```python
import httpx
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from app.models.api_server import ApiServer, UserApiCredential


def _resolve_json_path(data: Any, path: str) -> Any:
    """Extract a value from nested JSON using dot notation, e.g. 'data.token'"""
    parts = path.split(".")
    current = data
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _build_headers(server: ApiServer, token: Optional[str] = None) -> Dict[str, str]:
    """Build request headers for a given API server."""
    headers = {}
    if server.api_key_header and server.api_key_value:
        headers[server.api_key_header] = server.api_key_value
    if token and server.token_header:
        headers[server.token_header] = token
    return headers


def _parse_method_string(method_string: str):
    """Parse 'POST /api/records' into ('POST', '/api/records')"""
    parts = method_string.strip().split(" ", 1)
    if len(parts) == 2:
        return parts[0].upper(), parts[1]
    return "GET", parts[0]


async def api_login(
    db: Session,
    server: ApiServer,
    credential: UserApiCredential,
) -> str:
    """Authenticate with the remote API and cache the token."""
    url = f"{server.base_url.rstrip('/')}{server.login_endpoint}"

    if server.request_content_type == "formdata":
        request_kwargs = {"data": {
            server.login_username_field: credential.username,
            server.login_password_field: credential.password,
        }}
    else:
        request_kwargs = {"json": {
            server.login_username_field: credential.username,
            server.login_password_field: credential.password,
        }}

    headers = _build_headers(server)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, **request_kwargs)
        resp.raise_for_status()
        body = resp.json()

    token = _resolve_json_path(body, server.token_response_path or "data.token")
    if not token:
        raise ValueError(f"Could not extract token from response using path '{server.token_response_path}'")

    credential.token = token
    credential.is_active = True
    db.commit()

    return token


async def api_request(
    db: Session,
    server: ApiServer,
    credential: UserApiCredential,
    method_string: str,
    path_params: Optional[Dict[str, str]] = None,
    body: Optional[Dict[str, Any]] = None,
    query_params: Optional[Dict[str, Any]] = None,
) -> Any:
    """
    Make an authenticated request to the remote API.
    If token is missing or expired, attempts re-login automatically.
    """
    method, path = _parse_method_string(method_string)

    # Replace path parameters like {id}
    if path_params:
        for key, val in path_params.items():
            path = path.replace(f"{{{key}}}", str(val))

    url = f"{server.base_url.rstrip('/')}{path}"

    # Try with existing token first
    token = credential.token
    if not token:
        token = await api_login(db, server, credential)

    headers = _build_headers(server, token)

    request_kwargs: Dict[str, Any] = {}
    if body:
        if server.request_content_type == "formdata":
            request_kwargs["data"] = body
        else:
            request_kwargs["json"] = body
    if query_params:
        request_kwargs["params"] = query_params

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(method, url, headers=headers, **request_kwargs)

        # If 401, try re-login and retry once
        if resp.status_code == 401:
            token = await api_login(db, server, credential)
            headers = _build_headers(server, token)
            resp = await client.request(method, url, headers=headers, **request_kwargs)

        resp.raise_for_status()

        if resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return resp.text
```

**Step 2: Commit**

```bash
git add backend/app/services/api_proxy.py
git commit -m "feat(forms): add API proxy service for remote form CRUD"
```

---

## Task 5: Backend Routes — API Servers

**Files:**
- Create: `backend/app/routes/api_servers.py`
- Modify: `backend/main.py` (import + include_router)

**Step 1: Create the routes file**

Create `backend/app/routes/api_servers.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.api_server import ApiServer, UserApiCredential
from app.schemas.api_server import (
    ApiServerCreate, ApiServerUpdate, ApiServerResponse,
    UserApiCredentialCreate, UserApiCredentialUpdate, UserApiCredentialResponse,
    ApiLoginRequest,
)
from app.services.api_proxy import api_login

router = APIRouter(
    prefix="/api/admin/api-servers",
    tags=["admin", "api_servers"],
)

require_manage_forms = require_admin_feature("feature_manage_forms")


@router.post("", response_model=ApiServerResponse)
def create_api_server(
    data: ApiServerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    server = ApiServer(**data.model_dump())
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


@router.get("", response_model=List[ApiServerResponse])
def list_api_servers(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    return db.query(ApiServer).order_by(ApiServer.id).all()


@router.put("/{server_id}", response_model=ApiServerResponse)
def update_api_server(
    server_id: int,
    data: ApiServerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    server = db.query(ApiServer).filter(ApiServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(server, key, value)
    db.commit()
    db.refresh(server)
    return server


@router.delete("/{server_id}")
def delete_api_server(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    server = db.query(ApiServer).filter(ApiServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")
    db.query(UserApiCredential).filter(UserApiCredential.api_server_id == server_id).delete()
    db.delete(server)
    db.commit()
    return {"message": "API Server deleted"}


# --- User Credentials ---

@router.post("/{server_id}/credentials", response_model=UserApiCredentialResponse)
def create_user_credential(
    server_id: int,
    data: UserApiCredentialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    server = db.query(ApiServer).filter(ApiServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")
    existing = db.query(UserApiCredential).filter(
        UserApiCredential.user_id == data.user_id,
        UserApiCredential.api_server_id == server_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Credential already exists for this user/server")
    cred = UserApiCredential(api_server_id=server_id, **data.model_dump())
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return cred


@router.get("/{server_id}/credentials", response_model=List[UserApiCredentialResponse])
def list_user_credentials(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    return db.query(UserApiCredential).filter(
        UserApiCredential.api_server_id == server_id
    ).all()


# --- User-facing credential routes ---

user_router = APIRouter(
    prefix="/api/user/api-credentials",
    tags=["user", "api_credentials"],
)


@user_router.put("/{cred_id}", response_model=UserApiCredentialResponse)
def update_own_credential(
    cred_id: int,
    data: UserApiCredentialUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cred = db.query(UserApiCredential).filter(
        UserApiCredential.id == cred_id,
        UserApiCredential.user_id == current_user.id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(cred, key, value)
    cred.token = None  # invalidate cached token on credential change
    db.commit()
    db.refresh(cred)
    return cred


@user_router.post("/{cred_id}/login")
async def login_to_api_server(
    cred_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cred = db.query(UserApiCredential).filter(
        UserApiCredential.id == cred_id,
        UserApiCredential.user_id == current_user.id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    server = db.query(ApiServer).filter(ApiServer.id == cred.api_server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")
    try:
        token = await api_login(db, server, cred)
        return {"message": "Login successful", "token": token}
    except Exception as e:
        cred.is_active = False
        db.commit()
        raise HTTPException(status_code=401, detail=f"Login failed: {str(e)}")
```

**Step 2: Register routers in `backend/main.py`**

Add import at the top with other route imports:

```python
from app.routes.api_servers import router as api_servers_router, user_router as user_api_creds_router
```

Add `include_router` calls after the existing ones (around line 1231):

```python
app.include_router(api_servers_router)
app.include_router(user_api_creds_router)
```

**Step 3: Verify via Swagger**

Open http://localhost:8000/docs and confirm the new endpoints appear under `api_servers` and `api_credentials` tags.

**Step 4: Commit**

```bash
git add backend/app/routes/api_servers.py backend/main.py
git commit -m "feat(forms): add API server and credential management routes"
```

---

## Task 6: Backend Routes — Forms CRUD

**Files:**
- Create: `backend/app/routes/forms.py`
- Modify: `backend/main.py` (import + include_router)

**Step 1: Create the routes file**

Create `backend/app/routes/forms.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
import csv
import io

from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.form import Form, FormField, FormSubmission
from app.models.api_server import ApiServer, UserApiCredential
from app.schemas.form import (
    FormCreate, FormUpdate, FormResponse,
    FormFieldCreate, FormFieldUpdate, FormFieldResponse, FormFieldReorder,
    FormSubmissionCreate, FormSubmissionUpdate, FormSubmissionResponse,
)
from app.services.api_proxy import api_request, _resolve_json_path

# --- Admin routes ---

admin_router = APIRouter(
    prefix="/api/admin/forms",
    tags=["admin", "forms"],
)

require_manage_forms = require_admin_feature("feature_manage_forms")


@admin_router.post("", response_model=FormResponse)
def create_form(
    data: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    existing = db.query(Form).filter(Form.slug == data.slug).first()
    if existing:
        raise HTTPException(status_code=409, detail="A form with this slug already exists")
    form = Form(**data.model_dump(), created_by=current_user.id)
    db.add(form)
    db.commit()
    db.refresh(form)
    return _form_with_count(db, form)


@admin_router.get("", response_model=List[FormResponse])
def list_forms(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    forms = db.query(Form).order_by(Form.id.desc()).all()
    return [_form_with_count(db, f) for f in forms]


@admin_router.get("/{form_id}", response_model=FormResponse)
def get_form(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return _form_with_count(db, form)


@admin_router.put("/{form_id}", response_model=FormResponse)
def update_form(
    form_id: int,
    data: FormUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    update_data = data.model_dump(exclude_unset=True)
    if "slug" in update_data and update_data["slug"] != form.slug:
        existing = db.query(Form).filter(Form.slug == update_data["slug"]).first()
        if existing:
            raise HTTPException(status_code=409, detail="Slug already in use")
    for key, value in update_data.items():
        setattr(form, key, value)
    db.commit()
    db.refresh(form)
    return _form_with_count(db, form)


@admin_router.delete("/{form_id}")
def delete_form(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    db.query(FormField).filter(FormField.form_id == form_id).delete()
    db.query(FormSubmission).filter(FormSubmission.form_id == form_id).delete()
    db.delete(form)
    db.commit()
    return {"message": "Form deleted"}


def _form_with_count(db: Session, form: Form) -> dict:
    """Add submission_count to form response."""
    count = db.query(sqlfunc.count(FormSubmission.id)).filter(
        FormSubmission.form_id == form.id
    ).scalar()
    result = {c.name: getattr(form, c.name) for c in form.__table__.columns}
    result["submission_count"] = count or 0
    return result


# --- Fields ---

@admin_router.post("/{form_id}/fields", response_model=FormFieldResponse)
def create_field(
    form_id: int,
    data: FormFieldCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    existing = db.query(FormField).filter(
        FormField.form_id == form_id, FormField.field_key == data.field_key
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Field key '{data.field_key}' already exists in this form")
    field = FormField(form_id=form_id, **data.model_dump())
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


@admin_router.get("/{form_id}/fields", response_model=List[FormFieldResponse])
def list_fields(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    return db.query(FormField).filter(
        FormField.form_id == form_id
    ).order_by(FormField.display_order.asc()).all()


@admin_router.put("/{form_id}/fields/{field_id}", response_model=FormFieldResponse)
def update_field(
    form_id: int,
    field_id: int,
    data: FormFieldUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    field = db.query(FormField).filter(
        FormField.id == field_id, FormField.form_id == form_id
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    update_data = data.model_dump(exclude_unset=True)
    if "field_key" in update_data and update_data["field_key"] != field.field_key:
        existing = db.query(FormField).filter(
            FormField.form_id == form_id,
            FormField.field_key == update_data["field_key"],
            FormField.id != field_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Field key '{update_data['field_key']}' already exists")
    for key, value in update_data.items():
        setattr(field, key, value)
    db.commit()
    db.refresh(field)
    return field


@admin_router.delete("/{form_id}/fields/{field_id}")
def delete_field(
    form_id: int,
    field_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    field = db.query(FormField).filter(
        FormField.id == field_id, FormField.form_id == form_id
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    db.delete(field)
    db.commit()
    return {"message": "Field deleted"}


@admin_router.put("/{form_id}/fields/reorder")
def reorder_fields(
    form_id: int,
    data: FormFieldReorder,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    for idx, field_id in enumerate(data.field_ids):
        db.query(FormField).filter(
            FormField.id == field_id, FormField.form_id == form_id
        ).update({"display_order": idx})
    db.commit()
    return {"message": "Fields reordered"}


# --- Submissions (local) ---

@admin_router.get("/{form_id}/submissions", response_model=List[FormSubmissionResponse])
async def list_submissions(
    form_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    if form.storage_type == "api":
        return await _proxy_list(db, form, current_user)

    return db.query(FormSubmission).filter(
        FormSubmission.form_id == form_id
    ).order_by(FormSubmission.submitted_at.desc()).offset(skip).limit(limit).all()


@admin_router.get("/{form_id}/submissions/export")
def export_submissions(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.storage_type != "local":
        raise HTTPException(status_code=400, detail="Export only available for local forms")

    fields = db.query(FormField).filter(
        FormField.form_id == form_id
    ).order_by(FormField.display_order).all()
    submissions = db.query(FormSubmission).filter(
        FormSubmission.form_id == form_id
    ).order_by(FormSubmission.submitted_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)

    header = ["ID", "Submitted At"] + [f.field_label for f in fields] + ["Email"]
    writer.writerow(header)

    for sub in submissions:
        row = [sub.id, str(sub.submitted_at)]
        for f in fields:
            row.append(sub.data.get(f.field_key, ""))
        row.append(sub.submitter_email or "")
        writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={form.slug}-submissions.csv"},
    )


@admin_router.get("/{form_id}/submissions/{sub_id}", response_model=FormSubmissionResponse)
async def get_submission(
    form_id: int,
    sub_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    if form.storage_type == "api":
        return await _proxy_detail(db, form, current_user, sub_id)

    sub = db.query(FormSubmission).filter(
        FormSubmission.id == sub_id, FormSubmission.form_id == form_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    return sub


@admin_router.put("/{form_id}/submissions/{sub_id}", response_model=FormSubmissionResponse)
async def update_submission(
    form_id: int,
    sub_id: int,
    data: FormSubmissionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    if form.storage_type == "api":
        return await _proxy_update(db, form, current_user, sub_id, data.data)

    sub = db.query(FormSubmission).filter(
        FormSubmission.id == sub_id, FormSubmission.form_id == form_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    sub.data = data.data
    db.commit()
    db.refresh(sub)
    return sub


@admin_router.delete("/{form_id}/submissions/{sub_id}")
async def delete_submission(
    form_id: int,
    sub_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    if form.storage_type == "api":
        return await _proxy_delete(db, form, current_user, sub_id)

    sub = db.query(FormSubmission).filter(
        FormSubmission.id == sub_id, FormSubmission.form_id == form_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    db.delete(sub)
    db.commit()
    return {"message": "Submission deleted"}


# --- API Proxy helpers ---

def _get_credential(db: Session, form: Form, user: User) -> tuple:
    """Get the API server and user credential for an API-backed form."""
    server = db.query(ApiServer).filter(ApiServer.id == form.api_server_id).first()
    if not server:
        raise HTTPException(status_code=400, detail="Form's API server not found")
    cred = db.query(UserApiCredential).filter(
        UserApiCredential.user_id == user.id,
        UserApiCredential.api_server_id == server.id,
    ).first()
    if not cred:
        raise HTTPException(
            status_code=401,
            detail="login_required",
            headers={"X-Login-Required": "true"},
        )
    return server, cred


async def _proxy_list(db: Session, form: Form, user: User):
    if not form.api_list_method:
        raise HTTPException(status_code=400, detail="No list endpoint configured")
    server, cred = _get_credential(db, form, user)
    result = await api_request(db, server, cred, form.api_list_method)
    return result


async def _proxy_detail(db: Session, form: Form, user: User, record_id: int):
    if not form.api_detail_method:
        raise HTTPException(status_code=400, detail="No detail endpoint configured")
    server, cred = _get_credential(db, form, user)
    result = await api_request(db, server, cred, form.api_detail_method, path_params={"id": str(record_id)})
    return result


async def _proxy_update(db: Session, form: Form, user: User, record_id: int, data: dict):
    if not form.api_update_method:
        raise HTTPException(status_code=400, detail="No update endpoint configured")
    server, cred = _get_credential(db, form, user)
    result = await api_request(db, server, cred, form.api_update_method, path_params={"id": str(record_id)}, body=data)
    return result


async def _proxy_delete(db: Session, form: Form, user: User, record_id: int):
    if not form.api_delete_method:
        raise HTTPException(status_code=400, detail="No delete endpoint configured")
    server, cred = _get_credential(db, form, user)
    result = await api_request(db, server, cred, form.api_delete_method, path_params={"id": str(record_id)})
    return result


# --- Public routes ---

public_router = APIRouter(
    prefix="/api/forms",
    tags=["forms"],
)


@public_router.get("/{slug}")
def get_public_form(
    slug: str,
    db: Session = Depends(get_db),
):
    form = db.query(Form).filter(Form.slug == slug, Form.is_published == True).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found or not published")
    fields = db.query(FormField).filter(
        FormField.form_id == form.id
    ).order_by(FormField.display_order.asc()).all()
    form_dict = {c.name: getattr(form, c.name) for c in form.__table__.columns}
    form_dict["fields"] = [
        {c.name: getattr(f, c.name) for c in f.__table__.columns}
        for f in fields
    ]
    return form_dict


@public_router.post("/{slug}/submit")
async def submit_form(
    slug: str,
    data: FormSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = None,
):
    form = db.query(Form).filter(Form.slug == slug, Form.is_published == True).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found or not published")

    if form.storage_type == "api":
        if not current_user:
            raise HTTPException(status_code=401, detail="Authentication required for API forms")
        if not form.api_create_method:
            raise HTTPException(status_code=400, detail="No create endpoint configured")
        server, cred = _get_credential(db, form, current_user)
        result = await api_request(db, server, cred, form.api_create_method, body=data.data)
        return {"message": "Submitted to remote API", "result": result}

    # Local storage
    submission = FormSubmission(
        form_id=form.id,
        data=data.data,
        submitter_email=data.submitter_email,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return {"message": form.success_message, "submission_id": submission.id}
```

**Step 2: Register routers in `backend/main.py`**

Add import:

```python
from app.routes.forms import admin_router as forms_admin_router, public_router as forms_public_router
```

Add include_router:

```python
app.include_router(forms_admin_router)
app.include_router(forms_public_router)
```

**Step 3: Verify via Swagger**

Open http://localhost:8000/docs — confirm form CRUD, field management, submission, and public endpoints all appear.

**Step 4: Commit**

```bash
git add backend/app/routes/forms.py backend/main.py
git commit -m "feat(forms): add form CRUD, field management, and submission routes"
```

---

## Task 7: Frontend API Client — Forms & API Servers

**Files:**
- Modify: `frontend/lib/api.ts`

**Step 1: Add API client functions**

Add to the end of `frontend/lib/api.ts`:

```typescript
// --- API Servers ---
export const apiServersApi = {
  list: () => api.get('/admin/api-servers'),
  create: (data: any) => api.post('/admin/api-servers', data),
  update: (id: number, data: any) => api.put(`/admin/api-servers/${id}`, data),
  delete: (id: number) => api.delete(`/admin/api-servers/${id}`),
  listCredentials: (id: number) => api.get(`/admin/api-servers/${id}/credentials`),
  createCredential: (id: number, data: any) => api.post(`/admin/api-servers/${id}/credentials`, data),
}

export const userApiCredsApi = {
  update: (id: number, data: any) => api.put(`/user/api-credentials/${id}`, data),
  login: (id: number) => api.post(`/user/api-credentials/${id}/login`),
}

// --- Forms ---
export const formsApi = {
  list: () => api.get('/admin/forms'),
  create: (data: any) => api.post('/admin/forms', data),
  get: (id: number) => api.get(`/admin/forms/${id}`),
  update: (id: number, data: any) => api.put(`/admin/forms/${id}`, data),
  delete: (id: number) => api.delete(`/admin/forms/${id}`),
  // Fields
  listFields: (formId: number) => api.get(`/admin/forms/${formId}/fields`),
  createField: (formId: number, data: any) => api.post(`/admin/forms/${formId}/fields`, data),
  updateField: (formId: number, fieldId: number, data: any) => api.put(`/admin/forms/${formId}/fields/${fieldId}`, data),
  deleteField: (formId: number, fieldId: number) => api.delete(`/admin/forms/${formId}/fields/${fieldId}`),
  reorderFields: (formId: number, fieldIds: number[]) => api.put(`/admin/forms/${formId}/fields/reorder`, { field_ids: fieldIds }),
  // Submissions
  listSubmissions: (formId: number, skip = 0, limit = 50) => api.get(`/admin/forms/${formId}/submissions`, { params: { skip, limit } }),
  getSubmission: (formId: number, subId: number) => api.get(`/admin/forms/${formId}/submissions/${subId}`),
  updateSubmission: (formId: number, subId: number, data: any) => api.put(`/admin/forms/${formId}/submissions/${subId}`, data),
  deleteSubmission: (formId: number, subId: number) => api.delete(`/admin/forms/${formId}/submissions/${subId}`),
  exportSubmissions: (formId: number) => api.get(`/admin/forms/${formId}/submissions/export`, { responseType: 'blob' }),
  // Public
  getPublicForm: (slug: string) => api.get(`/forms/${slug}`),
  submitForm: (slug: string, data: any) => api.post(`/forms/${slug}/submit`, data),
}
```

**Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(forms): add formsApi and apiServersApi client functions"
```

---

## Task 8: Frontend — Admin Nav Entry

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Add form builder entries to AdminNav**

Find the `Applications` group in `sidebarGroups` and add these entries:

```typescript
{ href: '/admin/api-servers', label: 'API Servers', icon: '🔌', permission: () => hasAdminFeature('manage_forms') },
{ href: '/admin/forms', label: 'Form Pages', icon: '📋', permission: () => hasAdminFeature('manage_forms') },
```

**Step 2: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat(forms): add API Servers and Form Pages to admin nav"
```

---

## Task 9: Frontend — API Servers Admin Page

**Files:**
- Create: `frontend/app/admin/api-servers/page.tsx`

**Step 1: Create the page**

Build the API server management page following the existing admin page pattern (see `roles/page.tsx`). The page should:

- List all API servers as cards showing name, base_url, auth_type
- "+ New Server" button opens a create/edit modal with all ApiServer fields
- Edit/delete buttons per server
- Expandable section per server to manage user credentials (assign username/password per user)
- Test connection button (calls the test endpoint — can be added later)
- Use `apiServersApi` from `lib/api.ts`
- Layout: `<div className="ml-60 pt-14">` with `<MainHeader>` and `<AdminNav>`

**Step 2: Verify in browser**

Navigate to http://localhost:3000/admin/api-servers — page should load, CRUD should work.

**Step 3: Commit**

```bash
git add frontend/app/admin/api-servers/page.tsx
git commit -m "feat(forms): add API Servers admin page"
```

---

## Task 10: Frontend — Form List Admin Page

**Files:**
- Create: `frontend/app/admin/forms/page.tsx`

**Step 1: Create the page**

Build the form list page matching the reference screenshot. Features:

- Card layout per form showing: title, Published/Draft badge, submission count badge, slug, description, posted date
- Action buttons per card: "Fields" (link to /admin/forms/[id]/fields), "Submissions" (link to /admin/forms/[id]/submissions), preview (external link icon opens /forms/[slug] in new tab), edit (opens edit modal), delete
- "+ Create Form" button opens modal with:
  - Form Title (required)
  - URL Slug (auto-generated from title, editable) with `/forms/` prefix shown
  - Description (textarea)
  - Success Message (textarea, default "Thank you for your submission!")
  - Storage Type: radio/toggle — "Local Database" or "API"
  - If API selected: dropdown to pick API server, then text fields for api_create_method, api_list_method, api_detail_method, api_update_method, api_delete_method
  - Publish form toggle
  - Require OTP Verification toggle
- Edit modal: same as create, pre-populated
- Delete: confirm dialog
- Use `formsApi` from `lib/api.ts`

**Step 2: Verify in browser**

Navigate to http://localhost:3000/admin/forms — create a local form, verify it appears in the list.

**Step 3: Commit**

```bash
git add frontend/app/admin/forms/page.tsx
git commit -m "feat(forms): add Form List admin page with create/edit/delete"
```

---

## Task 11: Frontend — Field Builder Page

**Files:**
- Create: `frontend/app/admin/forms/[id]/fields/page.tsx`

**Step 1: Create the page**

Build the field builder matching the reference screenshots. Features:

- Header: "Form Fields" with form title, "Manage the fields for this form"
- "+ Add Field" button
- Ordered list of field cards, each showing:
  - Drag handle (6-dot icon) on left
  - Field label (bold), *Required badge (red text) if required
  - "Type: {field_type}" text
  - For dropdown/checkbox: "Options: {comma-separated values}"
  - Placeholder text if set
  - Move up/down arrows, edit button, delete button (trash icon, red)
- Add/Edit Field modal:
  - Field Label (required text input)
  - Field Key (auto-generated from label by lowercasing + replacing spaces with underscores)
  - Field Type dropdown with all 13 types: Text Input, Number, Text Area, Email, URL, Date, Time, Dropdown Select, Dropdown (API), Checkbox, Checkbox (API), Yes/No, True/False
  - Placeholder Text (shown for text/number/email/url/textarea)
  - Type-specific validation fields:
    - Text: Min Length, Max Length, Pattern (dropdown: none, alpha, alphanumeric, alpha_special)
    - Number: Default Value, Min Value, Max Value
    - Date: Min Date, Max Date (date pickers)
    - Time: Min Time, Max Time (time pickers)
    - Checkbox/Checkbox API: Min Selections, Max Selections
  - Options editor (for dropdown/checkbox): dynamic list of key:value pairs with add/remove
  - API config (for dropdown_api/checkbox_api): API Endpoint URL, Value Key, Label Key
  - Required field toggle
  - "Show this field only when:" section:
    - Field dropdown (lists all OTHER fields in this form by label)
    - Condition dropdown: is equal to, is not equal to, <, <=, >, >=
    - Value text input
    - "+ Add Condition" button for multiple conditions
    - Red X to remove a condition
- Use `formsApi.listFields`, `createField`, `updateField`, `deleteField`, `reorderFields`

**Step 2: Verify in browser**

Navigate to http://localhost:3000/admin/forms/1/fields — add fields of various types, test conditional logic config.

**Step 3: Commit**

```bash
git add frontend/app/admin/forms/\[id\]/fields/page.tsx
git commit -m "feat(forms): add Field Builder page with all 13 field types"
```

---

## Task 12: Frontend — Submissions Page

**Files:**
- Create: `frontend/app/admin/forms/[id]/submissions/page.tsx`

**Step 1: Create the page**

Build the submissions management page. Features:

- Header: Form title + "Submissions"
- For local forms:
  - Paginated table with columns based on form fields (field_label as header, field_key to read data)
  - ID, Submitted At, Email columns always shown
  - Click row → detail modal showing all field values
  - Edit button → opens form pre-filled with submission data, updates on save
  - Delete button with confirmation
  - "Export CSV" button (calls exportSubmissions, triggers download)
- For API forms:
  - Same table layout but columns from `form.api_list_columns`
  - Data fetched via proxy endpoint
  - If 401 response with "login_required" → show API Login Modal
  - Edit/delete also proxied
- API Login Modal component:
  - Username + password fields
  - Calls `userApiCredsApi.login(credId)`
  - On success: retries original action
  - On failure: shows error

**Step 2: Verify in browser**

Create a form, add fields, submit via Swagger, then check submissions page.

**Step 3: Commit**

```bash
git add frontend/app/admin/forms/\[id\]/submissions/page.tsx
git commit -m "feat(forms): add Submissions page with table, detail, edit, export"
```

---

## Task 13: Frontend — Public Form Renderer

**Files:**
- Create: `frontend/app/forms/[slug]/page.tsx`

**Step 1: Create the public form page**

Build the form renderer accessible at `/forms/{slug}`. Features:

- Fetches form definition + fields from `GET /api/forms/{slug}`
- If form not found or not published → 404 page
- Renders form title, description
- Dynamically renders each field based on `field_type`:
  - `text`: `<input type="text">` with placeholder, min/max length attributes
  - `number`: `<input type="number">` with min/max, default value
  - `textarea`: `<textarea>` with placeholder
  - `email`: `<input type="email">`
  - `url`: `<input type="url">`
  - `date`: `<input type="date">` with min/max attributes
  - `time`: `<input type="time">` with min/max attributes
  - `dropdown`: `<select>` with options from field.options
  - `dropdown_api`: `<select>` that fetches options from field.api_endpoint on mount
  - `checkbox`: group of `<input type="checkbox">` from field.options
  - `checkbox_api`: same but fetches from API
  - `yes_no`: two radio buttons (Yes/No)
  - `true_false`: two radio buttons (True/False)
- Conditional visibility: evaluate each field's `condition` array against current form values. Use `useEffect` or computed state. Hidden fields not rendered and excluded from validation/submission.
- Client-side validation:
  - Required fields checked
  - Text: min/max length, pattern regex
  - Number: min/max value
  - Email: regex validation (if not empty)
  - URL: regex validation (if not empty)
  - Date: min/max date
  - Time: min/max time
  - Checkbox: min/max selections
- Submit button → `POST /api/forms/{slug}/submit` with `{data: {field_key: value, ...}}`
- OTP flow (if form.require_otp): show email input → send OTP → verify → then submit (can leverage existing OTP logic)
- Success state: show `form.success_message`

**Step 2: Verify in browser**

Navigate to http://localhost:3000/forms/{your-slug} — fill and submit.

**Step 3: Commit**

```bash
git add frontend/app/forms/\[slug\]/page.tsx
git commit -m "feat(forms): add public form renderer with validation and conditions"
```

---

## Task 14: Integration — Wire Everything Together

**Files:**
- Modify: `backend/main.py` (ensure all imports and include_router calls are in place)
- Modify: `frontend/components/AdminNav.tsx` (verify nav entries)

**Step 1: Verify backend startup**

Restart backend — all tables created, all routes registered, Swagger shows everything.

**Step 2: End-to-end test — local form**

1. Create API server in admin (optional for this test)
2. Create a local form via admin
3. Add fields of various types
4. Publish the form
5. Open public form URL → fill → submit
6. Check submissions page → data appears
7. Export CSV → download works
8. Edit a submission → save → verify
9. Delete a submission → confirm → verify

**Step 3: End-to-end test — API form (if external API available)**

1. Create API server with OMS credentials
2. Assign user credentials
3. Create API-backed form, configure CRUD endpoints
4. Add fields mapped to API variables
5. Test list/create/detail/update/delete flow

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(forms): complete dynamic form builder integration"
```

---

## Summary

| Task | Component | Description |
|---|---|---|
| 1 | Backend Models | ApiServer, UserApiCredential models + migrations |
| 2 | Backend Models | Form, FormField, FormSubmission models + migrations |
| 3 | Backend Schemas | Pydantic schemas for all models |
| 4 | Backend Service | API proxy service (auth, request, response) |
| 5 | Backend Routes | API server + credential management endpoints |
| 6 | Backend Routes | Form CRUD, fields, submissions, public endpoints |
| 7 | Frontend API | formsApi, apiServersApi client functions |
| 8 | Frontend Nav | AdminNav entries for API Servers + Form Pages |
| 9 | Frontend Page | API Servers admin page |
| 10 | Frontend Page | Form List admin page (create/edit/delete) |
| 11 | Frontend Page | Field Builder page (all 13 types + conditions) |
| 12 | Frontend Page | Submissions page (table, detail, edit, export) |
| 13 | Frontend Page | Public form renderer (validation, conditions, OTP) |
| 14 | Integration | Wire together, end-to-end testing |
