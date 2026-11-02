"""The service API subscription servers use to set client sites up for support."""

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.models.domain_agent import DomainAgent
from app.models.logs import AuditLog
from app.models.organization import Organization
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.routes.support_admin import normalise_domain, service_keys
from app.services.support_identity import sign, verify

SUB_KEY = "sub-key-0123456789abcdefghijkl"
NRP_KEY = "nrp-key-0123456789abcdefghijkl"


@pytest.fixture
def env(fresh_schema, secret_key, monkeypatch):
    from app.config import settings
    from app.database import get_db
    from app.routes import support_admin

    monkeypatch.setattr(settings, "SUPPORT_SERVICE_KEYS", f"subscription:{SUB_KEY}, nrp:{NRP_KEY}, short:abc")
    monkeypatch.setattr(settings, "SUPPORT_PUBLIC_URL", "https://workspace.example.com/")
    Session = sessionmaker(bind=fresh_schema)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(support_admin.router)
    app.dependency_overrides[get_db] = _db
    with Session() as s:
        s.add_all([
            User(username="ram", email="Ram@agents.test", full_name="Ram", role="user", is_active=True),
            User(username="gone", email="gone@agents.test", full_name="Gone", role="user", is_active=False),
        ])
        s.commit()
    return {"client": TestClient(app), "Session": Session}


def setup(env, key=SUB_KEY, **body):
    data = {"domain": "https://Client.SaralOMS.com/administrator", "display_name": "Client Ltd",
            "organization_name": "Client Ltd", "agent_emails": ["ram@agents.test", "nobody@agents.test",
                                                                 "gone@agents.test"]}
    data.update(body)
    return env["client"].post("/api/support/v1/admin/domains", json=data,
                              headers={"X-Support-Service-Key": key} if key else {})


def test_keys_parsed():
    from app.config import settings
    old = settings.SUPPORT_SERVICE_KEYS
    try:
        settings.SUPPORT_SERVICE_KEYS = f"subscription:{SUB_KEY},{NRP_KEY}, bad:short"
        assert service_keys() == [("subscription", SUB_KEY), ("service", NRP_KEY)]
        settings.SUPPORT_SERVICE_KEYS = None
        assert service_keys() == []
    finally:
        settings.SUPPORT_SERVICE_KEYS = old


@pytest.mark.parametrize("raw, host", [
    ("https://Client.SaralOMS.com/administrator?x=1", "client.saraloms.com"),
    ("www.example.com", "example.com"),
    ("oms.localhost.local:8443", "oms.localhost.local:8443"),
    ("not a domain", None), ("", None), ("-bad-.com", None),
])
def test_normalise_domain(raw, host):
    assert normalise_domain(raw) == host


def test_first_setup(env):
    r = setup(env)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["created"] is True and j["domain"] == "client.saraloms.com"
    assert j["server_url"] == "https://workspace.example.com"
    assert j["agents_linked"] == ["ram@agents.test"]
    assert j["agents_not_found"] == ["nobody@agents.test", "gone@agents.test"]
    assert len(j["secret"]) >= 40
    with env["Session"]() as s:
        d = s.query(WidgetDomain).filter_by(domain="client.saraloms.com").one()
        assert (d.support_enabled, d.allow_anonymous, d.chat_enabled, d.is_active) == (1, 0, 1, 1)
        assert d.organization_id and s.get(Organization, d.organization_id).domain_name == "client.saraloms.com"
        assert s.query(DomainAgent).filter_by(widget_domain_id=d.id).count() == 1
        token = sign(j["secret"], {"site": d.widget_key, "uid": "client.saraloms.com:1", "exp": int(time.time()) + 60})
        assert verify(d, token) is not None
        log = s.query(AuditLog).filter_by(action="support.domain_setup").one()
        assert log.user_email == "service:subscription" and j["secret"] not in (log.detail or "")


def test_repeat_changes_nothing_and_gives_no_secret(env):
    first = setup(env).json()
    again = setup(env, key=NRP_KEY).json()
    assert again["created"] is False and "secret" not in again
    assert again["widget_key"] == first["widget_key"]
    with env["Session"]() as s:
        assert s.query(WidgetDomain).count() == 1 and s.query(Organization).count() == 1
        assert s.query(DomainAgent).count() == 1
        assert s.query(AuditLog).filter_by(user_email="service:nrp").count() == 1


def test_rotate(env):
    first = setup(env).json()["secret"]
    second = setup(env, rotate=True).json()["secret"]
    assert second and second != first


def test_existing_domain_turned_on_and_kept(env):
    with env["Session"]() as s:
        s.add(WidgetDomain(domain="client.saraloms.com", widget_key="wk-existing", display_name="Kept",
                           is_active=1, support_enabled=0, allow_anonymous=1,
                           support_categories=["Mine"], webhook_url="https://client.saraloms.com/hook"))
        s.commit()
    j = setup(env, display_name="").json()
    assert j["created"] is False and j["widget_key"] == "wk-existing" and "secret" in j
    with env["Session"]() as s:
        d = s.query(WidgetDomain).filter_by(domain="client.saraloms.com").one()
        assert d.support_enabled == 1 and d.allow_anonymous == 1           # an admin's choice is kept
        assert d.support_categories == ["Mine"] and d.display_name == "Kept"
    setup(env, categories=["Bug", "bug", " How to "], webhook_url="https://client.saraloms.com/support-hook")
    with env["Session"]() as s:
        d = s.query(WidgetDomain).filter_by(domain="client.saraloms.com").one()
        assert d.support_categories == ["Bug", "How to"]
        assert d.webhook_url == "https://client.saraloms.com/support-hook"


@pytest.mark.parametrize("key", [None, "wrong-key-0123456789abcdefghij", "abc"])
def test_wrong_key(env, key):
    assert setup(env, key=key).status_code == 401


def test_wrong_keys_are_limited(env, monkeypatch):
    from app.routes import support_admin
    monkeypatch.setattr(support_admin, "WRONG_KEYS_PER_IP", 3)
    for _ in range(3):
        assert setup(env, key="nope-0123456789abcdefghijklmn").status_code == 401
    assert setup(env).status_code == 429                                   # even the right key, for an hour


@pytest.mark.parametrize("body, words", [
    ({"domain": "not a domain"}, "domain"),
    ({"webhook_url": "http://client.saraloms.com/hook"}, "https"),
])
def test_refusals(env, body, words):
    r = setup(env, **body)
    assert r.status_code == 422 and words in r.json()["detail"]


def test_get_domain(env):
    first = setup(env).json()
    c = env["client"]
    r = c.get("/api/support/v1/admin/domains?domain=client.saraloms.com", headers={"X-Support-Service-Key": SUB_KEY})
    assert r.status_code == 200
    j = r.json()
    assert j["widget_key"] == first["widget_key"] and j["has_identity_secret"] is True and "secret" not in j
    assert j["agents"] == ["Ram@agents.test"]
    assert c.get("/api/support/v1/admin/domains?domain=other.com",
                 headers={"X-Support-Service-Key": SUB_KEY}).status_code == 404
    assert c.get("/api/support/v1/admin/domains?domain=client.saraloms.com").status_code == 401
