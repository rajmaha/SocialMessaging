from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class CallRecordingBase(BaseModel):
    conversation_id: Optional[int] = None
    agent_id: Optional[int] = None
    agent_name: Optional[str] = None
    phone_number: str
    direction: str = "inbound"
    disposition: str = "ANSWERED"
    duration_seconds: int = 0
    recording_file: Optional[str] = None
    recording_url: Optional[str] = None
    pbx_call_id: Optional[str] = None

class CallRecordingCreate(CallRecordingBase):
    pass

class CallRecordingResponse(CallRecordingBase):
    id: int
    created_at: datetime
    has_audio: bool = False   # True if recording_file or recording_url exists

    model_config = ConfigDict(from_attributes=True)
