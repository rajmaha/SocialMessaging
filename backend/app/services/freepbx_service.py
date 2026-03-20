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
    #  SSH-based PJSIP configuration (most reliable for FreePBX 17)
    # ---------------------------------------------------------------

    def _get_ssh_settings(self, db) -> Tuple[Optional[dict], Optional[str]]:
        """Load SSH connection settings from DB."""
        try:
            from app.models.telephony import TelephonySettings
            settings = db.query(TelephonySettings).first()
            if not settings or not settings.host:
                return None, "No telephony settings found"
            if not settings.ssh_username or not settings.ssh_password:
                return None, "SSH credentials not configured — set SSH username and password in Telephony Settings"

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
            if ":" in host:
                host = host.split(":")[0]

            return {
                "host": host,
                "port": settings.ssh_port or 22,
                "username": settings.ssh_username,
                "password": settings.ssh_password,
            }, None
        except Exception as e:
            return None, f"Error reading SSH settings: {e}"

    def _configure_webrtc_via_ssh(self, db, extension: str) -> Tuple[bool, str]:
        """Configure WebRTC PJSIP settings by SSHing into FreePBX and running MySQL + fwconsole reload.

        This is the most reliable approach for FreePBX 17 since the GraphQL API
        doesn't expose PJSIP endpoint fields and the web form login requires
        admin panel credentials (not OAuth2).
        """
        ssh_cfg, err = self._get_ssh_settings(db)
        if not ssh_cfg:
            return False, err

        # SQL to write all WebRTC PJSIP settings into the pjsip table
        sql_rows = [
            ("webrtc", "yes"),
            ("avpf", "yes"),
            ("force_avp", "yes"),
            ("icesupport", "yes"),
            ("media_encryption", "dtls"),
            ("media_encryption_optimistic", "yes"),
            ("dtls_auto_generate_cert", "yes"),
            ("dtls_verify", "fingerprint"),
            ("dtls_setup", "actpass"),
            ("media_use_received_transport", "yes"),
            ("rtcp_mux", "yes"),
            ("rtp_symmetric", "yes"),
            ("transport", "0.0.0.0-wss"),
            ("disallow", "all"),
            ("allow", "opus,ulaw,alaw"),
            ("force_rport", "yes"),
            ("rewrite_contact", "yes"),
            ("direct_media", "no"),
            ("max_contacts", "5"),
        ]

        values_sql = ", ".join(
            f"('{extension}', '{kw}', '{val}', 0)"
            for kw, val in sql_rows
        )
        sql = f"REPLACE INTO pjsip (id, keyword, data, flags) VALUES {values_sql};"
        mysql_cmd = f'mysql asterisk -e "{sql}"'

        try:
            import paramiko
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=ssh_cfg["host"],
                port=ssh_cfg["port"],
                username=ssh_cfg["username"],
                password=ssh_cfg["password"],
                timeout=15,
            )

            # Step 1: Write PJSIP settings to MySQL
            stdin, stdout, stderr = client.exec_command(mysql_cmd, timeout=15)
            exit_code = stdout.channel.recv_exit_status()
            err_output = stderr.read().decode(errors="ignore").strip()

            if exit_code != 0:
                client.close()
                return False, f"MySQL command failed (exit {exit_code}): {err_output}"

            logger.info("✅ SSH: wrote %d PJSIP WebRTC settings for extension %s", len(sql_rows), extension)

            # Step 2: Apply Config — MUST use fwconsole reload to regenerate config files from DB.
            # FreePBX stores settings in MySQL `pjsip` table, but Asterisk reads from config files.
            # fwconsole reload: reads MySQL → generates /etc/asterisk/pjsip_additional.conf → reloads Asterisk.
            # asterisk -rx 'module reload' only re-reads existing conf files (won't pick up our MySQL changes).
            reload_strategies = [
                # Strategy A: fwconsole reload (REQUIRED — regenerates config files from MySQL)
                ("fwconsole reload", "fwconsole reload"),
                # Strategy B: If fwconsole fails, try direct Asterisk reload as fallback
                ("asterisk -rx 'module reload res_pjsip.so'", "Asterisk PJSIP module reload"),
                # Strategy C: Full Asterisk core reload
                ("asterisk -rx 'core reload'", "Asterisk core reload"),
            ]

            reload_success = False
            reload_method = ""
            last_err = ""

            for cmd, label in reload_strategies:
                logger.info("SSH: trying %s …", label)
                stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
                r_exit = stdout.channel.recv_exit_status()
                r_out = stdout.read().decode(errors="ignore").strip()
                r_err = stderr.read().decode(errors="ignore").strip()

                if r_exit == 0:
                    logger.info("✅ SSH: %s succeeded for extension %s", label, extension)
                    reload_success = True
                    reload_method = label
                    break
                else:
                    logger.warning("SSH: %s exit %d: %s %s", label, r_exit, r_out, r_err)
                    last_err = f"{label} exit {r_exit}: {r_out} {r_err}"

            client.close()

            if not reload_success:
                logger.warning("SSH: all reload strategies failed for extension %s. Last: %s", extension, last_err)
                return True, f"PJSIP settings written but reload failed ({last_err}). Click Apply Config in FreePBX admin."

            return True, f"WebRTC PJSIP settings configured + {reload_method} done ({len(sql_rows)} settings)"

        except ImportError:
            return False, "paramiko not installed — run: pip install paramiko"
        except Exception as e:
            logger.error("SSH PJSIP config error for %s: %s", extension, e)
            return False, f"SSH error: {e}"

    # ---------------------------------------------------------------
    #  FreePBX admin web session — configure PJSIP via form POST
    # ---------------------------------------------------------------

    def _get_freepbx_web_session(self, db) -> Tuple[Optional[requests.Session], str, str]:
        """Login to FreePBX admin and return (session, base_url, error).

        Returns (session, base, "") on success or (None, "", error_msg) on failure.
        """
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        cfg, err = self._get_settings(db)
        if not cfg:
            return None, "", f"No telephony settings: {err}"

        base = self._base_url(cfg["host"], cfg.get("port"))
        username = cfg["api_key"]
        password = cfg["api_secret"]

        try:
            session = requests.Session()
            session.verify = False
            session.get(f"{base}/admin/config.php", timeout=10)
            login_resp = session.post(
                f"{base}/admin/config.php",
                data={"username": username, "password": password, "submit": "Login"},
                headers={"Referer": f"{base}/admin/config.php"},
                allow_redirects=True, timeout=10,
            )
            if not any(k in login_resp.text.lower() for k in ("logout", "dashboard", "fpbx_csrf")):
                return None, base, "FreePBX admin login failed — check credentials"
            return session, base, ""
        except Exception as e:
            return None, base, f"FreePBX login error: {e}"

    def scrape_extension_form(self, db, extension: str) -> dict:
        """Scrape the FreePBX extension edit page and return all form field names + values.

        This is used for diagnostics — shows the REAL form field names so we can
        configure them correctly.
        """
        import re
        session, base, err = self._get_freepbx_web_session(db)
        if not session:
            return {"status": "error", "message": err}

        try:
            ext_page = session.get(
                f"{base}/admin/config.php",
                params={"display": "extensions", "extdisplay": extension},
                timeout=10,
            )

            # Parse all form inputs (input, select, textarea)
            fields = {}

            # Input fields: <input name="..." value="..." />
            for m in re.finditer(
                r'<input[^>]+name=["\']([^"\']+)["\'][^>]*value=["\']([^"\']*)["\']',
                ext_page.text, re.IGNORECASE,
            ):
                fields[m.group(1)] = m.group(2)

            # Also capture inputs where value comes before name
            for m in re.finditer(
                r'<input[^>]+value=["\']([^"\']*)["\'][^>]*name=["\']([^"\']+)["\']',
                ext_page.text, re.IGNORECASE,
            ):
                if m.group(2) not in fields:
                    fields[m.group(2)] = m.group(1)

            # Select fields with selected option
            for m in re.finditer(
                r'<select[^>]+name=["\']([^"\']+)["\'].*?</select>',
                ext_page.text, re.IGNORECASE | re.DOTALL,
            ):
                select_name = m.group(1)
                selected = re.search(r'<option[^>]+selected[^>]*value=["\']([^"\']*)["\']', m.group(0))
                if not selected:
                    selected = re.search(r'<option[^>]*value=["\']([^"\']*)["\'][^>]*selected', m.group(0))
                if selected:
                    fields[select_name] = selected.group(1)

            # Filter to WebRTC-relevant fields
            webrtc_keywords = [
                "webrtc", "dtls", "transport", "media_encryption", "ice", "avpf",
                "rtcp_mux", "rtp_symmetric", "force_rport", "rewrite_contact",
                "direct_media", "allow", "disallow", "max_contacts", "secret",
                "codec", "media_use", "force_avp", "encryption",
            ]
            webrtc_fields = {
                k: v for k, v in fields.items()
                if any(kw in k.lower() for kw in webrtc_keywords)
            }

            return {
                "status": "success",
                "extension": extension,
                "total_fields": len(fields),
                "webrtc_fields": webrtc_fields,
                "all_fields": fields,
            }
        except Exception as e:
            return {"status": "error", "message": f"Scrape error: {e}"}

    def _configure_webrtc_via_web(self, db, extension: str, sip_password: str,
                                   display_name: str = "") -> Tuple[bool, str]:
        """Configure WebRTC PJSIP settings by POSTing to FreePBX admin web UI.

        Approach: scrape the extension edit form to get the REAL field names,
        then modify WebRTC-related fields and submit.
        """
        import re

        session, base, err = self._get_freepbx_web_session(db)
        if not session:
            return False, err

        try:
            logger.info("FreePBX admin login OK for WebRTC config of extension %s", extension)

            # Step 1: Load the extension edit page — get ALL current form fields
            ext_page = session.get(
                f"{base}/admin/config.php",
                params={"display": "extensions", "extdisplay": extension},
                timeout=10,
            )

            if extension not in ext_page.text:
                return False, f"Extension {extension} not found on FreePBX edit page"

            # Step 2: Parse ALL form fields (preserve existing values)
            form_data = {}

            # Input fields
            for m in re.finditer(
                r'<input[^>]+name=["\']([^"\']+)["\'][^>]*value=["\']([^"\']*)["\']',
                ext_page.text, re.IGNORECASE,
            ):
                name, value = m.group(1), m.group(2)
                if name not in form_data:
                    form_data[name] = value

            for m in re.finditer(
                r'<input[^>]+value=["\']([^"\']*)["\'][^>]*name=["\']([^"\']+)["\']',
                ext_page.text, re.IGNORECASE,
            ):
                name, value = m.group(2), m.group(1)
                if name not in form_data:
                    form_data[name] = value

            # Select fields with selected option
            for m in re.finditer(
                r'<select[^>]+name=["\']([^"\']+)["\'].*?</select>',
                ext_page.text, re.IGNORECASE | re.DOTALL,
            ):
                select_name = m.group(1)
                selected = re.search(r'<option[^>]+selected[^>]*value=["\']([^"\']*)["\']', m.group(0))
                if not selected:
                    selected = re.search(r'<option[^>]*value=["\']([^"\']*)["\'][^>]*selected', m.group(0))
                if selected and select_name not in form_data:
                    form_data[select_name] = selected.group(1)

            logger.info("FreePBX form for %s: parsed %d fields", extension, len(form_data))

            # Log the WebRTC-relevant field names we found
            webrtc_keys = [k for k in form_data if any(
                kw in k.lower() for kw in ["webrtc", "dtls", "transport", "media_enc", "ice", "avpf",
                                             "rtcp_mux", "rtp_sym", "allow", "disallow", "max_contact",
                                             "codec", "media_use", "force_avp", "encryption", "secret"]
            )]
            logger.info("FreePBX WebRTC-related fields for %s: %s", extension, webrtc_keys)

            # Step 3: Override WebRTC settings — map known patterns
            # We try multiple field name patterns since FreePBX versions differ
            webrtc_overrides = {
                # WebRTC toggle
                "devinfo_webrtc": "yes",
                "webrtc": "yes",
                # Transport
                "devinfo_transport": "0.0.0.0-wss",
                "transport": "0.0.0.0-wss",
                # DTLS
                "devinfo_dtls_enable": "yes",
                "dtls_enable": "yes",
                "devinfo_dtls_auto_generate_cert": "yes",
                "dtls_auto_generate_cert": "yes",
                "devinfo_dtls_verify": "fingerprint",
                "dtls_verify": "fingerprint",
                "devinfo_dtls_setup": "actpass",
                "dtls_setup": "actpass",
                # Media encryption
                "devinfo_media_encryption": "dtls",
                "media_encryption": "dtls",
                "devinfo_media_encryption_optimistic": "yes",
                "devinfo_media_use_received_transport": "yes",
                "media_use_received_transport": "yes",
                # ICE / AVPF / RTP
                "devinfo_icesupport": "yes",
                "icesupport": "yes",
                "devinfo_avpf": "yes",
                "avpf": "yes",
                "devinfo_force_avp": "yes",
                "force_avp": "yes",
                "devinfo_rtcp_mux": "yes",
                "rtcp_mux": "yes",
                "devinfo_rtp_symmetric": "yes",
                "rtp_symmetric": "yes",
                # NAT
                "devinfo_force_rport": "yes",
                "force_rport": "yes",
                "devinfo_rewrite_contact": "yes",
                "rewrite_contact": "yes",
                "devinfo_direct_media": "no",
                "direct_media": "no",
                # Codecs
                "devinfo_disallow": "all",
                "devinfo_allow": "opus,ulaw,alaw",
                # Contacts
                "devinfo_max_contacts": "5",
                "max_contacts": "5",
            }

            # Only apply overrides for fields that actually exist in the form
            applied = []
            for field_name, value in webrtc_overrides.items():
                if field_name in form_data:
                    old_val = form_data[field_name]
                    form_data[field_name] = value
                    if old_val != value:
                        applied.append(f"{field_name}: {old_val} → {value}")

            logger.info("FreePBX WebRTC overrides applied for %s: %s", extension, applied)

            # Ensure action=edit and Submit are set
            form_data["action"] = "edit"
            form_data["Submit"] = "Submit"

            # Step 4: Submit the form
            edit_resp = session.post(
                f"{base}/admin/config.php",
                data=form_data,
                headers={"Referer": f"{base}/admin/config.php?display=extensions&extdisplay={extension}"},
                allow_redirects=True, timeout=15,
            )

            if edit_resp.status_code in (200, 302):
                logger.info("✅ FreePBX form POST succeeded for extension %s (%d fields applied)", extension, len(applied))
            else:
                logger.warning("FreePBX form POST HTTP %s for %s", edit_resp.status_code, extension)

            # Step 5: Apply Config
            apply_resp = session.get(
                f"{base}/admin/config.php",
                params={"handler": "reload"},
                timeout=30,
            )
            logger.info("FreePBX Apply Config: HTTP %s", apply_resp.status_code)

            if not applied:
                return True, "Form submitted but no WebRTC fields were found to override — field names may differ. Use /admin/telephony/scrape-form to check."

            return True, f"WebRTC PJSIP settings configured ({len(applied)} fields changed)"

        except Exception as e:
            logger.error("FreePBX web session error for %s: %s", extension, e)
            return False, f"FreePBX web session error: {e}"

    def _apply_config_via_web(self, db) -> bool:
        """Apply FreePBX config by triggering reload via admin web session."""
        cfg, err = self._get_settings(db)
        if not cfg:
            return False

        base = self._base_url(cfg["host"], cfg.get("port"))
        username = cfg["api_key"]
        password = cfg["api_secret"]

        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

            session = requests.Session()
            session.verify = False

            # Login
            session.get(f"{base}/admin/config.php", timeout=10)
            session.post(
                f"{base}/admin/config.php",
                data={"username": username, "password": password, "submit": "Login"},
                headers={"Referer": f"{base}/admin/config.php"},
                allow_redirects=True, timeout=10,
            )

            # Trigger Apply Config
            resp = session.get(
                f"{base}/admin/config.php",
                params={"handler": "reload"},
                timeout=30,
            )
            logger.info("FreePBX Apply Config via web: HTTP %s", resp.status_code)
            return resp.status_code == 200

        except Exception as e:
            logger.error("FreePBX Apply Config web error: %s", e)
            return False

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

        # --- After extension is created/updated, configure WebRTC PJSIP settings ---
        # Strategy 1: SSH (most reliable — writes directly to MySQL + fwconsole reload)
        ssh_ok, ssh_detail = self._configure_webrtc_via_ssh(db, extension)
        if ssh_ok:
            logger.info("✅ Extension %s: WebRTC PJSIP settings applied via SSH", extension)
            return True, ssh_detail

        logger.info("SSH PJSIP config not available for %s (%s), trying web session…", extension, ssh_detail)

        # Strategy 2: FreePBX admin web session (form POST)
        web_ok, web_detail = self._configure_webrtc_via_web(
            db, extension, sip_password, display_name,
        )
        if web_ok:
            logger.info("✅ Extension %s: WebRTC PJSIP settings applied via web session", extension)
            return True, web_detail

        logger.warning(
            "Extension %s created OK but WebRTC config failed (SSH: %s, Web: %s). "
            "Configure transport/DTLS/ICE manually in FreePBX admin panel.",
            extension, ssh_detail, web_detail,
        )
        # Try GraphQL apply config as a last resort
        if auth["mode"] == "bpx":
            self._bpx_apply_config(base, auth["token"])

        return True, f"OK — extension synced but WebRTC settings need manual config. SSH: {ssh_detail}. Web: {web_detail}"

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
