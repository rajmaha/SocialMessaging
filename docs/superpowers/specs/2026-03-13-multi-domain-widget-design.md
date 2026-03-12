# Multi-Domain Widget Support — Design Spec

## Summary

Enable installing the chat widget on multiple domains, each with its own branding overrides, platform account assignments, and agent assignments. Admin controls which accounts/pages appear per domain and which agents handle conversations from each domain.

## Data Model

### `widget_domains` table (new)

| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| domain | string, unique | e.g. `shop.example.com` |
| widget_key | string, unique | UUID auto-generated, used in embed snippet |
| display_name | string | Friendly label for admin UI |
| is_active | int | 1=active, 0=disabled |
| branding_overrides | JSON, nullable | Partial branding (company_name, logo_url, primary_color, welcome_message). NULL fields fall back to global `branding_settings` |
| created_at | datetime | |
| updated_at | datetime | |

### `domain_accounts` table (new — junction)

| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| widget_domain_id | int FK -> widget_domains | |
| platform_account_id | int FK -> platform_accounts | |
| created_at | datetime | |

Unique constraint on `(widget_domain_id, platform_account_id)`.

Controls which platform accounts (Facebook pages, WhatsApp numbers, etc.) are available on this domain's widget.

### `domain_agents` table (new — junction)

| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| widget_domain_id | int FK -> widget_domains | |
| user_id | int FK -> users | The agent |
| created_at | datetime | |

Unique constraint on `(widget_domain_id, user_id)`.

**Access rule:** If a domain has zero rows in `domain_agents`, all agents can handle its conversations (backward compatible). Once any row exists, only assigned agents see/handle conversations from that domain.

### Conversations table change

Add `widget_domain_id` (int FK, nullable) to `conversations`. Set when a webchat conversation originates from a widget with a known domain. NULL for legacy/non-widget conversations.

## Backend API

### Widget Domains CRUD — `/admin/widget-domains`

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/widget-domains` | List all widget domains |
| POST | `/admin/widget-domains` | Create a new widget domain (auto-generates widget_key) |
| PUT | `/admin/widget-domains/{id}` | Update domain settings/branding |
| DELETE | `/admin/widget-domains/{id}` | Remove a domain |
| PATCH | `/admin/widget-domains/{id}/toggle` | Enable/disable domain |

### Domain Account Assignment

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/widget-domains/{id}/accounts` | Accounts assigned to domain |
| PUT | `/admin/widget-domains/{id}/accounts` | Replace domain's account list |

### Domain Agent Assignment

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/widget-domains/{id}/agents` | Agents assigned to domain |
| PUT | `/admin/widget-domains/{id}/agents` | Replace domain's agent list |

All admin endpoints require `admin` role.

### Widget Endpoint Changes

**`GET /webchat/branding`** — Updated to accept `?key=<widget_key>`:
- If `key` provided: look up `widget_domains` by `widget_key`, merge `branding_overrides` over global `branding_settings` (NULL fields fall back to global)
- If no `key`: return global branding (backward compatible)

**`GET /webchat/channels`** — New or updated endpoint accepting `?key=<widget_key>`:
- If `key` provided: return only platform accounts assigned to this domain via `domain_accounts`
- If no `key`: return all active accounts (backward compatible)
- Response: list of `{platform, account_name, account_id}` for the widget to display channel options

### WebSocket Changes

**`/webchat/ws/{session_id}`** — Widget sends `widget_key` in the initial connection message. Backend resolves `widget_domain_id` from the key and tags the conversation with it.

### Agent Conversation Scoping

Existing conversation list endpoint checks `domain_agents`: if the current agent has `domain_agents` rows, only show webchat conversations from those domains (plus all non-webchat conversations). Zero rows = see all (backward compatible).

## Frontend UI

### Admin — Widget Domains Page

**Domain List View:**
- Table: Domain | Display Name | Widget Key | Status | Actions (edit/delete/toggle)
- "Add Domain" button -> modal

**Add/Edit Domain Modal:**
- Domain field (e.g. `shop.example.com`)
- Display Name field
- Branding overrides section: Company Name, Logo URL, Primary Color, Welcome Message (all optional — NULL = use global)
- Save / Cancel

**Embed Code Snippet:**
- Each domain row shows a copy-to-clipboard embed snippet:
  ```html
  <script src="https://yourdomain.com/chat-widget.js" data-key="<widget_key>"></script>
  ```

**Domain Accounts Tab (per domain):**
- Checkbox list of active platform accounts grouped by platform
- Select All / Clear All

**Domain Agents Tab (per domain):**
- Checkbox list of agents
- Select All / Clear All

### Admin Navigation

Add "Widget Domains" link to admin nav.

### Widget Script Changes (`chat-widget.js`)

- Read `data-key` attribute from the script tag
- Pass `key` parameter to `/webchat/branding?key=...` and `/webchat/channels?key=...`
- Send `widget_key` in WebSocket initial message
- If no `data-key` attribute: fall back to current behavior (origin auto-detect or global defaults)

### Conversations Inbox

- Domain badge/tag on webchat conversations showing source domain name
- "Domain" filter dropdown in sidebar (for webchat conversations)
