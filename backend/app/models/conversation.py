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
    status = Column(String, default="open")          # open, pending, resolved
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    category = Column(String, nullable=True)           # issue type: Billing, Technical, etc.
    first_response_at = Column(DateTime, nullable=True)  # when agent first replied
    resolved_at = Column(DateTime, nullable=True)       # when status set to resolved
    rating = Column(Integer, nullable=True)              # 1-5 star score from visitor
    rating_comment = Column(Text, nullable=True)         # optional visitor comment
    rated_at = Column(DateTime, nullable=True)           # when the rating was submitted
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
