import httpx
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.models.api_server import ApiServer, UserApiCredential


def _resolve_json_path(data: Any, path: str) -> Any:
    """Extract a value from nested JSON using dot notation, e.g. 'data.token'"""
    parts = path.split(".")
    current = data
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _build_headers(server: ApiServer, token: Optional[str] = None) -> Dict[str, str]:
    """Build request headers for a given API server."""
    headers = {}
    if server.api_key_header and server.api_key_value:
        headers[server.api_key_header] = server.api_key_value
    if token and server.token_header:
        headers[server.token_header] = token
    return headers


def _parse_method_string(method_string: str):
    """Parse 'POST /api/records' into ('POST', '/api/records')"""
    parts = method_string.strip().split(" ", 1)
    if len(parts) == 2:
        return parts[0].upper(), parts[1]
    return "GET", parts[0]


def _check_body_success(server: ApiServer, body: Any) -> tuple[bool, str]:
    """
    Check if response body indicates success using the server's configured paths.
    Returns (is_success, error_message).

    Supports different API patterns:
      {"status": true, "message": "...", "data": {...}}
      {"success": true, "message": "...", "data": {...}}
      {"status": false, "message": "Error description"}
    """
    if not isinstance(body, dict):
        return True, ""  # Can't check non-dict bodies, assume OK

    success_path = server.response_success_path
    message_path = server.response_message_path or "message"

    if not success_path:
        # No success indicator configured — fall back to checking common patterns
        # Check "status" and "success" fields if present
        for key in ("status", "success"):
            val = body.get(key)
            if val is False or val == "false" or val == 0:
                msg = _resolve_json_path(body, message_path) or "Request failed"
                return False, str(msg)
        return True, ""

    # Use the configured path
    success_val = _resolve_json_path(body, success_path)
    if success_val is None:
        return True, ""  # Field not present, assume OK

    # Evaluate truthiness — handle bool, int, string
    is_success = success_val in (True, 1, "1", "true", "True")
    if not is_success:
        msg = _resolve_json_path(body, message_path) or "Request failed"
        return False, str(msg)

    return True, ""


def _extract_data(server: ApiServer, body: Any) -> Any:
    """Extract the data payload from a response body using configured path."""
    if not isinstance(body, dict):
        return body
    data_path = server.response_data_path
    if data_path:
        extracted = _resolve_json_path(body, data_path)
        if extracted is not None:
            return extracted
    return body


async def api_login(
    db: Session,
    server: ApiServer,
    credential: UserApiCredential,
) -> str:
    """Authenticate with the remote API and cache the token."""
    url = f"{server.base_url.rstrip('/')}{server.login_endpoint}"

    login_body = {
        server.login_username_field: credential.username,
        server.login_password_field: credential.password,
    }

    if server.request_content_type in ("formdata", "form"):
        request_kwargs = {"data": login_body}
    else:
        request_kwargs = {"json": login_body}

    headers = _build_headers(server)

    import logging
    logger = logging.getLogger(__name__)
    logger.info(
        f"api_login: POST {url} content_type={server.request_content_type} "
        f"fields=[{server.login_username_field}, {server.login_password_field}] "
        f"username={credential.username!r} password_set={bool(credential.password)}"
    )

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, **request_kwargs)

        if resp.status_code >= 400:
            # Try to extract message from body
            try:
                err_body = resp.json()
                msg = _resolve_json_path(err_body, server.response_message_path or "message") or "Login failed"
            except Exception:
                msg = f"Login failed with HTTP {resp.status_code}"
            raise HTTPException(status_code=resp.status_code, detail={
                "remote_error": True, "message": str(msg), "status": resp.status_code
            })

        body = resp.json()

    # Check body-level success indicator (e.g. {"status": false, "message": "..."})
    is_success, err_msg = _check_body_success(server, body)
    if not is_success:
        raise HTTPException(status_code=401, detail={
            "remote_error": True, "message": err_msg, "status": 401
        })

    token_path = (server.token_response_path or "data.token").strip()
    token = _resolve_json_path(body, token_path)
    if not token:
        available_keys = list(body.keys()) if isinstance(body, dict) else []
        raise ValueError(
            f"Could not extract token from response using path '{token_path}'. "
            f"Available top-level keys: {available_keys}"
        )

    credential.token = token
    credential.is_active = True

    # Preserve fields from login response as configured on the server
    if server.preserved_fields:
        # Resolve against the data portion (using response_data_path) so admin
        # can write just "id" / "full_name" instead of "data.id" / "data.full_name"
        data_section = _extract_data(server, body)
        preserved = {}
        for pf in server.preserved_fields:
            key = pf.get("key")
            path = pf.get("path")
            if key and path:
                # Try from extracted data first, fall back to full body
                val = _resolve_json_path(data_section, path) if isinstance(data_section, dict) else None
                if val is None:
                    val = _resolve_json_path(body, path)
                preserved[key] = val
        credential.login_response_data = preserved
    else:
        credential.login_response_data = None

    db.commit()

    return token


async def api_request(
    db: Session,
    server: ApiServer,
    credential: UserApiCredential,
    method_string: str,
    path_params: Optional[Dict[str, str]] = None,
    body: Optional[Dict[str, Any]] = None,
    query_params: Optional[Dict[str, Any]] = None,
) -> Any:
    """
    Make an authenticated request to the remote API.
    If token is missing or expired, attempts re-login automatically.
    """
    method, path = _parse_method_string(method_string)

    # Replace path parameters like {id}
    if path_params:
        for key, val in path_params.items():
            path = path.replace(f"{{{key}}}", str(val))

    url = f"{server.base_url.rstrip('/')}{path}"

    # Try with existing token first
    token = credential.token
    if not token:
        token = await api_login(db, server, credential)

    headers = _build_headers(server, token)

    request_kwargs: Dict[str, Any] = {}
    if body:
        if server.request_content_type in ("formdata", "form"):
            request_kwargs["data"] = body
        else:
            request_kwargs["json"] = body
    if query_params:
        request_kwargs["params"] = query_params

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(method, url, headers=headers, **request_kwargs)

        # If 401, try re-login and retry once
        if resp.status_code == 401:
            token = await api_login(db, server, credential)
            headers = _build_headers(server, token)
            resp = await client.request(method, url, headers=headers, **request_kwargs)

        # Extract response body for both success and error cases
        response_body = None
        if resp.headers.get("content-type", "").startswith("application/json"):
            try:
                response_body = resp.json()
            except Exception:
                response_body = None

        # HTTP-level error (4xx/5xx)
        if resp.status_code >= 400:
            detail = "Remote API request failed"
            if isinstance(response_body, dict):
                msg_path = server.response_message_path or "message"
                detail = (
                    _resolve_json_path(response_body, msg_path)
                    or response_body.get("error")
                    or response_body.get("detail")
                    or str(response_body)
                )
            elif isinstance(response_body, str):
                detail = response_body
            raise HTTPException(
                status_code=resp.status_code,
                detail={"remote_error": True, "message": str(detail), "status": resp.status_code},
            )

        # Body-level error (HTTP 200 but {"status": false, "message": "..."})
        if isinstance(response_body, dict):
            is_success, err_msg = _check_body_success(server, response_body)
            if not is_success:
                raise HTTPException(
                    status_code=422,
                    detail={"remote_error": True, "message": err_msg, "status": 422},
                )

        return response_body if response_body is not None else resp.text
