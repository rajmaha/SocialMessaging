from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, get_admin_user, get_effective_permissions
from app.models.role import Role
from app.schemas.role import RoleCreate, RoleUpdate, RoleOut
from app.permissions_registry import MODULE_REGISTRY, get_module_actions
from typing import List

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Role).order_by(Role.id).all()


@router.get("/registry")
def get_registry(db: Session = Depends(get_db)):
    """Return the module registry so frontend can render the permission matrix."""
    from app.models.menu import MenuGroup
    registry = dict(MODULE_REGISTRY)
    menu_groups = db.query(MenuGroup).filter(MenuGroup.is_active == True).all()
    for mg in menu_groups:
        registry[f"menu_{mg.slug}"] = {
            "label": mg.name,
            "actions": ["view"],
        }
    return registry


@router.get("/my-permissions")
async def my_permissions(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return effective permission matrix for the current user (role + overrides)."""
    perms = await get_effective_permissions(current_user, db)
    return {"permissions": perms}


@router.post("", response_model=RoleOut)
def create_role(data: RoleCreate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    if db.query(Role).filter(Role.slug == data.slug).first():
        raise HTTPException(400, "A role with that slug already exists")
    for mod_key, actions in data.permissions.items():
        valid_actions = get_module_actions(mod_key)
        if valid_actions:
            invalid = set(actions) - set(valid_actions)
            if invalid:
                raise HTTPException(400, f"Invalid actions {invalid} for module '{mod_key}'")
    role = Role(name=data.name, slug=data.slug, permissions=data.permissions, is_system=False)
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
        if data.permissions is not None:
            role.permissions = data.permissions
    else:
        if data.name is not None:
            role.name = data.name
        if data.permissions is not None:
            role.permissions = data.permissions
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
