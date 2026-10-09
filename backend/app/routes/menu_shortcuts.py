from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user
from app.models.menu_shortcut import UserMenuShortcut as S

router = APIRouter(prefix="/menu-shortcuts", tags=["menu-shortcuts"])

KEEP_RECENT = 20  # stored; the sidebar shows the newest 10 the user can still open
MAX_FAVORITES = 100


def _clean(path: str) -> str:
    path = (path or "").strip()
    # Internal paths only: never store a URL that leaves the app.
    if not path.startswith("/") or path.startswith("//") or len(path) > 500:
        raise HTTPException(400, "Invalid menu path")
    return path


class PathBody(BaseModel):
    path: str


class FavoriteBody(BaseModel):
    path: str
    on: bool


class OrderBody(BaseModel):
    paths: List[str]


@router.get("")
def get_shortcuts(db: Session = Depends(get_db), user=Depends(get_current_user)):
    favorites = db.query(S.path).filter(S.user_id == user.id, S.kind == "favorite") \
        .order_by(S.position, S.id).all()
    recent = db.query(S.path).filter(S.user_id == user.id, S.kind == "recent") \
        .order_by(S.visited_at.desc(), S.id.desc()).limit(KEEP_RECENT).all()
    return {"favorites": [r[0] for r in favorites], "recent": [r[0] for r in recent]}


@router.post("/favorite")
def set_favorite(body: FavoriteBody, db: Session = Depends(get_db), user=Depends(get_current_user)):
    path = _clean(body.path)
    row = db.query(S).filter(S.user_id == user.id, S.kind == "favorite", S.path == path).first()
    if body.on and not row:
        count = db.query(func.count(S.id)).filter(S.user_id == user.id, S.kind == "favorite").scalar()
        if count >= MAX_FAVORITES:
            raise HTTPException(400, f"You can keep up to {MAX_FAVORITES} favorites")
        last = db.query(func.max(S.position)).filter(S.user_id == user.id, S.kind == "favorite").scalar()
        db.add(S(user_id=user.id, kind="favorite", path=path, position=(last or 0) + 1))
    elif not body.on and row:
        db.delete(row)
    db.commit()
    return {"ok": True}


@router.put("/favorites/order")
def reorder_favorites(body: OrderBody, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = {r.path: r for r in db.query(S).filter(S.user_id == user.id, S.kind == "favorite").all()}
    pos = 0
    for p in body.paths:
        if p in rows:
            pos += 1
            rows.pop(p).position = pos
    # Favourites not listed (hidden from this user right now) keep their place at the end.
    for r in sorted(rows.values(), key=lambda r: r.position):
        pos += 1
        r.position = pos
    db.commit()
    return {"ok": True}


@router.post("/visit")
def record_visit(body: PathBody, db: Session = Depends(get_db), user=Depends(get_current_user)):
    path = _clean(body.path)
    row = db.query(S).filter(S.user_id == user.id, S.kind == "recent", S.path == path).first()
    if row:
        row.visited_at = datetime.now(timezone.utc)
    else:
        db.add(S(user_id=user.id, kind="recent", path=path, visited_at=datetime.now(timezone.utc)))
        db.flush()
        # Trim to the newest KEEP_RECENT.
        old = db.query(S.id).filter(S.user_id == user.id, S.kind == "recent") \
            .order_by(S.visited_at.desc(), S.id.desc()).offset(KEEP_RECENT).all()
        if old:
            db.query(S).filter(S.id.in_([o[0] for o in old])).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.delete("/recent")
def clear_recent(db: Session = Depends(get_db), user=Depends(get_current_user)):
    db.query(S).filter(S.user_id == user.id, S.kind == "recent").delete(synchronize_session=False)
    db.commit()
    return {"ok": True}
