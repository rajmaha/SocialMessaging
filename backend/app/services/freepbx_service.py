"""
FreePBX REST API Service
Manages SIP extensions in FreePBX 15+ via the built-in REST API module.

Endpoints used:
  GET    /api/rest/extension/{ext}   — check if extension exists
  POST   /api/rest/extension         — create new extension
  PUT    /api/rest/extension/{ext}   — update existing extension
  DELETE /api/rest/extension/{ext}   — delete extension

Authentication: Bearer token obtained from POST /api/rest/login
  with api_key + api_secret (set in FreePBX Admin → User Management → API Keys).
"""

import logging
import requests
from typing import Optional

logger = logging.getLogger(__name__)


class FreePBXService:
    """Client for the FreePBX REST API (FreePBX 15+)."""

    def __init__(self):
        self._token_cache: dict = {}   # keyed by (host, key, secret)

    # ---------------------------------------------------------------
    #  Internal helpers
    # ---------------------------------------------------------------

    def _base_url(self, host: str, port: int = 443, use_https: bool = True) -> str:
        scheme = "https" if use_https else "http"
        # Strip trailing slash
        host = host.rstrip("/")
        if host.startswith("http"):
            return host
        return f"{scheme}://{host}"

    def _get_token(self, host: str, port: int, api_key: str, api_secret: str) -> Optional[str]:
        """Obtain (or return cached) bearer token from FreePBX REST API login."""
        cache_key = (host, api_key, api_secret)
        if cache_key in self._token_cache:
            return self._token_cache[cache_key]

        base = self._base_url(host, port)
        try:
            resp = requests.post(
                f"{base}/api/rest/login",
                json={"username": api_key, "password": api_secret, "api": True},
                timeout=10,
                verify=False,   # Many self-hosted FreePBX use self-signed certs
            )
            resp.raise_for_status()
            data = resp.json()
            token = data.get("token") or data.get("access_token")
            if token:
                self._token_cache[cache_key] = token
                return token
            logger.warning("FreePBX login returned no token: %s", data)
        except Exception as e:
            logger.error("FreePBX login failed: %s", e)
        return None

    def _headers(self, token: str) -> dict:
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _get_settings(self, db) -> Optional[dict]:
        """Load FreePBX connection settings from DB TelephonySettings row."""
        try:
            from app.models.telephony import TelephonySettings
            settings = db.query(TelephonySettings).first()
            if not settings:
                logger.warning("No TelephonySettings found in DB — FreePBX sync skipped")
                return None
            if not settings.host or not settings.freepbx_api_key or not settings.freepbx_api_secret:
                logger.info("FreePBX REST API credentials not configured — sync skipped")
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
    #  Public API
    # ---------------------------------------------------------------

    def create_or_update_extension(
        self,
        db,
        extension: str,
        sip_password: str,
        display_name: str = "",
        email: str = "",
    ) -> bool:
        """
        Create or update a SIP extension in FreePBX.
        Returns True on success, False on failure (non-fatal).
        """
        cfg = self._get_settings(db)
        if not cfg:
            return False

        base = self._base_url(cfg["host"], cfg["port"])
        token = self._get_token(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not token:
            return False

        payload = {
            "extension": extension,
            "name": display_name or f"Agent {extension}",
            "secret": sip_password,
            "email": email,
            "type": "pjsip",      # FreePBX 17 default driver
            "dial": f"PJSIP/{extension}",
            "outboundcid": f'"{display_name}" <{extension}>',
        }

        # Check if extension already exists
        try:
            check = requests.get(
                f"{base}/api/rest/extension/{extension}",
                headers=self._headers(token),
                timeout=10,
                verify=False,
            )
            exists = check.status_code == 200
        except Exception:
            exists = False

        try:
            if exists:
                resp = requests.put(
                    f"{base}/api/rest/extension/{extension}",
                    headers=self._headers(token),
                    json=payload,
                    timeout=10,
                    verify=False,
                )
            else:
                resp = requests.post(
                    f"{base}/api/rest/extension",
                    headers=self._headers(token),
                    json=payload,
                    timeout=10,
                    verify=False,
                )

            if resp.status_code in (200, 201):
                # Apply dialplan changes so they take effect immediately
                self._apply_changes(base, token)
                logger.info("✅ FreePBX: extension %s %s", extension, "updated" if exists else "created")
                return True
            else:
                logger.warning("FreePBX extension save failed [%s]: %s", resp.status_code, resp.text)
                return False

        except Exception as e:
            logger.error("Error syncing extension %s to FreePBX: %s", extension, e)
            return False

    def enable_extension(self, db, extension: str) -> bool:
        """Enable (unblock) a SIP extension in FreePBX."""
        return self._set_extension_state(db, extension, enabled=True)

    def disable_extension(self, db, extension: str) -> bool:
        """Disable (block) a SIP extension in FreePBX."""
        return self._set_extension_state(db, extension, enabled=False)

    def _set_extension_state(self, db, extension: str, enabled: bool) -> bool:
        cfg = self._get_settings(db)
        if not cfg:
            return False

        base = self._base_url(cfg["host"], cfg["port"])
        token = self._get_token(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not token:
            return False

        # FreePBX REST API: PUT user_rpid field or directly enable/disable via hook
        # For FreePBX 17, we use the device state endpoint
        try:
            resp = requests.put(
                f"{base}/api/rest/extension/{extension}",
                headers=self._headers(token),
                json={"enabled": enabled},
                timeout=10,
                verify=False,
            )
            if resp.status_code in (200, 201):
                self._apply_changes(base, token)
                state = "enabled" if enabled else "disabled"
                logger.info("✅ FreePBX: extension %s %s", extension, state)
                return True
            else:
                logger.warning("FreePBX state change failed [%s]: %s", resp.status_code, resp.text)
                return False
        except Exception as e:
            logger.error("Error toggling extension %s state: %s", extension, e)
            return False

    def delete_extension(self, db, extension: str) -> bool:
        """Delete a SIP extension from FreePBX."""
        cfg = self._get_settings(db)
        if not cfg:
            return False

        base = self._base_url(cfg["host"], cfg["port"])
        token = self._get_token(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not token:
            return False

        try:
            resp = requests.delete(
                f"{base}/api/rest/extension/{extension}",
                headers=self._headers(token),
                timeout=10,
                verify=False,
            )
            if resp.status_code in (200, 204):
                self._apply_changes(base, token)
                logger.info("✅ FreePBX: extension %s deleted", extension)
                return True
            elif resp.status_code == 404:
                logger.info("FreePBX: extension %s not found (already deleted)", extension)
                return True
            else:
                logger.warning("FreePBX delete failed [%s]: %s", resp.status_code, resp.text)
                return False
        except Exception as e:
            logger.error("Error deleting extension %s from FreePBX: %s", extension, e)
            return False

    def _apply_changes(self, base: str, token: str):
        """Apply dialplan changes in FreePBX (equivalent of 'Apply Config' button)."""
        try:
            requests.post(
                f"{base}/api/rest/reload",
                headers=self._headers(token),
                timeout=15,
                verify=False,
            )
        except Exception as e:
            logger.warning("FreePBX reload failed (non-fatal): %s", e)


# Singleton instance
freepbx_service = FreePBXService()
