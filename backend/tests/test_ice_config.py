"""STUN / TURN list per relay choice, Cloudflare credentials and their cache. No database."""

from types import SimpleNamespace

import pytest

from app.services import ice_config, secret_box, turn_check


def _settings(**kw):
    base = dict(stun_servers=None, turn_server=None, turn_username=None, turn_credential=None,
                turn_provider=None, cloudflare_turn_key_id=None, cloudflare_turn_token=None,
                cloudflare_turn_ttl=None)
    base.update(kw)
    return SimpleNamespace(**base)


CF_ANSWER = {"iceServers": [
    {"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]},
    {"urls": ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp",
              "turns:turn.cloudflare.com:443?transport=tcp"],
     "username": "u1", "credential": "c1"},
]}


@pytest.fixture(autouse=True)
def _fresh_cache():
    ice_config.clear_cache()
    yield
    ice_config.clear_cache()


def _cf(secret_key, **kw):
    token = secret_box.seal("tok", secret_key=secret_key, label=ice_config.TOKEN_LABEL)
    return _settings(turn_provider="cloudflare", cloudflare_turn_key_id="kid", cloudflare_turn_token=token, **kw)


def test_nothing_set_is_google_stun():
    assert ice_config.build_ice_servers(None) == [{"urls": u} for u in ice_config.DEFAULT_STUN]
    assert ice_config.provider_of(_settings()) == "none"


def test_an_older_row_with_a_turn_url_reads_as_coturn():
    s = _settings(turn_server="turn:t.example.com:3478", turn_username="a", turn_credential="b")
    assert ice_config.provider_of(s) == "coturn"
    out = ice_config.build_ice_servers(s)
    assert {"urls": "turn:t.example.com:3478", "username": "a", "credential": "b"} in out
    assert {"urls": "turn:t.example.com:3478?transport=tcp", "username": "a", "credential": "b"} in out
    assert {"urls": "turns:t.example.com:5349?transport=tcp", "username": "a", "credential": "b"} in out


def test_none_ignores_a_saved_turn_url():
    s = _settings(turn_provider="none", turn_server="turn:t.example.com:3478", stun_servers="stun:s.example.com:3478")
    assert ice_config.build_ice_servers(s) == [{"urls": "stun:s.example.com:3478"}]


def test_cloudflare_credentials_without_port_53_and_cached(secret_key):
    calls = []

    def post(url, headers, body, timeout):
        calls.append((url, headers["Authorization"], body))
        return 201, CF_ANSWER

    s = _cf(secret_key, cloudflare_turn_ttl=7200)
    out = ice_config.build_ice_servers(s, post=post, now=1000)
    turn = [e for e in out if e.get("username")][0]
    assert turn["urls"] == ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"]
    assert turn["credential"] == "c1"
    assert calls == [("https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers",
                      "Bearer tok", {"ttl": 7200})]
    ice_config.build_ice_servers(s, post=post, now=1000 + 3500)          # inside half the ttl: cached
    assert len(calls) == 1
    ice_config.build_ice_servers(s, post=post, now=1000 + 3700)          # past it: asked again
    assert len(calls) == 2


def test_cloudflare_down_uses_a_cached_set_then_stun(secret_key):
    s = _cf(secret_key, cloudflare_turn_ttl=7200)
    ice_config.build_ice_servers(s, post=lambda *a: (201, CF_ANSWER), now=0)

    def down(*a):
        raise OSError("no route")

    out = ice_config.build_ice_servers(s, post=down, now=4000)           # stale but not expired
    assert any(e.get("username") == "u1" for e in out)
    out = ice_config.build_ice_servers(s, post=down, now=7200)           # expired: STUN only
    assert not any(e.get("username") for e in out)
    assert {"urls": ice_config.CLOUDFLARE_STUN} in out


def test_cloudflare_refusals_read_as_sentences():
    with pytest.raises(ice_config.TurnConfigError, match="refused the API token"):
        ice_config.fetch_cloudflare("kid", "bad", 3600, post=lambda *a: (401, {"errors": []}))
    with pytest.raises(ice_config.TurnConfigError, match="does not know"):
        ice_config.fetch_cloudflare("kid", "t", 3600, post=lambda *a: (404, None))
    with pytest.raises(ice_config.TurnConfigError, match="needs the TURN key id"):
        ice_config.fetch_cloudflare("", "t", 3600)


def test_a_token_sealed_under_another_key_is_stun_only(secret_key):
    token = secret_box.seal("tok", secret_key="another-key-entirely", label=ice_config.TOKEN_LABEL)
    s = _settings(turn_provider="cloudflare", cloudflare_turn_key_id="kid", cloudflare_turn_token=token)
    out = ice_config.build_ice_servers(s, post=lambda *a: pytest.fail("must not call Cloudflare"))
    assert not any(e.get("username") for e in out)


def test_ttl_is_held_between_an_hour_and_two_days():
    assert ice_config.clamp_ttl(None) == 86400
    assert ice_config.clamp_ttl(60) == 3600
    assert ice_config.clamp_ttl(10 ** 9) == 172800
    assert ice_config.clamp_ttl("x") == 86400


def test_turn_urls_parse():
    p = turn_check.parse_turn_url
    assert p("turn:freepbx.podamibe.net:3478") == ("turn", "freepbx.podamibe.net", 3478, "udp")
    assert p("turn:turn.cloudflare.com:80?transport=tcp") == ("turn", "turn.cloudflare.com", 80, "tcp")
    assert p("turns:turn.cloudflare.com:443?transport=tcp") == ("turns", "turn.cloudflare.com", 443, "tcp")
    assert p("turn:[2001:db8::1]:3478") == ("turn", "2001:db8::1", 3478, "udp")
    assert p("turn:host") == ("turn", "host", 3478, "udp")
    assert p("stun:x:3478") is None


def test_check_picks_udp_before_tcp(monkeypatch):
    seen = []
    monkeypatch.setattr(turn_check, "check", lambda url, u, c, timeout=5.0: seen.append(url) or {"ok": True, "message": "ok"})
    turn_check.check_servers([{"urls": ["turns:a:443?transport=tcp", "turn:a:80?transport=tcp",
                                        "turn:a:3478?transport=udp"], "username": "u", "credential": "c"}])
    assert seen == ["turn:a:3478?transport=udp"]
    assert turn_check.check_servers([{"urls": "stun:a:3478"}])["ok"] is False
