"""Tests for Aadhaar reference photo persistence from DigiLocker callbacks."""

import base64
from pathlib import Path

import pytest

from services.digilocker import DigiLockerKycData, parse_digilocker_callback
from services.kyc_aadhaar_photo import (
    _jpeg_url_from_payload,
    _photo_base64_from_payload,
    persist_aadhaar_reference_photo,
    resolve_aadhaar_face_sources,
)


def test_parse_digilocker_callback_aadhaar_jpeg_key():
    payload = {
        "requestId": "req-1",
        "status": "success",
        "aadhaarJpeg": "https://signzy.example/aadhaar.jpg",
        "aadharDetail": {"name": "Test User", "uid": "xxxx1234"},
    }
    data = parse_digilocker_callback(payload)
    assert data.aadhaar_jpeg_url == "https://signzy.example/aadhaar.jpg"
    assert data.full_name == "Test User"


def test_jpeg_url_from_payload_root():
    assert _jpeg_url_from_payload({"aadhaarJpeg": "https://x/y.jpg"}) == "https://x/y.jpg"


def test_photo_base64_from_payload():
    raw = base64.b64encode(b"jpeg-bytes").decode()
    payload = {"aadharDetail": {"photo": raw}}
    assert _photo_base64_from_payload(payload) == b"jpeg-bytes"


@pytest.mark.asyncio
async def test_persist_aadhaar_from_base64(tmp_path: Path):
    raw = base64.b64encode(b"\xff\xd8\xff fake jpeg").decode()
    payload = {"aadharDetail": {"photo": raw}}
    kyc_data = DigiLockerKycData(request_id="r", status="success", event="consentComplete")
    path = await persist_aadhaar_reference_photo(
        uid="u1",
        kyc_dir=tmp_path,
        payload=payload,
        kyc_data=kyc_data,
    )
    assert path and path.startswith("/uploads/kyc/kyc_u1_aadhaar_")


def test_resolve_aadhaar_face_sources_prefers_parser_url():
    payload = {"aadhaarJpeg": "https://signzy.example/from-payload.jpg"}
    kyc_data = DigiLockerKycData(
        request_id="r",
        status="success",
        event="consentComplete",
        aadhaar_jpeg_url="https://signzy.example/from-parser.jpg",
    )
    remote, b64 = resolve_aadhaar_face_sources(payload, kyc_data)
    assert remote == "https://signzy.example/from-payload.jpg"
    assert b64 is None
