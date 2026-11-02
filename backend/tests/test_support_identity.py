import base64
import json
import uuid

import pytest
from sqlalchemy.orm import Session

from app.services import secret_box
from app.services.support_identity import (
    MAX_AHEAD_SECONDS, sign, support_user_for, support_user_for_email, verify, verify_with_secret,
)

SECRET = "test-identity-secret"
KEY = "wk-test-1"
NOW = 1_800_000_000

# A fixed token, so a site written in another language (OMS's PHP) can check it
# makes exactly this. Same vector in OMS: modules/oms_support check.
VECTOR_CLAIMS = {"site": "wk-test-1", "uid": "oms.example.com:42", "name": "Ram Sharma",
                 "email": "ram@example.com", "phone": "9800000000", "exp": 1900000000}
VECTOR_TOKEN = (
    "eyJzaXRlIjoid2stdGVzdC0xIiwidWlkIjoib21zLmV4YW1wbGUuY29tOjQyIiwibmFtZSI6IlJhbSBTaGFybWEi"
    "LCJlbWFpbCI6InJhbUBleGFtcGxlLmNvbSIsInBob25lIjoiOTgwMDAwMDAwMCIsImV4cCI6MTkwMDAwMDAwMH0"
    ".fdce23691e6436cc7f02964d240ac08c9c3ed66041cd442ad94dc21b19c28ba2"
)


def claims(**over):
    c = {"site": KEY, "uid": "site:7", "name": "Sita", "email": "Sita@Example.com",
         "phone": "9811111111", "exp": NOW + 300}
    c.update(over)
    return c


def tok(**over):
    return sign(SECRET, claims(**over))


def check(token, now=NOW, secret=SECRET, key=KEY):
    return verify_with_secret(secret, key, token, now=now)


# --- the format ---------------------------------------------------------------

def test_fixed_vector():
    assert sign(SECRET, VECTOR_CLAIMS) == VECTOR_TOKEN
    assert check(VECTOR_TOKEN, now=1_899_999_700)["uid"] == "oms.example.com:42"


def test_key_order_and_spacing_do_not_matter():
    payload = base64.urlsafe_b64encode(json.dumps(
        {"exp": NOW + 60, "uid": "u", "site": KEY}, indent=2).encode()).rstrip(b"=").decode()
    import hashlib, hmac
    token = payload + "." + hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    assert check(token)["uid"] == "u"


# --- what is accepted ---------------------------------------------------------

def test_good_token_tidied():
    got = check(tok(name="  <b>Sita</b> Rai ", email=" Sita@Example.COM "))
    assert got == {"site": KEY, "uid": "site:7", "name": "Sita Rai",
                   "email": "sita@example.com", "phone": "9811111111", "exp": NOW + 300}


def test_numeric_uid_becomes_text():
    assert check(tok(uid=42))["uid"] == "42"


def test_bad_email_is_dropped_not_refused():
    got = check(tok(email="not an email"))
    assert got is not None and got["email"] is None


def test_optional_fields_may_be_missing():
    got = check(sign(SECRET, {"site": KEY, "uid": "x", "exp": NOW + 60}))
    assert got["name"] is None and got["email"] is None and got["phone"] is None


def test_long_fields_are_cut():
    got = check(tok(name="n" * 500, phone="9" * 50))
    assert len(got["name"]) == 200 and len(got["phone"]) == 30


def test_clock_leeway():
    assert check(tok(exp=NOW - 30)) is not None                      # a minute behind is fine
    assert check(tok(exp=NOW + MAX_AHEAD_SECONDS + 30)) is not None


# --- what is refused ----------------------------------------------------------

@pytest.mark.parametrize("token", [
    None, "", 42, "no-dot", "a.b.c", "." + "0" * 64, "eyJ9.nothex",
    "eyJ9." + "0" * 63, "x" * 5000,
])
def test_malformed(token):
    assert check(token) is None


def test_wrong_secret():
    assert check(tok(), secret="another-secret") is None


def test_no_secret_configured():
    assert check(tok(), secret=None) is None and check(tok(), secret="") is None


def test_tampered_payload():
    token = tok()
    payload, sig = token.split(".")
    body = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    body["uid"] = "site:1"
    forged = base64.urlsafe_b64encode(json.dumps(body).encode()).rstrip(b"=").decode()
    assert check(forged + "." + sig) is None


def test_uppercase_signature_refused():
    payload, sig = tok().split(".")
    assert check(payload + "." + sig.upper()) is None


def test_expired():
    assert check(tok(exp=NOW - 61)) is None


def test_too_far_ahead():
    assert check(tok(exp=NOW + MAX_AHEAD_SECONDS + 61)) is None


@pytest.mark.parametrize("exp", [None, "1800000300", True, [1]])
def test_exp_must_be_a_number(exp):
    assert check(tok(exp=exp)) is None


def test_another_sites_key():
    assert check(tok(site="wk-other")) is None
    assert check(tok(), key="wk-other") is None


@pytest.mark.parametrize("uid", [None, "", "   ", True, ["a"], "u" * 201])
def test_bad_uid(uid):
    assert check(tok(uid=uid)) is None


def test_payload_not_an_object():
    import hashlib, hmac
    payload = base64.urlsafe_b64encode(b"[1,2]").rstrip(b"=").decode()
    token = payload + "." + hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    assert check(token) is None


# --- against a widget domain (database) -----------------------------------------

@pytest.fixture
def db(fresh_schema, secret_key):
    session = Session(bind=fresh_schema)
    yield session
    session.rollback()
    session.close()


def make_domain(db, active=1, secret=SECRET, key=None):
    from app.models.widget_domain import WidgetDomain
    d = WidgetDomain(domain=f"{uuid.uuid4().hex[:8]}.example.com", widget_key=key or uuid.uuid4().hex,
                     display_name="Example", is_active=active, support_enabled=1,
                     identity_secret=secret_box.seal(secret) if secret else None)
    db.add(d)
    db.flush()
    return d


def test_verify_uses_the_domains_sealed_secret(db):
    d = make_domain(db)
    good = sign(SECRET, claims(site=d.widget_key))
    assert verify(d, good, now=NOW)["uid"] == "site:7"
    assert verify(d, sign("wrong", claims(site=d.widget_key)), now=NOW) is None


def test_verify_refuses_inactive_or_secretless_domain(db):
    off = make_domain(db, active=0)
    assert verify(off, sign(SECRET, claims(site=off.widget_key)), now=NOW) is None
    none = make_domain(db, secret=None)
    assert verify(none, sign(SECRET, claims(site=none.widget_key)), now=NOW) is None
    assert verify(None, tok(), now=NOW) is None


def test_support_user_made_once_and_refreshed(db):
    from app.models.support import SupportUser
    d = make_domain(db)
    c = check(sign(SECRET, claims(site=d.widget_key)), key=d.widget_key)
    first = support_user_for(db, d, c)
    again = support_user_for(db, d, dict(c, name="Sita Rai", phone=None))
    assert first.id == again.id
    assert again.name == "Sita Rai" and again.phone == "9811111111"   # None keeps the stored phone
    assert db.query(SupportUser).filter_by(widget_domain_id=d.id).count() == 1


def test_same_uid_on_two_domains_is_two_people(db):
    a, b = make_domain(db), make_domain(db)
    c = {"uid": "site:7", "name": None, "email": None, "phone": None}
    assert support_user_for(db, a, c).id != support_user_for(db, b, c).id


def test_anonymous_by_email(db):
    d = make_domain(db)
    one = support_user_for_email(db, d, " Visitor@Example.com ", "Visitor")
    two = support_user_for_email(db, d, "visitor@example.com")
    assert one.id == two.id and one.uid is None and one.email == "visitor@example.com"
    assert two.name == "Visitor"                                      # no name keeps the stored one
    assert support_user_for_email(db, d, "not-an-email") is None


def test_anonymous_and_signed_with_same_email_are_apart(db):
    d = make_domain(db)
    signed = support_user_for(db, d, {"uid": "site:9", "name": None, "email": "a@example.com", "phone": None})
    anon = support_user_for_email(db, d, "a@example.com")
    assert signed.id != anon.id


def test_database_refuses_a_duplicate_person(db):
    from sqlalchemy.exc import IntegrityError
    from app.models.support import SupportUser
    d = make_domain(db)
    db.add(SupportUser(widget_domain_id=d.id, uid="dup"))
    db.flush()
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(SupportUser(widget_domain_id=d.id, uid="dup"))
            db.flush()
