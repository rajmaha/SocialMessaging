#!/usr/bin/env python3
import psycopg2
from urllib.parse import urlparse
from app.config import settings

# Parse database URL
url = urlparse(settings.DATABASE_URL)

conn = psycopg2.connect(
    host=url.hostname,
    port=url.port or 5432,
    database=url.path.lstrip('/'),
    user=url.username,
    password=url.password
)
cursor = conn.cursor()

try:
    # Check if column exists
    cursor.execute("""
        SELECT column_name FROM information_schema.columns 
        WHERE table_name='emails' AND column_name='labels'
    """)
    
    if not cursor.fetchone():
        # Add the labels column
        print("Adding 'labels' column to emails table...")
        cursor.execute("ALTER TABLE emails ADD COLUMN labels JSON DEFAULT '[]'::json")
        conn.commit()
        print("✓ Column 'labels' added successfully")
    else:
        print("✓ Column 'labels' already exists")
except Exception as e:
    print(f"✗ Error: {e}")
    conn.rollback()
finally:
    cursor.close()
    conn.close()
