from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ConversationResponse(BaseModel):
    id: int
    platform: str
    contact_name: str
    contact_id: str
    last_message: Optional[str]
    last_message_time: Optional[datetime]
    unread_count: int
    contact_avatar: Optional[str]

    class Config:
        from_attributes = True
