#!/usr/bin/env python3
"""Direct database migration script to add smtp_security field"""

import psycopg2
from psycopg2 import sql
import sys

# Database connection
try:
    conn = psycopg2.connect(
        host="localhost",
        database="socialmedia",
        user="rajmaha",
        port="5432"
    )
    cursor = conn.cursor()
    
    # Check if column already exists
    cursor.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='user_email_accounts' and column_name='smtp_security'
    """)
    
    if cursor.fetchone():
        print("✅ Column 'smtp_security' already exists")
    else:
        # Add smtp_security column
        cursor.execute("""
            ALTER TABLE user_email_accounts
            ADD COLUMN smtp_security VARCHAR NOT NULL DEFAULT 'STARTTLS'
        """)
        conn.commit()
        print("✅ Added smtp_security column to user_email_accounts table")
    
    cursor.close()
    conn.close()
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    sys.exit(1)
