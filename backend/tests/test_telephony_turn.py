"""Saving the TURN relay choice on the Telephony settings route (needs TEST_DATABASE_URL)."""

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

from app.models.telephony import TelephonySettings
from app.routes import telephony as route
from app.schemas.telephony import TelephonySettingsResponse, TelephonySettingsUpdate
from app.services import ice_config, secret_box


@pytest.fixture
def db(fresh_schema, secret_key):
    from app.support_schema import apply_support_schema
    assert apply_support_schema(fresh_schema) == []
    s = sessionmaker(bind=fresh_schema)()
    ice_config.clear_cache()
    yield s
    s.close()


def _save(db, **kw):
    return route.update_telephony_settings(TelephonySettingsUpdate(**kw), db=db, current_user=None)


def test_cloudflare_token_is_sealed_write_only_and_kept_when_blank(db):
    row = _save(db, turn_provider="cloudflare", cloudflare_turn_key_id=" kid ", cloudflare_turn_token="tok", cloudflare_turn_ttl=60)
    assert row.cloudflare_turn_key_id == "kid" and row.cloudflare_turn_ttl == ice_config.CLOUDFLARE_TTL_MIN
    assert row.cloudflare_turn_token != "tok"
    assert secret_box.open_(row.cloudflare_turn_token, label=ice_config.TOKEN_LABEL) == "tok"
    out = TelephonySettingsResponse.model_validate(row).model_dump()
    assert out["cloudflare_turn_token_set"] is True and "cloudflare_turn_token" not in out
    row = _save(db, turn_provider="cloudflare", cloudflare_turn_token="")       # blank keeps it
    assert secret_box.open_(row.cloudflare_turn_token, label=ice_config.TOKEN_LABEL) == "tok"


def test_switching_keeps_both_relays_settings(db):
    _save(db, turn_provider="coturn", turn_server="turn:t.example.com:3478", turn_username="a", turn_credential="b")
    _save(db, turn_provider="cloudflare", cloudflare_turn_key_id="kid", cloudflare_turn_token="tok")
    row = _save(db, turn_provider="coturn")
    assert row.turn_server == "turn:t.example.com:3478" and row.cloudflare_turn_key_id == "kid"
    assert ice_config.provider_of(row) == "coturn"
    row = _save(db, turn_provider="none")
    assert ice_config.build_ice_servers(row) == [{"urls": u} for u in ice_config.DEFAULT_STUN]


def test_a_choice_that_cannot_work_is_refused_and_saves_nothing(db):
    with pytest.raises(HTTPException) as e:
        _save(db, turn_provider="cloudflare", cloudflare_turn_key_id="kid", host="pbx.example.com")
    assert e.value.status_code == 422 and "API token" in e.value.detail
    row = db.query(TelephonySettings).first()
    assert row is None or (row.host or "") != "pbx.example.com"
    with pytest.raises(HTTPException) as e:
        _save(db, turn_provider="coturn", turn_server="freepbx.example.com:3478")
    assert "turn:" in e.value.detail
    with pytest.raises(HTTPException):
        _save(db, turn_provider="twilio")


def test_test_turn_with_none_says_stun_only(db):
    _save(db, turn_provider="none")
    r = route.test_turn_relay(db=db, current_user=None)
    assert r["status"] == "error" and "STUN only" in r["message"]
