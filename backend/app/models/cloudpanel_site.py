from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base

class CloudPanelSite(Base):
    __tablename__ = "cloudpanel_sites"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id"), nullable=False)
    domain_name = Column(String, nullable=False, index=True)
    php_version = Column(String, nullable=True)
    site_user = Column(String, nullable=True)
    db_name = Column(String, nullable=True)
    db_user = Column(String, nullable=True)
    template_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
