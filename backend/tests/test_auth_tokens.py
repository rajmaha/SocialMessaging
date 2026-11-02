"""Agent and admin sign-in tokens: only a signed token issued at sign-in is accepted.

Before this, every agent/admin check took the bearer value as a user id (or JSON
the browser wrote), so `Authorization: Bearer 1` acted as user 1.
"""

import json
from datetime import datetime, timedelta

import jwt
import pytest
from fastapi import Depends, FastAPI, WebSocket
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app import auth_tokens
from app.models.user import User


@pytest.fixture
def env(fresh_schema, secret_key, monkeypatch):
    import app.dependencies as deps
    from app.database import get_db
    from app.routes import admin, auth

    Session = sessionmaker(bind=fresh_schema)
    monkeypatch.setattr(deps, "SessionLocal", Session)        # verify_token / get_current_user

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    with Session() as s:
        boss = User(username="boss", email="boss@agents.test", full_name="Boss", role="admin", is_active=True,
                    password_hash=auth.hash_password("first-pass"))
        ram = User(username="ram", email="ram@agents.test", full_name="Ram", role="user", is_active=True,
                   password_hash=auth.hash_password("ram-pass"))
        s.add_all([boss, ram])
        s.commit()
        ids = {"boss": boss.id, "ram": ram.id}

    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(admin.router)

    @app.get("/whoami")
    def whoami(user=Depends(deps.get_current_user)):
        return {"id": user.id}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket, token: str = ""):
        await websocket.accept()
        user = await deps.verify_token(token)
        await websocket.send_json({"id": user.id if user else None})
        await websocket.close()

    app.dependency_overrides[get_db] = _db
    return {"client": TestClient(app), "Session": Session, "ids": ids}


def _sign_in(env, email):
    """The real path: verify-otp hands back the token."""
    with env["Session"]() as s:
        u = s.query(User).filter_by(email=email).one()
        u.otp_code, u.otp_context = "123456", "login"
        u.otp_expires = datetime.utcnow() + timedelta(minutes=5)
        s.commit()
    r = env["client"].post("/auth/verify-otp", json={"email": email, "otp_code": "123456", "context": "login"})
    assert r.status_code == 200
    return r.json()["token"]


def bearer(t):
    return {"Authorization": f"Bearer {t}"}


def test_verify_otp_issues_a_token_that_is_accepted(env):
    token = _sign_in(env, "boss@agents.test")
    c = env["client"]
    assert c.get("/whoami", headers=bearer(token)).json() == {"id": env["ids"]["boss"]}
    assert c.get("/admin/users", headers=bearer(token)).status_code == 200       # admin router's own check
    r = c.put("/auth/profile", json={"phone": "9800000000"}, headers=bearer(token))
    assert r.status_code == 200


@pytest.mark.parametrize("forged", [
    "1",
    "2",
    json.dumps({"user_id": 1, "role": "admin"}),
    "not-a-token",
    "a.b.c",
])
def test_forged_bearer_values_are_refused(env, forged):
    c = env["client"]
    assert c.get("/whoami", headers=bearer(forged)).status_code == 401
    assert c.get("/admin/users", headers=bearer(forged)).status_code == 401
    assert c.put("/auth/profile", json={"phone": "1"}, headers=bearer(forged)).status_code == 401


def test_missing_header_is_refused(env):
    c = env["client"]
    assert c.get("/whoami").status_code in (401, 403)
    assert c.get("/admin/users").status_code == 401


def test_token_signed_with_another_key_is_refused(env):
    payload = {"sub": str(env["ids"]["boss"]), "aud": "sm-agent", "exp": 4102444800, "pwd": "x"}
    forged = jwt.encode(payload, "some-other-key", algorithm="HS256")
    assert env["client"].get("/whoami", headers=bearer(forged)).status_code == 401
    unsigned = jwt.encode(payload, None, algorithm="none")
    assert env["client"].get("/whoami", headers=bearer(unsigned)).status_code == 401


def test_expired_token_is_refused(env):
    with env["Session"]() as s:
        boss = s.get(User, env["ids"]["boss"])
        old = auth_tokens.issue_token(boss, ttl=timedelta(seconds=-120))
    assert env["client"].get("/whoami", headers=bearer(old)).status_code == 401


def test_deactivated_user_is_refused(env):
    token = _sign_in(env, "ram@agents.test")
    with env["Session"]() as s:
        s.get(User, env["ids"]["ram"]).is_active = False
        s.commit()
    assert env["client"].get("/whoami", headers=bearer(token)).status_code == 401


def test_changing_the_password_ends_old_tokens_and_hands_back_a_new_one(env):
    c = env["client"]
    token = _sign_in(env, "ram@agents.test")
    r = c.post("/auth/change-password", headers=bearer(token),
               json={"old_password": "ram-pass", "new_password": "newer-pass", "confirm_password": "newer-pass"})
    assert r.status_code == 200
    fresh = r.json()["token"]
    assert c.get("/whoami", headers=bearer(token)).status_code == 401
    assert c.get("/whoami", headers=bearer(fresh)).json() == {"id": env["ids"]["ram"]}


def test_change_password_refuses_a_bare_id(env):
    r = env["client"].post("/auth/change-password", headers=bearer(str(env["ids"]["ram"])),
                           json={"old_password": "ram-pass", "new_password": "x" * 8, "confirm_password": "x" * 8})
    assert r.status_code == 401


def test_websocket_token_check(env):
    c = env["client"]
    with c.websocket_connect("/ws?token=1") as ws:
        assert ws.receive_json() == {"id": None}
    token = _sign_in(env, "boss@agents.test")
    with c.websocket_connect(f"/ws?token={token}") as ws:
        assert ws.receive_json() == {"id": env["ids"]["boss"]}


def test_events_socket_refuses_a_bare_id(env):
    from app.routes import events
    app = FastAPI()
    app.include_router(events.router)
    from app.database import get_db
    app.dependency_overrides[get_db] = env["client"].app.dependency_overrides[get_db]
    with TestClient(app).websocket_connect("/events/ws/connect?token=1") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1008


def test_placeholder_secret_never_signs(monkeypatch, env):
    from app.config import settings
    monkeypatch.setattr(settings, "SECRET_KEY", "your-secret-key-change-in-production")
    with env["Session"]() as s:
        with pytest.raises(RuntimeError):
            auth_tokens.issue_token(s.get(User, env["ids"]["boss"]))


@pytest.mark.parametrize("placeholder", ["your-secret-key-change-in-production", "your_secret_key_here"])
def test_sign_in_says_so_when_secret_key_is_a_placeholder(monkeypatch, env, placeholder):
    from app.config import settings
    good = _sign_in(env, "boss@agents.test")
    monkeypatch.setattr(settings, "SECRET_KEY", placeholder)
    with env["Session"]() as s:
        u = s.query(User).filter_by(email="ram@agents.test").one()
        u.otp_code, u.otp_context = "654321", "login"
        u.otp_expires = datetime.utcnow() + timedelta(minutes=5)
        s.commit()
    r = env["client"].post("/auth/verify-otp", json={"email": "ram@agents.test", "otp_code": "654321", "context": "login"})
    assert r.status_code == 503 and "SECRET_KEY" in r.json()["detail"]
    assert env["client"].get("/whoami", headers=bearer(good)).status_code == 401
