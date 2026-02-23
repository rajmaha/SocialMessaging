#!/usr/bin/env python
"""Migration: Add OTP and email verification columns to users table"""

from app.database import engine
from sqlalchemy import text

def add_columns():
    with engine.connect() as conn:
        columns = [
            ("otp_code", "ALTER TABLE users ADD COLUMN otp_code VARCHAR"),
            ("otp_expires", "ALTER TABLE users ADD COLUMN otp_expires TIMESTAMP"),
            ("otp_context", "ALTER TABLE users ADD COLUMN otp_context VARCHAR"),
            ("is_verified", "ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE"),
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

        # Mark existing users as verified so they aren't locked out
        try:
            conn.execute(text("UPDATE users SET is_verified = TRUE WHERE is_verified IS NULL OR is_verified = FALSE"))
            conn.commit()
            print("✅ Marked existing users as verified")
        except Exception as e:
            print(f"❌ Error marking existing users: {str(e)[:100]}")

if __name__ == "__main__":
    print("Running OTP migration...")
    add_columns()
    print("✅ Done!")
