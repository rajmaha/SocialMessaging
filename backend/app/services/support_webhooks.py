"""
Telling a support site what happened to its tickets.

queue() writes a SupportWebhook row in the caller's transaction (an outbox), so
a delivery exists exactly when the change it describes was committed.
send_due() -- the scheduler job, every minute -- POSTs what is due:

    POST <webhook_url>
    Content-Type: application/json
    X-Support-Event: reply
    X-Support-Event-Id: <uuid>          the same on every retry: a site ignores a repeat
    X-Support-Signature: sha256=<hex HMAC-SHA256 of the raw body under the domain's identity secret>

A 2xx answer is delivered. Anything else is tried again after 1, 5, 15 and 60
minutes and 6 hours, then left failed with the reason; an agent can Resend.
Redirects are not followed. The address must be https (http only for a local
host while developing).
"""

import hashlib
import hmac
import ipaddress
import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Callable, Optional, Tuple
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.support import SupportUser, SupportWebhook
from app.models.ticket import Ticket
from app.models.widget_domain import WidgetDomain
from app.services import secret_box

log = logging.getLogger(__name__)

EVENTS = ("request_created", "reply", "status")


def queue(db: Session, domain: WidgetDomain, ticket: Ticket, event: str,
          suser: Optional[SupportUser], status_word: str, message: Optional[dict] = None) -> Optional[SupportWebhook]:
    """A delivery for this change when the domain has a webhook address; None when it has none."""
    if event not in EVENTS:
        raise ValueError(f"unknown support webhook event {event!r}")
    if not domain or not (domain.webhook_url or "").strip():
        return None
    event_id = uuid.uuid4().hex
    payload = {
        "event_id": event_id,
        "event": event,
        "ticket_no": ticket.ticket_number,
        "uid": suser.uid if suser else None,
        "email": suser.email if suser and not suser.uid else None,
        "subject": ticket.support_subject,
        "status": status_word,
        "message": message,
    }
    row = SupportWebhook(widget_domain_id=domain.id, ticket_id=ticket.id, event_id=event_id,
                         event=event, payload=payload, status="pending", tries=0,
                         next_try_at=datetime.utcnow())
    db.add(row)
    return row


# --- sending -----------------------------------------------------------------------

RETRY_MINUTES = (1, 5, 15, 60, 360)    # after the 1st, 2nd, ... failed try
MAX_TRIES = len(RETRY_MINUTES) + 1     # the first try and five retries
TIMEOUT_SECONDS = 10
STUCK_MINUTES = 10                     # a row left 'sending' by a dead worker goes back
BATCH = 50


def _post(url: str, body: bytes, headers: dict) -> Tuple[int, str]:
    import httpx
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        r = client.post(url, content=body, headers=headers)
        return r.status_code, r.text[:300]


# Tests replace this: (url, body, headers) -> (status code, answer text)
poster: Callable[[str, bytes, dict], Tuple[int, str]] = _post


def signature(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def address_problem(url: Optional[str]) -> Optional[str]:
    """Why a webhook address cannot be used, or None when it can."""
    try:
        u = urlparse((url or "").strip())
    except ValueError:
        return "the webhook address is not a URL"
    host = (u.hostname or "").lower()
    if not host or u.scheme not in ("https", "http"):
        return "the webhook address must start with https://"
    local = host in ("localhost", "127.0.0.1", "::1") or host.endswith((".local", ".localhost", ".test"))
    if u.scheme == "http" and not local:
        return "the webhook address must start with https://"
    try:
        ip = ipaddress.ip_address(host)
        if not local and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved):
            return "the webhook address points at a private network"
    except ValueError:
        pass
    return None


def _claim(db: Session, now: datetime) -> list:
    """Ids of due deliveries, marked 'sending' so no other worker takes them."""
    db.execute(text(
        "UPDATE support_webhooks SET status = 'pending' "
        "WHERE status = 'sending' AND next_try_at < :stuck"), {"stuck": now - timedelta(minutes=STUCK_MINUTES)})
    rows = db.execute(text(
        "UPDATE support_webhooks SET status = 'sending', tries = tries + 1, next_try_at = :now "
        "WHERE id IN (SELECT id FROM support_webhooks "
        "             WHERE status = 'pending' AND next_try_at <= :now "
        "             ORDER BY id LIMIT :n FOR UPDATE SKIP LOCKED) "
        "RETURNING id"), {"now": now, "n": BATCH}).fetchall()
    db.commit()
    return [r[0] for r in rows]


def _settle(db: Session, row: SupportWebhook, ok: bool, error: Optional[str], now: datetime) -> None:
    if ok:
        row.status, row.sent_at, row.last_error = "sent", now, None
    elif row.tries >= MAX_TRIES:
        row.status, row.last_error = "failed", (error or "")[:500]
    else:
        row.status = "pending"
        row.last_error = (error or "")[:500]
        row.next_try_at = now + timedelta(minutes=RETRY_MINUTES[row.tries - 1])
    db.commit()


def deliver(db: Session, row: SupportWebhook, now: Optional[datetime] = None) -> bool:
    """One try of one claimed delivery. Answers whether the site took it."""
    now = now or datetime.utcnow()
    domain = db.get(WidgetDomain, row.widget_domain_id)
    url = (domain.webhook_url or "").strip() if domain else ""
    problem = address_problem(url) if domain else "the site no longer exists"
    secret = secret_box.open_(domain.identity_secret) if domain else None
    if not problem and not secret:
        problem = "the site has no identity secret to sign with"
    if problem:
        row.tries = MAX_TRIES           # nothing a retry could change
        _settle(db, row, False, problem, now)
        return False
    payload = dict(row.payload or {})
    payload["sent_at"] = now.replace(microsecond=0).isoformat() + "Z"
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "SocialMessaging-Support/1",
        "X-Support-Event": row.event,
        "X-Support-Event-Id": row.event_id,
        "X-Support-Signature": signature(secret, body),
    }
    try:
        code, answer = poster(url, body, headers)
    except Exception as err:
        _settle(db, row, False, f"could not reach the site: {type(err).__name__}: {err}"[:500], now)
        return False
    if 200 <= int(code) < 300:
        _settle(db, row, True, None, now)
        return True
    _settle(db, row, False, f"the site answered {code}: {answer}"[:500], now)
    return False


def send_due(db: Session, now: Optional[datetime] = None) -> dict:
    """Every due delivery, once. Answers how many went and how many did not."""
    now = now or datetime.utcnow()
    sent = failed = 0
    for row_id in _claim(db, now):
        row = db.get(SupportWebhook, row_id)
        if row is None:
            continue
        try:
            if deliver(db, row, now):
                sent += 1
            else:
                failed += 1
        except Exception as err:   # one bad row must not stop the rest
            db.rollback()
            log.warning("Support webhook %s failed: %s", row_id, err)
            failed += 1
    return {"sent": sent, "not_sent": failed}


def run_job() -> None:
    """The scheduler's entry point: its own session, never raises."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        send_due(db)
    except Exception as err:
        log.warning("Support webhook job failed: %s", err)
    finally:
        db.close()


def last_delivery(db: Session, ticket: Ticket) -> Optional[SupportWebhook]:
    return (db.query(SupportWebhook).filter(SupportWebhook.ticket_id == ticket.id)
            .order_by(SupportWebhook.id.desc()).first())


def resend(db: Session, ticket: Ticket) -> Optional[SupportWebhook]:
    """An agent's Resend: the latest failed delivery of the ticket goes again, from its first try."""
    row = (db.query(SupportWebhook)
           .filter(SupportWebhook.ticket_id == ticket.id, SupportWebhook.status == "failed")
           .order_by(SupportWebhook.id.desc()).first())
    if row is None:
        return None
    row.status, row.tries, row.next_try_at, row.last_error = "pending", 0, datetime.utcnow(), None
    db.commit()
    return row
