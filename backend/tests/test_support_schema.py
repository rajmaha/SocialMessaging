from sqlalchemy import inspect, text

from app.support_schema import apply_support_schema

NEW_DOMAIN_COLUMNS = {
    "support_enabled", "chat_enabled", "allow_anonymous", "live_help_enabled",
    "support_categories", "identity_secret", "webhook_url", "organization_id",
}
NEW_TICKET_COLUMNS = {
    "support_site_id", "support_user_id", "support_subject", "support_screen",
    "support_url", "solved_at", "last_author",
}


def _snapshot(engine):
    with engine.connect() as conn:
        cols = conn.execute(text(
            "SELECT table_name, column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_schema = 'public' "
            "ORDER BY table_name, column_name")).fetchall()
        idx = conn.execute(text(
            "SELECT tablename, indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' ORDER BY tablename, indexname")).fetchall()
        fks = conn.execute(text(
            "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE contype = 'f' ORDER BY 1, 2")).fetchall()
    return cols, idx, fks


def test_new_tables_exist(fresh_schema):
    names = set(inspect(fresh_schema).get_table_names())
    assert {"support_users", "support_messages", "support_webhooks", "support_attempts"} <= names


def test_fresh_install_is_already_complete(fresh_schema):
    before = _snapshot(fresh_schema)
    assert apply_support_schema(fresh_schema) == []
    assert apply_support_schema(fresh_schema) == []
    cols, _, _ = _snapshot(fresh_schema)
    # create_all already made the columns; the statements only add the two named indexes
    assert cols == before[0]


def test_existing_database_gets_columns_once(fresh_schema):
    # an existing install: widget_domains and tickets as they were before support
    with fresh_schema.begin() as conn:
        for col in NEW_DOMAIN_COLUMNS:
            conn.execute(text(f"ALTER TABLE widget_domains DROP COLUMN {col}"))
        for col in NEW_TICKET_COLUMNS:
            conn.execute(text(f"ALTER TABLE tickets DROP COLUMN {col} CASCADE"))
    insp = inspect(fresh_schema)
    assert not NEW_DOMAIN_COLUMNS & {c["name"] for c in insp.get_columns("widget_domains")}

    assert apply_support_schema(fresh_schema) == []
    insp = inspect(fresh_schema)
    assert NEW_DOMAIN_COLUMNS <= {c["name"] for c in insp.get_columns("widget_domains")}
    assert NEW_TICKET_COLUMNS <= {c["name"] for c in insp.get_columns("tickets")}

    first = _snapshot(fresh_schema)
    assert apply_support_schema(fresh_schema) == []
    assert _snapshot(fresh_schema) == first


def test_existing_rows_get_defaults(fresh_schema):
    with fresh_schema.begin() as conn:
        conn.execute(text("ALTER TABLE widget_domains DROP COLUMN support_enabled"))
        conn.execute(text("ALTER TABLE widget_domains DROP COLUMN chat_enabled"))
        conn.execute(text(
            "INSERT INTO widget_domains (domain, widget_key, display_name, is_active) "
            "VALUES ('example.com', 'k-1', 'Example', 1)"))
    apply_support_schema(fresh_schema)
    with fresh_schema.connect() as conn:
        row = conn.execute(text(
            "SELECT support_enabled, chat_enabled FROM widget_domains WHERE widget_key = 'k-1'")).one()
    assert tuple(row) == (0, 1)


def test_one_failure_does_not_stop_the_rest(fresh_schema, monkeypatch):
    import app.support_schema as schema
    monkeypatch.setattr(schema, "SUPPORT_STATEMENTS",
                        ("ALTER TABLE no_such_table ADD COLUMN IF NOT EXISTS x INTEGER",)
                        + schema.SUPPORT_STATEMENTS)
    with fresh_schema.begin() as conn:
        conn.execute(text("ALTER TABLE tickets DROP COLUMN last_author"))
    failed = schema.apply_support_schema(fresh_schema)
    assert len(failed) == 1 and "no_such_table" in failed[0][0]
    assert "last_author" in {c["name"] for c in inspect(fresh_schema).get_columns("tickets")}
