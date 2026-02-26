from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class TelephonySettingsBase(BaseModel):
    pbx_type: str = "asterisk"
    host: Optional[str] = None
    port: Optional[int] = 5038
    ami_username: Optional[str] = None
    ami_secret: Optional[str] = None
    webrtc_wss_url: Optional[str] = None
    freepbx_api_key: Optional[str] = None
    freepbx_api_secret: Optional[str] = None
    is_active: bool = False

class TelephonySettingsCreate(TelephonySettingsBase):
    pass

class TelephonySettingsUpdate(TelephonySettingsBase):
    # Make all fields optional for partial updates
    pbx_type: Optional[str] = None
    is_active: Optional[bool] = None

class TelephonySettingsResponse(TelephonySettingsBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
