from sqlalchemy import Column, Integer, String, Text, Float, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from app.database import Base


class WorklogCategoryGroup(Base):
    __tablename__ = "worklog_category_groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    color = Column(String, default="#6366f1")
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    categories = relationship("WorklogCategory", back_populates="group", cascade="all, delete-orphan")


class WorklogCategory(Base):
    __tablename__ = "worklog_categories"
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("worklog_category_groups.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    group = relationship("WorklogCategoryGroup", back_populates="categories")


class WorklogEntry(Base):
    __tablename__ = "worklog_entries"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    category_id = Column(Integer, ForeignKey("worklog_categories.id", ondelete="SET NULL"), nullable=True)
    log_date = Column(Date, nullable=False)
    hours = Column(Float, nullable=False)
    summary = Column(Text)
    status = Column(String, default="pending")
    reviewer_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    rejection_note = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])
    category = relationship("WorklogCategory")
    attachments = relationship("WorklogAttachment", back_populates="entry", cascade="all, delete-orphan")


class WorklogAttachment(Base):
    __tablename__ = "worklog_attachments"
    id = Column(Integer, primary_key=True, index=True)
    worklog_entry_id = Column(Integer, ForeignKey("worklog_entries.id", ondelete="CASCADE"))
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    entry = relationship("WorklogEntry", back_populates="attachments")


class WorklogActiveTimer(Base):
    __tablename__ = "worklog_active_timers"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    category_id = Column(Integer, ForeignKey("worklog_categories.id", ondelete="SET NULL"), nullable=True)
    log_date = Column(Date, nullable=False)
    start_time = Column(DateTime, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
    category = relationship("WorklogCategory")


class WorklogAutoEntry(Base):
    __tablename__ = "worklog_auto_entries"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    source = Column(String, nullable=False)
    reference_id = Column(Integer, nullable=True)
    log_date = Column(Date, nullable=False)
    hours = Column(Float, nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
