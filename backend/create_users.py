#!/usr/bin/env python
"""Create initial admin and user accounts"""

from app.models.user import User
from app.database import SessionLocal
from app.routes.auth import get_password_hash

def create_users():
    db = SessionLocal()
    
    # Check if admin already exists
    existing_admin = db.query(User).filter(User.email == 'admin@example.com').first()
    if existing_admin:
        print("⚠️  Admin user already exists")
        db.close()
        return
    
    # Create admin user
    admin = User(
        username='admin',
        email='admin@example.com',
        password_hash=get_password_hash('Admin@123'),
        full_name='System Administrator',
        role='admin',
        is_active=True,
        created_by=None
    )
    
    db.add(admin)
    db.commit()
    db.refresh(admin)
    
    print("✅ Admin user created!")
    print(f"   Email: admin@example.com")
    print(f"   Password: Admin@123")
    print(f"   ID: {admin.id}")
    
    # Create test user
    test_user = User(
        username='user',
        email='user@example.com',
        password_hash=get_password_hash('User@123'),
        full_name='Test User',
        role='user',
        is_active=True,
        created_by=admin.id
    )
    
    db.add(test_user)
    db.commit()
    db.refresh(test_user)
    
    print("\n✅ Test user created!")
    print(f"   Email: user@example.com")
    print(f"   Password: User@123")
    print(f"   ID: {test_user.id}")
    
    db.close()

if __name__ == "__main__":
    print("Creating initial users...\n")
    create_users()
    print("\n✅ Done!")
