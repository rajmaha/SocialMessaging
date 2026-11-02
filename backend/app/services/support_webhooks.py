"""
Telling a support site what happened to its tickets.

queue() writes a SupportWebhook row in the caller's transaction (an outbox), so
a delivery exists exactly when the change it describes was committed. Sending
and retrying is send_due(), the scheduler job (phase 1, step A6).
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.support import SupportUser, SupportWebhook
from app.models.ticket import Ticket
from app.models.widget_domain import WidgetDomain

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
