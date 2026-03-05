from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_admin_user
from app.models.user_permission_override import UserPermissionOverride
from app.schemas.user_permission_override import OverrideCreate, OverrideUpdate, OverrideOut
from typing import List

router = APIRouter(prefix="/admin/permission-overrides", tags=["permission-overrides"])


@router.get("/{user_id}", response_model=List[OverrideOut])
def list_overrides(user_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    return db.query(UserPermissionOverride).filter(
        UserPermissionOverride.user_id == user_id
    ).order_by(UserPermissionOverride.module_key).all()


@router.post("", response_model=OverrideOut)
def create_override(data: OverrideCreate, db: Session = Depends(get_db), admin=Depends(get_admin_user)):
    existing = db.query(UserPermissionOverride).filter(
        UserPermissionOverride.user_id == data.user_id,
        UserPermissionOverride.module_key == data.module_key
    ).first()
    if existing:
        raise HTTPException(400, f"Override for module '{data.module_key}' already exists for this user")
    override = UserPermissionOverride(
        user_id=data.user_id,
        module_key=data.module_key,
        granted_actions=data.granted_actions,
        revoked_actions=data.revoked_actions,
        granted_by=admin.id,
    )
    db.add(override)
    db.commit()
    db.refresh(override)
    return override


@router.put("/{override_id}", response_model=OverrideOut)
def update_override(override_id: int, data: OverrideUpdate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    ov = db.query(UserPermissionOverride).filter(UserPermissionOverride.id == override_id).first()
    if not ov:
        raise HTTPException(404, "Override not found")
    if data.granted_actions is not None:
        ov.granted_actions = data.granted_actions
    if data.revoked_actions is not None:
        ov.revoked_actions = data.revoked_actions
    db.commit()
    db.refresh(ov)
    return ov


@router.delete("/{override_id}")
def delete_override(override_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    ov = db.query(UserPermissionOverride).filter(UserPermissionOverride.id == override_id).first()
    if not ov:
        raise HTTPException(404, "Override not found")
    db.delete(ov)
    db.commit()
    return {"ok": True}
