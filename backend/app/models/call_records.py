from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base

class CallRecording(Base):
    __tablename__ = "call_recordings"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    agent_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    agent_name = Column(String, nullable=True)        # Cached for display even if agent deleted
    phone_number = Column(String, nullable=False, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    direction = Column(String, default="inbound")     # inbound or outbound
    disposition = Column(String, default="ANSWERED")  # ANSWERED, NO ANSWER, BUSY, FAILED
    duration_seconds = Column(Integer, default=0)
    recording_file = Column(String, nullable=True)    # FreePBX filename, used for streaming proxy
    recording_url = Column(String, nullable=True)     # External/manual URL (optional)
    pbx_call_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    agent = relationship("User", foreign_keys=[agent_id])
