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
    ("module_workspace", "Call Center", "Access to the telephony/call center workspace"),
    ("module_reports", "Reports", "Access to view analytics reports"),
    ("module_reminders", "Reminders", "Access to the reminder calls interface"),
    ("module_notifications", "Notifications", "Access to voice notification campaigns"),
    ("module_organizations", "Organizations", "Access to manage organizations/customers"),
    ("module_contacts", "Contacts", "Access to manage organization contacts"),
    ("module_subscriptions", "Subscriptions", "Access to manage product subscriptions"),
    ("module_calls", "Call Records", "Access to call recording logs"),
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
    ("feature_manage_teams", "Manage Teams", "Create, edit, and manage agent teams"),
    ("feature_manage_email_accounts", "Manage Email Accounts", "Configure system-wide IMAP/SMTP accounts"),
    ("feature_manage_messenger_config", "Messenger Config", "Configure Facebook, WhatsApp, Viber, etc."),
    ("feature_manage_agents", "Manage Agents", "Manage agent workspace configurations and statuses"),
    ("feature_manage_telephony", "Manage Telephony (VoIP)", "Access Telephony/VoIP configuration"),
    ("feature_manage_extensions", "Manage Extensions", "Manage SIP extensions and PBX assignments"),
    ("feature_deploy_site", "Deploy New Site", "Ability to deploy new sites from templates"),
    ("feature_manage_branding", "Manage Branding", "Update company name, logo, and theme colors"),
    ("feature_manage_roles", "Manage Roles", "Configure granular permissions for other users"),
    ("feature_manage_cors", "Manage CORS", "Configure allowed origins for the web widget"),
    ("feature_manage_bot", "Manage Chat Bot", "Configure AI bot settings and training data"),
    ("feature_manage_tickets", "Manage Tickets", "Configure ticket fields and view all tickets"),
    ("feature_manage_cloudpanel", "Manage CloudPanel", "Manage CloudPanel servers, templates, and SSL"),
    ("feature_manage_dynamic_fields", "Manage Dynamic Fields", "Configure dynamic fields and custom metadata"),
    ("feature_manage_ssl", "SSL Monitor", "Access to view and manage SSL certificate monitoring"),
]


def get_all_permission_keys():
    """Returns a flat list of all valid permission keys"""
    return (
        [k[0] for k in AVAILABLE_MODULES] +
        [k[0] for k in AVAILABLE_CHANNELS] +
        [k[0] for k in AVAILABLE_FEATURES]
    )
