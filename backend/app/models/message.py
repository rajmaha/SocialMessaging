from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from datetime import datetime
from app.database import Base

class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"))
    platform_account_id = Column(Integer, ForeignKey("platform_accounts.id"))
    sender_id = Column(String)
    sender_name = Column(String)
    receiver_id = Column(String)
    receiver_name = Column(String)
    message_text = Column(Text)
    message_type = Column(String, default="text")  # text, image, video, file, etc.
    platform = Column(String)  # whatsapp, facebook, viber, linkedin
    media_url = Column(String, nullable=True)
    is_sent = Column(Integer, default=1)  # 1 = sent, 0 = received
    read_status = Column(Integer, default=0)  # 0 = unread, 1 = read
    platform_message_id = Column(String, unique=True, index=True, nullable=True)
    delivery_status = Column(String, default="sent")  # sent, delivered, read, failed
    subject = Column(String, nullable=True)      # email subject (email platform only)
    email_id = Column(Integer, nullable=True)    # FK to emails.id (email platform only)
    timestamp = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
