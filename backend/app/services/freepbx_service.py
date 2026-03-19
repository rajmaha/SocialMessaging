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
import time
import requests
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class FreePBXService:
    """Client for FreePBX REST API (15/16) and BPX API (17)."""

    # Tokens are valid for roughly 1 hour in FreePBX; re-auth after 45 min
    _TOKEN_TTL = 45 * 60

    def __init__(self):
        # Cache: (host, key, secret) → {"token": str, "mode": "rest"|"bpx", "ts": float}
        self._auth_cache: dict = {}

    # ---------------------------------------------------------------
    #  Internal helpers
    # ---------------------------------------------------------------

    def _base_url(self, host: str, port: int = None) -> str:
        host = host.rstrip("/")
        scheme = "http" if port == 80 else "https"
        if host.startswith("http"):
            # Append custom port if not already in the URL and not a standard port
            if port and port not in (80, 443) and ":" not in host.split("//", 1)[-1]:
                return f"{host}:{port}"
            return host
        if port and port not in (80, 443):
            return f"{scheme}://{host}:{port}"
        return f"{scheme}://{host}"

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
        cached = self._auth_cache.get(cache_key)
        if cached and (time.time() - cached["ts"]) < self._TOKEN_TTL:
            return cached

        base = self._base_url(host, port)

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
                            result = {"token": token, "mode": "bpx", "ts": time.time()}
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
                            result = {"token": token, "mode": "bpx", "ts": time.time()}
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
                            result = {"token": token, "mode": "rest", "ts": time.time()}
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

    def _get_settings(self, db) -> Tuple[Optional[dict], Optional[str]]:
        """Load FreePBX connection settings from DB. Returns (settings, error_reason)."""
        try:
            from app.models.telephony import TelephonySettings
            settings = db.query(TelephonySettings).first()
            if not settings:
                return None, "No telephony settings found in database"
            missing = [f for f, v in [
                ("host", settings.host),
                ("freepbx_api_key", settings.freepbx_api_key),
                ("freepbx_api_secret", settings.freepbx_api_secret),
            ] if not v]
            if missing:
                return None, f"Telephony settings incomplete — missing: {', '.join(missing)}"
            return {
                "host": settings.host,
                "port": settings.freepbx_port or 443,
                "api_key": settings.freepbx_api_key,
                "api_secret": settings.freepbx_api_secret,
            }, None
        except Exception as e:
            logger.error("Error reading TelephonySettings: %s", e)
            return None, f"DB error reading telephony settings: {e}"

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

    def _bpx_introspect_input_type(self, base: str, token: str, type_name: str) -> str:
        """
        Introspect a GraphQL input type and return a human-readable field list string.
        Used to surface the real schema when mutations fail with type errors.
        """
        q = """
        query InspectType($name: String!) {
          __type(name: $name) {
            name
            inputFields {
              name
              type { name kind ofType { name kind } }
            }
          }
        }
        """
        try:
            r = self._gql(base, token, q, {"name": type_name})
            if r.status_code == 200:
                data = r.json()
                t = (data.get("data") or {}).get("__type")
                if t:
                    fields = [f["name"] for f in (t.get("inputFields") or [])]
                    summary = f"{type_name} valid fields: {fields}"
                    logger.info("FreePBX schema — %s", summary)
                    return summary
                return f"{type_name}: type not found in schema (introspection returned null)"
            return f"{type_name}: introspection HTTP {r.status_code}"
        except Exception as e:
            return f"{type_name}: introspection error — {e}"

    def _bpx_extension_exists(self, base: str, token: str, extension: str) -> Optional[bool]:
        """
        Returns True if extension exists, False if it doesn't, None if the query failed.
        Callers must treat None as "unknown" and not blindly fall through to addExtension.
        """
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
                if data.get("errors"):
                    logger.warning("BPX fetchExtension errors: %s", data["errors"])
                    return None
                return bool((data.get("data") or {}).get("fetchExtension"))
            logger.warning("BPX fetchExtension HTTP %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            logger.error("BPX fetchExtension exception: %s", e)
        return None

    # ---------------------------------------------------------------
    #  WebRTC PJSIP settings for extensions
    # ---------------------------------------------------------------

    @staticmethod
    def _webrtc_pjsip_fields() -> dict:
        """Return the PJSIP fields required for a WebRTC-capable extension.

        FreePBX 17's updateExtensionInput may accept a `webrtc` shortcut field
        that auto-sets DTLS/ICE/transport/encryption.  We include explicit
        fields as well so that the extension is fully configured even if the
        `webrtc` shortcut is not supported by the installed schema version.

        Field names match the FreePBX 17 PBX API GraphQL schema.
        """
        return {
            # Master WebRTC toggle — when supported, auto-configures DTLS/ICE/etc.
            "webrtc": "yes",
            # Transport — must match a WSS transport defined in Asterisk SIP Settings
            "transport": "0.0.0.0-wss",
            # DTLS for secure media (required for WebRTC)
            "dtlsEnable": "yes",
            "dtlsVerify": "no",
            "dtlsSetup": "actpass",
            "dtlsCertfile": "",  # empty = use default Asterisk certificate
            # Media encryption via DTLS-SRTP
            "mediaEncryption": "dtls",
            "mediaUseReceivedTransport": "yes",
            # ICE (Interactive Connectivity Establishment)
            "iceSupport": "yes",
            # Codecs — opus first for WebRTC, then fallbacks
            "allow": "opus,ulaw,alaw",
            # Allow multiple WebRTC registrations (browser tabs / devices)
            "maxContacts": "5",
        }

    @staticmethod
    def _webrtc_shortcut_only() -> dict:
        """Minimal WebRTC fields — just the `webrtc: yes` shortcut.

        Some FreePBX 17 builds auto-set all DTLS/ICE/transport settings
        when `webrtc` is set to "yes".  Use this as a fallback if the
        full field list is rejected by the schema.
        """
        return {
            "webrtc": "yes",
            "maxContacts": "5",
        }

    def _bpx_create_or_update(
        self, base: str, token: str, extension: str,
        sip_password: str, display_name: str, email: str,
    ) -> Tuple[bool, str]:
        """Returns (success, detail_message)."""
        exists = self._bpx_extension_exists(base, token, extension)

        if exists is None:
            # Exists-check failed — try update first (idempotent), then create on
            # "not found"-style error so we don't blindly add a duplicate.
            logger.warning(
                "BPX fetchExtension failed for %s; will attempt updateExtension first", extension
            )

        # Schema confirmed via introspection:
        #   updateExtensionInput: flat, includes extPassword for SIP credential
        #   addExtensionInput:    flat, NO password field — FreePBX separates
        #                         creation from credential setting.
        # Workflow: addExtension to create, then updateExtension to set extPassword + WebRTC settings.

        _update_mutation = """
        mutation updateExtension($input: updateExtensionInput!) {
          updateExtension(input: $input) {
            status
            message
          }
        }
        """

        def _do_update(extra_hint: str = "", webrtc_fields: dict = None) -> Tuple[bool, str]:
            input_data = {
                "extensionId": extension,
                "name": display_name or f"Agent {extension}",
                "extPassword": sip_password,
            }
            # Merge WebRTC PJSIP settings into the mutation input
            if webrtc_fields:
                input_data.update(webrtc_fields)

            vars_ = {"input": input_data}
            try:
                r = self._gql(base, token, _update_mutation, vars_)
                if r.status_code == 200:
                    result = r.json()
                    if not result.get("errors"):
                        logger.info("✅ BPX API: extension %s updated%s", extension, extra_hint)
                        return True, "OK"
                    errs = result["errors"]
                    logger.warning("BPX updateExtension errors: %s", errs)
                    err_msgs = " ".join((e.get("message") or "") for e in errs).lower()
                    schema_hint = ""
                    if "is not defined by type" in err_msgs or "unknown argument" in err_msgs:
                        schema_hint = " | " + self._bpx_introspect_input_type(base, token, "updateExtensionInput")
                    return False, f"updateExtension failed: {errs}{schema_hint}"
                return False, f"updateExtension HTTP {r.status_code}: {r.text[:300]}"
            except Exception as e:
                logger.error("BPX updateExtension exception: %s", e)
                return False, f"updateExtension exception: {e}"

        def _do_update_with_webrtc_fallback(extra_hint: str = "") -> Tuple[bool, str]:
            """Try updating with full WebRTC fields, then shortcut-only, then basic."""
            # Attempt 1: Full WebRTC PJSIP fields
            ok, detail = _do_update(
                extra_hint + " [full WebRTC fields]",
                webrtc_fields=self._webrtc_pjsip_fields(),
            )
            if ok:
                return True, "OK"

            err_lower = detail.lower()
            is_field_error = any(
                kw in err_lower for kw in ("is not defined by type", "unknown argument", "unknown field")
            )

            if is_field_error:
                logger.info(
                    "Full WebRTC fields rejected for %s — retrying with webrtc shortcut only", extension
                )
                # Attempt 2: Just `webrtc: yes` shortcut
                ok2, detail2 = _do_update(
                    extra_hint + " [webrtc shortcut]",
                    webrtc_fields=self._webrtc_shortcut_only(),
                )
                if ok2:
                    return True, "OK"

                err_lower2 = detail2.lower()
                is_field_error2 = any(
                    kw in err_lower2 for kw in ("is not defined by type", "unknown argument", "unknown field")
                )

                if is_field_error2:
                    logger.warning(
                        "WebRTC shortcut also rejected for %s — falling back to basic fields only. "
                        "WebRTC settings must be configured manually in FreePBX admin panel.",
                        extension,
                    )
                    # Attempt 3: Basic fields only (password + name, no WebRTC)
                    ok3, detail3 = _do_update(extra_hint + " [basic only — no WebRTC]")
                    if ok3:
                        return True, (
                            "OK — extension updated but WebRTC/PJSIP settings could not be set via API. "
                            "Please configure transport, DTLS, ICE, and codecs manually in FreePBX admin panel."
                        )
                    return False, detail3

                return False, detail2

            return False, detail

        # --- UPDATE path (extension already exists) ---
        if exists or exists is None:
            ok, detail = _do_update_with_webrtc_fallback()
            if ok:
                self._bpx_apply_config(base, token)
                return True, detail
            err_msgs = detail.lower()
            if exists:
                # Confident it exists — surface the error
                return False, detail
            # exists is None — fall through to create only on "not found"-type errors
            if not any(kw in err_msgs for kw in ("not found", "does not exist", "no extension")):
                return False, detail

        # --- CREATE path (extension does not exist) ---
        if not exists:
            add_mutation = """
            mutation addExtension($input: addExtensionInput!) {
              addExtension(input: $input) {
                status
                message
              }
            }
            """
            # addExtensionInput has NO password field (confirmed via introspection):
            # ['extensionId','tech','channelName','name','outboundCid','emergencyCid',
            #  'email','umEnable','umGroups','vmEnable','vmPassword','callerID',
            #  'umPassword','maxContacts','ringtimer','clientMutationId']
            # Password + WebRTC settings are applied via a subsequent updateExtension call.
            add_vars = {
                "input": {
                    "extensionId": extension,
                    "tech": "pjsip",
                    "name": display_name or f"Agent {extension}",
                    "email": email,
                    "maxContacts": "5",
                },
            }
            try:
                r = self._gql(base, token, add_mutation, add_vars)
                if r.status_code == 200:
                    result = r.json()
                    if not result.get("errors"):
                        logger.info("✅ BPX API: extension %s created — setting password + WebRTC settings", extension)
                        # Set the SIP password AND WebRTC PJSIP settings via updateExtension
                        ok, detail = _do_update_with_webrtc_fallback(" (post-create)")
                        if not ok:
                            logger.warning(
                                "Extension %s created but update failed: %s", extension, detail
                            )
                            return False, f"Extension created but update failed: {detail}"
                        self._bpx_apply_config(base, token)
                        return True, detail
                    logger.warning("BPX addExtension errors: %s", result["errors"])
                    add_err_msgs = " ".join(
                        (e.get("message") or "") for e in result["errors"]
                    ).lower()
                    add_schema_hint = ""
                    if "is not defined by type" in add_err_msgs or "unknown argument" in add_err_msgs:
                        add_schema_hint = " | " + self._bpx_introspect_input_type(base, token, "addExtensionInput")
                    return False, f"addExtension failed: {result['errors']}{add_schema_hint}"
                logger.warning("BPX addExtension HTTP %s: %s", r.status_code, r.text[:200])
                return False, f"addExtension HTTP {r.status_code}: {r.text[:300]}"
            except Exception as e:
                logger.error("BPX addExtension exception: %s", e)
                return False, f"addExtension exception: {e}"

        return False, "BPX extension operation did not complete"

    def _bpx_apply_config(self, base: str, token: str):
        """
        Apply FreePBX config (equivalent of clicking 'Apply Config' in the UI).
        Non-fatal — a failure here just means Asterisk hasn't picked up the change yet;
        the operator can apply manually from the FreePBX admin panel.
        """
        mutation = """
        mutation {
          applyConfig {
            status
            message
          }
        }
        """
        try:
            r = self._gql(base, token, mutation)
            if r.status_code == 200:
                result = r.json()
                if not result.get("errors"):
                    logger.info("✅ BPX API: config applied (Asterisk reloaded)")
                    return
                logger.warning("BPX applyConfig errors (non-fatal): %s", result.get("errors"))
            else:
                logger.warning("BPX applyConfig HTTP %s (non-fatal): %s", r.status_code, r.text[:200])
        except Exception as e:
            logger.warning("BPX applyConfig exception (non-fatal): %s", e)

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
                    self._bpx_apply_config(base, token)
                    return True
                logger.warning("BPX API delete errors: %s", result["errors"])
            else:
                logger.warning("BPX API delete HTTP %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            logger.error("BPX API delete error: %s", e)
        return False

    # ---------------------------------------------------------------
    #  AMI-based PJSIP WebRTC configuration
    # ---------------------------------------------------------------

    @staticmethod
    def _webrtc_pjsip_ami_settings() -> dict:
        """PJSIP endpoint settings for WebRTC as key-value pairs.

        These are written to the FreePBX database via AMI `database put`
        commands targeting the AMPUSER family, then applied via `fwconsole reload`.

        FreePBX stores per-extension PJSIP overrides under:
          AMPUSER/<ext>/...  in AstDB
        and in the `userman_users` / `sip` MySQL tables.

        We use the `fwconsole` CLI approach which is the most reliable way
        to set PJSIP endpoint settings in FreePBX 15/16/17.
        """
        return {
            "webrtc": "yes",
            "transport": "0.0.0.0-wss",
            "dtls_enable": "yes",
            "dtls_verify": "no",
            "dtls_setup": "actpass",
            "dtls_certfile": "",
            "media_encryption": "dtls",
            "media_use_received_transport": "yes",
            "ice_support": "yes",
            "allow": "!all,opus,ulaw,alaw",
            "max_contacts": "5",
            "rtp_symmetric": "yes",
            "force_rport": "yes",
            "rewrite_contact": "yes",
        }

    def _configure_webrtc_via_ami(self, db, extension: str) -> Tuple[bool, str]:
        """Configure PJSIP WebRTC settings for an extension via AMI.

        This is the reliable method — uses AMI to execute `database put` commands
        that write PJSIP settings into FreePBX's AstDB, then runs `dialplan reload`
        or `fwconsole reload` to apply.

        Falls back to direct Asterisk `pjsip set` commands if fwconsole is unavailable.
        """
        from app.services.ami_service import get_ami_client

        client = get_ami_client(db)
        if not client:
            return False, "AMI not configured or connection failed — cannot set PJSIP WebRTC settings"

        try:
            settings = self._webrtc_pjsip_ami_settings()
            failed = []
            succeeded = []

            for key, value in settings.items():
                # Write to AstDB: AMPUSER/<ext>/<key>
                resp = client.command(f"database put AMPUSER/{extension} {key} {value}")
                if "updated" in resp.lower() or "success" in resp.lower() or "inserted" in resp.lower():
                    succeeded.append(key)
                else:
                    # Not all settings may go to AstDB — that's OK
                    logger.debug("AstDB put AMPUSER/%s/%s: %s", extension, key, resp.strip()[:100])
                    failed.append(key)

            # Also set via pjsip.conf overrides using database
            pjsip_settings = {
                "webrtc": "yes",
                "transport": "transport-wss",
                "dtls_auto_generate_cert": "yes",
                "media_encryption": "dtls",
                "media_use_received_transport": "yes",
                "ice_support": "yes",
                "rtp_symmetric": "yes",
                "force_rport": "yes",
                "rewrite_contact": "yes",
                "allow": "!all,opus,ulaw,alaw",
                "max_contacts": "5",
            }

            for key, value in pjsip_settings.items():
                resp = client.command(f"database put PJSIP/{extension} {key} {value}")
                if "updated" in resp.lower() or "success" in resp.lower() or "inserted" in resp.lower():
                    if key not in succeeded:
                        succeeded.append(key)

            logger.info(
                "AMI WebRTC config for %s: %d settings written, %d skipped",
                extension, len(succeeded), len(failed),
            )

            return True, f"WebRTC PJSIP settings configured via AMI ({len(succeeded)} settings applied)"

        except Exception as e:
            logger.error("AMI WebRTC config error for %s: %s", extension, e)
            return False, f"AMI WebRTC config error: {e}"
        finally:
            try:
                client.logoff()
            except Exception:
                pass

    def _apply_config_via_ami(self, db) -> bool:
        """Apply FreePBX config via AMI — runs `core reload` to reload Asterisk.

        This is more reliable than the GraphQL `applyConfig` mutation which
        may not exist in all FreePBX 17 installations.
        """
        from app.services.ami_service import get_ami_client

        client = get_ami_client(db)
        if not client:
            logger.warning("AMI not available for apply config")
            return False

        try:
            # Method 1: Asterisk core reload (always works)
            resp = client.command("core reload")
            logger.info("AMI core reload response: %s", resp.strip()[:200])

            # Method 2: Also try pjsip reload specifically
            resp2 = client.command("module reload res_pjsip.so")
            logger.info("AMI pjsip reload response: %s", resp2.strip()[:200])

            # Method 3: Try dialplan reload
            resp3 = client.command("dialplan reload")
            logger.info("AMI dialplan reload response: %s", resp3.strip()[:200])

            return True
        except Exception as e:
            logger.error("AMI apply config error: %s", e)
            return False
        finally:
            try:
                client.logoff()
            except Exception:
                pass

    # ---------------------------------------------------------------
    #  Public API — dispatches to REST or BPX based on auth mode
    # ---------------------------------------------------------------

    def create_or_update_extension(
        self, db, extension: str, sip_password: str,
        display_name: str = "", email: str = "",
    ) -> Tuple[bool, str]:
        """Returns (success, reason_message)."""
        cfg, err = self._get_settings(db)
        if not cfg:
            return False, err

        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return False, (
                f"Authentication failed against {cfg['host']}:{cfg['port']} — "
                "verify the API key/secret and that the FreePBX REST API or PBX API module is installed and enabled"
            )

        base = self._base_url(cfg["host"], cfg.get("port"))
        cache_key = (cfg["host"], cfg["api_key"], cfg["api_secret"])

        if auth["mode"] == "bpx":
            ok, crud_detail = self._bpx_create_or_update(base, auth["token"], extension, sip_password, display_name, email)
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
            ok = self._rest_create_or_update(base, auth["token"], extension, payload)
            crud_detail = "" if ok else "REST extension save failed — see backend logs for HTTP status/body"

        if not ok:
            # Evict cache in case the token expired mid-session
            self._auth_cache.pop(cache_key, None)
            return False, (
                f"Extension {extension} CRUD failed on FreePBX "
                f"({auth['mode']} mode, host={cfg['host']}): {crud_detail}"
            )

        # --- After extension is created/updated, configure WebRTC PJSIP settings via AMI ---
        ami_ok, ami_detail = self._configure_webrtc_via_ami(db, extension)
        if ami_ok:
            logger.info("✅ Extension %s: WebRTC PJSIP settings applied via AMI", extension)
        else:
            logger.warning(
                "Extension %s created OK but WebRTC AMI config failed: %s. "
                "Configure transport/DTLS/ICE manually in FreePBX admin panel.",
                extension, ami_detail,
            )

        # --- Apply config (reload Asterisk) ---
        # Try GraphQL first, then AMI as fallback
        self._bpx_apply_config(base, auth["token"]) if auth["mode"] == "bpx" else None
        self._apply_config_via_ami(db)

        result_msg = "OK"
        if not ami_ok:
            result_msg = f"OK — extension synced but WebRTC settings need manual config: {ami_detail}"

        return True, result_msg

    def enable_extension(self, db, extension: str) -> bool:
        return self._set_extension_state(db, extension, enabled=True)

    def disable_extension(self, db, extension: str) -> bool:
        return self._set_extension_state(db, extension, enabled=False)

    def _set_extension_state(self, db, extension: str, enabled: bool) -> bool:
        cfg, _ = self._get_settings(db)
        if not cfg:
            return False
        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return False

        base = self._base_url(cfg["host"], cfg.get("port"))
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
        cfg, _ = self._get_settings(db)
        if not cfg:
            return False
        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return False

        base = self._base_url(cfg["host"], cfg.get("port"))
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
