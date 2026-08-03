"""Signzy Hybrid Bank Account Verification integration.

Verifies Indian bank account details (account number + IFSC) by calling
the Signzy API.  Returns the account holder's registered name on success.

Configuration (backend/.env):
    SIGNZY_API_KEY         Authorization token from Signzy support
    SIGNZY_ENV             "production" or "preproduction" (default: preproduction)
    SIGNZY_VERIFY_REQUIRED "true" / "false"  (default: true)
                           When false, a Signzy outage will NOT block the user
                           from saving bank details — the account is saved as
                           unverified instead of raising a 503.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

_PROD_URL  = "https://api.signzy.app/api/v3/bankaccountverification/bankaccountverifications"
_PRE_URL   = "https://api-preproduction.signzy.app/api/v3/bankaccountverification/bankaccountverifications"
_TIMEOUT   = 30.0   # seconds


def _api_key() -> str:
    return (os.getenv("SIGNZY_API_KEY") or "").strip()


def _endpoint() -> str:
    env = (os.getenv("SIGNZY_ENV") or "preproduction").strip().lower()
    return _PROD_URL if env == "production" else _PRE_URL


def _verify_required() -> bool:
    v = (os.getenv("SIGNZY_VERIFY_REQUIRED") or "true").strip().lower()
    return v not in ("false", "0", "no")


def signzy_configured() -> bool:
    """Return True if the Signzy API key is present in the environment."""
    return bool(_api_key())


# ── Result dataclass ──────────────────────────────────────────────────────────


@dataclass
class BankVerificationResult:
    active: bool
    """True when the bank responded that the account is active and reachable."""

    reason: str
    """Human-readable outcome from Signzy ('success' or an error description)."""

    account_holder_name: Optional[str]
    """Name registered on the account, as returned by the bank (may be None)."""

    signzy_reference_id: Optional[str]
    """Signzy's internal reference for audit / support."""

    name_match: Optional[str]
    """'yes' / 'no' / 'not available' when beneficiaryName was passed."""

    name_match_score: Optional[str]
    """Numeric string 0–1 when name matching was requested, else 'not available'."""


# ── Core function ─────────────────────────────────────────────────────────────


async def verify_bank_account(
    account_number: str,
    ifsc: str,
    holder_name: Optional[str] = None,
    mobile: Optional[str] = None,
) -> BankVerificationResult:
    """Call the Signzy API and parse the result.

    Raises:
        httpx.HTTPStatusError: on 4xx/5xx from Signzy.
        httpx.TimeoutException:  if Signzy takes > 30 s.
        RuntimeError: if SIGNZY_API_KEY is not configured.
    """
    key = _api_key()
    if not key:
        raise RuntimeError(
            "SIGNZY_API_KEY is not set in the environment. "
            "Add it to backend/.env to enable bank account verification."
        )

    payload: dict = {
        "beneficiaryAccount": account_number.strip(),
        "beneficiaryIFSC":    ifsc.strip().upper(),
        "beneficiaryMobile":  (mobile or "").strip(),
    }
    if holder_name:
        payload["beneficiaryName"]   = holder_name.strip()
        payload["nameFuzzy"]         = "true"
        payload["nameMatchScore"]    = "0.7"

    headers = {
        "Content-Type":  "application/json",
        "Authorization": key,
    }

    # Log the outgoing request (mask the auth token for security)
    log_payload = {k: v for k, v in payload.items()}
    logger.info(
        "[Signzy] REQUEST  endpoint=%s payload=%s",
        _endpoint(),
        log_payload,
    )

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(_endpoint(), json=payload, headers=headers)
        raw_response = resp.text

        logger.info(
            "[Signzy] RESPONSE status=%s body=%s",
            resp.status_code,
            raw_response,
        )

        resp.raise_for_status()
        data = resp.json()

    result = data.get("result", {})
    bank_transfer = result.get("bankTransfer", {})

    bene_name = (
        (bank_transfer.get("beneName") or "").strip()
        or None
    )

    return BankVerificationResult(
        active              = (result.get("active") or "").lower() == "yes",
        reason              = result.get("reason") or "unknown",
        account_holder_name = bene_name,
        signzy_reference_id = result.get("signzyReferenceId"),
        name_match          = result.get("nameMatch"),
        name_match_score    = result.get("nameMatchScore"),
    )


# ── Higher-level helper used by route handlers ────────────────────────────────


async def _get_bank_verify_mode() -> str:
    """Return the current bank_verify_mode from platform controls (cached by MongoDB read).

    Returns "auto" | "manual" | "disabled".  Falls back to "auto" on any error.
    """
    try:
        from server import get_platform_controls  # lazy import to avoid circular deps
        controls = await get_platform_controls()
        return (controls.get("bank_verify_mode") or "auto").lower()
    except Exception:  # noqa: BLE001
        return "auto"


async def verify_bank_or_raise(
    account_number: str,
    ifsc: str,
    holder_name: Optional[str] = None,
    mobile: Optional[str] = None,
) -> BankVerificationResult:
    """Verify a bank account and raise ``HTTPException`` on failure.

    Respects the platform ``bank_verify_mode`` setting:
      * "auto"     — call Signzy; block if account is inactive.
      * "manual"   — skip Signzy; save as unverified (admin reviews later).
      * "disabled" — skip Signzy entirely; save without any verification flag.

    * If Signzy is not configured → behaviour depends on ``SIGNZY_VERIFY_REQUIRED``.
    * If the account is inactive / invalid → always raises 400 regardless of the flag.
    * If Signzy itself fails (network / 5xx) → raises 503 when required, or logs and
      returns a soft result when verification is optional.
    """
    from fastapi import HTTPException

    mode = await _get_bank_verify_mode()

    if mode == "manual":
        logger.info(
            "[BankVerify] Skipping Signzy — bank_verify_mode=manual account=****%s ifsc=%s",
            account_number[-4:] if len(account_number) > 4 else "****",
            ifsc,
        )
        return BankVerificationResult(
            active=False,
            reason="manual_review",
            account_holder_name=None,
            signzy_reference_id=None,
            name_match=None,
            name_match_score=None,
        )

    if mode == "disabled":
        logger.info(
            "[BankVerify] Skipping Signzy — bank_verify_mode=disabled account=****%s ifsc=%s",
            account_number[-4:] if len(account_number) > 4 else "****",
            ifsc,
        )
        return BankVerificationResult(
            active=False,
            reason="verification_disabled",
            account_holder_name=None,
            signzy_reference_id=None,
            name_match=None,
            name_match_score=None,
        )

    if not signzy_configured():
        if _verify_required():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Bank account verification is not configured. "
                    "Please contact support."
                ),
            )
        logger.warning(
            "Bank verification skipped — SIGNZY_API_KEY not set "
            "(SIGNZY_VERIFY_REQUIRED=false, saving as unverified)"
        )
        return BankVerificationResult(
            active=False,
            reason="signzy_not_configured",
            account_holder_name=None,
            signzy_reference_id=None,
            name_match=None,
            name_match_score=None,
        )

    try:
        result = await verify_bank_account(account_number, ifsc, holder_name, mobile)
    except httpx.TimeoutException:
        msg = "Bank verification service timed out. Please try again."
        logger.error(
            "[Signzy] TIMEOUT account=****%s ifsc=%s",
            account_number[-4:] if len(account_number) > 4 else "****",
            ifsc,
        )
        if _verify_required():
            raise HTTPException(status_code=503, detail=msg)
        logger.warning("[Signzy] Saving as unverified (SIGNZY_VERIFY_REQUIRED=false)")
        return BankVerificationResult(
            active=False,
            reason="timeout",
            account_holder_name=None,
            signzy_reference_id=None,
            name_match=None,
            name_match_score=None,
        )
    except httpx.HTTPStatusError as exc:
        msg = f"Bank verification service error ({exc.response.status_code})."
        logger.error(
            "[Signzy] HTTP_ERROR status=%s body=%s account=****%s ifsc=%s",
            exc.response.status_code,
            exc.response.text,
            account_number[-4:] if len(account_number) > 4 else "****",
            ifsc,
        )
        if _verify_required():
            raise HTTPException(status_code=503, detail=msg)
        logger.warning("[Signzy] Saving as unverified (SIGNZY_VERIFY_REQUIRED=false)")
        return BankVerificationResult(
            active=False,
            reason=f"http_error_{exc.response.status_code}",
            account_holder_name=None,
            signzy_reference_id=None,
            name_match=None,
            name_match_score=None,
        )
    except Exception as exc:
        msg = "Bank verification service unavailable. Please try again."
        logger.exception(
            "[Signzy] UNEXPECTED_ERROR account=****%s ifsc=%s error=%s",
            account_number[-4:] if len(account_number) > 4 else "****",
            ifsc,
            exc,
        )
        if _verify_required():
            raise HTTPException(status_code=503, detail=msg)
        logger.warning("[Signzy] Saving as unverified (SIGNZY_VERIFY_REQUIRED=false)")
        return BankVerificationResult(
            active=False,
            reason="unexpected_error",
            account_holder_name=None,
            signzy_reference_id=None,
            name_match=None,
            name_match_score=None,
        )

    if not result.active:
        logger.warning(
            "[Signzy] ACCOUNT_INACTIVE account=****%s ifsc=%s reason=%s ref=%s",
            account_number[-4:] if len(account_number) > 4 else "****",
            ifsc,
            result.reason,
            result.signzy_reference_id,
        )
        raise HTTPException(
            status_code=400,
            detail=(
                "Bank account verification failed: "
                f"{result.reason or 'Invalid account number or IFSC code'}. "
                "Please double-check your account number and IFSC code."
            ),
        )

    logger.info(
        "[Signzy] VERIFIED account=****%s ifsc=%s bene_name=%s ref=%s",
        account_number[-4:] if len(account_number) > 4 else "****",
        ifsc,
        result.account_holder_name,
        result.signzy_reference_id,
    )
    return result
