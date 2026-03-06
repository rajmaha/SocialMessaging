# backend/app/models/logs.py
from sqlalchemy import Column, Integer, String, DateTime, Text
from datetime import datetime
from app.log_database import LogBase


class AuditLog(LogBase):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    user_id = Column(Integer, nullable=True, index=True)
    user_email = Column(String, nullable=True)
    user_role = Column(String, nullable=True)
    action = Column(String, nullable=False, index=True)   # e.g. "conversation.assigned"
    entity_type = Column(String, nullable=True)            # e.g. "conversation"
    entity_id = Column(Integer, nullable=True)
    detail = Column(Text, nullable=True)                   # JSON string
    ip_address = Column(String, nullable=True)
    request_path = Column(String, nullable=True)
    request_method = Column(String, nullable=True)


class ErrorLog(LogBase):
    __tablename__ = "error_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    severity = Column(String, nullable=False, default="error", index=True)  # error | warning | critical
    source = Column(String, nullable=False, default="api", index=True)      # api | background_job | integration | frontend
    error_type = Column(String, nullable=True)
    message = Column(Text, nullable=False)
    traceback = Column(Text, nullable=True)
    user_id = Column(Integer, nullable=True, index=True)
    request_path = Column(String, nullable=True)
    request_method = Column(String, nullable=True)
    context = Column(Text, nullable=True)                       # JSON string
