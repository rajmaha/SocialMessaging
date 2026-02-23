#!/usr/bin/env python
"""Migration: Add admin_email column to branding table"""

from app.database import engine
from sqlalchemy import text

def add_column():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE branding ADD COLUMN admin_email VARCHAR"))
            conn.commit()
            print("✅ Added 'admin_email' column to branding table")
        except Exception as e:
            if "already exists" in str(e):
                print("⚠️  'admin_email' column already exists")
            else:
                print(f"❌ Error: {str(e)[:200]}")

if __name__ == "__main__":
    print("Running branding admin_email migration...")
    add_column()
    print("✅ Done!")
