from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, get_admin_user
from app.models.role import Role
from app.schemas.role import RoleCreate, RoleUpdate, RoleOut
from typing import List

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Any logged-in user can list roles (needed for user management dropdowns)."""
    return db.query(Role).order_by(Role.id).all()


@router.post("", response_model=RoleOut)
def create_role(data: RoleCreate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    if db.query(Role).filter(Role.slug == data.slug).first():
        raise HTTPException(400, "A role with that slug already exists")
    role = Role(name=data.name, slug=data.slug, pages=data.pages, is_system=False)
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.put("/{role_id}", response_model=RoleOut)
def update_role(role_id: int, data: RoleUpdate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    if role.is_system:
        raise HTTPException(403, "System roles cannot be modified")
    if data.name is not None:
        role.name = data.name
    if data.pages is not None:
        role.pages = data.pages
    db.commit()
    db.refresh(role)
    return role


@router.delete("/{role_id}")
def delete_role(role_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    if role.is_system:
        raise HTTPException(403, "System roles cannot be deleted")
    from app.models.user import User
    db.query(User).filter(User.role == role.slug).update({"role": "viewer"})
    db.delete(role)
    db.commit()
    return {"ok": True}
