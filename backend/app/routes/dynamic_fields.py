from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.dependencies import get_admin_user, get_current_user
from app.models.user import User
from app.models.dynamic_field import DynamicField
from app.schemas.dynamic_field import DynamicFieldCreate, DynamicFieldUpdate, DynamicFieldResponse

router = APIRouter(
    prefix="/api/admin/dynamic-fields",
    tags=["admin", "dynamic_fields"],
    responses={404: {"description": "Not found"}},
)

@router.post("", response_model=DynamicFieldResponse)
def create_dynamic_field(
    field_in: DynamicFieldCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Create a new dynamic field configuration for a specific application type."""
    new_field = DynamicField(**field_in.model_dump())
    db.add(new_field)
    db.commit()
    db.refresh(new_field)
    return new_field

@router.get("/{application_type}", response_model=List[DynamicFieldResponse])
def get_dynamic_fields(
    application_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all dynamic fields configured for an application type (agents need read access)."""
    fields = db.query(DynamicField).filter(
        DynamicField.application_type == application_type
    ).order_by(DynamicField.display_order.asc()).all()
    return fields

@router.put("/{field_id}", response_model=DynamicFieldResponse)
def update_dynamic_field(
    field_id: int,
    field_update: DynamicFieldUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Update an existing dynamic field."""
    field = db.query(DynamicField).filter(DynamicField.id == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Dynamic Field not found")

    update_data = field_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(field, key, value)
        
    db.commit()
    db.refresh(field)
    return field

@router.delete("/{field_id}")
def delete_dynamic_field(
    field_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Delete a dynamic field."""
    field = db.query(DynamicField).filter(DynamicField.id == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Dynamic Field not found")
        
    db.delete(field)
    db.commit()
    return {"message": "Dynamic field deleted successfully"}
