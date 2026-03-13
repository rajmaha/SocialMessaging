from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from datetime import datetime
from app.database import Base


class DomainAgent(Base):
    __tablename__ = "domain_agents"
    __table_args__ = (
        UniqueConstraint("widget_domain_id", "user_id", name="uq_domain_agent"),
    )

    id = Column(Integer, primary_key=True, index=True)
    widget_domain_id = Column(
        Integer,
        ForeignKey("widget_domains.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow)
