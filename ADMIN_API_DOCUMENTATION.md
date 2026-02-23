# Admin API Documentation

## Base URL

```
http://localhost:8000/admin
```

All endpoints require authentication with Bearer token in the Authorization header.

## Authentication

All admin endpoints require:
- Valid user with `role='admin'`
- Bearer token in Authorization header

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8000/admin/users
```

---

## User Management Endpoints

### List All Users

Get a list of all users in the system.

**Endpoint**: `GET /admin/users`

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Response** (200 OK):
```json
[
  {
    "id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "full_name": "John Doe",
    "role": "user",
    "is_active": true,
    "created_at": "2024-01-15T10:30:00"
  },
  {
    "id": 2,
    "username": "admin",
    "email": "admin@example.com",
    "full_name": "System Admin",
    "role": "admin",
    "is_active": true,
    "created_at": "2024-01-15T09:00:00"
  }
]
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin

---

### Create New User

Create a new user account.

**Endpoint**: `POST /admin/users`

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body**:
```json
{
  "username": "jane_doe",
  "email": "jane@example.com",
  "password": "SecurePassword123!",
  "full_name": "Jane Doe",
  "role": "user"
}
```

**Response** (200 OK):
```json
{
  "id": 3,
  "username": "jane_doe",
  "email": "jane@example.com",
  "full_name": "Jane Doe",
  "role": "user",
  "is_active": true,
  "created_at": "2024-01-15T11:00:00"
}
```

**Error Responses**:
- `400 Bad Request` - Username/email already exists or invalid role
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin

**Request Field Validation**:
- `username`: Required, unique, alphanumeric
- `email`: Required, unique, valid email format
- `password`: Required, minimum 6 characters
- `full_name`: Required, text
- `role`: Optional (default: 'user'), must be 'admin' or 'user'

---

### Get User Details

Get details for a specific user.

**Endpoint**: `GET /admin/users/{user_id}`

**Parameters**:
- `user_id` (path): Integer user ID

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Response** (200 OK):
```json
{
  "id": 3,
  "username": "jane_doe",
  "email": "jane@example.com",
  "full_name": "Jane Doe",
  "role": "user",
  "is_active": true,
  "created_at": "2024-01-15T11:00:00"
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin
- `404 Not Found` - User does not exist

---

### Update User Role

Change a user's role between 'admin' and 'user'.

**Endpoint**: `PUT /admin/users/{user_id}/role`

**Parameters**:
- `user_id` (path): Integer user ID

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body**:
```json
{
  "role": "admin"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "User role updated to admin",
  "user_id": 3,
  "new_role": "admin"
}
```

**Error Responses**:
- `400 Bad Request` - Invalid role (must be 'admin' or 'user')
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin
- `404 Not Found` - User does not exist

---

### Deactivate User

Deactivate a user account (prevents login).

**Endpoint**: `DELETE /admin/users/{user_id}`

**Parameters**:
- `user_id` (path): Integer user ID

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "User deactivated",
  "user_id": 3
}
```

**Error Responses**:
- `400 Bad Request` - Cannot deactivate own account
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin
- `404 Not Found` - User does not exist

**Note**: Deactivated users cannot login but their data is preserved.

---

## Platform Settings Endpoints

### List All Platform Settings

Get list of all configured platforms.

**Endpoint**: `GET /admin/platforms`

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Response** (200 OK):
```json
[
  {
    "id": 1,
    "platform": "facebook",
    "is_configured": 2,
    "webhook_registered": 1,
    "updated_at": "2024-01-15T12:00:00"
  },
  {
    "id": 2,
    "platform": "whatsapp",
    "is_configured": 1,
    "webhook_registered": 0,
    "updated_at": "2024-01-15T11:30:00"
  }
]
```

**Status Codes**:
- `is_configured`: 0=not configured, 1=configured, 2=verified
- `webhook_registered`: 0=not registered, 1=registered

---

### Get Platform Setting

Get configuration for a specific platform.

**Endpoint**: `GET /admin/platforms/{platform}`

**Parameters**:
- `platform` (path): Platform name (facebook, whatsapp, viber, linkedin)

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Response** (200 OK):
```json
{
  "id": 1,
  "platform": "facebook",
  "app_id": "123456789",
  "business_account_id": "acc_123",
  "phone_number": null,
  "organization_id": null,
  "page_id": "page_123",
  "is_configured": 1,
  "webhook_registered": 0,
  "config": {},
  "updated_at": "2024-01-15T12:00:00"
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin
- `404 Not Found` - Platform settings not found

**Note**: Sensitive fields (`app_secret`, `access_token`, `verify_token`) are not returned.

---

### Update Platform Settings

Update configuration for a specific platform.

**Endpoint**: `PUT /admin/platforms/{platform}`

**Parameters**:
- `platform` (path): Platform name (facebook, whatsapp, viber, linkedin)

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body** (example - Facebook):
```json
{
  "app_id": "123456789",
  "app_secret": "app_secret_here",
  "access_token": "access_token_here",
  "verify_token": "verify_token_here",
  "page_id": "page_123"
}
```

**Request Body** (example - WhatsApp):
```json
{
  "app_id": "123456789",
  "app_secret": "app_secret_here",
  "access_token": "access_token_here",
  "verify_token": "verify_token_here",
  "phone_number_id": "phone_123",
  "business_account_id": "waba_123"
}
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "facebook settings updated",
  "platform": "facebook",
  "is_configured": 1,
  "updated_at": "2024-01-15T12:30:00"
}
```

**Error Responses**:
- `400 Bad Request` - Invalid platform or missing required fields
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin
- `404 Not Found` - Platform settings not found

**Platform-Specific Fields**:

**Facebook**:
- `app_id`, `app_secret`, `access_token`, `verify_token`, `page_id`

**WhatsApp**:
- `app_id`, `app_secret`, `access_token`, `verify_token`, `phone_number_id`, `business_account_id`

**Viber**:
- `app_id`, `access_token`

**LinkedIn**:
- `app_id`, `app_secret`, `access_token`

---

### Verify Platform Setting

Mark a platform as verified (webhook registered).

**Endpoint**: `POST /admin/platforms/{platform}/verify`

**Parameters**:
- `platform` (path): Platform name (facebook, whatsapp, viber, linkedin)

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Response** (200 OK):
```json
{
  "status": "success",
  "message": "facebook verified",
  "is_configured": 2
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin
- `404 Not Found` - Platform settings not found

---

## Dashboard Endpoint

### Get Dashboard Statistics

Get system statistics for the admin dashboard.

**Endpoint**: `GET /admin/dashboard`

**Request Headers**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**Response** (200 OK):
```json
{
  "total_users": 10,
  "active_users": 8,
  "admin_users": 2,
  "regular_users": 8,
  "platforms": {
    "facebook": {
      "is_configured": 2,
      "webhook_registered": 1
    },
    "whatsapp": {
      "is_configured": 1,
      "webhook_registered": 0
    },
    "viber": {
      "is_configured": 0,
      "webhook_registered": 0
    },
    "linkedin": {
      "is_configured": 0,
      "webhook_registered": 0
    }
  },
  "timestamp": "2024-01-15T13:00:00"
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing token
- `403 Forbidden` - User is not admin

---

## Error Response Format

All error responses follow this format:

```json
{
  "detail": "Error message explaining what went wrong"
}
```

Common HTTP Status Codes:
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (user is not admin)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

---

## Example Workflows

### Creating a User and Assigning Admin Role

```bash
# 1. Create user (initially as regular user)
curl -X POST http://localhost:8000/admin/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newadmin",
    "email": "newadmin@example.com",
    "password": "SecurePassword123!",
    "full_name": "New Admin",
    "role": "user"
  }'

# 2. Update role to admin
curl -X PUT http://localhost:8000/admin/users/4/role \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'
```

### Setting Up Facebook Platform

```bash
curl -X PUT http://localhost:8000/admin/platforms/facebook \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "123456789",
    "app_secret": "app_secret_value",
    "access_token": "EAA...",
    "verify_token": "my_verify_token",
    "page_id": "page_123"
  }'
```

### Getting Dashboard Statistics

```bash
curl http://localhost:8000/admin/dashboard \
  -H "Authorization: Bearer $TOKEN"
```

---

## Rate Limiting

Currently no rate limiting is implemented. This may be added in future versions.

---

## Versioning

API Version: 1.0
Last Updated: 2024

For future versions, endpoints may change. Breaking changes will be documented.

---

## Support

For API issues:
1. Verify authentication token is valid
2. Check user role is 'admin'
3. Review request body format
4. Check backend logs for detailed errors
5. Test with curl before integrating into client code

---
