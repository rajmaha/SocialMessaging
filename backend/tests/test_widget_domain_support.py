"""Widget Domains admin: the Support settings and the identity secret."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.models.organization import Organization
from app.models.support import SupportUser
from app.models.widget_domain import WidgetDomain
from app.services import secret_box
from app.services import support_service as svc
from app.services.support_identity import sign, verify


@pytest.fixture
def env(fresh_schema, secret_key, monkeypatch):
    from app.database import get_db
    from app.routes import admin, widget_domains

    monkeypatch.setattr(svc, "run_later", lambda job: None)
    Session = sessionmaker(bind=fresh_schema)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(widget_domains.router)
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[admin.get_current_user] = lambda: {"role": "admin", "user_id": 1}
    with Session() as s:
        d = WidgetDomain(domain="oms.example.com", widget_key="wk-1", display_name="Example", is_active=1)
        org = Organization(organization_name="Example Ltd")
        s.add_all([d, org])
        s.commit()
        ids = {"domain": d.id, "org": org.id}
    return {"client": TestClient(app), "Session": Session, "ids": ids}


def settings(**over):
    body = {"support_enabled": True, "chat_enabled": True, "allow_anonymous": True,
            "support_categories": ["Bug", "How to"], "webhook_url": "https://oms.example.com/support-hook",
            "organization_id": None}
    body.update(over)
    return body


def test_list_shows_support_without_the_secret(env):
    c, d = env["client"], env["ids"]["domain"]
    c.post(f"/admin/widget-domains/{d}/support-secret")
    row = c.get("/admin/widget-domains/").json()[0]
    assert row["support_enabled"] is False and row["chat_enabled"] is True
    assert row["has_identity_secret"] is True and "identity_secret" not in row


def test_save_settings(env):
    c, d = env["client"], env["ids"]["domain"]
    r = c.put(f"/admin/widget-domains/{d}/support",
              json=settings(support_categories=[" Bug ", "bug", "", "How to"], organization_id=env["ids"]["org"]))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["support_enabled"] is True and j["support_categories"] == ["Bug", "How to"]
    assert j["organization_id"] == env["ids"]["org"]
    r = c.put(f"/admin/widget-domains/{d}/support", json=settings(support_enabled=False, webhook_url=""))
    assert r.json()["webhook_url"] is None and r.json()["support_enabled"] is False


@pytest.mark.parametrize("over, words", [
    ({"webhook_url": "http://oms.example.com/hook"}, "https"),
    ({"webhook_url": "https://192.168.1.5/hook"}, "private"),
    ({"organization_id": 999}, "organization"),
    ({"support_categories": ["x" * 61]}, "60"),
    ({"support_categories": [f"c{i}" for i in range(21)]}, "20"),
])
def test_refusals(env, over, words):
    r = env["client"].put(f"/admin/widget-domains/{env['ids']['domain']}/support", json=settings(**over))
    assert r.status_code == 422 and words in r.json()["detail"]


def test_signed_only_needs_a_secret_first(env):
    c, d = env["client"], env["ids"]["domain"]
    r = c.put(f"/admin/widget-domains/{d}/support", json=settings(allow_anonymous=False))
    assert r.status_code == 422 and "secret" in r.json()["detail"]
    c.post(f"/admin/widget-domains/{d}/support-secret")
    assert c.put(f"/admin/widget-domains/{d}/support", json=settings(allow_anonymous=False)).status_code == 200


def test_secret_shown_once_and_works(env):
    c, d = env["client"], env["ids"]["domain"]
    first = c.post(f"/admin/widget-domains/{d}/support-secret").json()["secret"]
    assert len(first) >= 40
    with env["Session"]() as s:
        dom = s.get(WidgetDomain, d)
        assert first not in (dom.identity_secret or "")          # stored sealed
        assert secret_box.open_(dom.identity_secret) == first
        import time
        token = sign(first, {"site": "wk-1", "uid": "u1", "exp": int(time.time()) + 60})
        assert verify(dom, token) is not None
    second = c.post(f"/admin/widget-domains/{d}/support-secret").json()["secret"]
    assert second != first
    with env["Session"]() as s:
        dom = s.get(WidgetDomain, d)
        assert verify(dom, token) is None                         # the old secret stopped working


def test_delete_refused_while_it_has_support_requests(env):
    c, d = env["client"], env["ids"]["domain"]
    c.put(f"/admin/widget-domains/{d}/support", json=settings())
    with env["Session"]() as s:
        dom = s.get(WidgetDomain, d)
        p = SupportUser(widget_domain_id=d, uid="u1", name="Sita")
        s.add(p)
        s.commit()
        svc.create_request(s, dom, p, {"subject": "Blank sheet", "body": "help", "category": "Bug"})
    r = c.delete(f"/admin/widget-domains/{d}")
    assert r.status_code == 409 and "Disable it" in r.json()["detail"]
