"""
Migration: Add user profile fields (phone, bio, avatar, social URLs)
Run: DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia venv/bin/python add_profile_fields.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from app.database import engine
from sqlalchemy import text

COLUMNS = [
    ("phone",            "VARCHAR(50)"),
    ("bio",              "TEXT"),
    ("avatar_url",       "VARCHAR(500)"),
    ("social_twitter",   "VARCHAR(500)"),
    ("social_facebook",  "VARCHAR(500)"),
    ("social_linkedin",  "VARCHAR(500)"),
    ("social_instagram", "VARCHAR(500)"),
    ("social_youtube",   "VARCHAR(500)"),
]

with engine.connect() as conn:
    for col, col_type in COLUMNS:
        conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {col_type}"))
        print(f"  ✓ {col}")
    conn.commit()

print("Profile fields migration complete.")
