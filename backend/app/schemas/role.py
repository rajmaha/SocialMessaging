from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class RoleCreate(BaseModel):
    name: str
    slug: str
    pages: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    pages: Optional[List[str]] = None


class RoleOut(BaseModel):
    id: int
    name: str
    slug: str
    is_system: bool
    pages: List[str]
    created_at: datetime

    class Config:
        from_attributes = True


class UserRoleUpdate(BaseModel):
    role: str  # slug of the target role
