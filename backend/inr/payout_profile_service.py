"""Saved bank / UPI payout details per user for INR withdrawals."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from pydantic import ValidationError

from inr.constants import COL_PAYOUT_PROFILES, METHOD_BANK, METHOD_UPI
from inr.models import validate_details_for_type
from services.bank_verification import verify_bank_or_raise


def _db():
    from server import db

    return db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask_account_number(acct: str) -> str:
    s = (acct or "").strip()
    if len(s) <= 4:
        return s
    return f"••••{s[-4:]}"


def _profile_out(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not doc:
        return {"bank": None, "upi": None, "has_bank": False, "has_upi": False}
    bank = doc.get("bank")
    upi = doc.get("upi")
    bank_out = None
    upi_out = None
    if isinstance(bank, dict) and bank.get("account_number"):
        bank_out = dict(bank)
        bank_out["account_number_masked"] = _mask_account_number(bank.get("account_number"))
        bank_out.setdefault("bank_verified", False)
        bank_out.setdefault("verified_account_name", None)
    if isinstance(upi, dict) and upi.get("upi_id"):
        upi_out = dict(upi)
    return {
        "bank": bank_out,
        "upi": upi_out,
        "has_bank": bank_out is not None,
        "has_upi": upi_out is not None,
        "updated_at": doc.get("updated_at"),
    }


async def get_payout_profile(uid: str) -> Dict[str, Any]:
    db = _db()
    if db is None:
        return _profile_out(None)
    doc = await db[COL_PAYOUT_PROFILES].find_one({"uid": uid}, {"_id": 0})
    return _profile_out(doc)


async def save_payout_profile(
    uid: str,
    payout_type: str,
    payout_details: Dict[str, Any],
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if payout_type not in (METHOD_BANK, METHOD_UPI):
        raise HTTPException(status_code=400, detail="payout_type must be bank or upi")
    if not isinstance(payout_details, dict) or not payout_details:
        raise HTTPException(status_code=400, detail="payout_details is required")
    try:
        validated = validate_details_for_type(payout_type, payout_details)
    except ValidationError as exc:
        msgs = [e.get("msg", str(e)) for e in exc.errors()]
        raise HTTPException(status_code=400, detail=" ".join(msgs) or "Invalid payout details") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Verify bank account via Signzy before persisting
    if payout_type == METHOD_BANK:
        verification = await verify_bank_or_raise(
            account_number=validated["account_number"],
            ifsc=validated["ifsc_code"],
            holder_name=validated.get("account_holder_name") or None,
        )
        validated["bank_verified"] = verification.active
        validated["verified_account_name"] = verification.account_holder_name
    else:
        validated["bank_verified"] = False
        validated["verified_account_name"] = None

    field = "bank" if payout_type == METHOD_BANK else "upi"
    now = _now_iso()
    await db[COL_PAYOUT_PROFILES].update_one(
        {"uid": uid},
        {
            "$set": {field: validated, "updated_at": now},
            "$setOnInsert": {"uid": uid},
        },
        upsert=True,
    )
    return await get_payout_profile(uid)


async def delete_payout_profile(
    uid: str,
    payout_type: str,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if payout_type not in (METHOD_BANK, METHOD_UPI):
        raise HTTPException(status_code=400, detail="payout_type must be bank or upi")

    field = "bank" if payout_type == METHOD_BANK else "upi"
    now = _now_iso()
    await db[COL_PAYOUT_PROFILES].update_one(
        {"uid": uid},
        {"$unset": {field: ""}, "$set": {"updated_at": now}},
        upsert=False,
    )

    doc = await db[COL_PAYOUT_PROFILES].find_one({"uid": uid}, {"_id": 0})
    if doc and not doc.get("bank") and not doc.get("upi"):
        await db[COL_PAYOUT_PROFILES].delete_one({"uid": uid})

    return await get_payout_profile(uid)


_BANK_INTERNAL_FIELDS = {"bank_verified", "verified_account_name", "account_number_masked"}


def _strip_internal(details: Dict[str, Any]) -> Dict[str, Any]:
    """Remove internal metadata fields before passing to Pydantic validators."""
    return {k: v for k, v in details.items() if k not in _BANK_INTERNAL_FIELDS}


async def resolve_payout_details(
    uid: str,
    payout_type: str,
    payout_details: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Use request body details when provided; otherwise load saved profile."""
    if payout_details and isinstance(payout_details, dict) and len(payout_details) > 0:
        return validate_details_for_type(payout_type, _strip_internal(payout_details))
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    doc = await db[COL_PAYOUT_PROFILES].find_one({"uid": uid}, {"_id": 0})
    key = "bank" if payout_type == METHOD_BANK else "upi"
    saved = doc.get(key) if doc else None
    if not saved:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No saved {payout_type} payout details. "
                "Add your bank or UPI details once, then you can withdraw without re-entering them."
            ),
        )
    return validate_details_for_type(payout_type, _strip_internal(saved))
