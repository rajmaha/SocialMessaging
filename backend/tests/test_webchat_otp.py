"""The webchat email code: the token must not give the code away, and guessing is limited."""

import base64
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def client(fresh_schema, secret_key, monkeypatch):
    from app.database import get_db
    from app.routes import webchat
    from app.services.email_service import email_service

    sent = []
    monkeypatch.setattr(email_service, "send_otp_email",
                        lambda **kw: sent.append(kw) or True)
    Session = sessionmaker(bind=fresh_schema)
    # webchat files a new visitor's conversation under the first admin, as on a real install
    from app.models.user import User
    with Session() as s:
        s.add(User(username="admin", email="admin@agents.test", full_name="Admin", role="admin", is_active=True))
        s.commit()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(webchat.router)
    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    c.sent = sent
    return c


def ask(client, email="visitor@example.com"):
    r = client.post("/webchat/request-otp", json={"email": email, "name": "Visitor"})
    return r


def test_token_does_not_contain_the_code(client):
    r = ask(client)
    assert r.status_code == 200
    token = r.json()["token"]
    code = client.sent[-1]["otp_code"]
    payload = json.loads(base64.urlsafe_b64decode(token.rsplit(".", 1)[0]))
    assert code not in json.dumps(payload) and "o" not in payload


def test_right_code_with_token_signs_in_once(client):
    token = ask(client).json()["token"]
    code = client.sent[-1]["otp_code"]
    r = client.post("/webchat/verify-otp", json={"email": "visitor@example.com", "otp": code, "token": token})
    assert r.status_code == 200 and r.json()["session_id"]
    # the database copy of the code is used up too
    r = client.post("/webchat/verify-otp", json={"email": "visitor@example.com", "otp": code})
    assert r.status_code == 400


def test_right_code_without_token(client):
    ask(client)
    code = client.sent[-1]["otp_code"]
    r = client.post("/webchat/verify-otp", json={"email": "visitor@example.com", "otp": code})
    assert r.status_code == 200


def test_wrong_code_with_a_genuine_token_is_refused(client):
    token = ask(client).json()["token"]
    code = client.sent[-1]["otp_code"]
    wrong = "000000" if code != "000000" else "111111"
    r = client.post("/webchat/verify-otp", json={"email": "visitor@example.com", "otp": wrong, "token": token})
    assert r.status_code == 400


def test_old_style_token_carrying_the_code_no_longer_works(client):
    """A forged token in the old format (code readable inside) must not sign anybody in."""
    import hashlib, hmac, time
    from app.config import settings
    payload = json.dumps({"e": "victim@example.com", "o": "123456", "n": "x", "x": time.time() + 600},
                         separators=(",", ":"))
    b64 = base64.urlsafe_b64encode(payload.encode()).decode()
    sig = hmac.new(settings.SECRET_KEY.encode(), b64.encode(), hashlib.sha256).hexdigest()
    r = client.post("/webchat/verify-otp", json={"email": "victim@example.com", "otp": "123456",
                                                  "token": f"{b64}.{sig}"})
    assert r.status_code == 400


def test_five_wrong_codes_stop_guessing(client):
    ask(client)
    code = client.sent[-1]["otp_code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert client.post("/webchat/verify-otp", json={"email": "visitor@example.com", "otp": wrong}).status_code == 400
    r = client.post("/webchat/verify-otp", json={"email": "visitor@example.com", "otp": code})
    assert r.status_code == 429


def test_asking_for_codes_is_limited(client):
    for _ in range(5):
        assert ask(client, "many@example.com").status_code == 200
    assert ask(client, "many@example.com").status_code == 429
    assert ask(client, "other@example.com").status_code == 200


def test_code_is_six_digits(client):
    for _ in range(3):
        ask(client, f"d{_}@example.com")
        code = client.sent[-1]["otp_code"]
        assert len(code) == 6 and code.isdigit()
