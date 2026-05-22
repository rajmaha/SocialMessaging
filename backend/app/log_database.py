# Audit/error logs now live in the main PostgreSQL database.
# This module re-exports from app.database so all existing callers work unchanged.
from app.database import Base as LogBase, SessionLocal as LogSessionLocal, engine as log_engine, get_db as get_log_db

__all__ = ["LogBase", "LogSessionLocal", "log_engine", "get_log_db"]


def init_log_db():
    """No-op — tables are now created by main Base.metadata.create_all()."""
    pass
