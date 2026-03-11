"""
FreePBX API Service
Manages SIP extensions in FreePBX via API.

FreePBX 15/16  — REST API module
  Auth:   POST /api/rest/login  → Bearer token
  CRUD:   /api/rest/extension/{ext}

FreePBX 17     — PBX API module (AGPLv3+, GraphQL)
  Auth:   POST /admin/api/api/oauth/token (OAuth2 client_credentials)
          → run `fwconsole pbxapi --addclient` on the server first
  CRUD:   POST /admin/api/api/gql  (GraphQL mutations)

Install the right module first:
  FreePBX 15/16: Admin → Module Admin → "REST API"
  FreePBX 17:    Admin → Module Admin → "PBX API" (AGPLv3+)
"""

import logging
import requests
from typing import Optional

logger = logging.getLogger(__name__)


class FreePBXService:
    """Client for FreePBX REST API (15/16) and BPX API (17)."""

    def __init__(self):
        # Cache: (host, key, secret) → {"token": str, "mode": "rest"|"bpx"}
        self._auth_cache: dict = {}

    # ---------------------------------------------------------------
    #  Internal helpers
    # ---------------------------------------------------------------

    def _base_url(self, host: str) -> str:
        host = host.rstrip("/")
        if host.startswith("http"):
            return host
        return f"https://{host}"

    def _get_auth(self, host: str, port: int, api_key: str, api_secret: str) -> Optional[dict]:
        """
        Try every known FreePBX auth strategy and return
        {"token": "...", "mode": "bpx"|"rest"} on success, None on failure.
        Results are cached per (host, key, secret).

        Strategy order:
        1. FreePBX 17 PBX API module — OAuth2 client_credentials grant
           (credentials created via: fwconsole pbxapi --addclient)
        2. FreePBX 17 admin API — username/password login
        3. FreePBX 15/16 REST API module — username/password login
        """
        cache_key = (host, api_key, api_secret)
        if cache_key in self._auth_cache:
            return self._auth_cache[cache_key]

        base = self._base_url(host)

        # --- Strategy 1: PBX API module OAuth2 (FreePBX 17) ---
        # api_key = OAuth2 client_id, api_secret = OAuth2 client_secret
        for token_url in [
            f"{base}/admin/api/api/oauth/token",
            f"{base}/admin/api/api/token",
        ]:
            for grant_type in ["client_credentials", "password"]:
                if grant_type == "client_credentials":
                    payload = {
                        "grant_type": "client_credentials",
                        "client_id": api_key,
                        "client_secret": api_secret,
                    }
                else:
                    payload = {
                        "grant_type": "password",
                        "username": api_key,
                        "password": api_secret,
                        "client_id": "pbxadmin",
                    }
                try:
                    resp = requests.post(
                        token_url, data=payload,
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                        timeout=10, verify=False,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        token = data.get("access_token") or data.get("token")
                        if token:
                            result = {"token": token, "mode": "bpx"}
                            self._auth_cache[cache_key] = result
                            logger.info("FreePBX auth OK via PBX API OAuth2 (%s, %s)", grant_type, token_url)
                            return result
                        logger.warning("FreePBX OAuth2 200 but no token: %s", data)
                except Exception as e:
                    logger.debug("FreePBX OAuth2 error (%s %s): %s", grant_type, token_url, e)

        # --- Strategy 2: BPX API admin login (FreePBX 17) ---
        for url in [
            f"{base}/admin/api/api/rest/login",
        ]:
            for payload in [
                {"username": api_key, "password": api_secret},
                {"username": api_key, "password": api_secret, "api": True},
            ]:
                try:
                    resp = requests.post(url, json=payload, timeout=10, verify=False)
                    if resp.status_code == 200:
                        data = resp.json()
                        token = (
                            data.get("token")
                            or data.get("access_token")
                            or (data.get("data") or {}).get("token")
                        )
                        if token:
                            result = {"token": token, "mode": "bpx"}
                            self._auth_cache[cache_key] = result
                            logger.info("FreePBX auth OK via BPX admin login (%s)", url)
                            return result
                except Exception as e:
                    logger.debug("FreePBX BPX login error (%s): %s", url, e)

        # --- Strategy 3: REST API module login (FreePBX 15/16) ---
        for url in [f"{base}/api/rest/login"]:
            for payload in [
                {"username": api_key, "password": api_secret, "api": True},
                {"username": api_key, "password": api_secret},
            ]:
                try:
                    resp = requests.post(url, json=payload, timeout=10, verify=False)
                    if resp.status_code == 200:
                        data = resp.json()
                        token = (
                            data.get("token")
                            or data.get("access_token")
                            or (data.get("data") or {}).get("token")
                        )
                        if token:
                            result = {"token": token, "mode": "rest"}
                            self._auth_cache[cache_key] = result
                            logger.info("FreePBX auth OK via REST module login (%s)", url)
                            return result
                except Exception as e:
                    logger.debug("FreePBX REST login error (%s): %s", url, e)

        logger.error("All FreePBX auth strategies failed for %s", host)
        return None

    def _headers(self, token: str) -> dict:
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _get_settings(self, db) -> Optional[dict]:
        """Load FreePBX connection settings from DB."""
        try:
            from app.models.telephony import TelephonySettings
            settings = db.query(TelephonySettings).first()
            if not settings:
                return None
            if not settings.host or not settings.freepbx_api_key or not settings.freepbx_api_secret:
                return None
            return {
                "host": settings.host,
                "port": settings.port or 443,
                "api_key": settings.freepbx_api_key,
                "api_secret": settings.freepbx_api_secret,
            }
        except Exception as e:
            logger.error("Error reading TelephonySettings: %s", e)
            return None

    # ---------------------------------------------------------------
    #  Extension management — REST (FreePBX 15/16)
    # ---------------------------------------------------------------

    def _rest_extension_exists(self, base: str, token: str, extension: str) -> bool:
        try:
            r = requests.get(
                f"{base}/api/rest/extension/{extension}",
                headers=self._headers(token),
                timeout=10, verify=False,
            )
            return r.status_code == 200
        except Exception:
            return False

    def _rest_create_or_update(self, base: str, token: str, extension: str, payload: dict) -> bool:
        exists = self._rest_extension_exists(base, token, extension)
        try:
            if exists:
                r = requests.put(
                    f"{base}/api/rest/extension/{extension}",
                    headers=self._headers(token), json=payload,
                    timeout=10, verify=False,
                )
            else:
                r = requests.post(
                    f"{base}/api/rest/extension",
                    headers=self._headers(token), json=payload,
                    timeout=10, verify=False,
                )
            if r.status_code in (200, 201):
                self._rest_reload(base, token)
                return True
            logger.warning("REST extension save failed [%s]: %s", r.status_code, r.text)
        except Exception as e:
            logger.error("REST extension error: %s", e)
        return False

    def _rest_delete(self, base: str, token: str, extension: str) -> bool:
        try:
            r = requests.delete(
                f"{base}/api/rest/extension/{extension}",
                headers=self._headers(token), timeout=10, verify=False,
            )
            if r.status_code in (200, 204):
                self._rest_reload(base, token)
                return True
            if r.status_code == 404:
                return True
            logger.warning("REST delete failed [%s]: %s", r.status_code, r.text)
        except Exception as e:
            logger.error("REST delete error: %s", e)
        return False

    def _rest_reload(self, base: str, token: str):
        try:
            requests.post(
                f"{base}/api/rest/reload",
                headers=self._headers(token), timeout=15, verify=False,
            )
        except Exception as e:
            logger.warning("REST reload failed (non-fatal): %s", e)

    # ---------------------------------------------------------------
    #  Extension management — BPX API / GraphQL (FreePBX 17)
    # ---------------------------------------------------------------

    def _gql(self, base: str, token: str, query: str, variables: dict = None):
        """Execute a GraphQL query/mutation against the BPX API."""
        return requests.post(
            f"{base}/admin/api/api/gql",
            headers=self._headers(token),
            json={"query": query, "variables": variables or {}},
            timeout=10, verify=False,
        )

    def _bpx_extension_exists(self, base: str, token: str, extension: str) -> bool:
        q = """
        query getExtension($extensionId: String!) {
          fetchExtension(extensionId: $extensionId) {
            extensionId
          }
        }
        """
        try:
            r = self._gql(base, token, q, {"extensionId": extension})
            if r.status_code == 200:
                data = r.json()
                return bool((data.get("data") or {}).get("fetchExtension"))
        except Exception:
            pass
        return False

    def _bpx_create_or_update(
        self, base: str, token: str, extension: str,
        sip_password: str, display_name: str, email: str,
    ) -> bool:
        exists = self._bpx_extension_exists(base, token, extension)
        if exists:
            mutation = """
            mutation updateExtension($extensionId: String!, $input: updateExtensionInput!) {
              updateExtension(extensionId: $extensionId, input: $input) {
                extensionId
                status
              }
            }
            """
            variables = {
                "extensionId": extension,
                "input": {
                    "user": {"name": display_name or f"Agent {extension}"},
                    "endpoint": {"secret": sip_password},
                },
            }
        else:
            mutation = """
            mutation addExtension($input: addExtensionInput!) {
              addExtension(input: $input) {
                extensionId
                status
              }
            }
            """
            variables = {
                "input": {
                    "extensionId": extension,
                    "tech": "pjsip",
                    "user": {
                        "name": display_name or f"Agent {extension}",
                        "email": email,
                    },
                    "endpoint": {"secret": sip_password},
                },
            }
        try:
            r = self._gql(base, token, mutation, variables)
            if r.status_code == 200:
                result = r.json()
                if not result.get("errors"):
                    logger.info("✅ BPX API: extension %s %s", extension, "updated" if exists else "created")
                    return True
                logger.warning("BPX API extension errors: %s", result["errors"])
            else:
                logger.warning("BPX API extension HTTP %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            logger.error("BPX API extension error: %s", e)
        return False

    def _bpx_delete(self, base: str, token: str, extension: str) -> bool:
        mutation = """
        mutation deleteExtension($extensionId: String!) {
          deleteExtension(extensionId: $extensionId) {
            status
          }
        }
        """
        try:
            r = self._gql(base, token, mutation, {"extensionId": extension})
            if r.status_code == 200:
                result = r.json()
                if not result.get("errors"):
                    logger.info("✅ BPX API: extension %s deleted", extension)
                    return True
                logger.warning("BPX API delete errors: %s", result["errors"])
            else:
                logger.warning("BPX API delete HTTP %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            logger.error("BPX API delete error: %s", e)
        return False

    # ---------------------------------------------------------------
    #  Public API — dispatches to REST or BPX based on auth mode
    # ---------------------------------------------------------------

    def create_or_update_extension(
        self, db, extension: str, sip_password: str,
        display_name: str = "", email: str = "",
    ) -> bool:
        cfg = self._get_settings(db)
        if not cfg:
            return False
        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return False

        base = self._base_url(cfg["host"])
        if auth["mode"] == "bpx":
            return self._bpx_create_or_update(base, auth["token"], extension, sip_password, display_name, email)
        else:
            payload = {
                "extension": extension,
                "name": display_name or f"Agent {extension}",
                "secret": sip_password,
                "email": email,
                "type": "pjsip",
                "dial": f"PJSIP/{extension}",
                "outboundcid": f'"{display_name}" <{extension}>',
            }
            return self._rest_create_or_update(base, auth["token"], extension, payload)

    def enable_extension(self, db, extension: str) -> bool:
        return self._set_extension_state(db, extension, enabled=True)

    def disable_extension(self, db, extension: str) -> bool:
        return self._set_extension_state(db, extension, enabled=False)

    def _set_extension_state(self, db, extension: str, enabled: bool) -> bool:
        cfg = self._get_settings(db)
        if not cfg:
            return False
        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return False

        base = self._base_url(cfg["host"])
        state = "enabled" if enabled else "disabled"

        if auth["mode"] == "bpx":
            mutation = """
            mutation updateExtension($extensionId: String!, $input: updateExtensionInput!) {
              updateExtension(extensionId: $extensionId, input: $input) {
                extensionId
                status
              }
            }
            """
            try:
                r = self._gql(base, auth["token"], mutation, {
                    "extensionId": extension,
                    "input": {"endpoint": {"status": state}},
                })
                if r.status_code == 200 and not r.json().get("errors"):
                    logger.info("✅ BPX API: extension %s %s", extension, state)
                    return True
            except Exception as e:
                logger.error("BPX API state change error: %s", e)
            return False
        else:
            try:
                r = requests.put(
                    f"{base}/api/rest/extension/{extension}",
                    headers=self._headers(auth["token"]),
                    json={"enabled": enabled}, timeout=10, verify=False,
                )
                if r.status_code in (200, 201):
                    self._rest_reload(base, auth["token"])
                    logger.info("✅ REST: extension %s %s", extension, state)
                    return True
                logger.warning("REST state change [%s]: %s", r.status_code, r.text)
            except Exception as e:
                logger.error("REST state change error: %s", e)
            return False

    def delete_extension(self, db, extension: str) -> bool:
        cfg = self._get_settings(db)
        if not cfg:
            return False
        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return False

        base = self._base_url(cfg["host"])
        if auth["mode"] == "bpx":
            return self._bpx_delete(base, auth["token"], extension)
        else:
            return self._rest_delete(base, auth["token"], extension)

    # Kept for backward compatibility with direct callers
    def _get_token(self, host: str, port: int, api_key: str, api_secret: str) -> Optional[str]:
        auth = self._get_auth(host, port, api_key, api_secret)
        return auth["token"] if auth else None


# Singleton instance
freepbx_service = FreePBXService()
