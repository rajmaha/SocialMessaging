# Email Template Module — Design Document

**Date:** 2026-03-03
**Status:** Approved

## Overview

Adds a professional email template library to the Email Campaigns system, replacing the raw HTML textarea with a visual template picker + rich editor. Also enhances open tracking with IP geolocation and device detection.

## Goals

1. Let admins pick from beautiful pre-built templates instead of writing raw HTML
2. Enable personalization via merge tags auto-replaced per recipient at send time
3. Capture richer engagement data: country, city, device type, email client per open

---

## Architecture

### Backend

#### New Model: `EmailTemplate`
Table: `email_templates`

| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| name | varchar | e.g. "Newsletter – Dark" |
| category | varchar | newsletter / promotional / welcome / followup |
| is_preset | bool | True = shipped with system, not deletable |
| body_html | text | Full HTML email body |
| created_at | timestamp | |

#### Enhanced Model: `CampaignRecipient`
New columns added via inline migration:

| Column | Type | Notes |
|---|---|---|
| open_count | int default 0 | incremented per pixel fetch |
| country | varchar nullable | from IP geolocation |
| city | varchar nullable | from IP geolocation |
| device_type | varchar nullable | mobile / desktop / tablet |
| email_client | varchar nullable | Gmail / Outlook / Apple Mail / Other |

#### New Routes: `/email-templates/`
- `GET /email-templates/` — list all (admin)
- `POST /email-templates/` — create custom template (admin)
- `PATCH /email-templates/{id}` — update (admin, presets not editable)
- `DELETE /email-templates/{id}` — delete (admin, presets not deletable)

#### Campaign Send Enhancement
- Replace `{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{company}}`, `{{unsubscribe_link}}` per recipient using lead data before sending

#### Tracking Pixel Enhancement
`GET /campaigns/track/open/{campaign_id}/{recipient_id}`:
- Increment `open_count`
- Set `opened_at` (first open only)
- Async: call `ipapi.com/json/{ip}` for country/city
- Parse `User-Agent` for device_type + email_client
- Return 1×1 GIF immediately (geolocation is fire-and-forget)

---

## Frontend

### New Pages
- `/admin/email-templates` — Template library: grid of cards, New Template button, Edit/Delete actions
- `/admin/email-templates/new` — Create custom template with `EmailEditor`
- `/admin/email-templates/[id]/edit` — Edit custom template

### New Components
- `EmailTemplateGallery` — Modal with two tabs (Presets / My Templates), 3-col card grid, HTML thumbnail preview, "Use This" button
- `EmailEditor` — Tiptap rich editor + merge tag toolbar above (clickable `{{first_name}}` etc. buttons)

### Campaign Form Changes (`/admin/campaigns/new` and `edit`)
- Remove raw `<textarea body_html>`
- Add **"Choose Template"** button + "Start blank" option
- Selected template/blank loads into `EmailEditor`
- Merge tag toolbar always visible above editor

### Campaign Stats Page Enhancements
- Per-recipient table: add Country 🌍, Device 📱/💻, Email Client columns
- Summary row: "X% Mobile / Y% Desktop" + top countries

---

## Built-in Preset Templates (4)

All use inline styles for email-client compatibility.

| Name | Description |
|---|---|
| **Newsletter** | Branded header, 2 content sections with dividers, footer + unsubscribe |
| **Promotional** | Gradient hero banner, bold headline, discount badge, CTA button, footer |
| **Welcome Email** | Warm greeting, 3-step cards, signature block, footer |
| **Follow-up** | Short professional text, single prominent CTA button, minimal layout |

Each uses `{{first_name}}`, `{{company}}` where natural.

---

## Merge Tags

| Tag | Replaced with |
|---|---|
| `{{first_name}}` | Lead's first name (or blank) |
| `{{last_name}}` | Lead's last name (or blank) |
| `{{email}}` | Lead's email address |
| `{{company}}` | Lead's company (or blank) |
| `{{unsubscribe_link}}` | Static `#unsubscribe` placeholder |

---

## Implementation Tasks (for writing-plans)

1. Backend model + migration: `email_templates` table + seed 4 presets
2. Backend: add tracking columns to `campaign_recipients` + enhanced pixel endpoint
3. Backend: CRUD routes `/email-templates/` + merge tag replacement in campaign send
4. Frontend: `EmailEditor` component (Tiptap + merge tag toolbar)
5. Frontend: `EmailTemplateGallery` modal
6. Frontend: `/admin/email-templates` management pages (list, new, edit)
7. Frontend: Campaign new/edit — replace textarea with gallery picker + EmailEditor
8. Frontend: Campaign stats page — add location/device columns + summary
