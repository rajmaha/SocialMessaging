# Email Validator Integration Design

**Date:** 2026-03-06
**Status:** Approved

## Summary

Integrate an external email validation API into three areas of the system:
1. Admin branding settings — configure the validator URL, secret key, and risk threshold
2. Email compose/reply/forward — real-time per-address validation as chips are added to To/CC/BCC fields
3. Campaign send — bulk pre-send validation, marking failed leads and suppressing them from future sends

**Approach:** Backend proxy — all validation calls go through the project's own backend so the secret key never reaches the browser.

---

## 1. Data Layer

### `branding_settings` table — 3 new columns (inline SQL migration in `main.py`)

| Column | Type | Default | Purpose |
|---|---|---|---|
| `email_validator_url` | String | NULL | Base URL of the validation API, e.g. `https://hooks.yourdomain.com` |
| `email_validator_secret` | String | NULL | Bearer token sent as `Authorization: Bearer <secret>` |
| `email_validator_risk_threshold` | Integer | 60 | Scores below this pass; scores ≥ this fail |

### `leads` table — 1 new column (inline SQL migration in `main.py`)

| Column | Type | Default | Purpose |
|---|---|---|---|
| `email_valid` | Boolean | NULL | `NULL` = not checked, `True` = passed, `False` = failed |

### `email_suppressions` table — no schema change

The existing `reason` String column is extended to also accept the value `"invalid"` (alongside existing `"bounced"`, `"unsubscribed"`, `"complaint"`).

---

## 2. Backend / API Layer

### New service: `backend/app/services/email_validator_service.py`

- `get_validator_config(db)` → reads branding settings, returns `(url, secret, threshold)` or `None` if not configured
- `validate_single(email, db)` → calls `POST {url}/api/validate` with `Authorization: Bearer {secret}`, returns `{is_valid, risk_score, ...}` or `None` on timeout/error (fail open)
- `validate_bulk(emails, db)` → calls `POST {url}/api/validate/bulk` (max 500 per request), returns results list or `[]` on error
- Uses `httpx` with 5-second timeout; any exception fails open (does not block the caller)

### New route file: `backend/app/routes/email_validator.py`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/email-validator/validate` | Required | `{email: str}` → proxy single validation, return result |
| `POST` | `/email-validator/validate-bulk` | Required | `{emails: [str]}` → proxy bulk validation, return results |
| `POST` | `/email-validator/recheck-lead/{lead_id}` | Required | Re-validate lead's email; update `email_valid` on Lead; add/remove EmailSuppression |

**`recheck-lead` logic:**
1. Fetch lead by `lead_id`
2. Call `validate_single(lead.email, db)`
3. If passes: set `lead.email_valid = True`, remove any `EmailSuppression` with `reason="invalid"` for that email
4. If fails: set `lead.email_valid = False`, upsert `EmailSuppression(email=lead.email, reason="invalid")`
5. Return updated lead validity status

### Branding settings endpoints

Extend existing `GET /branding` and `PUT /branding` to include the 3 new validator fields. The secret is returned masked (last 4 chars visible, rest `*`) on GET.

### Campaign send flow changes (`backend/app/routes/campaigns.py`)

**`_build_audience()` change:**
- Add filter: exclude leads where `email_valid == False` (in addition to existing suppression filter)

**`_do_send()` change — pre-send bulk validation step:**
1. After audience is built, collect all recipient emails
2. Call `validate_bulk(emails, db)` — if validator not configured, skip this step entirely
3. For each failed result (`is_valid=False` or `risk_score >= threshold`):
   - Set `lead.email_valid = False`
   - Upsert `EmailSuppression(email=..., reason="invalid", campaign_id=campaign.id)`
   - Remove from send list
4. Update campaign stats: add `validation_skipped_count` to track how many were filtered

---

## 3. Frontend / UI Layer

### Branding admin page (`frontend/app/admin/branding/page.tsx`)

Add a new **"Email Validator"** section with:
- **Validator URL** — text input, placeholder `https://hooks.yourdomain.com`
- **Secret Key** — password input (masked), with show/hide toggle
- **Risk Threshold** — number input, default 60, min 1 max 100, helper text: "Emails with risk score ≥ this value will be rejected"

### Email compose — tag-style address inputs (`frontend/app/email/page.tsx`)

Convert plain `to`, `cc`, `bcc` text inputs into a reusable `EmailAddressInput` component:
- Addresses become chips on comma / Tab / Enter
- On chip creation: call `POST /email-validator/validate`
- Chip states:
  - **Pending** — spinner icon, neutral border
  - **Valid** — green border, ✅ icon
  - **Risky** — yellow border, ⚠️ icon, tooltip shows risk score
  - **Invalid** — red border, ❌ icon, tooltip shows reason (e.g. "Disposable address", "Invalid domain")
  - **Unchecked** (validator not configured) — default neutral style, no icon
- Users can still delete chips and re-add corrected addresses
- Send is NOT blocked by failed chips — validation is informational

New component: `frontend/components/EmailAddressInput.tsx`

### Campaign stats/recipients table

For each campaign recipient where the lead's `email_valid == False`:
- Show red **"Invalid"** badge next to the email address
- Show **"Re-check"** button → calls `POST /email-validator/recheck-lead/{lead_id}`
- Button shows spinner while pending
- On success: badge updates to ✅ Valid, Re-check button disappears

### CRM lead detail page (`frontend/app/admin/crm/` or leads section)

On each lead's profile/row:
- Email validity badge: **✅ Valid** (green) / **❌ Invalid** (red) / **— Not checked** (gray)
- **"Verify Email"** button → calls recheck endpoint, updates badge inline without page reload

---

## 4. Error Handling & Edge Cases

| Scenario | Behaviour |
|---|---|
| Validator URL not configured | All validation silently skipped; no UI shown in compose; no pre-send check |
| Validator API timeout / unreachable | Fail open — treat as unchecked, do not block compose or campaign send |
| Bulk validation during campaign send fails | Log error, continue send without filtering (fail open) |
| Lead has no email | Skip validation, leave `email_valid = NULL` |
| Re-check passes on previously failed lead | Remove suppression, set `email_valid = True`, allow future campaigns |
| Re-check fails on a previously valid lead | Update to `email_valid = False`, add suppression |
