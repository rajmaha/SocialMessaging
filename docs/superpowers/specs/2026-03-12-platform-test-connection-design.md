# Platform Test Connection — Design Spec

**Date:** 2026-03-12
**Feature:** Test Connection button in Platform Configuration
**Approach:** Option B — credential probe + webhook subscription check

---

## Overview

Add a "Test Connection" button to the platform configuration form in Admin Settings. When clicked, it sends the current form values to a new backend endpoint which makes real API calls to the platform to verify both credentials and webhook subscription status. No need to save before testing.

---

## Backend

### New Endpoint

`POST /admin/platforms/{platform}/test`

- **Auth:** `check_permission("feature_manage_messenger_config")`
- **Body:** Same credential fields as the save form (app_id, app_secret, access_token, verify_token, plus platform-specific fields)
- **Side effect:** If credential check passes, updates `is_configured = 2` (Verified) in DB

### Credential Probe (per platform)

| Platform | API Call | Success Indicator |
|---|---|---|
| WhatsApp | `GET graph.facebook.com/v18.0/{phone_number_id}?access_token={token}` | Returns phone number display name |
| Facebook | `GET graph.facebook.com/v18.0/{page_id}?access_token={token}` | Returns page name |
| Viber | `POST chatapi.viber.com/pa/get_account_info` with `X-Viber-Auth-Token` | Returns bot name |
| LinkedIn | `GET api.linkedin.com/v2/me` with `Authorization: Bearer {token}` | Returns member name |

### Webhook Check (per platform)

| Platform | API Call | Notes |
|---|---|---|
| WhatsApp | `GET graph.facebook.com/v18.0/{phone_number_id}/subscribed_apps?access_token={token}` | Lists subscribed fields |
| Facebook | `GET graph.facebook.com/v18.0/{page_id}/subscribed_apps?access_token={token}` | Lists subscribed fields |
| Viber | Parsed from `get_account_info` response — includes webhook URL | Same call as credential probe |
| LinkedIn | Not checkable via API | Returns `"unknown"` status |

### Response Schema

```json
{
  "credential_ok": true,
  "credential_detail": "Connected as: MyBusiness WhatsApp",
  "webhook_status": "registered" | "not_registered" | "unknown",
  "webhook_detail": "Subscribed to: messages, message_deliveries"
}
```

- If `credential_ok` is false, `webhook_status` is omitted (no point checking webhook with bad creds)
- Errors from the platform API are caught and surfaced in `credential_detail`

---

## Frontend

### Button Placement

In the form footer alongside "Save Configuration" and "Cancel":

```
[ Test Connection ]  [ Save Configuration ]  [ Cancel ]
```

### Button States

- **Disabled** — when required fields for the selected platform are empty
- **Loading** — spinner + "Testing…" label, all three buttons disabled
- **Idle** — normal state after result is shown or fields changed

### Result Panel

Displayed inline below the buttons. Two rows for credential and webhook:

```
┌─────────────────────────────────────────────────┐
│ ✓ Credentials    Connected as: MyBusiness WA    │  ← green
│ ✓ Webhook        Subscribed to: messages        │  ← green
└─────────────────────────────────────────────────┘
```

Failure:
```
┌─────────────────────────────────────────────────┐
│ ✗ Credentials    Invalid access token           │  ← red
└─────────────────────────────────────────────────┘
```

Unknown (LinkedIn webhook):
```
│ ─ Webhook        Not verifiable via API         │  ← gray
```

- Result clears whenever any form field changes
- If credentials pass, platform card badge updates to "Verified" after form close (via `fetchPlatforms()`)

### Required Fields Per Platform (for disabled logic)

| Platform | Required to enable Test button |
|---|---|
| WhatsApp | access_token, phone_number_id |
| Facebook | access_token, page_id |
| Viber | access_token |
| LinkedIn | access_token |

---

## Files Affected

- `backend/app/routes/admin.py` — add `POST /platforms/{platform}/test` endpoint
- `backend/app/services/platform_service.py` — add `test_connection` methods per platform
- `frontend/app/admin/settings/page.tsx` — add button, state, result panel

---

## Out of Scope

- Webhook registration (setting up the webhook) — this design only checks existing subscription state
- LinkedIn webhook (API does not support checking subscription status)
