"""INR fiat withdrawal — eligibility, IBO lock on submit, admin approve/reject."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument

from inr.constants import (
    COL_DEPOSITS,
    COL_WITHDRAWALS,
    MIN_WITHDRAWAL_INR,
    METHOD_BANK,
    METHOD_UPI,
    STATUS_APPROVED,
    STATUS_APPROVING,
    STATUS_PENDING,
    STATUS_REJECTED,
)
from inr import payout_profile_service
from inr.models import validate_details_for_type
from inr.service import (
    _db,
    _new_id,
    _now_iso,
    ibo_amount_from_inr,
    resolve_inr_ibo_rate,
)
from services import email_service, wallet_service
from services.wallet_service import InsufficientFundsError

logger = logging.getLogger(__name__)

_ACTIVE_WITHDRAWAL_STATUSES = (STATUS_PENDING, STATUS_APPROVING)

# Must match wallet_service lock guard tolerance.
_IBO_LOCK_EPS = 1e-10


def _max_inr_for_available_ibo(ibo_available: float, ibo_per_inr: float) -> float:
    """Largest INR (2 dp) whose rounded IBO reservation fits in ``ibo_available``."""
    if ibo_per_inr <= 0 or ibo_available <= _IBO_LOCK_EPS:
        return 0.0
    inr = round(float(ibo_available) / float(ibo_per_inr), 2)
    while inr > 0:
        need_ibo = ibo_amount_from_inr(inr, ibo_per_inr)
        if need_ibo <= ibo_available + _IBO_LOCK_EPS:
            return inr
        inr = round(inr - 0.01, 2)
    return 0.0


def _withdrawal_out(doc: Dict[str, Any], *, include_user: bool = False) -> Dict[str, Any]:
    out = {
        "id": doc.get("id"),
        "uid": doc.get("uid"),
        "amount_inr": doc.get("amount_inr"),
        "amount_ibo": doc.get("amount_ibo"),
        "inr_rate_at_time": doc.get("inr_rate_at_time"),
        "ibo_usdt_at_time": doc.get("ibo_usdt_at_time"),
        "inr_per_usdt_at_time": doc.get("inr_per_usdt_at_time"),
        "payout_type": doc.get("payout_type"),
        "payout_details": doc.get("payout_details") or {},
        "payout_label": doc.get("payout_label"),
        "status": doc.get("status"),
        "rejection_reason": doc.get("rejection_reason"),
        "payout_reference": doc.get("payout_reference"),
        "reviewed_by": doc.get("reviewed_by"),
        "reviewed_at": doc.get("reviewed_at"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }
    if include_user:
        out["user_email"] = doc.get("user_email")
        out["user_name"] = doc.get("user_name")
    return out


def _withdrawal_out_user(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = _withdrawal_out(doc)
    if out.get("status") != STATUS_APPROVED:
        out["amount_ibo"] = None
        out["inr_rate_at_time"] = None
        out["ibo_usdt_at_time"] = None
        out["inr_per_usdt_at_time"] = None
    return out


def _payout_label(payout_type: str, details: Dict[str, Any]) -> str:
    if payout_type == METHOD_BANK:
        acct = str(details.get("account_number") or "")
        tail = acct[-4:] if len(acct) >= 4 else acct
        holder = (details.get("account_holder_name") or "").strip()
        bank = (details.get("bank_name") or "Bank").strip()
        if holder:
            return f"{bank} · {holder}" + (f" · ••••{tail}" if tail else "")
        return f"{bank}" + (f" · ••••{tail}" if tail else "")
    if payout_type == METHOD_UPI:
        return details.get("display_name") or details.get("upi_id") or "UPI"
    return payout_type or "Payout"


async def user_has_approved_inr_deposit(uid: str) -> bool:
    db = _db()
    if db is None:
        return False
    doc = await db[COL_DEPOSITS].find_one(
        {"uid": uid, "status": STATUS_APPROVED},
        {"_id": 1},
    )
    return doc is not None


async def _inr_flow_totals(uid: str) -> Dict[str, float]:
    db = _db()
    if db is None:
        return {
            "approved_deposit_inr": 0.0,
            "approved_withdrawal_inr": 0.0,
            "pending_withdrawal_inr": 0.0,
        }
    dep_pipe = [
        {"$match": {"uid": uid, "status": STATUS_APPROVED}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_inr"}}},
    ]
    wd_approved_pipe = [
        {"$match": {"uid": uid, "status": STATUS_APPROVED}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_inr"}}},
    ]
    wd_pending_pipe = [
        {"$match": {"uid": uid, "status": {"$in": list(_ACTIVE_WITHDRAWAL_STATUSES)}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_inr"}}},
    ]
    dep = await db[COL_DEPOSITS].aggregate(dep_pipe).to_list(length=1)
    wd_a = await db[COL_WITHDRAWALS].aggregate(wd_approved_pipe).to_list(length=1)
    wd_p = await db[COL_WITHDRAWALS].aggregate(wd_pending_pipe).to_list(length=1)
    return {
        "approved_deposit_inr": float(dep[0]["total"]) if dep else 0.0,
        "approved_withdrawal_inr": float(wd_a[0]["total"]) if wd_a else 0.0,
        "pending_withdrawal_inr": float(wd_p[0]["total"]) if wd_p else 0.0,
    }


async def get_withdrawal_eligibility(uid: str) -> Dict[str, Any]:
    has_deposit = await user_has_approved_inr_deposit(uid)
    totals = await _inr_flow_totals(uid)
    inr_per_usdt, ibo_usdt, ibo_per_inr = await resolve_inr_ibo_rate()

    deposit_inr_limit = max(
        0.0,
        totals["approved_deposit_inr"]
        - totals["approved_withdrawal_inr"]
        - totals["pending_withdrawal_inr"],
    )

    ibo_available = 0.0
    try:
        bal = await wallet_service.read_balance(uid, "IBO")
        ibo_available = float(bal.get("available") or 0)
    except Exception:
        logger.exception("inr withdrawal eligibility: balance read failed uid=%s", uid)

    ibo_inr_cap = _max_inr_for_available_ibo(ibo_available, ibo_per_inr)
    max_withdrawal_inr = round(min(deposit_inr_limit, ibo_inr_cap), 2)
    min_ibo_needed = ibo_amount_from_inr(MIN_WITHDRAWAL_INR, ibo_per_inr)

    eligible = (
        has_deposit
        and deposit_inr_limit >= MIN_WITHDRAWAL_INR
        and max_withdrawal_inr >= MIN_WITHDRAWAL_INR
    )
    reason = None
    if not has_deposit:
        reason = (
            "INR withdrawal is only available after you have at least one "
            "approved INR deposit on your account."
        )
    elif deposit_inr_limit < MIN_WITHDRAWAL_INR:
        reason = (
            "No INR withdrawal limit remaining from your approved INR deposits, "
            "or the remaining limit is below the minimum."
        )
    elif ibo_available + _IBO_LOCK_EPS < min_ibo_needed:
        reason = (
            "Insufficient available IBO to sell for the minimum INR withdrawal. "
            "Cancel a pending INR payout, close open orders, or free locked IBO first."
        )
    elif max_withdrawal_inr < MIN_WITHDRAWAL_INR:
        reason = (
            "Your available IBO balance is too low for an INR withdrawal at the "
            "current rate, even though you may have INR deposit limit remaining."
        )

    payout_profile = await payout_profile_service.get_payout_profile(uid)

    return {
        "eligible": eligible,
        "reason": reason,
        "has_inr_deposit": has_deposit,
        "payout_profile": payout_profile,
        "min_withdrawal_inr": MIN_WITHDRAWAL_INR,
        "approved_deposit_inr_total": round(totals["approved_deposit_inr"], 2),
        "approved_withdrawal_inr_total": round(totals["approved_withdrawal_inr"], 2),
        "pending_withdrawal_inr_total": round(totals["pending_withdrawal_inr"], 2),
        "available_inr_limit": round(deposit_inr_limit, 2),
        "inr_limit_from_ibo_balance": round(ibo_inr_cap, 2),
        "max_withdrawal_inr": max_withdrawal_inr,
        "ibo_balance_available": round(ibo_available, 8),
        "inr_per_usdt": inr_per_usdt,
        "ibo_usdt": ibo_usdt,
        "ibo_per_inr": ibo_per_inr,
    }


async def count_pending_withdrawals() -> int:
    db = _db()
    if db is None:
        return 0
    return await db[COL_WITHDRAWALS].count_documents({"status": STATUS_PENDING})


async def create_withdrawal_request(
    uid: str,
    *,
    amount_inr: float,
    payout_type: str,
    payout_details: Optional[Dict[str, Any]] = None,
    save_payout_profile: bool = True,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    amount_inr = round(float(amount_inr), 2)
    if amount_inr < MIN_WITHDRAWAL_INR:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum INR withdrawal is ₹{MIN_WITHDRAWAL_INR:.0f}",
        )

    if not await user_has_approved_inr_deposit(uid):
        raise HTTPException(
            status_code=403,
            detail="INR withdrawal requires at least one approved INR deposit.",
        )

    eligibility = await get_withdrawal_eligibility(uid)
    max_inr = float(eligibility.get("max_withdrawal_inr") or 0)
    if amount_inr > max_inr + 0.01:
        deposit_cap = float(eligibility.get("available_inr_limit") or 0)
        ibo_cap = float(eligibility.get("inr_limit_from_ibo_balance") or 0)
        if ibo_cap + 0.01 < deposit_cap:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Amount exceeds what your available IBO can sell at the current rate "
                    f"(max ₹{ibo_cap:,.2f}; deposit limit ₹{deposit_cap:,.2f})."
                ),
            )
        raise HTTPException(
            status_code=400,
            detail=(
                f"Amount exceeds your INR withdrawal limit "
                f"(₹{deposit_cap:,.2f} remaining)."
            ),
        )

    pending = await db[COL_WITHDRAWALS].find_one(
        {"uid": uid, "status": {"$in": list(_ACTIVE_WITHDRAWAL_STATUSES)}},
    )
    if pending:
        raise HTTPException(
            status_code=409,
            detail="You already have a pending INR withdrawal. Wait for review or contact support.",
        )

    if payout_type not in (METHOD_BANK, METHOD_UPI):
        raise HTTPException(status_code=400, detail="payout_type must be bank or upi")
    validated = await payout_profile_service.resolve_payout_details(
        uid, payout_type, payout_details
    )
    if save_payout_profile:
        await payout_profile_service.save_payout_profile(uid, payout_type, validated)

    inr_per_usdt, ibo_usdt, ibo_per_inr = await resolve_inr_ibo_rate()
    amount_ibo = ibo_amount_from_inr(amount_inr, ibo_per_inr)
    if amount_ibo <= 0:
        raise HTTPException(status_code=400, detail="Could not compute IBO amount")

    try:
        bal = await wallet_service.read_balance(uid, "IBO")
        ibo_available = float(bal.get("available") or 0)
    except Exception:
        logger.exception("inr withdrawal balance read failed uid=%s", uid)
        raise HTTPException(status_code=503, detail="Could not read IBO balance") from None
    if amount_ibo > ibo_available + _IBO_LOCK_EPS:
        max_inr = _max_inr_for_available_ibo(ibo_available, ibo_per_inr)
        raise HTTPException(
            status_code=400,
            detail=(
                "Insufficient available IBO to sell for this INR amount. "
                f"At the current rate you can withdraw up to ₹{max_inr:,.2f} "
                f"({ibo_available:.8f} IBO available)."
            ),
        )

    now = _now_iso()
    withdrawal_id = _new_id("inrw")
    doc = {
        "id": withdrawal_id,
        "uid": uid,
        "amount_inr": amount_inr,
        "amount_ibo": amount_ibo,
        "inr_rate_at_time": ibo_per_inr,
        "ibo_usdt_at_time": ibo_usdt,
        "inr_per_usdt_at_time": inr_per_usdt,
        "payout_type": payout_type,
        "payout_details": validated,
        "payout_label": _payout_label(payout_type, validated),
        "status": STATUS_PENDING,
        "rejection_reason": None,
        "payout_reference": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "created_at": now,
        "updated_at": now,
    }

    try:
        await wallet_service.lock(
            uid,
            "IBO",
            amount_ibo,
            ref_type="inr_withdrawal",
            ref_id=withdrawal_id,
            meta={
                "amount_inr": amount_inr,
                "payout_type": payout_type,
                "ledger_kind": "inr_sell",
            },
        )
    except InsufficientFundsError:
        raise HTTPException(
            status_code=400,
            detail="Insufficient IBO balance to sell for this INR amount.",
        ) from None
    except Exception:
        logger.exception("inr withdrawal lock failed uid=%s", uid)
        raise HTTPException(status_code=500, detail="Could not reserve IBO balance")

    try:
        await db[COL_WITHDRAWALS].insert_one(doc)
    except Exception:
        try:
            await wallet_service.unlock(
                uid,
                "IBO",
                amount_ibo,
                ref_type="inr_withdrawal",
                ref_id=withdrawal_id,
                meta={"rollback": "insert_failed"},
            )
        except Exception:
            logger.exception("inr withdrawal rollback unlock failed %s", withdrawal_id)
        raise HTTPException(status_code=500, detail="Could not save withdrawal request")

    await _notify_user_withdrawal_submitted(doc)
    return _withdrawal_out(doc)


async def list_user_withdrawals(uid: str, *, skip: int = 0, limit: int = 50) -> Dict[str, Any]:
    db = _db()
    if db is None:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    q = {"uid": uid}
    total = await db[COL_WITHDRAWALS].count_documents(q)
    cur = (
        db[COL_WITHDRAWALS]
        .find(q, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    items = [_withdrawal_out_user(r) for r in await cur.to_list(length=limit)]
    return {"items": items, "total": total, "skip": skip, "limit": limit}


async def cancel_user_withdrawal(withdrawal_id: str, uid: str) -> Dict[str, Any]:
    """Allow user to cancel their own pending INR withdrawal request."""
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    now = _now_iso()
    reserved = await db[COL_WITHDRAWALS].find_one_and_update(
        {"id": withdrawal_id, "uid": uid, "status": STATUS_PENDING},
        {
            "$set": {
                "status": STATUS_REJECTED,
                "rejection_reason": "Cancelled by user",
                "reviewed_by": uid,
                "reviewed_at": now,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.BEFORE,
    )
    if reserved is None:
        raise HTTPException(
            status_code=409,
            detail="Withdrawal cannot be cancelled (already processing or completed).",
        )

    amount_ibo = float(reserved.get("amount_ibo") or 0)
    if amount_ibo > 0:
        try:
            await wallet_service.unlock(
                uid,
                "IBO",
                amount_ibo,
                ref_type="inr_withdrawal",
                ref_id=withdrawal_id,
                meta={
                    "reason": "Cancelled by user",
                    "amount_inr": reserved.get("amount_inr"),
                    "ledger_kind": "inr_sell_cancel",
                },
            )
        except Exception:
            logger.exception("inr cancel: unlock failed %s", withdrawal_id)
            await db[COL_WITHDRAWALS].update_one(
                {"id": withdrawal_id, "uid": uid},
                {"$set": {"status": STATUS_PENDING, "updated_at": _now_iso()}},
            )
            raise HTTPException(status_code=500, detail="Could not cancel INR sell reservation")

    doc = await db[COL_WITHDRAWALS].find_one({"id": withdrawal_id, "uid": uid}, {"_id": 0})
    return _withdrawal_out_user(doc or reserved)


async def list_admin_withdrawals(
    *,
    uid: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    q: Dict[str, Any] = {}
    if uid:
        q["uid"] = uid.strip()
    if status:
        status_norm = status.strip().lower()
        if status_norm == "cancelled":
            # "Cancelled" is represented as rejected + explicit user-cancel reason.
            q["status"] = STATUS_REJECTED
            q["rejection_reason"] = {"$regex": r"^\s*cancelled by user\s*$", "$options": "i"}
        elif status_norm == STATUS_REJECTED:
            # "Rejected" filter should exclude user-cancelled rows.
            q["status"] = STATUS_REJECTED
            q["$or"] = [
                {"rejection_reason": {"$exists": False}},
                {"rejection_reason": None},
                {"rejection_reason": ""},
                {"rejection_reason": {"$not": {"$regex": r"^\s*cancelled by user\s*$", "$options": "i"}}},
            ]
        else:
            q["status"] = status_norm
    total = await db[COL_WITHDRAWALS].count_documents(q)
    pipeline = [
        {"$match": q},
        {"$sort": {"created_at": -1}},
        {"$skip": skip},
        {"$limit": limit},
        {
            "$lookup": {
                "from": "users",
                "localField": "uid",
                "foreignField": "uid",
                "as": "user",
            }
        },
        {"$unwind": {"path": "$user", "preserveNullAndEmptyArrays": True}},
        {
            "$project": {
                "_id": 0,
                "id": 1,
                "uid": 1,
                "amount_inr": 1,
                "amount_ibo": 1,
                "inr_rate_at_time": 1,
                "ibo_usdt_at_time": 1,
                "inr_per_usdt_at_time": 1,
                "payout_type": 1,
                "payout_details": 1,
                "payout_label": 1,
                "status": 1,
                "rejection_reason": 1,
                "payout_reference": 1,
                "reviewed_by": 1,
                "reviewed_at": 1,
                "created_at": 1,
                "updated_at": 1,
                "user_email": "$user.email",
                "user_name": "$user.name",
            }
        },
    ]
    rows = await db[COL_WITHDRAWALS].aggregate(pipeline).to_list(length=limit)
    inr_per_usdt, ibo_usdt, ibo_per_inr = await resolve_inr_ibo_rate()
    items = [_withdrawal_out(r, include_user=True) for r in rows]
    return {
        "items": items,
        "total": total,
        "skip": skip,
        "limit": limit,
        "rate": {
            "inr_per_usdt": inr_per_usdt,
            "ibo_usdt": ibo_usdt,
            "ibo_per_inr": ibo_per_inr,
        },
    }


async def approve_withdrawal(
    withdrawal_id: str,
    admin_id: str,
    *,
    note: Optional[str] = None,
    payout_reference: Optional[str] = None,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    reserved = await db[COL_WITHDRAWALS].find_one_and_update(
        {"id": withdrawal_id, "status": STATUS_PENDING},
        {"$set": {"status": STATUS_APPROVING, "updated_at": _now_iso()}},
        return_document=ReturnDocument.BEFORE,
    )
    if reserved is None:
        raise HTTPException(
            status_code=409,
            detail="Withdrawal is not pending or was already processed",
        )

    uid = reserved.get("uid")
    amount_ibo = float(reserved.get("amount_ibo") or 0)
    if not uid or amount_ibo <= 0:
        await db[COL_WITHDRAWALS].update_one(
            {"id": withdrawal_id, "status": STATUS_APPROVING},
            {"$set": {"status": STATUS_PENDING, "updated_at": _now_iso()}},
        )
        raise HTTPException(status_code=400, detail="Invalid withdrawal row")

    payout_ref = (payout_reference or "").strip() or None

    try:
        await wallet_service.debit_locked(
            uid,
            "IBO",
            amount_ibo,
            txn_type="withdraw",
            ref_type="inr_withdrawal",
            ref_id=withdrawal_id,
            meta={
                "amount_inr": reserved.get("amount_inr"),
                "payout_type": reserved.get("payout_type"),
                "admin_note": note,
                "payout_reference": payout_ref,
                "ledger_kind": "inr_payout",
            },
        )
    except Exception:
        logger.exception("inr approve: debit_locked failed %s", withdrawal_id)
        await db[COL_WITHDRAWALS].update_one(
            {"id": withdrawal_id, "status": STATUS_APPROVING},
            {"$set": {"status": STATUS_PENDING, "updated_at": _now_iso()}},
        )
        raise HTTPException(status_code=500, detail="Could not complete INR payout (IBO sale)")

    now = _now_iso()
    updated = await db[COL_WITHDRAWALS].find_one_and_update(
        {"id": withdrawal_id, "status": STATUS_APPROVING},
        {
            "$set": {
                "status": STATUS_APPROVED,
                "reviewed_by": admin_id,
                "reviewed_at": now,
                "updated_at": now,
                "admin_approve_note": note,
                "payout_reference": payout_ref,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated:
        await _notify_user_withdrawal(updated, approved=True)
    return _withdrawal_out(updated or reserved)


async def reject_withdrawal(
    withdrawal_id: str,
    admin_id: str,
    reason: str,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Rejection reason is required")

    reserved = await db[COL_WITHDRAWALS].find_one_and_update(
        {"id": withdrawal_id, "status": STATUS_PENDING},
        {
            "$set": {
                "status": STATUS_REJECTED,
                "rejection_reason": reason,
                "reviewed_by": admin_id,
                "reviewed_at": _now_iso(),
                "updated_at": _now_iso(),
            }
        },
        return_document=ReturnDocument.BEFORE,
    )
    if reserved is None:
        raise HTTPException(
            status_code=409,
            detail="Withdrawal is not pending or was already processed",
        )

    uid = reserved.get("uid")
    amount_ibo = float(reserved.get("amount_ibo") or 0)
    if uid and amount_ibo > 0:
        try:
            await wallet_service.unlock(
                uid,
                "IBO",
                amount_ibo,
                ref_type="inr_withdrawal",
                ref_id=withdrawal_id,
                meta={
                    "reason": reason,
                    "amount_inr": reserved.get("amount_inr"),
                    "ledger_kind": "inr_sell_cancel",
                },
            )
        except Exception:
            logger.exception("inr reject: unlock failed %s", withdrawal_id)
            await db[COL_WITHDRAWALS].update_one(
                {"id": withdrawal_id},
                {"$set": {"status": STATUS_PENDING, "updated_at": _now_iso()}},
            )
            raise HTTPException(status_code=500, detail="Could not cancel INR sell reservation")

    doc = await db[COL_WITHDRAWALS].find_one({"id": withdrawal_id}, {"_id": 0})
    if doc:
        await _notify_user_withdrawal(doc, approved=False)
    return _withdrawal_out(doc or reserved)


async def _notify_user_withdrawal_submitted(doc: Dict[str, Any]) -> None:
    db = _db()
    if db is None:
        return
    uid = doc.get("uid")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "email": 1, "name": 1})
    if not user or not user.get("email"):
        return
    try:
        from services import email_templates

        subject, html, text = email_templates.inr_withdrawal_submitted(
            user.get("name") or "Trader",
            float(doc.get("amount_inr") or 0),
            float(doc.get("amount_ibo") or 0),
            doc.get("id") or "",
        )
        await email_service.send_email(user["email"], subject, html, text)
    except Exception:
        logger.exception("inr withdrawal submitted email failed uid=%s", uid)


async def _notify_user_withdrawal(doc: Dict[str, Any], *, approved: bool) -> None:
    db = _db()
    if db is None:
        return
    uid = doc.get("uid")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "email": 1, "name": 1})
    if not user or not user.get("email"):
        return
    try:
        from services import email_templates

        if approved:
            subject, html, text = email_templates.inr_withdrawal_approved(
                user.get("name") or "Trader",
                float(doc.get("amount_inr") or 0),
                doc.get("payout_reference") or "",
            )
        else:
            subject, html, text = email_templates.inr_withdrawal_rejected(
                user.get("name") or "Trader",
                float(doc.get("amount_inr") or 0),
                doc.get("rejection_reason") or "Rejected by admin",
            )
        await email_service.send_email(user["email"], subject, html, text)
    except Exception:
        logger.exception("inr withdrawal notification email failed uid=%s", uid)
