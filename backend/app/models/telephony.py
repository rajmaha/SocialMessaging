from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
from app.database import Base

class TelephonySettings(Base):
    __tablename__ = "telephony_settings"

    id = Column(Integer, primary_key=True, index=True)
    pbx_type = Column(String, nullable=False, default="asterisk") # "asterisk", "freepbx", etc
    host = Column(String, nullable=True) # Domain or IP of the PBX
    port = Column(Integer, nullable=True, default=5038) # AMI Port
    ami_username = Column(String, nullable=True)
    ami_secret = Column(String, nullable=True)
    webrtc_wss_url = Column(String, nullable=True)   # e.g. wss://pbx.domain.com:8089/ws
    freepbx_api_key = Column(String, nullable=True)   # FreePBX REST API key (User Management → API Keys)
    freepbx_api_secret = Column(String, nullable=True) # FreePBX REST API secret
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
