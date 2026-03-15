# backend/app/schemas/visitors.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Location ──────────────────────────────────────────────────────────────────

class VisitorLocationCreate(BaseModel):
    name: str
    ip_camera_url: Optional[str] = None


class VisitorLocationUpdate(BaseModel):
    name: Optional[str] = None
    ip_camera_url: Optional[str] = None


class VisitorLocationOut(BaseModel):
    id: int
    name: str
    ip_camera_url: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Pass Cards ────────────────────────────────────────────────────────────────

class PassCardCreate(BaseModel):
    location_id: int
    card_no: str


class PassCardOut(BaseModel):
    id: int
    location_id: int
    card_no: str
    is_active: bool
    in_use: bool = False          # True if an active visit holds this card
    held_by: Optional[str] = None # visitor name if in_use

    class Config:
        from_attributes = True


# ── Profile ───────────────────────────────────────────────────────────────────

class VisitorProfileOut(BaseModel):
    id: int
    name: str
    address: Optional[str] = None
    contact_no: Optional[str] = None
    email: Optional[str] = None
    organization: Optional[str] = None
    photo_url: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Visit ─────────────────────────────────────────────────────────────────────

class VisitCreate(BaseModel):
    # Visitor identity — creates or updates profile
    visitor_name: str
    visitor_address: Optional[str] = None
    visitor_contact_no: Optional[str] = None
    visitor_email: Optional[str] = None
    visitor_organization: Optional[str] = None
    visitor_photo_path: Optional[str] = None  # set after upload
    # Visit details
    location_id: Optional[int] = None
    num_visitors: int = 1
    purpose: str
    host_agent_id: Optional[int] = None
    pass_card_id: Optional[int] = None


class VisitOut(BaseModel):
    id: int
    visitor_profile_id: int
    visitor_name: str
    visitor_organization: Optional[str] = None
    visitor_photo_url: Optional[str] = None
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    num_visitors: int
    purpose: str
    host_agent_id: Optional[int] = None
    host_agent_name: Optional[str] = None
    check_in_at: Optional[datetime] = None
    check_out_at: Optional[datetime] = None
    cctv_photo_url: Optional[str] = None
    created_by: Optional[int] = None
    status: str  # "checked_in" | "checked_out"
    pass_card_id: Optional[int] = None
    pass_card_no: Optional[str] = None   # denormalised for display

    class Config:
        from_attributes = True
