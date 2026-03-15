# Multi-Account Platform Support — Design Spec

## Summary

Enable connecting multiple accounts per platform (multiple Facebook pages, WhatsApp numbers, Viber bots, LinkedIn orgs) with per-agent access control. All conversations appear in one shared inbox, filterable by account.

## Data Model

### `platform_accounts` table (existing — add 3 columns)

| Column | Type | Notes |
|---|---|---|
| id | int PK | existing |
| platform | string | `facebook`, `whatsapp`, `viber`, `linkedin` |
| account_id | string unique | Page ID / Phone Number ID / Viber bot ID |
| account_name | string | Display name |
| access_token | string | Per-account token |
| phone_number | string | WhatsApp only |
| is_active | int | 1=active, 0=disabled |
| user_id | int FK | existing — account creator |
| **app_secret** | string, new | Signature verification per-account |
| **verify_token** | string, new | Webhook verification per-account |
| **metadata** | JSON, new | Flexible extras (business_account_id, org_id, etc.) |

### `agent_accounts` table (new — junction)

| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| user_id | int FK → users | The agent |
| platform_account_id | int FK → platform_accounts | The account |
| created_at | datetime | |

Unique constraint on `(user_id, platform_account_id)`.

**Access rule:** If an agent has zero rows in `agent_accounts`, they see all accounts (backward compatible). Once any row exists for an agent, they only see assigned accounts.

## Backend API

### Connected Accounts CRUD — `/admin/platform-accounts`

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/platform-accounts?platform=facebook` | List accounts for a platform |
| POST | `/admin/platform-accounts` | Add a connected account |
| PUT | `/admin/platform-accounts/{id}` | Update account credentials |
| DELETE | `/admin/platform-accounts/{id}` | Remove an account |
| PATCH | `/admin/platform-accounts/{id}/toggle` | Enable/disable account |

### Agent Access Control

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/admin/platform-accounts/{id}/agents` | Agents assigned to account |
| POST | `/admin/platform-accounts/{id}/agents` | Assign agent to account |
| DELETE | `/admin/platform-accounts/{id}/agents/{user_id}` | Remove agent from account |
| GET | `/admin/users/{user_id}/platform-accounts` | Accounts assigned to agent |
| PUT | `/admin/users/{user_id}/platform-accounts` | Replace agent's account list |

### Conversation Filtering

Existing `GET /conversations` auto-scopes results to the calling agent's permitted accounts (derived from `agent_accounts` rows for the current user). No extra param needed from frontend.

All admin endpoints require `admin` role.

## Webhook Routing

### Routing keys per platform

| Platform | Identifier in payload | Location |
|---|---|---|
| Facebook | Page ID | `entry[].id` |
| WhatsApp | Phone Number ID | `entry[].changes[].value.metadata.phone_number_id` |
| Viber | Bot token | matched from `account_id` |
| LinkedIn | Organisation ID | `entry[].id` |

### Flow

```
Payload arrives → extract platform identifier
  → query platform_accounts WHERE account_id = <identifier> AND is_active = 1
  → if found: use that account's access_token for reply
  → if not found: fall back to platform_settings (existing global config)
  → link conversation to platform_account_id
```

Fallback to `platform_settings` preserves backward compatibility.

### Send service changes

`WhatsAppService.send_message()` and `FacebookService.send_message()` accept optional `access_token` / `phone_number_id` parameters. When provided (from matched account), those are used; when `None`, falls back to env values.

## Frontend UI

### Admin — Connected Accounts tab

**Account List View:**
- Table: Platform icon | Account Name | Account ID | Status | Actions (edit/delete/toggle)
- Filter dropdown by platform
- "Add Account" button → modal

**Add/Edit Account Modal:**
- Platform dropdown
- Dynamic fields per platform:
  - Facebook: Account Name, Page ID, Access Token, App Secret
  - WhatsApp: Account Name, Phone Number ID, Phone Number, Access Token, Business Account ID
  - Viber: Account Name, Bot Token
  - LinkedIn: Account Name, Access Token, Organisation ID
- Password toggle on token/secret fields
- Save / Cancel

**Agent Assignment (per account):**
- "Manage Agents" button on each row → inline checkbox panel
- Select All / Clear All shortcuts

### Admin — User Edit (bidirectional)

- "Account Access" section on agent profile
- Checkboxes grouped by platform

### Conversations Inbox

- Badge/tag on each conversation showing source account name
- "Account" filter dropdown in sidebar
