#!/usr/bin/env python3
"""Add test attachments to existing emails for testing download functionality."""

import sys
import os
from datetime import datetime

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models.email import Email, EmailAttachment

def add_test_attachments():
    db = SessionLocal()
    
    try:
        # Get the test emails we created earlier
        emails = db.query(Email).order_by(Email.id.desc()).limit(3).all()
        
        if not emails:
            print("No emails found in database!")
            return
        
        print(f"Found {len(emails)} emails")
        
        # Add sample attachments to each email
        test_attachments = [
            {
                "filename": "contract_review.pdf",
                "content_type": "application/pdf",
                "size": 245678
            },
            {
                "filename": "meeting_agenda.docx",
                "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "size": 34567
            },
            {
                "filename": "Q4_Budget.xlsx",
                "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "size": 123456
            }
        ]
        
        # Add attachments to emails
        for idx, email in enumerate(emails):
            # Add 1-3 attachments per email
            attachments_to_add = test_attachments[: (idx + 1) % 3 + 1]
            
            for att in attachments_to_add:
                attachment = EmailAttachment(
                    email_id=email.id,
                    filename=att["filename"],
                    content_type=att["content_type"],
                    size=att["size"],
                    file_path=f"/tmp/{att['filename']}"  # Placeholder path
                )
                db.add(attachment)
                print(f"✓ Added attachment '{att['filename']}' to email ID {email.id} ({email.subject})")
        
        db.commit()
        print("\n✓ All test attachments added successfully!")
        
        # Verify
        all_attachments = db.query(EmailAttachment).all()
        print(f"Total attachments in database: {len(all_attachments)}")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    add_test_attachments()
