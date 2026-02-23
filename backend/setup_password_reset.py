#!/usr/bin/env python3
"""
Setup script to add password reset columns to users table
"""

from app.database import engine
from sqlalchemy import text

def add_password_reset_columns():
    """Add password reset token columns to users table"""
    
    with engine.connect() as connection:
        # Check if columns already exist
        try:
            # Try to add password_reset_token column
            connection.execute(text("""
                ALTER TABLE users 
                ADD COLUMN password_reset_token VARCHAR DEFAULT NULL
            """))
            connection.commit()
            print("✅ Added 'password_reset_token' column")
        except Exception as e:
            if "already exists" in str(e) or "duplicate" in str(e):
                print("⚠️ 'password_reset_token' column already exists")
            else:
                print(f"Error adding password_reset_token: {e}")
        
        try:
            # Try to add password_reset_expires column
            connection.execute(text("""
                ALTER TABLE users 
                ADD COLUMN password_reset_expires TIMESTAMP DEFAULT NULL
            """))
            connection.commit()
            print("✅ Added 'password_reset_expires' column")
        except Exception as e:
            if "already exists" in str(e) or "duplicate" in str(e):
                print("⚠️ 'password_reset_expires' column already exists")
            else:
                print(f"Error adding password_reset_expires: {e}")

if __name__ == "__main__":
    add_password_reset_columns()
    print("\n✨ Database setup complete!")
