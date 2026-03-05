from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class MenuItemCreate(BaseModel):
    label: str
    link_type: str = "internal"  # form, internal, external
    link_value: str
    icon: Optional[str] = None
    open_in_new_tab: bool = False
    display_order: int = 0
    is_active: bool = True


class MenuItemUpdate(BaseModel):
    label: Optional[str] = None
    link_type: Optional[str] = None
    link_value: Optional[str] = None
    icon: Optional[str] = None
    open_in_new_tab: Optional[bool] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class MenuItemOut(BaseModel):
    id: int
    group_id: int
    label: str
    link_type: str
    link_value: str
    icon: Optional[str]
    open_in_new_tab: bool
    display_order: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class MenuGroupCreate(BaseModel):
    name: str
    slug: str
    icon: Optional[str] = "📁"
    display_order: int = 0
    public_access: bool = False
    is_active: bool = True


class MenuGroupUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    display_order: Optional[int] = None
    public_access: Optional[bool] = None
    is_active: Optional[bool] = None


class MenuGroupOut(BaseModel):
    id: int
    name: str
    slug: str
    icon: Optional[str]
    display_order: int
    public_access: bool
    is_active: bool
    created_by: Optional[int]
    created_at: datetime
    items: List[MenuItemOut] = []

    class Config:
        from_attributes = True
