from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any
from datetime import datetime

class DynamicFieldBase(BaseModel):
    application_type: str
    field_name: str
    field_label: str
    field_type: str = "text"
    options: Optional[List[str]] = None
    display_order: int = 0
    is_required: bool = False

class DynamicFieldCreate(DynamicFieldBase):
    pass

class DynamicFieldUpdate(BaseModel):
    field_name: Optional[str] = None
    field_label: Optional[str] = None
    field_type: Optional[str] = None
    options: Optional[List[str]] = None
    display_order: Optional[int] = None
    is_required: Optional[bool] = None

class DynamicFieldResponse(DynamicFieldBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
