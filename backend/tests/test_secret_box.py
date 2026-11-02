import pytest

from app.services import secret_box


def test_round_trip(secret_key):
    sealed = secret_box.seal("s3cret-value")
    assert sealed != "s3cret-value"
    assert "s3cret" not in sealed
    assert secret_box.open_(sealed) == "s3cret-value"


def test_each_seal_differs(secret_key):
    assert secret_box.seal("same") != secret_box.seal("same")


def test_unicode(secret_key):
    assert secret_box.open_(secret_box.seal("नेपाल ✓")) == "नेपाल ✓"


def test_other_key_opens_to_none(secret_key):
    sealed = secret_box.seal("value", secret_key="another-key")
    assert secret_box.open_(sealed) is None
    assert secret_box.open_(sealed, secret_key="another-key") == "value"


def test_other_label_opens_to_none(secret_key):
    sealed = secret_box.seal("value", label="support-secret")
    assert secret_box.open_(sealed, label="something-else") is None


@pytest.mark.parametrize("bad", [None, "", "not-a-token", "gAAAAA" + "x" * 40, "ü"])
def test_damaged_opens_to_none(secret_key, bad):
    assert secret_box.open_(bad) is None


def test_tampered_opens_to_none(secret_key):
    sealed = secret_box.seal("value")
    flipped = sealed[:-5] + ("A" if sealed[-5] != "A" else "B") + sealed[-4:]
    assert secret_box.open_(flipped) is None


def test_refuses_placeholder_key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "SECRET_KEY", "your-secret-key-change-in-production")
    with pytest.raises(RuntimeError):
        secret_box.seal("value")


def test_refuses_empty_key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "SECRET_KEY", "")
    with pytest.raises(RuntimeError):
        secret_box.seal("value")
