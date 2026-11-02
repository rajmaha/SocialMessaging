"""
Shared test fixtures.

Run from backend/:  venv/bin/python -m pytest

Tests that need a database ask for `test_engine`. They run only when
TEST_DATABASE_URL names a throwaway PostgreSQL database whose name contains
"test" -- the schema is created there and the tests write to it. Without it
those tests are skipped; the rest still run.

  docker run -d --name sm_test_pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=sm_test \
      -p 55499:5432 postgres:16-alpine
  TEST_DATABASE_URL=postgresql://postgres:test@localhost:55499/sm_test venv/bin/python -m pytest
"""

import os
import sys
from urllib.parse import urlparse

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

TEST_SECRET_KEY = "test-secret-key-for-pytest-only"


@pytest.fixture
def secret_key(monkeypatch):
    """A known SECRET_KEY for the length of one test."""
    from app.config import settings
    monkeypatch.setattr(settings, "SECRET_KEY", TEST_SECRET_KEY)
    return TEST_SECRET_KEY


@pytest.fixture(scope="session")
def test_engine():
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    name = (urlparse(url).path or "").lstrip("/")
    if "test" not in name.lower():
        pytest.exit(f"TEST_DATABASE_URL must name a test database (got '{name}')", returncode=2)
    from sqlalchemy import create_engine
    engine = create_engine(url, pool_pre_ping=True)
    yield engine
    engine.dispose()


def _import_all_models():
    """Every model module, so Base.metadata knows every table."""
    import importlib
    import pkgutil
    import app.models as models_pkg
    for mod in pkgutil.iter_modules(models_pkg.__path__):
        importlib.import_module(f"app.models.{mod.name}")


@pytest.fixture
def fresh_schema(test_engine):
    """An empty public schema with every table create_all() makes, as on a new install."""
    from sqlalchemy import text
    from app.database import Base
    _import_all_models()
    with test_engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(bind=test_engine)
    return test_engine
