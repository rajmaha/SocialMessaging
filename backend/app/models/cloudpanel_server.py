from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base

class CloudPanelServer(Base):
    __tablename__ = "cloudpanel_servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    host = Column(String, nullable=False)
    ssh_port = Column(Integer, default=22, nullable=False)
    ssh_user = Column(String, default="root", nullable=False)
    ssh_password = Column(String, nullable=True) # Optional if using key
    ssh_key = Column(String, nullable=True)      # Optional if using password
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
