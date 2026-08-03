"""Signzy DigiLocker API path selection (v1 vs v2)."""

from services.digilocker import (
    _create_url_endpoint,
    _details_url_endpoint,
    _digilocker_uses_v2,
    _eaadhaar_url_endpoint,
)


def test_production_defaults_to_digilocker_v2(monkeypatch):
    monkeypatch.delenv("SIGNZY_DIGILOCKER_API_VERSION", raising=False)
    monkeypatch.setenv("SIGNZY_ENV", "production")
    assert _digilocker_uses_v2() is True
    assert _create_url_endpoint() == "https://api.signzy.app/api/v3/digilocker-v2/createUrl"
    assert _details_url_endpoint() == "https://api.signzy.app/api/v3/digilocker-v2/getDetails"
    assert _eaadhaar_url_endpoint() == "https://api.signzy.app/api/v3/digilocker-v2/geteaadhaar"


def test_preproduction_defaults_to_legacy_digilocker(monkeypatch):
    monkeypatch.delenv("SIGNZY_DIGILOCKER_API_VERSION", raising=False)
    monkeypatch.setenv("SIGNZY_ENV", "preproduction")
    assert _digilocker_uses_v2() is False
    assert _create_url_endpoint() == "https://api-preproduction.signzy.app/api/v3/digilocker/createUrl"


def test_explicit_v1_override_on_production(monkeypatch):
    monkeypatch.setenv("SIGNZY_ENV", "production")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_API_VERSION", "v1")
    assert _digilocker_uses_v2() is False
    assert _create_url_endpoint() == "https://api.signzy.app/api/v3/digilocker/createUrl"
