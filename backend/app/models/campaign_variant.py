from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class CampaignVariant(Base):
    __tablename__ = "campaign_variants"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    variant_label = Column(String(10), nullable=False)  # "A" or "B"
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    split_percentage = Column(Integer, default=50)
    sent_count = Column(Integer, default=0)
    opened_count = Column(Integer, default=0)
    clicked_count = Column(Integer, default=0)
