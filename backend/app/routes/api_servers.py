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
    prefix="/admin/api-servers",
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
    prefix="/user/api-credentials",
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
    except Exception as e:
        cred.is_active = False
        db.commit()
        raise HTTPException(status_code=401, detail=f"Login failed: {str(e)}")
