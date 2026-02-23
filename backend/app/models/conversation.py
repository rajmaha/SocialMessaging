from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from datetime import datetime
from app.database import Base

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    platform_account_id = Column(Integer, ForeignKey("platform_accounts.id"))
    conversation_id = Column(String, unique=True, index=True)
    platform = Column(String)  # whatsapp, facebook, viber, linkedin
    contact_name = Column(String)
    contact_id = Column(String)
    contact_avatar = Column(Text, nullable=True)
    last_message = Column(Text, nullable=True)
    last_message_time = Column(DateTime, nullable=True)
    unread_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
