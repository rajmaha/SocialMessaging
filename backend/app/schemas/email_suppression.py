from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SuppressionResponse(BaseModel):
    id: int
    email: str
    reason: str
    campaign_id: Optional[int] = None
    unsubscribed_at: Optional[datetime] = None
    resubscribed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SendTestRequest(BaseModel):
    subject: str
    body_html: str
    to_email: str
