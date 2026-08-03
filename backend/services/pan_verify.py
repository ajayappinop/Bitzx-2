"""Signzy PAN Verify API — fallback when PAN is not linked in DigiLocker.

Configuration (backend/.env):
    SIGNZY_API_KEY              — shared with other Signzy integrations
    SIGNZY_ENV                  — "production" or "preproduction"
    SIGNZY_PAN_VERIFY_REQUIRED  — "true" / "false" (default true)
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_PROD_URL = "https://api.signzy.app/api/v3/pan/verify"
_PRE_URL = "https://api-preproduction.signzy.app/api/v3/pan/verify"
_TIMEOUT = 30.0

_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_VALID_PAN_STATUSES = frozenset({"E", "EA", "EC", "ED", "EI", "EL", "EM", "EP", "ES", "EU"})


@dataclass
class PanVerifyResult:
    verified: bool
    message: str
    pan: Optional[str] = None
    pan_status: Optional[str] = None
    name_matched: Optional[bool] = None
    dob_matched: Optional[bool] = None
    seeding_status: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


def _api_key() -> str:
    return (os.getenv("SIGNZY_API_KEY") or "").strip()


def _endpoint() -> str:
    env = (os.getenv("SIGNZY_ENV") or "preproduction").strip().lower()
    return _PROD_URL if env == "production" else _PRE_URL


def pan_verify_configured() -> bool:
    return bool(_api_key())


def pan_verify_required() -> bool:
    v = (os.getenv("SIGNZY_PAN_VERIFY_REQUIRED") or "true").strip().lower()
    return v not in ("false", "0", "no")


def normalize_pan(value: str) -> str:
    pan = (value or "").strip().upper().replace(" ", "")
    if not _PAN_RE.match(pan):
        raise ValueError("Invalid PAN format. Expected ABCDE1234F.")
    return pan


def normalize_dob_for_signzy(value: str) -> str:
    """Convert common date strings to DD/MM/YYYY for Signzy."""
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Date of birth is required for PAN verification.")
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", raw):
        return raw
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", raw)
    if m:
        return f"{m.group(1)}/{m.group(2)}/{m.group(3)}"
    raise ValueError("Date of birth must be DD/MM/YYYY (from Aadhaar).")


def _yes(value: Any) -> bool:
    return str(value or "").strip().upper() in ("Y", "YES", "TRUE", "1")


def _pan_status_valid(code: Optional[str]) -> bool:
    c = (code or "").strip().upper()
    return c in _VALID_PAN_STATUSES


def pan_info_satisfied(pan_info: Optional[Dict[str, Any]]) -> bool:
    """True when PAN is present from DigiLocker link or successful PAN Verify."""
    if not isinstance(pan_info, dict):
        return False
    if pan_info.get("linked") and pan_info.get("number"):
        return True
    if pan_info.get("verified") and pan_info.get("number"):
        return True
    return False


def build_pan_info_from_verify(result: PanVerifyResult) -> Dict[str, Any]:
    return {
        "linked": False,
        "number": result.pan,
        "file_id": None,
        "issuer": "Income Tax Department",
        "doctype": "PANCR",
        "source": "signzy_pan_verify",
        "verified": result.verified,
        "pan_status": result.pan_status,
        "name_matched": result.name_matched,
        "dob_matched": result.dob_matched,
        "seeding_status": result.seeding_status,
        "verified_at": None,
    }


async def verify_pan(*, pan: str, name: str, dob: str) -> PanVerifyResult:
    """Call Signzy PAN Verify API."""
    key = _api_key()
    if not key:
        raise RuntimeError("SIGNZY_API_KEY is not set")

    pan_norm = normalize_pan(pan)
    name_norm = (name or "").strip()
    if len(name_norm) < 3:
        raise ValueError("Name from Aadhaar is required for PAN verification.")
    dob_norm = normalize_dob_for_signzy(dob)

    payload = {"pan": pan_norm, "name": name_norm, "dob": dob_norm}
    endpoint = _endpoint()
    logger.info("[PanVerify] REQUEST endpoint=%s pan=%s name=%s dob=%s", endpoint, pan_norm, name_norm[:40], dob_norm)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json", "Authorization": key},
            )
    except httpx.TimeoutException as exc:
        logger.error("[PanVerify] TIMEOUT endpoint=%s", endpoint)
        raise ValueError("Signzy PAN verify request timed out") from exc
    except httpx.RequestError as exc:
        logger.error("[PanVerify] REQUEST_ERROR %s", exc)
        raise ValueError(f"Signzy PAN verify request error: {exc}") from exc

    logger.info("[PanVerify] RESPONSE status=%s body=%s", resp.status_code, resp.text[:500])

    if not resp.is_success:
        raise ValueError(f"Signzy PAN verify API error {resp.status_code}: {resp.text}")

    try:
        data = resp.json()
    except Exception as exc:
        raise ValueError(f"Signzy PAN verify returned non-JSON: {resp.text}") from exc

    result = data.get("result") if isinstance(data.get("result"), dict) else data
    if not isinstance(result, dict):
        result = {}

    pan_out = (result.get("pan") or pan_norm).strip().upper()
    pan_status = (result.get("panStatus") or result.get("pan_status") or "").strip().upper() or None
    name_flag = result.get("name")
    dob_flag = result.get("dob")
    seeding = (result.get("seedingStatus") or result.get("seeding_status") or "").strip().upper() or None

    name_ok = _yes(name_flag)
    dob_ok = _yes(dob_flag)
    status_ok = _pan_status_valid(pan_status)

    verified = status_ok and name_ok and dob_ok
    if verified:
        message = "PAN verified successfully"
    elif not status_ok:
        message = f"PAN is not valid (status: {pan_status or 'unknown'})"
    elif not name_ok:
        message = "PAN name does not match Aadhaar records"
    elif not dob_ok:
        message = "PAN date of birth does not match Aadhaar records"
    else:
        message = "PAN verification failed"

    logger.info(
        "[PanVerify] PARSED verified=%s panStatus=%s name=%s dob=%s seeding=%s",
        verified,
        pan_status,
        name_flag,
        dob_flag,
        seeding,
    )

    return PanVerifyResult(
        verified=verified,
        message=message,
        pan=pan_out,
        pan_status=pan_status,
        name_matched=name_ok,
        dob_matched=dob_ok,
        seeding_status=seeding,
        raw=result,
    )
