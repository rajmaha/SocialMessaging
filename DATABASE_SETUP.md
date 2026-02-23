# Database Setup Guide

## PostgreSQL Setup

### 1. Install PostgreSQL (if not installed)

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download from https://www.postgresql.org/download/windows/

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE socialmedia;

# Create user (optional, for security)
CREATE USER socialmedia_user WITH PASSWORD 'your_password';

# Grant privileges
ALTER ROLE socialmedia_user CREATEDB;

# Connect to new database
\c socialmedia

# Exit
\q
```

### 3. Update Environment Variables

Edit `backend/.env`:

```
DATABASE_URL=postgresql://username:password@localhost:5432/socialmedia
```

For default PostgreSQL user:
```
DATABASE_URL=postgresql://postgres@localhost:5432/socialmedia
```

### 4. Verify Connection

```bash
cd backend
python -c "from app.database import engine; engine.connect(); print('Connected!')"
```

## Data Models

### Users Table
- `id` - Primary key
- `username` - Unique username
- `email` - User email
- `password_hash` - Hashed password
- `full_name` - User's full name
- `created_at` - Account creation timestamp
- `updated_at` - Last update timestamp

### Platform Accounts Table
- `id` - Primary key
- `user_id` - Foreign key to users
- `platform` - Platform name (whatsapp, facebook, viber, linkedin)
- `account_id` - Platform-specific account ID
- `account_name` - Account display name
- `access_token` - API access token
- `phone_number` - Phone number (optional)
- `is_active` - Account status
- `created_at` - Connection timestamp
- `updated_at` - Last update timestamp

### Conversations Table
- `id` - Primary key
- `user_id` - Foreign key to users
- `platform_account_id` - Foreign key to platform_accounts
- `conversation_id` - Unique conversation identifier
- `platform` - Platform name
- `contact_name` - Contact's display name
- `contact_id` - Platform-specific contact ID
- `contact_avatar` - Avatar URL
- `last_message` - Last message text
- `last_message_time` - Timestamp of last message
- `unread_count` - Number of unread messages
- `created_at` - Conversation start timestamp
- `updated_at` - Last update timestamp

### Messages Table
- `id` - Primary key
- `conversation_id` - Foreign key to conversations
- `platform_account_id` - Foreign key to platform_accounts
- `sender_id` - Sender's platform ID
- `sender_name` - Sender's display name
- `receiver_id` - Receiver's platform ID
- `receiver_name` - Receiver's display name
- `message_text` - Message content
- `message_type` - Type (text, image, video, file)
- `platform` - Platform name
- `media_url` - URL for media messages
- `is_sent` - 1 if sent by user, 0 if received
- `read_status` - 0 if unread, 1 if read
- `platform_message_id` - Platform's message ID
- `timestamp` - Message timestamp
- `created_at` - Record creation timestamp

## Backup and Restore

### Backup
```bash
pg_dump socialmedia > backup.sql
```

### Restore
```bash
createdb socialmedia_restored
psql socialmedia_restored < backup.sql
```

## Useful Commands

```bash
# Connect to database
psql socialmedia

# List tables
\dt

# Describe table
\d messages

# Quit
\q

# Drop database (careful!)
dropdb socialmedia
```
