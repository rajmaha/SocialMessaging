"""Parse Swagger/OpenAPI and Postman Collection JSON into endpoint+field definitions."""

import json
import re
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
            if not isinstance(operation, dict):
                continue
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
