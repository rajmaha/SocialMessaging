from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

# Many-to-many: team ↔ user
team_members = Table(
    "team_members",
    Base.metadata,
    Column("team_id", Integer, ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id",  Integer, ForeignKey("users.id",  ondelete="CASCADE"), primary_key=True),
)


class Team(Base):
    __tablename__ = "teams"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)

    members = relationship("User", secondary=team_members, lazy="joined")
