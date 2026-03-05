# API Spec Upload & Auto-Generate Form Fields — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upload Swagger/Postman JSON on API Server config page, parse endpoints server-side, and auto-generate form fields in the Form Builder with show/hide toggles and customizable types/validations.

**Architecture:** New `ApiServerEndpoint` model stores parsed endpoints+fields per API server. Backend parses both Swagger and Postman formats. Form Fields page gets an endpoint picker and auto-generate button that creates `FormField` rows with merge support.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic (backend); Next.js, TypeScript, TailwindCSS (frontend)

---

## Task 1: Add `ApiServerEndpoint` Model

**Files:**
- Modify: `backend/app/models/api_server.py:59` (append after UserApiCredential)

**Step 1: Add the model**

Add to `backend/app/models/api_server.py` after line 58:

```python
class ApiServerEndpoint(Base):
    __tablename__ = "api_server_endpoints"

    id = Column(Integer, primary_key=True, index=True)
    api_server_id = Column(Integer, ForeignKey("api_servers.id", ondelete="CASCADE"), nullable=False, index=True)
    path = Column(String, nullable=False)
    method = Column(String, nullable=False)  # GET, POST, PUT, DELETE, PATCH
    summary = Column(String, nullable=True)
    fields = Column(JSON, nullable=True)  # array of {key, label, type, format, required, description, enum, default, location}
    source_type = Column(String, nullable=False, default="swagger")  # swagger, postman
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("api_server_id", "path", "method", name="uq_api_server_endpoint"),
    )
```

**Step 2: Add `spec_file_name` column to `ApiServer`**

In the same file, add to `ApiServer` class after line 40 (`created_at`):

```python
    spec_file_name = Column(String, nullable=True)
```

**Step 3: Add inline migration in `backend/main.py`**

Add before the final `conn.commit()` at the end of `_run_inline_migrations()` (around line 1280):

```python
        # API Server spec upload support
        conn.execute(text("ALTER TABLE api_servers ADD COLUMN IF NOT EXISTS spec_file_name VARCHAR"))
        conn.execute(text("ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE"))
```

Note: `api_server_endpoints` table will be auto-created by `Base.metadata.create_all()` at line 157.

**Step 4: Verify server starts**

Run: `cd backend && source venv/bin/activate && python -c "from app.models.api_server import ApiServerEndpoint; print('OK')"`
Expected: `OK`

**Step 5: Commit**

```bash
git add backend/app/models/api_server.py backend/main.py
git commit -m "feat: add ApiServerEndpoint model and spec_file_name column"
```

---

## Task 2: Add `is_auto_generated` and `is_visible` to `FormField` Model

**Files:**
- Modify: `backend/app/models/form.py:48-50` (add columns after `api_params`)

**Step 1: Add columns to FormField model**

In `backend/app/models/form.py`, add after line 48 (`api_params` column):

```python
    is_auto_generated = Column(Boolean, default=False)
    is_visible = Column(Boolean, default=True)
```

**Step 2: Update FormField schemas**

Modify `backend/app/schemas/form.py`:

In `FormFieldCreate` (around line 55-70), add:
```python
    is_auto_generated: bool = False
    is_visible: bool = True
```

In `FormFieldUpdate` (around line 73-88), add:
```python
    is_auto_generated: Optional[bool] = None
    is_visible: Optional[bool] = None
```

**Step 3: Commit**

```bash
git add backend/app/models/form.py backend/app/schemas/form.py
git commit -m "feat: add is_auto_generated and is_visible columns to FormField"
```

---

## Task 3: Add Pydantic Schemas for Endpoints

**Files:**
- Modify: `backend/app/schemas/api_server.py:86` (append at end)

**Step 1: Add endpoint schemas**

Append to `backend/app/schemas/api_server.py`:

```python

class SpecFieldDef(BaseModel):
    key: str
    label: str
    type: str = "string"
    format: Optional[str] = None
    required: bool = False
    description: Optional[str] = None
    enum: Optional[List[str]] = None
    default: Optional[Any] = None
    location: str = "body"  # body, query, path


class ApiServerEndpointResponse(BaseModel):
    id: int
    api_server_id: int
    path: str
    method: str
    summary: Optional[str] = None
    fields: Optional[List[dict]] = None
    source_type: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SpecUploadResponse(BaseModel):
    message: str
    spec_file_name: str
    endpoints_count: int
    endpoints: List[ApiServerEndpointResponse]


class AutoGenerateFieldsRequest(BaseModel):
    endpoint_id: int
```

**Step 2: Commit**

```bash
git add backend/app/schemas/api_server.py
git commit -m "feat: add Pydantic schemas for API spec endpoints"
```

---

## Task 4: Implement Spec Parser Service

**Files:**
- Create: `backend/app/services/spec_parser.py`

**Step 1: Create the parser service**

Create `backend/app/services/spec_parser.py`:

```python
"""Parse Swagger/OpenAPI and Postman Collection JSON into endpoint+field definitions."""

import json
from typing import List, Dict, Any, Optional


def detect_format(data: dict) -> str:
    """Auto-detect whether the JSON is Swagger/OpenAPI or Postman Collection."""
    if "openapi" in data or "swagger" in data:
        return "swagger"
    if "item" in data and "info" in data:
        return "postman"
    raise ValueError("Unrecognized spec format. Expected OpenAPI/Swagger or Postman Collection JSON.")


def parse_spec(data: dict) -> List[Dict[str, Any]]:
    """Parse a spec file and return a list of endpoint dicts.

    Each endpoint dict has: path, method, summary, fields, source_type
    """
    fmt = detect_format(data)
    if fmt == "swagger":
        return _parse_swagger(data)
    return _parse_postman(data)


# ---------------------------------------------------------------------------
# Swagger / OpenAPI 3.x / 2.x
# ---------------------------------------------------------------------------

def _parse_swagger(data: dict) -> List[Dict[str, Any]]:
    endpoints = []
    paths = data.get("paths", {})
    is_v3 = "openapi" in data  # OpenAPI 3.x vs Swagger 2.x

    for path, methods in paths.items():
        for method, operation in methods.items():
            if method.lower() in ("parameters", "summary", "description", "servers"):
                continue  # skip path-level keys
            method_upper = method.upper()
            summary = operation.get("summary", "") or operation.get("description", "")
            fields = []

            # Parameters (query, path, header)
            for param in operation.get("parameters", []):
                param = _resolve_ref(param, data)
                schema = param.get("schema", {})
                schema = _resolve_ref(schema, data)
                fields.append({
                    "key": param.get("name", ""),
                    "label": _key_to_label(param.get("name", "")),
                    "type": schema.get("type", "string"),
                    "format": schema.get("format"),
                    "required": param.get("required", False),
                    "description": param.get("description", ""),
                    "enum": schema.get("enum"),
                    "default": schema.get("default"),
                    "location": param.get("in", "query"),
                })

            # Request body (OpenAPI 3.x)
            if is_v3:
                req_body = operation.get("requestBody", {})
                req_body = _resolve_ref(req_body, data)
                content = req_body.get("content", {})
                json_schema = content.get("application/json", {}).get("schema", {})
                json_schema = _resolve_ref(json_schema, data)
                fields.extend(_extract_schema_fields(json_schema, data))
            else:
                # Swagger 2.x body parameter
                for param in operation.get("parameters", []):
                    param = _resolve_ref(param, data)
                    if param.get("in") == "body":
                        schema = _resolve_ref(param.get("schema", {}), data)
                        fields.extend(_extract_schema_fields(schema, data))

            endpoints.append({
                "path": path,
                "method": method_upper,
                "summary": summary[:500] if summary else None,
                "fields": fields,
                "source_type": "swagger",
            })

    return endpoints


def _extract_schema_fields(schema: dict, root: dict, prefix: str = "") -> List[Dict[str, Any]]:
    """Recursively extract fields from a JSON Schema object."""
    schema = _resolve_ref(schema, root)
    fields = []
    required_keys = set(schema.get("required", []))

    if schema.get("type") == "object" or "properties" in schema:
        for prop_name, prop_schema in schema.get("properties", {}).items():
            prop_schema = _resolve_ref(prop_schema, root)
            key = f"{prefix}{prop_name}" if not prefix else f"{prefix}.{prop_name}"

            if prop_schema.get("type") == "object" and "properties" in prop_schema:
                # Nested object — flatten with dot notation
                fields.extend(_extract_schema_fields(prop_schema, root, prefix=f"{key}."))
            elif prop_schema.get("type") == "array":
                # Array — note it but don't deeply recurse (arrays are complex for forms)
                fields.append({
                    "key": key,
                    "label": _key_to_label(prop_name),
                    "type": "array",
                    "format": None,
                    "required": prop_name in required_keys,
                    "description": prop_schema.get("description", ""),
                    "enum": None,
                    "default": prop_schema.get("default"),
                    "location": "body",
                })
            else:
                fields.append({
                    "key": key,
                    "label": _key_to_label(prop_name),
                    "type": prop_schema.get("type", "string"),
                    "format": prop_schema.get("format"),
                    "required": prop_name in required_keys,
                    "description": prop_schema.get("description", ""),
                    "enum": prop_schema.get("enum"),
                    "default": prop_schema.get("default"),
                    "location": "body",
                })

    return fields


def _resolve_ref(obj: dict, root: dict) -> dict:
    """Resolve a $ref pointer to its definition."""
    if not isinstance(obj, dict) or "$ref" not in obj:
        return obj
    ref_path = obj["$ref"]  # e.g. "#/components/schemas/User"
    parts = ref_path.lstrip("#/").split("/")
    result = root
    for part in parts:
        result = result.get(part, {})
    return _resolve_ref(result, root) if isinstance(result, dict) and "$ref" in result else result


# ---------------------------------------------------------------------------
# Postman Collection v2.1
# ---------------------------------------------------------------------------

def _parse_postman(data: dict) -> List[Dict[str, Any]]:
    endpoints = []
    _parse_postman_items(data.get("item", []), endpoints)
    return endpoints


def _parse_postman_items(items: list, endpoints: list):
    """Recursively parse Postman items (folders and requests)."""
    for item in items:
        if "item" in item:
            # This is a folder — recurse
            _parse_postman_items(item["item"], endpoints)
        elif "request" in item:
            req = item["request"]
            if isinstance(req, str):
                continue  # skip simple URL strings

            method = req.get("method", "GET").upper()
            url = req.get("url", {})
            if isinstance(url, str):
                path = url
            else:
                raw = url.get("raw", "")
                # Extract path from URL parts
                path_parts = url.get("path", [])
                path = "/" + "/".join(path_parts) if path_parts else raw

            # Replace Postman variables like {{base_url}}
            # Extract just the path portion
            if "://" in path:
                from urllib.parse import urlparse
                parsed = urlparse(path)
                path = parsed.path or "/"

            summary = item.get("name", "")
            fields = []

            # Parse body fields
            body = req.get("body", {})
            if body and body.get("mode") == "raw":
                raw_body = body.get("raw", "")
                try:
                    body_json = json.loads(raw_body)
                    if isinstance(body_json, dict):
                        for key, value in body_json.items():
                            fields.append({
                                "key": key,
                                "label": _key_to_label(key),
                                "type": _infer_type_from_value(value),
                                "format": None,
                                "required": False,  # Postman doesn't indicate required
                                "description": "",
                                "enum": None,
                                "default": value if not isinstance(value, (dict, list)) else None,
                                "location": "body",
                            })
                except (json.JSONDecodeError, TypeError):
                    pass  # Skip non-JSON bodies

            elif body and body.get("mode") == "urlencoded":
                for param in body.get("urlencoded", []):
                    fields.append({
                        "key": param.get("key", ""),
                        "label": _key_to_label(param.get("key", "")),
                        "type": "string",
                        "format": None,
                        "required": False,
                        "description": param.get("description", ""),
                        "enum": None,
                        "default": param.get("value"),
                        "location": "body",
                    })

            elif body and body.get("mode") == "formdata":
                for param in body.get("formdata", []):
                    fields.append({
                        "key": param.get("key", ""),
                        "label": _key_to_label(param.get("key", "")),
                        "type": "file" if param.get("type") == "file" else "string",
                        "format": None,
                        "required": False,
                        "description": param.get("description", ""),
                        "enum": None,
                        "default": param.get("value"),
                        "location": "body",
                    })

            # Parse query params
            if isinstance(url, dict):
                for qp in url.get("query", []):
                    fields.append({
                        "key": qp.get("key", ""),
                        "label": _key_to_label(qp.get("key", "")),
                        "type": "string",
                        "format": None,
                        "required": False,
                        "description": qp.get("description", ""),
                        "enum": None,
                        "default": qp.get("value"),
                        "location": "query",
                    })

            endpoints.append({
                "path": path,
                "method": method,
                "summary": summary[:500] if summary else None,
                "fields": fields,
                "source_type": "postman",
            })


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _key_to_label(key: str) -> str:
    """Convert snake_case or camelCase key to a human-readable label."""
    import re
    # Insert space before uppercase letters (camelCase)
    label = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', key)
    # Replace underscores and hyphens with spaces
    label = label.replace('_', ' ').replace('-', ' ')
    return label.strip().title()


def _infer_type_from_value(value: Any) -> str:
    """Infer JSON schema type from a sample value (for Postman bodies)."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "string"
```

**Step 2: Verify import works**

Run: `cd backend && source venv/bin/activate && python -c "from app.services.spec_parser import parse_spec; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/app/services/spec_parser.py
git commit -m "feat: add spec parser service for Swagger and Postman formats"
```

---

## Task 5: Add Backend Routes for Spec Upload & Endpoints

**Files:**
- Modify: `backend/app/routes/api_servers.py` (add routes after existing admin routes)

**Step 1: Add import for UploadFile and new models/schemas**

At the top of `backend/app/routes/api_servers.py`, add to imports:

```python
from fastapi import UploadFile, File
from app.models.api_server import ApiServerEndpoint
from app.schemas.api_server import ApiServerEndpointResponse, SpecUploadResponse
from app.services.spec_parser import parse_spec
import json
```

**Step 2: Add spec upload route**

Add after the `update_server_access` route (after line ~242):

```python
@router.post("/admin/api-servers/{server_id}/spec")
async def upload_spec(
    server_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_feature("feature_manage_forms")),
):
    """Upload and parse a Swagger/OpenAPI or Postman Collection JSON file."""
    server = db.query(ApiServer).filter(ApiServer.id == server_id).first()
    if not server:
        raise HTTPException(404, "API Server not found")

    try:
        content = await file.read()
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON file")

    try:
        parsed_endpoints = parse_spec(data)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not parsed_endpoints:
        raise HTTPException(400, "No endpoints found in the spec file")

    # Upsert endpoints
    created_or_updated = []
    for ep in parsed_endpoints:
        existing = db.query(ApiServerEndpoint).filter(
            ApiServerEndpoint.api_server_id == server_id,
            ApiServerEndpoint.path == ep["path"],
            ApiServerEndpoint.method == ep["method"],
        ).first()

        if existing:
            existing.summary = ep["summary"]
            existing.fields = ep["fields"]
            existing.source_type = ep["source_type"]
            created_or_updated.append(existing)
        else:
            new_ep = ApiServerEndpoint(
                api_server_id=server_id,
                path=ep["path"],
                method=ep["method"],
                summary=ep["summary"],
                fields=ep["fields"],
                source_type=ep["source_type"],
            )
            db.add(new_ep)
            created_or_updated.append(new_ep)

    server.spec_file_name = file.filename
    db.commit()

    # Refresh to get IDs
    for ep in created_or_updated:
        db.refresh(ep)

    return {
        "message": f"Parsed {len(created_or_updated)} endpoints from {file.filename}",
        "spec_file_name": file.filename,
        "endpoints_count": len(created_or_updated),
        "endpoints": [
            {
                "id": ep.id,
                "api_server_id": ep.api_server_id,
                "path": ep.path,
                "method": ep.method,
                "summary": ep.summary,
                "fields": ep.fields,
                "source_type": ep.source_type,
                "created_at": ep.created_at.isoformat() if ep.created_at else None,
            }
            for ep in created_or_updated
        ],
    }


@router.get("/admin/api-servers/{server_id}/endpoints")
async def list_endpoints(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_feature("feature_manage_forms")),
):
    """List all parsed endpoints for an API server."""
    endpoints = (
        db.query(ApiServerEndpoint)
        .filter(ApiServerEndpoint.api_server_id == server_id)
        .order_by(ApiServerEndpoint.path, ApiServerEndpoint.method)
        .all()
    )
    return [
        {
            "id": ep.id,
            "api_server_id": ep.api_server_id,
            "path": ep.path,
            "method": ep.method,
            "summary": ep.summary,
            "fields": ep.fields,
            "source_type": ep.source_type,
            "created_at": ep.created_at.isoformat() if ep.created_at else None,
            "field_count": len(ep.fields) if ep.fields else 0,
        }
        for ep in endpoints
    ]


@router.get("/admin/api-servers/{server_id}/endpoints/{endpoint_id}")
async def get_endpoint(
    server_id: int,
    endpoint_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_feature("feature_manage_forms")),
):
    """Get a single endpoint with its field definitions."""
    ep = db.query(ApiServerEndpoint).filter(
        ApiServerEndpoint.id == endpoint_id,
        ApiServerEndpoint.api_server_id == server_id,
    ).first()
    if not ep:
        raise HTTPException(404, "Endpoint not found")
    return {
        "id": ep.id,
        "api_server_id": ep.api_server_id,
        "path": ep.path,
        "method": ep.method,
        "summary": ep.summary,
        "fields": ep.fields,
        "source_type": ep.source_type,
        "created_at": ep.created_at.isoformat() if ep.created_at else None,
    }


@router.delete("/admin/api-servers/{server_id}/endpoints/{endpoint_id}")
async def delete_endpoint(
    server_id: int,
    endpoint_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_feature("feature_manage_forms")),
):
    """Delete a parsed endpoint."""
    ep = db.query(ApiServerEndpoint).filter(
        ApiServerEndpoint.id == endpoint_id,
        ApiServerEndpoint.api_server_id == server_id,
    ).first()
    if not ep:
        raise HTTPException(404, "Endpoint not found")
    db.delete(ep)
    db.commit()
    return {"message": "Endpoint deleted"}
```

**Step 3: Commit**

```bash
git add backend/app/routes/api_servers.py
git commit -m "feat: add spec upload and endpoint CRUD routes"
```

---

## Task 6: Add Auto-Generate Fields Route to Forms

**Files:**
- Modify: `backend/app/routes/forms.py` (add route after field CRUD routes)

**Step 1: Add imports at top of forms.py**

```python
from app.models.api_server import ApiServerEndpoint
```

**Step 2: Add auto-generate route**

Add after the `reorder_fields` route (after line ~208):

```python
# Field type mapping from spec types to form field types
SPEC_TYPE_MAP = {
    ("string", None): "text",
    ("string", "email"): "email",
    ("string", "uri"): "url",
    ("string", "url"): "url",
    ("string", "date"): "date",
    ("string", "date-time"): "date",
    ("string", "time"): "time",
    ("integer", None): "number",
    ("number", None): "number",
    ("boolean", None): "yes_no",
}


@admin_router.post("/admin/forms/{form_id}/fields/auto-generate")
async def auto_generate_fields(
    form_id: int,
    data: dict,  # {"endpoint_id": int}
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_feature("feature_manage_forms")),
):
    """Auto-generate form fields from a parsed API endpoint's field definitions."""
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(404, "Form not found")

    endpoint_id = data.get("endpoint_id")
    if not endpoint_id:
        raise HTTPException(400, "endpoint_id is required")

    endpoint = db.query(ApiServerEndpoint).filter(
        ApiServerEndpoint.id == endpoint_id,
    ).first()
    if not endpoint:
        raise HTTPException(404, "Endpoint not found")

    if not endpoint.fields:
        raise HTTPException(400, "Endpoint has no fields to generate")

    # Get existing field keys for this form (for merge)
    existing_fields = db.query(FormField).filter(FormField.form_id == form_id).all()
    existing_keys = {f.field_key: f for f in existing_fields}
    max_order = max((f.display_order for f in existing_fields), default=-1)

    created = []
    skipped = []

    for spec_field in endpoint.fields:
        key = spec_field.get("key", "")
        if not key:
            continue

        if key in existing_keys:
            # Merge: field already exists — skip (preserve customizations)
            skipped.append(key)
            continue

        # Determine form field type
        spec_type = spec_field.get("type", "string")
        spec_format = spec_field.get("format")
        is_required = spec_field.get("required", False)

        # Check for enum → dropdown
        if spec_field.get("enum"):
            field_type = "dropdown"
        else:
            field_type = SPEC_TYPE_MAP.get((spec_type, spec_format))
            if not field_type:
                field_type = SPEC_TYPE_MAP.get((spec_type, None), "text")

        # Build options for enum/dropdown
        options = None
        if spec_field.get("enum"):
            options = [{"key": v, "value": v} for v in spec_field["enum"]]

        max_order += 1
        new_field = FormField(
            form_id=form_id,
            field_label=spec_field.get("label", key),
            field_key=key,
            field_type=field_type,
            placeholder=spec_field.get("description", ""),
            is_required=is_required,
            display_order=max_order,
            default_value=str(spec_field["default"]) if spec_field.get("default") is not None else None,
            options=options,
            is_auto_generated=True,
            is_visible=is_required,  # required=visible, optional=hidden
        )
        db.add(new_field)
        created.append(key)

    db.commit()

    return {
        "message": f"Generated {len(created)} fields, skipped {len(skipped)} existing",
        "created_fields": created,
        "skipped_fields": skipped,
    }
```

**Step 3: Commit**

```bash
git add backend/app/routes/forms.py
git commit -m "feat: add auto-generate fields route with type mapping and merge"
```

---

## Task 7: Add Frontend API Client Methods

**Files:**
- Modify: `frontend/lib/api.ts:192-203` (extend `apiServersApi`)
- Modify: `frontend/lib/api.ts:214-236` (extend `formsApi`)

**Step 1: Add spec and endpoint methods to apiServersApi**

In `frontend/lib/api.ts`, add to `apiServersApi` object before the closing `}` (line 203):

```typescript
  uploadSpec: (id: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/admin/api-servers/${id}/spec`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listEndpoints: (id: number) => api.get(`/admin/api-servers/${id}/endpoints`),
  getEndpoint: (id: number, endpointId: number) => api.get(`/admin/api-servers/${id}/endpoints/${endpointId}`),
  deleteEndpoint: (id: number, endpointId: number) => api.delete(`/admin/api-servers/${id}/endpoints/${endpointId}`),
```

**Step 2: Add auto-generate method to formsApi**

In `frontend/lib/api.ts`, add to `formsApi` object after `reorderFields` (line 225):

```typescript
  autoGenerateFields: (formId: number, endpointId: number) => api.post(`/admin/forms/${formId}/fields/auto-generate`, { endpoint_id: endpointId }),
```

**Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add API client methods for spec upload and auto-generate"
```

---

## Task 8: Add Spec Upload UI to API Server Config Page

**Files:**
- Modify: `frontend/app/admin/api-servers/page.tsx`

**Step 1: Add state variables**

Add to the component state (around line 42-68):

```typescript
const [endpoints, setEndpoints] = useState<any[]>([]);
const [uploadingSpec, setUploadingSpec] = useState(false);
const [specMessage, setSpecMessage] = useState('');
const [expandedEndpointServer, setExpandedEndpointServer] = useState<number | null>(null);
```

**Step 2: Add upload handler function**

Add after existing handler functions:

```typescript
const handleSpecUpload = async (serverId: number, file: File) => {
  setUploadingSpec(true);
  setSpecMessage('');
  try {
    const res = await apiServersApi.uploadSpec(serverId, file);
    setSpecMessage(res.data.message);
    loadEndpoints(serverId);
  } catch (err: any) {
    setSpecMessage(err.response?.data?.detail || 'Upload failed');
  } finally {
    setUploadingSpec(false);
  }
};

const loadEndpoints = async (serverId: number) => {
  try {
    const res = await apiServersApi.listEndpoints(serverId);
    setEndpoints(res.data);
  } catch {
    setEndpoints([]);
  }
};

const handleDeleteEndpoint = async (serverId: number, endpointId: number) => {
  if (!confirm('Delete this endpoint?')) return;
  await apiServersApi.deleteEndpoint(serverId, endpointId);
  loadEndpoints(serverId);
};

const toggleEndpointList = (serverId: number) => {
  if (expandedEndpointServer === serverId) {
    setExpandedEndpointServer(null);
    setEndpoints([]);
  } else {
    setExpandedEndpointServer(serverId);
    loadEndpoints(serverId);
  }
};
```

**Step 3: Add upload UI and endpoint list in the server card**

In the JSX where each server card is rendered, add an expandable section for endpoints. Look for the expandable section pattern (expandedId) and add a new section below each server card:

```tsx
{/* Spec Upload & Endpoints Section */}
<div className="mt-3 border-t pt-3">
  <div className="flex items-center gap-3 mb-2">
    <label className="cursor-pointer bg-purple-50 hover:bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg text-sm font-medium transition">
      {uploadingSpec ? 'Uploading...' : '📄 Upload API Spec'}
      <input
        type="file"
        accept=".json"
        className="hidden"
        disabled={uploadingSpec}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleSpecUpload(server.id, file);
          e.target.value = '';
        }}
      />
    </label>
    {server.spec_file_name && (
      <span className="text-xs text-gray-500">
        Spec: {server.spec_file_name}
      </span>
    )}
    <button
      onClick={() => toggleEndpointList(server.id)}
      className="text-sm text-blue-600 hover:text-blue-800"
    >
      {expandedEndpointServer === server.id ? 'Hide' : 'Show'} Endpoints
    </button>
  </div>

  {specMessage && (
    <p className="text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded mb-2">{specMessage}</p>
  )}

  {expandedEndpointServer === server.id && (
    <div className="space-y-1.5 mt-2">
      {endpoints.length === 0 ? (
        <p className="text-sm text-gray-400">No endpoints parsed yet. Upload a Swagger or Postman JSON file.</p>
      ) : (
        endpoints.map((ep: any) => {
          const methodColors: Record<string, string> = {
            GET: 'bg-green-100 text-green-700',
            POST: 'bg-blue-100 text-blue-700',
            PUT: 'bg-yellow-100 text-yellow-800',
            PATCH: 'bg-orange-100 text-orange-700',
            DELETE: 'bg-red-100 text-red-700',
          };
          return (
            <div key={ep.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${methodColors[ep.method] || 'bg-gray-100 text-gray-600'}`}>
                  {ep.method}
                </span>
                <span className="text-sm font-mono">{ep.path}</span>
                {ep.summary && <span className="text-xs text-gray-500">— {ep.summary}</span>}
                <span className="text-xs bg-gray-200 text-gray-600 rounded-full px-2 py-0.5">
                  {ep.field_count || ep.fields?.length || 0} fields
                </span>
              </div>
              <button
                onClick={() => handleDeleteEndpoint(server.id, ep.id)}
                className="text-red-400 hover:text-red-600 text-sm"
              >
                ✕
              </button>
            </div>
          );
        })
      )}
    </div>
  )}
</div>
```

**Step 4: Commit**

```bash
git add frontend/app/admin/api-servers/page.tsx
git commit -m "feat: add spec upload UI and endpoint list to API server page"
```

---

## Task 9: Add Auto-Generate UI to Form Fields Page

**Files:**
- Modify: `frontend/app/admin/forms/[id]/fields/page.tsx`

**Step 1: Add state and imports**

Add to imports:
```typescript
import { apiServersApi } from '@/lib/api';
```

Add to component state (around line 69-79):

```typescript
const [apiEndpoints, setApiEndpoints] = useState<any[]>([]);
const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
const [autoGenerating, setAutoGenerating] = useState(false);
const [autoGenMessage, setAutoGenMessage] = useState('');
const [formApiServerId, setFormApiServerId] = useState<number | null>(null);
```

**Step 2: Load endpoints when form has an API server**

In the existing `loadForm()` function, after fetching the form data, add:

```typescript
if (formData.api_server_id) {
  setFormApiServerId(formData.api_server_id);
  try {
    const epRes = await apiServersApi.listEndpoints(formData.api_server_id);
    setApiEndpoints(epRes.data);
  } catch {
    setApiEndpoints([]);
  }
}
```

**Step 3: Add auto-generate handler**

```typescript
const handleAutoGenerate = async () => {
  if (!selectedEndpointId) return;
  setAutoGenerating(true);
  setAutoGenMessage('');
  try {
    const res = await formsApi.autoGenerateFields(Number(params.id), selectedEndpointId);
    setAutoGenMessage(res.data.message);
    loadFields(); // Reload fields list
  } catch (err: any) {
    setAutoGenMessage(err.response?.data?.detail || 'Auto-generate failed');
  } finally {
    setAutoGenerating(false);
  }
};
```

**Step 4: Add toggle visibility handler**

```typescript
const handleToggleVisibility = async (field: any) => {
  try {
    await formsApi.updateField(Number(params.id), field.id, {
      is_visible: !field.is_visible,
    });
    loadFields();
  } catch (err: any) {
    console.error('Failed to toggle visibility', err);
  }
};
```

**Step 5: Add endpoint picker and auto-generate button in JSX**

Add above the existing field list, after the form title section:

```tsx
{/* Auto-Generate from API Spec */}
{apiEndpoints.length > 0 && (
  <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4">
    <h3 className="text-sm font-semibold text-purple-800 mb-2">Auto-Generate Fields from API Spec</h3>
    <div className="flex items-center gap-3">
      <select
        value={selectedEndpointId || ''}
        onChange={(e) => setSelectedEndpointId(Number(e.target.value) || null)}
        className="flex-1 border rounded-lg px-3 py-2 text-sm"
      >
        <option value="">Select an endpoint...</option>
        {apiEndpoints.map((ep: any) => (
          <option key={ep.id} value={ep.id}>
            {ep.method} {ep.path} {ep.summary ? `— ${ep.summary}` : ''} ({ep.field_count || 0} fields)
          </option>
        ))}
      </select>
      <button
        onClick={handleAutoGenerate}
        disabled={!selectedEndpointId || autoGenerating}
        className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
      >
        {autoGenerating ? 'Generating...' : 'Auto Generate Fields'}
      </button>
    </div>
    {autoGenMessage && (
      <p className="mt-2 text-sm text-purple-700 bg-purple-100 px-3 py-1.5 rounded">{autoGenMessage}</p>
    )}
  </div>
)}
```

**Step 6: Update field list rendering to show visibility toggle and auto badge**

In the field list rendering, update each field row to include:

```tsx
{/* Add visibility toggle and auto badge to each field row */}
<div className={`flex items-center gap-2 ${!field.is_visible && field.is_auto_generated ? 'opacity-50' : ''}`}>
  {/* Visibility toggle — only for auto-generated fields */}
  {field.is_auto_generated && (
    <button
      onClick={() => handleToggleVisibility(field)}
      className={`p-1 rounded ${field.is_visible ? 'text-blue-600' : 'text-gray-400'}`}
      title={field.is_visible ? 'Visible — click to hide' : 'Hidden — click to show'}
    >
      {field.is_visible ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
      )}
    </button>
  )}

  {/* Auto badge */}
  {field.is_auto_generated && (
    <span className="text-[10px] bg-purple-100 text-purple-600 rounded px-1.5 py-0.5 font-medium">AUTO</span>
  )}
</div>
```

**Step 7: Commit**

```bash
git add frontend/app/admin/forms/\[id\]/fields/page.tsx
git commit -m "feat: add auto-generate fields UI with endpoint picker and visibility toggles"
```

---

## Task 10: Update `spec_file_name` in API Server Response

**Files:**
- Modify: `backend/app/schemas/api_server.py` — add `spec_file_name` to `ApiServerCreate` and `ApiServerResponse`

**Step 1: Add spec_file_name to schemas**

In `ApiServerCreate` add:
```python
    spec_file_name: Optional[str] = None
```

This will make it flow through to `ApiServerResponse` automatically since it inherits from `ApiServerCreate`.

**Step 2: Commit**

```bash
git add backend/app/schemas/api_server.py
git commit -m "feat: include spec_file_name in API server response schema"
```

---

## Task 11: End-to-End Manual Testing

**Step 1: Start the application**

Run: `./start.sh`

**Step 2: Test spec upload via Swagger UI**

1. Open http://localhost:8000/docs
2. Find `POST /admin/api-servers/{server_id}/spec`
3. Upload a sample Swagger JSON file
4. Verify response contains parsed endpoints with fields

**Step 3: Test endpoints listing**

1. `GET /admin/api-servers/{server_id}/endpoints`
2. Verify endpoints are returned with field counts

**Step 4: Test auto-generate fields**

1. Create a form linked to the API server
2. `POST /admin/forms/{form_id}/fields/auto-generate` with `{"endpoint_id": <id>}`
3. Verify fields are created with correct types, required fields visible, optional hidden

**Step 5: Test frontend**

1. Open http://localhost:3000/admin/api-servers
2. Upload a spec file on a server card
3. Verify endpoints appear in expandable list
4. Open a form's fields page linked to that server
5. Verify endpoint dropdown, auto-generate button, visibility toggles work

**Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
