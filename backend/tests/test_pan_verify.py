"""Tests for Signzy PAN Verify helpers."""

import pytest

from services.pan_verify import (
    normalize_dob_for_signzy,
    normalize_pan,
    pan_info_satisfied,
    _pan_status_valid,
)


def test_normalize_pan_valid():
    assert normalize_pan("abcde1234f") == "ABCDE1234F"


def test_normalize_pan_invalid():
    with pytest.raises(ValueError, match="Invalid PAN"):
        normalize_pan("ABC123")


def test_normalize_dob_slash():
    assert normalize_dob_for_signzy("01/01/1990") == "01/01/1990"


def test_normalize_dob_iso():
    assert normalize_dob_for_signzy("1990-01-15") == "15/01/1990"


def test_pan_status_valid():
    assert _pan_status_valid("E") is True
    assert _pan_status_valid("EA") is True
    assert _pan_status_valid("N") is False
    assert _pan_status_valid("F") is False


def test_pan_info_satisfied_digilocker():
    assert pan_info_satisfied({"linked": True, "number": "ABCDE1234F"}) is True


def test_pan_info_satisfied_api():
    assert pan_info_satisfied({"verified": True, "number": "ABCDE1234F"}) is True


def test_pan_info_satisfied_missing():
    assert pan_info_satisfied({"linked": False}) is False
    assert pan_info_satisfied(None) is False
