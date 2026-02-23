#!/usr/bin/env python3
from sqlalchemy import text
from app.database import engine

with engine.connect() as conn:
    try:
        # Check if thread_id column already exists
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name='emails' AND column_name='thread_id'
        """))
        if result.fetchone():
            print("thread_id column already exists")
        else:
            # Add the thread_id column
            conn.execute(text("""
                ALTER TABLE emails ADD COLUMN thread_id INTEGER
            """))
            # Add the foreign key constraint
            conn.execute(text("""
                ALTER TABLE emails ADD CONSTRAINT fk_emails_thread_id 
                FOREIGN KEY (thread_id) REFERENCES email_threads(id)
            """))
            conn.commit()
            print("Successfully added thread_id column to emails table")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
