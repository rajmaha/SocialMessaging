# API Documentation

## Base URL

**Development:** `http://localhost:8000`

**Production:** `https://api.your-domain.com`

## Authentication

Currently using simple session-based authentication. JWT will be added in future versions.

## Response Format

All API responses follow this format:

### Success Response
```json
{
    "status": "success",
    "data": { ... },
    "message": "Operation completed successfully"
}
```

### Error Response
```json
{
    "status": "error",
    "detail": "Error message",
    "code": 400
}
```

## Endpoints

### Authentication Endpoints

#### Register User
```
POST /auth/register
```

**Request Body:**
```json
{
    "username": "john_doe",
    "email": "john@example.com",
    "password": "secure_password",
    "full_name": "John Doe"
}
```

**Response:**
```json
{
    "status": "success",
    "message": "User registered successfully",
    "user_id": 1,
    "username": "john_doe"
}
```

#### Login
```
POST /auth/login
```

**Request Body:**
```json
{
    "email": "john@example.com",
    "password": "secure_password"
}
```

**Response:**
```json
{
    "status": "success",
    "message": "Login successful",
    "user_id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "full_name": "John Doe"
}
```

#### Get User Info
```
GET /auth/user/{user_id}
```

**Response:**
```json
{
    "user_id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "full_name": "John Doe",
    "created_at": "2024-02-22T10:30:00Z"
}
```

---

### Platform Accounts Endpoints

#### Add Platform Account
```
POST /accounts/
```

**Request Body:**
```json
{
    "user_id": 1,
    "platform": "whatsapp",
    "account_id": "1234567890",
    "account_name": "My Business",
    "access_token": "your_access_token",
    "phone_number": "+1234567890"
}
```

**Response:**
```json
{
    "success": true,
    "account_id": 1
}
```

#### Get User's Platform Accounts
```
GET /accounts/user/{user_id}
```

**Response:**
```json
[
    {
        "id": 1,
        "user_id": 1,
        "platform": "whatsapp",
        "account_name": "My Business",
        "phone_number": "+1234567890",
        "is_active": 1
    },
    {
        "id": 2,
        "user_id": 1,
        "platform": "facebook",
        "account_name": "Facebook Page",
        "phone_number": null,
        "is_active": 1
    }
]
```

#### Toggle Account Status
```
PUT /accounts/{account_id}
```

**Query Parameters:**
- `is_active` (integer): 1 to enable, 0 to disable

**Response:**
```json
{
    "success": true,
    "message": "Account updated"
}
```

#### Disconnect Account
```
DELETE /accounts/{account_id}
```

**Response:**
```json
{
    "success": true,
    "message": "Account disconnected"
}
```

---

### Conversations Endpoints

#### Get All Conversations
```
GET /conversations/?user_id={user_id}&platform={platform}
```

**Query Parameters:**
- `user_id` (integer, required): User ID
- `platform` (string, optional): Filter by platform (whatsapp, facebook, viber, linkedin)

**Response:**
```json
[
    {
        "id": 1,
        "platform": "whatsapp",
        "contact_name": "John Smith",
        "contact_id": "+1987654321",
        "last_message": "Hello! How are you?",
        "last_message_time": "2024-02-22T15:30:00Z",
        "unread_count": 2,
        "contact_avatar": "https://example.com/avatar.jpg"
    },
    {
        "id": 2,
        "platform": "facebook",
        "contact_name": "Jane Doe",
        "contact_id": "123456789",
        "last_message": "See you tomorrow!",
        "last_message_time": "2024-02-22T14:20:00Z",
        "unread_count": 0,
        "contact_avatar": null
    }
]
```

#### Search Conversations
```
GET /conversations/search?user_id={user_id}&query={query}
```

**Query Parameters:**
- `user_id` (integer, required): User ID
- `query` (string, required): Search term

**Response:** Same as Get All Conversations

#### Mark Conversation as Read
```
PUT /conversations/{conversation_id}
```

**Response:**
```json
{
    "success": true,
    "message": "Conversation marked as read"
}
```

#### Delete/Archive Conversation
```
DELETE /conversations/{conversation_id}
```

**Response:**
```json
{
    "success": true,
    "message": "Conversation archived"
}
```

---

### Messages Endpoints

#### Send Message
```
POST /messages/send?conversation_id={id}&message_text={text}&message_type={type}&media_url={url}
```

**Query Parameters:**
- `conversation_id` (integer, required): Conversation ID
- `message_text` (string, required): Message content
- `message_type` (string, optional): Type of message (default: "text", options: text, image, video, file)
- `media_url` (string, optional): URL for media messages

**Response:**
```json
{
    "success": true,
    "message": "Message sent successfully",
    "data": {
        "message_id": "msg_123456",
        "status": "sent"
    }
}
```

#### Get Conversation Messages
```
GET /messages/conversation/{conversation_id}?limit={limit}
```

**Query Parameters:**
- `limit` (integer, optional, default: 50): Number of messages to retrieve

**Response:**
```json
[
    {
        "id": 1,
        "conversation_id": 1,
        "sender_name": "You",
        "message_text": "Hello!",
        "message_type": "text",
        "platform": "whatsapp",
        "is_sent": 1,
        "read_status": 1,
        "timestamp": "2024-02-22T10:30:00Z"
    },
    {
        "id": 2,
        "conversation_id": 1,
        "sender_name": "John Smith",
        "message_text": "Hi! How are you?",
        "message_type": "text",
        "platform": "whatsapp",
        "is_sent": 0,
        "read_status": 1,
        "timestamp": "2024-02-22T10:32:00Z"
    }
]
```

#### Mark Message as Read
```
PUT /messages/mark-as-read/{message_id}
```

**Response:**
```json
{
    "success": true,
    "message": "Message marked as read"
}
```

---

### System Endpoints

#### Health Check
```
GET /health
```

**Response:**
```json
{
    "status": "ok",
    "message": "Social Media Messaging System is running"
}
```

#### API Info
```
GET /
```

**Response:**
```json
{
    "application": "Social Media Messaging System",
    "version": "1.0.0",
    "docs": "/docs"
}
```

---

## Error Codes

| Code | Message | Cause |
|------|---------|-------|
| 400 | Bad Request | Invalid request parameters |
| 401 | Unauthorized | Authentication failed |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource already exists |
| 422 | Unprocessable Entity | Invalid data format |
| 500 | Internal Server Error | Server error |

---

## Rate Limiting

Currently no rate limiting is implemented. Rate limiting will be added in future versions.

---

## API Documentation UI

Interactive API documentation available at:
- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

---

## Development Notes

- All timestamps are in UTC ISO 8601 format
- Message IDs are unique across platforms
- Conversations are grouped by platform
- Files larger than 25MB not supported yet
- Real-time messaging requires WebSocket upgrade (planned)
