# Marketing Module Must-Fix Features — Design

**Date:** 2026-03-06
**Status:** Approved
**Scope:** 3 blockers before deployment

---

## 1. Unsubscribe System (One-Click + Re-subscribe)

### Model: `EmailSuppression`

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| email | VARCHAR(255) UNIQUE | Indexed for fast lookup |
| reason | VARCHAR(50) | `unsubscribed` / `bounced` / `complaint` |
| campaign_id | INTEGER FK (nullable) | Which campaign triggered it |
| unsubscribed_at | TIMESTAMPTZ | When suppressed |
| resubscribed_at | TIMESTAMPTZ (nullable) | When re-subscribed; null = still suppressed |
| created_at | TIMESTAMPTZ | Row creation |

**Active suppression logic:** `resubscribed_at IS NULL OR resubscribed_at < unsubscribed_at`

### Endpoints (Public, No Auth)

- `GET /campaigns/unsubscribe/{token}` — HMAC-signed token contains `email` + `campaign_id`. Decodes, adds/updates suppression row, returns a minimal HTML landing page with "You've been unsubscribed" message and a "Re-subscribe" button.
- `POST /campaigns/resubscribe` — Accepts `{token}`. Sets `resubscribed_at = now()` on the matching suppression row. Returns confirmation HTML.

### Token Format

HMAC-SHA256 signed with `SECRET_KEY`. Payload: `email:campaign_id`, base64url-encoded. Prevents tampering — users can't unsubscribe arbitrary addresses.

### Campaign Send Changes

- `_build_audience` query adds `WHERE email NOT IN (active suppressions)`
- `{{unsubscribe_link}}` replaced with `FRONTEND_URL + /campaigns/unsubscribe/{per-recipient-token}`
- Add `List-Unsubscribe` and `List-Unsubscribe-Post` headers per RFC 8058 (one-click unsubscribe for email clients)

### Landing Page

Server-rendered HTML from FastAPI (no frontend route needed). Minimal styled page:
- Heading: "You've been unsubscribed"
- Body: "You won't receive campaign emails from us anymore."
- Button: "Changed your mind? Re-subscribe" → POST to resubscribe endpoint
- On re-subscribe: page updates to "Welcome back! You've been re-subscribed."

---

## 2. Bounce Handling (Log-Based Suppression)

### During `_do_send`

- Wrap each `smtp.send_message()` in try/except
- **Hard bounce (5xx):** `SMTPRecipientsRefused`, permanent failures → auto-create `EmailSuppression(reason='bounced')`
- **Soft bounce (4xx):** Log warning, do NOT suppress (transient)
- **Other SMTP errors:** Log, mark recipient as `failed`

### CampaignRecipient Changes

Add `status` column: `sent` / `bounced` / `failed` (default: `sent`)

### Admin Suppression List

- `GET /campaigns/suppression-list` — Paginated, searchable by email, filterable by reason
- `DELETE /campaigns/suppression-list/{id}` — Manual removal (admin only)
- Frontend: New page at `/admin/campaigns/suppression` — simple table with email, reason, date, and remove button

---

## 3. Send Test Email Endpoint

### Endpoint

`POST /campaigns/send-test`

**Request body:**
```json
{
  "subject": "string",
  "body_html": "string",
  "to_email": "string"
}
```

### Behavior

- Replace merge tags with dummy data:
  - `{{first_name}}` → "John"
  - `{{last_name}}` → "Doe"
  - `{{email}}` → the provided `to_email`
  - `{{company}}` → "Acme Corp"
  - `{{unsubscribe_link}}` → "#" (non-functional in test)
- Do NOT inject tracking pixel
- Send via SMTP using branding_service SMTP config
- Return `{"success": true}` or `{"success": false, "detail": "error message"}`

### Auth

Requires valid JWT (any role). Uses the authenticated user's context for SMTP config lookup.

---

## Files to Modify

**Backend (new):**
- `backend/app/models/email_suppression.py`
- `backend/app/schemas/email_suppression.py`

**Backend (modify):**
- `backend/app/routes/campaigns.py` — add unsubscribe, resubscribe, send-test, suppression-list endpoints; update `_do_send` and `_build_audience`
- `backend/app/models/__init__.py` — register new model
- `backend/main.py` — add migration SQL for `email_suppressions` table and `campaign_recipients.status` column

**Frontend (new):**
- `frontend/app/admin/campaigns/suppression/page.tsx` — suppression list admin page

**Frontend (modify):**
- `frontend/components/SendTestEmailPopover.tsx` — may need minor URL fix if endpoint path differs
