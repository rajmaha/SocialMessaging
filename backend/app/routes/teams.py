from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from app.database import get_db
from app.models.team import Team
from app.models.user import User
from app.dependencies import get_current_user
from app.routes.admin import check_permission

router = APIRouter(prefix="/teams", tags=["teams"])


class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None
    member_ids: List[int] = []


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    member_ids: Optional[List[int]] = None


def _team_out(t: Team):
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "members": [{"id": m.id, "full_name": m.full_name or m.username, "role": m.role} for m in t.members],
    }


@router.get("/")
def list_teams(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return [_team_out(t) for t in db.query(Team).order_by(Team.name).all()]


@router.post("/")
def create_team(body: TeamCreate, db: Session = Depends(get_db), current_user: dict = Depends(check_permission("feature_manage_teams"))):
    if db.query(Team).filter(Team.name == body.name).first():
        raise HTTPException(status_code=400, detail="Team name already exists")
    members = db.query(User).filter(User.id.in_(body.member_ids), User.is_active == True).all() if body.member_ids else []
    team = Team(name=body.name, description=body.description, members=members)
    db.add(team)
    db.commit()
    db.refresh(team)
    return _team_out(team)


@router.put("/{team_id}")
def update_team(team_id: int, body: TeamUpdate, db: Session = Depends(get_db), current_user: dict = Depends(check_permission("feature_manage_teams"))):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if body.name is not None:
        team.name = body.name
    if body.description is not None:
        team.description = body.description
    if body.member_ids is not None:
        team.members = db.query(User).filter(User.id.in_(body.member_ids), User.is_active == True).all()
    db.commit()
    db.refresh(team)
    return _team_out(team)


@router.delete("/{team_id}")
def delete_team(team_id: int, db: Session = Depends(get_db), current_user: dict = Depends(check_permission("feature_manage_teams"))):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    db.delete(team)
    db.commit()
    return {"success": True}
