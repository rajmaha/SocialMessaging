"""
The public support API, /api/support/v1 -- used by the widget's Support tab,
by apps (the OMS phone app), and by any site's own code.

Every call names the site with  X-Support-Key: <widget key>  (an active widget
domain with support switched on). A call about a person also carries one of:

  Authorization: Support <identity token>   the site signed its logged-in user
                                            (app/services/support_identity.py)
  X-Webchat-Session: <session id>           an anonymous visitor who verified an
                                            email with the webchat code; only
                                            where the domain allows anonymous

| GET  config                         | categories, limits, what the site allows        |
| GET  me                             | who the call is from                            |
| POST requests                       | multipart: subject, body, category, priority,    |
|                                     |   phone, screen, url, request_id, files[]        |
| GET  requests?page=                 | the person's own requests                        |
| GET  requests/{no}                  | one of them, with its thread                     |
| GET  requests/{no}/changes?after=   | new messages after a message id, and the status  |
| POST requests/{no}/messages         | multipart: body, request_id, files[]             |
| GET  files/{message}/{index}        | an attachment: ?exp=&sig= (as handed out) or the |
|                                     |   person's own headers                           |
| GET  live                           | live help an agent is asking this person for     |
| POST live/{id}/accept               | JSON {screen_ok}: a one-time pass for the socket |
| POST live/{id}/deny                 |                                                  |
| WS   live/ws?pass=                  | the signalling socket (support_live_relay.py)    |

Live help rules are app/services/support_live.py.

Every rule is app/services/support_service.py; this file only reads the call
and answers.
"""

import hashlib
import hmac
import time
from typing import List, Optional

from fastapi import (APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile,
                     WebSocket)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.conversation import Conversation
from app.models.support import SupportMessage, SupportUser
from app.models.ticket import Ticket
from app.models.widget_domain import WidgetDomain
from app.database import SessionLocal
from app.services import rate_limit, support_identity
from app.services import support_live as live
from app.services import support_live_relay as relay
from app.services import support_service as svc
from app.services.support_service import SupportError, SupportFile

router = APIRouter(prefix="/api/support/v1", tags=["support"])

REQUESTS_PER_PERSON = 10     # an hour
REQUESTS_PER_IP = 30         # an hour
REPLIES_PER_PERSON = 60      # an hour
FILE_LINK_SECONDS = 3600


# --- who is calling ------------------------------------------------------------------

def _domain(request: Request, db: Session) -> WidgetDomain:
    key = (request.headers.get("x-support-key") or "").strip()
    if not key or len(key) > 200:
        raise HTTPException(status_code=401, detail="This site is not set up for support.")
    domain = db.query(WidgetDomain).filter(WidgetDomain.widget_key == key).first()
    if domain is None or not domain.is_active:
        raise HTTPException(status_code=401, detail="This site is not set up for support.")
    if not domain.support_enabled:
        raise HTTPException(status_code=403, detail="Support is not available here.")
    return domain


def _person(request: Request, db: Session, domain: WidgetDomain) -> SupportUser:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("support "):
        claims = support_identity.verify(domain, auth[8:].strip())
        if claims is None:
            raise HTTPException(status_code=401, detail="Your sign-in for support has expired. Reload the page.")
        person = support_identity.support_user_for(db, domain, claims)
        db.commit()
        return person
    session_id = (request.headers.get("x-webchat-session") or "").strip()
    if session_id:
        if not domain.allow_anonymous:
            raise HTTPException(status_code=401, detail="Sign in to the site to ask for support.")
        conv = (db.query(Conversation)
                .filter(Conversation.conversation_id == session_id[:100], Conversation.platform == "webchat")
                .first())
        person = support_identity.support_user_for_email(db, domain, conv.contact_id, conv.contact_name) if conv else None
        if person is None:
            raise HTTPException(status_code=401, detail="Verify your email to ask for support.")
        db.commit()
        return person
    raise HTTPException(status_code=401, detail="Sign in to ask for support.")


def _fail(err: SupportError):
    raise HTTPException(status_code=err.status_code, detail=err.message)


# --- file links ------------------------------------------------------------------------

def _file_sig(message_id: int, index: int, exp: int) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"support-file|{message_id}|{index}|{exp}".encode(),
                    hashlib.sha256).hexdigest()


def file_link(message_id: int, index: int, now: Optional[float] = None) -> str:
    """A link to one attachment that works for an hour without headers (an <a href>, an <img>)."""
    exp = int((now or time.time()) + FILE_LINK_SECONDS)
    return f"/api/support/v1/files/{message_id}/{index}?exp={exp}&sig={_file_sig(message_id, index, exp)}"


def _with_links(view: dict) -> dict:
    for m in view.get("messages", []):
        for a in m.get("attachments", []):
            a["url"] = file_link(m["id"], a["index"])
    return view


# --- reading uploads -----------------------------------------------------------------------

async def _files(uploads: Optional[List[UploadFile]]) -> List[SupportFile]:
    out = []
    for up in uploads or []:
        if up is None or not up.filename:
            continue
        if len(out) >= svc.MAX_FILES:
            raise SupportError(f"Attach at most {svc.MAX_FILES} files.")
        data = await up.read(svc.MAX_FILE_BYTES + 1)     # never more than one byte past the limit
        out.append(SupportFile(up.filename, data, up.content_type or ""))
    return out


# --- the calls -----------------------------------------------------------------------------

@router.get("/config")
def config(request: Request, db: Session = Depends(get_db)):
    domain = _domain(request, db)
    branding = domain.branding_overrides or {}
    return {
        "name": domain.display_name,
        "primary_color": branding.get("primary_color") if isinstance(branding, dict) else None,
        "categories": [c for c in (domain.support_categories or []) if isinstance(c, str) and c.strip()],
        "priorities": list(svc.PRIORITIES),
        "allow_anonymous": bool(domain.allow_anonymous),
        "chat_enabled": bool(domain.chat_enabled),
        "max_files": svc.MAX_FILES,
        "max_file_mb": svc.MAX_FILE_BYTES // (1024 * 1024),
        "file_types": sorted(svc.ALLOWED_EXTENSIONS),
        "live_help": bool(domain.live_help_enabled),
    }


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    domain = _domain(request, db)
    p = _person(request, db, domain)
    return {"name": p.name, "email": p.email, "phone": p.phone, "signed": bool(p.uid)}


@router.post("/requests")
async def create_request(
    request: Request,
    subject: str = Form(""),
    body: str = Form(""),
    category: str = Form(""),
    priority: str = Form("normal"),
    phone: str = Form(""),
    screen: str = Form(""),
    url: str = Form(""),
    request_id: str = Form(""),
    source: str = Form("support_widget"),
    files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
):
    domain = _domain(request, db)
    person = _person(request, db, domain)
    ip = rate_limit.client_ip(request)
    if (rate_limit.count(db, "support_request_user", person.id, 60) >= REQUESTS_PER_PERSON
            or rate_limit.count(db, "support_request_ip", ip, 60) >= REQUESTS_PER_IP):
        raise HTTPException(status_code=429, detail="Too many requests in an hour. Try again later.")
    try:
        uploads = await _files(files)
        ticket = svc.create_request(db, domain, person, {
            "subject": subject, "body": body, "category": category, "priority": priority,
            "phone": phone, "screen": screen, "url": url, "request_id": request_id,
        }, uploads, source=source)
    except SupportError as err:
        _fail(err)
    rate_limit.hit(db, "support_request_user", person.id, commit=False)
    rate_limit.hit(db, "support_request_ip", ip)
    return _with_links(svc.customer_view(db, ticket))


@router.get("/requests")
def list_requests(request: Request, page: int = Query(1, ge=1, le=10_000), db: Session = Depends(get_db)):
    domain = _domain(request, db)
    person = _person(request, db, domain)
    return svc.customer_requests(db, domain, person, page)


def _own(request: Request, db: Session, ticket_no: str):
    domain = _domain(request, db)
    person = _person(request, db, domain)
    try:
        return domain, person, svc.find_for_customer(db, domain, person, ticket_no)
    except SupportError as err:
        _fail(err)


@router.get("/requests/{ticket_no}")
def get_request(ticket_no: str, request: Request, db: Session = Depends(get_db)):
    _, _, ticket = _own(request, db, ticket_no)
    view = _with_links(svc.customer_view(db, ticket))
    view["live"] = _asking(db, ticket)
    return view


def _asking(db: Session, ticket: Ticket) -> Optional[dict]:
    """The live help request waiting on this ticket for the customer's answer, if any."""
    row = live.current(db, ticket)
    return live.customer_view(db, row) if row is not None and row.status == "requested" else None


@router.get("/requests/{ticket_no}/changes")
def changes(ticket_no: str, request: Request, after: int = Query(0, ge=0), db: Session = Depends(get_db)):
    """What the open thread needs to refresh itself: messages after `after`, and the status."""
    _, _, ticket = _own(request, db, ticket_no)
    view = _with_links(svc.customer_view(db, ticket))
    view["messages"] = [m for m in view["messages"] if m["id"] > after]
    out = {k: view[k] for k in ("ticket_no", "status", "status_label", "can_reply", "updated_at", "messages")}
    out["live"] = _asking(db, ticket)
    return out


@router.post("/requests/{ticket_no}/messages")
async def add_message(
    ticket_no: str,
    request: Request,
    body: str = Form(""),
    request_id: str = Form(""),
    files: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
):
    _, person, ticket = _own(request, db, ticket_no)
    if rate_limit.count(db, "support_reply_user", person.id, 60) >= REPLIES_PER_PERSON:
        raise HTTPException(status_code=429, detail="Too many messages in an hour. Try again later.")
    try:
        svc.reply(db, ticket, body, await _files(files), customer=person, request_id=request_id or None)
    except SupportError as err:
        _fail(err)
    rate_limit.hit(db, "support_reply_user", person.id)
    db.refresh(ticket)
    return _with_links(svc.customer_view(db, ticket))


@router.get("/files/{message_id}/{index}")
def get_file(message_id: int, index: int, request: Request,
             exp: Optional[int] = Query(None), sig: Optional[str] = Query(None),
             db: Session = Depends(get_db)):
    msg = db.get(SupportMessage, message_id)
    not_found = HTTPException(status_code=404, detail="That file was not found.")
    if msg is None or not msg.attachments or index < 0 or index >= len(msg.attachments):
        raise not_found
    if sig is not None and exp is not None:
        if exp < time.time() or not hmac.compare_digest(sig, _file_sig(message_id, index, exp)):
            raise HTTPException(status_code=403, detail="That link has expired.")
    else:
        domain = _domain(request, db)
        person = _person(request, db, domain)
        ticket = db.get(Ticket, msg.ticket_id)
        if ticket is None or ticket.support_site_id != domain.id or ticket.support_user_id != person.id:
            raise not_found
    entry = msg.attachments[index]
    path = svc.file_path(entry)
    if not path:
        raise not_found
    import os
    if not os.path.exists(path):
        raise not_found
    return FileResponse(
        path,
        media_type=entry.get("type") or "application/octet-stream",
        filename=entry.get("name") or "file",
        content_disposition_type="attachment",
        headers={"Content-Security-Policy": "sandbox", "Cache-Control": "private, max-age=300",
                 "X-Content-Type-Options": "nosniff"},
    )


# --- live help ----------------------------------------------------------------------------

def _live_row(request: Request, db: Session, live_id: int):
    domain = _domain(request, db)
    person = _person(request, db, domain)
    try:
        return live.for_customer(db, domain, person, live_id)
    except SupportError as err:
        _fail(err)


@router.get("/live")
def live_pending(request: Request, db: Session = Depends(get_db)):
    """Live help an agent is asking this person for, on any of their requests; null when none."""
    domain = _domain(request, db)
    person = _person(request, db, domain)
    if not domain.live_help_enabled:
        return {"live": None}
    row = live.pending_for(db, domain, person)
    return {"live": live.customer_view(db, row) if row is not None else None}


@router.post("/live/{live_id}/accept")
async def live_accept(live_id: int, request: Request, body: dict = Body(default_factory=dict),
                      db: Session = Depends(get_db)):
    """Yes: a one-time pass (2 minutes, single use) for the socket, and the ICE servers to use.

    screen_ok false: this device cannot share its screen (an iPhone), so a screen
    request becomes a talk; the agent is told.
    """
    row = _live_row(request, db, live_id)
    screen_ok = bool((body or {}).get("screen_ok", True)) if isinstance(body, dict) else True
    try:
        row, token = live.accept(db, row, screen_ok)
    except SupportError as err:
        _fail(err)
    await relay.tell_agent(row.id)
    return {"live": live.customer_view(db, row), "pass": token, "ice_servers": live.ice_servers(db),
            "ws_path": "/api/support/v1/live/ws", "pass_seconds": live.PASS_SECONDS}


@router.post("/live/{live_id}/deny")
async def live_deny(live_id: int, request: Request, db: Session = Depends(get_db)):
    row = live.deny(db, _live_row(request, db, live_id))
    await relay.tell_agent(row.id)
    return {"live": live.customer_view(db, row)}


@router.websocket("/live/ws")
async def live_socket(websocket: WebSocket, pass_: str = Query("", alias="pass")):
    """The customer's signalling socket. The pass is used up the moment it connects."""
    await websocket.accept()
    db = SessionLocal()
    try:
        row = live.claim_pass(db, pass_)
        if row is None:
            await websocket.close(code=4401, reason="This live help link has expired.")
            return
        hello = {"role": "customer", "live": live.customer_view(db, row), "screen_ok": bool(row.screen_ok),
                 "ice_servers": live.ice_servers(db)}
        live_id = row.id
    finally:
        db.close()
    await relay.tell_agent(live_id)
    await relay.run(websocket, live_id, "customer", hello)
