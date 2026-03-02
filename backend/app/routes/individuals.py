from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.individual import Individual
from app.schemas.individual import IndividualCreate, IndividualUpdate, IndividualResponse
from app.dependencies import get_current_user, require_module
from app.models.user import User

router = APIRouter(prefix="/individuals", tags=["individuals"])

require_individuals = require_module("module_individuals")

@router.post("/", response_model=IndividualResponse)
def create_individual(
    individual: IndividualCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    db_individual = Individual(**individual.model_dump())
    db.add(db_individual)
    db.commit()
    db.refresh(db_individual)
    return db_individual

@router.get("/", response_model=List[IndividualResponse])
def list_individuals(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    query = db.query(Individual)
    if search:
        query = query.filter(Individual.full_name.ilike(f"%{search}%"))
    return query.offset(skip).limit(limit).all()

@router.get("/{individual_id}", response_model=IndividualResponse)
def get_individual(
    individual_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    individual = db.query(Individual).filter(Individual.id == individual_id).first()
    if not individual:
        raise HTTPException(status_code=404, detail="Individual not found")
    return individual

@router.put("/{individual_id}", response_model=IndividualResponse)
def update_individual(
    individual_id: int,
    individual_update: IndividualUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    db_individual = db.query(Individual).filter(Individual.id == individual_id).first()
    if not db_individual:
        raise HTTPException(status_code=404, detail="Individual not found")

    update_data = individual_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_individual, key, value)

    db.commit()
    db.refresh(db_individual)
    return db_individual

@router.delete("/{individual_id}")
def delete_individual(
    individual_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    db_individual = db.query(Individual).filter(Individual.id == individual_id).first()
    if not db_individual:
        raise HTTPException(status_code=404, detail="Individual not found")

    db.delete(db_individual)
    db.commit()
    return {"status": "success", "message": "Individual deleted"}
