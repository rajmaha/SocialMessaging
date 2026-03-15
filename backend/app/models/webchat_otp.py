from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime
from app.database import Base


class WebchatOtp(Base):
    __tablename__ = "webchat_otp"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    otp = Column(String, nullable=False)
    name = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
