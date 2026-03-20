import logging
import socket
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.telephony import TelephonySettings
from app.schemas.telephony import TelephonySettingsResponse, TelephonySettingsUpdate
from app.services.freepbx_service import freepbx_service

logger = logging.getLogger(__name__)

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
    if settings_update.stun_servers is not None:
        settings.stun_servers = settings_update.stun_servers
    if settings_update.turn_server is not None:
        settings.turn_server = settings_update.turn_server
    if settings_update.turn_username is not None:
        settings.turn_username = settings_update.turn_username
    if settings_update.turn_credential is not None:
        settings.turn_credential = settings_update.turn_credential
    if settings_update.ssh_host is not None:
        settings.ssh_host = settings_update.ssh_host
    if settings_update.ssh_port is not None:
        settings.ssh_port = settings_update.ssh_port
    if settings_update.ssh_username is not None:
        settings.ssh_username = settings_update.ssh_username
    if settings_update.ssh_password is not None:
        settings.ssh_password = settings_update.ssh_password
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


@router.post("/scrape-form")
def scrape_extension_form(
    extension: str = "9001",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Scrape the FreePBX extension edit form to discover real field names.

    This is a diagnostic endpoint — use it to see what form fields FreePBX
    actually uses for extension PJSIP settings (transport, DTLS, codecs, etc.)
    so we can configure them correctly during sync.
    """
    return freepbx_service.scrape_extension_form(db, extension)


@router.post("/introspect-schema")
def introspect_freepbx_schema(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Introspect the FreePBX 17 GraphQL schema to discover available extension fields.

    Returns the fields for addExtensionInput, updateExtensionInput, and any
    PJSIP-related input types so that admins can verify which WebRTC/transport/
    codec/DTLS/ICE fields are supported by their FreePBX installation.
    """
    settings = db.query(TelephonySettings).first()
    if not settings or not settings.host:
        raise HTTPException(status_code=400, detail="FreePBX host is not configured.")
    if not settings.freepbx_api_key or not settings.freepbx_api_secret:
        raise HTTPException(status_code=400, detail="FreePBX API credentials are required.")

    cfg = {
        "host": settings.host,
        "port": settings.freepbx_port or 443,
        "api_key": settings.freepbx_api_key,
        "api_secret": settings.freepbx_api_secret,
    }

    auth = freepbx_service._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
    if not auth:
        return {
            "status": "error",
            "message": "Failed to authenticate with FreePBX API. Check credentials.",
        }

    if auth["mode"] != "bpx":
        return {
            "status": "warning",
            "message": "Connected via REST API (FreePBX 15/16) — GraphQL introspection is only available on FreePBX 17 PBX API.",
            "mode": auth["mode"],
        }

    base = freepbx_service._base_url(cfg["host"], cfg["port"])
    token = auth["token"]

    # Introspect the key input types
    type_names = [
        "addExtensionInput",
        "updateExtensionInput",
    ]

    results = {}
    for type_name in type_names:
        results[type_name] = _introspect_type_detailed(base, token, type_name)

    # Also try to discover PJSIP-specific types if they exist
    for extra_type in [
        "PjsipEndpointInput",
        "pjsipEndpointInput",
        "EndpointInput",
        "endpointInput",
        "TransportInput",
        "transportInput",
    ]:
        detail = _introspect_type_detailed(base, token, extra_type)
        if detail.get("fields"):
            results[extra_type] = detail

    return {
        "status": "success",
        "message": "GraphQL schema introspected successfully.",
        "mode": auth["mode"],
        "types": results,
    }


def _introspect_type_detailed(base: str, token: str, type_name: str) -> dict:
    """Introspect a GraphQL input type and return structured field info."""
    import requests as req

    query = """
    query InspectType($name: String!) {
      __type(name: $name) {
        name
        kind
        inputFields {
          name
          type {
            name
            kind
            ofType { name kind ofType { name kind } }
          }
          defaultValue
        }
      }
    }
    """
    try:
        r = req.post(
            f"{base}/admin/api/api/gql",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"query": query, "variables": {"name": type_name}},
            timeout=10,
            verify=False,
        )
        if r.status_code == 200:
            data = r.json()
            t = (data.get("data") or {}).get("__type")
            if t and t.get("inputFields"):
                fields = []
                for f in t["inputFields"]:
                    ftype = f.get("type") or {}
                    type_str = ftype.get("name") or ftype.get("kind") or ""
                    if not type_str and ftype.get("ofType"):
                        of = ftype["ofType"]
                        type_str = of.get("name") or of.get("kind") or ""
                        if of.get("ofType"):
                            type_str = of["ofType"].get("name") or type_str
                    fields.append({
                        "name": f["name"],
                        "type": type_str,
                        "default": f.get("defaultValue"),
                    })
                return {"found": True, "fields": fields}
            return {"found": False, "fields": [], "note": f"{type_name} not found in schema"}
        return {"found": False, "fields": [], "note": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"found": False, "fields": [], "note": f"Error: {e}"}


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


@router.post("/test-ssh")
def test_ssh_connection(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_telephony)
):
    """Test SSH connectivity to FreePBX server and verify mysql + fwconsole are available."""
    settings = db.query(TelephonySettings).first()
    if not settings or not settings.host:
        raise HTTPException(status_code=400, detail="FreePBX host is not configured.")
    if not settings.ssh_username or not settings.ssh_password:
        raise HTTPException(status_code=400, detail="SSH username and password are required.")

    # Use ssh_host if set, otherwise derive from PBX host
    if settings.ssh_host and settings.ssh_host.strip():
        host = settings.ssh_host.strip()
    else:
        host = settings.host.rstrip("/")
    # Strip scheme if present
    for prefix in ("https://", "http://"):
        if host.startswith(prefix):
            host = host[len(prefix):]
            break
    # Strip port from host if present
    if ":" in host:
        host = host.split(":")[0]

    ssh_port = settings.ssh_port or 22

    try:
        import paramiko
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=host,
            port=ssh_port,
            username=settings.ssh_username,
            password=settings.ssh_password,
            timeout=10,
        )

        # Test mysql access
        stdin, stdout, stderr = client.exec_command("mysql asterisk -e 'SELECT 1' 2>&1", timeout=10)
        mysql_out = stdout.read().decode(errors="ignore").strip()
        mysql_ok = "1" in mysql_out

        # Test fwconsole
        stdin, stdout, stderr = client.exec_command("which fwconsole 2>&1", timeout=10)
        fwconsole_out = stdout.read().decode(errors="ignore").strip()
        fwconsole_ok = "fwconsole" in fwconsole_out

        # Test asterisk CLI (primary reload method)
        stdin, stdout, stderr = client.exec_command("which asterisk 2>&1", timeout=10)
        asterisk_out = stdout.read().decode(errors="ignore").strip()
        asterisk_ok = "asterisk" in asterisk_out

        client.close()

        issues = []
        if not mysql_ok:
            issues.append("mysql: cannot access asterisk database")
        if not fwconsole_ok:
            issues.append("fwconsole: not found in PATH")
        if not asterisk_ok:
            issues.append("asterisk CLI: not found in PATH")

        if issues:
            return {
                "status": "warning",
                "message": f"SSH connected to {host}:{ssh_port} but: {'; '.join(issues)}",
            }

        return {
            "status": "success",
            "message": f"✅ SSH connected to {host}:{ssh_port}. MySQL, fwconsole, and Asterisk CLI are available.",
        }

    except Exception as e:
        return {"status": "error", "message": f"SSH connection failed to {host}:{ssh_port}: {e}"}
