# Setup Guide & Developer Workflow

**Version 2.0 · February 2026**

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Structure](#2-project-structure)
3. [Database Setup](#3-database-setup)
4. [Backend Setup](#4-backend-setup)
5. [Frontend Setup](#5-frontend-setup)
6. [Starting the Application](#6-starting-the-application)
7. [Environment Variables Reference](#7-environment-variables-reference)
8. [Running Migrations](#8-running-migrations)
9. [First-Time Data Setup](#9-first-time-data-setup)
10. [Development Workflow](#10-development-workflow)
11. [Production Deployment](#11-production-deployment)
12. [Docker Setup](#12-docker-setup)
13. [Useful Commands](#13-useful-commands)

---

## 1. Prerequisites

| Tool | Minimum Version | Check |
|------|----------------|-------|
| Python | 3.11+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| PostgreSQL | 14+ | `psql --version` |
| Git | Any | `git --version` |

**macOS (Homebrew)**:
```bash
brew install python postgresql node git
brew services start postgresql
```

---

## 2. Project Structure

```
SocialMedia/
├── backend/                    # FastAPI Python backend
│   ├── main.py                 # App entry point — registers all routers
│   ├── requirements.txt        # Python dependencies
│   ├── venv/                   # Python virtual environment (not in git)
│   ├── avatar_storage/         # Uploaded profile photos
│   ├── attachment_storage/     # Email attachments
│   ├── alembic/                # DB migration scripts
│   └── app/
│       ├── config.py           # Settings loaded from environment
│       ├── database.py         # SQLAlchemy engine + session
│       ├── dependencies.py     # Shared FastAPI dependencies
│       ├── models/             # SQLAlchemy ORM models
│       │   ├── user.py         # User (+ profile fields + RBAC)
│       │   ├── conversation.py # Multi-platform conversation
│       │   ├── message.py      # Individual message
│       │   ├── email.py        # Email account + email messages
│       │   ├── platform_account.py
│       │   ├── platform_settings.py
│       │   └── branding.py     # Company branding (name, color, logo)
│       ├── routes/             # API routers (one file per domain)
│       │   ├── auth.py         # /auth — register, login, OTP, profile, avatar
│       │   ├── admin.py        # /admin — users, platform settings, email accounts
│       │   ├── accounts.py     # /accounts — per-user platform connections
│       │   ├── conversations.py# /conversations
│       │   ├── messages.py     # /messages — send, receive, mark-read
│       │   ├── email.py        # /email — IMAP/SMTP email features
│       │   ├── events.py       # /events — SSE stream for real-time dashboard
│       │   ├── webchat.py      # /webchat — session, branding, WebSocket
│       │   └── branding.py     # /branding — public branding endpoint
│       ├── schemas/            # Pydantic request/response models
│       └── services/
│           ├── email_service.py    # IMAP/SMTP email logic
│           ├── events_service.py   # SSE broadcast manager
│           ├── webchat_service.py  # WebSocket visitor connection manager
│           └── platform_service.py # WhatsApp/Facebook/Viber/LinkedIn API calls
│
└── frontend/                   # Next.js 14 App Router frontend
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx            # Redirects to /dashboard or /login
    │   ├── login/
    │   ├── dashboard/          # Main messaging dashboard
    │   ├── settings/           # Profile, security, platform accounts
    │   ├── email/              # Email inbox
    │   ├── widget/             # Standalone webchat widget (iframe target)
    │   ├── admin/              # Admin panel (users, branding, etc.)
    │   ├── forgot-password/
    │   └── reset-password/
    ├── components/
    │   ├── ConversationList.tsx
    │   ├── ChatWindow.tsx
    │   ├── PlatformFilter.tsx
    │   ├── ProfileDropdown.tsx  # Avatar + popup menu in dashboard header
    │   └── EventNotifications.tsx
    ├── lib/
    │   ├── api.ts               # Centralised fetch helpers
    │   ├── auth.ts              # Token read/write (localStorage)
    │   ├── events-context.tsx   # SSE context provider
    │   └── branding-context.tsx
    └── public/
        └── chat-widget.js       # Embeddable widget launcher script
```

---

## 3. Database Setup

```bash
# Start PostgreSQL if not running
brew services start postgresql   # macOS
sudo systemctl start postgresql  # Linux

# Create the database
createdb socialmedia

# Verify
psql socialmedia -c "\dt"
```

SQLAlchemy creates all tables automatically on backend startup (`Base.metadata.create_all`). You do **not** need to run Alembic migrations for a fresh install.

---

## 4. Backend Setup

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend

# Create virtual environment
python3 -m venv venv

# Activate
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 4.1 Backend Environment File

Create `backend/.env`:

```env
# Database
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia

# App
SECRET_KEY=change-this-to-a-random-secret
FRONTEND_URL=http://localhost:3000

# Email (for OTP and password reset)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=your@gmail.com
SMTP_FROM_NAME=Support Team
SMTP_SECURITY=tls

# Optional — platform API keys (can also be set per-user in Settings)
WHATSAPP_API_KEY=
FACEBOOK_ACCESS_TOKEN=
VIBER_BOT_TOKEN=
LINKEDIN_ACCESS_TOKEN=
```

> **Gmail**: Use an **App Password** (Google Account → Security → 2-Step Verification → App Passwords), not your regular password.

---

## 5. Frontend Setup

```bash
cd /Users/rajmaha/Sites/SocialMedia/frontend

npm install
```

### 5.1 Frontend Environment File

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

---

## 6. Starting the Application

### Option A — Two separate terminals (recommended for development)

**Terminal 1 — Backend:**
```bash
cd /Users/rajmaha/Sites/SocialMedia/backend
source venv/bin/activate
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  uvicorn main:app --host 0.0.0.0 --port 8000 --ws websockets --reload
```

**Terminal 2 — Frontend:**
```bash
cd /Users/rajmaha/Sites/SocialMedia/frontend
npm run dev
```

Open: `http://localhost:3000`

---

### Option B — Background (nohup)

```bash
# Backend in background
cd /Users/rajmaha/Sites/SocialMedia/backend
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  nohup venv/bin/python -m uvicorn main:app \
  --host 0.0.0.0 --port 8000 --ws websockets \
  > /tmp/backend.log 2>&1 &

echo "Backend PID: $!"

# Frontend in background
cd /Users/rajmaha/Sites/SocialMedia/frontend
nohup npm run dev > /tmp/frontend.log 2>&1 &

echo "Frontend PID: $!"
```

Check logs:
```bash
tail -f /tmp/backend.log
tail -f /tmp/frontend.log
```

Stop background processes:
```bash
pkill -f "uvicorn main:app"    # stop backend
pkill -f "next dev"             # stop frontend
```

---

### Option C — start.sh script

```bash
cd /Users/rajmaha/Sites/SocialMedia
chmod +x start.sh
./start.sh
```

---

## 7. Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SECRET_KEY` | ✅ | App secret for tokens |
| `FRONTEND_URL` | ✅ | CORS allowed origin |
| `SMTP_HOST` | For email | SMTP server hostname |
| `SMTP_PORT` | For email | 587 (TLS) or 465 (SSL) |
| `SMTP_USERNAME` | For email | Email account username |
| `SMTP_PASSWORD` | For email | Email password or app password |
| `SMTP_FROM_EMAIL` | For email | Sender address |
| `SMTP_FROM_NAME` | For email | Sender display name |
| `SMTP_SECURITY` | For email | `tls` or `ssl` |
| `WHATSAPP_API_KEY` | Optional | Global WhatsApp token |
| `FACEBOOK_ACCESS_TOKEN` | Optional | Global Facebook token |
| `VIBER_BOT_TOKEN` | Optional | Global Viber token |
| `LINKEDIN_ACCESS_TOKEN` | Optional | Global LinkedIn token |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend REST API base URL |
| `NEXT_PUBLIC_WS_URL` | ✅ | Backend WebSocket base URL |

---

## 8. Running Migrations

For a **fresh database**, no migration is needed — SQLAlchemy auto-creates all tables.

For **column additions** on an existing database, individual migration scripts exist in `backend/`:

```bash
cd backend
source venv/bin/activate

# Add profile fields (phone, bio, avatar, social links)
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  python add_profile_fields.py

# Add SMTP security column
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  python add_smtp_security.py

# Add thread_id to emails
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  python fix_migration.py
```

Formal Alembic migrations are in `backend/alembic/versions/`:
```bash
# Run all pending Alembic migrations
DATABASE_URL=postgresql://... alembic upgrade head
```

---

## 9. First-Time Data Setup

After starting the backend for the first time:

### 9.1 Create the First Admin User

```bash
cd backend && source venv/bin/activate
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  python create_users.py
```

Or register via the UI and then promote via psql:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

### 9.2 Initialize Platforms

```bash
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  python init_platforms.py
```

### 9.3 Set Up Branding

```bash
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  python setup_branding.py
```

Or configure via **Admin Panel → Branding** in the UI.

---

## 10. Development Workflow

### API Reference (Swagger UI)

While the backend is running:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`
- **Health check**: `http://localhost:8000/health`

### Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register (sends OTP) |
| POST | `/auth/login` | Login (sends OTP) |
| POST | `/auth/verify-otp` | Verify OTP → returns user session |
| POST | `/auth/resend-otp` | Resend OTP |
| POST | `/auth/forgot-password` | Send password reset email |
| POST | `/auth/reset-password` | Reset password with token |
| PUT | `/auth/profile` | Update profile fields |
| POST | `/auth/profile/avatar` | Upload profile photo |
| GET | `/auth/user/{id}` | Get full user profile |
| GET | `/conversations/` | List all conversations |
| POST | `/messages/send` | Send a message |
| GET | `/messages/conversation/{id}` | Get messages for a conversation |
| GET | `/accounts/` | List platform accounts |
| POST | `/accounts/` | Add platform account |
| DELETE | `/accounts/{id}` | Remove platform account |
| GET | `/admin/users` | List all users (admin) |
| POST | `/admin/users` | Create user (admin) |
| PUT | `/admin/users/{id}` | Update user (admin) |
| DELETE | `/admin/users/{id}` | Delete user (admin) |
| GET | `/admin/branding` | Get branding |
| PUT | `/admin/branding` | Update branding |
| GET | `/events/stream` | SSE stream for real-time events |
| POST | `/webchat/session` | Create/resume webchat session |
| GET | `/webchat/branding` | Public branding for widget |
| WS | `/webchat/ws/{session_id}` | Visitor WebSocket |

### WebSocket Message Protocol (Webchat)

**Visitor → Server:**
```json
{ "type": "message", "text": "Hello!" }
{ "type": "typing", "is_typing": true }
{ "type": "ping" }
```

**Server → Visitor:**
```json
{ "type": "pong" }
{ "type": "message", "id": 42, "text": "Hello!", "sender": "John", "is_agent": false, "timestamp": "..." }
{ "type": "message_confirm", "id": 43, "text": "Hi there!", "sender": "Agent", "is_agent": true, "timestamp": "..." }
```

### SSE Event Types (Dashboard)

The dashboard connects to `GET /events/stream` and receives these events:

| Event type | Trigger |
|-----------|---------|
| `message_received` | New inbound message on any platform |
| `message_sent` | Outgoing message confirmed |
| `webchat_visitor_online` | Webchat visitor connects |
| `webchat_visitor_offline` | Webchat visitor disconnects |
| `webchat_typing` | Visitor is typing |
| `conversation_updated` | Unread count / last message changed |

---

## 11. Production Deployment

### 11.1 Backend (Gunicorn + Uvicorn workers)

```bash
cd backend
source venv/bin/activate
pip install gunicorn

DATABASE_URL=postgresql://user:pass@host:5432/socialmedia \
  gunicorn main:app \
  -k uvicorn.workers.UvicornWorker \
  -w 4 \
  --bind 0.0.0.0:8000 \
  --timeout 120
```

### 11.2 Frontend (Next.js production build)

```bash
cd frontend
npm run build
npm run start   # listens on port 3000
```

Or use a process manager:
```bash
npm install -g pm2
pm2 start npm --name "frontend" -- start
pm2 save
```

### 11.3 Nginx Reverse Proxy (example)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
    }

    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /webchat/ws/ {
        proxy_pass http://localhost:8000/webchat/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }

    location /events/stream {
        proxy_pass http://localhost:8000/events/stream;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding on;
    }
}
```

> **Important for SSE and WebSockets**: Disable proxy buffering for `/events/stream` and set the correct `Upgrade` headers for `/webchat/ws/`.

### 11.4 Environment for Production

Set these in your server environment or a secrets manager:

```bash
export DATABASE_URL="postgresql://user:pass@db-host:5432/socialmedia"
export SECRET_KEY="$(openssl rand -hex 32)"
export FRONTEND_URL="https://your-domain.com"
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USERNAME="noreply@your-domain.com"
export SMTP_PASSWORD="your-app-password"
export SMTP_FROM_EMAIL="noreply@your-domain.com"
export SMTP_FROM_NAME="Your Company"
export SMTP_SECURITY="tls"
```

---

## 12. Docker Setup

A `docker-compose.yml` is included for full containerized run:

```bash
# Build and start all services
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

Services defined in `docker-compose.yml`:
- `backend` — FastAPI app on port 8000
- `frontend` — Next.js app on port 3000
- `db` — PostgreSQL (if included)

---

## 13. Useful Commands

### Backend

```bash
# Activate virtualenv
source backend/venv/bin/activate

# Install a new package
pip install package-name
pip freeze > backend/requirements.txt

# Check backend logs (background mode)
tail -f /tmp/backend.log

# Kill background backend
pkill -f "uvicorn main:app"

# Restart backend
pkill -f "uvicorn main:app"
cd backend
DATABASE_URL=postgresql://rajmaha@localhost:5432/socialmedia \
  nohup venv/bin/python -m uvicorn main:app \
  --host 0.0.0.0 --port 8000 --ws websockets \
  > /tmp/backend.log 2>&1 &

# Connect to DB
psql postgresql://rajmaha@localhost:5432/socialmedia

# Common psql commands
\dt                        -- list tables
\d users                   -- describe users table
SELECT * FROM users;
SELECT * FROM conversations ORDER BY last_message_time DESC LIMIT 10;
SELECT * FROM messages WHERE conversation_id = 1 ORDER BY timestamp;
```

### Frontend

```bash
# Start dev server
cd frontend && npm run dev

# Production build
cd frontend && npm run build && npm run start

# Type check
cd frontend && npx tsc --noEmit

# Kill background frontend
pkill -f "next dev"

# Check frontend logs (background mode)
tail -f /tmp/frontend.log
```

### Git

```bash
# Commit all changes
git add -A
git commit -m "your message"
git push

# Check status
git status
git log --oneline -10

# Remote
git remote -v
# → origin  https://github.com/rajmaha/SocialMessaging.git (fetch)
```

### Port Management

```bash
# Check what's using ports 3000 and 8000
lsof -i :3000
lsof -i :8000

# Kill by PID
kill -9 <PID>

# Kill all on a port (macOS)
lsof -ti :8000 | xargs kill -9
```

---

**Version 2.0 · February 2026**  
For end-user instructions, see [USER_MANUAL.md](./USER_MANUAL.md).  
For API reference, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).
