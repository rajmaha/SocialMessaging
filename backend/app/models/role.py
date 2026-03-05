from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime
from app.database import Base


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    is_system = Column(Boolean, default=False)
    pages = Column(JSONB, default=list)          # LEGACY — kept for migration
    permissions = Column(JSONB, default=dict)     # NEW — unified permission matrix
    created_at = Column(DateTime, default=datetime.utcnow)
