#!/usr/bin/env python3
import sys
sys.path.insert(0, '/Users/rajmaha/Sites/SocialMedia/backend')

from app.database import SessionLocal
from app.models.email import Email, EmailThread
from datetime import datetime, timedelta

db = SessionLocal()

try:
    # Create test emails (without threads for simplicity)
    test_emails = [
        Email(
            account_id=5,
            thread_id=None,
            message_id='msg_001@example.com',
            subject='Welcome to SaralOMS',
            from_address='sender@example.com',
            to_address='user@example.com',
            body_html='<p>Welcome! This is your first email.</p>',
            body_text='Welcome! This is your first email.',
            received_at=datetime.now() - timedelta(days=2),
            is_read=False,
            is_starred=False,
            is_sent=False,
        ),
        Email(
            account_id=5,
            thread_id=None,
            message_id='msg_002@example.com',
            subject='Meeting Tomorrow',
            from_address='boss@example.com',
            to_address='user@example.com',
            cc='team@example.com',
            body_html='<p>We have a meeting tomorrow at 10 AM.</p>',
            body_text='We have a meeting tomorrow at 10 AM.',
            received_at=datetime.now() - timedelta(days=1),
            is_read=False,
            is_starred=True,
            is_sent=False,
        ),
        Email(
            account_id=5,
            thread_id=None,
            message_id='msg_003@example.com',
            subject='Reply to: Project Update',
            from_address='user@example.com',
            to_address='boss@example.com',
            cc='team@example.com',
            body_html='<p>Project is on track. Will have update by Friday.</p>',
            body_text='Project is on track. Will have update by Friday.',
            received_at=datetime.now(),
            is_read=True,
            is_starred=False,
            is_sent=True,
        ),
        Email(
            account_id=5,
            thread_id=None,
            message_id='msg_004@example.com',
            subject='Action Required: Contract Review',
            from_address='legal@example.com',
            to_address='user@example.com',
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
    print(f"✅ Added {len(test_emails)} test emails to database")
    
    # Verify
    count = db.query(Email).filter(Email.account_id == 5).count()
    print(f"✅ Total emails for account 5: {count}")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    db.rollback()
finally:
    db.close()
