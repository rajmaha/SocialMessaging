from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class StandupEntry(Base):
    __tablename__ = "standup_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_standup_user_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    yesterday = Column(Text, nullable=False)
    today = Column(Text, nullable=False)
    blockers = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[user_id], backref="standup_entries")


class DailyPlannerItem(Base):
    __tablename__ = "daily_planner_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    title = Column(String, nullable=False)
    is_completed = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[user_id], backref="daily_planner_items")


class CommandCenterConfig(Base):
    __tablename__ = "command_center_configs"

    id = Column(Integer, primary_key=True, index=True)
    metric_key = Column(String, nullable=False, unique=True)
    label = Column(String, nullable=False)
    is_visible = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    threshold_value = Column(Integer, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
