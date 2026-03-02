from sqlalchemy import Column, Integer, String, DateTime, Boolean
from datetime import datetime
from app.database import Base


class CalendarIntegrationSettings(Base):
    __tablename__ = "calendar_integration_settings"

    id = Column(Integer, primary_key=True, index=True)

    # Google Calendar OAuth
    google_enabled = Column(Boolean, default=False)
    google_client_id = Column(String, nullable=True)
    google_client_secret = Column(String, nullable=True)

    # Microsoft Calendar OAuth
    microsoft_enabled = Column(Boolean, default=False)
    microsoft_client_id = Column(String, nullable=True)
    microsoft_client_secret = Column(String, nullable=True)
    microsoft_tenant_id = Column(String, default="common")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
