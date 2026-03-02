from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime, date

class SocialMediaEntry(BaseModel):
    platform: str
    url: str

class IndividualBase(BaseModel):
    full_name: str
    gender: str
    dob: Optional[date] = None
    phone_numbers: Optional[List[str]] = []
    address: Optional[str] = None
    email: Optional[str] = None
    social_media: Optional[List[SocialMediaEntry]] = []
    is_active: int = 1

class IndividualCreate(IndividualBase):
    pass

class IndividualUpdate(BaseModel):
    full_name: Optional[str] = None
    gender: Optional[str] = None
    dob: Optional[date] = None
    phone_numbers: Optional[List[str]] = None
    address: Optional[str] = None
    email: Optional[str] = None
    social_media: Optional[List[SocialMediaEntry]] = None
    is_active: Optional[int] = None

class IndividualResponse(IndividualBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
