from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Date
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    organization_name = Column(String, index=True, nullable=False)
    address = Column(Text, nullable=True)
    pan_no = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    domain_name = Column(String, nullable=True)
    contact_numbers = Column(JSON, default=list)  # Comma separated or list of numbers
    email = Column(String, nullable=True)
    is_active = Column(Integer, default=1)  # 1 for active, 0 for inactive
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    contacts = relationship("OrganizationContact", back_populates="organization", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="organization", cascade="all, delete-orphan")

class OrganizationContact(Base):
    __tablename__ = "organization_contacts"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    
    full_name = Column(String, nullable=False)
    gender = Column(String, nullable=True)
    dob = Column(Date, nullable=True)
    email = Column(String, nullable=True)
    phone_no = Column(JSON, default=list)  # Comma separated or list of numbers
    designation = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    organization = relationship("Organization", back_populates="contacts")

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    
    subscribed_product = Column(String, nullable=True)
    modules = Column(JSON, default=list)  # Multiple modules in JSON format
    system_url = Column(String, nullable=True)
    company_logo_url = Column(String, nullable=True)
    subscribed_on_date = Column(Date, nullable=True)
    billed_from_date = Column(Date, nullable=True)
    expire_date = Column(Date, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    organization = relationship("Organization", back_populates="subscriptions")

class SubscriptionModule(Base):
    __tablename__ = "subscription_modules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Integer, default=1)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
