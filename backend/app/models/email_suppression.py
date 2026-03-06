from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class EmailSuppression(Base):
    __tablename__ = "email_suppressions"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    reason = Column(String(50), nullable=False)  # unsubscribed | bounced | complaint
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="SET NULL"), nullable=True)
    unsubscribed_at = Column(DateTime(timezone=True), server_default=func.now())
    resubscribed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
