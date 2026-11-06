"""The agent side of the support desk: queue, take, conversation, reply, status, resend."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.models.domain_agent import DomainAgent
from app.models.support import SupportMessage, SupportUser, SupportWebhook
from app.models.ticket import Ticket
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.services import secret_box
from app.services import support_service as svc


@pytest.fixture
def env(fresh_schema, secret_key, monkeypatch, tmp_path):
    from app.database import get_db
    from app.dependencies import get_current_user
    from app.routes import tickets

    sent = []
    monkeypatch.setattr(svc, "run_later", lambda job: job())
    monkeypatch.setattr(svc, "mailer", lambda to, subject, html: sent.append((to, subject, html)) or True)
    monkeypatch.setattr(svc, "_broadcast", lambda ids, event: None)
    monkeypatch.setattr(svc, "STORAGE_ROOT", str(tmp_path / "support"))

    Session = sessionmaker(bind=fresh_schema)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    with Session() as s:
        admin = User(username="admin", email="admin@agents.test", full_name="Admin Person", role="admin", is_active=True)
        ram = User(username="ram", email="ram@agents.test", full_name="Ram Bahadur", role="user", is_active=True)
        gita = User(username="gita", email="gita@agents.test", full_name="Gita Devi", role="user", is_active=True)
        s.add_all([admin, ram, gita])
        s.flush()
        d1 = WidgetDomain(domain="oms.example.com", widget_key="wk-1", display_name="Example OMS", is_active=1,
                          support_enabled=1, webhook_url="https://oms.example.com/support-hook",
                          identity_secret=secret_box.seal("s1"))
        d2 = WidgetDomain(domain="two.example.com", widget_key="wk-2", display_name="Two", is_active=1,
                          support_enabled=1)
        s.add_all([d1, d2])
        s.flush()
        s.add(DomainAgent(widget_domain_id=d1.id, user_id=ram.id))
        s.add(DomainAgent(widget_domain_id=d1.id, user_id=gita.id))
        p1 = SupportUser(widget_domain_id=d1.id, uid="oms.example.com:42", name="Sita Rai", email="sita@example.com")
        p2 = SupportUser(widget_domain_id=d2.id, uid="x:1", name="Other", email="other@example.com")
        s.add_all([p1, p2])
        s.commit()
        t1 = svc.create_request(s, d1, p1, {"subject": "Blank salary sheet", "body": "Nothing prints."})
        t2 = svc.create_request(s, d2, p2, {"subject": "Other site issue", "body": "Help"})
        ids = {"admin": admin.id, "ram": ram.id, "gita": gita.id, "t1": t1.ticket_number,
               "t2": t2.ticket_number, "t1_id": t1.id}

    who = {"user": "ram"}

    def _user():
        with Session() as s:
            u = s.query(User).filter_by(username=who["user"]).one()
            s.expunge(u)
            return u

    app = FastAPI()
    app.include_router(tickets.router)
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    for dep in tickets.router.dependencies:                      # require_page("tickets")
        app.dependency_overrides[dep.dependency] = lambda: None
    return {"client": TestClient(app), "Session": Session, "ids": ids, "who": who, "sent": sent}


def as_(env, name):
    env["who"]["user"] = name
    return env["client"]


def test_queue_shows_only_linked_sites(env):
    q = as_(env, "ram").get("/api/tickets/support-queue").json()
    assert [t["ticket_number"] for t in q] == [env["ids"]["t1"]]
    assert q[0]["source"] == "support_widget" and q[0]["support_site_name"] == "Example OMS"
    assert q[0]["support_subject"] == "Blank salary sheet"
    everything = as_(env, "admin").get("/api/tickets/support-queue").json()
    assert {t["ticket_number"] for t in everything} == {env["ids"]["t1"], env["ids"]["t2"]}


def test_ticket_lists_survive_support_tickets(env):
    """TicketResponse once refused source support_widget, failing every list."""
    c = as_(env, "admin")
    assert c.get("/api/tickets").status_code == 200
    assert c.get(f"/api/tickets/find?number={env['ids']['t1']}").json()["support_site_name"] == "Example OMS"
    assert as_(env, "ram").get("/api/tickets").status_code == 200      # non-admin list no longer crashes


def test_take_once(env):
    t1 = env["ids"]["t1"]
    r = as_(env, "ram").post(f"/api/tickets/{t1}/take")
    assert r.status_code == 200 and r.json()["assigned_to"] == env["ids"]["ram"]
    assert as_(env, "ram").post(f"/api/tickets/{t1}/take").status_code == 200   # again: still theirs
    r = as_(env, "gita").post(f"/api/tickets/{t1}/take")
    assert r.status_code == 409 and "Ram Bahadur" in r.json()["detail"]
    assert as_(env, "ram").get("/api/tickets/support-queue").json() == []
    mine = as_(env, "ram").get("/api/tickets/my-tickets").json()
    assert [t["ticket_number"] for t in mine] == [t1]


def test_conversation_and_reply(env):
    t1 = env["ids"]["t1"]
    c = as_(env, "gita")
    conv = c.get(f"/api/tickets/{t1}/conversation").json()
    assert conv["site"]["name"] == "Example OMS" and conv["customer"]["name"] == "Sita Rai"
    assert [m["body"] for m in conv["messages"]] == ["Nothing prints."]
    assert conv["delivery"]["event"] == "request_created"

    r = c.post(f"/api/tickets/{t1}/conversation", data={"body": "Please try again."},
               files=[("files", ("fix.pdf", b"%PDF-1.4", "application/pdf"))])
    assert r.status_code == 200, r.text
    conv = r.json()
    last = conv["messages"][-1]
    assert last["author_name"] == "Gita Devi" and last["attachments"][0]["url"].startswith("/api/support/v1/files/")
    assert conv["assigned_to"] == env["ids"]["gita"] and conv["status"] == "replied"
    to, subject, html = env["sent"][-1]
    assert to == "sita@example.com" and "Please try again." in html
    assert conv["delivery"]["event"] == "reply" and conv["delivery"]["status"] == "pending"


def test_empty_reply_refused(env):
    r = as_(env, "ram").post(f"/api/tickets/{env['ids']['t1']}/conversation", data={"body": "  "})
    assert r.status_code == 422


def test_status_from_put_goes_through_support(env):
    t1, tid = env["ids"]["t1"], env["ids"]["t1_id"]
    r = as_(env, "ram").put(f"/api/tickets/{tid}", json={"status": "solved", "priority": "high"})
    assert r.status_code == 200 and r.json()["status"] == "solved" and r.json()["priority"] == "high"
    with env["Session"]() as s:
        bodies = [m.body for m in s.query(SupportMessage).filter_by(ticket_id=tid).order_by(SupportMessage.id)]
        assert bodies[-1] == "Marked solved by Ram."
        assert s.query(SupportWebhook).filter_by(ticket_id=tid, event="status").count() == 1
    assert "solved" in env["sent"][-1][2]


def test_status_from_follow_up_form_goes_through_support(env):
    t1, tid = env["ids"]["t1"], env["ids"]["t1_id"]
    r = as_(env, "ram").post(f"/api/tickets/{t1}/notes", json={"status": "solved", "note": "called her"})
    assert r.status_code == 200
    with env["Session"]() as s:
        t = s.get(Ticket, tid)
        assert t.status.value == "solved" and t.solved_at is not None
        # the internal note stays internal: not in the customer's thread
        bodies = [m.body for m in s.query(SupportMessage).filter_by(ticket_id=tid)]
        assert "called her" not in bodies and "Marked solved by Ram." in bodies


def test_resend(env):
    t1, tid = env["ids"]["t1"], env["ids"]["t1_id"]
    c = as_(env, "ram")
    assert c.post(f"/api/tickets/{t1}/webhook-resend").status_code == 409     # nothing failed yet
    with env["Session"]() as s:
        row = s.query(SupportWebhook).filter_by(ticket_id=tid).one()
        row.status, row.last_error, row.tries = "failed", "the site answered 500", 6
        s.commit()
    assert c.get(f"/api/tickets/{t1}/conversation").json()["delivery"]["status"] == "failed"
    assert c.post(f"/api/tickets/{t1}/webhook-resend").json()["status"] == "queued"
    assert c.get(f"/api/tickets/{t1}/conversation").json()["delivery"]["status"] == "pending"


def test_not_a_support_ticket(env):
    with env["Session"]() as s:
        s.add(Ticket(ticket_number="TCK-plain", phone_number="9800000000"))
        s.commit()
    c = as_(env, "admin")
    for path in ("/conversation", "/take", "/webhook-resend"):
        method = c.get if path == "/conversation" else c.post
        assert method(f"/api/tickets/TCK-plain{path}").status_code == 404


def test_support_counts_badge(env):
    """The header badge: waiting to be taken, plus mine whose last word is the customer's."""
    t1 = env["ids"]["t1"]
    assert as_(env, "ram").get("/api/tickets/support-counts").json() == {"queue": 1, "waiting": 0, "total": 1}
    assert as_(env, "admin").get("/api/tickets/support-counts").json()["queue"] == 2   # every site
    as_(env, "ram").post(f"/api/tickets/{t1}/take")
    assert as_(env, "ram").get("/api/tickets/support-counts").json() == {"queue": 0, "waiting": 1, "total": 1}
    assert as_(env, "gita").get("/api/tickets/support-counts").json()["total"] == 0
    as_(env, "ram").post(f"/api/tickets/{t1}/conversation", data={"body": "Looking now."})
    assert as_(env, "ram").get("/api/tickets/support-counts").json()["waiting"] == 0
    with env["Session"]() as s:
        t = s.query(Ticket).filter_by(ticket_number=t1).one()
        svc.reply(s, t, "Still blank.", customer=s.query(SupportUser).filter_by(uid="oms.example.com:42").one())
    assert as_(env, "ram").get("/api/tickets/support-counts").json()["waiting"] == 1


def test_unclaimed_request_tells_linked_agents_and_admins(env):
    with env["Session"]() as s:
        t = s.query(Ticket).filter_by(ticket_number=env["ids"]["t1"]).one()
        told = set(svc._agents_for(s, t))
        assert told == {env["ids"]["ram"], env["ids"]["gita"], env["ids"]["admin"]}
        t.assigned_to = env["ids"]["ram"]
        assert svc._agents_for(s, t) == [env["ids"]["ram"]]


def test_forward_hands_the_ticket_to_an_agent(env):
    t1, tid = env["ids"]["t1"], env["ids"]["t1_id"]
    c = as_(env, "ram")
    c.post(f"/api/tickets/{t1}/take")
    # refused before anything is written: no agent, no reason, oneself, nobody
    assert c.post(f"/api/tickets/{t1}/notes", json={"status": "forwarded", "forward_reason": "x"}).status_code == 422
    assert c.post(f"/api/tickets/{t1}/notes", json={"status": "forwarded", "forward_to": env["ids"]["gita"]}).status_code == 422
    assert c.post(f"/api/tickets/{t1}/notes", json={"status": "forwarded", "forward_to": env["ids"]["ram"], "forward_reason": "x"}).status_code == 422
    assert c.post(f"/api/tickets/{t1}/notes", json={"status": "forwarded", "forward_to": 999999, "forward_reason": "x"}).status_code == 422
    with env["Session"]() as s:
        assert s.get(Ticket, tid).assigned_to == env["ids"]["ram"] and s.get(Ticket, tid).status.value == "pending"

    r = c.post(f"/api/tickets/{t1}/notes", json={"status": "forwarded", "forward_to": env["ids"]["gita"], "forward_reason": "Billing question"})
    assert r.status_code == 200, r.text
    with env["Session"]() as s:
        t = s.get(Ticket, tid)
        assert t.assigned_to == env["ids"]["gita"] and t.status.value == "forwarded"
        assert t.forward_target == "Gita Devi" and t.forward_reason == "Billing question"
        note = s.query(Ticket).filter(Ticket.parent_ticket_id == tid).one()
        assert note.app_type_data["follow_up_note"] == "Forwarded to Gita Devi: Billing question"
    mine = as_(env, "gita").get("/api/tickets/my-tickets").json()
    assert [t["ticket_number"] for t in mine] == [t1]
