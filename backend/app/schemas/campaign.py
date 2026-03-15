from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class CampaignCreate(BaseModel):
    name: str
    subject: str
    body_html: str
    target_filter: Optional[dict] = {}
    scheduled_at: Optional[datetime] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    body_html: Optional[str] = None
    target_filter: Optional[dict] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    subject: str
    body_html: str
    status: str
    target_filter: Optional[dict] = {}
    scheduled_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    sent_count: int
    opened_count: int
    created_by: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class VariantCreate(BaseModel):
    variant_label: str
    subject: str
    body_html: str


class RecipientResponse(BaseModel):
    id: int
    campaign_id: int
    lead_id: Optional[int] = None
    email: str
    name: Optional[str] = None
    sent_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    open_count: int

    class Config:
        from_attributes = True
