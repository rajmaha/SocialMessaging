"""
Unified module registry — defines all permission-controlled modules and their available actions.
Dynamic menu groups auto-register at runtime with prefix "menu_".
"""

MODULE_REGISTRY = {
    # Communication (split from single "messaging" page key)
    "email":        {"label": "Email",               "actions": ["view", "compose", "edit", "delete", "export"]},
    "messaging":    {"label": "Messaging Channels",   "actions": ["view", "reply", "assign", "delete"]},
    "callcenter":   {"label": "Call Center",          "actions": ["view", "make_call", "edit", "delete"]},
    "livechat":     {"label": "Live Chat",            "actions": ["view", "reply", "assign", "delete"]},
    "workspace":    {"label": "Agent Workspace",      "actions": ["view", "edit"]},

    # Business modules
    "crm":          {"label": "CRM",                  "actions": ["view", "add", "edit", "delete", "import", "export"]},
    "tickets":      {"label": "Tickets",              "actions": ["view", "add", "edit", "delete", "assign"]},
    "pms":              {"label": "Projects (PMS)",       "actions": ["view", "add", "edit", "delete"]},
    "pms_tasks":        {"label": "Tasks",                "actions": ["view", "add", "edit", "delete", "assign"]},
    "pms_milestones":   {"label": "Milestones",           "actions": ["view", "add", "edit", "delete"]},
    "campaigns":    {"label": "Email Campaigns",      "actions": ["view", "add", "edit", "delete", "send"]},
    "reports":      {"label": "Reports",              "actions": ["view", "export"]},
    "kb":           {"label": "Knowledge Base",       "actions": ["view", "add", "edit", "delete", "publish"]},
    "teams":        {"label": "Teams",                "actions": ["view", "add", "edit", "delete"]},

    # Admin features (migrated from feature_* permission keys)
    "manage_users":          {"label": "Manage Users",          "actions": ["view", "add", "edit", "delete"]},
    "manage_teams":          {"label": "Manage Teams",          "actions": ["view", "add", "edit", "delete"]},
    "manage_email_accounts": {"label": "Email Accounts",        "actions": ["view", "add", "edit", "delete"]},
    "manage_messenger_config": {"label": "Messenger Config",    "actions": ["view", "edit"]},
    "manage_telephony":      {"label": "Telephony (VoIP)",      "actions": ["view", "edit"]},
    "manage_extensions":     {"label": "SIP Extensions",        "actions": ["view", "add", "edit", "delete"]},
    "manage_branding":       {"label": "Branding",              "actions": ["view", "edit"]},
    "manage_roles":          {"label": "Role Permissions",      "actions": ["view", "edit"]},
    "manage_cors":           {"label": "CORS / Widget Origins", "actions": ["view", "edit"]},
    "manage_bot":            {"label": "Chat Bot",              "actions": ["view", "edit"]},
    "manage_cloudpanel":     {"label": "CloudPanel",            "actions": ["view", "add", "edit", "delete"]},
    "manage_dynamic_fields": {"label": "Dynamic Fields",        "actions": ["view", "add", "edit", "delete"]},
    "manage_ssl":            {"label": "SSL Monitor",           "actions": ["view"]},
    "manage_billing":        {"label": "Billing",               "actions": ["view", "edit"]},
    "manage_forms":          {"label": "Form Builder",          "actions": ["view", "add", "edit", "delete"]},
    "manage_menus":          {"label": "Menu Manager",          "actions": ["view", "add", "edit", "delete"]},

    # Logs
    "audit_logs":     {"label": "Audit Log",           "actions": ["view"]},
    "error_logs":     {"label": "Error Log",           "actions": ["view"]},

    # Modules (migrated from module_* permission keys)
    "organizations":  {"label": "Organizations",      "actions": ["view", "add", "edit", "delete"]},
    "contacts":       {"label": "Contacts",           "actions": ["view", "add", "edit", "delete"]},
    "subscriptions":  {"label": "Subscriptions",      "actions": ["view", "add", "edit", "delete"]},
    "calls":          {"label": "Call Records",        "actions": ["view", "export"]},
    "reminders":      {"label": "Reminder Calls",     "actions": ["view", "add", "edit", "delete"]},
    "notifications":  {"label": "Notifications",      "actions": ["view", "add", "edit", "delete"]},
    "individuals":    {"label": "Individuals",        "actions": ["view", "add", "edit", "delete"]},
}


def get_module_actions(module_key: str) -> list[str]:
    """Get available actions for a module. Returns empty list if module not found."""
    mod = MODULE_REGISTRY.get(module_key)
    return mod["actions"] if mod else []


def get_all_module_keys() -> list[str]:
    """Return all static module keys."""
    return list(MODULE_REGISTRY.keys())
