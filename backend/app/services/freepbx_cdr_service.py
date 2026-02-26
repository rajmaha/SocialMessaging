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
                "port": settings.port or 443,
                "api_key": settings.freepbx_api_key,
                "api_secret": settings.freepbx_api_secret,
            }
        except Exception as e:
            logger.error("Error reading TelephonySettings for CDR: %s", e)
            return None

    def _get_token(self, host: str, port: int, api_key: str, api_secret: str) -> Optional[str]:
        """Get bearer token from FreePBX REST API."""
        try:
            import requests
            from app.services.freepbx_service import freepbx_service
            return freepbx_service._get_token(host, port, api_key, api_secret)
        except Exception as e:
            logger.error("CDR: failed to get FreePBX token: %s", e)
            return None

    def _base_url(self, host: str) -> str:
        if host.startswith("http"):
            return host.rstrip("/")
        return f"https://{host.rstrip('/')}"

    def fetch_recent_cdrs(self, db, since_minutes: int = 10) -> List[Dict]:
        """
        Fetch CDR records from FreePBX for the last N minutes.
        Returns a list of raw CDR dicts.
        """
        cfg = self._get_settings(db)
        if not cfg:
            return []

        token = self._get_token(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not token:
            return []

        try:
            import requests
            base = self._base_url(cfg["host"])
            # Fetch last 200 records ordered by most recent
            resp = requests.get(
                f"{base}/api/rest/cdr",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": 200, "order": "calldate DESC"},
                timeout=15,
                verify=False,
            )
            if resp.status_code != 200:
                logger.warning("FreePBX CDR API returned %s: %s", resp.status_code, resp.text[:200])
                return []

            data = resp.json()
            # FreePBX returns {"status": true, "message": "...", "data": [...]}
            cdrs = data.get("data", data) if isinstance(data, dict) else data
            if not isinstance(cdrs, list):
                logger.warning("Unexpected CDR response format: %s", type(cdrs))
                return []

            # Filter to recent records only
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
                    recent.append(cdr)  # include if we can't parse date

            return recent

        except Exception as e:
            logger.error("Error fetching CDRs from FreePBX: %s", e)
            return []

    def get_recording_stream_url(self, db, recording_file: str) -> Optional[str]:
        """
        Returns the FreePBX REST API URL to stream a recording file.
        Clients should use /calls/recordings/{id}/stream which proxies this.
        """
        cfg = self._get_settings(db)
        if not cfg or not recording_file:
            return None
        base = self._base_url(cfg["host"])
        return f"{base}/api/rest/recording/{recording_file}"

    def stream_recording(self, db, recording_file: str):
        """
        Fetch a recording file bytes from FreePBX.
        Returns (bytes_content, content_type) or (None, None) on failure.
        """
        cfg = self._get_settings(db)
        if not cfg or not recording_file:
            return None, None

        token = self._get_token(cfg["host"], cfg["port"], cfg["api_key"], cfg["api_secret"])
        if not token:
            return None, None

        try:
            import requests
            base = self._base_url(cfg["host"])
            resp = requests.get(
                f"{base}/api/rest/recording/{recording_file}",
                headers={"Authorization": f"Bearer {token}"},
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

    def sync_cdrs_to_db(self, db) -> int:
        """
        Main sync method — called by scheduler every few minutes.
        Pulls recent CDRs from FreePBX and inserts new ones into call_recordings.
        Returns the count of new records inserted.
        """
        from app.models.call_records import CallRecording
        from app.models.agent_extension import AgentExtension
        from app.models.user import User

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
                # If src is an internal extension, this is outbound
                if src in ext_to_user:
                    direction = "outbound"
                    phone_number = dst
                    agent_id = ext_to_user.get(src)
                    agent_name = ext_to_name.get(src, "")
                else:
                    direction = "inbound"
                    phone_number = src
                    agent_id = ext_to_user.get(dst)
                    agent_name = ext_to_name.get(dst, "")

                duration = int(cdr.get("billsec", cdr.get("duration", 0)))
                recording_file = cdr.get("recordingfile", "")

                # Parse call date
                calldate_str = cdr.get("calldate", "")
                try:
                    call_dt = datetime.strptime(calldate_str[:19], "%Y-%m-%d %H:%M:%S")
                except Exception:
                    call_dt = datetime.utcnow()

                record = CallRecording(
                    agent_id=agent_id,
                    agent_name=agent_name,
                    phone_number=phone_number or "unknown",
                    direction=direction,
                    duration_seconds=duration,
                    recording_file=recording_file or None,
                    recording_url=None,  # served via /calls/recordings/{id}/stream
                    pbx_call_id=pbx_call_id,
                    disposition=disposition,
                    created_at=call_dt,
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
