#!/usr/bin/env python
"""Initialize platform settings in the database"""

from app.models.platform_settings import PlatformSettings
from app.database import SessionLocal, engine, Base

def init_platforms():
    # Create tables
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    platforms = ['facebook', 'whatsapp', 'viber', 'linkedin']
    
    for platform_name in platforms:
        # Check if platform already exists
        existing = db.query(PlatformSettings).filter(
            PlatformSettings.platform == platform_name
        ).first()
        
        if not existing:
            platform = PlatformSettings(
                platform=platform_name,
                is_configured=0,
                webhook_registered=0
            )
            db.add(platform)
            print(f"✅ Created {platform_name} platform settings")
        else:
            print(f"⚠️  {platform_name} platform settings already exists")
    
    db.commit()
    db.close()
    print("\n✅ Platform initialization complete!")

if __name__ == "__main__":
    print("Initializing platform settings...\n")
    init_platforms()
