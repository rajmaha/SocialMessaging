from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class AgentExtensionBase(BaseModel):
    user_id: int
    extension: str
    sip_password: str

class AgentExtensionCreate(AgentExtensionBase):
    pass

class AgentExtensionUpdate(BaseModel):
    extension: Optional[str] = None
    sip_password: Optional[str] = None

class AgentExtensionResponse(AgentExtensionBase):
    id: int
    is_enabled: bool
    freepbx_synced: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserExtensionResponse(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    role: str
    extension: Optional[AgentExtensionResponse] = None

    model_config = ConfigDict(from_attributes=True)
