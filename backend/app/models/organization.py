from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Date, Float
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
    industry = Column(String, nullable=True)
    company_size = Column(String, nullable=True)
    website = Column(String, nullable=True)
    annual_revenue = Column(Float, nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(JSON, default=list)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    contacts = relationship("OrganizationContact", back_populates="organization", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="organization", cascade="all, delete-orphan")
    leads = relationship("Lead", back_populates="organization", foreign_keys="[Lead.organization_id]")

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
    notes = Column(Text, nullable=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=True)

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

    # Stripe integration fields
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)
    status = Column(String, default="active")  # active, past_due, cancelled
    
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


class SubscriptionSettings(Base):
    __tablename__ = "subscription_settings"

    id = Column(Integer, primary_key=True, index=True)
    post_create_form_slug = Column(String, nullable=True)
    post_create_field_map = Column(JSON, nullable=True)  # [{"form_key": "x", "source_key": "subscription.y"}]
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# New tables for product/business features
class PricingPlan(Base):
    __tablename__ = "pricing_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    stripe_price_id = Column(String, nullable=True)
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String, default="npr")
    interval = Column(String, default="month")  # month, year, etc.
    description = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class UsageEvent(Base):
    __tablename__ = "usage_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    event_type = Column(String, nullable=False)
    data = Column(JSON, default={})  # renamed from metadata to avoid SQLAlchemy conflict
    created_at = Column(DateTime, default=datetime.utcnow)
