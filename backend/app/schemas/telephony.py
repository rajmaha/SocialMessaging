from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class TelephonySettingsBase(BaseModel):
    pbx_type: str = "asterisk"
    host: Optional[str] = None
    freepbx_port: Optional[int] = 443
    ami_port: Optional[int] = 5038
    ami_username: Optional[str] = None
    ami_secret: Optional[str] = None
    webrtc_wss_url: Optional[str] = None
    freepbx_api_key: Optional[str] = None
    freepbx_api_secret: Optional[str] = None
    stun_servers: Optional[str] = None
    turn_server: Optional[str] = None
    turn_username: Optional[str] = None
    turn_credential: Optional[str] = None
    ssh_host: Optional[str] = None
    ssh_port: Optional[int] = 22
    ssh_username: Optional[str] = None
    ssh_password: Optional[str] = None
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
