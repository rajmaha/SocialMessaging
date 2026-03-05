# API Spec Upload & Auto-Generate Form Fields

**Date**: 2026-03-05
**Status**: Approved

## Summary

Upload Swagger/OpenAPI or Postman Collection JSON on the API Server config page. Parse endpoints and their fields server-side. In the Form Builder, select an endpoint and auto-generate form fields with show/hide toggles, customizable types, and validations. Re-uploads merge without losing customizations.

## Data Model

### New Model: `ApiServerEndpoint`

| Column | Type | Purpose |
|---|---|---|
| id | Integer PK | |
| api_server_id | FK → ApiServer | Parent server |
| path | String | e.g. `/users`, `/orders/{id}` |
| method | String | GET, POST, PUT, DELETE |
| summary | String(nullable) | Description from spec |
| fields | JSON | Array of parsed field definitions |
| source_type | String | `swagger` or `postman` |
| created_at | DateTime | |

**Unique constraint**: `(api_server_id, path, method)`

Each entry in `fields` JSON:
```json
{
  "key": "email",
  "label": "Email",
  "type": "string",
  "format": "email",
  "required": true,
  "description": "User email address",
  "enum": null,
  "default": null,
  "location": "body"
}
```

### New Column on `ApiServer`
- `spec_file_name` (String, nullable) — original uploaded filename

### New Columns on `FormField`
- `is_auto_generated` (Boolean, default false)
- `is_visible` (Boolean, default true)

## Upload & Parsing Flow

1. Admin opens API Server config → clicks "Upload API Spec"
2. Selects `.json` file (Swagger or Postman)
3. `POST /admin/api-servers/{id}/spec` — backend auto-detects format:
   - **Swagger**: has `openapi` or `swagger` key → iterates `paths`, extracts `requestBody` schemas + `parameters`
   - **Postman**: has `item` array → recursively extracts URL path, method, and `body.raw` JSON fields
4. Creates/updates `ApiServerEndpoint` rows (upsert by path+method)
5. Returns parsed endpoint summary

### Re-upload Merge Logic
- Match by `path` + `method`
- Update `fields` JSON on existing endpoints
- Add new endpoints
- Leave removed endpoints intact (admin deletes manually)

## Form Builder — Auto Generate Fields

### Flow
1. Form linked to API server with uploaded spec → **"Select Endpoint" dropdown** appears
2. Admin selects endpoint → **"Auto Generate Fields" button** appears
3. Click generates `FormField` rows:

### Type Mapping (extensible)

| Spec Type/Format | Form Field Type |
|---|---|
| `string` | `text` |
| `string` + `email` | `email` |
| `string` + `uri`/`url` | `url` |
| `string` + `date` | `date` |
| `string` + `date-time` | `date` |
| `string` + `enum` | `dropdown` |
| `integer` / `number` | `number` |
| `boolean` | `yes_no` |

### Visibility Defaults
- **Required** fields in spec → `is_visible: true`, `is_required: true`
- **Optional** fields → `is_visible: false`, `is_required: false`
- All auto-generated fields get `is_auto_generated: true`

### Admin Customization
- Toggle show/hide per field
- Change field type
- Set validations (min/max length, regex, min/max value)
- Edit label, placeholder, default value
- Reorder fields
- Add manual fields alongside auto-generated ones

### Re-generate Merge (Form Fields)
- Match existing fields by `field_key`
- **Existing**: keep all customizations (type, validations, label, visibility)
- **New** from spec: added as hidden + optional
- **Removed** from spec: left as-is

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/admin/api-servers/{id}/spec` | Upload & parse spec file |
| GET | `/admin/api-servers/{id}/endpoints` | List parsed endpoints |
| GET | `/admin/api-servers/{id}/endpoints/{eid}` | Get endpoint with fields |
| DELETE | `/admin/api-servers/{id}/endpoints/{eid}` | Remove an endpoint |
| POST | `/admin/forms/{fid}/fields/auto-generate` | Generate form fields from endpoint |

## UI Changes

### API Server Config Page
- Upload button in server detail section
- Expandable endpoints list with method badges (GET=green, POST=blue, PUT=yellow, DELETE=red)
- Field count per endpoint
- Re-upload button

### Form Fields Page
- Endpoint dropdown (when form linked to API server with spec)
- "Auto Generate Fields" button
- Visibility toggle (eye icon/switch) on each field
- "Auto" badge on auto-generated fields
- Hidden fields rendered with reduced opacity
