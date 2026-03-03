from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class EmailTemplateCreate(BaseModel):
    name: str
    category: str
    body_html: str


class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    body_html: Optional[str] = None


class EmailTemplateResponse(BaseModel):
    id: int
    name: str
    category: str
    is_preset: bool
    body_html: str
    created_at: datetime

    class Config:
        from_attributes = True
