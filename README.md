# Unified Social Messaging Platform

A full-featured team inbox that consolidates WhatsApp, Facebook Messenger, Viber, LinkedIn, Email, and a **live website chat widget** into one dashboard.

## Project Structure

```
SocialMedia/
├── backend/
│   ├── app/
│   │   ├── models/          # Database models
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # Platform integrations
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── config.py        # Configuration
│   │   └── database.py      # Database setup
│   ├── main.py              # FastAPI entry point
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/                 # Next.js app directory
    ├── components/          # React components
    ├── lib/                 # Utilities and API clients
    ├── public/              # Static assets
    ├── package.json
    ├── tailwind.config.js
    └── postcss.config.js
```

## Features

- **Unified Inbox** — all platforms in one place
- **Multi-Platform Messaging** — WhatsApp, Facebook Messenger, Viber, LinkedIn
- **Email** — IMAP/SMTP inbox with threads, attachments, and auto-sync
- **Live Web Chat Widget** — embeddable on any website, real-time WebSocket, no third-party service
- **Real-Time Events** — SSE stream keeps the dashboard live (no polling)
- **Role-Based Access Control** — Admin / Agent / User roles
- **OTP Authentication** — email-verified login and registration
- **Password Reset** — secure email-link flow
- **User Profiles** — avatar upload, bio, phone, social links
- **Admin Panel** — manage users, branding, email accounts, platform settings
- **Branding** — company name, primary color, logo — reflected in widget and emails
- **Platform Filtering** — filter conversations by source platform
- **Responsive UI** — works on desktop and tablet

## Quick Links

| Document | Purpose |
|----------|---------|
| [USER_MANUAL.md](./USER_MANUAL.md) | Complete guide for agents and admins |
| [SETUP_GUIDE.md](./SETUP_GUIDE.md) | Developer setup, workflow, deployment |
| [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) | REST API reference |
| [WEBHOOKS_SETUP.md](./WEBHOOKS_SETUP.md) | Platform webhook configuration |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production deployment |

---

## Architecture

```
Browser / Widget
       │
       ├── REST (fetch)   ──► FastAPI (port 8000)
       ├── SSE stream     ──► /events/stream
       └── WebSocket      ──► /webchat/ws/{session_id}
                                    │
                              PostgreSQL DB
```

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **Frontend**: Next.js 14 App Router + TailwindCSS + TypeScript
- **Real-time**: Server-Sent Events (agents) + WebSocket (chat widget visitors)
- **Auth**: OTP via email, Bearer token session

## Setup Instructions

See the full **[Setup Guide](./SETUP_GUIDE.md)** for detailed instructions. Quick version:

### Prerequisites
- Python 3.11+, Node.js 18+, PostgreSQL 14+

### Backend
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# create backend/.env with DATABASE_URL, SMTP settings, etc.
DATABASE_URL=postgresql://user@localhost:5432/socialmedia \
  uvicorn main:app --host 0.0.0.0 --port 8000 --ws websockets --reload
```

### Frontend
```bash
cd frontend
npm install
# create frontend/.env.local with NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open **http://localhost:3000** — register, verify OTP, and start messaging.

