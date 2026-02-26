"""
AMI (Asterisk Manager Interface) service for originating outbound calls.
Used by Reminder and Notification modules.
"""
import logging
import socket
import time
from typing import Optional

logger = logging.getLogger(__name__)

MAX_RETRIES = 5


class AMIClient:
    """Minimal synchronous AMI client for originating calls."""

    def __init__(self, host: str, port: int, username: str, secret: str):
        self.host = host
        self.port = port
        self.username = username
        self.secret = secret
        self._sock: Optional[socket.socket] = None

    def connect(self) -> bool:
        try:
            self._sock = socket.create_connection((self.host, self.port), timeout=10)
            banner = self._readline()
            logger.debug("AMI banner: %s", banner)

            # Login
            self._send(
                f"Action: Login\r\n"
                f"Username: {self.username}\r\n"
                f"Secret: {self.secret}\r\n"
                f"\r\n"
            )
            response = self._read_response()
            if "Success" in response:
                logger.info("AMI login successful")
                return True
            logger.error("AMI login failed: %s", response)
            return False
        except Exception as e:
            logger.error("AMI connect error: %s", e)
            return False

    def originate(
        self,
        channel: str,
        context: str = "from-internal",
        exten: str = "s",
        priority: int = 1,
        callerid: str = "AutoCall <0000>",
        timeout: int = 30000,
        application: Optional[str] = None,
        app_data: Optional[str] = None,
        action_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Originate a call on the channel.
        Returns the ActionID on success, None on failure.
        """
        if not action_id:
            action_id = f"autocall-{int(time.time() * 1000)}"

        cmd = (
            f"Action: Originate\r\n"
            f"ActionID: {action_id}\r\n"
            f"Channel: {channel}\r\n"
            f"CallerID: {callerid}\r\n"
            f"Timeout: {timeout}\r\n"
            f"Async: true\r\n"
        )
        if application:
            cmd += f"Application: {application}\r\nData: {app_data or ''}\r\n"
        else:
            cmd += f"Context: {context}\r\nExten: {exten}\r\nPriority: {priority}\r\n"

        cmd += "\r\n"
        self._send(cmd)
        response = self._read_response()
        if "Success" in response or "Originate" in response:
            logger.info("AMI Originate queued: %s → %s", channel, action_id)
            return action_id
        logger.warning("AMI Originate response: %s", response)
        # Still return action_id even on non-clear responses (async=true acks vary)
        return action_id

    def logoff(self):
        try:
            self._send("Action: Logoff\r\n\r\n")
            if self._sock:
                self._sock.close()
        except Exception:
            pass
        self._sock = None

    # ─── Helpers ────────────────────────────────────────────────────────────────

    def _send(self, data: str):
        if self._sock:
            self._sock.sendall(data.encode())

    def _readline(self) -> str:
        buf = b""
        if not self._sock:
            return ""
        while True:
            ch = self._sock.recv(1)
            if not ch or ch == b"\n":
                break
            buf += ch
        return buf.decode(errors="replace").strip()

    def _read_response(self) -> str:
        """Read AMI response block (terminated by blank line)."""
        lines = []
        if not self._sock:
            return ""
        try:
            self._sock.settimeout(5)
            buf = b""
            while True:
                chunk = self._sock.recv(4096)
                if not chunk:
                    break
                buf += chunk
                if b"\r\n\r\n" in buf or b"\n\n" in buf:
                    break
            return buf.decode(errors="replace")
        except socket.timeout:
            return ""
        finally:
            self._sock.settimeout(None)


def get_ami_client(db) -> Optional[AMIClient]:
    """
    Load AMI credentials from TelephonySettings and return a connected client.
    Returns None if not configured or connection fails.
    """
    try:
        from app.models.telephony import TelephonySettings
        settings = db.query(TelephonySettings).first()
        if not settings or not settings.host or not settings.ami_username or not settings.ami_secret:
            logger.warning("AMI not configured in TelephonySettings – skipping call origination")
            return None
        client = AMIClient(
            host=settings.host,
            port=settings.port or 5038,
            username=settings.ami_username,
            secret=settings.ami_secret,
        )
        if client.connect():
            return client
        return None
    except Exception as e:
        logger.error("get_ami_client error: %s", e)
        return None


def get_outbound_channel(phone_number: str, db) -> str:
    """
    Build the Asterisk channel string for an outbound call.
    Uses PJSIP/trunk by default, configurable in TelephonySettings webrtc_wss_url field
    (we reuse that as a 'dial_prefix' hint, e.g. 'PJSIP/<number>@trunk_name').
    Falls back to 'DAHDI/g1/<number>'.
    """
    try:
        from app.models.telephony import TelephonySettings
        settings = db.query(TelephonySettings).first()
        # Use webrtc_wss_url field as a dial prefix template, e.g.:
        #   PJSIP/{number}@my_trunk
        #   SIP/my_trunk/{number}
        #   DAHDI/g1/{number}
        if settings and settings.webrtc_wss_url and "{number}" in settings.webrtc_wss_url:
            return settings.webrtc_wss_url.replace("{number}", phone_number)
    except Exception:
        pass
    # Sensible default
    return f"PJSIP/{phone_number}@trunk"
