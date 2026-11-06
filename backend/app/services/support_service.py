"""
Every rule of the support desk, for the public API, the app and the agent screens.

A request is a Ticket (source support_widget | support_app) on a widget domain,
raised by a SupportUser; its customer-visible thread is SupportMessage rows.
Internal ticket notes (FLW- child tickets) are never shown to the customer.

Each write commits its own transaction. What must happen with it -- the thread
message, the webhook delivery -- is written inside it; what may happen after
-- the customer's email, the agents' live event -- runs once it has committed,
off the request (run_later), and never fails the write.
"""

import asyncio
import logging
import os
import re
import secrets
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Callable, List, Optional, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain_agent import DomainAgent
from app.models.support import SupportMessage, SupportUser
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.services import support_webhooks

log = logging.getLogger(__name__)

PRIORITIES = tuple(p.value for p in TicketPriority)       # low, normal, high, urgent
SOURCES = ("support_widget", "support_app")
REOPEN_DAYS = 7
SUBJECT_MIN, SUBJECT_MAX = 3, 200
BODY_MAX = 10_000
PHONE_MAX = 30
SCREEN_MAX = 500
URL_MAX = 500
CATEGORY_MAX = 60
MAX_FILES = 5
MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "webp": "image/webp", "pdf": "application/pdf", "txt": "text/plain", "csv": "text/csv",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

STORAGE_ROOT = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "attachment_storage", "support"))


class SupportError(Exception):
    """A refusal with a sentence for the person; status_code is what the API answers."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class SupportFile:
    name: str
    data: bytes
    content_type: str = ""


# --- what runs after a commit ---------------------------------------------------
# Tests replace run_later with a function that runs the job at once, and mailer
# with a stand-in: the development database's SMTP settings are real.

def _run_in_thread(job: Callable[[], None]) -> None:
    threading.Thread(target=job, daemon=True).start()


run_later: Callable[[Callable[[], None]], None] = _run_in_thread
mailer: Optional[Callable[[str, str, str], bool]] = None   # (to, subject, html) -> sent
_event_loop: Optional[asyncio.AbstractEventLoop] = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """main.py hands over its loop at start-up, so a sync route can reach the agents' live stream."""
    global _event_loop
    _event_loop = loop


def _send_mail(to: str, subject: str, html: str) -> None:
    try:
        if mailer is not None:
            mailer(to, subject, html)
            return
        from app.database import SessionLocal
        from app.services.email_service import email_service
        db = SessionLocal()
        try:
            email_service.send_system_email(to, subject, html, db=db)
        finally:
            db.close()
    except Exception as err:  # an email that fails must never undo a reply
        log.warning("Support email to %s failed: %s", to, err)


def _broadcast(user_ids: Sequence[int], event: dict) -> None:
    loop = _event_loop
    if not user_ids or loop is None or loop.is_closed():
        return
    from app.services.events_service import events_service
    for uid in set(user_ids):
        try:
            asyncio.run_coroutine_threadsafe(events_service.broadcast_to_user(uid, event), loop)
        except Exception as err:
            log.warning("Support live event to agent %s failed: %s", uid, err)


# --- tidying input ----------------------------------------------------------------

def _plain(value, limit: int) -> str:
    """Text with tags stripped and outer space trimmed, cut to limit."""
    if value is None:
        return ""
    text = re.sub(r"<[^>]*>", "", str(value))
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    return text[:limit]


def _url(value) -> Optional[str]:
    text = _plain(value, URL_MAX)
    return text if re.match(r"^https?://", text, re.I) else None


def _category(domain: WidgetDomain, value) -> Optional[str]:
    text = _plain(value, CATEGORY_MAX)
    offered = [c for c in (domain.support_categories or []) if isinstance(c, str) and c.strip()]
    if not offered:
        return text or None
    if not text:
        raise SupportError("Choose a category.")
    for c in offered:
        if c.strip().lower() == text.lower():
            return c.strip()
    raise SupportError("Choose one of the categories offered.")


def _priority(value) -> str:
    text = _plain(value, 10).lower() or TicketPriority.NORMAL.value
    if text not in PRIORITIES:
        raise SupportError("Priority must be Low, Normal, High or Urgent.")
    return text


def _check_files(files: Sequence[SupportFile]) -> List[tuple]:
    """(file, extension, content type) for each file, or a refusal naming the first bad one."""
    files = [f for f in (files or []) if f is not None and f.data]
    if len(files) > MAX_FILES:
        raise SupportError(f"Attach at most {MAX_FILES} files.")
    checked = []
    for f in files:
        name = os.path.basename((f.name or "file").replace("\\", "/"))[:150] or "file"
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in ALLOWED_EXTENSIONS:
            raise SupportError(f"{name}: only pictures, PDF, Word, Excel, CSV and text files can be attached.")
        if len(f.data) > MAX_FILE_BYTES:
            raise SupportError(f"{name} is larger than 10 MB.")
        checked.append((SupportFile(name, f.data, f.content_type), ext, ALLOWED_EXTENSIONS[ext]))
    return checked


def _store_files(ticket_id: int, checked: List[tuple], written: List[str]) -> List[dict]:
    """Writes the files under attachment_storage/support/<ticket>/ and answers their JSON entries."""
    if not checked:
        return []
    folder = os.path.join(STORAGE_ROOT, str(int(ticket_id)))
    os.makedirs(folder, exist_ok=True)
    stored = []
    for f, ext, ctype in checked:
        disk = f"{secrets.token_hex(16)}.{ext}"
        path = os.path.join(folder, disk)
        with open(path, "wb") as fh:
            fh.write(f.data)
        written.append(path)
        stored.append({"name": f.name, "path": f"{int(ticket_id)}/{disk}", "size": len(f.data), "type": ctype})
    return stored


def file_path(entry: dict) -> Optional[str]:
    """The file on disk for a stored attachment entry, or None if it points anywhere else."""
    rel = str((entry or {}).get("path") or "")
    if not re.match(r"^\d+/[0-9a-f]{32}\.[a-z]{2,5}$", rel):
        return None
    return os.path.join(STORAGE_ROOT, rel)


def _remove(paths: List[str]) -> None:
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


# --- words the customer sees ----------------------------------------------------------

def status_word(ticket: Ticket) -> str:
    """solved | replied | waiting -- the three states a customer reads."""
    if _status(ticket) == TicketStatus.SOLVED.value:
        return "solved"
    if ticket.last_author == "agent":
        return "replied"
    return "waiting"


STATUS_LABELS = {"waiting": "Waiting for support", "replied": "Replied", "solved": "Solved"}


def _status(ticket: Ticket) -> str:
    s = ticket.status
    return s.value if hasattr(s, "value") else str(s)


def agent_display(user: Optional[User]) -> str:
    """How an agent is named to a customer: first name and (Support)."""
    name = ""
    if user is not None:
        name = (user.display_name or user.full_name or "").strip().split(" ")[0]
    return f"{name} (Support)" if name else "Support"


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    dt = _aware(dt)
    return dt.isoformat() if dt else None


# --- reading ---------------------------------------------------------------------------

def find_for_customer(db: Session, domain: WidgetDomain, suser: SupportUser, ticket_no: str) -> Ticket:
    """The person's own ticket on this domain, or a 404 refusal -- never someone else's."""
    t = (db.query(Ticket)
         .filter(Ticket.ticket_number == str(ticket_no or "")[:40],
                 Ticket.support_site_id == domain.id,
                 Ticket.support_user_id == suser.id)
         .first())
    if t is None:
        raise SupportError("That request was not found.", 404)
    return t


def messages(db: Session, ticket: Ticket) -> List[SupportMessage]:
    return (db.query(SupportMessage)
            .filter(SupportMessage.ticket_id == ticket.id)
            .order_by(SupportMessage.created_at, SupportMessage.id)
            .all())


def _message_view(m: SupportMessage) -> dict:
    return {
        "id": m.id,
        "author_type": m.author_type,
        "author_name": m.author_name or ("Support" if m.author_type == "agent" else ""),
        "body": m.body,
        "attachments": [
            {"index": i, "name": a.get("name"), "size": a.get("size"), "type": a.get("type")}
            for i, a in enumerate(m.attachments or [])
        ],
        "created_at": _iso(m.created_at),
    }


def customer_view(db: Session, ticket: Ticket) -> dict:
    """What the customer may see of a ticket. Never internal notes, assignee or other fields."""
    word = status_word(ticket)
    solved = _aware(ticket.solved_at)
    can_reply = word != "solved" or (
        solved is not None and solved > datetime.now(timezone.utc) - timedelta(days=REOPEN_DAYS))
    return {
        "ticket_no": ticket.ticket_number,
        "subject": ticket.support_subject,
        "status": word,
        "status_label": STATUS_LABELS[word],
        "category": ticket.category,
        "priority": ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority,
        "screen": ticket.support_screen,
        "url": ticket.support_url,
        "created_at": _iso(ticket.created_at),
        "updated_at": _iso(ticket.updated_at),
        "can_reply": can_reply,
        "messages": [_message_view(m) for m in messages(db, ticket)],
    }


def customer_requests(db: Session, domain: WidgetDomain, suser: SupportUser, page: int = 1, per_page: int = 20) -> dict:
    """The person's own requests, newest activity first."""
    page = max(1, int(page or 1))
    q = (db.query(Ticket)
         .filter(Ticket.support_site_id == domain.id, Ticket.support_user_id == suser.id)
         .order_by(Ticket.updated_at.desc(), Ticket.id.desc()))
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()
    items = []
    for t in rows:
        last = (db.query(SupportMessage).filter(SupportMessage.ticket_id == t.id)
                .order_by(SupportMessage.created_at.desc(), SupportMessage.id.desc()).first())
        word = status_word(t)
        items.append({
            "ticket_no": t.ticket_number,
            "subject": t.support_subject,
            "status": word,
            "status_label": STATUS_LABELS[word],
            "updated_at": _iso(t.updated_at),
            "last_message": (last.body[:140] if last else ""),
            # support wrote last: the widget counts it as unread until the person opens it
            "from_support": t.last_author == "agent",
        })
    return {"items": items, "page": page, "has_more": page * per_page < total, "total": total}


# --- writing ---------------------------------------------------------------------------

def _new_ticket_number() -> str:
    return f"SUP-{datetime.utcnow():%Y%m%d}-{uuid.uuid4().hex[:8].upper()}"


def _agents_for(db: Session, ticket: Ticket) -> List[int]:
    """Who hears about a customer's write: the assignee, else the domain's linked agents and
    every admin (an admin's Support queue lists every site, so they must hear of it too)."""
    if ticket.assigned_to:
        return [ticket.assigned_to]
    if not ticket.support_site_id:
        return []
    ids = [r.user_id for r in db.query(DomainAgent).filter(DomainAgent.widget_domain_id == ticket.support_site_id)]
    ids += [u.id for u in db.query(User.id).filter(User.role == "admin", User.is_active.isnot(False))]
    return list(dict.fromkeys(ids))


def _tell_agents(db: Session, ticket: Ticket, what: str) -> None:
    from app.services.events_service import events_service
    event = events_service.create_event("support_ticket", {
        "what": what, "ticket_id": ticket.id, "ticket_number": ticket.ticket_number,
        "subject": ticket.support_subject, "customer": ticket.customer_name,
    })
    ids = _agents_for(db, ticket)
    run_later(lambda: _broadcast(ids, event))


def _tell_customer(domain: WidgetDomain, ticket: Ticket, suser: Optional[SupportUser], headline: str, body: str) -> None:
    to = (suser.email if suser else None) or ticket.customer_email
    if not to:
        return
    link = ticket.support_url or (f"https://{domain.domain}" if domain and domain.domain else "")
    site = escape(domain.display_name if domain else "Support")
    html = (
        f"<p>{escape(headline)}</p>"
        + (f"<blockquote style=\"border-left:3px solid #ccc;margin:0;padding:4px 12px;white-space:pre-wrap\">"
           f"{escape(body)}</blockquote>" if body else "")
        + f"<p>Request <b>{escape(ticket.ticket_number)}</b>: {escape(ticket.support_subject or '')}</p>"
        + (f"<p><a href=\"{escape(link, quote=True)}\">Open {site}</a> and choose Help -&gt; Support to reply.</p>"
           if link else "")
    )
    subject = f"Re: {ticket.support_subject or 'Your support request'} [{ticket.ticket_number}]"
    run_later(lambda: _send_mail(to, subject, html))


def _webhook_message(m: SupportMessage) -> dict:
    return {"author_type": m.author_type, "author": m.author_name, "body": m.body[:2000], "at": _iso(m.created_at)}


def _by_request_id(db: Session, request_id: Optional[str]) -> Optional[SupportMessage]:
    if not request_id:
        return None
    return db.query(SupportMessage).filter(SupportMessage.request_id == request_id).first()


def _clean_request_id(value) -> Optional[str]:
    text = str(value or "").strip()
    return text[:64] if re.match(r"^[A-Za-z0-9_\-]{8,64}$", text) else None


def create_request(db: Session, domain: WidgetDomain, suser: SupportUser, data: dict,
                   files: Sequence[SupportFile] = (), source: str = "support_widget") -> Ticket:
    """A new request. A repeated request_id answers the ticket the first press made."""
    if not domain or not domain.is_active or not domain.support_enabled:
        raise SupportError("Support is not available here.", 403)
    if source not in SOURCES:
        source = "support_widget"
    request_id = _clean_request_id(data.get("request_id"))
    again = _by_request_id(db, request_id)
    if again is not None:
        return db.get(Ticket, again.ticket_id)

    subject = _plain(data.get("subject"), SUBJECT_MAX)
    body = _plain(data.get("body"), BODY_MAX)
    if len(subject) < SUBJECT_MIN:
        raise SupportError("Give the request a subject of at least 3 characters.")
    if not body:
        raise SupportError("Describe what you need help with.")
    category = _category(domain, data.get("category"))
    priority = _priority(data.get("priority"))
    phone = _plain(data.get("phone"), PHONE_MAX) or (suser.phone or "")
    checked = _check_files(files)

    ticket = Ticket(
        ticket_number=_new_ticket_number(),
        phone_number=phone or "-",
        organization_id=domain.organization_id,
        customer_name=suser.name or suser.email or "Customer",
        customer_email=suser.email,
        category=category,
        status=TicketStatus.PENDING,
        priority=TicketPriority(priority),
        assigned_to=None,
        source=source,
        support_site_id=domain.id,
        support_user_id=suser.id,
        support_subject=subject,
        support_screen=_plain(data.get("screen"), SCREEN_MAX) or None,
        support_url=_url(data.get("url")),
        last_author="customer",
    )
    if phone and not suser.phone:
        suser.phone = phone
    written: List[str] = []
    try:
        db.add(ticket)
        db.flush()
        first = SupportMessage(ticket_id=ticket.id, author_type="customer", author_name=ticket.customer_name,
                               body=body, attachments=_store_files(ticket.id, checked, written) or None,
                               request_id=request_id, created_at=datetime.utcnow())
        db.add(first)
        db.flush()
        support_webhooks.queue(db, domain, ticket, "request_created", suser, status_word(ticket),
                               _webhook_message(first))
        db.commit()
    except IntegrityError:
        db.rollback()
        _remove(written)
        again = _by_request_id(db, request_id)   # the same press arrived twice at once
        if again is not None:
            return db.get(Ticket, again.ticket_id)
        raise
    except Exception:
        db.rollback()
        _remove(written)
        raise
    _tell_agents(db, ticket, "created")
    return ticket


def reply(db: Session, ticket: Ticket, body, files: Sequence[SupportFile] = (), *,
          customer: Optional[SupportUser] = None, agent: Optional[User] = None,
          request_id: Optional[str] = None) -> SupportMessage:
    """A message from the customer or an agent (exactly one of the two)."""
    if (customer is None) == (agent is None):
        raise ValueError("reply() needs either customer or agent")
    if not ticket.support_site_id:
        raise SupportError("That ticket is not a support request.", 400)
    request_id = _clean_request_id(request_id)
    again = _by_request_id(db, request_id)
    if again is not None:
        return again
    text = _plain(body, BODY_MAX)
    checked = _check_files(files)
    if not text and not checked:
        raise SupportError("Write a message or attach a file.")

    domain = db.get(WidgetDomain, ticket.support_site_id)
    suser = db.get(SupportUser, ticket.support_user_id) if ticket.support_user_id else None
    reopened = False
    if customer is not None:
        if _status(ticket) == TicketStatus.SOLVED.value:
            solved = _aware(ticket.solved_at)
            if solved is None or solved <= datetime.now(timezone.utc) - timedelta(days=REOPEN_DAYS):
                when = solved.strftime("%d %b %Y") if solved else "earlier"
                raise SupportError(f"This request was closed on {when}. Raise a new one.", 409)
            reopened = True
        author_type, author_name, author_id = "customer", customer.name or customer.email or "Customer", None
    else:
        author_type, author_name, author_id = "agent", agent_display(agent), agent.id

    written: List[str] = []
    try:
        if reopened:
            ticket.status = TicketStatus.PENDING
            ticket.solved_at = None
            db.add(SupportMessage(ticket_id=ticket.id, author_type="system", author_name=None,
                                  body="Reopened by the customer.", created_at=datetime.utcnow()))
        msg = SupportMessage(ticket_id=ticket.id, author_type=author_type, author_name=author_name,
                             author_user_id=author_id, body=text,
                             attachments=_store_files(ticket.id, checked, written) or None,
                             request_id=request_id, created_at=datetime.utcnow())
        db.add(msg)
        ticket.last_author = author_type
        ticket.updated_at = datetime.now(timezone.utc)
        if agent is not None and not ticket.assigned_to:
            ticket.assigned_to = agent.id      # replying takes the ticket out of the shared queue
        db.flush()
        if agent is not None:
            support_webhooks.queue(db, domain, ticket, "reply", suser, status_word(ticket), _webhook_message(msg))
        db.commit()
    except IntegrityError:
        db.rollback()
        _remove(written)
        again = _by_request_id(db, request_id)
        if again is not None:
            return again
        raise
    except Exception:
        db.rollback()
        _remove(written)
        raise

    if agent is not None:
        _tell_customer(domain, ticket, suser, f"{author_name} replied to your request.", text)
    else:
        _tell_agents(db, ticket, "reopened" if reopened else "reply")
    return msg


def set_status(db: Session, ticket: Ticket, status: str, agent: User) -> bool:
    """An agent's change of status. Answers whether anything changed."""
    if not ticket.support_site_id:
        return False
    status = str(status.value if hasattr(status, "value") else status)
    if status not in {s.value for s in TicketStatus}:
        raise SupportError("Unknown status.", 400)
    before = _status(ticket)
    if before == status:
        return False
    domain = db.get(WidgetDomain, ticket.support_site_id)
    suser = db.get(SupportUser, ticket.support_user_id) if ticket.support_user_id else None
    who = (agent.display_name or agent.full_name or agent.username or "Support") if agent else "Support"
    ticket.status = TicketStatus(status)
    note = None
    if status == TicketStatus.SOLVED.value:
        ticket.solved_at = datetime.now(timezone.utc)
        note = f"Marked solved by {agent_display(agent).replace(' (Support)', '')}."
    elif before == TicketStatus.SOLVED.value:
        ticket.solved_at = None
        note = f"Reopened by {agent_display(agent).replace(' (Support)', '')}."
    msg = None
    if note:
        msg = SupportMessage(ticket_id=ticket.id, author_type="system", body=note, created_at=datetime.utcnow())
        db.add(msg)
    ticket.updated_at = datetime.now(timezone.utc)
    db.flush()
    support_webhooks.queue(db, domain, ticket, "status", suser, status_word(ticket),
                           _webhook_message(msg) if msg else None)
    db.commit()
    log.info("Support ticket %s: %s -> %s by %s", ticket.ticket_number, before, status, who)
    if status == TicketStatus.SOLVED.value:
        _tell_customer(domain, ticket, suser, "Your request has been marked solved. "
                       f"Reply within {REOPEN_DAYS} days if you still need help.", "")
    elif before == TicketStatus.SOLVED.value:
        _tell_customer(domain, ticket, suser, "Your request has been reopened.", "")
    return True


def agent_conversation(db: Session, ticket: Ticket) -> dict:
    """The thread as an agent sees it, with the site and the customer."""
    domain = db.get(WidgetDomain, ticket.support_site_id) if ticket.support_site_id else None
    suser = db.get(SupportUser, ticket.support_user_id) if ticket.support_user_id else None
    names = {}
    out = []
    for m in messages(db, ticket):
        v = _message_view(m)
        if m.author_type == "agent" and m.author_user_id:
            if m.author_user_id not in names:
                u = db.get(User, m.author_user_id)
                names[m.author_user_id] = (u.display_name or u.full_name or u.username) if u else v["author_name"]
            v["author_name"] = names[m.author_user_id]
        out.append(v)
    return {
        "ticket_no": ticket.ticket_number,
        "subject": ticket.support_subject,
        "site": {"id": domain.id, "name": domain.display_name, "domain": domain.domain} if domain else None,
        "customer": {"name": suser.name, "email": suser.email, "phone": suser.phone,
                     "uid": suser.uid, "signed": bool(suser.uid)} if suser else None,
        "screen": ticket.support_screen,
        "url": ticket.support_url,
        "status": status_word(ticket),
        "messages": out,
    }
