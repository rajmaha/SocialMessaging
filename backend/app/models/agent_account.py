from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from datetime import datetime
from app.database import Base

class AgentAccount(Base):
    __tablename__ = "agent_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "platform_account_id", name="uq_agent_account"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    platform_account_id = Column(Integer, ForeignKey("platform_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
