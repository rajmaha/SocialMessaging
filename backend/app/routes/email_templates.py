from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.email_template import CampaignEmailTemplate
from app.schemas.email_template import EmailTemplateCreate, EmailTemplateUpdate, EmailTemplateResponse
from app.dependencies import get_current_user
from app.models.user import User

router = APIRouter(prefix="/email-templates", tags=["email-templates"])


@router.get("/", response_model=List[EmailTemplateResponse])
def list_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(CampaignEmailTemplate).order_by(
        CampaignEmailTemplate.is_preset.desc(), CampaignEmailTemplate.created_at.desc()
    ).all()


@router.get("/{template_id}", response_model=EmailTemplateResponse)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = db.query(CampaignEmailTemplate).filter(CampaignEmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return t


@router.post("/", response_model=EmailTemplateResponse)
def create_template(
    data: EmailTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    t = CampaignEmailTemplate(**data.model_dump(), is_preset=False)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/{template_id}", response_model=EmailTemplateResponse)
def update_template(
    template_id: int,
    data: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    t = db.query(CampaignEmailTemplate).filter(CampaignEmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if t.is_preset:
        raise HTTPException(status_code=400, detail="Cannot edit preset templates")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(t, key, value)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    t = db.query(CampaignEmailTemplate).filter(CampaignEmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if t.is_preset:
        raise HTTPException(status_code=400, detail="Cannot delete preset templates")
    db.delete(t)
    db.commit()
    return {"status": "deleted"}
