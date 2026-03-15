from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from datetime import datetime
from app.database import Base


class DomainAccount(Base):
    __tablename__ = "domain_accounts"
    __table_args__ = (
        UniqueConstraint("widget_domain_id", "platform_account_id", name="uq_domain_account"),
    )

    id = Column(Integer, primary_key=True, index=True)
    widget_domain_id = Column(
        Integer,
        ForeignKey("widget_domains.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    platform_account_id = Column(
        Integer,
        ForeignKey("platform_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow)
