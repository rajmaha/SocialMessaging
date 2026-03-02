from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Date
from datetime import datetime
from app.database import Base

class Individual(Base):
    __tablename__ = "individuals"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, index=True, nullable=False)
    gender = Column(String, nullable=False)  # Male, Female, Other
    dob = Column(Date, nullable=True)
    phone_numbers = Column(JSON, default=list)
    address = Column(Text, nullable=True)
    email = Column(String, nullable=True)
    social_media = Column(JSON, default=list)  # [{"platform": "Facebook", "url": "..."}]
    is_active = Column(Integer, default=1)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
