"""Tests for Signzy DigiLocker getDetails normalization."""

from services.digilocker import normalize_digilocker_details_response


def test_normalize_details_success_from_result_wrapper():
    data = {
        "result": {
            "details": {"userDetails": {"name": "Ada"}},
            "aadharDetail": {"uid": "xxxx9999"},
        }
    }
    out = normalize_digilocker_details_response(data, "req-99")
    assert out["requestId"] == "req-99"
    assert out["status"] == "success"


def test_normalize_details_pending_when_empty():
    out = normalize_digilocker_details_response({"result": {}}, "req-pending")
    assert out["status"] == "pending"
