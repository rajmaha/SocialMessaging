from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.menu import MenuGroup, MenuItem
from app.schemas.menu import (
    MenuGroupCreate, MenuGroupUpdate, MenuGroupOut,
    MenuItemCreate, MenuItemUpdate, MenuItemOut,
)
from typing import List

router = APIRouter(tags=["menus"])

# ── Helpers ─────────────────────────────────────────────────────────────

def _group_with_items(group, db):
    """Attach ordered items to a group and return as dict."""
    items = db.query(MenuItem).filter(
        MenuItem.group_id == group.id
    ).order_by(MenuItem.display_order).all()
    d = {c.name: getattr(group, c.name) for c in group.__table__.columns}
    d["items"] = [
        {c.name: getattr(item, c.name) for c in item.__table__.columns}
        for item in items
    ]
    return d

# ── Public ──────────────────────────────────────────────────────────────

@router.get("/menu", response_model=List[MenuGroupOut])
def get_public_menus(db: Session = Depends(get_db)):
    groups = db.query(MenuGroup).filter(
        MenuGroup.is_active == True,
        MenuGroup.public_access == True,
    ).order_by(MenuGroup.display_order).all()
    return [_group_with_items(g, db) for g in groups]

# ── Internal (logged-in) ────────────────────────────────────────────────

@router.get("/menu/all", response_model=List[MenuGroupOut])
def get_all_menus(db: Session = Depends(get_db), _=Depends(get_current_user)):
    groups = db.query(MenuGroup).filter(
        MenuGroup.is_active == True,
    ).order_by(MenuGroup.display_order).all()
    return [_group_with_items(g, db) for g in groups]

# ── Admin: Groups ───────────────────────────────────────────────────────

_perm = require_admin_feature("manage_menus")

@router.get("/admin/menu-groups", response_model=List[MenuGroupOut])
def list_groups(db: Session = Depends(get_db), _=Depends(_perm)):
    groups = db.query(MenuGroup).order_by(MenuGroup.display_order).all()
    return [_group_with_items(g, db) for g in groups]

@router.post("/admin/menu-groups", response_model=MenuGroupOut)
def create_group(data: MenuGroupCreate, db: Session = Depends(get_db), user=Depends(_perm)):
    if db.query(MenuGroup).filter(MenuGroup.slug == data.slug).first():
        raise HTTPException(400, "A menu group with that slug already exists")
    group = MenuGroup(**data.model_dump(), created_by=user.id)
    db.add(group)
    db.commit()
    db.refresh(group)
    return _group_with_items(group, db)

@router.put("/admin/menu-groups/{group_id}", response_model=MenuGroupOut)
def update_group(group_id: int, data: MenuGroupUpdate, db: Session = Depends(get_db), _=Depends(_perm)):
    group = db.query(MenuGroup).filter(MenuGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Menu group not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(group, k, v)
    db.commit()
    db.refresh(group)
    return _group_with_items(group, db)

@router.delete("/admin/menu-groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db), _=Depends(_perm)):
    group = db.query(MenuGroup).filter(MenuGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Menu group not found")
    db.delete(group)
    db.commit()
    return {"ok": True}

@router.put("/admin/menu-groups/reorder")
def reorder_groups(body: dict, db: Session = Depends(get_db), _=Depends(_perm)):
    group_ids = body.get("group_ids", [])
    for order, gid in enumerate(group_ids):
        db.query(MenuGroup).filter(MenuGroup.id == gid).update({"display_order": order})
    db.commit()
    return {"ok": True}

# ── Admin: Items ────────────────────────────────────────────────────────

@router.post("/admin/menu-groups/{group_id}/items", response_model=MenuItemOut)
def create_item(group_id: int, data: MenuItemCreate, db: Session = Depends(get_db), _=Depends(_perm)):
    group = db.query(MenuGroup).filter(MenuGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Menu group not found")
    item = MenuItem(**data.model_dump(), group_id=group_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

@router.put("/admin/menu-groups/{group_id}/items/{item_id}", response_model=MenuItemOut)
def update_item(group_id: int, item_id: int, data: MenuItemUpdate, db: Session = Depends(get_db), _=Depends(_perm)):
    item = db.query(MenuItem).filter(MenuItem.id == item_id, MenuItem.group_id == group_id).first()
    if not item:
        raise HTTPException(404, "Menu item not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item

@router.delete("/admin/menu-groups/{group_id}/items/{item_id}")
def delete_item(group_id: int, item_id: int, db: Session = Depends(get_db), _=Depends(_perm)):
    item = db.query(MenuItem).filter(MenuItem.id == item_id, MenuItem.group_id == group_id).first()
    if not item:
        raise HTTPException(404, "Menu item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}

@router.put("/admin/menu-groups/{group_id}/items/reorder")
def reorder_items(group_id: int, body: dict, db: Session = Depends(get_db), _=Depends(_perm)):
    item_ids = body.get("item_ids", [])
    for order, iid in enumerate(item_ids):
        db.query(MenuItem).filter(MenuItem.id == iid, MenuItem.group_id == group_id).update({"display_order": order})
    db.commit()
    return {"ok": True}
