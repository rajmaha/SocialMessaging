from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from app.database import Base

class AgentExtension(Base):
    __tablename__ = "agent_extensions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    extension = Column(String, unique=True, nullable=False, index=True)
    sip_password = Column(String, nullable=False)
    is_enabled = Column(Boolean, default=True, nullable=False)          # Enable/disable the extension
    freepbx_synced = Column(Boolean, default=False, nullable=False)    # Whether pushed to FreePBX successfully
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
    
    # Relationship to user
    user = relationship("User", backref="sip_extension_info")
