from sqlalchemy import Column, Integer, String, DateTime, JSON
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
