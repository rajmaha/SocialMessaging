from sqlalchemy import Column, Integer, String, DateTime, JSON
from datetime import datetime
from app.database import Base

class PlatformSettings(Base):
    __tablename__ = "platform_settings"

    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String, index=True)  # facebook, whatsapp, viber, linkedin
    
    # Credentials
    app_id = Column(String, nullable=True)
    app_secret = Column(String, nullable=True)
    access_token = Column(String, nullable=True)
    verify_token = Column(String, nullable=True)
    
    # Platform-specific settings
    business_account_id = Column(String, nullable=True)
    phone_number = Column(String, nullable=True)
    phone_number_id = Column(String, nullable=True)
    organization_id = Column(String, nullable=True)
    page_id = Column(String, nullable=True)
    
    # Configuration metadata
    config = Column(JSON, nullable=True)  # For flexible settings storage
    
    # Status
    is_configured = Column(Integer, default=0)  # 0=not configured, 1=configured, 2=verified
    webhook_registered = Column(Integer, default=0)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<PlatformSettings(platform={self.platform}, configured={self.is_configured})>"
