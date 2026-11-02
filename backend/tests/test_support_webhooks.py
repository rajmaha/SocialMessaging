import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.models.support import SupportUser, SupportWebhook
from app.models.ticket import Ticket
from app.models.widget_domain import WidgetDomain
from app.services import secret_box
from app.services import support_webhooks as wh

SECRET = "site-identity-secret"
T0 = datetime(2026, 11, 2, 9, 0, 0)


@pytest.fixture
def db(fresh_schema, secret_key):
    s = Session(bind=fresh_schema)
    yield s
    s.rollback()
    s.close()


@pytest.fixture
def site(monkeypatch):
    """A stand-in for the customer's site: records each POST, answers from a list."""
    calls, answers = [], []

    def post(url, body, headers):
        calls.append({"url": url, "body": body, "headers": headers})
        a = answers.pop(0) if answers else (200, "ok")
        if isinstance(a, Exception):
            raise a
        return a

    monkeypatch.setattr(wh, "poster", post)
    return {"calls": calls, "answers": answers}


def make(db, url="https://oms.example.com/support-hook", secret=SECRET):
    d = WidgetDomain(domain=f"{uuid.uuid4().hex[:6]}.example.com", widget_key=uuid.uuid4().hex,
                     display_name="Example", is_active=1, support_enabled=1, webhook_url=url,
                     identity_secret=secret_box.seal(secret) if secret else None)
    db.add(d)
    db.flush()
    p = SupportUser(widget_domain_id=d.id, uid="oms.example.com:42", name="Ram")
    db.add(p)
    db.flush()
    t = Ticket(ticket_number=f"SUP-{uuid.uuid4().hex[:8]}", phone_number="-", support_site_id=d.id,
               support_user_id=p.id, support_subject="Blank sheet", source="support_widget")
    db.add(t)
    db.flush()
    row = wh.queue(db, d, t, "reply", p, "replied", {"author_type": "agent", "author": "Gita (Support)",
                                                     "body": "Try now.", "at": None})
    row.next_try_at = T0
    db.commit()
    return d, t, row


def test_delivered_and_signed(db, site):
    d, t, row = make(db)
    assert wh.send_due(db, now=T0) == {"sent": 1, "not_sent": 0}
    call = site["calls"][0]
    assert call["url"] == "https://oms.example.com/support-hook"
    expected = "sha256=" + hmac.new(SECRET.encode(), call["body"], hashlib.sha256).hexdigest()
    assert call["headers"]["X-Support-Signature"] == expected
    assert call["headers"]["X-Support-Event-Id"] == row.event_id
    body = json.loads(call["body"])
    assert body["event"] == "reply" and body["ticket_no"] == t.ticket_number
    assert body["uid"] == "oms.example.com:42" and body["message"]["body"] == "Try now."
    db.refresh(row)
    assert row.status == "sent" and row.tries == 1 and row.sent_at == T0
    assert wh.send_due(db, now=T0 + timedelta(hours=1))["sent"] == 0      # never twice


def test_retry_schedule_then_failed(db, site):
    _, _, row = make(db)
    site["answers"].extend([(500, "boom")] * 10)
    now = T0
    seen = []
    for expected_gap in wh.RETRY_MINUTES:
        assert wh.send_due(db, now=now)["not_sent"] == 1
        db.refresh(row)
        assert row.status == "pending" and "500" in row.last_error
        assert row.next_try_at == now + timedelta(minutes=expected_gap)
        assert wh.send_due(db, now=row.next_try_at - timedelta(seconds=1))["not_sent"] == 0  # not early
        now = row.next_try_at
        seen.append(row.tries)
    wh.send_due(db, now=now)
    db.refresh(row)
    assert row.status == "failed" and row.tries == wh.MAX_TRIES == 6
    assert len(site["calls"]) == 6
    assert wh.send_due(db, now=now + timedelta(days=1))["not_sent"] == 0  # failed rows rest


def test_500_then_200(db, site):
    _, _, row = make(db)
    site["answers"].extend([(503, "busy"), (200, "ok")])
    wh.send_due(db, now=T0)
    db.refresh(row)
    wh.send_due(db, now=row.next_try_at)
    db.refresh(row)
    assert row.status == "sent" and row.tries == 2 and row.last_error is None
    ids = {c["headers"]["X-Support-Event-Id"] for c in site["calls"]}
    assert ids == {row.event_id}                                             # same id on the retry


def test_unreachable_is_retried(db, site):
    _, _, row = make(db)
    site["answers"].append(ConnectionError("refused"))
    wh.send_due(db, now=T0)
    db.refresh(row)
    assert row.status == "pending" and "could not reach" in row.last_error


@pytest.mark.parametrize("url, words", [
    ("http://oms.example.com/hook", "https"),
    ("ftp://oms.example.com/hook", "https"),
    ("https://10.0.0.5/hook", "private"),
    ("https://169.254.169.254/latest", "private"),
    ("not a url", "https"),
])
def test_bad_address_fails_at_once(db, site, url, words):
    _, _, row = make(db, url=url)
    wh.send_due(db, now=T0)
    db.refresh(row)
    assert row.status == "failed" and words in row.last_error and site["calls"] == []


def test_local_http_allowed_for_development(db, site):
    assert wh.address_problem("http://oms.localhost.local/support-hook") is None
    assert wh.address_problem("http://127.0.0.1:8080/hook") is None
    assert wh.address_problem("https://oms.saraloms.com/support-hook") is None


def test_no_secret_fails_at_once(db, site):
    _, _, row = make(db, secret=None)
    wh.send_due(db, now=T0)
    db.refresh(row)
    assert row.status == "failed" and "secret" in row.last_error and site["calls"] == []


def test_two_workers_never_send_one_twice(fresh_schema, secret_key, site):
    Maker = sessionmaker(bind=fresh_schema)
    with Maker() as s:
        _, _, row = make(s)
        row_id = row.id
    a, b = Maker(), Maker()
    try:
        first = wh._claim(a, T0)
        second = wh._claim(b, T0)
        assert first == [row_id] and second == []
    finally:
        a.close()
        b.close()


def test_stuck_sending_goes_back(db, site):
    _, _, row = make(db)
    row.status, row.next_try_at = "sending", T0 - timedelta(minutes=30)
    db.commit()
    assert wh.send_due(db, now=T0)["sent"] == 1


def test_resend_after_failure(db, site):
    _, t, row = make(db, url="http://not-allowed.example.com/hook")
    wh.send_due(db, now=T0)
    db.refresh(row)
    assert row.status == "failed"
    d = db.get(WidgetDomain, row.widget_domain_id)
    d.webhook_url = "https://oms.example.com/support-hook"
    db.commit()
    assert wh.resend(db, t).id == row.id
    db.refresh(row)
    assert (row.status, row.tries) == ("pending", 0)
    assert wh.send_due(db)["sent"] == 1
    assert wh.resend(db, t) is None                                           # nothing failed now
    assert wh.last_delivery(db, t).status == "sent"


def test_queue_skipped_without_address(db):
    d = WidgetDomain(domain="x.example.com", widget_key="wk-x", display_name="X", is_active=1, webhook_url=" ")
    db.add(d)
    db.flush()
    t = Ticket(ticket_number="SUP-x", phone_number="-", support_site_id=d.id)
    db.add(t)
    db.flush()
    assert wh.queue(db, d, t, "status", None, "solved") is None
    with pytest.raises(ValueError):
        wh.queue(db, d, t, "nonsense", None, "solved")
