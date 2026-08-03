"""Unit tests for Signzy face match helpers (no live API calls)."""

from services.face_match import (
    FaceMatchResult,
    _humanize_face_match_message,
    _parse_match_score,
    public_asset_url,
)


def test_parse_match_score():
    assert _parse_match_score("98.00%") == 98.0
    assert _parse_match_score("50") == 50.0
    assert _parse_match_score(None) is None


def test_public_asset_url_absolute():
    url = "https://cdn.example.com/id.jpg"
    assert public_asset_url(url) == url


def test_public_asset_url_relative(monkeypatch):
    monkeypatch.setenv("API_PUBLIC_URL", "https://api.example.com")
    assert public_asset_url("/uploads/kyc/kyc_u1_selfie_abc.jpg") == (
        "https://api.example.com/uploads/kyc/kyc_u1_selfie_abc.jpg"
    )


def test_face_match_result_defaults():
    r = FaceMatchResult(verified=True, message="ok")
    assert r.mask_detections == []


def test_humanize_face_match_message_failed_signzy_jargon():
    msg = _humanize_face_match_message(
        False,
        "Verification completed with negative results",
        12.0,
    )
    assert "Face verification failed" in msg
    assert "negative" not in msg.lower()
    assert "12% match" in msg


def test_humanize_face_match_message_passed():
    assert _humanize_face_match_message(True, "", None) == "Face match passed"
