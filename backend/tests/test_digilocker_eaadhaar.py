"""Tests for Signzy DigiLocker getEAadhaar normalization."""

from services.digilocker import normalize_digilocker_eaadhaar_response, parse_digilocker_callback


def test_normalize_eaadhaar_maps_to_callback_shape():
    data = {
        "result": {
            "name": "Ada Lovelace",
            "uid": "xxxxxxxx1234",
            "dob": "10/12/1815",
            "gender": "FEMALE",
            "address": "London",
            "photo": "https://persist.signzy.tech/photo.jpeg",
            "aadhaarJpeg": "https://persist.signzy.tech/aadhaar.jpg",
            "aadhaarPdf": "https://persist.signzy.tech/aadhaar.pdf",
        }
    }
    out = normalize_digilocker_eaadhaar_response(data, "req-ea-1")
    assert out["requestId"] == "req-ea-1"
    assert out["status"] == "success"
    assert out["aadharDetail"]["name"] == "Ada Lovelace"
    assert out["aadhaarJpeg"] == "https://persist.signzy.tech/aadhaar.jpg"

    parsed = parse_digilocker_callback(out)
    assert parsed.full_name == "Ada Lovelace"
    assert parsed.aadhaar_jpeg_url == "https://persist.signzy.tech/aadhaar.jpg"
    assert parsed.photo_url == "https://persist.signzy.tech/photo.jpeg"


def test_normalize_eaadhaar_pending_when_empty():
    out = normalize_digilocker_eaadhaar_response({"result": {}}, "req-pending")
    assert out["status"] == "pending"
