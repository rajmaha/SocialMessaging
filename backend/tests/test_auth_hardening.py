"""Agent sign-in hardening, beside the signed tokens of test_auth_tokens.py:

- a sign-in code is voided after a few wrong tries, and one address may only
  guess so often across every account;
- GET /auth/user/{id} needs a token and answers only the user (or an admin);
- passwords are bcrypt; an older sha256 hash still works and is replaced at
  the next sign-in;
- a recording plays from `<audio src="...?token=">`, which sends no header.
"""

import hashlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import auth_tokens
from app.models.user import User


@pytest.fixture
def env(fresh_schema, secret_key, monkeypatch):
    import app.dependencies as deps
    from app.database import get_db
    from app.routes import auth, calls

    Session = sessionmaker(bind=fresh_schema)
    monkeypatch.setattr(deps, "SessionLocal", Session)

    sent = []
    monkeypatch.setattr(auth.email_service, "send_otp_email",
                        lambda **kw: sent.append(kw) or True)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    with Session() as s:
        boss = User(username="boss", email="boss@agents.test", full_name="Boss", role="admin", is_active=True,
                    is_verified=True, password_hash=auth.hash_password("boss-pass"))
        ram = User(username="ram", email="ram@agents.test", full_name="Ram", display_name="Ramu", role="user",
                   is_active=True, is_verified=True, password_hash=auth.hash_password("ram-pass"))
        sita = User(username="sita", email="sita@agents.test", full_name="Sita", role="user",
                    is_active=True, is_verified=True, password_hash=auth.hash_password("sita-pass"))
        s.add_all([boss, ram, sita])
        s.commit()
        ids = {"boss": boss.id, "ram": ram.id, "sita": sita.id}

    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(calls.router)
    app.dependency_overrides[get_db] = _db
    return {"client": TestClient(app), "Session": Session, "ids": ids, "sent": sent, "auth": auth}


def _give_code(env, email, code="123456"):
    with env["Session"]() as s:
        u = s.query(User).filter_by(email=email).one()
        u.otp_code, u.otp_context, u.otp_attempts = code, "login", 0
        u.otp_expires = datetime.utcnow() + timedelta(minutes=5)
        s.commit()


def _verify(env, email, code):
    return env["client"].post("/auth/verify-otp", json={"email": email, "otp_code": code, "context": "login"})


def _token(env, name):
    with env["Session"]() as s:
        return auth_tokens.issue_token(s.get(User, env["ids"][name]))


def bearer(t):
    return {"Authorization": f"Bearer {t}"}


# ---- wrong sign-in codes --------------------------------------------------

def test_wrong_codes_count_down_then_void_the_code(env):
    _give_code(env, "ram@agents.test")
    for left in (4, 3, 2, 1):
        r = _verify(env, "ram@agents.test", "000000")
        assert r.status_code == 400
        assert f"{left} tr" in r.json()["detail"]
    r = _verify(env, "ram@agents.test", "000000")
    assert r.status_code == 429
    assert "request a new one" in r.json()["detail"]
    # The right code no longer works: it was voided.
    r = _verify(env, "ram@agents.test", "123456")
    assert r.status_code == 400
    assert "request a new code" in r.json()["detail"]
    with env["Session"]() as s:
        assert s.get(User, env["ids"]["ram"]).otp_code is None


def test_right_code_after_a_wrong_one_signs_in_and_resets_the_count(env):
    _give_code(env, "ram@agents.test")
    assert _verify(env, "ram@agents.test", "999999").status_code == 400
    r = _verify(env, "ram@agents.test", "123456")
    assert r.status_code == 200 and r.json()["token"]
    with env["Session"]() as s:
        assert s.get(User, env["ids"]["ram"]).otp_attempts == 0


def test_a_new_code_starts_the_count_again(env):
    _give_code(env, "ram@agents.test")
    for _ in range(4):
        _verify(env, "ram@agents.test", "000000")
    r = env["client"].post("/auth/resend-otp", json={"email": "ram@agents.test", "context": "login"})
    assert r.status_code == 200
    code = env["sent"][-1]["otp_code"]
    with env["Session"]() as s:
        assert s.get(User, env["ids"]["ram"]).otp_attempts == 0
    assert _verify(env, "ram@agents.test", "000000" if code != "000000" else "111111").status_code == 400
    assert _verify(env, "ram@agents.test", code).status_code == 200


def test_one_address_cannot_keep_guessing_across_accounts(env, monkeypatch):
    monkeypatch.setattr(env["auth"], "OTP_MAX_WRONG_PER_IP", 3)
    _give_code(env, "ram@agents.test")
    _give_code(env, "sita@agents.test")
    assert _verify(env, "ram@agents.test", "000000").status_code == 400
    assert _verify(env, "ram@agents.test", "000000").status_code == 400
    assert _verify(env, "sita@agents.test", "000000").status_code == 400
    # Even the right code is refused from this address for a while.
    r = _verify(env, "sita@agents.test", "123456")
    assert r.status_code == 429
    assert "this address" in r.json()["detail"]


def test_new_codes_are_six_digits(env):
    codes = {env["auth"].generate_otp() for _ in range(50)}
    assert all(len(c) == 6 and c.isdigit() for c in codes)


# ---- GET /auth/user/{id} --------------------------------------------------

def test_user_details_need_a_token(env):
    r = env["client"].get(f"/auth/user/{env['ids']['ram']}")
    assert r.status_code in (401, 403)
    r = env["client"].get(f"/auth/user/{env['ids']['ram']}", headers=bearer(env["ids"]["ram"]))
    assert r.status_code == 401


def test_user_reads_own_details(env):
    r = env["client"].get(f"/auth/user/{env['ids']['ram']}", headers=bearer(_token(env, "ram")))
    assert r.status_code == 200
    assert r.json()["email"] == "ram@agents.test"
    assert r.json()["display_name"] == "Ramu"
    assert "password_hash" not in r.json()


def test_user_cannot_read_someone_else(env):
    r = env["client"].get(f"/auth/user/{env['ids']['sita']}", headers=bearer(_token(env, "ram")))
    assert r.status_code == 403


def test_admin_reads_anyone(env):
    r = env["client"].get(f"/auth/user/{env['ids']['sita']}", headers=bearer(_token(env, "boss")))
    assert r.status_code == 200 and r.json()["email"] == "sita@agents.test"


# ---- password hashes ------------------------------------------------------

def test_new_hashes_are_salted_bcrypt(env):
    auth = env["auth"]
    a, b = auth.hash_password("same"), auth.hash_password("same")
    assert a.startswith("$2b$") and a != b
    assert auth.verify_password("same", a) and not auth.verify_password("other", a)


def test_long_password_is_cut_at_72_bytes_not_refused(env):
    auth = env["auth"]
    long = "x" * 100
    h = auth.hash_password(long)
    assert auth.verify_password(long, h)


def test_old_sha256_hash_still_verifies(env):
    auth = env["auth"]
    old = hashlib.sha256(b"legacy").hexdigest()
    assert auth.verify_password("legacy", old)
    assert not auth.verify_password("wrong", old)
    assert not auth.verify_password("legacy", None)
    assert auth.password_needs_upgrade(old) and not auth.password_needs_upgrade(auth.hash_password("x"))


def _make_legacy(env, name, password):
    with env["Session"]() as s:
        u = s.get(User, env["ids"][name])
        u.password_hash = hashlib.sha256(password.encode()).hexdigest()
        s.commit()


def test_sign_in_upgrades_an_old_hash_and_the_new_token_works(env):
    _make_legacy(env, "ram", "ram-pass")
    old_token = _token(env, "ram")
    r = env["client"].post("/auth/login", json={"email": "ram@agents.test", "password": "ram-pass"})
    assert r.status_code == 200
    with env["Session"]() as s:
        stored = s.get(User, env["ids"]["ram"]).password_hash
    assert stored.startswith("$2b$") and env["auth"].verify_password("ram-pass", stored)

    code = env["sent"][-1]["otp_code"]
    r = _verify(env, "ram@agents.test", code)
    assert r.status_code == 200
    new_token = r.json()["token"]
    me = env["client"].get(f"/auth/user/{env['ids']['ram']}", headers=bearer(new_token))
    assert me.status_code == 200
    # The token from before the upgrade carried the old hash's fingerprint.
    old = env["client"].get(f"/auth/user/{env['ids']['ram']}", headers=bearer(old_token))
    assert old.status_code == 401


def test_wrong_password_leaves_an_old_hash_alone(env):
    _make_legacy(env, "ram", "ram-pass")
    r = env["client"].post("/auth/login", json={"email": "ram@agents.test", "password": "nope"})
    assert r.status_code == 401
    with env["Session"]() as s:
        assert s.get(User, env["ids"]["ram"]).password_hash == hashlib.sha256(b"ram-pass").hexdigest()


def test_unknown_email_is_refused_like_a_wrong_password(env):
    r = env["client"].post("/auth/login", json={"email": "nobody@agents.test", "password": "x"})
    assert r.status_code == 401 and r.json()["detail"] == "Invalid email or password"


def test_bcrypt_user_signs_in(env):
    r = env["client"].post("/auth/login", json={"email": "sita@agents.test", "password": "sita-pass"})
    assert r.status_code == 200
    assert _verify(env, "sita@agents.test", env["sent"][-1]["otp_code"]).status_code == 200


# ---- recording stream with ?token= ----------------------------------------

@pytest.fixture
def recording(env):
    from app.models.call_records import CallRecording
    with env["Session"]() as s:
        rec = CallRecording(agent_id=env["ids"]["ram"], phone_number="9800000000",
                            recording_url="https://recordings.example.test/a.wav")
        s.add(rec)
        s.commit()
        return rec.id


def test_recording_plays_with_a_query_token(env, recording):
    r = env["client"].get(f"/calls/recordings/{recording}/stream?token={_token(env, 'ram')}",
                          follow_redirects=False)
    assert r.status_code in (302, 307)
    assert r.headers["location"] == "https://recordings.example.test/a.wav"


def test_recording_still_plays_with_a_bearer_header(env, recording):
    r = env["client"].get(f"/calls/recordings/{recording}/stream", headers=bearer(_token(env, "ram")),
                          follow_redirects=False)
    assert r.status_code in (302, 307)


def test_recording_refuses_no_token_or_a_bare_id(env, recording):
    assert env["client"].get(f"/calls/recordings/{recording}/stream").status_code == 401
    r = env["client"].get(f"/calls/recordings/{recording}/stream?token={env['ids']['ram']}")
    assert r.status_code == 401


def test_recording_of_another_agent_is_refused(env, recording):
    r = env["client"].get(f"/calls/recordings/{recording}/stream?token={_token(env, 'sita')}")
    assert r.status_code == 403
