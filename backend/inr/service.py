"""INR deposit business logic — rates, uploads, approve/reject."""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile
from pymongo import ReturnDocument

from inr.constants import (
    COL_DEPOSITS,
    COL_PAYMENT_METHODS,
    DEFAULT_IBO_USDT,
    DEFAULT_INR_PER_USDT,
    DEFAULT_MIN_DEPOSIT_INR,
    DEPOSIT_MODE_MANUAL,
    MAX_QR_BYTES,
    MAX_SCREENSHOT_BYTES,
    METHOD_QR,
    SCREENSHOT_MIME_EXT,
    STATUS_APPROVED,
    STATUS_APPROVING,
    STATUS_PENDING,
    STATUS_REJECTED,
    TERMINAL_STATUSES,
)
from inr.gateway_ops import gateway_fields_out
from inr.models import validate_details_for_type
from services import email_service, wallet_service

logger = logging.getLogger(__name__)

_deps: Dict[str, Any] = {}

# Short TTL so frequent admin rate polls don't hammer platform_controls.
_rate_cache_at: float = 0.0
_rate_cache_value: Optional[Tuple[float, float, float]] = None
_RATE_CACHE_TTL_SEC = 1.0


def register_inr_deps(**kwargs: Any) -> None:
    _deps.update(kwargs)


def _db():
    return _deps.get("db")


def _inr_dir() -> Path:
    return _deps["inr_upload_dir"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


async def _get_controls() -> Dict[str, Any]:
    fn = _deps.get("get_platform_controls")
    if fn:
        return await fn()
    return {}


async def resolve_inr_ibo_rate(
    controls: Optional[Dict[str, Any]] = None,
) -> Tuple[float, float, float]:
    """Return ``(inr_per_usdt, ibo_usdt, ibo_per_inr)`` — IBO credited per 1 INR."""
    global _rate_cache_at, _rate_cache_value
    if controls is None:
        now = time.monotonic()
        if (
            _rate_cache_value is not None
            and (now - _rate_cache_at) < _RATE_CACHE_TTL_SEC
        ):
            return _rate_cache_value

    ctrl = controls if controls is not None else await _get_controls()
    inr_per_usdt = float(ctrl.get("inr_per_usdt") or 0)
    if inr_per_usdt <= 0:
        env_val = (os.getenv("INR_PER_USDT") or "").strip()
        try:
            inr_per_usdt = float(env_val) if env_val else DEFAULT_INR_PER_USDT
        except ValueError:
            inr_per_usdt = DEFAULT_INR_PER_USDT
    ibo_usdt = float(ctrl.get("ibo_price_override") or DEFAULT_IBO_USDT)
    if ibo_usdt <= 0:
        ibo_usdt = DEFAULT_IBO_USDT
    ibo_per_inr = ibo_usdt / inr_per_usdt
    result = (inr_per_usdt, ibo_usdt, ibo_per_inr)
    if controls is None:
        _rate_cache_at = time.monotonic()
        _rate_cache_value = result
    return result


def ibo_amount_from_inr(amount_inr: float, ibo_per_inr: float) -> float:
    return round(float(amount_inr) * float(ibo_per_inr), 8)


async def resolve_min_deposit_inr(controls: Optional[Dict[str, Any]] = None) -> float:
    """Minimum INR per deposit from platform controls; 0 = no minimum."""
    ctrl = controls if controls is not None else await _get_controls()
    min_inr = float(ctrl.get("inr_min_deposit_inr") if ctrl.get("inr_min_deposit_inr") is not None else DEFAULT_MIN_DEPOSIT_INR)
    if min_inr < 0:
        min_inr = 0.0
    return round(min_inr, 2)


async def assert_min_deposit_inr(amount_inr: float, controls: Optional[Dict[str, Any]] = None) -> None:
    min_inr = await resolve_min_deposit_inr(controls)
    amount = round(float(amount_inr), 2)
    if min_inr > 0 and amount < min_inr:
        label = f"₹{min_inr:.0f}" if min_inr == int(min_inr) else f"₹{min_inr:.2f}"
        raise HTTPException(
            status_code=400,
            detail=f"Minimum INR deposit is {label}",
        )


async def _write_image_upload(
    upload: UploadFile,
    *,
    subdir: str,
    prefix: str,
    max_bytes: int,
    mime_map: Dict[str, str],
) -> str:
    ct = (upload.content_type or "").split(";")[0].strip().lower()
    if ct not in mime_map:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type (use JPEG, PNG, or WebP). Got: {upload.content_type or 'unknown'}",
        )
    raw = await upload.read()
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File too large (max {max_bytes // (1024 * 1024)}MB)")
    if len(raw) < 32:
        raise HTTPException(status_code=400, detail="File is empty or too small")
    ext = mime_map[ct]
    dest_dir = _inr_dir() / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{prefix}_{uuid.uuid4().hex[:14]}{ext}"
    (dest_dir / fname).write_bytes(raw)
    return f"/uploads/inr/{subdir}/{fname}"


async def save_deposit_screenshot(upload: UploadFile) -> str:
    return await _write_image_upload(
        upload,
        subdir="screenshots",
        prefix="ss",
        max_bytes=MAX_SCREENSHOT_BYTES,
        mime_map=SCREENSHOT_MIME_EXT,
    )


async def save_qr_image(upload: UploadFile) -> str:
    return await _write_image_upload(
        upload,
        subdir="qr",
        prefix="qr",
        max_bytes=MAX_QR_BYTES,
        mime_map=SCREENSHOT_MIME_EXT,
    )


def resolve_inr_public_asset_path(path: str) -> Path:
    """Validate ``/uploads/inr/{qr|screenshots}/<file>`` and return absolute path."""
    normalized = (path or "").strip()
    if not normalized.startswith("/uploads/inr/"):
        raise HTTPException(status_code=400, detail="Invalid asset path")
    rel = normalized.removeprefix("/uploads/")
    segments = rel.split("/")
    if len(segments) != 3 or segments[0] != "inr" or segments[1] not in ("qr", "screenshots"):
        raise HTTPException(status_code=400, detail="Invalid asset path")
    fname = segments[2]
    if not fname or ".." in fname or "/" in fname or "\\" in fname:
        raise HTTPException(status_code=400, detail="Invalid file name")
    full = (_inr_dir() / segments[1] / fname).resolve()
    root = _inr_dir().resolve()
    if not str(full).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid asset path")
    if not full.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return full


def mime_for_inr_asset(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    return "application/octet-stream"


def _method_label(method: Dict[str, Any]) -> str:
    t = method.get("type") or ""
    d = method.get("details") or {}
    if t == "bank":
        acct = str(d.get("account_number") or "")
        tail = acct[-4:] if len(acct) >= 4 else acct
        holder = (d.get("account_holder_name") or "").strip()
        bank = (d.get("bank_name") or "Bank").strip()
        if holder:
            return f"{bank} · {holder}" + (f" · ••••{tail}" if tail else "")
        return f"{bank}" + (f" · ••••{tail}" if tail else "")
    if t == "upi":
        return d.get("display_name") or d.get("upi_id") or "UPI"
    if t == "qr":
        return d.get("label") or "QR"
    return t or "Payment method"


def _method_out(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {
        "id": doc.get("id"),
        "type": doc.get("type"),
        "details": doc.get("details") or {},
        "qr_image_url": doc.get("qr_image_url"),
        "is_active": bool(doc.get("is_active", True)),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }
    out["label"] = _method_label(out)
    return out


async def list_payment_methods(*, active_only: bool = False) -> List[Dict[str, Any]]:
    db = _db()
    if db is None:
        return []
    q: Dict[str, Any] = {}
    if active_only:
        q["is_active"] = True
    cur = db[COL_PAYMENT_METHODS].find(q, {"_id": 0}).sort([("created_at", -1)])
    rows = await cur.to_list(length=500)
    return [_method_out(r) for r in rows]


async def get_payment_method(method_id: str, *, must_be_active: bool = False) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    doc = await db[COL_PAYMENT_METHODS].find_one({"id": method_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Payment method not found")
    if must_be_active and not doc.get("is_active"):
        raise HTTPException(status_code=400, detail="Selected payment method is not active")
    return doc


async def create_payment_method(
    method_type: str,
    details: Dict[str, Any],
    *,
    is_active: bool = True,
    qr_image_url: Optional[str] = None,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    validated = validate_details_for_type(method_type, details)
    if method_type == METHOD_QR and not qr_image_url:
        raise HTTPException(status_code=400, detail="QR payment method requires a QR image")
    now = _now_iso()
    doc = {
        "id": _new_id("inrpm"),
        "type": method_type,
        "details": validated,
        "qr_image_url": qr_image_url,
        "is_active": bool(is_active),
        "created_at": now,
        "updated_at": now,
    }
    await db[COL_PAYMENT_METHODS].insert_one(doc)
    return _method_out(doc)


async def update_payment_method(
    method_id: str,
    *,
    details: Optional[Dict[str, Any]] = None,
    is_active: Optional[bool] = None,
    qr_image_url: Optional[str] = None,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    existing = await get_payment_method(method_id)
    mtype = existing["type"]
    patch: Dict[str, Any] = {"updated_at": _now_iso()}
    if details is not None:
        patch["details"] = validate_details_for_type(mtype, details)
    if is_active is not None:
        patch["is_active"] = bool(is_active)
    if qr_image_url is not None:
        patch["qr_image_url"] = qr_image_url
    updated = await db[COL_PAYMENT_METHODS].find_one_and_update(
        {"id": method_id},
        {"$set": patch},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return _method_out(updated)


async def delete_payment_method(method_id: str) -> None:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    res = await db[COL_PAYMENT_METHODS].delete_one({"id": method_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Payment method not found")


def _deposit_out_user(doc: Dict[str, Any]) -> Dict[str, Any]:
    """User-facing deposit row — IBO amounts only after approval."""
    out = _deposit_out(doc)
    if out.get("status") != STATUS_APPROVED:
        out["amount_ibo"] = None
        out["inr_rate_at_time"] = None
        out["ibo_usdt_at_time"] = None
        out["inr_per_usdt_at_time"] = None
    return out


def _deposit_out(doc: Dict[str, Any], *, include_user: bool = False) -> Dict[str, Any]:
    out = {
        "id": doc.get("id"),
        "uid": doc.get("uid"),
        "amount_inr": doc.get("amount_inr"),
        "amount_ibo": doc.get("amount_ibo"),
        "inr_rate_at_time": doc.get("inr_rate_at_time"),
        "ibo_usdt_at_time": doc.get("ibo_usdt_at_time"),
        "inr_per_usdt_at_time": doc.get("inr_per_usdt_at_time"),
        "payment_method_id": doc.get("payment_method_id"),
        "payment_method_type": doc.get("payment_method_type"),
        "payment_method_label": doc.get("payment_method_label"),
        "utr_number": doc.get("utr_number"),
        "screenshot_url": doc.get("screenshot_url"),
        "note": doc.get("note"),
        "status": doc.get("status"),
        "rejection_reason": doc.get("rejection_reason"),
        "reviewed_by": doc.get("reviewed_by"),
        "reviewed_at": doc.get("reviewed_at"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        **gateway_fields_out(doc),
    }
    if include_user:
        out["user_email"] = doc.get("user_email")
        out["user_name"] = doc.get("user_name")
    return out


async def count_pending_deposits() -> int:
    db = _db()
    if db is None:
        return 0
    return await db[COL_DEPOSITS].count_documents({"status": STATUS_PENDING})


async def count_pending_inr_queue() -> Dict[str, int]:
    """Pending counts for admin sidebar badges."""
    from inr import withdrawal_service

    deposits = await count_pending_deposits()
    withdrawals = await withdrawal_service.count_pending_withdrawals()
    return {
        "pending_deposit_count": deposits,
        "pending_withdrawal_count": withdrawals,
        "pending_count": deposits + withdrawals,
    }


async def create_deposit_request(
    uid: str,
    *,
    amount_inr: float,
    payment_method_id: str,
    utr_number: str,
    screenshot_url: str,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if amount_inr <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    await assert_min_deposit_inr(amount_inr)
    utr = (utr_number or "").strip()
    if len(utr) < 4:
        raise HTTPException(status_code=400, detail="UTR / reference number is required")

    # Optional: one pending deposit per user
    pending = await db[COL_DEPOSITS].find_one({"uid": uid, "status": STATUS_PENDING})
    if pending:
        raise HTTPException(
            status_code=409,
            detail="You already have a pending INR deposit. Wait for review or contact support.",
        )

    method = await get_payment_method(payment_method_id, must_be_active=True)

    label = _method_label(method)
    now = _now_iso()
    doc = {
        "id": _new_id("inrd"),
        "uid": uid,
        "amount_inr": round(float(amount_inr), 2),
        "amount_ibo": None,
        "inr_rate_at_time": None,
        "ibo_usdt_at_time": None,
        "inr_per_usdt_at_time": None,
        "payment_method_id": method["id"],
        "payment_method_type": method["type"],
        "payment_method_label": label,
        "utr_number": utr,
        "screenshot_url": screenshot_url,
        "note": (note or "").strip() or None,
        "deposit_flow": DEPOSIT_MODE_MANUAL,
        # Omit gateway_* fields (do not set null) — unique index on gateway_payment_id
        # only applies when a real provider payment id exists.
        "status": STATUS_PENDING,
        "rejection_reason": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    await db[COL_DEPOSITS].insert_one(doc)
    await _notify_user_deposit_submitted(doc)
    return _deposit_out(doc)


async def list_user_deposits(uid: str, *, skip: int = 0, limit: int = 50) -> Dict[str, Any]:
    db = _db()
    if db is None:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    q = {"uid": uid}
    total = await db[COL_DEPOSITS].count_documents(q)
    cur = (
        db[COL_DEPOSITS]
        .find(q, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    items = [_deposit_out_user(r) for r in await cur.to_list(length=limit)]
    return {"items": items, "total": total, "skip": skip, "limit": limit}


async def preview_pending_deposit_ibo(deposit_id: str) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    doc = await db[COL_DEPOSITS].find_one({"id": deposit_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Deposit not found")
    st = doc.get("status")
    if st not in (STATUS_PENDING, STATUS_APPROVING):
        raise HTTPException(status_code=409, detail="Deposit is not awaiting approval")
    preview = await preview_ibo_for_inr(float(doc.get("amount_inr") or 0))
    preview["deposit_id"] = deposit_id
    preview["uid"] = doc.get("uid")
    return preview


async def preview_ibo_for_inr(amount_inr: float) -> Dict[str, Any]:
    """Live IBO credit preview for admin approval UI."""
    inr_per_usdt, ibo_usdt, ibo_per_inr = await resolve_inr_ibo_rate()
    amount_ibo = ibo_amount_from_inr(amount_inr, ibo_per_inr)
    return {
        "amount_inr": round(float(amount_inr), 2),
        "amount_ibo": amount_ibo,
        "ibo_usdt": ibo_usdt,
        "inr_per_usdt": inr_per_usdt,
        "ibo_per_inr": ibo_per_inr,
    }


async def list_admin_deposits(
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
        q["status"] = status.strip().lower()
    total = await db[COL_DEPOSITS].count_documents(q)
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
                "payment_method_id": 1,
                "payment_method_type": 1,
                "payment_method_label": 1,
                "utr_number": 1,
                "screenshot_url": 1,
                "note": 1,
                "status": 1,
                "rejection_reason": 1,
                "reviewed_by": 1,
                "reviewed_at": 1,
                "created_at": 1,
                "updated_at": 1,
                "user_email": "$user.email",
                "user_name": "$user.name",
            }
        },
    ]
    rows = await db[COL_DEPOSITS].aggregate(pipeline).to_list(length=limit)
    inr_per_usdt, ibo_usdt, ibo_per_inr = await resolve_inr_ibo_rate()
    items: List[Dict[str, Any]] = []
    for r in rows:
        out = _deposit_out(r, include_user=True)
        if out.get("status") in (STATUS_PENDING, STATUS_APPROVING):
            amt_inr = float(out.get("amount_inr") or 0)
            if amt_inr > 0 and ibo_per_inr > 0:
                out["preview_amount_ibo"] = ibo_amount_from_inr(amt_inr, ibo_per_inr)
            else:
                out["preview_amount_ibo"] = None
            out["preview_ibo_usdt"] = ibo_usdt
            out["preview_inr_per_usdt"] = inr_per_usdt
            out["preview_ibo_per_inr"] = ibo_per_inr
        items.append(out)
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


async def approve_deposit(
    deposit_id: str,
    admin_id: str,
    *,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    reserved = await db[COL_DEPOSITS].find_one_and_update(
        {"id": deposit_id, "status": STATUS_PENDING},
        {"$set": {"status": "approving", "updated_at": _now_iso()}},
        return_document=ReturnDocument.BEFORE,
    )
    if reserved is None:
        raise HTTPException(status_code=409, detail="Deposit is not pending or was already processed")

    uid = reserved.get("uid")
    amount_inr = float(reserved.get("amount_inr") or 0)
    if not uid or amount_inr <= 0:
        await db[COL_DEPOSITS].update_one(
            {"id": deposit_id, "status": "approving"},
            {"$set": {"status": STATUS_PENDING, "updated_at": _now_iso()}},
        )
        raise HTTPException(status_code=400, detail="Invalid deposit row")

    inr_per_usdt, ibo_usdt, ibo_per_inr = await resolve_inr_ibo_rate()
    amount_ibo = ibo_amount_from_inr(amount_inr, ibo_per_inr)
    if amount_ibo <= 0:
        await db[COL_DEPOSITS].update_one(
            {"id": deposit_id, "status": "approving"},
            {"$set": {"status": STATUS_PENDING, "updated_at": _now_iso()}},
        )
        raise HTTPException(status_code=400, detail="Could not compute IBO amount")

    try:
        await wallet_service.credit(
            uid,
            "IBO",
            amount_ibo,
            txn_type="deposit",
            ref_type="inr_deposit",
            ref_id=deposit_id,
            meta={
                "amount_inr": amount_inr,
                "utr_number": reserved.get("utr_number"),
                "inr_rate_at_time": ibo_per_inr,
                "ibo_usdt_at_time": ibo_usdt,
                "inr_per_usdt_at_time": inr_per_usdt,
                "admin_note": note,
            },
        )
    except Exception:
        logger.exception("inr approve: wallet credit failed for %s", deposit_id)
        await db[COL_DEPOSITS].update_one(
            {"id": deposit_id, "status": "approving"},
            {"$set": {"status": STATUS_PENDING, "updated_at": _now_iso()}},
        )
        raise HTTPException(status_code=500, detail="Could not credit wallet")

    now = _now_iso()
    updated = await db[COL_DEPOSITS].find_one_and_update(
        {"id": deposit_id, "status": "approving"},
        {
            "$set": {
                "status": STATUS_APPROVED,
                "amount_ibo": amount_ibo,
                "inr_rate_at_time": ibo_per_inr,
                "ibo_usdt_at_time": ibo_usdt,
                "inr_per_usdt_at_time": inr_per_usdt,
                "reviewed_by": admin_id,
                "reviewed_at": now,
                "updated_at": now,
                "admin_approve_note": note,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated:
        await _notify_user_deposit(updated, approved=True)
    try:
        from ibo.pricing import refresh_deposit_driven_ibo_price

        await refresh_deposit_driven_ibo_price()
    except Exception:  # noqa: BLE001
        logger.exception("inr approve: IBO deposit-driven price refresh failed")
    return _deposit_out(updated or reserved)


async def reject_deposit(
    deposit_id: str,
    admin_id: str,
    reason: str,
) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="Rejection reason is required")

    updated = await db[COL_DEPOSITS].find_one_and_update(
        {"id": deposit_id, "status": STATUS_PENDING},
        {
            "$set": {
                "status": STATUS_REJECTED,
                "rejection_reason": reason,
                "reviewed_by": admin_id,
                "reviewed_at": _now_iso(),
                "updated_at": _now_iso(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(status_code=409, detail="Deposit is not pending or was already processed")
    await _notify_user_deposit(updated, approved=False)
    return _deposit_out(updated)


async def _notify_user_deposit_submitted(doc: Dict[str, Any]) -> None:
    db = _db()
    if db is None:
        return
    uid = doc.get("uid")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "email": 1, "name": 1})
    if not user or not user.get("email"):
        return
    try:
        from services import email_templates

        subject, html, text = email_templates.inr_deposit_submitted(
            user.get("name") or "Trader",
            float(doc.get("amount_inr") or 0),
            doc.get("id") or "",
            utr=doc.get("utr_number") or "",
            payment_method_label=doc.get("payment_method_label") or "",
        )
        await email_service.send_email(user["email"], subject, html, text)
    except Exception:
        logger.exception("inr deposit submitted email failed for uid=%s", uid)


async def _notify_user_deposit(doc: Dict[str, Any], *, approved: bool) -> None:
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
            subject, html, text = email_templates.inr_deposit_approved(
                user.get("name") or "Trader",
                float(doc.get("amount_inr") or 0),
                float(doc.get("amount_ibo") or 0),
                doc.get("utr_number") or "",
            )
        else:
            subject, html, text = email_templates.inr_deposit_rejected(
                user.get("name") or "Trader",
                float(doc.get("amount_inr") or 0),
                doc.get("rejection_reason") or "Rejected by admin",
            )
        await email_service.send_email(user["email"], subject, html, text)
    except Exception:
        logger.exception("inr deposit notification email failed for uid=%s", uid)
