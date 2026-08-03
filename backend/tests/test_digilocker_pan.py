"""Tests for DigiLocker PAN extraction and payload merge."""

from services.digilocker import (
    extract_pan_from_documents,
    extract_pan_from_file_entry,
    merge_digilocker_details_into_payload,
    pan_info_from_documents,
    parse_digilocker_callback,
)


def test_extract_pan_from_file_entry():
    entry = {
        "doctype": "PANCR",
        "id": "in.gov.pan-PANCR-ABCDE1234F",
        "issuer": "Income Tax Department",
    }
    assert extract_pan_from_file_entry(entry) == "ABCDE1234F"


def test_extract_pan_ignores_aadhaar():
    entry = {
        "doctype": "ADHAR",
        "id": "in.gov.uidai-ADHAR-6245ec51dwfwe2cbeb59c73",
    }
    assert extract_pan_from_file_entry(entry) is None


def test_pan_info_from_documents_linked():
    files = [
        {"doctype": "ADHAR", "id": "in.gov.uidai-ADHAR-123"},
        {
            "doctype": "PANCR",
            "id": "in.gov.pan-PANCR-NOGPS67XXX",
            "issuer": "Income Tax Department",
        },
    ]
    info = pan_info_from_documents(files)
    assert info["linked"] is True
    assert info["number"] == "NOGPS67XXX"
    assert info["source"] == "signzy_digilocker"


def test_pan_info_from_documents_not_linked():
    info = pan_info_from_documents([{"doctype": "ADHAR", "id": "x"}])
    assert info["linked"] is False
    assert info["number"] is None


def test_parse_callback_with_pan_in_details():
    payload = {
        "requestId": "req-pan-1",
        "status": "success",
        "event": "consentComplete",
        "aadharDetail": {"name": "Test User", "uid": "xxxx1234"},
        "details": {
            "files": [
                {
                    "doctype": "PANCR",
                    "id": "in.gov.pan-PANCR-ABCDE1234F",
                    "issuer": "Income Tax Department",
                }
            ]
        },
    }
    parsed = parse_digilocker_callback(payload)
    assert parsed.pan_linked is True
    assert parsed.pan_number == "ABCDE1234F"
    assert parsed.pan_issuer == "Income Tax Department"


def test_merge_details_adds_files_to_eaadhaar_payload():
    eaadhaar = {
        "requestId": "req-1",
        "status": "success",
        "aadharDetail": {"name": "Ada"},
    }
    details = {
        "userDetails": {"digilockerid": "dl-1"},
        "files": [{"doctype": "PANCR", "id": "in.gov.pan-PANCR-ABCDE1234F"}],
    }
    merged = merge_digilocker_details_into_payload(eaadhaar, details)
    assert extract_pan_from_documents(merged["details"]["files"])["number"] == "ABCDE1234F"
