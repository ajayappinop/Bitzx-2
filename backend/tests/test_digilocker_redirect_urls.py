"""Tests for per-client DigiLocker redirect URL selection."""

import os

from services.digilocker import resolve_digilocker_redirect_urls


def test_resolve_redirect_urls_web(monkeypatch):
    monkeypatch.setenv("SIGNZY_DIGILOCKER_SUCCESS_URL", "https://exchange.example/kyc")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_FAILURE_URL", "https://exchange.example/kyc?failed=1")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL", "ibo://kyc/done")
    success, failure = resolve_digilocker_redirect_urls("web")
    assert success == "https://exchange.example/kyc"
    assert failure == "https://exchange.example/kyc?failed=1"


def test_resolve_redirect_urls_android_prefers_mobile_env(monkeypatch):
    monkeypatch.setenv("SIGNZY_DIGILOCKER_SUCCESS_URL", "https://exchange.example/kyc")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_FAILURE_URL", "https://exchange.example/kyc?failed=1")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL", "https://api.example/kyc/digilocker/return")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_ANDROID_FAILURE_URL", "ibo://kyc/failed")
    success, failure = resolve_digilocker_redirect_urls("android")
    assert success == "https://api.example/kyc/digilocker/return"
    assert failure == "ibo://kyc/failed"


def test_resolve_redirect_urls_android_uses_api_bridge_when_mobile_env_unset(monkeypatch):
    monkeypatch.delenv("SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL", raising=False)
    monkeypatch.delenv("SIGNZY_DIGILOCKER_ANDROID_FAILURE_URL", raising=False)
    monkeypatch.setenv("API_PUBLIC_URL", "https://api.example")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_SUCCESS_URL", "https://exchange.example/kyc")
    monkeypatch.setenv("SIGNZY_DIGILOCKER_FAILURE_URL", "https://exchange.example/fail")
    success, failure = resolve_digilocker_redirect_urls("android")
    assert success == "https://api.example/api/kyc/digilocker/return"
    assert failure == "https://exchange.example/fail"


def test_resolve_redirect_urls_android_no_exchange_fallback_without_bridge(monkeypatch):
    monkeypatch.delenv("SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL", raising=False)
    monkeypatch.delenv("API_PUBLIC_URL", raising=False)
    monkeypatch.delenv("BACKEND_PUBLIC_URL", raising=False)
    monkeypatch.setenv("SIGNZY_DIGILOCKER_SUCCESS_URL", "https://exchange.example/kyc")
    success, _ = resolve_digilocker_redirect_urls("android")
    assert success == ""


def test_resolve_redirect_urls_ios_uses_mobile_bridge(monkeypatch):
    monkeypatch.setenv("API_PUBLIC_URL", "https://api.example")
    monkeypatch.delenv("SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL", raising=False)
    success, _ = resolve_digilocker_redirect_urls("ios")
    assert success == "https://api.example/api/kyc/digilocker/return"
