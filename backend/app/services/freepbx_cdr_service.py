"""
FreePBX CDR (Call Detail Records) Sync Service
Polls the FreePBX REST API for completed call records and imports
them into the local call_recordings table automatically.

FreePBX CDR API endpoint:
  GET /api/rest/cdr?limit=100&offset=0&order=calldate+DESC

Each CDR record fields used:
  uniqueid     — Asterisk unique call ID (maps to pbx_call_id)
  src          — caller number
  dst          — destination (extension or external number)
  disposition  — ANSWERED, NO ANSWER, BUSY, FAILED
  billsec      — billed seconds (actual talk time)
  duration     — total call duration
  calldate     — timestamp
  recordingfile — filename of recording in /var/spool/asterisk/monitor/
  channel      — SIP channel (helps match agent extension)
"""

import logging
from typing import Optional, List, Dict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class FreePBXCDRService:
    """Polls FreePBX CDR API and syncs call records into the local DB."""

    def _get_settings(self, db) -> Optional[Dict]:
        """Load FreePBX connection settings from DB."""
        try:
            from app.models.telephony import TelephonySettings
            settings = db.query(TelephonySettings).first()
            if not settings or not settings.host or not settings.freepbx_api_key:
                return None
            return {
                "host": settings.host,
                "port": settings.freepbx_port or 443,
                "api_key": settings.freepbx_api_key,
                "api_secret": settings.freepbx_api_secret,
            }
        except Exception as e:
            logger.error("Error reading TelephonySettings for CDR: %s", e)
            return None

    def _get_auth(self, host: str, port: int, api_key: str, api_secret: str) -> Optional[dict]:
        """Get auth info (token + mode) from FreePBX."""
        try:
            from app.services.freepbx_service import freepbx_service
            return freepbx_service._get_auth(host, port, api_key, api_secret)
        except Exception as e:
            logger.error("CDR: failed to get FreePBX auth: %s", e)
            return None

    def _base_url(self, host: str, port: int = None) -> str:
        try:
            from app.services.freepbx_service import freepbx_service
            return freepbx_service._base_url(host, port)
        except Exception:
            if host.startswith("http"):
                return host.rstrip("/")
            return f"https://{host.rstrip('/')}"

    def _get_ssh_settings(self, db) -> Optional[Dict]:
        """Load SSH settings for CDR fetch via SSH."""
        try:
            from app.models.telephony import TelephonySettings
            settings = db.query(TelephonySettings).first()
            if not settings or not settings.ssh_username or not settings.ssh_password:
                return None
            host = (settings.ssh_host or settings.host or "").rstrip("/")
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
            }
        except Exception:
            return None

    def fetch_recent_cdrs(self, db, since_minutes: int = 10) -> List[Dict]:
        """
        Fetch CDR records from FreePBX for the last N minutes.
        Tries SSH (direct MySQL query) first, then GraphQL, then REST API.
        Returns a list of raw CDR dicts.
        """
        # Strategy 1: SSH — most reliable, works with any FreePBX version
        ssh_cdrs = self._fetch_cdrs_via_ssh(db, since_minutes)
        if ssh_cdrs is not None:
            return ssh_cdrs

        cfg = self._get_settings(db)
        if not cfg:
            return []

        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return []

        base = self._base_url(cfg["host"], cfg.get("port"))
        token = auth["token"]

        # Strategy 2: GraphQL (FreePBX 17 BPX API)
        if auth["mode"] == "bpx":
            cdrs = self._fetch_cdrs_via_graphql(base, token, since_minutes)
            if cdrs is not None:
                return cdrs

        # Strategy 3: REST API (FreePBX 15/16)
        return self._fetch_cdrs_via_rest(base, token, since_minutes)

    def _fetch_cdrs_via_ssh(self, db, since_minutes: int) -> Optional[List[Dict]]:
        """Fetch CDRs by SSHing into FreePBX and querying MySQL directly."""
        ssh_cfg = self._get_ssh_settings(db)
        if not ssh_cfg:
            return None

        try:
            import paramiko
            import json

            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=ssh_cfg["host"],
                port=ssh_cfg["port"],
                username=ssh_cfg["username"],
                password=ssh_cfg["password"],
                timeout=10,
            )

            # Query CDR table directly — output as tab-separated for easy parsing
            sql = (
                f"SELECT uniqueid, src, dst, disposition, billsec, duration, "
                f"calldate, recordingfile, channel FROM cdr "
                f"WHERE calldate >= DATE_SUB(NOW(), INTERVAL {since_minutes} MINUTE) "
                f"ORDER BY calldate DESC LIMIT 200"
            )
            cmd = f'mysql asteriskcdrdb -N -B -e "{sql}"'
            stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
            exit_code = stdout.channel.recv_exit_status()
            output = stdout.read().decode(errors="ignore").strip()
            client.close()

            if exit_code != 0 or not output:
                return None if exit_code != 0 else []

            cdrs = []
            for line in output.split("\n"):
                if not line.strip():
                    continue
                parts = line.split("\t")
                if len(parts) >= 7:
                    cdrs.append({
                        "uniqueid": parts[0],
                        "src": parts[1],
                        "dst": parts[2],
                        "disposition": parts[3],
                        "billsec": parts[4],
                        "duration": parts[5],
                        "calldate": parts[6],
                        "recordingfile": parts[7] if len(parts) > 7 else "",
                        "channel": parts[8] if len(parts) > 8 else "",
                    })
            logger.debug("CDR SSH: fetched %d records", len(cdrs))
            return cdrs

        except ImportError:
            return None
        except Exception as e:
            logger.debug("CDR SSH fetch failed (will try API): %s", e)
            return None

    def _fetch_cdrs_via_graphql(self, base: str, token: str, since_minutes: int) -> Optional[List[Dict]]:
        """Fetch CDRs via FreePBX 17 GraphQL API."""
        try:
            import requests
            query = """
            query fetchCdrs($limit: Int) {
              fetchCdrs(limit: $limit) {
                uniqueid
                src
                dst
                disposition
                billsec
                duration
                calldate
                recordingfile
                channel
              }
            }
            """
            resp = requests.post(
                f"{base}/admin/api/api/gql",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={"query": query, "variables": {"limit": 200}},
                timeout=15,
                verify=False,
            )
            if resp.status_code == 200:
                data = resp.json()
                if not data.get("errors"):
                    cdrs = (data.get("data") or {}).get("fetchCdrs") or []
                    # Filter to recent
                    cutoff = datetime.utcnow() - timedelta(minutes=since_minutes)
                    recent = []
                    for cdr in cdrs:
                        try:
                            calldate_str = cdr.get("calldate", "")
                            if calldate_str:
                                calldate = datetime.strptime(calldate_str[:19], "%Y-%m-%d %H:%M:%S")
                                if calldate >= cutoff:
                                    recent.append(cdr)
                        except Exception:
                            recent.append(cdr)
                    logger.debug("CDR GraphQL: fetched %d records", len(recent))
                    return recent
                # GraphQL errors — query might not exist, fall through
                logger.debug("CDR GraphQL errors: %s", data.get("errors"))
            return None
        except Exception as e:
            logger.debug("CDR GraphQL fetch failed: %s", e)
            return None

    def _fetch_cdrs_via_rest(self, base: str, token: str, since_minutes: int) -> List[Dict]:
        """Fetch CDRs via FreePBX 15/16 REST API."""
        try:
            import requests
            resp = requests.get(
                f"{base}/api/rest/cdr",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": 200, "order": "calldate DESC"},
                timeout=15,
                verify=False,
            )
            if resp.status_code != 200:
                logger.debug("FreePBX CDR REST API returned %s", resp.status_code)
                return []

            data = resp.json()
            cdrs = data.get("data", data) if isinstance(data, dict) else data
            if not isinstance(cdrs, list):
                return []

            cutoff = datetime.utcnow() - timedelta(minutes=since_minutes)
            recent = []
            for cdr in cdrs:
                try:
                    calldate_str = cdr.get("calldate", "")
                    if calldate_str:
                        calldate = datetime.strptime(calldate_str[:19], "%Y-%m-%d %H:%M:%S")
                        if calldate >= cutoff:
                            recent.append(cdr)
                except Exception:
                    recent.append(cdr)
            return recent
        except Exception as e:
            logger.error("Error fetching CDRs via REST: %s", e)
            return []

    def get_recording_stream_url(self, db, recording_file: str) -> Optional[str]:
        """
        Returns the FreePBX REST API URL to stream a recording file.
        Clients should use /calls/recordings/{id}/stream which proxies this.
        """
        cfg = self._get_settings(db)
        if not cfg or not recording_file:
            return None
        base = self._base_url(cfg["host"], cfg.get("port"))
        return f"{base}/api/rest/recording/{recording_file}"

    def stream_recording(self, db, recording_file: str):
        """
        Fetch a recording file bytes from FreePBX.
        Tries SSH (SCP) first, then REST API.
        Returns (bytes_content, content_type) or (None, None) on failure.
        """
        if not recording_file:
            return None, None

        # Strategy 1: SSH — fetch file directly from disk
        ssh_result = self._stream_recording_via_ssh(db, recording_file)
        if ssh_result[0] is not None:
            return ssh_result

        # Strategy 2: REST API
        cfg = self._get_settings(db)
        if not cfg:
            return None, None

        auth = self._get_auth(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not auth:
            return None, None

        try:
            import requests
            base = self._base_url(cfg["host"], cfg.get("port"))
            resp = requests.get(
                f"{base}/api/rest/recording/{recording_file}",
                headers={"Authorization": f"Bearer {auth['token']}"},
                timeout=30,
                verify=False,
                stream=True,
            )
            if resp.status_code == 200:
                content_type = resp.headers.get("Content-Type", "audio/wav")
                return resp.content, content_type
            else:
                logger.warning("FreePBX recording fetch failed [%s]: %s", resp.status_code, recording_file)
                return None, None
        except Exception as e:
            logger.error("Error streaming recording %s: %s", recording_file, e)
            return None, None

    def _stream_recording_via_ssh(self, db, recording_file: str):
        """Fetch recording file via SSH/SFTP from FreePBX server."""
        ssh_cfg = self._get_ssh_settings(db)
        if not ssh_cfg:
            return None, None

        # Common recording paths on FreePBX
        search_paths = [
            f"/var/spool/asterisk/monitor/{recording_file}",
            f"/var/spool/asterisk/monitor/{datetime.utcnow().strftime('%Y/%m/%d')}/{recording_file}",
        ]

        try:
            import paramiko
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=ssh_cfg["host"],
                port=ssh_cfg["port"],
                username=ssh_cfg["username"],
                password=ssh_cfg["password"],
                timeout=10,
            )
            sftp = client.open_sftp()

            for path in search_paths:
                try:
                    with sftp.open(path, "rb") as f:
                        data = f.read()
                    sftp.close()
                    client.close()
                    ext = recording_file.rsplit(".", 1)[-1].lower() if "." in recording_file else "wav"
                    content_type = {"wav": "audio/wav", "mp3": "audio/mpeg", "gsm": "audio/x-gsm"}.get(ext, "audio/wav")
                    return data, content_type
                except FileNotFoundError:
                    continue

            sftp.close()
            client.close()
            return None, None
        except Exception:
            return None, None

    def sync_cdrs_to_db(self, db) -> int:
        """
        Main sync method — called by scheduler every few minutes.
        Pulls recent CDRs from FreePBX and inserts new ones into call_recordings.
        Returns the count of new records inserted.
        """
        from app.models.call_records import CallRecording
        from app.models.agent_extension import AgentExtension
        from app.models.user import User
        from app.models.organization import Organization, OrganizationContact
        from app.models.email import Contact
        from sqlalchemy import cast, String

        cdrs = self.fetch_recent_cdrs(db, since_minutes=15)
        if not cdrs:
            return 0

        # Build extension→user_id map for fast lookup
        ext_to_user: Dict[str, int] = {}
        ext_to_name: Dict[str, str] = {}
        try:
            exts = db.query(AgentExtension).all()
            for e in exts:
                if e.user:
                    ext_to_user[e.extension] = e.user_id
                    ext_to_name[e.extension] = (
                        e.user.display_name or e.user.full_name or e.user.email.split("@")[0]
                    )
        except Exception as ex:
            logger.warning("Could not build extension map: %s", ex)

        inserted = 0
        for cdr in cdrs:
            try:
                pbx_call_id = str(cdr.get("uniqueid", ""))
                if not pbx_call_id:
                    continue

                # Skip if already imported
                existing = db.query(CallRecording).filter(
                    CallRecording.pbx_call_id == pbx_call_id
                ).first()
                if existing:
                    continue

                # Only import ANSWERED calls (skip NO ANSWER, BUSY, FAILED)
                disposition = cdr.get("disposition", "").upper()
                if disposition not in ("ANSWERED",):
                    continue

                # Determine direction and phone number
                src = cdr.get("src", "")
                dst = cdr.get("dst", "")
                duration = int(cdr.get("billsec", cdr.get("duration", 0)))
                recording_file = cdr.get("recordingfile", "")

                # Parse call date
                calldate_str = cdr.get("calldate", "")
                try:
                    call_dt = datetime.strptime(calldate_str[:19], "%Y-%m-%d %H:%M:%S")
                except Exception:
                    call_dt = datetime.utcnow()

                # Build list of records to create for this CDR.
                # Internal-to-internal calls produce TWO records:
                #   outbound for the caller + inbound for the receiver.
                # External calls produce one record as before.
                records_to_add = []
                src_is_internal = src in ext_to_user
                dst_is_internal = dst in ext_to_user

                if src_is_internal and dst_is_internal:
                    # Internal-to-internal: create record for both parties
                    records_to_add.append({
                        "direction": "outbound",
                        "phone_number": dst,
                        "agent_id": ext_to_user.get(src),
                        "agent_name": ext_to_name.get(src, ""),
                        "pbx_call_id": pbx_call_id,
                    })
                    records_to_add.append({
                        "direction": "inbound",
                        "phone_number": src,
                        "agent_id": ext_to_user.get(dst),
                        "agent_name": ext_to_name.get(dst, ""),
                        "pbx_call_id": f"{pbx_call_id}-rcv",  # unique ID for receiver record
                    })
                elif src_is_internal:
                    # Outbound to external number
                    records_to_add.append({
                        "direction": "outbound",
                        "phone_number": dst,
                        "agent_id": ext_to_user.get(src),
                        "agent_name": ext_to_name.get(src, ""),
                        "pbx_call_id": pbx_call_id,
                    })
                else:
                    # Inbound from external number
                    records_to_add.append({
                        "direction": "inbound",
                        "phone_number": src,
                        "agent_id": ext_to_user.get(dst),
                        "agent_name": ext_to_name.get(dst, ""),
                        "pbx_call_id": pbx_call_id,
                    })

                for rec_data in records_to_add:
                    # Skip if this specific record already exists (handles -rcv suffix)
                    if rec_data["pbx_call_id"] != pbx_call_id:
                        dup = db.query(CallRecording).filter(
                            CallRecording.pbx_call_id == rec_data["pbx_call_id"]
                        ).first()
                        if dup:
                            continue

                    # Attempt to link to an Organization
                    organization_id = None
                    phone_number = rec_data["phone_number"]
                    if phone_number:
                        clean_phone = "".join(filter(str.isdigit, phone_number))
                        search_term = [phone_number]
                        if clean_phone and clean_phone != phone_number:
                            search_term.append(clean_phone)

                        for term in search_term:
                            org_contact = db.query(OrganizationContact).filter(
                                cast(OrganizationContact.phone_no, String).ilike(f"%{term}%")
                            ).first()

                            if org_contact and org_contact.organization_id:
                                organization_id = org_contact.organization_id
                                break

                            org = db.query(Organization).filter(
                                cast(Organization.contact_numbers, String).ilike(f"%{term}%")
                            ).first()

                            if org:
                                organization_id = org.id
                                break

                    record = CallRecording(
                        agent_id=rec_data["agent_id"],
                        agent_name=rec_data["agent_name"],
                        phone_number=phone_number or "unknown",
                        direction=rec_data["direction"],
                        duration_seconds=duration,
                        recording_file=recording_file or None,
                        recording_url=None,  # served via /calls/recordings/{id}/stream
                        pbx_call_id=rec_data["pbx_call_id"],
                        disposition=disposition,
                        created_at=call_dt,
                        organization_id=organization_id,
                    )
                    db.add(record)
                    inserted += 1

            except Exception as e:
                logger.error("Error processing CDR record: %s — %s", cdr, e)
                continue

        if inserted:
            db.commit()
            logger.info("✅ CDR Sync: imported %d new call records from FreePBX", inserted)

        return inserted


# Singleton
freepbx_cdr_service = FreePBXCDRService()
