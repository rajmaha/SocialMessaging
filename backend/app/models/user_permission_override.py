from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class UserPermissionOverride(Base):
    """Per-user permission overrides — grant or revoke specific actions beyond the role default."""
    __tablename__ = "user_permission_overrides"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False)
    granted_actions = Column(JSONB, default=list)
    revoked_actions = Column(JSONB, default=list)
    granted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "module_key", name="uq_user_module_override"),
    )

    user = relationship("User", foreign_keys=[user_id])
    granter = relationship("User", foreign_keys=[granted_by])
