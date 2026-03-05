from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class OverrideCreate(BaseModel):
    user_id: int
    module_key: str
    granted_actions: List[str] = []
    revoked_actions: List[str] = []


class OverrideUpdate(BaseModel):
    granted_actions: Optional[List[str]] = None
    revoked_actions: Optional[List[str]] = None


class OverrideOut(BaseModel):
    id: int
    user_id: int
    module_key: str
    granted_actions: List[str]
    revoked_actions: List[str]
    granted_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
