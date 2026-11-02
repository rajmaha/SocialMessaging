from sqlalchemy import text


def test_test_database_reachable(test_engine):
    with test_engine.connect() as conn:
        assert conn.execute(text("SELECT 1")).scalar() == 1
