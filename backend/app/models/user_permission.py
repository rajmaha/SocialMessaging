from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class UserPermission(Base):
    """Unified per-user permissions model for granting module, channel, and sub-admin access"""
    __tablename__ = "user_permissions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    permission_key = Column(String, nullable=False)
    granted_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "permission_key", name="uq_user_permission_key"),
    )

    user = relationship("User", foreign_keys=[user_id], backref="permissions")
    granter = relationship("User", foreign_keys=[granted_by])

# ─── Constants for Available Permissions ──────────────────────────────────────

# Format: (key, label, description)

AVAILABLE_MODULES = [
    ("module_email", "Email", "Access to the internal email client"),
    ("module_workspace", "Workspace", "Access to the telephony/call center workspace"),
    ("module_reports", "Reports", "Access to view analytics reports"),
    ("module_reminders", "Reminders", "Access to the reminder calls interface"),
    ("module_notifications", "Notifications", "Access to voice notification campaigns"),
]

AVAILABLE_CHANNELS = [
    ("channel_whatsapp", "WhatsApp", "Access to WhatsApp conversations"),
    ("channel_viber", "Viber", "Access to Viber conversations"),
    ("channel_linkedin", "LinkedIn", "Access to LinkedIn conversations"),
    ("channel_messenger", "Facebook Messenger", "Access to Facebook Messenger conversations"),
    ("channel_webchat", "Website Chat Widget", "Access to website webchat conversations"),
]

AVAILABLE_FEATURES = [
    ("feature_manage_users", "Manage Users", "Create, edit, and deactivate agent accounts"),
    ("feature_manage_email_accounts", "Manage Email Accounts", "Configure system-wide IMAP/SMTP accounts"),
    ("feature_manage_agents", "Manage Agents", "Manage agent workspace configurations and statuses"),
    ("feature_manage_extensions", "Manage Extensions", "Manage SIP extensions and PBX assignments"),
]

def get_all_permission_keys():
    """Returns a flat list of all valid permission keys"""
    return (
        [k[0] for k in AVAILABLE_MODULES] +
        [k[0] for k in AVAILABLE_CHANNELS] +
        [k[0] for k in AVAILABLE_FEATURES]
    )
