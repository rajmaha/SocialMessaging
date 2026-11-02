"""The public support API, through FastAPI, against the test database."""

import time
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.models.conversation import Conversation
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.services import secret_box
from app.services import support_service as svc
from app.services.support_identity import sign

SECRET = "site-identity-secret"


@pytest.fixture
def env(fresh_schema, secret_key, monkeypatch, tmp_path):
    from app.database import get_db
    from app.routes import support_public

    monkeypatch.setattr(svc, "run_later", lambda job: job())
    monkeypatch.setattr(svc, "mailer", lambda *a: True)
    monkeypatch.setattr(svc, "_broadcast", lambda ids, event: None)
    monkeypatch.setattr(svc, "STORAGE_ROOT", str(tmp_path / "support"))

    Session = sessionmaker(bind=fresh_schema)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(support_public.router)
    app.dependency_overrides[get_db] = _db

    with Session() as s:
        admin = User(username="admin", email="admin@agents.test", full_name="Admin", role="admin", is_active=True)
        s.add(admin)
        s.flush()
        main = WidgetDomain(domain="oms.example.com", widget_key="wk-main", display_name="Example OMS",
                            is_active=1, support_enabled=1, allow_anonymous=1,
                            support_categories=["Bug", "How to"], identity_secret=secret_box.seal(SECRET))
        other = WidgetDomain(domain="other.example.com", widget_key="wk-other", display_name="Other",
                             is_active=1, support_enabled=1, allow_anonymous=0, identity_secret=secret_box.seal(SECRET))
        off = WidgetDomain(domain="off.example.com", widget_key="wk-off", display_name="Off",
                           is_active=1, support_enabled=0)
        s.add_all([main, other, off])
        s.add(Conversation(user_id=admin.id, conversation_id="sess-anon-1", platform="webchat",
                           contact_name="Visitor", contact_id="visitor@example.com"))
        s.commit()
    return {"client": TestClient(app), "Session": Session}


def headers(uid="oms.example.com:42", key="wk-main", secret=SECRET, **claims):
    c = {"site": key, "uid": uid, "name": "Ram Sharma", "email": "ram@example.com",
         "phone": "9800000000", "exp": int(time.time()) + 300}
    c.update(claims)
    return {"X-Support-Key": key, "Authorization": "Support " + sign(secret, c)}


def raise_one(client, h=None, files=None, **fields):
    data = {"subject": "Salary sheet is blank", "body": "Nothing prints.", "category": "Bug",
            "priority": "high", "screen": "Payroll -> Salary sheet", "url": "https://oms.example.com/payroll"}
    data.update(fields)
    return client.post("/api/support/v1/requests", headers=h or headers(), data=data, files=files)


# --- the site and the person ---------------------------------------------------------

def test_config(env):
    r = env["client"].get("/api/support/v1/config", headers={"X-Support-Key": "wk-main"})
    assert r.status_code == 200
    j = r.json()
    assert j["name"] == "Example OMS" and j["categories"] == ["Bug", "How to"]
    assert j["allow_anonymous"] is True and "pdf" in j["file_types"]


@pytest.mark.parametrize("key, code", [(None, 401), ("nope", 401), ("wk-off", 403)])
def test_bad_or_disabled_site(env, key, code):
    h = {"X-Support-Key": key} if key else {}
    assert env["client"].get("/api/support/v1/config", headers=h).status_code == code


def test_me_signed(env):
    r = env["client"].get("/api/support/v1/me", headers=headers())
    assert r.status_code == 200 and r.json() == {"name": "Ram Sharma", "email": "ram@example.com",
                                                 "phone": "9800000000", "signed": True}


def test_me_anonymous(env):
    r = env["client"].get("/api/support/v1/me", headers={"X-Support-Key": "wk-main",
                                                          "X-Webchat-Session": "sess-anon-1"})
    assert r.status_code == 200 and r.json()["email"] == "visitor@example.com" and r.json()["signed"] is False


def test_anonymous_refused_where_not_allowed(env):
    r = env["client"].get("/api/support/v1/me", headers={"X-Support-Key": "wk-other",
                                                          "X-Webchat-Session": "sess-anon-1"})
    assert r.status_code == 401


@pytest.mark.parametrize("h", [
    {"X-Support-Key": "wk-main"},                                              # nobody
    {"X-Support-Key": "wk-main", "X-Webchat-Session": "no-such-session"},
    "expired", "wrong-secret", "other-site",
])
def test_who_is_refused(env, h):
    if h == "expired":
        h = headers(exp=int(time.time()) - 120)
    elif h == "wrong-secret":
        h = headers(secret="guess")
    elif h == "other-site":
        h = headers(key="wk-main", site="wk-other")
    assert env["client"].get("/api/support/v1/me", headers=h).status_code == 401


# --- requests --------------------------------------------------------------------------

def test_raise_and_read_back(env):
    c = env["client"]
    r = raise_one(c, files=[("files", ("shot.png", b"\x89PNG....", "image/png"))])
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["status"] == "waiting" and view["subject"] == "Salary sheet is blank"
    att = view["messages"][0]["attachments"][0]
    assert att["name"] == "shot.png" and att["url"].startswith("/api/support/v1/files/")
    no = view["ticket_no"]

    listed = c.get("/api/support/v1/requests", headers=headers()).json()
    assert [i["ticket_no"] for i in listed["items"]] == [no]
    assert c.get(f"/api/support/v1/requests/{no}", headers=headers()).json()["ticket_no"] == no

    got = c.get(att["url"])                                 # the signed link needs no headers
    assert got.status_code == 200 and got.content == b"\x89PNG...."
    assert "attachment" in got.headers["content-disposition"]
    assert got.headers["content-security-policy"] == "sandbox"


def test_someone_elses_request_is_not_found(env):
    c = env["client"]
    no = raise_one(c).json()["ticket_no"]
    assert c.get(f"/api/support/v1/requests/{no}", headers=headers(uid="oms.example.com:99")).status_code == 404
    assert c.get(f"/api/support/v1/requests/{no}", headers=headers(key="wk-other")).status_code == 404
    anon = {"X-Support-Key": "wk-main", "X-Webchat-Session": "sess-anon-1"}
    assert c.get(f"/api/support/v1/requests/{no}", headers=anon).status_code == 404
    assert c.post(f"/api/support/v1/requests/{no}/messages", headers=anon, data={"body": "hi"}).status_code == 404


def test_file_links_checked(env):
    c = env["client"]
    view = raise_one(c, files=[("files", ("a.pdf", b"%PDF-1.4", "application/pdf"))]).json()
    url = view["messages"][0]["attachments"][0]["url"]
    mid = view["messages"][0]["id"]
    assert c.get(url.replace("sig=", "sig=0")).status_code == 403
    exp = int(time.time()) - 10
    from app.routes.support_public import _file_sig
    assert c.get(f"/api/support/v1/files/{mid}/0?exp={exp}&sig={_file_sig(mid, 0, exp)}").status_code == 403
    assert c.get(f"/api/support/v1/files/{mid}/0", headers=headers()).status_code == 200
    assert c.get(f"/api/support/v1/files/{mid}/0", headers=headers(uid="x:1")).status_code == 404
    assert c.get(f"/api/support/v1/files/{mid}/5", headers=headers()).status_code == 404
    assert c.get(f"/api/support/v1/files/{mid}/0").status_code == 401


def test_refusals_are_sentences(env):
    c = env["client"]
    r = raise_one(c, subject="Hi")
    assert r.status_code == 422 and "subject" in r.json()["detail"]
    r = raise_one(c, category="Other")
    assert r.status_code == 422
    r = raise_one(c, files=[("files", ("x.exe", b"MZ", "application/octet-stream"))])
    assert r.status_code == 422 and "x.exe" in r.json()["detail"]
    r = raise_one(c, files=[("files", ("big.pdf", b"x" * (svc.MAX_FILE_BYTES + 1), "application/pdf"))])
    assert r.status_code == 422 and "10 MB" in r.json()["detail"]


def test_double_press(env):
    c = env["client"]
    rid = uuid.uuid4().hex
    a = raise_one(c, request_id=rid).json()["ticket_no"]
    b = raise_one(c, request_id=rid).json()["ticket_no"]
    assert a == b
    assert c.get("/api/support/v1/requests", headers=headers()).json()["total"] == 1


def test_reply_and_changes(env):
    c = env["client"]
    no = raise_one(c).json()["ticket_no"]
    first = c.get(f"/api/support/v1/requests/{no}", headers=headers()).json()["messages"][0]["id"]
    r = c.post(f"/api/support/v1/requests/{no}/messages", headers=headers(), data={"body": "Any news?"})
    assert r.status_code == 200 and r.json()["messages"][-1]["body"] == "Any news?"
    ch = c.get(f"/api/support/v1/requests/{no}/changes?after={first}", headers=headers()).json()
    assert [m["body"] for m in ch["messages"]] == ["Any news?"] and ch["status"] == "waiting"
    assert c.post(f"/api/support/v1/requests/{no}/messages", headers=headers(), data={"body": " "}).status_code == 422


def test_agent_reply_shows_up(env):
    c = env["client"]
    no = raise_one(c).json()["ticket_no"]
    with env["Session"]() as s:
        from app.models.ticket import Ticket
        t = s.query(Ticket).filter_by(ticket_number=no).one()
        agent = s.query(User).filter_by(username="admin").one()
        svc.reply(s, t, "Fixed now.", agent=agent)
    view = c.get(f"/api/support/v1/requests/{no}", headers=headers()).json()
    assert view["status"] == "replied" and view["messages"][-1]["author_name"] == "Admin (Support)"


def test_anonymous_raises_a_request(env):
    anon = {"X-Support-Key": "wk-main", "X-Webchat-Session": "sess-anon-1"}
    r = raise_one(env["client"], h=anon)
    assert r.status_code == 200
    assert env["client"].get("/api/support/v1/requests", headers=anon).json()["total"] == 1


def test_requests_are_limited(env, monkeypatch):
    from app.routes import support_public
    monkeypatch.setattr(support_public, "REQUESTS_PER_PERSON", 2)
    c = env["client"]
    assert raise_one(c).status_code == 200
    assert raise_one(c).status_code == 200
    r = raise_one(c)
    assert r.status_code == 429
    assert raise_one(c, h=headers(uid="oms.example.com:43")).status_code == 200
