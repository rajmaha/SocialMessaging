from sqlalchemy import Column, Integer, String, DateTime, func
from app.database import Base

class CallCenterSettings(Base):
    __tablename__ = "call_center_settings"

    id = Column(Integer, primary_key=True, index=True)
    application_type = Column(String, nullable=False, default="cloud_hosting")
    support_phone = Column(String, nullable=True)
    support_email = Column(String, nullable=True)
    working_hours = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
