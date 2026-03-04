from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Any


class OrganizationContactCreate(BaseModel):
    full_name: str
    gender: Optional[str] = None
    email: Optional[str] = None
    phone_no: Optional[List[str]] = []
    designation: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    lead_id: Optional[int] = None


class OrganizationContactUpdate(BaseModel):
    full_name: Optional[str] = None
    gender: Optional[str] = None
    email: Optional[str] = None
    phone_no: Optional[List[str]] = None
    designation: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    lead_id: Optional[int] = None


class OrganizationContactResponse(BaseModel):
    id: int
    organization_id: int
    full_name: str
    gender: Optional[str] = None
    email: Optional[str] = None
    phone_no: Optional[Any] = None
    designation: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    lead_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrganizationCreate(BaseModel):
    organization_name: str
    address: Optional[str] = None
    pan_no: Optional[str] = None
    domain_name: Optional[str] = None
    contact_numbers: Optional[List[str]] = []
    email: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    website: Optional[str] = None
    annual_revenue: Optional[float] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = []


class OrganizationUpdate(BaseModel):
    organization_name: Optional[str] = None
    address: Optional[str] = None
    pan_no: Optional[str] = None
    domain_name: Optional[str] = None
    contact_numbers: Optional[List[str]] = None
    email: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    website: Optional[str] = None
    annual_revenue: Optional[float] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    is_active: Optional[int] = None


class OrganizationResponse(BaseModel):
    id: int
    organization_name: str
    address: Optional[str] = None
    pan_no: Optional[str] = None
    domain_name: Optional[str] = None
    contact_numbers: Optional[Any] = None
    email: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    website: Optional[str] = None
    annual_revenue: Optional[float] = None
    description: Optional[str] = None
    tags: Optional[Any] = None
    is_active: int
    created_at: datetime
    updated_at: datetime
    lead_count: int = 0
    contact_count: int = 0

    model_config = {"from_attributes": True}


class OrganizationDetailResponse(OrganizationResponse):
    contacts: List[OrganizationContactResponse] = []
    leads: List[Any] = []
