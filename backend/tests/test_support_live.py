"""Live help on a support request: asking, answering, the one-time pass, the relay, Call phone."""

import time
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.models.support import SupportCallLink, SupportLiveSession, SupportMessage, SupportUser, SupportWebhook
from app.models.ticket import Ticket
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.services import secret_box
from app.services import support_live as live
from app.services import support_service as svc
from app.services.support_identity import sign
from app.services.support_service import SupportError

SECRET = "site-identity-secret"


@pytest.fixture
def env(fresh_schema, secret_key, monkeypatch, tmp_path):
    from app.database import get_db
    from app.dependencies import get_current_user
    from app.routes import support_public, tickets
    from app.services import support_live_relay
    import app.dependencies as deps

    monkeypatch.setattr(svc, "run_later", lambda job: job())
    monkeypatch.setattr(svc, "mailer", lambda *a: True)
    monkeypatch.setattr(svc, "_broadcast", lambda ids, event: None)
    monkeypatch.setattr(svc, "STORAGE_ROOT", str(tmp_path / "support"))

    Session = sessionmaker(bind=fresh_schema)
    # every place that opens its own session reads the test database
    for mod in (support_public, tickets, support_live_relay, deps):
        monkeypatch.setattr(mod, "SessionLocal", Session)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    with Session() as s:
        ram = User(username="ram", email="ram@agents.test", full_name="Ram Bahadur", role="user", is_active=True)
        gita = User(username="gita", email="gita@agents.test", full_name="Gita Devi", role="user", is_active=True)
        s.add_all([ram, gita])
        s.flush()
        d1 = WidgetDomain(domain="oms.example.com", widget_key="wk-1", display_name="Example OMS", is_active=1,
                          support_enabled=1, live_help_enabled=1, webhook_url="https://oms.example.com/support-hook",
                          identity_secret=secret_box.seal(SECRET))
        d2 = WidgetDomain(domain="two.example.com", widget_key="wk-2", display_name="Two", is_active=1,
                          support_enabled=1, live_help_enabled=0, identity_secret=secret_box.seal(SECRET))
        s.add_all([d1, d2])
        s.flush()
        p1 = SupportUser(widget_domain_id=d1.id, uid="oms.example.com:42", name="Sita Rai", email="sita@example.com")
        p2 = SupportUser(widget_domain_id=d1.id, uid="oms.example.com:43", name="Hari", email="hari@example.com")
        p3 = SupportUser(widget_domain_id=d2.id, uid="two:1", name="Other", email="other@example.com")
        s.add_all([p1, p2, p3])
        s.commit()
        t1 = svc.create_request(s, d1, p1, {"subject": "Blank salary sheet", "body": "Nothing prints.",
                                             "phone": "+977 980-1234567"})
        t2 = svc.create_request(s, d1, p2, {"subject": "Another", "body": "Help"})
        t3 = svc.create_request(s, d2, p3, {"subject": "No live here", "body": "Help"})
        for t in (t1, t2, t3):
            t.assigned_to = ram.id
        s.commit()
        ids = {"ram": ram.id, "gita": gita.id, "t1": t1.ticket_number, "t2": t2.ticket_number,
               "t3": t3.ticket_number, "t1_id": t1.id}

    who = {"user": "ram"}

    def _user():
        with Session() as s:
            u = s.query(User).filter_by(username=who["user"]).one()
            s.expunge(u)
            return u

    app = FastAPI()
    app.include_router(support_public.router)
    app.include_router(tickets.router)
    app.include_router(tickets.live_socket_router)
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    for dep in tickets.router.dependencies:
        app.dependency_overrides[dep.dependency] = lambda: None
    return {"client": TestClient(app), "Session": Session, "ids": ids, "who": who}


def _customer(uid="oms.example.com:42", key="wk-1"):
    exp = int(time.time()) + 300
    token = sign(SECRET, {"site": key, "uid": uid, "exp": exp})
    return {"X-Support-Key": key, "Authorization": f"Support {token}"}


def _ticket(s, number):
    return s.query(Ticket).filter_by(ticket_number=number).one()


def _ram(s):
    return s.query(User).filter_by(username="ram").one()


# --- the rules --------------------------------------------------------------------------

def test_ask_needs_the_holder_live_help_and_a_kind(env):
    with env["Session"]() as s:
        t1, t3 = _ticket(s, env["ids"]["t1"]), _ticket(s, env["ids"]["t3"])
        gita = s.query(User).filter_by(username="gita").one()
        with pytest.raises(SupportError) as e:
            live.ask(s, t1, _ram(s), "video")
        assert "talk" in e.value.message
        with pytest.raises(SupportError) as e:
            live.ask(s, t1, gita, "talk")
        assert e.value.status_code == 403 and "Take the request" in e.value.message
        with pytest.raises(SupportError) as e:
            live.ask(s, t3, _ram(s), "talk")
        assert e.value.status_code == 403 and "switched off" in e.value.message
        row = live.ask(s, t1, _ram(s), "screen")
        assert row.status == "requested" and row.agent_name == "Ram"
        assert (row.expires_at - row.requested_at).total_seconds() == live.ASK_SECONDS
        with pytest.raises(SupportError) as e:
            live.ask(s, t1, _ram(s), "talk")
        assert e.value.status_code == 409
        hook = s.query(SupportWebhook).filter_by(event="live_request").one()
        assert hook.payload["live"]["kind"] == "screen" and hook.payload["uid"] == "oms.example.com:42"
        assert hook.payload["live"]["agent"] == "Ram"


def test_three_asks_in_ten_minutes(env):
    with env["Session"]() as s:
        t1, ram = _ticket(s, env["ids"]["t1"]), _ram(s)
        now = datetime.utcnow()
        for i in range(3):
            row = live.ask(s, t1, ram, "talk", now + timedelta(seconds=i * 70))
            live.deny(s, row, now + timedelta(seconds=i * 70 + 1))
        with pytest.raises(SupportError) as e:
            live.ask(s, t1, ram, "talk", now + timedelta(seconds=240))
        assert e.value.status_code == 429
        assert live.ask(s, t1, ram, "talk", now + timedelta(minutes=11)).status == "requested"


def test_unanswered_expires_on_read(env):
    with env["Session"]() as s:
        t1 = _ticket(s, env["ids"]["t1"])
        row = live.ask(s, t1, _ram(s), "talk")
        assert live.current(s, t1).id == row.id
        later = row.expires_at + timedelta(seconds=1)
        assert live.current(s, t1, later) is None
        s.refresh(row)
        assert row.status == "expired"
        with pytest.raises(SupportError) as e:
            live.accept(s, row, True)
        assert "run out" in e.value.message


def test_accept_hands_one_pass_used_once(env):
    with env["Session"]() as s:
        t1 = _ticket(s, env["ids"]["t1"])
        row = live.ask(s, t1, _ram(s), "screen")
        row, token = live.accept(s, row, screen_ok=False)
        assert row.status == "accepted" and row.screen_ok == 0 and len(token) > 30
        assert row.pass_hash != token                       # only its hash is kept
        with pytest.raises(SupportError) as e:
            live.accept(s, row, True)
        assert e.value.status_code == 409
        assert live.claim_pass(s, "wrong") is None
        assert live.claim_pass(s, token).id == row.id
        assert live.claim_pass(s, token) is None            # single use


def test_unused_pass_fails_after_two_minutes(env):
    with env["Session"]() as s:
        t1 = _ticket(s, env["ids"]["t1"])
        row = live.ask(s, t1, _ram(s), "talk")
        row, token = live.accept(s, row, True)
        late = row.pass_expires_at + timedelta(seconds=1)
        assert live.claim_pass(s, token, late) is None
        s.refresh(row)
        assert row.status == "failed" and "never connected" in row.reason
        lines = [m.body for m in s.query(SupportMessage).filter(SupportMessage.ticket_id == t1.id).all()]
        assert any("could not connect" in (b or "") for b in lines)


def test_finish_writes_the_thread_line_and_tells_the_site(env):
    with env["Session"]() as s:
        t1 = _ticket(s, env["ids"]["t1"])
        row = live.ask(s, t1, _ram(s), "screen")
        row, token = live.accept(s, row, True)
        live.claim_pass(s, token)
        live.mark_connected(s, row)
        assert row.status == "connected"
        live.finish(s, row, "ended", None, row.connected_at + timedelta(minutes=13))
        assert row.status == "ended"
        line = (s.query(SupportMessage).filter_by(ticket_id=t1.id, author_type="system")
                .order_by(SupportMessage.id.desc()).first())
        assert line.body.startswith("Screen shared ") and line.body.endswith("with Ram.")
        assert s.query(SupportWebhook).filter_by(event="live_ended").count() == 1
        live.finish(s, row, "ended", None)                  # twice: nothing more
        assert s.query(SupportWebhook).filter_by(event="live_ended").count() == 1


def test_screen_refused_by_the_device_reads_as_talked(env):
    with env["Session"]() as s:
        t1 = _ticket(s, env["ids"]["t1"])
        row = live.ask(s, t1, _ram(s), "screen")
        row, token = live.accept(s, row, screen_ok=False)
        live.mark_connected(s, row)
        live.finish(s, row, "ended", None)
        line = s.query(SupportMessage).filter_by(ticket_id=t1.id, author_type="system").all()[-1]
        assert line.body.startswith("Talked ")


def test_ending_before_connecting_is_a_failure(env):
    with env["Session"]() as s:
        t1 = _ticket(s, env["ids"]["t1"])
        row = live.ask(s, t1, _ram(s), "talk")
        row, _ = live.accept(s, row, True)
        live.finish(s, row, "ended", None)
        assert row.status == "failed"
        line = s.query(SupportMessage).filter_by(ticket_id=t1.id, author_type="system").all()[-1]
        assert "could not connect" in line.body


def test_cancel_and_deny_tell_the_site_once(env):
    with env["Session"]() as s:
        t1 = _ticket(s, env["ids"]["t1"])
        ram = _ram(s)
        row = live.ask(s, t1, ram, "talk")
        live.cancel(s, row, ram)
        assert row.status == "cancelled"
        live.cancel(s, row, ram)
        row2 = live.ask(s, t1, ram, "talk")
        live.deny(s, row2)
        live.deny(s, row2)
        assert row2.status == "denied"
        assert s.query(SupportWebhook).filter_by(event="live_ended").count() == 2


def test_call_link_stamps_one_outbound_call(env):
    with env["Session"]() as s:
        t1, ram = _ticket(s, env["ids"]["t1"]), _ram(s)
        now = datetime.utcnow()
        with pytest.raises(SupportError):
            live.call_link(s, t1, ram, "12")
        live.call_link(s, t1, ram, "+977 980-1234567", now)
        assert live.linked_ticket(s, env["ids"]["gita"], "9801234567", now) is None   # another agent
        assert live.linked_ticket(s, ram.id, "0000000000", now) is None              # another number
        assert live.linked_ticket(s, ram.id, "9801234567", now + timedelta(minutes=31)) is None
        assert live.linked_ticket(s, ram.id, "09801234567", now + timedelta(minutes=2)) == t1.ticket_number
        s.commit()
        assert live.linked_ticket(s, ram.id, "9801234567", now + timedelta(minutes=3)) is None  # used once
        assert s.query(SupportCallLink).one().used_at is not None


# --- the API ------------------------------------------------------------------------------

def test_customer_sees_answers_and_cannot_touch_anothers(env):
    c = env["client"]
    t1 = env["ids"]["t1"]
    assert c.get("/api/support/v1/live", headers=_customer()).json() == {"live": None}
    assert c.get("/api/support/v1/config", headers=_customer()).json()["live_help"] is True

    r = c.post(f"/api/tickets/{t1}/live", json={"kind": "screen"})
    assert r.status_code == 200, r.text
    lid = r.json()["live"]["id"]

    pending = c.get("/api/support/v1/live", headers=_customer()).json()["live"]
    assert pending["id"] == lid and pending["kind"] == "screen" and pending["agent"] == "Ram"
    assert pending["ticket_no"] == t1 and 0 < pending["seconds_left"] <= 60
    assert c.get(f"/api/support/v1/requests/{t1}", headers=_customer()).json()["live"]["id"] == lid
    assert c.get(f"/api/support/v1/requests/{t1}/changes?after=0", headers=_customer()).json()["live"]["id"] == lid

    other = _customer(uid="oms.example.com:43")
    assert c.get("/api/support/v1/live", headers=other).json() == {"live": None}
    assert c.post(f"/api/support/v1/live/{lid}/accept", json={}, headers=other).status_code == 404

    r = c.post(f"/api/support/v1/live/{lid}/accept", json={"screen_ok": True}, headers=_customer())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pass"] and body["ws_path"] == "/api/support/v1/live/ws" and body["ice_servers"]
    assert c.post(f"/api/support/v1/live/{lid}/accept", json={}, headers=_customer()).status_code == 409
    state = c.get(f"/api/tickets/{t1}/live").json()
    assert state["live"]["status"] == "accepted" and state["live"]["screen_ok"] is True and state["holder"] is True


def test_agent_routes_refuse_others(env):
    c = env["client"]
    t1 = env["ids"]["t1"]
    env["who"]["user"] = "gita"
    assert c.post(f"/api/tickets/{t1}/live", json={"kind": "talk"}).status_code == 403
    env["who"]["user"] = "ram"
    lid = c.post(f"/api/tickets/{t1}/live", json={"kind": "talk"}).json()["live"]["id"]
    env["who"]["user"] = "gita"
    assert c.post(f"/api/tickets/{t1}/live/{lid}/cancel").status_code == 403
    env["who"]["user"] = "ram"
    assert c.post(f"/api/tickets/{t1}/live/{lid}/cancel").json()["live"]["status"] == "cancelled"
    assert c.post(f"/api/tickets/{t1}/call-link", json={}).json() == {"status": "ok"}
    assert c.post(f"/api/tickets/{env['ids']['t3']}/live", json={"kind": "talk"}).status_code == 403


def test_deny_from_the_customer(env):
    c = env["client"]
    t1 = env["ids"]["t1"]
    lid = c.post(f"/api/tickets/{t1}/live", json={"kind": "talk"}).json()["live"]["id"]
    assert c.post(f"/api/support/v1/live/{lid}/deny", headers=_customer()).json()["live"]["status"] == "denied"
    assert c.get(f"/api/tickets/{t1}/live").json()["live"]["status"] == "denied"


# --- the relay ----------------------------------------------------------------------------

def tok(env, name):
    """A real sign-in token for one of the fixture's agents."""
    from app.auth_tokens import issue_token
    from app.models.user import User
    with env["Session"]() as s:
        return issue_token(s.get(User, env["ids"][name]))


def test_agent_socket_refuses_a_bare_user_id(env):
    c = env["client"]
    lid = c.post(f"/api/tickets/{env['ids']['t1']}/live", json={"kind": "screen"}).json()["live"]["id"]
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect(f"/api/tickets/live/ws/{lid}?token={env['ids']['ram']}") as ws:
            ws.receive_json()


def test_relay_carries_signalling_and_ends_on_leave(env):
    c = env["client"]
    t1 = env["ids"]["t1"]
    ram_id = env["ids"]["ram"]
    lid = c.post(f"/api/tickets/{t1}/live", json={"kind": "screen"}).json()["live"]["id"]

    with pytest.raises(WebSocketDisconnect):                    # not the agent who asked
        with c.websocket_connect(f"/api/tickets/live/ws/{lid}?token={tok(env, 'gita')}") as ws:
            ws.receive_json()

    with c.websocket_connect(f"/api/tickets/live/ws/{lid}?token={tok(env, 'ram')}") as agent:
        hello = agent.receive_json()
        assert hello["type"] == "hello" and hello["role"] == "agent" and hello["ice_servers"]

        token = c.post(f"/api/support/v1/live/{lid}/accept", json={"screen_ok": True},
                       headers=_customer()).json()["pass"]
        status = agent.receive_json()
        assert status["type"] == "status" and status["live"]["status"] == "accepted"

        with pytest.raises(WebSocketDisconnect):                # a wrong pass
            with c.websocket_connect("/api/support/v1/live/ws?pass=nope") as ws:
                ws.receive_json()

        with c.websocket_connect(f"/api/support/v1/live/ws?pass={token}") as customer:
            assert customer.receive_json()["type"] == "hello"
            seen = [agent.receive_json()["type"] for _ in range(2)]   # status (connected) and ready
            assert "ready" in seen
            assert customer.receive_json()["type"] == "ready"
            customer.send_json({"type": "offer", "sdp": "v=0 offer"})
            assert agent.receive_json() == {"type": "offer", "sdp": "v=0 offer"}
            agent.send_json({"type": "answer", "sdp": "v=0 answer"})
            assert customer.receive_json() == {"type": "answer", "sdp": "v=0 answer"}
            agent.send_json({"type": "ice", "candidate": {"candidate": "x"}})
            assert customer.receive_json()["type"] == "ice"
            agent.send_json({"type": "nonsense"})                 # not forwarded
            customer.send_json({"type": "ping"})
            assert customer.receive_json() == {"type": "pong"}
            with env["Session"]() as s:
                assert s.get(SupportLiveSession, lid).status == "connected"
        # the customer left: the agent hears bye, the session has ended
        assert agent.receive_json() == {"type": "bye"}

    with c.websocket_connect(f"/api/support/v1/live/ws?pass={token}") as again:   # pass used up
        with pytest.raises(WebSocketDisconnect):
            again.receive_json()

    with env["Session"]() as s:
        row = s.get(SupportLiveSession, lid)
        assert row.status == "ended" and row.connected_at and row.ended_at
        lines = [m.body for m in s.query(SupportMessage).filter_by(ticket_id=env["ids"]["t1_id"],
                                                                      author_type="system")]
        assert any(l.startswith("Screen shared ") for l in lines)


def test_failed_from_a_peer_is_recorded(env):
    c = env["client"]
    t1 = env["ids"]["t1"]
    lid = c.post(f"/api/tickets/{t1}/live", json={"kind": "talk"}).json()["live"]["id"]
    with c.websocket_connect(f"/api/tickets/live/ws/{lid}?token={tok(env, 'ram')}") as agent:
        agent.receive_json()
        token = c.post(f"/api/support/v1/live/{lid}/accept", json={}, headers=_customer()).json()["pass"]
        agent.receive_json()
        with c.websocket_connect(f"/api/support/v1/live/ws?pass={token}") as customer:
            customer.receive_json()
            customer.receive_json()
            customer.send_json({"type": "failed", "reason": "<b>ICE</b> timed out"})
        msgs = []
        while True:
            m = agent.receive_json()
            msgs.append(m["type"])
            if m["type"] in ("failed", "bye"):
                break
        assert "failed" in msgs
    with env["Session"]() as s:
        row = s.get(SupportLiveSession, lid)
        assert row.status == "failed" and row.reason == "ICE timed out"
