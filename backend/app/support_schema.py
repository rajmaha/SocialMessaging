"""
Support desk columns and indexes on tables that already exist.

create_all() makes the support_* tables, and makes widget_domains / tickets with
these columns on a new database, but never alters a table that is already
there. These statements do, and are safe to run on every start-up: each is
IF NOT EXISTS and commits on its own (in PostgreSQL one failing statement
aborts its whole transaction, which is what once rolled back unrelated columns
in main.py's long migration block).
"""

import logging

from sqlalchemy import text

log = logging.getLogger(__name__)

SUPPORT_STATEMENTS = (
    # widget_domains: a widget domain is a support site
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS support_enabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS chat_enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS allow_anonymous INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS live_help_enabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS support_categories JSON",
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS identity_secret VARCHAR",
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS webhook_url VARCHAR",
    "ALTER TABLE widget_domains ADD COLUMN IF NOT EXISTS organization_id INTEGER "
    "REFERENCES organizations(id) ON DELETE SET NULL",
    # tickets: which site and person a support request came from
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS support_site_id INTEGER "
    "REFERENCES widget_domains(id) ON DELETE SET NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS support_user_id INTEGER "
    "REFERENCES support_users(id) ON DELETE SET NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS support_subject VARCHAR",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS support_screen VARCHAR",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS support_url VARCHAR",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS solved_at TIMESTAMPTZ",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_author VARCHAR",
    # telephony_settings: which TURN relay live help and the softphone use
    "ALTER TABLE telephony_settings ADD COLUMN IF NOT EXISTS turn_provider VARCHAR",
    "ALTER TABLE telephony_settings ADD COLUMN IF NOT EXISTS cloudflare_turn_key_id VARCHAR",
    "ALTER TABLE telephony_settings ADD COLUMN IF NOT EXISTS cloudflare_turn_token VARCHAR",
    "ALTER TABLE telephony_settings ADD COLUMN IF NOT EXISTS cloudflare_turn_ttl INTEGER",
    "CREATE INDEX IF NOT EXISTS ix_tickets_support_site_id ON tickets (support_site_id)",
    "CREATE INDEX IF NOT EXISTS ix_tickets_support_user_id ON tickets (support_user_id)",
)


def apply_support_schema(engine) -> list:
    """Run every statement; answers the ones that failed, as (statement, error)."""
    failed = []
    for stmt in SUPPORT_STATEMENTS:
        try:
            with engine.begin() as conn:
                conn.execute(text(stmt))
        except Exception as err:  # one bad statement must not stop the rest
            log.warning("Support schema statement failed: %s -- %s", stmt, err)
            failed.append((stmt, str(err)))
    return failed
