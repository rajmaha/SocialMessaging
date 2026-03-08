# backend/app/models/visitors.py
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from app.database import Base


class VisitorLocation(Base):
    __tablename__ = "visitor_locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    ip_camera_url = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class VisitorProfile(Base):
    __tablename__ = "visitor_profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    address = Column(Text, nullable=True)
    contact_no = Column(String, nullable=True)
    email = Column(String, nullable=True)
    organization = Column(String, nullable=True)
    photo_path = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Visit(Base):
    __tablename__ = "visits"

    id = Column(Integer, primary_key=True, index=True)
    visitor_profile_id = Column(Integer, ForeignKey("visitor_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("visitor_locations.id", ondelete="SET NULL"), nullable=True)
    num_visitors = Column(Integer, nullable=False, default=1)
    purpose = Column(String, nullable=False)
    host_agent_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    check_in_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    check_out_at = Column(DateTime, nullable=True)
    visitor_photo_path = Column(String, nullable=True)
    cctv_photo_path = Column(String, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
