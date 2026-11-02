"""
The signalling relay for live help: one room per live session, holding the agent's
socket and the customer's. Rules are app/services/support_live.py.

In memory, which is right only because the backend runs one worker (Dockerfile):
both sockets of a session must reach the same process.

The two sides talk WebRTC to each other through it:

    customer -> {"type": "offer", "sdp": ...}        agent -> {"type": "answer", "sdp": ...}
    either   -> {"type": "ice", "candidate": ...}     either -> {"type": "bye"}
    either   -> {"type": "failed", "reason": "..."}   either -> {"type": "state", ...}  (muted, sharing)

and the relay itself says
    {"type": "hello", ...}       to each side as it joins (ICE servers, the session)
    {"type": "ready"}            to both once both are in -- the customer then offers
    {"type": "status", "live"}   to the agent when the customer answers
    {"type": "bye"}              to one side when the other leaves

The customer offers because the customer has the screen; the agent answers.
"""

import asyncio
import json
import logging
from typing import Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect

from app.database import SessionLocal
from app.models.support import SupportLiveSession
from app.services import support_live as live

log = logging.getLogger(__name__)

FORWARD = {"offer", "answer", "ice", "bye", "failed", "state"}
MAX_MESSAGE = 64 * 1024
ROLES = ("agent", "customer")


class Hub:
    def __init__(self):
        self.rooms: Dict[int, Dict[str, WebSocket]] = {}

    def peer(self, live_id: int, role: str) -> Optional[WebSocket]:
        other = "customer" if role == "agent" else "agent"
        return self.rooms.get(live_id, {}).get(other)

    async def send(self, live_id: int, role: str, message: dict) -> bool:
        ws = self.rooms.get(live_id, {}).get(role)
        if ws is None:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception:
            return False

    async def join(self, live_id: int, role: str, ws: WebSocket) -> None:
        room = self.rooms.setdefault(live_id, {})
        old = room.get(role)
        room[role] = ws
        if old is not None and old is not ws:       # a second tab replaces the first
            try:
                await old.close(code=4009, reason="Opened somewhere else")
            except Exception:
                pass

    def leave(self, live_id: int, role: str, ws: WebSocket) -> None:
        room = self.rooms.get(live_id)
        if room and room.get(role) is ws:
            del room[role]
            if not room:
                del self.rooms[live_id]


hub = Hub()


def _row(live_id: int):
    db = SessionLocal()
    row = db.get(SupportLiveSession, live_id)
    return db, row


async def tell_agent(live_id: int) -> None:
    """The customer answered (or the session lapsed): the agent's socket hears the new state."""
    db, row = _row(live_id)
    try:
        if row is not None:
            await hub.send(live_id, "agent", {"type": "status", "live": live.agent_view(live.refresh(db, row))})
    finally:
        db.close()


async def run(ws: WebSocket, live_id: int, role: str, hello: dict) -> None:
    """Hold one side's socket until it leaves. The caller has accepted the socket and checked it."""
    await hub.join(live_id, role, ws)
    await ws.send_json({"type": "hello", **hello})
    await _both_in(live_id)
    try:
        while True:
            text = await ws.receive_text()
            if len(text) > MAX_MESSAGE:
                continue
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")
            if kind == "ping":
                await ws.send_json({"type": "pong"})
                continue
            if kind not in FORWARD:
                continue
            if kind == "failed":
                _finish(live_id, "failed", msg.get("reason") or "It did not connect.")
            elif kind == "bye":
                _finish(live_id, "ended", None)
            await hub.send(live_id, "customer" if role == "agent" else "agent", msg)
            if kind in ("bye", "failed"):
                break
    except WebSocketDisconnect:
        pass
    except Exception as err:
        log.warning("Live help %s %s socket: %s", live_id, role, err)
    finally:
        hub.leave(live_id, role, ws)
        status = _status(live_id)
        if status == "connected":
            # one side went away: a session under way has ended for both
            _finish(live_id, "ended", None)
        if status in ("accepted", "connected"):
            await hub.send(live_id, "customer" if role == "agent" else "agent", {"type": "bye"})


async def _both_in(live_id: int) -> None:
    room = hub.rooms.get(live_id, {})
    if "agent" in room and "customer" in room:
        db, row = _row(live_id)
        try:
            if row is not None and row.status == "accepted":
                live.mark_connected(db, row)
        finally:
            db.close()
        for role in ROLES:
            await hub.send(live_id, role, {"type": "ready"})


def _status(live_id: int) -> Optional[str]:
    db, row = _row(live_id)
    try:
        return row.status if row is not None else None
    finally:
        db.close()


def _finish(live_id: int, how: str, reason: Optional[str]) -> None:
    db, row = _row(live_id)
    try:
        if row is not None and row.status in ("accepted", "connected"):
            live.finish(db, row, how, reason)
    finally:
        db.close()


def schedule_tell_agent(live_id: int) -> None:
    """tell_agent() from a sync route: on the loop main.py handed to the support service."""
    from app.services import support_service
    loop = support_service._event_loop
    if loop is None or loop.is_closed():
        return
    try:
        asyncio.run_coroutine_threadsafe(tell_agent(live_id), loop)
    except Exception as err:
        log.warning("Live help %s: could not tell the agent: %s", live_id, err)
