import httpx
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
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


async def api_login(
    db: Session,
    server: ApiServer,
    credential: UserApiCredential,
) -> str:
    """Authenticate with the remote API and cache the token."""
    url = f"{server.base_url.rstrip('/')}{server.login_endpoint}"

    if server.request_content_type == "formdata":
        request_kwargs = {"data": {
            server.login_username_field: credential.username,
            server.login_password_field: credential.password,
        }}
    else:
        request_kwargs = {"json": {
            server.login_username_field: credential.username,
            server.login_password_field: credential.password,
        }}

    headers = _build_headers(server)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, **request_kwargs)
        resp.raise_for_status()
        body = resp.json()

    token = _resolve_json_path(body, server.token_response_path or "data.token")
    if not token:
        raise ValueError(f"Could not extract token from response using path '{server.token_response_path}'")

    credential.token = token
    credential.is_active = True
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
        if server.request_content_type == "formdata":
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

        resp.raise_for_status()

        if resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return resp.text
