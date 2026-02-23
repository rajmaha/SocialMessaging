from sqlalchemy import Column, Integer, String, DateTime, JSON, Boolean
from datetime import datetime
from app.database import Base

class BrandingSettings(Base):
    __tablename__ = "branding_settings"

    id = Column(Integer, primary_key=True, index=True)
    
    # Company Information
    company_name = Column(String, default="Social Media Messenger")
    company_description = Column(String, default="Unified messaging platform")
    logo_url = Column(String, nullable=True)
    favicon_url = Column(String, nullable=True)
    
    # Colors
    primary_color = Column(String, default="#2563eb")  # Blue
    secondary_color = Column(String, default="#1e40af")  # Darker Blue
    accent_color = Column(String, default="#3b82f6")  # Light Blue
    
    # SMTP Configuration
    smtp_server = Column(String, default="smtp.gmail.com")
    smtp_port = Column(Integer, default=587)
    smtp_username = Column(String, nullable=True)
    smtp_password = Column(String, nullable=True)
    smtp_from_email = Column(String, default="noreply@socialmedia.com")
    smtp_from_name = Column(String, default="Social Media Messenger")
    smtp_use_tls = Column(Boolean, default=True)
    
    # Email Templates
    email_footer_text = Column(String, default="© 2026 Social Media Messenger. All rights reserved.")
    email_support_url = Column(String, nullable=True)
    
    # Links
    support_url = Column(String, nullable=True)
    privacy_url = Column(String, nullable=True)
    terms_url = Column(String, nullable=True)
    
    # Timezone Settings
    timezone = Column(String, default="UTC")  # e.g., "America/New_York", "Europe/London", "Asia/Kolkata"

    # Admin Contact
    admin_email = Column(String, nullable=True)

    # Attachment / file-upload settings
    allowed_file_types = Column(JSON, nullable=True)   # list of MIME strings; None = use defaults
    max_file_size_mb = Column(Integer, default=10)     # per-upload cap in MB

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
