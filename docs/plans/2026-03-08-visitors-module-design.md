# Visitors Module — Design Document

**Date:** 2026-03-08
**Status:** Approved

---

## Overview

A Visitors Management Module for logging and tracking office visitors. Supports agent-assisted check-in from the admin panel and a public self-service kiosk (per location). Includes webcam photo capture, IP camera CCTV snapshot, and SSE notifications to the host agent on check-in.

---

## Approach

**Approach C — Visitor profiles + visits + multi-location kiosk config**

Three-table design:
- `visitor_locations` — one per office/kiosk, holds IP camera URL
- `visitor_profiles` — reusable identity per person (name, contact, photo)
- `visits` — one row per visit event linking profile + location + host agent

---

## Data Model

### `visitor_locations`
| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| name | string | e.g. "Head Office Lobby" |
| ip_camera_url | string nullable | MJPEG/snapshot URL |
| created_at | datetime | |

### `visitor_profiles`
| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| name | string | |
| address | text nullable | |
| contact_no | string nullable | |
| email | string nullable | |
| organization | string nullable | |
| photo_path | string nullable | headshot stored on disk |
| created_at | datetime | |

### `visits`
| Field | Type | Notes |
|---|---|---|
| id | int PK | |
| visitor_profile_id | int FK → visitor_profiles | |
| location_id | int FK nullable → visitor_locations | |
| num_visitors | int default 1 | group size |
| purpose | string | "Meeting", "Delivery", etc. |
| host_agent_id | int FK nullable → users | agent/user being visited |
| check_in_at | datetime | set on creation |
| check_out_at | datetime nullable | null until checkout |
| visitor_photo_path | string nullable | webcam capture at check-in |
| cctv_photo_path | string nullable | frame from IP camera at check-in |
| created_by | int FK nullable → users | null for kiosk self-service |
| created_at | datetime | |

---

## Pages & UI

### Admin Panel (authenticated)
- **`/admin/visitors`** — visit list: filters by date range, location, status (checked-in / checked-out); search by visitor name/org; inline check-out button; click row for detail
- **`/admin/visitors/[id]`** — visit detail: all fields, visitor headshot, CCTV snapshot
- **`/admin/visitors/new`** — agent-assisted check-in form
- **`/admin/visitors/locations`** — manage kiosk locations: name + IP camera URL + test snapshot button

### Public Kiosk (no auth)
- **`/kiosk/[locationId]`** — full-screen self-service flow:
  1. Phone/email lookup → pre-fills returning visitor details
  2. Fill in details: name, org, address, purpose, host agent (dropdown), num visitors
  3. Webcam capture for headshot (MediaDevices API)
  4. Submit → backend grabs CCTV snapshot → SSE notification sent to host
  5. Confirmation screen: "Welcome, [name]! [Host] has been notified."
- Checkout: visitor enters phone → sees active visit → taps Check Out

### AdminNav
New "Visitors" group with links: Visits, Locations

---

## API Routes (`/visitors/` prefix)

| Method | Path | Purpose |
|---|---|---|
| GET | `/visitors/locations` | list locations |
| POST | `/visitors/locations` | create location |
| PUT | `/visitors/locations/{id}` | update location |
| DELETE | `/visitors/locations/{id}` | delete location |
| GET | `/visitors/locations/{id}/snapshot` | fetch CCTV frame from IP camera URL |
| GET | `/visitors/profiles/search` | search by phone/email for kiosk lookup |
| GET | `/visitors/` | list visits (filters: date, location, status) |
| GET | `/visitors/{id}` | visit detail |
| POST | `/visitors/` | create visit (check-in) — agent or kiosk |
| PATCH | `/visitors/{id}/checkout` | set check_out_at = now |
| POST | `/visitors/upload-photo` | upload webcam capture, returns path |

---

## Photo Storage

- Visitor headshots → `backend/app/attachment_storage/visitors/profiles/`
- CCTV snapshots → `backend/app/attachment_storage/visitors/cctv/`
- IP camera snapshot: `requests.get(ip_camera_url, timeout=5)` at check-in time

---

## Notifications (SSE)

- On check-in, backend emits SSE event to host agent
- Event type: `visitor_checkin`
- Payload: `{ visitor_name, org, purpose, location, visit_id }`
- Frontend `events-context.tsx` displays toast/notification to the host agent

---

## Kiosk Auth

- `/kiosk/[locationId]` is a fully public route — no login required
- Location ID in URL identifies which kiosk/office
- Admin generates and shares the kiosk URL from the Locations admin page
