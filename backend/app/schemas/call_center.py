from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class CallCenterSettingsBase(BaseModel):
    application_type: str = "cloud_hosting"
    support_phone: Optional[str] = None
    support_email: Optional[str] = None
    working_hours: Optional[str] = None

class CallCenterSettingsCreate(CallCenterSettingsBase):
    pass

class CallCenterSettingsUpdate(CallCenterSettingsBase):
    pass

class CallCenterSettingsResponse(CallCenterSettingsBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
