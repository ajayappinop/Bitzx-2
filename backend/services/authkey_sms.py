"""AuthKey.io SMS for signup OTP.

Docs: https://authkey.io/sms-api-docs (POST SID, GET request, India DLT, 2FA verify).

Environment (backend/.env):
    AUTHKEY_SMS_ENABLED          true | 1
    AUTHKEY_API_KEY              AuthKey (also AUTHKEY_AUTHKEY)
    AUTHKEY_SMS_SID              Template SID (e.g. 40384) — template uses {#otp#}, {#name#}, etc.
    AUTHKEY_SMS_COUNTRY_CODE     Without + (e.g. 91)
    AUTHKEY_SMS_COMPANY          Optional template var {#company#}
    AUTHKEY_SMS_SENDER           Optional DLT sender id
    AUTHKEY_SMS_PE_ID            Optional India DLT principal entity id
    AUTHKEY_SMS_DLT_TEMPLATE_ID  Optional India DLT template id
    AUTHKEY_SMS_USE_GET_FALLBACK true — retry via GET api.authkey.io/request on POST failure
    AUTHKEY_SMS_OTP_MODE         local (default) | managed_2fa
        local: we generate OTP and pass otp= in template (dual email+SMS signup)
        managed_2fa: AuthKey generates {#2fa#}; verify with LogID via 2fa_verify.php

Never commit API keys to git.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

_POST_JSON_URL = "https://console.authkey.io/restapi/requestjson.php"
_GET_REQUEST_URL = "https://api.authkey.io/request"
_2FA_REQUEST_URL = "https://console.authkey.io/restapi/request.php"
_2FA_VERIFY_URL = "https://console.authkey.io/api/2fa_verify.php"
_TIMEOUT_SEC = 20.0


@dataclass
class SmsSendResult:
    ok: bool
    log_id: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    managed_otp: bool = False


def _env_bool(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _enabled() -> bool:
    return _env_bool("AUTHKEY_SMS_ENABLED")


def _api_key() -> str:
    return (os.getenv("AUTHKEY_API_KEY") or os.getenv("AUTHKEY_AUTHKEY") or "").strip()


def _sid() -> str:
    return (os.getenv("AUTHKEY_SMS_SID") or "").strip()


def _company() -> str:
    return (os.getenv("AUTHKEY_SMS_COMPANY") or os.getenv("AUTHKEY_COMPANY") or "").strip()


def _sender() -> str:
    return (os.getenv("AUTHKEY_SMS_SENDER") or "").strip()


def _pe_id() -> str:
    return (os.getenv("AUTHKEY_SMS_PE_ID") or "").strip()


def _dlt_template_id() -> str:
    return (os.getenv("AUTHKEY_SMS_DLT_TEMPLATE_ID") or "").strip()


def _country_code_from_env() -> str:
    return re.sub(r"\D", "", (os.getenv("AUTHKEY_SMS_COUNTRY_CODE") or ""))


def _otp_mode() -> str:
    return (os.getenv("AUTHKEY_SMS_OTP_MODE") or "local").strip().lower()


def configured() -> bool:
    return _enabled() and bool(_api_key()) and bool(_sid()) and bool(_country_code_from_env())


def default_country_code() -> str:
    cc = _country_code_from_env()
    if not cc:
        raise ValueError("AUTHKEY_SMS_COUNTRY_CODE is not set in backend/.env")
    return cc


def sms_mode() -> str:
    return "managed_2fa" if _otp_mode() == "managed_2fa" else "template"


def normalize_mobile(mobile: str, country_code: Optional[str] = None) -> Tuple[str, str]:
    """Return (country_code, national_number_digits)."""
    cc = re.sub(r"\D", "", country_code or "") or default_country_code()
    raw = re.sub(r"\D", "", mobile or "")
    if not raw:
        raise ValueError("Mobile number is required")
    if raw.startswith(cc) and len(raw) > len(cc):
        raw = raw[len(cc):]
    if len(raw) > len(cc) + 6 and raw.startswith(cc):
        raw = raw[len(cc):]
    if len(raw) < 7 or len(raw) > 15:
        raise ValueError("Invalid mobile number length")
    return cc, raw


def mask_phone_hint(country_code: str, mobile: str) -> str:
    cc, nat = normalize_mobile(mobile, country_code)
    if len(nat) <= 4:
        return f"+{cc} ****"
    return f"+{cc} ******{nat[-4:]}"


def _auth_headers() -> Dict[str, str]:
    """POST docs: Content-Type + Authorization: Basic <Api_Key>."""
    key = _api_key()
    return {
        "Content-Type": "application/json",
        "Authorization": f"Basic {key}",
    }


def build_request_payload(
    *,
    mobile: str,
    otp: Optional[str] = None,
    country_code: Optional[str] = None,
    name: Optional[str] = None,
) -> Dict[str, str]:
    """
    POST sendSMS-SID body (console …/requestjson.php).
    Template placeholders {#otp#}, {#name#}, {#company#} map to these keys.
    """
    cc, nat = normalize_mobile(mobile, country_code)
    payload: Dict[str, str] = {
        "country_code": cc,
        "mobile": nat,
        "sid": _sid(),
    }
    if otp is not None and str(otp).strip():
        payload["otp"] = str(otp).strip()
    if name and str(name).strip():
        payload["name"] = str(name).strip()
    company = _company()
    if company:
        payload["company"] = company
    sender = _sender()
    pe = _pe_id()
    tpl = _dlt_template_id()
    if sender:
        payload["sender"] = sender
    if pe:
        payload["pe_id"] = pe
    if tpl:
        payload["template_id"] = tpl
    # Legacy consoles that expect authkey in JSON body (in addition to Authorization header)
    if _env_bool("AUTHKEY_SMS_AUTHKEY_IN_BODY", default=True):
        payload["authkey"] = _api_key()
    return payload


def _extract_log_id(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    for key in ("LogID", "logid", "log_id", "LogId"):
        val = payload.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    for nest in ("message", "data", "response", "success"):
        inner = payload.get(nest)
        if isinstance(inner, dict):
            found = _extract_log_id(inner)
            if found:
                return found
    return None


def _sms_submitted_ok(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    success = payload.get("success")
    if isinstance(success, dict) and success.get("sms") is True:
        return True
    if payload.get("status") is True or str(payload.get("status", "")).lower() == "true":
        return True
    msg = payload.get("message")
    if isinstance(msg, str) and "success" in msg.lower():
        return True
    if isinstance(msg, dict) and str(msg.get("sms", "")).lower().find("success") >= 0:
        return True
    if isinstance(msg, dict) and str(msg.get("Message", "")).lower().find("success") >= 0:
        return True
    return False


def _safe_log_payload(body: Dict[str, str]) -> Dict[str, str]:
    out = dict(body)
    if "authkey" in out:
        out["authkey"] = "***"
    if "otp" in out:
        out["otp"] = "******"
    return out


async def _post_sid_json(body: Dict[str, str]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    logger.info("authkey_sms POST %s payload=%s", _POST_JSON_URL, _safe_log_payload(body))
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEC) as client:
            resp = await client.post(_POST_JSON_URL, json=body, headers=_auth_headers())
    except httpx.TimeoutException as exc:
        logger.error("authkey_sms POST timeout url=%s: %s", _POST_JSON_URL, exc)
        return False, None, "SMS gateway timed out"
    except httpx.ConnectError as exc:
        logger.error("authkey_sms POST connect error url=%s: %s", _POST_JSON_URL, exc)
        return False, None, "SMS gateway unreachable — check network/DNS"
    except httpx.RequestError as exc:
        logger.error("authkey_sms POST request error url=%s: %s", _POST_JSON_URL, exc)
        return False, None, f"SMS gateway request error: {exc}"
    data = resp.json() if resp.content else {}
    ok = resp.is_success and (_sms_submitted_ok(data) or resp.status_code == 200)
    if not ok:
        logger.warning("authkey_sms POST failed status=%s body=%s", resp.status_code, data)
        err = "SMS gateway rejected the request"
        if isinstance(data, dict):
            err = str(data.get("message") or data.get("error") or err)
        return False, data if isinstance(data, dict) else None, err
    return True, data if isinstance(data, dict) else None, None


async def _get_sid_request(params: Dict[str, str]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """GET https://api.authkey.io/request?authkey=…&mobile=…&country_code=…&sid=…&otp=…"""
    q = {"authkey": _api_key(), **params}
    url = f"{_GET_REQUEST_URL}?{urlencode(q)}"
    safe_q = {**q, "authkey": "***"}
    if "otp" in safe_q:
        safe_q["otp"] = "******"
    logger.info("authkey_sms GET %s params=%s", _GET_REQUEST_URL, safe_q)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEC) as client:
            resp = await client.get(url)
    except httpx.TimeoutException as exc:
        logger.error("authkey_sms GET timeout url=%s: %s", _GET_REQUEST_URL, exc)
        return False, None, "SMS gateway timed out"
    except httpx.ConnectError as exc:
        logger.error("authkey_sms GET connect error url=%s: %s", _GET_REQUEST_URL, exc)
        return False, None, "SMS gateway unreachable — check network/DNS"
    except httpx.RequestError as exc:
        logger.error("authkey_sms GET request error url=%s: %s", _GET_REQUEST_URL, exc)
        return False, None, f"SMS gateway request error: {exc}"
    try:
        data = resp.json() if resp.content else {}
    except Exception:  # noqa: BLE001
        data = {"text": resp.text}
    ok = resp.is_success and (_sms_submitted_ok(data) or resp.status_code == 200)
    if not ok:
        logger.warning("authkey_sms GET failed status=%s body=%s", resp.status_code, data)
        return False, data if isinstance(data, dict) else None, "SMS gateway rejected the GET request"
    return True, data if isinstance(data, dict) else None, None


async def _send_managed_2fa(*, cc: str, nat: str) -> SmsSendResult:
    """
    AuthKey generates OTP ({#2fa#} in template). Returns LogID for 2fa_verify.php.
    Not used for dual email+SMS signup (local OTP mode).
    """
    params = {
        "authkey": _api_key(),
        "mobile": nat,
        "country_code": cc,
        "sid": _sid(),
    }
    url = f"{_2FA_REQUEST_URL}?{urlencode(params)}"
    logger.info("authkey_sms 2FA GET %s (sid=%s mobile=***%s)", _2FA_REQUEST_URL, _sid(), nat[-4:])
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEC) as client:
            resp = await client.get(url)
        data = resp.json() if resp.content else {}
        log_id = _extract_log_id(data)
        ok = resp.is_success and log_id is not None
        if not ok:
            return SmsSendResult(
                ok=False,
                raw=data if isinstance(data, dict) else None,
                error="AuthKey 2FA request did not return LogID",
            )
        return SmsSendResult(ok=True, log_id=log_id, raw=data if isinstance(data, dict) else None, managed_otp=True)
    except Exception as exc:  # noqa: BLE001
        logger.exception("authkey_sms 2FA request error")
        return SmsSendResult(ok=False, error=str(exc))


async def send_signup_otp(
    *,
    mobile: str,
    country_code: Optional[str] = None,
    otp: Optional[str] = None,
    name: Optional[str] = None,
    mode_override: Optional[str] = None,
) -> SmsSendResult:
    """
    Send signup OTP SMS.

    Default (local): POST SID with our OTP in template param `otp`.
    managed_2fa: AuthKey generates OTP; store returned log_id and call verify_managed_otp().
    """
    if not configured():
        return SmsSendResult(ok=False, error="AuthKey SMS is not configured")

    mode = (mode_override or _otp_mode()).strip().lower()
    cc, nat = normalize_mobile(mobile, country_code)

    if mode == "managed_2fa":
        return await _send_managed_2fa(cc=cc, nat=nat)

    if not otp or not str(otp).strip():
        return SmsSendResult(ok=False, error="OTP value required for local template mode")

    body = build_request_payload(
        mobile=nat,
        otp=str(otp).strip(),
        country_code=cc,
        name=name,
    )

    ok, data, err = await _post_sid_json(body)
    if ok:
        return SmsSendResult(
            ok=True,
            log_id=_extract_log_id(data),
            raw=data,
        )

    if _env_bool("AUTHKEY_SMS_USE_GET_FALLBACK"):
        get_params = {k: v for k, v in body.items() if k != "authkey"}
        get_params["authkey"] = _api_key()
        ok2, data2, err2 = await _get_sid_request(get_params)
        if ok2:
            return SmsSendResult(ok=True, log_id=_extract_log_id(data2), raw=data2)

    return SmsSendResult(ok=False, raw=data, error=err or "SMS send failed")


async def verify_managed_otp(
    *,
    log_id: str,
    otp: str,
    channel: str = "SMS",
) -> bool:
    """
    Verify OTP when AUTHKEY_SMS_OTP_MODE=managed_2fa.
    https://console.authkey.io/api/2fa_verify.php?authkey=…&channel=SMS&otp=…&logid=…
    """
    key = _api_key()
    lid = (log_id or "").strip()
    code = (otp or "").strip()
    if not key or not lid or not code:
        return False
    params = {
        "authkey": key,
        "channel": (channel or "SMS").upper(),
        "otp": code,
        "logid": lid,
    }
    url = f"{_2FA_VERIFY_URL}?{urlencode(params)}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEC) as client:
            resp = await client.get(url)
        data = resp.json() if resp.content else {}
        if isinstance(data, dict) and data.get("status") is True:
            return True
        if isinstance(data, dict) and str(data.get("message", "")).lower().find("valid") >= 0:
            return True
        logger.warning("authkey_sms 2FA verify failed: %s", data)
        return False
    except Exception:  # noqa: BLE001
        logger.exception("authkey_sms 2FA verify error")
        return False
