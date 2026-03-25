from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import select, or_
from typing import List

from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.api_server import (
    ApiServer, ApiServerEndpoint, UserApiCredential,
    api_server_user_access, api_server_team_access,
)
from app.models.team import Team, team_members
from app.schemas.api_server import (
    ApiServerCreate, ApiServerUpdate, ApiServerResponse,
    UserApiCredentialCreate, UserApiCredentialUpdate, UserApiCredentialResponse,
    ApiLoginRequest, ApiServerPublicResponse, UserApiCredentialSelfCreate,
)
from app.services.api_proxy import api_login
from app.services.spec_parser import parse_spec
import json

router = APIRouter(
    prefix="/admin/api-servers",
    tags=["admin", "api_servers"],
)

require_manage_forms = require_admin_feature("feature_manage_forms")


# --- Helper: get server IDs accessible by a user ---
def get_accessible_server_ids(db: Session, user: User) -> set:
    """Return set of api_server IDs the user can access (via direct assignment or team membership)."""
    # Direct user access
    user_rows = db.execute(
        select(api_server_user_access.c.api_server_id).where(
            api_server_user_access.c.user_id == user.id
        )
    ).all()
    ids = {r[0] for r in user_rows}

    # Team-based access: find teams user belongs to, then servers assigned to those teams
    user_team_ids = db.execute(
        select(team_members.c.team_id).where(team_members.c.user_id == user.id)
    ).all()
    user_team_ids = [r[0] for r in user_team_ids]
    if user_team_ids:
        team_rows = db.execute(
            select(api_server_team_access.c.api_server_id).where(
                api_server_team_access.c.team_id.in_(user_team_ids)
            )
        ).all()
        ids.update(r[0] for r in team_rows)

    return ids


# ==================== Admin Routes ====================

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
    db.execute(api_server_user_access.delete().where(api_server_user_access.c.api_server_id == server_id))
    db.execute(api_server_team_access.delete().where(api_server_team_access.c.api_server_id == server_id))
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


@router.get("/{server_id}/credentials")
def list_user_credentials(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    creds = db.query(UserApiCredential).filter(
        UserApiCredential.api_server_id == server_id
    ).all()
    result = []
    for cred in creds:
        u = db.query(User).filter(User.id == cred.user_id).first()
        result.append({
            "id": cred.id,
            "user_id": cred.user_id,
            "api_server_id": cred.api_server_id,
            "username": cred.username,
            "is_active": cred.is_active,
            "token_expires_at": cred.token_expires_at,
            "user_name": u.full_name or u.email if u else None,
        })
    return result


@router.put("/credentials/{cred_id}")
def admin_update_credential(
    cred_id: int,
    data: UserApiCredentialUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    cred = db.query(UserApiCredential).filter(UserApiCredential.id == cred_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    update_data = data.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(cred, key, val)
    # Reset token so next request triggers fresh login
    cred.token = None
    cred.is_active = False
    db.commit()
    db.refresh(cred)
    return cred


@router.delete("/credentials/{cred_id}")
def admin_delete_credential(
    cred_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    cred = db.query(UserApiCredential).filter(UserApiCredential.id == cred_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    db.delete(cred)
    db.commit()
    return {"message": "Credential deleted"}


@router.post("/credentials/{cred_id}/test")
async def admin_test_credential(
    cred_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    cred = db.query(UserApiCredential).filter(UserApiCredential.id == cred_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    server = db.query(ApiServer).filter(ApiServer.id == cred.api_server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")
    try:
        token = await api_login(db, server, cred)
        return {"message": "Login successful", "token": token}
    except HTTPException:
        cred.is_active = False
        db.commit()
        raise
    except Exception as e:
        cred.is_active = False
        db.commit()
        raise HTTPException(status_code=401, detail=f"Login failed: {str(e)}")


# --- Access Control ---

@router.get("/{server_id}/access")
def get_server_access(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    server = db.query(ApiServer).filter(ApiServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")

    user_rows = db.execute(
        select(api_server_user_access.c.user_id).where(
            api_server_user_access.c.api_server_id == server_id
        )
    ).all()
    user_ids = [r[0] for r in user_rows]

    team_rows = db.execute(
        select(api_server_team_access.c.team_id).where(
            api_server_team_access.c.api_server_id == server_id
        )
    ).all()
    team_ids = [r[0] for r in team_rows]

    return {"user_ids": user_ids, "team_ids": team_ids}


@router.put("/{server_id}/access")
def update_server_access(
    server_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    """Update access for a server. Body: { user_ids: [int], team_ids: [int] }"""
    server = db.query(ApiServer).filter(ApiServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")

    user_ids = data.get("user_ids", [])
    team_ids = data.get("team_ids", [])

    # Replace user access
    db.execute(api_server_user_access.delete().where(
        api_server_user_access.c.api_server_id == server_id
    ))
    for uid in user_ids:
        db.execute(api_server_user_access.insert().values(api_server_id=server_id, user_id=uid))

    # Replace team access
    db.execute(api_server_team_access.delete().where(
        api_server_team_access.c.api_server_id == server_id
    ))
    for tid in team_ids:
        db.execute(api_server_team_access.insert().values(api_server_id=server_id, team_id=tid))

    db.commit()
    return {"message": "Access updated", "user_ids": user_ids, "team_ids": team_ids}


# --- Spec Upload & Endpoint Management ---

@router.post("/{server_id}/spec")
async def upload_spec(
    server_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_manage_forms),
):
    """Upload and parse a Swagger/OpenAPI or Postman Collection JSON file."""
    server = db.query(ApiServer).filter(ApiServer.id == server_id).first()
    if not server:
        raise HTTPException(404, "API Server not found")

    try:
        content = await file.read()
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON file")

    try:
        parsed_endpoints = parse_spec(data)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not parsed_endpoints:
        raise HTTPException(400, "No endpoints found in the spec file")

    # Deduplicate parsed endpoints (last occurrence wins for same path+method)
    seen = {}
    for ep in parsed_endpoints:
        key = (ep["path"], ep["method"])
        seen[key] = ep
    parsed_endpoints = list(seen.values())

    # Upsert endpoints
    created_or_updated = []
    for ep in parsed_endpoints:
        existing = db.query(ApiServerEndpoint).filter(
            ApiServerEndpoint.api_server_id == server_id,
            ApiServerEndpoint.path == ep["path"],
            ApiServerEndpoint.method == ep["method"],
        ).first()

        if existing:
            existing.summary = ep["summary"]
            existing.fields = ep["fields"]
            existing.source_type = ep["source_type"]
            created_or_updated.append(existing)
        else:
            new_ep = ApiServerEndpoint(
                api_server_id=server_id,
                path=ep["path"],
                method=ep["method"],
                summary=ep["summary"],
                fields=ep["fields"],
                source_type=ep["source_type"],
            )
            db.add(new_ep)
            db.flush()
            created_or_updated.append(new_ep)

    server.spec_file_name = file.filename
    db.commit()

    # Refresh to get IDs
    for ep in created_or_updated:
        db.refresh(ep)

    return {
        "message": f"Parsed {len(created_or_updated)} endpoints from {file.filename}",
        "spec_file_name": file.filename,
        "endpoints_count": len(created_or_updated),
        "endpoints": [
            {
                "id": ep.id,
                "api_server_id": ep.api_server_id,
                "path": ep.path,
                "method": ep.method,
                "summary": ep.summary,
                "fields": ep.fields,
                "source_type": ep.source_type,
                "created_at": ep.created_at.isoformat() if ep.created_at else None,
            }
            for ep in created_or_updated
        ],
    }


@router.get("/{server_id}/endpoints")
async def list_endpoints(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_manage_forms),
):
    """List all parsed endpoints for an API server."""
    endpoints = (
        db.query(ApiServerEndpoint)
        .filter(ApiServerEndpoint.api_server_id == server_id)
        .order_by(ApiServerEndpoint.path, ApiServerEndpoint.method)
        .all()
    )
    return [
        {
            "id": ep.id,
            "api_server_id": ep.api_server_id,
            "path": ep.path,
            "method": ep.method,
            "summary": ep.summary,
            "fields": ep.fields,
            "source_type": ep.source_type,
            "created_at": ep.created_at.isoformat() if ep.created_at else None,
            "field_count": len(ep.fields) if ep.fields else 0,
        }
        for ep in endpoints
    ]


@router.get("/{server_id}/endpoints/{endpoint_id}")
async def get_endpoint(
    server_id: int,
    endpoint_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_manage_forms),
):
    """Get a single endpoint with its field definitions."""
    ep = db.query(ApiServerEndpoint).filter(
        ApiServerEndpoint.id == endpoint_id,
        ApiServerEndpoint.api_server_id == server_id,
    ).first()
    if not ep:
        raise HTTPException(404, "Endpoint not found")
    return {
        "id": ep.id,
        "api_server_id": ep.api_server_id,
        "path": ep.path,
        "method": ep.method,
        "summary": ep.summary,
        "fields": ep.fields,
        "source_type": ep.source_type,
        "created_at": ep.created_at.isoformat() if ep.created_at else None,
    }


@router.delete("/{server_id}/endpoints/{endpoint_id}")
async def delete_endpoint(
    server_id: int,
    endpoint_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_manage_forms),
):
    """Delete a parsed endpoint."""
    ep = db.query(ApiServerEndpoint).filter(
        ApiServerEndpoint.id == endpoint_id,
        ApiServerEndpoint.api_server_id == server_id,
    ).first()
    if not ep:
        raise HTTPException(404, "Endpoint not found")
    db.delete(ep)
    db.commit()
    return {"message": "Endpoint deleted"}


# ==================== User-facing credential routes ====================

user_router = APIRouter(
    prefix="/user/api-credentials",
    tags=["user", "api_credentials"],
)


@user_router.get("/servers", response_model=List[ApiServerPublicResponse])
def list_api_servers_for_user(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List only API servers the current user has access to (via user or team assignment).
    If no access rules exist for a server, it is hidden from users."""
    accessible_ids = get_accessible_server_ids(db, current_user)
    if not accessible_ids:
        return []
    return db.query(ApiServer).filter(ApiServer.id.in_(accessible_ids)).order_by(ApiServer.id).all()


@user_router.get("", response_model=List[UserApiCredentialResponse])
def list_own_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(UserApiCredential).filter(
        UserApiCredential.user_id == current_user.id
    ).all()


@user_router.post("", response_model=UserApiCredentialResponse)
def create_own_credential(
    data: UserApiCredentialSelfCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = db.query(ApiServer).filter(ApiServer.id == data.api_server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="API Server not found")
    # Check access
    accessible_ids = get_accessible_server_ids(db, current_user)
    if data.api_server_id not in accessible_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this API server")
    existing = db.query(UserApiCredential).filter(
        UserApiCredential.user_id == current_user.id,
        UserApiCredential.api_server_id == data.api_server_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Credential already exists for this server")
    cred = UserApiCredential(
        user_id=current_user.id,
        api_server_id=data.api_server_id,
        username=data.username,
        password=data.password,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return cred


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
    cred.token = None
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
    except HTTPException:
        cred.is_active = False
        db.commit()
        raise
    except Exception as e:
        cred.is_active = False
        db.commit()
        raise HTTPException(status_code=401, detail=f"Login failed: {str(e)}")
