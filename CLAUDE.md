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

## Tests

Backend pytest, from `backend/` (`requirements-dev.txt` adds pytest; production
installs `requirements.prod.txt` only):

```bash
venv/bin/python -m pytest
```

Tests that need a database ask for the `test_engine` fixture (`tests/conftest.py`)
and run only when `TEST_DATABASE_URL` names a throwaway PostgreSQL database whose
name contains "test" -- never the real one; otherwise they are skipped:

```bash
docker run -d --name sm_test_pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=sm_test -p 55499:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql://postgres:test@localhost:55499/sm_test venv/bin/python -m pytest
```

No frontend tests. `client.py` in the root is a manual API client; Swagger is at `/docs`.

## Stored secrets

`app/services/secret_box.py` seals a secret the server must read back (Fernet,
key derived from `SECRET_KEY` with a label) and refuses the placeholder
`SECRET_KEY`. Changing `SECRET_KEY` makes sealed values unreadable (`open_()`
answers None). Older secrets (TURN credential, API server keys) are still stored
plain.

## File Storage

- User avatars: `backend/app/avatar_storage/`
- Message attachments: `backend/app/attachment_storage/messages/`
- Email attachments: metadata in DB; files on disk

## Notes

- `main.py` runs inline SQL migrations at startup — add new columns/tables there using `text()` and `IF NOT EXISTS`
- The chat widget (`public/chat-widget.js`) connects via WebSocket to `/webchat/ws/{session_id}`
- Visitor identity uses email + OTP verification
- AI bot supports OpenAI and Ollama (configurable in admin panel)

## Mobile and desktop apps

The same Next.js frontend, wrapped three ways: Android and iOS with Capacitor
8 (`frontend/android`, `frontend/ios`), Windows and macOS with Electron
(`desktop/`). All three load the **hosted** frontend rather than bundling it,
so a frontend fix reaches every platform without a store release. Full guide:
`docs/mobile-desktop-apps.md`.

| piece | where |
|---|---|
| Platform detection, status bar, keyboard, safe areas, haptics | `frontend/lib/native.ts` |
| Boot, hardware back, resume, deep links, notification routing | `frontend/components/NativeShell.tsx` |
| Push registration, device token, local notifications | `frontend/lib/push.ts` |
| Unread counts (mobile badges and desktop dock badge) | `frontend/lib/use-unread.ts` |
| FCM sender, device rows, registration routes | `app/services/push_service.py`, `app/models/device_token.py`, `app/routes/devices.py` |
| Electron main process, tray, badge, deep links | `desktop/src/main.js` |
| The page's entire Electron bridge | `desktop/src/preload.js` |

- **Safe areas are redefined utilities, not edited pages.** `lib/native.ts`
  publishes `--sa-top` / `--sa-bottom` and tags `<html>`; `globals.css` then
  changes what `pt-14`, `top-14` and `pb-16` mean inside the app only. Use
  those existing classes on a new page and the insets come for free.
- **A new full-screen overlay must listen for the cancelable `nativeback`
  event** and `preventDefault()`, or Android's back button navigates away
  instead of closing it (the chat pane and the More drawer both do this).
- **Push hangs off `EventsService.broadcast_to_user()`**: no open socket means
  the app is closed, so that is where the FCM fallback lives. Only event types
  in `PUSHABLE_EVENTS` are pushed, and their wording mirrors
  `components/EventNotifications.tsx`.
- **`FCM_SERVICE_ACCOUNT_JSON` / `FCM_SERVICE_ACCOUNT_FILE` must be named in
  `docker-compose.yml`'s backend `environment:`** — the same rule as
  `SUPPORT_SERVICE_KEYS`. Unset, push is a silent no-op and the apps still
  notify while running, over the WebSocket.
- **Android needs JDK 21** (`brew install openjdk@21`). Gradle 8.14.3 rejects
  the system JDK 26 and Android Studio's bundled 25.
- Desktop builds are unsigned. macOS builds locally (`npm run dist:mac`);
  **Windows is built by GitHub Actions**
  (`.github/workflows/desktop-windows.yml`) because electron-builder cannot
  target Windows from macOS without Wine. Publish a GitHub Release to get an
  installer attached to it. Desktop assets live in `desktop/resources/`, not
  `build/`, which the root `.gitignore` excludes.

## Support desk

Support requests from any site's widget (and, later, apps): a widget domain is a
support site (Admin -> Widget Domains -> Support). Site-facing guide:
`docs/support-desk.md`; setup manual: `docs/support-desk-setup.md`
(`SECRET_KEY`: `docs/secret-key-setup.md`). Design and plan: the OMS repo,
`docs/plans/2026-11-02-support-desk-design.md` and `...-phase1-plan.md`.

| piece | where |
|---|---|
| Every rule (raise, reply, reopen, status, views) | `app/services/support_service.py` |
| Signed identity, the person | `app/services/support_identity.py` |
| Webhook outbox and sender (job `support_webhooks`, every minute) | `app/services/support_webhooks.py` |
| Public API `/api/support/v1` | `app/routes/support_public.py` |
| Service API for subscription servers (`SUPPORT_SERVICE_KEYS`) | `app/routes/support_admin.py` |
| Agent routes (queue, take, conversation, resend) | end of `app/routes/tickets.py` |
| Tables, columns on existing tables | `app/models/support.py`, `app/support_schema.py` |
| Widget Support tab | `public/chat-widget.js`, `app/widget/support/page.tsx` |
| Workspace | `components/SupportConversation.tsx`, `components/WidgetDomainSupport.tsx` |
| Live help: rules, relay | `app/services/support_live.py`, `app/services/support_live_relay.py` |
| Live help: browser side | `lib/live-help.ts`, `components/SupportLiveHelp.tsx`, `app/widget/live/page.tsx` |

- **`SUPPORT_SERVICE_KEYS` and `SUPPORT_PUBLIC_URL` must be named in
  `docker-compose.yml`'s backend `environment:`.** The deploy panel builds
  from the compose file and hands a container only the variables named there;
  set in the panel alone they never reached the backend (2026-11-05). A new
  backend setting needs the same line.
- A support request is a `Ticket` with `source` `support_widget` / `support_app`;
  the customer's thread is `support_messages`. Ticket notes (`FLW-` children)
  stay internal.
- A support ticket's status must change through `support_service.set_status()`
  (the PUT and notes routes do), or the customer and their site are not told.
- `TicketResponse.source` lists the support sources: leaving one out fails every
  ticket list.
- **Forwarding hands a ticket over.** The notes route takes `forward_to` (a user
  id, from `/conversations/agents`) and `forward_reason` with status
  `forwarded`, checks both before writing, sets `assigned_to` (so support alerts
  follow), `forward_target` (the name) and `forward_reason`, logs the note, and
  sends `ticket_forwarded` to that agent (toast, chime). It used to store a typed
  name only, and nothing reached "Forwarded to Me".
- **Alerts.** A customer's write sends the live event `support_ticket` to the
  assignee, else the domain's linked agents AND every admin (an admin's queue
  lists every site). `EventNotifications` chimes (`lib/support-alerts.ts`,
  three rising notes), shows a toast that opens the queue or the ticket, and a
  desktop notice while the tab is hidden; the header's Workspace link carries
  `GET /api/tickets/support-counts` (`queue` + my requests whose last word is
  the customer's), also in the tab title. Anything that changes those counts
  calls `supportCountsChanged()`.
- **The widget's count.** The Support iframe polls `/requests` every 20 s;
  `from_support` (support wrote last) with an `updated_at` other than the one
  seen in the open thread is unread (localStorage per widget key; the first
  look counts everything as seen). It posts `sc:support-unread {count,
  increased}`; `chat-widget.js` adds it to the launcher badge, chimes once per
  reply, and fires `socialchat:support-unread` on the host window (OMS shows it
  beside Get help). The widget tells the iframe `sc:shown` so a reply is read
  only while the panel shows it.

### Live help (talk, see the screen)

Design: the OMS repo's `docs/plans/2026-11-02-support-desk-phase3-plan.md`;
site guide: `docs/support-desk.md` section 7.

- **The relay is in memory** (`support_live_relay.hub`): right only while the
  backend runs ONE worker, as the Dockerfile does. Two workers would put the
  agent and the customer in different processes and nothing would connect.
- **Expiry is worked out on read** (`support_live.refresh()`): a request past
  60 s is `expired`, an accepted session whose pass lapsed unused is `failed`
  (through `finish()`, so the thread line and webhook go too). No job runs.
- **The customer offers, the agent answers**: the customer holds the screen.
  The offer decides what flows, so an agent with no microphone can still watch.
- **The pass is single use** (`claim_pass()`, guarded on `pass_used_at IS
  NULL`) and only its sha256 is stored.
- **The agent's socket takes the token in the query** (`?token=`) on its own
  router, `tickets.live_socket_router`: a browser WebSocket cannot send a
  Bearer header, and the tickets router's `require_page()` reads one.
- **The customer's call runs in a window of its own** (`/widget/live`): a
  site's menu click reloads the page, which would end a share in the widget.
  The widget opens it inside the Accept click (blank first, then pointed at
  the pass) so a pop-up blocker allows it; if it is blocked anyway the widget
  shows an Open live help link.
- **Pointer and control** (`lib/live-control.ts` has the whole route): the
  agent's pointer, clicks, scrolling and keys go over a WebRTC data channel
  `ctl` (made by the customer, the offerer) to the live window, which passes
  them on a BroadcastChannel to the Support iframe of the page being shown (the
  latest visible one announces itself after every page load), which hands them
  to `chat-widget.js` to draw or repeat. Coordinates are 0..1 of the picture and
  every command carries the share's `s` (displaySurface): a **tab** maps exactly;
  a **window** or **whole screen** is placed by the page from its own
  screenX/Y and outer-less-inner size (`ctlPoint()`), which is close but not
  exact (zoom, a dock or menu bar, a docked developer panel; the screen's start
  is `screen.availLeft/availTop`). A point off the page hides the pointer and
  refuses the click. **Line up pointer** (agent, on a screen or window share)
  sends the arrow to the middle; the agent clicks its tip and every later point
  is moved by that difference (`off` in SupportLiveHelp), reset when the share
  changes or the call ends.
- The live window closes itself 2 s after the call ends (a failure stays).
  The pointer needs no consent; clicks, scrolling and keys only while the state
  is `on`, which the live window sets solely from the customer's Allow on their
  page (an agent's message cannot set it). The page shows a bottom-left banner
  with Stop control, never types into password / PIN / card / OTP fields, never
  clicks the widget's own controls, and looks through its own banner when
  finding what was clicked. Synthetic input cannot open file pickers or native
  select lists (lists move with the arrow keys). BroadcastChannel is partitioned
  in some browsers even between subdomains, so the live window also keeps the
  site's TAB (`window.opener.top`, which outlives page reloads, unlike the
  opener iframe) and posts to its frames -- only the Support iframe (our origin)
  takes it -- asking `who` every 3 s; each side answers whoever wrote
  (`LiveBus` peers). Before this, control was lost on the first page load.
- **The call bar.** Once connected the live window shrinks to a corner
  (`resizeTo` / `moveTo`, which a browser may refuse) and sends `call {live,
  muted, mic, sharing}` on the same bus; the page shows a bottom-left bar with
  Mute and Stop (replies `call-mute`, `call-end`), the control banner stacked
  above it. Its audio element is redrawn with the layout, so the agent's
  stream is reattached by a ref callback.
- **Call phone** stamps the next outbound call from that agent to that number
  within 30 minutes with the ticket number (`support_call_links`, read by the
  FreePBX CDR sync).
- **The STUN / TURN list is `app/services/ice_config.py`** (live help and the
  softphone): Telephony's `turn_provider` is `none`, `coturn` (fixed URL,
  username, password) or `cloudflare` (credentials generated per key, cached
  for half their lifetime, the API token sealed with secret_box label
  `cloudflare-turn`, never sent back). A row with no provider reads as coturn
  when a TURN URL is set. Save & Test TURN (`/admin/telephony/test-turn`,
  `app/services/turn_check.py`) does a real TURN Allocate with the credentials
  a call would get. Running coturn: `deploy/coturn/`.
- Tested end to end with two headless Chrome windows with fake media devices
  (talk and screen); not yet on real devices or across networks through TURN.
