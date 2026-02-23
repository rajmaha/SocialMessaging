from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class MessageCreate(BaseModel):
    conversation_id: int
    message_text: str
    message_type: str = "text"
    media_url: Optional[str] = None

class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_name: str
    message_text: str
    message_type: str
    platform: str
    is_sent: int
    read_status: int
    timestamp: datetime

    class Config:
        from_attributes = True
