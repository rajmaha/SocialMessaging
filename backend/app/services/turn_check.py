"""
Prove a TURN server relays: ask it for a relay address (RFC 5766 Allocate) with
the username and password a call would use, then give the address straight back.

Used by Telephony's Test TURN button for both relays -- coturn and Cloudflare's
generated credentials -- so "it works" means a call through it would get a
relay, not only that a port is open. Plain UDP or TCP (turn:), not TLS (turns:).
"""

import hashlib
import hmac
import os
import socket
import struct
from typing import List, Optional, Tuple
from urllib.parse import parse_qs

MAGIC = 0x2112A442
ALLOCATE, REFRESH = 0x0003, 0x0004
SUCCESS, ERROR = 0x0100, 0x0110
A_USERNAME, A_MI, A_ERROR, A_REALM, A_NONCE = 0x0006, 0x0008, 0x0009, 0x0014, 0x0015
A_LIFETIME, A_XOR_RELAYED, A_REQ_TRANSPORT, A_SOFTWARE = 0x000D, 0x0016, 0x0019, 0x8022


def parse_turn_url(url: str) -> Optional[Tuple[str, str, int, str]]:
    """(scheme, host, port, transport) of a turn:/turns: URL, or None."""
    url = (url or "").strip()
    if not url.startswith(("turn:", "turns:")):
        return None
    scheme, rest = url.split(":", 1)
    rest, _, query = rest.partition("?")
    transport = (parse_qs(query).get("transport") or ["udp" if scheme == "turn" else "tcp"])[0].lower()
    if rest.startswith("["):                          # [IPv6]:port
        host, _, port = rest[1:].partition("]")
        port = port.lstrip(":")
    else:
        host, _, port = rest.rpartition(":") if rest.count(":") == 1 else (rest, "", "")
    try:
        port_n = int(port) if port else (5349 if scheme == "turns" else 3478)
    except ValueError:
        return None
    if not host:
        return None
    return scheme, host, port_n, transport


def _attr(kind: int, value: bytes) -> bytes:
    return struct.pack("!HH", kind, len(value)) + value + b"\0" * ((4 - len(value) % 4) % 4)


def _message(method: int, txn: bytes, attrs: List[bytes], key: Optional[bytes] = None) -> bytes:
    body = b"".join(attrs)
    if key is None:
        return struct.pack("!HHI", method, len(body), MAGIC) + txn + body
    # MESSAGE-INTEGRITY: HMAC-SHA1 over the message so far, its length counting the MI attribute
    head = struct.pack("!HHI", method, len(body) + 24, MAGIC) + txn
    mi = hmac.new(key, head + body, hashlib.sha1).digest()
    return head + body + _attr(A_MI, mi)


def _parse(data: bytes, txn: bytes) -> Tuple[int, dict]:
    if len(data) < 20:
        raise ValueError("short answer")
    kind, length, magic = struct.unpack("!HHI", data[:8])
    if magic != MAGIC or data[8:20] != txn:
        raise ValueError("not an answer to our request")
    attrs, pos, end = {}, 20, 20 + length
    while pos + 4 <= min(end, len(data)):
        a, n = struct.unpack("!HH", data[pos:pos + 4])
        attrs.setdefault(a, data[pos + 4:pos + 4 + n])
        pos += 4 + n + ((4 - n % 4) % 4)
    return kind, attrs


def _relayed(value: bytes) -> str:
    if len(value) >= 8 and value[1] == 1:
        port = struct.unpack("!H", value[2:4])[0] ^ (MAGIC >> 16)
        ip = struct.unpack("!I", value[4:8])[0] ^ MAGIC
        return f"{socket.inet_ntoa(struct.pack('!I', ip))}:{port}"
    return "(IPv6 address)"


class _Conn:
    def __init__(self, host: str, port: int, transport: str, timeout: float):
        info = socket.getaddrinfo(host, port, 0, socket.SOCK_DGRAM if transport == "udp" else socket.SOCK_STREAM)
        family, _, _, _, addr = info[0]
        self.udp = transport == "udp"
        self.sock = socket.socket(family, socket.SOCK_DGRAM if self.udp else socket.SOCK_STREAM)
        self.sock.settimeout(timeout)
        self.sock.connect(addr)
        self.addr = addr

    def ask(self, msg: bytes) -> bytes:
        self.sock.send(msg)
        if self.udp:
            return self.sock.recv(2048)
        head = self._read(20)
        return head + self._read(struct.unpack("!H", head[2:4])[0])

    def _read(self, n: int) -> bytes:
        out = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError("closed")
            out += chunk
        return out

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def check(url: str, username: str, credential: str, timeout: float = 5.0) -> dict:
    """{"ok": bool, "message": str, "relay": "ip:port"?}; never raises."""
    parsed = parse_turn_url(url)
    if not parsed:
        return {"ok": False, "message": f"'{url}' is not a TURN address (turn:host:port)."}
    scheme, host, port, transport = parsed
    where = f"{host}:{port} ({transport.upper()})"
    if scheme == "turns":
        return {"ok": False, "message": f"{where}: TLS (turns:) is not tested here; test the turn: address."}
    if transport not in ("udp", "tcp"):
        return {"ok": False, "message": f"{where}: unknown transport."}
    try:
        conn = _Conn(host, port, transport, timeout)
    except socket.gaierror:
        return {"ok": False, "message": f"{host} could not be found (DNS)."}
    except OSError as err:
        return {"ok": False, "message": f"{where} could not be reached ({err.strerror or err})."}
    try:
        txn = os.urandom(12)
        transport_attr = _attr(A_REQ_TRANSPORT, bytes([17, 0, 0, 0]))
        kind, attrs = _parse(conn.ask(_message(ALLOCATE, txn, [transport_attr])), txn)
        if kind == ALLOCATE | SUCCESS:
            return {"ok": True, "message": f"{where} relays without asking for a password -- anyone can use it. Turn on lt-cred-mech.",
                    "relay": _relayed(attrs.get(A_XOR_RELAYED, b""))}
        realm, nonce = attrs.get(A_REALM), attrs.get(A_NONCE)
        if not realm or not nonce:
            return {"ok": False, "message": f"{where} answered, but not like a TURN server."}
        key = hashlib.md5(f"{username}:{realm.decode('utf-8', 'replace')}:{credential}".encode()).digest()
        txn = os.urandom(12)
        auth = [transport_attr, _attr(A_USERNAME, username.encode()), _attr(A_REALM, realm), _attr(A_NONCE, nonce)]
        kind, attrs = _parse(conn.ask(_message(ALLOCATE, txn, auth, key)), txn)
        if kind == ALLOCATE | SUCCESS:
            relay = _relayed(attrs.get(A_XOR_RELAYED, b""))
            try:                                      # give the relay straight back
                txn = os.urandom(12)
                conn.ask(_message(REFRESH, txn, [_attr(A_LIFETIME, struct.pack("!I", 0)),
                                                 _attr(A_USERNAME, username.encode()),
                                                 _attr(A_REALM, realm), _attr(A_NONCE, nonce)], key))
            except Exception:
                pass
            return {"ok": True, "message": f"{where} gave a relay address ({relay}) with these credentials.", "relay": relay}
        err = attrs.get(A_ERROR, b"")
        code = (err[2] * 100 + err[3]) if len(err) >= 4 else 0
        reason = err[4:].decode("utf-8", "replace").strip() if len(err) > 4 else ""
        if code == 401:
            return {"ok": False, "message": f"{where} refused the username or password."}
        if code == 403:
            return {"ok": False, "message": f"{where} refused to relay (403 {reason or 'Forbidden'}): check its denied-peer / allowed rules."}
        if code == 486:
            return {"ok": False, "message": f"{where} has reached its allocation quota (486)."}
        return {"ok": False, "message": f"{where} refused: {code} {reason}".strip()}
    except ConnectionRefusedError:
        if transport == "udp":
            return {"ok": False, "message": f"{where}: nothing answers on UDP (the server is not listening on UDP, "
                                            "or a firewall rejects it). Open 3478/udp, or calls can only use TCP."}
        return {"ok": False, "message": f"{where} refused the connection."}
    except socket.timeout:
        hint = " UDP may be blocked by a firewall; open 3478/udp and the relay port range." if transport == "udp" else ""
        return {"ok": False, "message": f"{where} did not answer.{hint}"}
    except (OSError, ValueError, ConnectionError) as err:
        return {"ok": False, "message": f"{where}: {err}"}
    finally:
        conn.close()


def check_servers(servers: List[dict]) -> dict:
    """Try the first plain turn: address of an ICE list, UDP first then TCP."""
    candidates = []
    for s in servers:
        urls = s.get("urls")
        for u in ([urls] if isinstance(urls, str) else urls or []):
            p = parse_turn_url(u)
            if p and p[0] == "turn":
                candidates.append((0 if p[3] == "udp" else 1, u, s.get("username") or "", s.get("credential") or ""))
    if not candidates:
        return {"ok": False, "message": "No TURN server is in use: calls get STUN only."}
    candidates.sort(key=lambda c: c[0])
    tried = []
    for _, url, user, cred in candidates[:2]:
        result = check(url, user, cred)
        result["url"] = url
        if result["ok"]:
            if tried:
                result["message"] += f" (UDP failed first: {tried[0]['message']})"
            return result
        tried.append(result)
    return tried[0] if len(tried) == 1 else {"ok": False, "message": " / ".join(t["message"] for t in tried), "url": tried[0]["url"]}
