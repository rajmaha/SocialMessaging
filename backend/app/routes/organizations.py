from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import uuid
import re

from app.database import get_db
from app.models.organization import Organization, OrganizationContact, Subscription, SubscriptionModule
from app.schemas.organization import (
    OrganizationCreate, OrganizationUpdate, OrganizationResponse,
    ContactCreate, ContactUpdate, ContactResponse,
    SubscriptionCreate, SubscriptionUpdate, SubscriptionResponse,
    SubscriptionModuleCreate, SubscriptionModuleUpdate, SubscriptionModuleResponse
)
from app.dependencies import get_current_user, require_module, require_admin_feature
from app.models.user import User

router = APIRouter(prefix="/organizations", tags=["organizations"])

require_orgs = require_module("module_organizations")
require_contacts = require_module("module_contacts")
require_subs = require_module("module_subscriptions")

# Subscription Module CRUD
@router.post("/subscription-modules", response_model=SubscriptionModuleResponse)
def create_subscription_module(
    module: SubscriptionModuleCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = SubscriptionModule(**module.model_dump())
    db.add(db_module)
    db.commit()
    db.refresh(db_module)
    return db_module

@router.get("/subscription-modules", response_model=List[SubscriptionModuleResponse])
def list_subscription_modules(
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    return db.query(SubscriptionModule).all()

@router.get("/subscription-modules/{module_id}", response_model=SubscriptionModuleResponse)
def get_subscription_module(
    module_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = db.query(SubscriptionModule).filter(SubscriptionModule.id == module_id).first()
    if not db_module:
        raise HTTPException(status_code=404, detail="Subscription module not found")
    return db_module

@router.put("/subscription-modules/{module_id}", response_model=SubscriptionModuleResponse)
def update_subscription_module(
    module_id: int,
    module_update: SubscriptionModuleUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = db.query(SubscriptionModule).filter(SubscriptionModule.id == module_id).first()
    if not db_module:
        raise HTTPException(status_code=404, detail="Subscription module not found")
    
    update_data = module_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_module, key, value)
    
    db.commit()
    db.refresh(db_module)
    return db_module

@router.delete("/subscription-modules/{module_id}")
def delete_subscription_module(
    module_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = db.query(SubscriptionModule).filter(SubscriptionModule.id == module_id).first()
    if not db_module:
        raise HTTPException(status_code=404, detail="Subscription module not found")
    
    db.delete(db_module)
    db.commit()
    return {"status": "success", "message": "Subscription module deleted"}

# Organization CRUD
@router.post("/", response_model=OrganizationResponse)
def create_organization(
    org: OrganizationCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = Organization(**org.model_dump())
    db.add(db_org)
    db.commit()
    db.refresh(db_org)
    return db_org

@router.get("/", response_model=List[OrganizationResponse])
def list_organizations(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    query = db.query(Organization)
    if search:
        query = query.filter(Organization.organization_name.ilike(f"%{search}%"))
    return query.offset(skip).limit(limit).all()

@router.get("/{org_id}", response_model=OrganizationResponse)
def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org

@router.put("/{org_id}", response_model=OrganizationResponse)
def update_organization(
    org_id: int,
    org_update: OrganizationUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = db.query(Organization).filter(Organization.id == org_id).first()
    if not db_org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    update_data = org_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_org, key, value)
    
    db.commit()
    db.refresh(db_org)
    return db_org

@router.delete("/{org_id}")
def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = db.query(Organization).filter(Organization.id == org_id).first()
    if not db_org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    db.delete(db_org)
    db.commit()
    return {"status": "success", "message": "Organization deleted"}


# Organization Logo Upload
@router.post("/{org_id}/logo")
async def upload_org_logo(
    org_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = db.query(Organization).filter(Organization.id == org_id).first()
    if not db_org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Save file
    safe_name = re.sub(r"[^\w\-. ]", "_", file.filename or "logo")
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"
    
    upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "logo_storage")
    os.makedirs(upload_dir, exist_ok=True)
    
    file_path = os.path.join(upload_dir, unique_name)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    db_org.logo_url = f"/logos/{unique_name}"
    db.commit()
    
    return {"url": db_org.logo_url}

# Contact CRUD
@router.post("/{org_id}/contacts", response_model=ContactResponse)
def create_organization_contact(
    org_id: int,
    contact: ContactCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    if contact.organization_id != org_id:
        raise HTTPException(status_code=400, detail="Invalid organization ID in contact data")
    
    db_contact = OrganizationContact(**contact.model_dump())
    db.add(db_contact)
    db.commit()
    db.refresh(db_contact)
    return db_contact

@router.get("/{org_id}/contacts", response_model=List[ContactResponse])
def list_organization_contacts(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    return db.query(OrganizationContact).filter(OrganizationContact.organization_id == org_id).all()

@router.put("/contacts/{contact_id}", response_model=ContactResponse)
def update_contact(
    contact_id: int,
    contact_update: ContactUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    db_contact = db.query(OrganizationContact).filter(OrganizationContact.id == contact_id).first()
    if not db_contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    update_data = contact_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_contact, key, value)
    
    db.commit()
    db.refresh(db_contact)
    return db_contact

@router.delete("/contacts/{contact_id}")
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    db_contact = db.query(OrganizationContact).filter(OrganizationContact.id == contact_id).first()
    if not db_contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    db.delete(db_contact)
    db.commit()
    return {"status": "success", "message": "Contact deleted"}

# Subscription CRUD
@router.post("/{org_id}/subscriptions", response_model=SubscriptionResponse)
def create_subscription(
    org_id: int,
    sub: SubscriptionCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    if sub.organization_id != org_id:
        raise HTTPException(status_code=400, detail="Invalid organization ID in subscription data")
    
    db_sub = Subscription(**sub.model_dump())
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    return db_sub

@router.get("/{org_id}/subscriptions", response_model=List[SubscriptionResponse])
def list_organization_subscriptions(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    return db.query(Subscription).filter(Subscription.organization_id == org_id).all()

@router.put("/subscriptions/{sub_id}", response_model=SubscriptionResponse)
def update_subscription(
    sub_id: int,
    sub_update: SubscriptionUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    update_data = sub_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_sub, key, value)
    
    db.commit()
    db.refresh(db_sub)
    return db_sub

@router.delete("/subscriptions/{sub_id}")
def delete_subscription(
    sub_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    db.delete(db_sub)
    db.commit()
    return {"status": "success", "message": "Subscription deleted"}
