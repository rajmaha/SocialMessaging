from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

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
    media_url: Optional[str] = None
    platform: str
    is_sent: int
    read_status: int
    delivery_status: str = "sent"
    timestamp: datetime
    subject: Optional[str] = None
    email_id: Optional[int] = None

    class Config:
        from_attributes = True

class PagedMessageResponse(BaseModel):
    messages: List[MessageResponse]
    has_more: bool
