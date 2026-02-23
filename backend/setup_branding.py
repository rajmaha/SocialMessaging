#!/usr/bin/env python3
"""
Setup script to initialize branding settings in the database
"""

from app.database import engine, Base, SessionLocal
from app.models.branding import BrandingSettings

def init_branding():
    """Initialize default branding settings"""
    
    # Create tables
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    try:
        # Check if branding settings already exist
        existing = db.query(BrandingSettings).first()
        
        if existing:
            print("✅ Branding settings already exist")
            return
        
        # Create default branding
        branding = BrandingSettings(
            company_name="Social Media Messenger",
            company_description="Unified messaging platform for all your social media accounts",
            logo_url="https://via.placeholder.com/200x80?text=SMM+Logo",
            favicon_url="https://via.placeholder.com/32x32?text=SMM",
            primary_color="#2563eb",
            secondary_color="#1e40af",
            accent_color="#3b82f6",
            smtp_server="smtp.gmail.com",
            smtp_port=587,
            smtp_from_email="noreply@socialmedia.com",
            smtp_from_name="Social Media Messenger",
            smtp_use_tls=True,
            email_footer_text="© 2026 Social Media Messenger. All rights reserved.",
        )
        
        db.add(branding)
        db.commit()
        print("✅ Branding settings initialized")
    
    finally:
        db.close()

if __name__ == "__main__":
    init_branding()
    print("\n✨ Branding setup complete!")
