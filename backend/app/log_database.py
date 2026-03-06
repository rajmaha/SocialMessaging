# backend/app/log_database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# SQLite file at backend/logs.db (one level above app/)
_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'logs.db')
LOGS_DATABASE_URL = f"sqlite:///{os.path.abspath(_DB_PATH)}"

log_engine = create_engine(
    LOGS_DATABASE_URL,
    connect_args={"check_same_thread": False}  # required for SQLite with FastAPI
)
LogSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=log_engine)
LogBase = declarative_base()


def get_log_db():
    db = LogSessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_log_db():
    """Create tables in logs.db. Call from main.py at startup."""
    LogBase.metadata.create_all(bind=log_engine)
