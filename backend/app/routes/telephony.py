import socket
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.telephony import TelephonySettings
from app.schemas.telephony import TelephonySettingsResponse, TelephonySettingsUpdate

router = APIRouter(
    prefix="/admin/telephony",
    tags=["admin", "telephony"],
    responses={404: {"description": "Not found"}},
)

require_telephony = require_admin_feature("feature_manage_telephony")


@router.get("/settings", response_model=TelephonySettingsResponse)
def get_telephony_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Get the current telephony settings."""
    settings = db.query(TelephonySettings).first()
    if not settings:
        settings = TelephonySettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.post("/settings", response_model=TelephonySettingsResponse)
def update_telephony_settings(
    settings_update: TelephonySettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Update telephony settings including FreePBX REST API credentials."""
    settings = db.query(TelephonySettings).first()
    if not settings:
        settings = TelephonySettings()
        db.add(settings)

    if settings_update.pbx_type is not None:
        settings.pbx_type = settings_update.pbx_type
    if settings_update.host is not None:
        settings.host = settings_update.host
    if settings_update.freepbx_port is not None:
        settings.freepbx_port = settings_update.freepbx_port
    if settings_update.ami_port is not None:
        settings.ami_port = settings_update.ami_port
    if settings_update.ami_username is not None:
        settings.ami_username = settings_update.ami_username
    if settings_update.ami_secret is not None:
        settings.ami_secret = settings_update.ami_secret
    if settings_update.webrtc_wss_url is not None:
        settings.webrtc_wss_url = settings_update.webrtc_wss_url
    if settings_update.freepbx_api_key is not None:
        settings.freepbx_api_key = settings_update.freepbx_api_key
    if settings_update.freepbx_api_secret is not None:
        settings.freepbx_api_secret = settings_update.freepbx_api_secret
    if settings_update.is_active is not None:
        settings.is_active = settings_update.is_active

    db.commit()
    db.refresh(settings)
    return settings


@router.post("/test-freepbx")
def test_freepbx_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Test FreePBX connectivity: verifies host is reachable and credentials are valid."""
    import requests as req
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    settings = db.query(TelephonySettings).first()
    if not settings or not settings.host:
        raise HTTPException(status_code=400, detail="FreePBX host is not configured.")
    if not settings.freepbx_api_key or not settings.freepbx_api_secret:
        raise HTTPException(status_code=400, detail="Username and password are required.")

    host = settings.host.rstrip("/")
    if not host.startswith("http"):
        host = f"https://{host}"
    # Append custom port if not already in the URL and not a standard port
    fpbx_port = settings.freepbx_port or 443
    if fpbx_port not in (80, 443) and ":" not in host.split("//", 1)[-1]:
        host = f"{host}:{fpbx_port}"

    username = settings.freepbx_api_key
    password = settings.freepbx_api_secret

    # Step 1: check the host is reachable
    try:
        r = req.get(f"{host}/admin/config.php", timeout=8, verify=False)
        if r.status_code not in (200, 301, 302):
            return {"status": "error",
                    "message": f"FreePBX at {settings.host} returned HTTP {r.status_code}. Check the host URL."}
    except req.exceptions.ConnectionError:
        return {"status": "error",
                "message": f"Cannot reach {settings.host}. Check the host URL and network."}
    except req.exceptions.Timeout:
        return {"status": "error",
                "message": f"Timeout connecting to {settings.host}. Server may be down."}

    # Step 2: verify credentials via form login
    try:
        s = req.Session()
        s.verify = False
        s.get(f"{host}/admin/config.php", timeout=8)
        r2 = s.post(f"{host}/admin/config.php",
                    data={"username": username, "password": password, "submit": "Login"},
                    headers={"Referer": f"{host}/admin/config.php"},
                    allow_redirects=True, timeout=10)
        logged_in = any(k in r2.text.lower() for k in ("logout", "dashboard", "fpbx_csrf"))
    except Exception as e:
        return {"status": "error", "message": f"Login attempt failed: {str(e)[:120]}"}

    if not logged_in:
        return {
            "status": "error",
            "message": f"Could not log in to FreePBX at {settings.host}. Check username and password.",
        }

    # Step 3: try PBX API OAuth2 directly (no session needed — pure client credentials)
    # After running `fwconsole pbxapi --addclient`, use the returned Client ID + Secret here.
    token_endpoints = [
        f"{host}/admin/api/api/oauth/token",
        f"{host}/admin/api/api/token",
    ]
    for token_url in token_endpoints:
        try:
            rt = req.post(
                token_url,
                data={"grant_type": "client_credentials",
                      "client_id": username, "client_secret": password},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=8, verify=False,
            )
            if rt.status_code == 200:
                td = rt.json()
                tok = td.get("access_token") or td.get("token")
                if tok:
                    from app.services.freepbx_service import freepbx_service
                    freepbx_service._auth_cache.clear()
                    return {
                        "status": "success",
                        "message": f"✅ Connected to FreePBX API at {settings.host}.",
                    }
        except Exception:
            pass

    # Step 4: fallback — try legacy REST API module (FreePBX 15/16)
    for rest_url in [f"{host}/api/rest/login", f"{host}/admin/api/api/rest/login"]:
        try:
            rt = req.post(rest_url, json={"username": username, "password": password},
                          timeout=8, verify=False)
            if rt.status_code == 200:
                td = rt.json()
                tok = (td.get("token") or td.get("access_token")
                       or (td.get("data") or {}).get("token"))
                if tok:
                    from app.services.freepbx_service import freepbx_service
                    freepbx_service._auth_cache.clear()
                    return {
                        "status": "success",
                        "message": f"✅ Connected to FreePBX API at {settings.host}.",
                    }
        except Exception:
            pass

    return {
        "status": "warning",
        "message": (
            f"✅ Credentials verified — logged in to FreePBX at {settings.host}. "
            "However, the PBX API OAuth2 token could not be obtained. "
            "If you haven't created an OAuth2 client yet, follow the steps below."
        ),
        "logged_in": True,
        "api_available": False,
        "instructions": [
            "SSH into your FreePBX server and run:",
            "   fwconsole pbxapi --addclient",
            "",
            "This creates an OAuth2 client and prints the Client ID and Client Secret.",
            "Then come back here and:",
            "   • Username field  → paste the Client ID",
            "   • Password field  → paste the Client Secret",
            "   • Click Save, then Test Connection",
            "",
            "To list existing clients:  fwconsole pbxapi --listclients",
        ],
    }


@router.post("/test-ami")
def test_ami_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Test AMI connectivity by connecting via TCP and attempting login."""
    settings = db.query(TelephonySettings).first()
    if not settings or not settings.host:
        raise HTTPException(status_code=400, detail="FreePBX host is not configured.")
    if not settings.ami_username or not settings.ami_secret:
        raise HTTPException(status_code=400, detail="AMI username and secret are required.")

    # Resolve hostname (strip scheme if present)
    host = settings.host.rstrip("/")
    for prefix in ("https://", "http://"):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break

    port = settings.ami_port if settings.ami_port else 5038

    try:
        sock = socket.create_connection((host, port), timeout=8)
    except socket.timeout:
        return {"status": "error", "message": f"Timeout connecting to {host}:{port}. Check host and AMI port."}
    except OSError as e:
        return {"status": "error", "message": f"Cannot reach AMI at {host}:{port} — {str(e)}"}

    try:
        with sock:
            sock.settimeout(8)
            banner = sock.recv(1024).decode(errors="ignore")
            if "Asterisk Call Manager" not in banner:
                return {"status": "error", "message": f"Unexpected banner from {host}:{port}: {banner[:120]}"}

            login_cmd = (
                f"Action: Login\r\n"
                f"Username: {settings.ami_username}\r\n"
                f"Secret: {settings.ami_secret}\r\n"
                f"\r\n"
            )
            sock.sendall(login_cmd.encode())

            response = b""
            while b"\r\n\r\n" not in response:
                chunk = sock.recv(1024)
                if not chunk:
                    break
                response += chunk

            response_str = response.decode(errors="ignore")
            if "Response: Success" in response_str:
                return {"status": "success", "message": f"✅ AMI connected successfully to {host}:{port}."}
            elif "Response: Error" in response_str or "Authentication failed" in response_str:
                return {"status": "error", "message": f"AMI authentication failed. Check username and secret."}
            else:
                return {"status": "error", "message": f"Unexpected AMI response: {response_str[:200]}"}
    except socket.timeout:
        return {"status": "error", "message": f"AMI at {host}:{port} connected but did not respond in time."}
