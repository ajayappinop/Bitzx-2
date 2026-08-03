"""SMS OTP delivery — AuthKey gateway or admin-controlled dev fixed code."""

from __future__ import annotations

import logging
import secrets
from typing import Any, Dict, Optional, Tuple

from services import authkey_sms

logger = logging.getLogger(__name__)

DEFAULT_DEV_OTP = "123456"


def random_otp() -> str:
    return str(secrets.randbelow(1_000_000)).zfill(6)


def dev_otp_enabled(controls: Optional[Dict[str, Any]]) -> bool:
    return bool((controls or {}).get("sms_dev_otp_enabled"))


def normalize_dev_otp_code(raw: Any) -> str:
    code = str(raw or DEFAULT_DEV_OTP).strip()
    if len(code) == 6 and code.isdigit():
        return code
    return DEFAULT_DEV_OTP


def dev_otp_code(controls: Optional[Dict[str, Any]]) -> str:
    return normalize_dev_otp_code((controls or {}).get("sms_dev_otp_code"))


def sms_available(controls: Optional[Dict[str, Any]]) -> bool:
    return dev_otp_enabled(controls) or authkey_sms.configured()


async def send_signup_sms_otp(
    *,
    controls: Dict[str, Any],
    mobile: str,
    country_code: Optional[str],
    name: str = "",
) -> Tuple[str, authkey_sms.SmsSendResult]:
    """Generate OTP and deliver via AuthKey, or use fixed dev code when enabled."""
    if dev_otp_enabled(controls):
        otp = dev_otp_code(controls)
        logger.warning(
            "sms_dev_otp_enabled: AuthKey skipped; fixed OTP used for mobile ending %s",
            str(mobile)[-4:],
        )
        return otp, authkey_sms.SmsSendResult(ok=True)

    otp = random_otp()
    result = await authkey_sms.send_signup_otp(
        mobile=mobile,
        country_code=country_code,
        otp=otp,
        name=name,
    )
    return otp, result
