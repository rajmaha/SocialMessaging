from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    full_name = Column(String)
    role = Column(String, default="user")  # "admin" or "user"
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, default=None)  # Admin who created this user
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    password_reset_token = Column(String, nullable=True)  # Reset token
    password_reset_expires = Column(DateTime, nullable=True)  # Token expiration
    otp_code = Column(String, nullable=True)  # Email OTP code
    otp_expires = Column(DateTime, nullable=True)  # OTP expiration
    otp_context = Column(String, nullable=True)  # 'register' or 'login'
    is_verified = Column(Boolean, default=False)  # Email verified

    # Profile fields
    phone = Column(String, nullable=True)
    bio = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    social_twitter = Column(String, nullable=True)
    social_facebook = Column(String, nullable=True)
    social_linkedin = Column(String, nullable=True)
    social_instagram = Column(String, nullable=True)
    social_youtube = Column(String, nullable=True)

    # Relationships
    email_account = relationship("UserEmailAccount", back_populates="user", uselist=False)  # One per user
    email_signature = relationship("EmailSignature", back_populates="user", uselist=False)  # One per user
    email_templates = relationship("EmailTemplate", back_populates="user")  # Multiple templates
    contacts = relationship("Contact", back_populates="user", cascade="all, delete-orphan")  # Multiple contacts
