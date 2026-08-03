"""Signzy DigiLocker KYC integration.

Flow:
  1. Backend calls ``create_digilocker_url()`` (``getEAadhaarJpeg: true``) to get a
     one-time DigiLocker authorization URL + requestId.
  2. Frontend redirects the user to that URL inside an iframe or popup.
  3. After the user authorises, Signzy POSTs the Aadhaar details to
     ``callbackUrl`` (our ``POST /api/kyc/digilocker/callback`` route).
  4. If the webhook is missed (local dev), ``fetch_digilocker_eaadhaar()`` pulls
     the same identity + photo via Signzy ``getEAadhaar``.
  5. The callback handler calls ``parse_digilocker_callback()`` to extract
     the structured KYC data, persists the Aadhaar photo, then advances to selfie.
  6. When PAN is linked in DigiLocker, ``getDetails`` / callback ``files[]`` supply
     PANCR metadata stored on the KYC record as ``pan_info``.

Configuration (backend/.env):
    SIGNZY_API_KEY               — shared with bank_verification.py
    SIGNZY_ENV                   — "production" or "preproduction"
    SIGNZY_DIGILOCKER_API_VERSION — "v2" or "v1" (default: v2 on production, v1 on sandbox)
    SIGNZY_DIGILOCKER_CALLBACK_URL
                                 — full URL of the backend callback endpoint,
                                   e.g. https://api.ibo.io/api/kyc/digilocker/callback
    SIGNZY_DIGILOCKER_SUCCESS_URL — where to redirect after successful auth (web)
    SIGNZY_DIGILOCKER_FAILURE_URL — where to redirect after failed auth
    SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL — mobile success redirect (deep link or HTTPS bridge)
    SIGNZY_DIGILOCKER_ANDROID_FAILURE_URL — optional mobile failure redirect
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class SignzyApiError(Exception):
    """Signzy HTTP failure with a stable code for API handlers."""

    def __init__(self, code: str, message: str, *, http_status: int = 502):
        self.code = code
        self.message = message
        self.http_status = http_status
        super().__init__(message)


def _check_signzy_response(resp: httpx.Response, operation: str) -> None:
    if resp.is_success:
        return
    body = (resp.text or "").lower()
    if resp.status_code == 403 and "credit" in body:
        raise SignzyApiError(
            "credits_exhausted",
            "Signzy API credits are exhausted. Top up your Signzy account or contact Signzy support, then try again.",
            http_status=503,
        )
    raise SignzyApiError(
        "signzy_http_error",
        f"Signzy DigiLocker {operation} failed (HTTP {resp.status_code}). Try again later or contact support.",
        http_status=502,
    )


# ── Config ────────────────────────────────────────────────────────────────────

_PROD_HOST = "https://api.signzy.app"
_PRE_HOST  = "https://api-preproduction.signzy.app"
_TIMEOUT   = 20.0

# Signzy production requires DigiLocker 2.0 paths (/api/v3/digilocker-v2/…).
# Legacy /digilocker/… returns 403 "You cannot consume this service" on prod accounts.

# Aadhaar + PAN consent when linked in the user's DigiLocker account.
DEFAULT_DIGILOCKER_DOC_TYPES: List[str] = ["ADHAR", "PANCR"]


def _api_key() -> str:
    return (os.getenv("SIGNZY_API_KEY") or "").strip()


def _signzy_env() -> str:
    return (os.getenv("SIGNZY_ENV") or "preproduction").strip().lower()


def _signzy_host() -> str:
    return _PROD_HOST if _signzy_env() == "production" else _PRE_HOST


def _digilocker_api_segment() -> str:
    """Return URL path segment ``digilocker-v2`` or legacy ``digilocker``."""
    ver = (os.getenv("SIGNZY_DIGILOCKER_API_VERSION") or "").strip().lower()
    if ver in ("v2", "2", "digilocker-v2"):
        return "digilocker-v2"
    if ver in ("v1", "1", "legacy", "digilocker"):
        return "digilocker"
    # Production Signzy accounts use DigiLocker 2.0; sandbox docs still use v1 paths.
    return "digilocker-v2" if _signzy_env() == "production" else "digilocker"


def _digilocker_uses_v2() -> bool:
    return _digilocker_api_segment() == "digilocker-v2"


def _digilocker_endpoint(action: str) -> str:
    """Build ``…/api/v3/{digilocker|digilocker-v2}/{action}``."""
    action = (action or "").strip().lstrip("/")
    return f"{_signzy_host()}/api/v3/{_digilocker_api_segment()}/{action}"


def _create_url_endpoint() -> str:
    return _digilocker_endpoint("createUrl")


def _details_url_endpoint() -> str:
    return _digilocker_endpoint("getDetails")


def _eaadhaar_url_endpoint() -> str:
    return _digilocker_endpoint("geteaadhaar")


def _digilocker_pending_error(resp: httpx.Response) -> bool:
    """True when Signzy indicates consent is not finished yet."""
    if resp.status_code not in (401, 404):
        return False
    body = (resp.text or "").lower()
    return (
        "not completed" in body
        or "consent journey" in body
        or "auth_fail" in body
        or resp.status_code == 404
    )


def _callback_url() -> str:
    return (os.getenv("SIGNZY_DIGILOCKER_CALLBACK_URL") or "").strip()


def _success_url() -> str:
    return (os.getenv("SIGNZY_DIGILOCKER_SUCCESS_URL") or "").strip()


def _failure_url() -> str:
    return (os.getenv("SIGNZY_DIGILOCKER_FAILURE_URL") or "").strip()


def _android_success_url() -> str:
    return (os.getenv("SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL") or "").strip()


def _android_failure_url() -> str:
    return (os.getenv("SIGNZY_DIGILOCKER_ANDROID_FAILURE_URL") or "").strip()


def _api_public_base() -> str:
    return (
        os.getenv("API_PUBLIC_URL")
        or os.getenv("BACKEND_PUBLIC_URL")
        or ""
    ).strip().rstrip("/")


def _mobile_bridge_success_url() -> str:
    """HTTPS bridge that redirects into the native app (ibo://…).

    Mobile clients must never fall back to the web exchange /kyc page — that
    loads the website inside the in-app browser and blocks auto-advance.
    """
    explicit = _android_success_url()
    if explicit:
        return explicit
    base = _api_public_base()
    if base:
        return f"{base}/api/kyc/digilocker/return"
    return ""


def resolve_digilocker_redirect_urls(
    client: Optional[str] = None,
) -> tuple[str, str]:
    """Pick Signzy browser redirect URLs for web vs mobile clients."""
    key = (client or "").strip().lower()
    if key in ("android", "ios"):
        success = _mobile_bridge_success_url()
        if not success:
            logger.warning(
                "[DigiLocker] mobile client=%s has no HTTPS bridge URL "
                "(set SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL or API_PUBLIC_URL)",
                key,
            )
        failure = _android_failure_url() or _failure_url()
        return success, failure
    return _success_url(), _failure_url()


def digilocker_configured() -> bool:
    return bool(_api_key())


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class DigiLockerUrlResult:
    url: str
    """DigiLocker authorization URL to open in the browser / iframe."""
    request_id: str
    """Signzy requestId — store this to match against the callback."""


@dataclass
class DigiLockerKycData:
    """Structured KYC data extracted from the Signzy callback payload."""

    request_id: str
    status: str           # "success" | "failure"
    event: str            # e.g. "consentComplete"

    # Aadhaar details (present when status == "success")
    full_name: Optional[str] = None
    dob: Optional[str] = None           # "dd/mm/yyyy"
    gender: Optional[str] = None        # "MALE" | "FEMALE"
    uid_masked: Optional[str] = None    # "xxxxxxxx3445"
    address: Optional[str] = None
    photo_url: Optional[str] = None
    aadhaar_pdf_url: Optional[str] = None
    aadhaar_jpeg_url: Optional[str] = None
    xml_file_url: Optional[str] = None
    split_address: Optional[Dict[str, Any]] = None

    # DigiLocker user account details
    digilocker_id: Optional[str] = None
    eaadhaar: Optional[str] = None      # "Y" when linked
    mobile: Optional[str] = None

    # Documents available in DigiLocker (ADHAR, PANCR, DRVLC, etc.)
    documents: List[Dict[str, Any]] = field(default_factory=list)

    # PAN verification record when linked in DigiLocker (doctype PANCR)
    pan_number: Optional[str] = None
    pan_file_id: Optional[str] = None
    pan_issuer: Optional[str] = None
    pan_linked: bool = False

    # Raw payload stored for audit
    raw_payload: Optional[Dict[str, Any]] = None


# ── API call ──────────────────────────────────────────────────────────────────

async def create_digilocker_url(
    internal_id: str,
    doc_types: Optional[List[str]] = None,
    *,
    success_redirect_url: Optional[str] = None,
    failure_redirect_url: Optional[str] = None,
) -> DigiLockerUrlResult:
    """Call Signzy to generate a one-time DigiLocker authorization URL.

    Args:
        internal_id: An identifier (e.g. uid) to match the callback.
        doc_types: Documents to request consent for.  Defaults to
                   ``DEFAULT_DIGILOCKER_DOC_TYPES`` (Aadhaar + PAN when linked).

    Raises:
        RuntimeError: if ``SIGNZY_API_KEY`` is not configured.
        httpx.HTTPStatusError / TimeoutException: on Signzy errors.
    """
    key = _api_key()
    if not key:
        raise RuntimeError(
            "SIGNZY_API_KEY is not set. Configure it in backend/.env to enable DigiLocker KYC."
        )

    payload: Dict[str, Any] = {
        "signup":           True,
        "internalId":       internal_id,
        "docType":          doc_types or list(DEFAULT_DIGILOCKER_DOC_TYPES),
        "purpose":          "kyc",
        "getScope":         True,
        "getEAadhaarPdf":   True,
        "getEAadhaarJpeg":  True,
        "getBase64Files":   False,
    }

    cb = _callback_url()
    if cb:
        payload["callbackUrl"] = cb

    success = (success_redirect_url or "").strip() or _success_url()
    if success:
        payload["successRedirectUrl"] = success
        payload["successRedirectTime"] = "5"

    failure = (failure_redirect_url or "").strip() or _failure_url()
    if failure:
        payload["failureRedirectUrl"] = failure
        payload["failureRedirectTime"] = "5"

    logger.info(
        "[DigiLocker] REQUEST  endpoint=%s internalId=%s docType=%s",
        _create_url_endpoint(),
        internal_id,
        payload["docType"],
    )

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                _create_url_endpoint(),
                json=payload,
                headers={
                    "Content-Type":  "application/json",
                    "Authorization": key,
                },
            )
    except httpx.TimeoutException as exc:
        logger.error("[DigiLocker] REQUEST_TIMEOUT endpoint=%s: %s", _create_url_endpoint(), exc)
        raise ValueError("Signzy DigiLocker request timed out") from exc
    except httpx.ConnectError as exc:
        logger.error("[DigiLocker] CONNECT_ERROR endpoint=%s: %s", _create_url_endpoint(), exc)
        raise ValueError("Signzy DigiLocker unreachable — check network/DNS and SIGNZY_API_KEY") from exc
    except httpx.RequestError as exc:
        logger.error("[DigiLocker] REQUEST_ERROR endpoint=%s: %s", _create_url_endpoint(), exc)
        raise ValueError(f"Signzy DigiLocker request error: {exc}") from exc

    # Always log the raw response so we can debug API issues.
    logger.info(
        "[DigiLocker] RESPONSE  status=%s body=%s",
        resp.status_code,
        resp.text,
    )

    if not resp.is_success:
        _check_signzy_response(resp, "createUrl")

    try:
        data = resp.json()
    except Exception as exc:
        logger.error("[DigiLocker] JSON_PARSE_ERROR body=%s exc=%s", resp.text, exc)
        raise ValueError(f"Signzy DigiLocker returned non-JSON response: {resp.text}") from exc

    result = data.get("result", {})
    url        = result.get("url") or ""
    request_id = result.get("requestId") or ""

    logger.info(
        "[DigiLocker] PARSED  requestId=%s url_present=%s result_keys=%s",
        request_id or "(none)",
        bool(url),
        list(result.keys()),
    )

    if not url or not request_id:
        logger.error("[DigiLocker] UNEXPECTED_SHAPE full_response=%s", data)
        raise ValueError(f"Signzy DigiLocker returned unexpected shape: {data}")

    logger.info("[DigiLocker] URL_CREATED requestId=%s internalId=%s url=%s", request_id, internal_id, url)
    return DigiLockerUrlResult(url=url, request_id=request_id)


def normalize_digilocker_details_response(data: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    """Map Signzy ``getDetails`` JSON into the same shape as the webhook callback."""
    raw = data.get("result") if isinstance(data.get("result"), dict) else data
    if not isinstance(raw, dict):
        raise ValueError("Signzy DigiLocker getDetails returned unexpected shape")

    payload: Dict[str, Any] = dict(raw)
    payload.setdefault("requestId", request_id)

    if not payload.get("status"):
        has_aadhaar = bool(
            payload.get("aadharDetail")
            or payload.get("aadhaarDetail")
            or payload.get("aadhaarJpeg")
            or payload.get("details")
        )
        payload["status"] = "success" if has_aadhaar else "pending"

    return payload


async def fetch_digilocker_details(request_id: str) -> Dict[str, Any]:
    """Pull DigiLocker result from Signzy when the webhook cannot reach our server."""
    key = _api_key()
    if not key:
        raise RuntimeError("SIGNZY_API_KEY is not set")

    rid = (request_id or "").strip()
    if not rid:
        raise ValueError("requestId is required")

    endpoint = _details_url_endpoint()
    logger.info("[DigiLocker] GET_DETAILS requestId=%s endpoint=%s", rid, endpoint)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                endpoint,
                json={"requestId": rid},
                headers={"Content-Type": "application/json", "Authorization": key},
            )
    except httpx.TimeoutException as exc:
        raise ValueError("Signzy DigiLocker getDetails timed out") from exc
    except httpx.RequestError as exc:
        raise ValueError(f"Signzy DigiLocker getDetails request error: {exc}") from exc

    logger.info("[DigiLocker] GET_DETAILS_RESPONSE status=%s body=%s", resp.status_code, resp.text[:500])

    if _digilocker_pending_error(resp):
        raise ValueError("DigiLocker session not found or not completed yet")

    if not resp.is_success:
        _check_signzy_response(resp, "getDetails")

    try:
        data = resp.json()
    except Exception as exc:
        raise ValueError(f"Signzy DigiLocker getDetails returned non-JSON: {resp.text}") from exc

    return normalize_digilocker_details_response(data, rid)


def normalize_digilocker_eaadhaar_response(data: Dict[str, Any], request_id: str) -> Dict[str, Any]:
    """Map Signzy ``getEAadhaar`` JSON into the same shape as the webhook callback."""
    raw = data.get("result") if isinstance(data.get("result"), dict) else data
    if not isinstance(raw, dict):
        raise ValueError("Signzy DigiLocker getEAadhaar returned unexpected shape")

    aadhaar_jpeg = (
        data.get("aadhaarJpeg")
        or data.get("eAadhaarJpeg")
        or raw.get("aadhaarJpeg")
        or raw.get("eAadhaarJpeg")
    )
    aadhaar_pdf = data.get("aadhaarPdf") or data.get("eAadhaarPdf") or raw.get("aadhaarPdf")

    aadhar_detail: Dict[str, Any] = {
        "name": raw.get("name"),
        "uid": raw.get("uid"),
        "dob": raw.get("dob"),
        "gender": raw.get("gender"),
        "address": raw.get("address"),
        "photo": raw.get("photo"),
        "splitAddress": raw.get("splitAddress"),
    }

    has_identity = bool(
        aadhar_detail.get("name")
        or aadhar_detail.get("uid")
        or aadhaar_jpeg
        or aadhar_detail.get("photo")
    )

    payload: Dict[str, Any] = {
        "requestId": request_id,
        "status": "success" if has_identity else "pending",
        "event": "consentComplete",
        "aadharDetail": aadhar_detail,
        "aadhaarJpeg": aadhaar_jpeg,
        "aadhaarPdf": aadhaar_pdf,
    }
    return payload


async def fetch_digilocker_eaadhaar(request_id: str) -> Dict[str, Any]:
    """Fetch full e-Aadhaar (identity + photo/JPEG) after ``createUrl`` consent.

    Use this for Check status / redirect completion when the webhook did not
    reach our server. ``getDetails`` only lists linked documents and lacks the
    face reference needed for face match.
    """
    key = _api_key()
    if not key:
        raise RuntimeError("SIGNZY_API_KEY is not set")

    rid = (request_id or "").strip()
    if not rid:
        raise ValueError("requestId is required")

    uses_v2 = _digilocker_uses_v2()
    endpoint = _details_url_endpoint() if uses_v2 else _eaadhaar_url_endpoint()
    logger.info(
        "[DigiLocker] GET_EAADHAAR requestId=%s endpoint=%s api=%s",
        rid,
        endpoint,
        "v2-getDetails" if uses_v2 else "v1-geteaadhaar",
    )

    payload: Dict[str, Any] = {
        "requestId": rid,
        "getEAadhaarPdf": True,
        "getEAadhaarJpeg": True,
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json", "Authorization": key},
            )
    except httpx.TimeoutException as exc:
        raise ValueError("Signzy DigiLocker getEAadhaar timed out") from exc
    except httpx.RequestError as exc:
        raise ValueError(f"Signzy DigiLocker getEAadhaar request error: {exc}") from exc

    logger.info("[DigiLocker] GET_EAADHAAR_RESPONSE status=%s body=%s", resp.status_code, resp.text[:500])

    if _digilocker_pending_error(resp):
        raise ValueError("DigiLocker session not found or not completed yet")

    if not resp.is_success:
        _check_signzy_response(resp, "getEAadhaar")

    try:
        data = resp.json()
    except Exception as exc:
        raise ValueError(f"Signzy DigiLocker getEAadhaar returned non-JSON: {resp.text}") from exc

    if uses_v2:
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        if isinstance(result, dict) and (
            result.get("name") or result.get("uid") or result.get("aadharDetail")
        ):
            return normalize_digilocker_eaadhaar_response(data, rid)
        return normalize_digilocker_details_response(data, rid)

    return normalize_digilocker_eaadhaar_response(data, rid)


def _digilocker_files_from_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Collect linked document entries from callback or getDetails shapes."""
    details = payload.get("details")
    if isinstance(details, dict):
        files = details.get("files")
        if isinstance(files, list):
            return [f for f in files if isinstance(f, dict)]
    root_files = payload.get("files")
    if isinstance(root_files, list):
        return [f for f in root_files if isinstance(f, dict)]
    return []


def extract_pan_from_file_entry(file_entry: Dict[str, Any]) -> Optional[str]:
    """Return PAN from a DigiLocker ``files[]`` row (``doctype`` PANCR)."""
    doctype = (file_entry.get("doctype") or "").strip().upper()
    if doctype != "PANCR":
        return None
    file_id = (file_entry.get("id") or "").strip()
    if not file_id:
        return None
    marker = "-PANCR-"
    upper_id = file_id.upper()
    idx = upper_id.rfind(marker)
    if idx >= 0:
        pan = file_id[idx + len(marker):].strip().upper()
        if len(pan) >= 5:
            return pan
    return None


def extract_pan_from_documents(files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Find the first PANCR file and return structured PAN metadata."""
    for entry in files:
        if not isinstance(entry, dict):
            continue
        if (entry.get("doctype") or "").strip().upper() != "PANCR":
            continue
        pan_number = extract_pan_from_file_entry(entry)
        if not pan_number:
            continue
        return {
            "linked": True,
            "number": pan_number,
            "file_id": (entry.get("id") or "").strip() or None,
            "issuer": (entry.get("issuer") or "").strip() or None,
            "doctype": "PANCR",
            "source": "signzy_digilocker",
        }
    return None


def pan_info_from_documents(files: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build stored ``pan_info`` document (linked or not)."""
    found = extract_pan_from_documents(files)
    if found:
        return found
    return {
        "linked": False,
        "number": None,
        "file_id": None,
        "issuer": None,
        "doctype": None,
        "source": None,
    }


def merge_digilocker_details_into_payload(
    payload: Dict[str, Any],
    details_payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Merge ``getDetails`` file list into an e-Aadhaar/callback payload."""
    merged = dict(payload)
    files = _digilocker_files_from_payload(details_payload)
    user_details = details_payload.get("userDetails")
    if not isinstance(user_details, dict):
        user_details = None

    if not files and not user_details:
        return merged

    details = dict(merged.get("details") or {}) if isinstance(merged.get("details"), dict) else {}
    if files and not details.get("files"):
        details["files"] = files
    if user_details:
        existing_ud = details.get("userDetails") if isinstance(details.get("userDetails"), dict) else {}
        ud = dict(existing_ud)
        for key, val in user_details.items():
            if val and not ud.get(key):
                ud[key] = val
        details["userDetails"] = ud
    merged["details"] = details
    return merged


async def enrich_digilocker_payload_with_details(
    request_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Attach linked documents (e.g. PAN) from ``getDetails`` when missing."""
    if _digilocker_files_from_payload(payload):
        return payload
    try:
        details = await fetch_digilocker_details(request_id)
    except ValueError as exc:
        logger.warning(
            "[DigiLocker] getDetails skipped requestId=%s reason=%s",
            request_id,
            exc,
        )
        return payload
    merged = merge_digilocker_details_into_payload(payload, details)
    if extract_pan_from_documents(_digilocker_files_from_payload(merged)):
        logger.info("[DigiLocker] PAN linked requestId=%s", request_id)
    return merged


# ── Callback parser ───────────────────────────────────────────────────────────

def parse_digilocker_callback(payload: Dict[str, Any]) -> DigiLockerKycData:
    """Parse the webhook payload Signzy sends to ``callbackUrl``.

    Does NOT raise — always returns a ``DigiLockerKycData`` with whatever
    information is available.  Callers should check ``.status``.
    """
    request_id  = payload.get("requestId") or ""
    status      = payload.get("status") or "unknown"
    event       = payload.get("event") or ""

    aadhaar = payload.get("aadharDetail") or payload.get("aadhaarDetail") or {}
    details = payload.get("details") or {}
    user_details = details.get("userDetails") if isinstance(details, dict) else {}
    if not isinstance(user_details, dict):
        user_details = {}
    files = _digilocker_files_from_payload(payload)

    pan_meta = extract_pan_from_documents(files)
    pan_number = pan_meta["number"] if pan_meta else None
    pan_file_id = pan_meta["file_id"] if pan_meta else None
    pan_issuer = pan_meta["issuer"] if pan_meta else None
    pan_linked = bool(pan_meta)

    full_name   = (aadhaar.get("name") or "").strip() or None
    dob         = (aadhaar.get("dob") or "").strip() or None
    gender      = (aadhaar.get("gender") or "").strip() or None
    uid_masked  = (aadhaar.get("uid") or "").strip() or None
    address     = (aadhaar.get("address") or "").strip() or None
    photo_raw   = (aadhaar.get("photo") or "").strip() or None
    photo_url: Optional[str] = None
    if photo_raw and photo_raw.lower().startswith("http"):
        photo_url = photo_raw
    split_addr  = aadhaar.get("splitAddress") or None

    aadhaar_jpeg_url = payload.get("aadhaarJpeg") or payload.get("eAadhaarJpeg")
    if isinstance(details, dict) and not aadhaar_jpeg_url:
        aadhaar_jpeg_url = details.get("aadhaarJpeg") or details.get("eAadhaarJpeg")

    # DigiLocker user details
    digilocker_id = (user_details.get("digilockerid") or "").strip() or None
    eaadhaar      = (user_details.get("eaadhaar") or "").strip() or None
    mobile        = (user_details.get("mobile") or "").strip() or None

    # Fall back to userDetails.name if aadharDetail.name is masked / absent
    if not full_name:
        full_name = (user_details.get("name") or "").strip() or None
    if not dob:
        dob = (user_details.get("dob") or "").strip() or None

    logger.info(
        "[DigiLocker] CALLBACK requestId=%s event=%s status=%s name=%s pan_linked=%s",
        request_id, event, status, full_name, pan_linked,
    )

    return DigiLockerKycData(
        request_id      = request_id,
        status          = status,
        event           = event,
        full_name       = full_name,
        dob             = dob,
        gender          = gender,
        uid_masked      = uid_masked,
        address         = address,
        photo_url       = photo_url,
        aadhaar_pdf_url = payload.get("aadhaarPdf") or payload.get("eAadhaarPdf"),
        aadhaar_jpeg_url= aadhaar_jpeg_url if isinstance(aadhaar_jpeg_url, str) else None,
        xml_file_url    = payload.get("xmlFileLink"),
        split_address   = split_addr,
        digilocker_id   = digilocker_id,
        eaadhaar        = eaadhaar,
        mobile          = mobile,
        documents       = files,
        pan_number      = pan_number,
        pan_file_id     = pan_file_id,
        pan_issuer      = pan_issuer,
        pan_linked      = pan_linked,
        raw_payload     = payload,
    )
