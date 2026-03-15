# Universal Ticket Creation — Design Spec
**Date:** 2026-03-15
**Status:** Approved

## Overview

Extend ticket creation beyond the call-in workspace so agents can create tickets from:
1. Any messaging conversation (WhatsApp, Facebook, Viber, LinkedIn, webchat)
2. Any email in the email view
3. A standalone button in the workspace (no active call required)

Tickets created from messaging/email use a lightweight quick form (modal). Admin central view already exists at `/admin/tickets` — no changes needed there.

---

## Data Model Changes

Two new nullable FK columns on `Ticket`:

```sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES conversations(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS email_id INTEGER REFERENCES emails(id);
```

A new optional `source` enum column:

```sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'call';
-- values: 'call' | 'messaging' | 'email' | 'manual'
```

Added via inline SQL in `backend/main.py` using `IF NOT EXISTS` (existing migration pattern).

**Conversation badge:** `GET /api/conversations` response enriched with `ticket_count` (int) via COUNT JOIN. No schema change to `Conversation` model needed — computed in query.

---

## Backend API Changes

### `POST /api/tickets` — extended
New optional body fields:
- `conversation_id: int | None`
- `email_id: int | None`
- `source: Literal["call", "messaging", "email", "manual"] = "call"`

Behaviour change: auto-create `CallRecording` only when `source == "call"`. All other sources skip it.

Org lookup: unchanged for phone number. For email-sourced tickets, lookup by email domain (split domain from address, match `Organization.email_domain`).

### `GET /api/conversations` — enriched response
Each conversation item gains `ticket_count: int` (0 if none). Implemented as a subquery or JOIN in the existing listing query.

### New: `GET /api/tickets/context-by-email`
```
GET /api/tickets/context-by-email?email=customer@example.com
```
Returns same shape as existing `GET /api/tickets/context/{phone_number}`:
```json
{
  "organization_id": 12,
  "organization_name": "Example Corp",
  "contact_person": "Jane Doe"
}
```
Lookup logic: extract domain from email → search `Organization.email_domain`.

---

## Frontend Components

### New: `QuickTicketModal`
**Path:** `frontend/components/QuickTicketModal.tsx`

```ts
interface QuickTicketModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  prefill: {
    phone?: string
    email?: string
    contactName?: string
    conversationId?: number
    emailId?: number
  }
}
```

**Behaviour:**
- On open: fires context lookup (phone → `/api/tickets/context/{phone}`, email → `/api/tickets/context-by-email?email=...`)
- Displays read-only pre-fill row: customer name, phone/email, matched org name (or "No org found")
- Agent-editable fields: category (dropdown), priority (dropdown), status (dropdown), assign-to (agent dropdown), description/note (textarea, optional)
- Submit: `POST /api/tickets` with `source` set to `"messaging"`, `"email"`, or `"manual"` depending on entry point
- On success: calls `onCreated()`, closes modal, shows brief success toast

### Modified: `ConversationList.tsx`
- When `conversation.ticket_count > 0`, render a small pill badge on the row (e.g. ticket icon + count)
- Badge style: neutral colour (not alarming), positioned bottom-right of the conversation avatar or inline after contact name

### Modified: `ChatWindow.tsx`
- Add "Create Ticket" button in the conversation header toolbar (alongside existing action buttons)
- On click: open `QuickTicketModal` with `{ phone: contact_id, contactName: contact_name, conversationId: id }`
- After `onCreated`: re-fetch conversation to update `ticket_count` badge

### Modified: Email view page (`frontend/app/email/`)
- Add "Create Ticket" button in the email action bar
- On click: open `QuickTicketModal` with `{ email: sender_email, contactName: sender_name, emailId: email_id }`

### Modified: `frontend/app/workspace/page.tsx`
- Add a standalone "Create Ticket" button in the workspace header (always visible, not conditional on active call)
- On click: open `QuickTicketModal` with empty prefill — agent types phone or email, lookup fires on input blur/submit
- Existing call-in `TicketForm` behaviour unchanged

---

## Entry Points Summary

| Location | Trigger | Pre-fill | Source value |
|---|---|---|---|
| Workspace header | Button (always visible) | None — agent enters phone/email | `"manual"` |
| ChatWindow header | Button per conversation | phone, contact name, conversation_id | `"messaging"` |
| Email view action bar | Button per email | email, sender name, email_id | `"email"` |

---

## What Is NOT Changing

- Existing call-in `TicketForm` flow — unchanged, `source` defaults to `"call"`
- Auto `CallRecording` creation — still happens for `source == "call"` only
- Admin tickets page (`/admin/tickets`) — already shows all tickets centrally, no changes needed
- Ticket threading / follow-up flow — unchanged

---

## Success Criteria

- Agent can create a ticket from a messaging conversation without leaving the chat
- Agent can create a ticket from an email without leaving the email view
- Agent can create a ticket from the workspace without an active call
- Conversations with tickets show a visible badge in the conversation list
- Tickets link to the originating conversation or email (visible in admin ticket detail)
- Org is auto-matched by phone number or email domain at creation time
