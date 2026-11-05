"""
The STUN and TURN servers a WebRTC call is given (live help and the softphone).

Telephony settings choose the TURN relay, and it can be switched at any time:

  none        STUN only. Calls that cannot connect directly fail.
  coturn      Our own TURN server (coturn, see deploy/coturn/): one fixed URL,
              username and password, typed in on the Telephony screen.
  cloudflare  Cloudflare Realtime TURN. Cloudflare never gives a fixed
              password: with a TURN key id and its API token we ask for
              credentials that expire, and hand those out.

A row saved before the switch existed has no turn_provider: it reads as
coturn when a TURN URL was filled in, else none, so nothing changes for it.

Cloudflare credentials are asked for with cloudflare_turn_ttl (default a day)
and kept for half of that, so every credential handed out still has at least
half its life left -- longer than any call. If Cloudflare cannot be reached,
a cached set that has not expired is used, else the call gets STUN only (it
still connects whenever a direct path exists).
"""

import hashlib
import logging
import threading
import time
from typing import Callable, List, Optional

from app.services import secret_box

log = logging.getLogger(__name__)

PROVIDERS = ("none", "coturn", "cloudflare")

DEFAULT_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]
CLOUDFLARE_STUN = "stun:stun.cloudflare.com:3478"
CLOUDFLARE_URL = "https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
CLOUDFLARE_TTL_DEFAULT = 86400
CLOUDFLARE_TTL_MIN = 3600          # an hour: shorter would cut long calls off
CLOUDFLARE_TTL_MAX = 172800        # two days
TOKEN_LABEL = "cloudflare-turn"    # secret_box label for the API token

_cache_lock = threading.Lock()
_cache: dict = {}                  # (key_id, token sha) -> {"servers", "fresh_until", "expires_at"}


class TurnConfigError(Exception):
    """A TURN setting that cannot work, or Cloudflare refusing; the text is safe to show."""


def provider_of(settings) -> str:
    """The TURN relay in use; an older row with no choice keeps what it had."""
    p = (getattr(settings, "turn_provider", None) or "").strip().lower() if settings else ""
    if p in PROVIDERS:
        return p
    if settings and (getattr(settings, "turn_server", None) or "").strip():
        return "coturn"
    return "none"


def clamp_ttl(value) -> int:
    try:
        ttl = int(value or CLOUDFLARE_TTL_DEFAULT)
    except (TypeError, ValueError):
        ttl = CLOUDFLARE_TTL_DEFAULT
    return max(CLOUDFLARE_TTL_MIN, min(CLOUDFLARE_TTL_MAX, ttl))


def _stun_entries(settings) -> List[dict]:
    raw = (getattr(settings, "stun_servers", None) or "") if settings else ""
    urls = [u.strip() for u in raw.split(",") if u.strip()]
    return [{"urls": u} for u in (urls or DEFAULT_STUN)]


def _coturn_entries(settings) -> List[dict]:
    turn = (getattr(settings, "turn_server", None) or "").strip()
    if not turn:
        return []
    entry: dict = {"urls": turn}
    if getattr(settings, "turn_username", None):
        entry["username"] = settings.turn_username
    if getattr(settings, "turn_credential", None):
        entry["credential"] = settings.turn_credential
    out = [entry]
    if turn.startswith("turn:") and "?" not in turn:
        # the same server over TCP, and the TLS variant: for networks (and servers) where UDP is blocked
        tcp = dict(entry)
        tcp["urls"] = turn + "?transport=tcp"
        out.append(tcp)
        tls = dict(entry)
        tls["urls"] = turn.replace("turn:", "turns:", 1).replace(":3478", ":5349") + "?transport=tcp"
        out.append(tls)
    return out


def _http_post(url: str, headers: dict, body: dict, timeout: float):
    import requests
    r = requests.post(url, headers=headers, json=body, timeout=timeout)
    try:
        data = r.json()
    except ValueError:
        data = None
    return r.status_code, data


def _clean_cloudflare(data) -> List[dict]:
    """Cloudflare's iceServers, without the port 53 URLs browsers block (they only time out)."""
    servers = data.get("iceServers") if isinstance(data, dict) else None
    if isinstance(servers, dict):                # the older /generate shape: one object
        servers = [servers]
    out: List[dict] = []
    for s in servers or []:
        if not isinstance(s, dict):
            continue
        urls = s.get("urls")
        urls = [urls] if isinstance(urls, str) else list(urls or [])
        urls = [u for u in urls if isinstance(u, str) and ":53?" not in u and not u.endswith(":53")]
        if not urls:
            continue
        entry = {"urls": urls}
        if s.get("username"):
            entry["username"] = s["username"]
        if s.get("credential"):
            entry["credential"] = s["credential"]
        out.append(entry)
    if not any("username" in e for e in out):
        raise TurnConfigError("Cloudflare answered without TURN credentials.")
    return out


def fetch_cloudflare(key_id: str, token: str, ttl: int,
                     post: Optional[Callable] = None, timeout: float = 6.0) -> List[dict]:
    """Fresh credentials from Cloudflare, never cached. Raises TurnConfigError."""
    key_id = (key_id or "").strip()
    if not key_id or not token:
        raise TurnConfigError("Cloudflare TURN needs the TURN key id and its API token.")
    try:
        status, data = (post or _http_post)(
            CLOUDFLARE_URL.format(key_id=key_id),
            {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            {"ttl": clamp_ttl(ttl)},
            timeout,
        )
    except Exception as err:  # network, DNS, TLS
        raise TurnConfigError(f"Cloudflare could not be reached ({type(err).__name__}).")
    if status in (401, 403):
        raise TurnConfigError("Cloudflare refused the API token. Check the TURN key id and token.")
    if status == 404:
        raise TurnConfigError("Cloudflare does not know that TURN key id.")
    if status not in (200, 201):
        raise TurnConfigError(f"Cloudflare answered HTTP {status}.")
    return _clean_cloudflare(data)


def cloudflare_token(settings) -> Optional[str]:
    return secret_box.open_(getattr(settings, "cloudflare_turn_token", None), label=TOKEN_LABEL)


def _cloudflare_entries(settings, post: Optional[Callable] = None, now: Optional[float] = None) -> List[dict]:
    key_id = (getattr(settings, "cloudflare_turn_key_id", None) or "").strip()
    token = cloudflare_token(settings)
    if not key_id or not token:
        log.warning("Cloudflare TURN is chosen but the key id or token is missing (or unreadable); STUN only.")
        return []
    ttl = clamp_ttl(getattr(settings, "cloudflare_turn_ttl", None))
    now = time.time() if now is None else now
    ck = (key_id, hashlib.sha256(token.encode()).hexdigest(), ttl)
    with _cache_lock:
        hit = _cache.get(ck)
        if hit and now < hit["fresh_until"]:
            return hit["servers"]
    try:
        servers = fetch_cloudflare(key_id, token, ttl, post=post)
    except TurnConfigError as err:
        log.warning("Cloudflare TURN credentials: %s", err)
        with _cache_lock:
            hit = _cache.get(ck)
        # an older set still has at least a few minutes left: better than STUN only
        if hit and now < hit["expires_at"] - 300:
            return hit["servers"]
        return []
    with _cache_lock:
        _cache.clear()                           # one key at a time; drop sets for an old key
        _cache[ck] = {"servers": servers, "fresh_until": now + ttl / 2, "expires_at": now + ttl}
    return servers


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def build_ice_servers(settings, post: Optional[Callable] = None, now: Optional[float] = None) -> List[dict]:
    """The list RTCPeerConnection takes, for the chosen provider."""
    provider = provider_of(settings)
    stun = _stun_entries(settings)
    if provider == "coturn":
        return stun + _coturn_entries(settings)
    if provider == "cloudflare":
        cf = _cloudflare_entries(settings, post=post, now=now)
        if not cf:
            return stun + [{"urls": CLOUDFLARE_STUN}]
        have = {u for e in stun for u in ([e["urls"]] if isinstance(e["urls"], str) else e["urls"])}
        extra = []
        for e in cf:
            urls = e["urls"] if isinstance(e["urls"], list) else [e["urls"]]
            if "username" not in e and all(u in have for u in urls):
                continue                         # a STUN URL already listed
            extra.append(e)
        return stun + extra
    return stun


def ice_servers(db) -> List[dict]:
    from app.models.telephony import TelephonySettings
    return build_ice_servers(db.query(TelephonySettings).first())
