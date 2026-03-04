from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from app.database import get_db
from app.models.organization import Organization, OrganizationContact
from app.models.crm import Lead
from app.models.user import User
from app.schemas.crm_organizations import (
    OrganizationCreate, OrganizationUpdate, OrganizationResponse,
    OrganizationDetailResponse, OrganizationContactCreate, OrganizationContactUpdate,
    OrganizationContactResponse,
)
from app.schemas.crm import LeadResponse
from app.dependencies import get_current_user

router = APIRouter(prefix="/crm/organizations", tags=["crm-organizations"])


@router.get("", response_model=list[OrganizationResponse])
def list_organizations(
    search: str = Query(None),
    industry: str = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Organization).filter(Organization.is_active == 1)
    if search:
        query = query.filter(Organization.organization_name.ilike(f"%{search}%"))
    if industry:
        query = query.filter(Organization.industry == industry)

    orgs = query.order_by(desc(Organization.created_at)).offset(skip).limit(limit).all()

    result = []
    for org in orgs:
        lead_count = db.query(func.count(Lead.id)).filter(Lead.organization_id == org.id).scalar() or 0
        contact_count = db.query(func.count(OrganizationContact.id)).filter(OrganizationContact.organization_id == org.id).scalar() or 0
        d = OrganizationResponse.model_validate(org)
        d.lead_count = lead_count
        d.contact_count = contact_count
        result.append(d)
    return result


@router.post("", response_model=OrganizationResponse)
def create_organization(
    org: OrganizationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_org = Organization(**org.model_dump())
    db.add(db_org)
    db.commit()
    db.refresh(db_org)
    d = OrganizationResponse.model_validate(db_org)
    d.lead_count = 0
    d.contact_count = 0
    return d


@router.get("/{org_id}", response_model=OrganizationDetailResponse)
def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    contacts = db.query(OrganizationContact).filter(OrganizationContact.organization_id == org_id).all()
    leads = db.query(Lead).filter(Lead.organization_id == org_id).all()

    d = OrganizationDetailResponse.model_validate(org)
    d.lead_count = len(leads)
    d.contact_count = len(contacts)
    d.contacts = [OrganizationContactResponse.model_validate(c) for c in contacts]
    d.leads = [LeadResponse.model_validate(l) for l in leads]
    return d


@router.patch("/{org_id}", response_model=OrganizationResponse)
def update_organization(
    org_id: int,
    org_update: OrganizationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    update_data = org_update.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(org, k, v)
    db.commit()
    db.refresh(org)

    lead_count = db.query(func.count(Lead.id)).filter(Lead.organization_id == org_id).scalar() or 0
    contact_count = db.query(func.count(OrganizationContact.id)).filter(OrganizationContact.organization_id == org_id).scalar() or 0
    d = OrganizationResponse.model_validate(org)
    d.lead_count = lead_count
    d.contact_count = contact_count
    return d


@router.delete("/{org_id}")
def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    lead_count = db.query(func.count(Lead.id)).filter(Lead.organization_id == org_id).scalar() or 0
    if lead_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {lead_count} lead(s) linked to this organization")
    db.delete(org)
    db.commit()
    return {"ok": True}


@router.post("/{org_id}/contacts", response_model=OrganizationContactResponse)
def add_contact(
    org_id: int,
    contact: OrganizationContactCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    db_contact = OrganizationContact(organization_id=org_id, **contact.model_dump())
    db.add(db_contact)
    db.commit()
    db.refresh(db_contact)
    return db_contact


@router.patch("/{org_id}/contacts/{contact_id}", response_model=OrganizationContactResponse)
def update_contact(
    org_id: int,
    contact_id: int,
    contact_update: OrganizationContactUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contact = db.query(OrganizationContact).filter(
        OrganizationContact.id == contact_id,
        OrganizationContact.organization_id == org_id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for k, v in contact_update.model_dump(exclude_unset=True).items():
        setattr(contact, k, v)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{org_id}/contacts/{contact_id}")
def delete_contact(
    org_id: int,
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contact = db.query(OrganizationContact).filter(
        OrganizationContact.id == contact_id,
        OrganizationContact.organization_id == org_id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"ok": True}
