from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
from sqlalchemy.sql import func
from app.database import Base


class CampaignEmailTemplate(Base):
    __tablename__ = "campaign_email_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(50), nullable=False)   # newsletter | promotional | welcome | followup
    is_preset = Column(Boolean, default=False, nullable=False)
    body_html = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
