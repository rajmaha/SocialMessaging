"""
A phone (or tablet) that an agent is signed in on, and the FCM/APNs token
that addresses it.

One row per device, keyed by the token itself: tokens rotate, and the same
physical phone can be handed to a different agent, so `user_id` is updated on
re-registration rather than creating a second row. Tokens FCM reports as
UNREGISTERED are deactivated by push_service rather than deleted, so a device
that comes back keeps its history.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.database import Base


class DeviceToken(Base):
    __tablename__ = "device_tokens"

    id = Column(Integer, primary_key=True, index=True)

    # The FCM registration token (Android) or the APNs token relayed through
    # FCM (iOS). Unique so a re-register updates instead of duplicating.
    token = Column(String, nullable=False, unique=True, index=True)

    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 'android' | 'ios'
    platform = Column(String, nullable=False, default="android")

    device_name = Column(String, nullable=True)   # e.g. "Samsung SM-G991B"
    os_version = Column(String, nullable=True)

    # False once FCM tells us the token is dead, or the agent signs out.
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_seen_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user = relationship("User", foreign_keys=[user_id])

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<DeviceToken user={self.user_id} {self.platform} active={self.is_active}>"
