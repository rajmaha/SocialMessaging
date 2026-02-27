#!/usr/bin/env python
"""Migration: Add organization_id column to tickets and call_recordings tables"""

from app.database import engine
from sqlalchemy import text

def add_columns():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL"))
            conn.commit()
            print("✅ Added 'organization_id' column to tickets table")
        except Exception as e:
            if "already exists" in str(e) or "Duplicate column name" in str(e):
                print("⚠️  'organization_id' column already exists in tickets")
            else:
                print(f"❌ Error tickets: {str(e)[:200]}")
                
        try:
            conn.execute(text("ALTER TABLE call_recordings ADD COLUMN organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL"))
            conn.commit()
            print("✅ Added 'organization_id' column to call_recordings table")
        except Exception as e:
            if "already exists" in str(e) or "Duplicate column name" in str(e):
                print("⚠️  'organization_id' column already exists in call_recordings")
            else:
                print(f"❌ Error call_recordings: {str(e)[:200]}")

if __name__ == "__main__":
    print("Running migration for organization_id...")
    add_columns()
    print("✅ Done!")
