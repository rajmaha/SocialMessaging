from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey
from datetime import datetime
from app.database import Base


class WidgetDomain(Base):
    __tablename__ = "widget_domains"

    id = Column(Integer, primary_key=True, index=True)
    domain = Column(String, unique=True, nullable=False, index=True)
    widget_key = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    is_active = Column(Integer, default=1)
    branding_overrides = Column(JSON, nullable=True)
    # Support desk (app/support_schema.py adds these on existing databases)
    support_enabled = Column(Integer, default=0, nullable=False, server_default="0")
    chat_enabled = Column(Integer, default=1, nullable=False, server_default="1")
    allow_anonymous = Column(Integer, default=1, nullable=False, server_default="1")
    live_help_enabled = Column(Integer, default=0, nullable=False, server_default="0")
    support_categories = Column(JSON, nullable=True)       # ["Bug", "How to", ...]
    identity_secret = Column(String, nullable=True)        # sealed by secret_box, never sent back
    webhook_url = Column(String, nullable=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
