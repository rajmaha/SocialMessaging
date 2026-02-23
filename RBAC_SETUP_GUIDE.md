# Role-Based Access Control (RBAC) Setup Guide

## Quick Overview

The Social Media Messaging System now includes **Role-Based Access Control** with two distinct user roles:

### 👨‍💼 Admin Role
- Full system access
- Manage users (create, edit, deactivate)
- Configure platform credentials
- View system statistics
- Access: `/admin` dashboard

### 👤 User Role
- Messaging access only
- Send/receive messages on configured platforms
- Cannot access admin features
- Access: `/dashboard` messaging interface

---

## Initial Setup Steps

### Step 1: Database Migration

Run the migration to add new columns and tables:

```bash
cd backend
# Using Alembic (if configured)
alembic upgrade head

# Or manually using SQL (see migration file for schema)
```

**New Database Changes:**
- User table: Added `role`, `is_active`, `created_by` columns
- New table: `platform_settings` for storing all platform credentials

### Step 2: Create First Admin User

1. **Option A: Direct Database Insert**
```sql
-- Insert first admin user (manually if needed)
INSERT INTO user (username, email, password_hash, full_name, role, is_active, created_by)
VALUES ('admin', 'admin@example.com', '<hashed_password>', 'System Admin', 'admin', true, NULL);
```

2. **Option B: Via API**
```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "email": "admin@example.com",
    "password": "SecurePassword123!",
    "full_name": "System Admin"
  }'

# Then update role to admin (requires database access)
```

3. **Option C: CLI Script** (create a simple script)
```python
# create_admin.py
from app.models.user import User
from app.database import SessionLocal
from app.routes.auth import get_password_hash

db = SessionLocal()
admin = User(
    username='admin',
    email='admin@example.com',
    password_hash=get_password_hash('SecurePassword123!'),
    full_name='System Admin',
    role='admin',
    is_active=True
)
db.add(admin)
db.commit()
print("Admin user created successfully!")
```

### Step 3: Verify Backend Changes

Check that the backend is running:

```bash
# Terminal 1: Start backend
cd backend
python -m uvicorn main:app --reload

# Terminal 2: Test endpoints
curl http://localhost:8000/health
# Expected response: {"status": "ok", "message": "..."}
```

### Step 4: Test Admin Login

1. Open http://localhost:3000/login
2. Login with first admin credentials
3. Verify redirect to `/admin` dashboard
4. Explore admin features

### Step 5: Create Regular Users

1. Go to Admin Dashboard → Users
2. Click "Create User"
3. Fill in user details
4. Select role: **User**
5. Click "Create User"

### Step 6: Configure Platforms

1. Go to Admin Dashboard → Settings
2. Select a platform (Facebook, WhatsApp, Viber, LinkedIn)
3. Enter platform credentials
4. Click "Save Configuration"
5. Verify webhook setup (see WEBHOOKS_SETUP.md)

---

## Architecture Overview

### Database Structure

```
┌─────────────────────────────────┐
│        User Table (Updated)      │
├─────────────────────────────────┤
│ • id (PK)                        │
│ • username                       │
│ • email                          │
│ • password_hash                  │
│ • full_name                      │
│ • role ← NEW ('admin'|'user')   │
│ • is_active ← NEW (boolean)     │
│ • created_by ← NEW (FK to user)│
│ • created_at                     │
│ • updated_at                     │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  PlatformSettings Table (NEW)    │
├─────────────────────────────────┤
│ • id (PK)                        │
│ • platform (facebook/whatsapp...)│
│ • app_id                         │
│ • app_secret                     │
│ • access_token                   │
│ • verify_token                   │
│ • phone_number_id (WhatsApp)    │
│ • page_id (Facebook)            │
│ • config (JSON)                  │
│ • is_configured (0/1/2)         │
│ • webhook_registered (0/1)      │
│ • created_at                     │
│ • updated_at                     │
└─────────────────────────────────┘
```

### Backend API Routes

**New Admin Routes:**
- POST `/admin/users` - Create user (admin only)
- GET `/admin/users` - List users (admin only)
- GET `/admin/users/{id}` - Get user details
- PUT `/admin/users/{id}/role` - Update user role
- DELETE `/admin/users/{id}` - Deactivate user
- GET `/admin/platforms` - List platforms config
- GET `/admin/platforms/{platform}` - Get platform config
- PUT `/admin/platforms/{platform}` - Update platform config
- POST `/admin/platforms/{platform}/verify` - Verify platform
- GET `/admin/dashboard` - Dashboard statistics

**Updated Auth Routes:**
- Login response now includes `role` field
- Registration now sets default role='user'

### Frontend Components

**New Admin Pages:**
- `/admin` - Admin dashboard with statistics
- `/admin/users` - User management interface
- `/admin/settings` - Platform configuration interface

**Updated Pages:**
- `/login` - Now redirects based on role
- `/dashboard` - User messaging interface (unchanged)

---

## Security Features

### Authentication

✅ Password hashing (SHA256)
✅ Session management via localStorage
✅ Unique email/username validation
✅ User deactivation support

### Authorization

✅ Role-based access control (RBAC)
✅ Admin-only route protection
✅ User-only route protection
✅ HTTP 403 Forbidden for unauthorized access

### Audit Trail

✅ `created_by` field tracks user creator
✅ `created_at` timestamps for all records
✅ `updated_at` tracks modifications
✅ Deactivation vs deletion preserves history

---

## File Changes Summary

### Backend Files Modified

#### New Files
- `backend/app/routes/admin.py` - 350+ lines
  - User management endpoints
  - Platform settings endpoints
  - Dashboard statistics endpoint

- `backend/app/models/platform_settings.py` - NEW MODEL
  - Stores all platform credentials
  - Tracks configuration status

- `backend/alembic/versions/001_add_rbac_and_platform_settings.py`
  - Database migration script

#### Updated Files
- `backend/app/models/user.py`
  - Added: role, is_active, created_by columns

- `backend/app/routes/auth.py`
  - Added: get_password_hash(), verify_password() functions
  - Updated: login response includes role
  - Updated: register sets role='user' by default
  - Added: is_active check in login

- `backend/main.py`
  - Added: import admin router
  - Added: include admin router

### Frontend Files Created

#### New Pages
- `frontend/app/admin/page.tsx` - Admin dashboard (450+ lines)
  - Statistics and overview
  - Platform status display
  - Quick action buttons

- `frontend/app/admin/users/page.tsx` - User management (350+ lines)
  - User list table
  - Create user form
  - Edit role dropdown
  - Deactivate button

- `frontend/app/admin/settings/page.tsx` - Platform config (400+ lines)
  - Platform cards
  - Configuration forms
  - Platform-specific fields

#### Updated Files
- `frontend/lib/auth.ts`
  - Updated: User interface includes role

- `frontend/app/login/page.tsx`
  - Updated: URL-based role routing on login
  - Admin → /admin
  - User → /dashboard

---

## Configuration Files

### Environment Variables

No new environment variables required. The system now stores platform credentials in the database instead of .env file for better security and easier management.

### Database Connection

Ensure your PostgreSQL connection is configured in `.env`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/socialmedia
```

---

## Testing Checklist

### Backend Testing

- [ ] Health check endpoint works
- [ ] Admin routes require authentication
- [ ] Non-admin users get 403 on admin routes
- [ ] User creation works with admin account
- [ ] Platform configuration saves correctly
- [ ] Dashboard statistics are accurate

### Frontend Testing

- [ ] Login with admin redirects to /admin
- [ ] Login with user redirects to /dashboard
- [ ] Admin can access all admin pages
- [ ] User cannot access admin pages
- [ ] User list loads and displays properly
- [ ] Platform configuration forms work
- [ ] Create user form validates inputs
- [ ] Role dropdown updates correctly

### Integration Testing

- [ ] Full user creation workflow
- [ ] Platform configuration workflow
- [ ] Login → Admin Dashboard → User Management
- [ ] Platform config persists after page reload

---

## Troubleshooting

### Admin Login Issues

```
Problem: Login works but redirects to /dashboard instead of /admin
Solution: Check database - role field should be 'admin' not 'user'

SQL Check:
SELECT id, email, role FROM user WHERE email='admin@example.com';
```

### Platform Configuration Not Saving

```
Problem: Configuration form submits but settings don't persist
Check:
1. Backend is running (port 8000)
2. Database is accessible
3. Credentials are valid (no special chars issues)
4. Browser console for errors
```

### User Cannot Create Account

```
Problem: Registration fails or new user can't login
Check:
1. Email/username not already registered
2. Password meets requirements
3. Database migrations ran successfully
4. Backend/frontend connection working
```

---

## Next Steps

1. **Create Admin Account** - Follow Step 1-2 above
2. **Configure Platforms** - See PLATFORM_CONFIGURATION_GUIDE.md
3. **Setup Webhooks** - See WEBHOOKS_SETUP.md
4. **Create Regular Users** - Use admin panel
5. **Monitor Dashboard** - Track usage and status

---

## Additional Resources

- [Admin Panel Guide](./ADMIN_PANEL_GUIDE.md) - Detailed admin interface guide
- [Platform Configuration](./PLATFORM_CONFIGURATION_GUIDE.md) - Platform setup instructions
- [Webhooks Setup](./WEBHOOKS_SETUP.md) - Webhook configuration guide
- [User Manual](./USER_MANUAL.md) - End-user documentation

---

## Support

For issues:
1. Check logs: `backend/logs/`
2. Verify database: `psql database_name`
3. Test endpoints: Use Postman or curl
4. Review error messages in browser console

---

**Version**: 1.0.0
**Last Updated**: 2024
**Status**: Active
