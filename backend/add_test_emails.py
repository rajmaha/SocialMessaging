#!/usr/bin/env python3
import sqlite3
from datetime import datetime, timedelta

# Connect to database
conn = sqlite3.connect('email_social_media.db')
cursor = conn.cursor()

# Check if emails table exists
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'")
if cursor.fetchone():
    print("✅ Emails table exists")
    
    # Test emails
    test_emails = [
        (1, 2, 5, 'Welcome to SaralOMS', 'sender@example.com', 'user@example.com', '', '', 
         '<p>Welcome! This is your first email.</p>', 'Welcome! This is your first email.',
         (datetime.now() - timedelta(days=2)).isoformat(), 0, 0, 0),
        (2, 2, 5, 'Meeting Tomorrow', 'boss@example.com', 'user@example.com', 'team@example.com', '',
         '<p>We have a meeting tomorrow at 10 AM.</p>', 'We have a meeting tomorrow at 10 AM.',
         (datetime.now() - timedelta(days=1)).isoformat(), 0, 1, 0),
        (3, 2, 5, 'Reply to: Project Update', 'user@example.com', 'boss@example.com', 'team@example.com', '',
         '<p>Project is on track. Will have update by Friday.</p>', 'Project is on track. Will have update by Friday.',
         datetime.now().isoformat(), 1, 0, 1),
        (4, 2, 5, 'Action Required: Contract Review', 'legal@example.com', 'user@example.com', '', '',
         '<p>Please review and sign the attached contract.</p>', 'Please review and sign the attached contract.',
         (datetime.now() - timedelta(hours=6)).isoformat(), 0, 0, 0),
    ]
    
    for email in test_emails:
        cursor.execute("""
            INSERT INTO emails (thread_id, user_id, email_account_id, subject, 
                from_address, to_address, cc, bcc, body_html, body_text, 
                received_at, is_read, is_starred, is_sent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, email)
    
    # Delete existing emails first to avoid duplicates
    cursor.execute("DELETE FROM emails WHERE user_id = 2 AND thread_id >= 1 AND thread_id <= 4")
    conn.commit()
    
    # Now insert
    for email in test_emails:
        cursor.execute("""
            INSERT INTO emails (thread_id, user_id, email_account_id, subject, 
                from_address, to_address, cc, bcc, body_html, body_text, 
                received_at, is_read, is_starred, is_sent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, email)
    
    conn.commit()
    print(f"✅ Added {len(test_emails)} test emails to database")
    
    # Verify
    cursor.execute("SELECT COUNT(*) FROM emails WHERE user_id = 2")
    count = cursor.fetchone()[0]
    print(f"✅ Total emails for user 2: {count}")
else:
    print("❌ Emails table not found")

conn.close()
