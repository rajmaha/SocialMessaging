#!/usr/bin/env python
"""Setup database schema - add missing columns"""

from app.database import engine
from sqlalchemy import text

def add_columns():
    with engine.connect() as conn:
        columns = [
            ("role", "ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'user'"),
            ("is_active", "ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE"),
            ("created_by", "ALTER TABLE users ADD COLUMN created_by INTEGER"),
            ("updated_at", "ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ]
        
        for col_name, sql in columns:
            try:
                conn.execute(text(sql))
                conn.commit()
                print(f"✅ Added '{col_name}' column")
            except Exception as e:
                if "already exists" in str(e):
                    print(f"⚠️  '{col_name}' column already exists")
                else:
                    print(f"❌ Error adding '{col_name}': {str(e)[:100]}")

if __name__ == "__main__":
    print("Setting up database schema...")
    add_columns()
    print("✅ Done!")
