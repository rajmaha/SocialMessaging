from pydantic import BaseModel
from typing import Dict, List, Optional
from datetime import datetime


class RoleCreate(BaseModel):
    name: str
    slug: str
    permissions: Dict[str, List[str]] = {}


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    permissions: Optional[Dict[str, List[str]]] = None


class RoleOut(BaseModel):
    id: int
    name: str
    slug: str
    is_system: bool
    permissions: Dict[str, List[str]]
    created_at: datetime

    class Config:
        from_attributes = True


class UserRoleUpdate(BaseModel):
    role: str
