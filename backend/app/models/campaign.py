from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.database import Base


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    body_html = Column(Text, nullable=False)
    # status: draft | scheduled | sending | sent | failed
    status = Column(String(50), default="draft", nullable=False)
    # target_filter: {"statuses": ["new","contacted"], "sources": ["email","website"]}
    target_filter = Column(JSON, default={})
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    sent_count = Column(Integer, default=0)
    opened_count = Column(Integer, default=0)
    clicked_count = Column(Integer, default=0)
    is_ab_test = Column(Boolean, default=False)
    ab_test_size_pct = Column(Integer, default=20)
    ab_winner_variant_id = Column(Integer, ForeignKey("campaign_variants.id", ondelete="SET NULL"), nullable=True)
    ab_winner_criteria = Column(String(50), default="open_rate")  # open_rate | click_rate
    ab_test_duration_hours = Column(Integer, default=4)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class CampaignRecipient(Base):
    __tablename__ = "campaign_recipients"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    lead_id = Column(Integer, ForeignKey("leads.id", ondelete="CASCADE"), nullable=True)
    email = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    opened_at = Column(DateTime(timezone=True), nullable=True)
    open_count = Column(Integer, default=0)
    status = Column(String(50), default="sent")  # sent | bounced | failed
    clicked_at = Column(DateTime(timezone=True), nullable=True)
    variant_id = Column(Integer, ForeignKey("campaign_variants.id", ondelete="SET NULL"), nullable=True)
