"""
Live help on a support request: the agent holding the ticket asks to talk, or to
see the customer's screen; the customer accepts or denies. Design: OMS repo,
docs/plans/2026-11-02-support-desk-phase3-plan.md.

A session (SupportLiveSession) goes

    requested --accept--> accepted --both sockets joined--> connected --> ended
        |                    |
        +-- deny / cancel    +-- pass unused for 2 minutes --> failed
        +-- 60 seconds unanswered --> expired

Expiry is worked out on read (refresh()), never by a job, so a session cannot look
open because a job did not run. Accepting hands the customer a one-time pass
(single use, 2 minutes) for the signalling socket; only its sha256 is stored.

The media goes peer to peer between the customer's browser or app and the agent's
browser; this file and the relay (support_live_relay.py) only carry the
signalling. Nothing is recorded. When a connected session ends, the thread gets a
line ("Screen shared 14:02-14:15 with Ram") and the site's webhook is told.

Each write commits on its own.
"""

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.support import SupportCallLink, SupportLiveSession, SupportMessage, SupportUser
from app.models.ticket import Ticket
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.services import support_webhooks
from app.services.support_service import SupportError, agent_display, status_word

log = logging.getLogger(__name__)

KINDS = ("talk", "screen")
ASK_SECONDS = 60                 # the customer has this long to answer
PASS_SECONDS = 120               # and then this long to connect
ASKS_PER_TICKET = 3              # per ASK_WINDOW_MINUTES
ASK_WINDOW_MINUTES = 10
OPEN = ("requested", "accepted", "connected")
FINAL = ("denied", "expired", "cancelled", "ended", "failed")
CALL_LINK_MINUTES = 30           # a call placed within this long of Call phone takes the ticket
REASON_MAX = 300


def _now() -> datetime:
    return datetime.utcnow()


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- what the clients connect with ---------------------------------------------------------

def ice_servers(db: Session) -> List[dict]:
    """STUN and TURN for the chosen relay (Telephony settings); see ice_config."""
    from app.services.ice_config import ice_servers as _ice
    return _ice(db)


# --- reading -----------------------------------------------------------------------------

def refresh(db: Session, row: Optional[SupportLiveSession], now: Optional[datetime] = None) -> Optional[SupportLiveSession]:
    """The row with any lapse it has reached written down: unanswered -> expired, pass unused -> failed."""
    if row is None:
        return None
    now = now or _now()
    changed = False
    if row.status == "requested" and row.expires_at and now >= row.expires_at:
        row.status, row.ended_at, changed = "expired", row.expires_at, True
    elif (row.status == "accepted" and row.pass_used_at is None
          and row.pass_expires_at and now >= row.pass_expires_at):
        # ended like any other failure: a line on the thread, and the site told
        return finish(db, row, "failed", "The customer accepted but never connected.", now=row.pass_expires_at)
    if changed:
        db.commit()
    return row


def current(db: Session, ticket: Ticket, now: Optional[datetime] = None) -> Optional[SupportLiveSession]:
    """The ticket's open live session, if there is one."""
    rows = (db.query(SupportLiveSession)
            .filter(SupportLiveSession.ticket_id == ticket.id, SupportLiveSession.status.in_(OPEN))
            .order_by(SupportLiveSession.id.desc()).all())
    for row in rows:
        if refresh(db, row, now).status in OPEN:
            return row
    return None


def latest(db: Session, ticket: Ticket) -> Optional[SupportLiveSession]:
    return (db.query(SupportLiveSession).filter(SupportLiveSession.ticket_id == ticket.id)
            .order_by(SupportLiveSession.id.desc()).first())


def seconds_left(row: SupportLiveSession, now: Optional[datetime] = None) -> int:
    if row.status != "requested" or not row.expires_at:
        return 0
    return max(0, int((row.expires_at - (now or _now())).total_seconds()))


def customer_view(db: Session, row: SupportLiveSession, now: Optional[datetime] = None) -> dict:
    """What the customer is told of a live session."""
    ticket = db.get(Ticket, row.ticket_id)
    return {
        "id": row.id,
        "ticket_no": ticket.ticket_number if ticket else None,
        "kind": row.kind,
        "status": row.status,
        "agent": row.agent_name or "Support",
        "expires_at": _iso(row.expires_at),
        "seconds_left": seconds_left(row, now),
    }


def agent_view(row: Optional[SupportLiveSession], now: Optional[datetime] = None) -> Optional[dict]:
    if row is None:
        return None
    return {
        "id": row.id,
        "kind": row.kind,
        "status": row.status,
        "screen_ok": None if row.screen_ok is None else bool(row.screen_ok),
        "requested_by": row.requested_by,
        "requested_at": _iso(row.requested_at),
        "expires_at": _iso(row.expires_at),
        "seconds_left": seconds_left(row, now),
        "answered_at": _iso(row.answered_at),
        "connected_at": _iso(row.connected_at),
        "ended_at": _iso(row.ended_at),
        "reason": row.reason,
    }


def pending_for(db: Session, domain: WidgetDomain, suser: SupportUser,
                now: Optional[datetime] = None) -> Optional[SupportLiveSession]:
    """A request waiting for this person's answer, on any of their tickets."""
    rows = (db.query(SupportLiveSession)
            .filter(SupportLiveSession.widget_domain_id == domain.id,
                    SupportLiveSession.support_user_id == suser.id,
                    SupportLiveSession.status == "requested")
            .order_by(SupportLiveSession.id.desc()).all())
    for row in rows:
        if refresh(db, row, now).status == "requested":
            return row
    return None


def for_customer(db: Session, domain: WidgetDomain, suser: SupportUser, live_id: int) -> SupportLiveSession:
    """The person's own live session, or a 404 -- never someone else's."""
    row = db.get(SupportLiveSession, int(live_id or 0))
    if row is None or row.widget_domain_id != domain.id or row.support_user_id != suser.id:
        raise SupportError("That live help request was not found.", 404)
    return refresh(db, row)


# --- the agent's side ----------------------------------------------------------------------

def _live_payload(row: SupportLiveSession) -> dict:
    return {"id": row.id, "kind": row.kind, "status": row.status, "agent": row.agent_name,
            "expires_at": _iso(row.expires_at), "ended_at": _iso(row.ended_at)}


def ask(db: Session, ticket: Ticket, agent: User, kind: str, now: Optional[datetime] = None) -> SupportLiveSession:
    """The agent holding the ticket asks to talk or to see the screen."""
    now = now or _now()
    kind = str(kind or "").strip().lower()
    if kind not in KINDS:
        raise SupportError("Ask to talk or to see the screen.")
    if not ticket.support_site_id or not ticket.support_user_id:
        raise SupportError("That ticket is not a support request.", 400)
    domain = db.get(WidgetDomain, ticket.support_site_id)
    if domain is None or not domain.live_help_enabled:
        raise SupportError("Live help is switched off for this site (Widget Domains -> Support).", 403)
    if ticket.assigned_to != agent.id:
        raise SupportError("Take the request first: only the agent holding it can start live help.", 403)
    if current(db, ticket, now) is not None:
        raise SupportError("Live help is already under way on this request.", 409)
    recent = (db.query(SupportLiveSession)
              .filter(SupportLiveSession.ticket_id == ticket.id,
                      SupportLiveSession.requested_at >= now - timedelta(minutes=ASK_WINDOW_MINUTES))
              .count())
    if recent >= ASKS_PER_TICKET:
        raise SupportError(f"You have asked {ASKS_PER_TICKET} times in {ASK_WINDOW_MINUTES} minutes. "
                           "Wait a little, or phone them.", 429)
    suser = db.get(SupportUser, ticket.support_user_id)
    row = SupportLiveSession(
        ticket_id=ticket.id, widget_domain_id=domain.id, support_user_id=ticket.support_user_id,
        kind=kind, status="requested", requested_by=agent.id,
        agent_name=agent_display(agent).replace(" (Support)", "") or "Support",
        requested_at=now, expires_at=now + timedelta(seconds=ASK_SECONDS),
    )
    db.add(row)
    db.flush()
    support_webhooks.queue(db, domain, ticket, "live_request", suser, status_word(ticket), None,
                           live=_live_payload(row))
    db.commit()
    log.info("Support %s: %s asked for live help (%s), session %s",
             ticket.ticket_number, agent.id, kind, row.id)
    return row


def for_agent(db: Session, ticket: Ticket, live_id: int) -> SupportLiveSession:
    row = db.get(SupportLiveSession, int(live_id or 0))
    if row is None or row.ticket_id != ticket.id:
        raise SupportError("That live help session was not found.", 404)
    return refresh(db, row)


def cancel(db: Session, row: SupportLiveSession, agent: User, now: Optional[datetime] = None) -> SupportLiveSession:
    """The agent calls a request off, or ends a session under way."""
    now = now or _now()
    refresh(db, row, now)
    if row.status == "connected":
        return finish(db, row, "ended", None, now)
    if row.status in ("requested", "accepted"):
        claimed = (db.query(SupportLiveSession)
                   .filter(SupportLiveSession.id == row.id, SupportLiveSession.status == row.status)
                   .update({SupportLiveSession.status: "cancelled", SupportLiveSession.ended_at: now},
                           synchronize_session=False))
        db.commit()
        db.refresh(row)
        if claimed:
            _queue_ended(db, row)
    return row


# --- the customer's side ---------------------------------------------------------------------

def accept(db: Session, row: SupportLiveSession, screen_ok: bool,
           now: Optional[datetime] = None) -> Tuple[SupportLiveSession, str]:
    """The customer says yes: a one-time pass for the signalling socket. Two presses: one pass."""
    now = now or _now()
    refresh(db, row, now)
    if row.status != "requested":
        raise SupportError(_closed_words(row), 409)
    token = secrets.token_urlsafe(32)
    claimed = (db.query(SupportLiveSession)
               .filter(SupportLiveSession.id == row.id, SupportLiveSession.status == "requested")
               .update({SupportLiveSession.status: "accepted",
                        SupportLiveSession.answered_at: now,
                        SupportLiveSession.screen_ok: 1 if screen_ok else 0,
                        SupportLiveSession.pass_hash: _hash(token),
                        SupportLiveSession.pass_expires_at: now + timedelta(seconds=PASS_SECONDS)},
                       synchronize_session=False))
    db.commit()
    db.refresh(row)
    if not claimed:
        raise SupportError(_closed_words(row), 409)
    return row, token


def deny(db: Session, row: SupportLiveSession, now: Optional[datetime] = None) -> SupportLiveSession:
    now = now or _now()
    refresh(db, row, now)
    if row.status != "requested":
        return row                                    # already answered, lapsed or called off
    claimed = (db.query(SupportLiveSession)
               .filter(SupportLiveSession.id == row.id, SupportLiveSession.status == "requested")
               .update({SupportLiveSession.status: "denied", SupportLiveSession.answered_at: now,
                        SupportLiveSession.ended_at: now}, synchronize_session=False))
    db.commit()
    db.refresh(row)
    if claimed:
        _queue_ended(db, row)
    return row


def _closed_words(row: SupportLiveSession) -> str:
    return {
        "accepted": "You have already accepted.",
        "connected": "Live help is already under way.",
        "denied": "You said no to this request.",
        "expired": "This request has run out. Support can ask again.",
        "cancelled": "Support called this request off.",
    }.get(row.status, "This live help has finished.")


# --- the signalling socket -------------------------------------------------------------------

def claim_pass(db: Session, token: str, now: Optional[datetime] = None) -> Optional[SupportLiveSession]:
    """The session a customer's pass opens, using the pass up. None for a wrong, used or old pass."""
    if not token or len(token) > 100:
        return None
    now = now or _now()
    row = (db.query(SupportLiveSession)
           .filter(SupportLiveSession.pass_hash == _hash(token)).first())
    if row is None:
        return None
    refresh(db, row, now)
    if row.status != "accepted" or row.pass_used_at is not None or not row.pass_expires_at or now >= row.pass_expires_at:
        return None
    used = (db.query(SupportLiveSession)
            .filter(SupportLiveSession.id == row.id, SupportLiveSession.pass_used_at.is_(None))
            .update({SupportLiveSession.pass_used_at: now}, synchronize_session=False))
    db.commit()
    if not used:
        return None
    db.refresh(row)
    return row


def agent_may_join(db: Session, row: SupportLiveSession, agent: Optional[User]) -> bool:
    return agent is not None and row.requested_by == agent.id and refresh(db, row).status in OPEN


def mark_connected(db: Session, row: SupportLiveSession, now: Optional[datetime] = None) -> SupportLiveSession:
    now = now or _now()
    (db.query(SupportLiveSession)
     .filter(SupportLiveSession.id == row.id, SupportLiveSession.status == "accepted")
     .update({SupportLiveSession.status: "connected", SupportLiveSession.connected_at: now},
             synchronize_session=False))
    db.commit()
    db.refresh(row)
    return row


def _site_zone(db: Session):
    from app.services.events_service import events_service
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(events_service.get_timezone(db) or "UTC")
    except Exception:
        return timezone.utc


def _clock(dt: datetime, zone) -> str:
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(zone).strftime("%H:%M")


def finish(db: Session, row: SupportLiveSession, how: str, reason: Optional[str],
           now: Optional[datetime] = None) -> SupportLiveSession:
    """A session that was accepted or connected comes to an end: ended, or failed with a reason."""
    now = now or _now()
    if how not in ("ended", "failed"):
        raise ValueError(how)
    before = row.status
    if before not in ("accepted", "connected"):
        return row
    if before == "accepted" and how == "ended":
        how = "failed"                                # it never connected
        reason = reason or "It did not connect."
    reason = re.sub(r"<[^>]*>", "", str(reason or ""))[:REASON_MAX] or None
    claimed = (db.query(SupportLiveSession)
               .filter(SupportLiveSession.id == row.id, SupportLiveSession.status == before)
               .update({SupportLiveSession.status: how, SupportLiveSession.ended_at: now,
                        SupportLiveSession.reason: reason}, synchronize_session=False))
    db.commit()
    db.refresh(row)
    if not claimed:
        return row
    zone = _site_zone(db)
    who = row.agent_name or "Support"
    if how == "ended" and row.connected_at:
        what = "Screen shared" if (row.kind == "screen" and row.screen_ok) else "Talked"
        line = f"{what} {_clock(row.connected_at, zone)}-{_clock(now, zone)} with {who}."
    else:
        line = f"Live help with {who} could not connect."
    db.add(SupportMessage(ticket_id=row.ticket_id, author_type="system", body=line, created_at=now))
    db.commit()
    _queue_ended(db, row)
    return row


def _queue_ended(db: Session, row: SupportLiveSession) -> None:
    ticket = db.get(Ticket, row.ticket_id)
    domain = db.get(WidgetDomain, row.widget_domain_id)
    suser = db.get(SupportUser, row.support_user_id)
    if ticket is None or domain is None:
        return
    support_webhooks.queue(db, domain, ticket, "live_ended", suser, status_word(ticket), None,
                           live=_live_payload(row))
    db.commit()


# --- Call phone --------------------------------------------------------------------------

def _digits(phone) -> str:
    return re.sub(r"\D", "", str(phone or ""))[:30]


def call_link(db: Session, ticket: Ticket, agent: User, phone, now: Optional[datetime] = None) -> SupportCallLink:
    """The agent is about to phone the ticket's contact: that call's record will take the ticket number."""
    digits = _digits(phone)
    if len(digits) < 6:
        raise SupportError("That is not a phone number.")
    row = SupportCallLink(ticket_number=ticket.ticket_number, agent_id=agent.id, phone=digits,
                          created_at=now or _now())
    db.add(row)
    db.commit()
    return row


def linked_ticket(db: Session, agent_id: Optional[int], phone, call_at: Optional[datetime]) -> Optional[str]:
    """The ticket number for an outbound call from this agent to this number, placed after Call phone.

    Matched on the last 9 digits (a country code or a leading 0 do not matter), within
    CALL_LINK_MINUTES after the link, and used once.
    """
    digits = _digits(phone)
    if not agent_id or len(digits) < 6:
        return None
    at = call_at or _now()
    if at.tzinfo:
        at = at.astimezone(timezone.utc).replace(tzinfo=None)
    rows = (db.query(SupportCallLink)
            .filter(SupportCallLink.agent_id == agent_id, SupportCallLink.used_at.is_(None),
                    SupportCallLink.created_at <= at + timedelta(minutes=1),
                    SupportCallLink.created_at >= at - timedelta(minutes=CALL_LINK_MINUTES))
            .order_by(SupportCallLink.created_at.desc()).all())
    for row in rows:
        if row.phone[-9:] == digits[-9:]:
            row.used_at = _now()
            return row.ticket_number
    return None
