# Dynamic Form Builder — Design Document

**Date:** 2026-03-04
**Status:** Approved
**Module:** Form Pages (Surveys & API-backed Forms)

## Overview

A dynamic form builder that supports two storage modes:
1. **Local DB** — forms save submissions to PostgreSQL
2. **Remote API** — forms proxy CRUD operations to an external REST API

Each form has configurable fields with validation rules, conditional visibility logic, and full CRUD (create, list, detail, update, delete) for submissions.

## Architecture

```
Admin creates form → Defines fields + validation + conditions
                   → Chooses storage: local DB or API server
                   → Maps fields to API variables (if API)
                   → Configures list/detail view columns

User submits form → Local: saves to form_submissions table
                  → API: proxies to remote endpoint with user's token

Submissions view → Local: queries form_submissions table
                 → API: proxies list/detail/update/delete to remote
                 → API auth: X-Api-Key (static) + X-Token (per-user JWT)
```

## Data Model

### `api_servers` — Global API Server Registry

| Column | Type | Purpose |
|---|---|---|
| id | Integer PK | |
| name | String | Display name (e.g. "OMS Production") |
| base_url | String | e.g. `https://demo.saraloms.com` |
| auth_type | Enum | `none`, `api_key_plus_token`, `basic`, `bearer`, `api_key_only` |
| api_key_header | String | Header name, e.g. `X-Api-Key` |
| api_key_value | String | Static API key value |
| token_header | String | Header name for user token, e.g. `X-Token` |
| login_endpoint | String | e.g. `/api/user/login` |
| login_username_field | String | Form field name for username, e.g. `username` |
| login_password_field | String | Form field name for password, e.g. `password` |
| token_response_path | String | JSON path to extract token, e.g. `data.token` |
| request_content_type | Enum | `json` or `formdata` |
| created_at | Timestamp | |

### `user_api_credentials` — Per-User Credentials Per Server

| Column | Type | Purpose |
|---|---|---|
| id | Integer PK | |
| user_id | Integer FK → users | |
| api_server_id | Integer FK → api_servers | |
| username | String | Remote API username |
| password | String | Encrypted password |
| token | String | Cached JWT token |
| token_expires_at | Timestamp | Token expiry |
| is_active | Boolean | Whether credential is valid |
| UNIQUE | (user_id, api_server_id) | One credential per user per server |

### `forms` — Form Definitions

| Column | Type | Purpose |
|---|---|---|
| id | Integer PK | |
| title | String NOT NULL | Form title |
| slug | String UNIQUE NOT NULL | URL path: `/forms/{slug}` |
| description | Text | Optional description |
| success_message | Text | Shown after submission (default: "Thank you for your submission!") |
| storage_type | Enum | `local` or `api` |
| is_published | Boolean | Controls public visibility |
| require_otp | Boolean | OTP verification before submit |
| api_server_id | Integer FK → api_servers | NULL for local forms |
| api_create_method | String | e.g. `POST /api/records` |
| api_list_method | String | e.g. `GET /api/records` |
| api_detail_method | String | e.g. `GET /api/records/{id}` |
| api_update_method | String | e.g. `PUT /api/records/{id}` |
| api_delete_method | String | e.g. `DELETE /api/records/{id}` |
| api_list_columns | JSON | `[{field_key, label, order}]` for list view |
| api_record_id_path | String | JSON path to extract record ID from API response, e.g. `data.id` |
| created_by | Integer FK → users | |
| created_at | Timestamp | |
| updated_at | Timestamp | |

### `form_fields` — Field Definitions Per Form

| Column | Type | Purpose |
|---|---|---|
| id | Integer PK | |
| form_id | Integer FK → forms | Parent form |
| field_label | String NOT NULL | Display label |
| field_key | String NOT NULL | Internal key / API variable name |
| field_type | Enum | See field types below |
| placeholder | String | Placeholder text |
| is_required | Boolean | Default false |
| display_order | Integer | Rendering order |
| default_value | String | Default value (e.g. "0" for number) |
| options | JSON | For dropdown/checkbox: `[{key: "m", value: "Male"}, ...]` |
| validation_rules | JSON | Type-specific rules (see below) |
| api_endpoint | String | For dropdown_api/checkbox_api: URL to fetch options |
| api_value_key | String | JSON path for option value in API response |
| api_label_key | String | JSON path for option label in API response |
| condition | JSON | `{field_key, operator, value}` — conditional visibility |
| created_at | Timestamp | |
| updated_at | Timestamp | |
| UNIQUE | (form_id, field_key) | No duplicate keys per form |

### `form_submissions` — Local Submissions (storage_type=local only)

| Column | Type | Purpose |
|---|---|---|
| id | Integer PK | |
| form_id | Integer FK → forms | |
| data | JSON | `{field_key: value, ...}` |
| submitter_email | String | If OTP verified |
| submitted_at | Timestamp | |
| updated_at | Timestamp | |

## Field Types & Validation Rules

### 1. `text` — Text Input
```json
{"min_length": 5, "max_length": 255, "pattern": "alpha|alphanumeric|alpha_special"}
```
- `alpha`: letters only + `-,._ `
- `alphanumeric`: letters + numbers
- `alpha_special`: letters + numbers + `-,._ `

### 2. `number` — Number Input
```json
{"default": 0, "min_value": 0, "max_value": 9999}
```

### 3. `textarea` — Text Area
No additional rules beyond `is_required`.

### 4. `email` — Email Input
Built-in email format validation. Only validates if field is not empty (unless required).

### 5. `url` — URL Input
Built-in URL format validation. Only validates if field is not empty (unless required).

### 6. `date` — Date Picker
```json
{"min_date": "2024-01-01", "max_date": "2026-12-31"}
```
Date picker only enables dates within the range.

### 7. `time` — Time Picker
```json
{"min_time": "09:00", "max_time": "17:00"}
```
Time picker only shows times within the range.

### 8. `dropdown` — Dropdown Select (Static Options)
```json
options: [{key: "m", value: "Male"}, {key: "f", value: "Female"}]
```

### 9. `dropdown_api` — Dropdown Select (API Options)
```json
api_endpoint: "https://api.example.com/countries"
api_value_key: "id"
api_label_key: "name"
```

### 10. `checkbox` — Checkbox Group (Static Options)
```json
options: [{key: "a", value: "Option A"}, {key: "b", value: "Option B"}]
validation_rules: {"min_selections": 1, "max_selections": 3}
```

### 11. `checkbox_api` — Checkbox Group (API Options)
Same as dropdown_api but renders as checkboxes. Supports min/max selections.

### 12. `yes_no` — Yes/No Toggle
Stored as `1` (Yes) or `0` (No).

### 13. `true_false` — True/False Toggle
Stored as `1` (True) or `0` (False).

## Conditional Visibility

Each field can have one condition:
```json
{
  "field_key": "sex",
  "operator": "equals",       // equals, not_equals, lt, lte, gt, gte
  "value": "female"
}
```

Multiple conditions per field supported via array:
```json
[
  {"field_key": "sex", "operator": "equals", "value": "female"},
  {"field_key": "age", "operator": "gte", "value": "18"}
]
```
All conditions must be true (AND logic). Field is hidden until conditions are met. Hidden fields are excluded from submission data and validation.

## API Endpoints

### API Server Management (Admin)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/admin/api-servers` | Create API server |
| GET | `/api/admin/api-servers` | List all servers |
| PUT | `/api/admin/api-servers/{id}` | Update server |
| DELETE | `/api/admin/api-servers/{id}` | Delete server |
| POST | `/api/admin/api-servers/{id}/test` | Test connection |

### User API Credentials (Admin + User)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/admin/api-servers/{id}/credentials` | Admin assigns credentials to a user |
| GET | `/api/admin/api-servers/{id}/credentials` | List user credentials for a server |
| PUT | `/api/user/api-credentials/{id}` | User updates own credentials |
| POST | `/api/user/api-credentials/{id}/login` | Authenticate and cache token |

### Form CRUD (Admin)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/admin/forms` | Create form |
| GET | `/api/admin/forms` | List all forms (with submission counts) |
| GET | `/api/admin/forms/{id}` | Get form with all fields |
| PUT | `/api/admin/forms/{id}` | Update form settings |
| DELETE | `/api/admin/forms/{id}` | Delete form + fields + submissions |

### Form Fields (Admin)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/admin/forms/{form_id}/fields` | Add field |
| PUT | `/api/admin/forms/{form_id}/fields/{id}` | Update field |
| DELETE | `/api/admin/forms/{form_id}/fields/{id}` | Delete field |
| PUT | `/api/admin/forms/{form_id}/fields/reorder` | Bulk reorder |

### Form Submissions (CRUD)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/forms/{slug}` | Get published form definition (public) |
| POST | `/api/forms/{slug}/submit` | Submit form |
| GET | `/api/admin/forms/{id}/submissions` | List submissions |
| GET | `/api/admin/forms/{id}/submissions/{sub_id}` | View submission detail |
| PUT | `/api/admin/forms/{id}/submissions/{sub_id}` | Update submission |
| DELETE | `/api/admin/forms/{id}/submissions/{sub_id}` | Delete submission |
| GET | `/api/admin/forms/{id}/submissions/export` | Export CSV (local forms) |

### API Proxy Flow (for API-backed forms)

1. **Submit**: Map field keys to API payload → call remote create endpoint with user's token
2. **List**: Call remote list endpoint → map response to configured columns
3. **Detail**: Call remote detail endpoint → display all mapped fields
4. **Update**: Map updated fields → call remote update endpoint
5. **Delete**: Call remote delete endpoint with record ID
6. **Auth**: If token expired → return 401 with `login_required` → frontend shows login modal → user enters credentials → backend authenticates via login endpoint → caches token → retries

## Frontend Pages

### Admin: `/admin/api-servers` — API Server Management
- List of configured servers (name, URL, auth type, status)
- Create/edit modal with all server fields
- Test connection button
- Manage user credentials per server

### Admin: `/admin/forms` — Form List
- Card per form: title, Published/Draft badge, submission count, slug, description, posted date
- Action buttons: Fields, Submissions, Preview (external link), Edit, Delete
- "+ Create Form" button → modal:
  - Form title, URL slug (auto-generated from title)
  - Description, success message
  - Storage type toggle (Local DB / API)
  - If API: select server, configure CRUD endpoints, list columns
  - Publish toggle, OTP toggle

### Admin: `/admin/forms/[id]/fields` — Field Builder
- Ordered list of fields with drag handles
- Each field card: label, type badge, required badge, options preview
- Move up/down, edit, delete buttons
- "+ Add Field" → modal:
  - Field label, field key (auto-generated from label)
  - Field type dropdown (all 13 types)
  - Type-specific config (placeholder, min/max, options editor, API endpoint)
  - Validation rules section
  - Conditional visibility: field dropdown + operator + value

### Admin: `/admin/forms/[id]/submissions` — Submissions Table
- Paginated table with admin-configured columns
- For local: query DB, export CSV button
- For API: proxy to remote list endpoint
- Click row → detail view
- Edit/delete actions per row

### Public: `/forms/[slug]` — Form Renderer
- Fetches form definition + fields
- Renders fields dynamically by type
- Applies conditional visibility in real-time
- Client-side validation per field rules
- OTP verification flow (if enabled)
- Success message on completion

### User: API Login Modal
- Appears when API token is expired/missing
- Username + password form
- On success: token cached, original action retried
- On failure: error message, retry

## File Structure (New Files)

```
backend/app/
  models/
    api_server.py          # ApiServer, UserApiCredential
    form.py                # Form, FormField, FormSubmission
  schemas/
    api_server.py
    form.py
  routes/
    api_servers.py         # /api/admin/api-servers/*
    forms.py               # /api/admin/forms/* + /api/forms/*
  services/
    api_proxy.py           # Remote API proxy logic (auth, request, response mapping)

frontend/app/
  admin/
    api-servers/
      page.tsx             # API server management
    forms/
      page.tsx             # Form list
      [id]/
        fields/
          page.tsx         # Field builder
        submissions/
          page.tsx         # Submissions table + detail
  forms/
    [slug]/
      page.tsx             # Public form renderer

frontend/components/
  FormFieldEditor.tsx      # Field create/edit modal
  FormFieldRenderer.tsx    # Renders a single field by type
  FormSubmissionTable.tsx  # Generic submissions table
  ApiLoginModal.tsx        # API credential login modal
```

## Migration Strategy

All new tables created via inline SQL in `backend/main.py` using `CREATE TABLE IF NOT EXISTS` (consistent with existing pattern — no Alembic).
