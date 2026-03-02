from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class AgentStatusBase(BaseModel):
    status: str

class AgentStatusUpdate(AgentStatusBase):
    pass

class AgentStatusResponse(AgentStatusBase):
    id: int
    user_id: int
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class WorkspaceStatsResponse(BaseModel):
    total_calls_today: int
    avg_call_duration_seconds: int
    follow_up_count: int = 0
    forwarded_count: int = 0
    status: AgentStatusResponse
