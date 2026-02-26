from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any
from datetime import datetime, date

# Contact Schemas
class ContactBase(BaseModel):
    full_name: str
    gender: Optional[str] = None
    dob: Optional[date] = None
    email: Optional[str] = None
    phone_no: Optional[List[str]] = []
    designation: Optional[str] = None
    address: Optional[str] = None

class ContactCreate(ContactBase):
    organization_id: int

class ContactUpdate(BaseModel):
    full_name: Optional[str] = None
    gender: Optional[str] = None
    dob: Optional[date] = None
    email: Optional[str] = None
    phone_no: Optional[List[str]] = None
    designation: Optional[str] = None
    address: Optional[str] = None

class ContactResponse(ContactBase):
    id: int
    organization_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# Subscription Schemas
class SubscriptionBase(BaseModel):
    subscribed_product: Optional[str] = None
    modules: Optional[List[str]] = []
    system_url: Optional[str] = None
    subscribed_on_date: Optional[date] = None
    billed_from_date: Optional[date] = None
    expire_date: Optional[date] = None

class SubscriptionCreate(SubscriptionBase):
    organization_id: int

class SubscriptionUpdate(BaseModel):
    subscribed_product: Optional[str] = None
    modules: Optional[List[str]] = None
    system_url: Optional[str] = None
    subscribed_on_date: Optional[date] = None
    billed_from_date: Optional[date] = None
    expire_date: Optional[date] = None

class SubscriptionResponse(SubscriptionBase):
    id: int
    organization_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# Organization Schemas
class OrganizationBase(BaseModel):
    organization_name: str
    address: Optional[str] = None
    pan_no: Optional[str] = None
    logo_url: Optional[str] = None
    domain_name: Optional[str] = None
    contact_numbers: Optional[List[str]] = []
    email: Optional[str] = None
    is_active: int = 1

class OrganizationCreate(OrganizationBase):
    pass

class OrganizationUpdate(BaseModel):
    organization_name: Optional[str] = None
    address: Optional[str] = None
    pan_no: Optional[str] = None
    logo_url: Optional[str] = None
    domain_name: Optional[str] = None
    contact_numbers: Optional[List[str]] = None
    email: Optional[str] = None
    is_active: Optional[int] = None

class OrganizationResponse(OrganizationBase):
    id: int
    created_at: datetime
    updated_at: datetime
    contacts: List[ContactResponse] = []
    subscriptions: List[SubscriptionResponse] = []

    model_config = ConfigDict(from_attributes=True)

# Subscription Module Schemas
class SubscriptionModuleBase(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: int = 1

class SubscriptionModuleCreate(SubscriptionModuleBase):
    pass

class SubscriptionModuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[int] = None

class SubscriptionModuleResponse(SubscriptionModuleBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
