# CLAUDE.md — SocialMedia Unified Inbox

## Project Overview

A unified team inbox and multi-platform messaging system. Consolidates conversations from WhatsApp, Facebook Messenger, Viber, LinkedIn, Email, and an embeddable live chat widget into a single real-time dashboard for support agents.

## Architecture

```
Browser / Widget → REST API / SSE / WebSocket → FastAPI Backend → PostgreSQL
```

- **Backend**: FastAPI (Python 3.11+), SQLAlchemy 2.0 ORM, PostgreSQL 14+
- **Frontend**: Next.js 14 App Router (TypeScript), TailwindCSS, Zustand, Tiptap (rich text)
- **Real-time**: Server-Sent Events (SSE) for agents; WebSocket for chat widget visitors
- **Scheduling**: APScheduler for background jobs (email sync, scheduled sends, snooze, outbox retry)

## Running the Project

```bash
# Recommended: single script that starts both services
./start.sh

# Backend only (port 8000)
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend only (port 3000)
cd frontend && npm run dev

# Docker
docker-compose up --build
```

Access points:
- Frontend: http://localhost:3000
- API: http://localhost:8000
- Swagger docs: http://localhost:8000/docs

## Directory Structure

```
backend/
  app/
    models/       # SQLAlchemy ORM models
    routes/       # FastAPI route handlers
    services/     # Business logic (email, bot, events, webchat, branding)
    schemas/      # Pydantic request/response schemas
    config.py     # Pydantic BaseSettings (loads .env)
    database.py   # SQLAlchemy engine + SessionLocal
    dependencies.py # Shared FastAPI Depends() helpers
  main.py         # App entry point — registers routers, runs startup migrations, schedules jobs

frontend/
  app/            # Next.js App Router pages
    dashboard/    # Main agent inbox
    email/        # Email inbox UI
    admin/        # Admin panel (users, branding, teams, bot, reports, CORS, email accounts)
    widget/       # Chat widget preview
    settings/     # User settings
  components/     # Shared React components
  lib/            # API client (axios), auth helpers, React contexts, date utils
  public/
    chat-widget.js  # Embeddable script for customer websites
```

## Environment Variables

Backend `.env` (copy from `backend/.env.example`):

```
DATABASE_URL=postgresql://user:password@localhost:5432/socialmedia
SECRET_KEY=...
ALGORITHM=HS256
FRONTEND_URL=http://localhost:3000
DEBUG=True

# Platform API keys (all optional)
WHATSAPP_API_KEY, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN
FACEBOOK_ACCESS_TOKEN, FACEBOOK_PAGE_ID, FACEBOOK_VERIFY_TOKEN, FACEBOOK_APP_SECRET
VIBER_BOT_TOKEN
LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORGANIZATION_ID
```

Frontend env:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Key Patterns

**Backend:**
- FastAPI with `Depends(get_db)` for database session injection everywhere
- Service layer pattern: routes call services, not raw DB queries
- Pydantic schemas in `app/schemas/` for request validation and response shaping
- Table creation via `Base.metadata.create_all()` in `main.py`; schema migrations as inline SQL using `text()` (no Alembic)
- CORS allowed origins are read from the database at request time (admin-configurable)

**Frontend:**
- Next.js App Router (`app/` directory, server + client components)
- Axios API client in `lib/api.ts`; auth tokens stored in localStorage
- `branding-context.tsx` — theming (company name, logo, colors) via React context
- `events-context.tsx` — SSE real-time event stream via React context
- TailwindCSS with custom platform colors (WhatsApp green, Facebook blue, etc.)

## Key Models

| Model | Purpose |
|---|---|
| `User` | Agents/admins with profile, OTP/password reset |
| `Conversation` | Thread per contact+platform, with status/assignment/rating |
| `Message` | Individual messages, attachments, delivery status |
| `UserEmailAccount` | Per-user IMAP/SMTP credentials |
| `Email` | Full email with threading, scheduling, snooze, labels, rules |
| `BrandingSettings` | Company name, logo, widget colours, allowed file types |
| `BotSettings` / `BotQA` | AI bot config + Q&A pairs |
| `Team` | Agent teams for assignment |

## Authentication

- OTP-based email verification on registration and login
- Password reset via secure token email links
- Bearer token sessions (JWT, HS256)
- RBAC: `admin` and `agent` roles

## Background Jobs (APScheduler in main.py)

| Job | Interval |
|---|---|
| Email IMAP sync | 5 min |
| Send scheduled emails | 1 min |
| Un-snooze emails | 1 min |
| Retry failed outbox emails | 5 min |

## No Test Framework

There is no pytest/Jest setup. `client.py` in the root is a manual Python API test client. Use the Swagger UI at `/docs` for interactive testing.

## File Storage

- User avatars: `backend/app/avatar_storage/`
- Message attachments: `backend/app/attachment_storage/messages/`
- Email attachments: metadata in DB; files on disk

## Notes

- `main.py` runs inline SQL migrations at startup — add new columns/tables there using `text()` and `IF NOT EXISTS`
- The chat widget (`public/chat-widget.js`) connects via WebSocket to `/webchat/ws/{session_id}`
- Visitor identity uses email + OTP verification
- AI bot supports OpenAI and Ollama (configurable in admin panel)
