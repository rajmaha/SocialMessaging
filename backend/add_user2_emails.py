#!/usr/bin/env python3
import sys
sys.path.insert(0, '.')

from app.database import SessionLocal
from app.models.email import Email
from datetime import datetime, timedelta

db = SessionLocal()

try:
    # Create test emails for User 2's account (account_id 6)
    test_emails = [
        Email(
            account_id=6,
            thread_id=None,
            message_id='msg_user2_001@example.com',
            subject='Welcome to SaralOMS',
            from_address='sender@example.com',
            to_address='test.smtp.security@gmail.com',
            body_html='<p>Welcome! This is your first email.</p>',
            body_text='Welcome! This is your first email.',
            received_at=datetime.now() - timedelta(days=2),
            is_read=False,
            is_starred=False,
            is_sent=False,
        ),
        Email(
            account_id=6,
            thread_id=None,
            message_id='msg_user2_002@example.com',
            subject='Meeting Tomorrow',
            from_address='boss@example.com',
            to_address='test.smtp.security@gmail.com',
            cc='team@example.com',
            body_html='<p>We have a meeting tomorrow at 10 AM.</p>',
            body_text='We have a meeting tomorrow at 10 AM.',
            received_at=datetime.now() - timedelta(days=1),
            is_read=False,
            is_starred=True,
            is_sent=False,
        ),
        Email(
            account_id=6,
            thread_id=None,
            message_id='msg_user2_003@example.com',
            subject='Action Required: Contract Review',
            from_address='legal@example.com',
            to_address='test.smtp.security@gmail.com',
            body_html='<p>Please review and sign the attached contract.</p>',
            body_text='Please review and sign the attached contract.',
            received_at=datetime.now() - timedelta(hours=6),
            is_read=False,
            is_starred=False,
            is_sent=False,
        ),
    ]
    
    for email in test_emails:
        db.add(email)
    
    db.commit()
    print(f"✅ Added {len(test_emails)} test emails for user 2 (account 6)")
    
    # Verify
    count = db.query(Email).filter(Email.account_id == 6).count()
    print(f"✅ Total emails for account 6: {count}")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    db.rollback()
finally:
    db.close()
