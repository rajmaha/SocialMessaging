# Admin Panel Documentation

## Overview

The Admin Panel provides comprehensive management capabilities for the Social Media Messaging System. Admins can manage users, configure platform credentials, and monitor system statistics.

## Table of Contents

1. [Admin Dashboard](#admin-dashboard)
2. [User Management](#user-management)
3. [Platform Configuration](#platform-configuration)
4. [Access Control](#access-control)

---

## Admin Dashboard

### Location
`http://localhost:3000/admin`

### Features

The admin dashboard provides:

- **Total Users**: Display of all registered users in the system
- **Active Users**: Count of active (not deactivated) users
- **Admin Users**: Count of users with admin role
- **Regular Users**: Count of users with regular user role
- **Platform Status**: Overview of platform configuration and webhook status

### Platform Status Colors

- **Red (Not Setup)**: Platform has no configuration
- **Yellow (Configured)**: Platform credentials are saved but not fully verified
- **Green (Verified)**: Platform is fully configured and webhooks are registered

### Quick Actions

From the dashboard, you can quickly navigate to:

- **Manage Users**: Go to user management page
- **Configure Platforms**: Go to platform settings page

---

## User Management

### Location
`http://localhost:3000/admin/users`

### Features

#### List Users

Display all users with columns:
- **Name**: Full name and username
- **Email**: User's email address
- **Role**: Current role (Admin or User)
- **Status**: Active or Inactive
- **Created**: Account creation date
- **Actions**: Available actions for each user

#### Create New User

**Form Fields:**

1. **Full Name** (Required): User's full name
2. **Username** (Required): Unique username for login
3. **Email** (Required): Unique email address
4. **Password** (Required): Initial password for the account
5. **Role** (Required): Select between:
   - **User**: Can access messaging functionality only
   - **Admin**: Has full system access

**After Creation:**

- System generates the user account with the specified role
- User can login with email and password
- Password can be changed after first login

#### Update User Role

- Click the Role dropdown for any user
- Select new role: **Admin** or **User**
- Changes take effect immediately

#### Deactivate User

- Click **Deactivate** button on the user row
- Deactivated users cannot login
- To reactivate, contact database administrator

---

## Platform Configuration

### Location
`http://localhost:3000/admin/settings`

### Supported Platforms

The system supports configuration for:

1. **Facebook Messenger**
2. **WhatsApp Business**
3. **Viber Bot**
4. **LinkedIn Messaging**

### Configuration Workflow

1. View platform cards showing current status
2. Click **Configure** button for desired platform
3. Enter required credentials
4. Click **Save Configuration**
5. Verify platform is operational

### Platform-Specific Configurations

#### Facebook Messenger

**Required Fields:**

- **App ID**: Your Facebook App ID
- **App Secret**: Your Facebook App Secret
- **Access Token**: Facebook Page Access Token
- **Verify Token**: Custom token for webhook verification
- **Page ID**: Your Facebook Page ID

**Where to Get:**

1. Go to [Facebook Developers](https://developers.facebook.com)
2. Create/Select an App
3. Go to Settings > Basic to find App ID and App Secret
4. Go to Messenger > Settings to generate Access Token
5. Go to Pages to find your Page ID

#### WhatsApp Business

**Required Fields:**

- **App ID**: Your WhatsApp Business App ID
- **App Secret**: Your WhatsApp Business App Secret
- **Access Token**: Permanent Access Token from WhatsApp
- **Verify Token**: Custom token for webhook verification
- **Phone Number ID**: Your WhatsApp Business Phone Number ID
- **Business Account ID**: Your WhatsApp Business Account ID

**Where to Get:**

1. Go to [WhatsApp Business Manager](https://business.facebook.com)
2. Navigate to WhatsApp > Phone Numbers
3. Copy your Phone Number ID
4. Go to WhatsApp > Business Account to find Business Account ID
5. Generate Access Token from API settings

#### Viber Bot

**Required Fields:**

- **App ID**: Your Viber Bot Account ID
- **Access Token**: Your Viber Bot Token

**Where to Get:**

1. Go to [Viber Partners](https://partners.viber.com)
2. Create a new Bot Account
3. Copy the Bot Account Token (this is your Access Token)
4. Bot Account ID is provided during creation

#### LinkedIn Messaging

**Required Fields:**

- **App ID**: Your LinkedIn App ID
- **App Secret**: Your LinkedIn App Secret
- **Access Token**: LinkedIn Messaging Access Token

**Where to Get:**

1. Go to [LinkedIn Developers](https://www.linkedin.com/developers)
2. Create a new App
3. Go to Settings to find App ID and App Secret
4. Go to Messaging to configure and get Access Token

---

## Access Control

### Role-Based Permissions

#### Admin Users

Admins have access to:

- ✅ Admin Dashboard (`/admin`)
- ✅ User Management (`/admin/users`)
- ✅ Platform Settings (`/admin/settings`)
- ✅ Dashboard & Messaging (`/dashboard`)
- ✅ Create/Edit/Delete users
- ✅ Configure platform credentials
- ✅ View system statistics

#### Regular Users

Regular users have access to:

- ❌ Admin Dashboard
- ❌ User Management
- ❌ Platform Settings
- ✅ Dashboard & Messaging (`/dashboard`)
- ✅ Send/Receive messages on configured platforms
- ✅ View only their own conversations

### Login Redirect Behavior

After successful login:

- **Admin User** → Redirected to `/admin` dashboard
- **Regular User** → Redirected to `/dashboard` messaging

### Security

- All admin routes are protected by role verification
- Server returns **403 Forbidden** for unauthorized access
- Users cannot escalate their own role
- Deactivated users cannot login
- Created by tracking for audit purposes

---

## Database Schema

### User Model Updates

```sql
-- New/Updated columns in User table
role VARCHAR(50) DEFAULT 'user'  -- 'admin' or 'user'
is_active BOOLEAN DEFAULT TRUE   -- Account status
created_by INTEGER               -- ID of admin who created user
```

### PlatformSettings Model

```sql
CREATE TABLE platform_settings (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(50) UNIQUE NOT NULL,
    app_id VARCHAR(255),
    app_secret VARCHAR(255),
    access_token VARCHAR(255),
    verify_token VARCHAR(255),
    business_account_id VARCHAR(255),
    phone_number VARCHAR(20),
    phone_number_id VARCHAR(255),
    organization_id VARCHAR(255),
    page_id VARCHAR(255),
    config JSON,
    is_configured INT DEFAULT 0,  -- 0=not configured, 1=configured, 2=verified
    webhook_registered INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
)
```

---

## API Endpoints

### Admin User Management

```
GET    /admin/users              - List all users
POST   /admin/users              - Create new user
GET    /admin/users/{user_id}    - Get user details
PUT    /admin/users/{user_id}/role - Update user role
DELETE /admin/users/{user_id}    - Deactivate user
```

### Admin Platform Settings

```
GET    /admin/platforms                      - List all platform configs
GET    /admin/platforms/{platform}           - Get platform config
PUT    /admin/platforms/{platform}           - Update platform config
POST   /admin/platforms/{platform}/verify   - Verify platform
```

### Admin Dashboard

```
GET    /admin/dashboard          - Get dashboard statistics
```

---

## Best Practices

### User Management

1. **Create Users Periodically**: Create users as they join the organization
2. **Assign Correct Roles**: Ensure admins are truly needed
3. **Audit Trail**: Monitor which admin created which user via `created_by` field
4. **Deactivate vs. Delete**: Deactivate instead of deleting to maintain message history

### Platform Configuration

1. **Test Connection**: After configuration, test webhook connectivity
2. **Use Secure Tokens**: Keep tokens secure and rotate periodically
3. **Backup Credentials**: Maintain backup of credentials
4. **Update Regularly**: Update tokens/secrets if compromised
5. **Document Setup**: Keep notes on which credentials are used for which platform

### Security

1. **Admin Accounts**: Limit number of admin accounts
2. **Strong Passwords**: Require strong passwords for user creation
3. **Regular Audits**: Review user list and roles periodically
4. **Monitor Access**: Check dashboard for unauthorized access attempts
5. **Deactivate Old Accounts**: Deactivate accounts of inactive users

---

## Troubleshooting

### Cannot Access Admin Panel

**Problem**: Getting redirected to `/dashboard` instead of `/admin`

**Solution**: 
- Verify user has role='admin' in database
- Check that login is returning correct role
- Clear browser cache and localStorage

### Platform Configuration Not Saving

**Problem**: Settings are not being saved

**Solution**:
- Verify all required fields are filled
- Check backend logs for errors
- Ensure tokens are valid and not expired
- Test API connectivity

### Users Cannot Login After Creation

**Problem**: Newly created users cannot login

**Solution**:
- Verify email and password are correct
- Check that `is_active` is True
- Verify user exists in database
- Check backend logs for authentication errors

### Webhook Not Registering

**Problem**: Platform shows webhook not registered

**Solution**:
- Verify all credentials are correct
- Check firewall/networking rules
- Ensure webhook URL is publicly accessible
- Test webhook endpoint manually

---

## Support

For issues or questions:

1. Check logs in backend (`backend/logs/`)
2. Verify database connectivity
3. Review platform vendor documentation
4. Contact system administrator

---

## Version History

- **v1.0.0** (Initial Release)
  - Role-based access control
  - Admin dashboard and statistics
  - User management interface
  - Platform credential configuration
  - Webhook registration tracking

---

**Last Updated**: 2024
**Status**: Active
