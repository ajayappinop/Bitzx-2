"""Options USDT wallet ledger (separate from spot and futures)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Literal, Optional

from pymongo import ReturnDocument

from services.db import get_client, supports_transactions
from services.errors import InsufficientFundsError

from ..constants import COL_WALLETS, COL_WALLET_TXNS, MARGIN_ASSET
from ..db import db

logger = logging.getLogger(__name__)
_EPS = 1e-12

LedgerType = Literal[
    "transfer_in",
    "transfer_out",
    "margin_lock",
    "margin_unlock",
    "premium_pay",
    "premium_recv",
    "fee",
    "adjustment",
    "settlement_pay",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float) -> float:
    return round(float(v), 8)


async def _run_in_txn(session, coro: Callable[[Any], Awaitable]):
    if session is not None:
        return await coro(session)
    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await coro(sess)
    return await coro(None)


async def _read_balance_in(uid: str, asset: str, session) -> Dict[str, float]:
    doc = await db()[COL_WALLETS].find_one(
        {"uid": uid, "asset": asset},
        {"_id": 0, "available": 1, "locked": 1},
        session=session,
    )
    if not doc:
        return {"available": 0.0, "locked": 0.0}
    return {
        "available": float(doc.get("available") or 0.0),
        "locked": float(doc.get("locked") or 0.0),
    }


async def _write_txn(
    *,
    uid: str,
    asset: str,
    txn_type: LedgerType,
    direction: str,
    amount: float,
    balance_before: Dict[str, float],
    balance_after: Dict[str, float],
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    doc = {
        "id": f"optx_{uuid.uuid4().hex[:18]}",
        "uid": uid,
        "asset": asset,
        "type": txn_type,
        "direction": direction,
        "amount": _round(amount),
        "balance_before": {k: _round(balance_before.get(k, 0.0)) for k in ("available", "locked")},
        "balance_after": {k: _round(balance_after.get(k, 0.0)) for k in ("available", "locked")},
        "ref_type": ref_type,
        "ref_id": ref_id,
        "meta": meta or {},
        "created_at": _now_iso(),
    }
    await db()[COL_WALLET_TXNS].insert_one(doc, session=session)
    doc.pop("_id", None)
    return doc


async def credit(
    uid: str,
    amount: float,
    *,
    asset: str = MARGIN_ASSET,
    txn_type: LedgerType = "adjustment",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    amt = float(amount)
    if amt <= 0:
        raise ValueError("credit amount must be > 0")

    async def _do(s):
        before = await _read_balance_in(uid, asset, s)
        now = _now_iso()
        updated = await db()[COL_WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset},
            {"$inc": {"available": amt}, "$set": {"updated_at": now}, "$setOnInsert": {"uid": uid, "asset": asset, "locked": 0.0, "created_at": now}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        after = {
            "available": float((updated or {}).get("available") or 0.0),
            "locked": float((updated or {}).get("locked") or 0.0),
        }
        return await _write_txn(
            uid=uid, asset=asset, txn_type=txn_type, direction="credit",
            amount=amt, balance_before=before, balance_after=after,
            ref_type=ref_type, ref_id=ref_id, meta=meta, session=s,
        )

    return await _run_in_txn(session, _do)


async def debit(
    uid: str,
    amount: float,
    *,
    asset: str = MARGIN_ASSET,
    txn_type: LedgerType = "adjustment",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    amt = float(amount)
    if amt <= 0:
        raise ValueError("debit amount must be > 0")

    async def _do(s):
        before = await _read_balance_in(uid, asset, s)
        now = _now_iso()
        updated = await db()[COL_WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "available": {"$gte": amt - _EPS}},
            {"$inc": {"available": -amt}, "$set": {"updated_at": now}},
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(uid, asset, have=before["available"], need=amt, bucket="available")
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            uid=uid, asset=asset, txn_type=txn_type, direction="debit",
            amount=amt, balance_before=before, balance_after=after,
            ref_type=ref_type, ref_id=ref_id, meta=meta, session=s,
        )

    return await _run_in_txn(session, _do)


async def lock(
    uid: str,
    amount: float,
    *,
    asset: str = MARGIN_ASSET,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    amt = float(amount)
    if amt <= 0:
        raise ValueError("lock amount must be > 0")

    async def _do(s):
        before = await _read_balance_in(uid, asset, s)
        now = _now_iso()
        updated = await db()[COL_WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "available": {"$gte": amt - _EPS}},
            {"$inc": {"available": -amt, "locked": amt}, "$set": {"updated_at": now}},
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(uid, asset, have=before["available"], need=amt, bucket="available")
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            uid=uid, asset=asset, txn_type="margin_lock", direction="lock",
            amount=amt, balance_before=before, balance_after=after,
            ref_type=ref_type, ref_id=ref_id, meta=meta, session=s,
        )

    return await _run_in_txn(session, _do)


async def unlock(
    uid: str,
    amount: float,
    *,
    asset: str = MARGIN_ASSET,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    amt = float(amount)
    if amt <= 0:
        raise ValueError("unlock amount must be > 0")

    async def _do(s):
        before = await _read_balance_in(uid, asset, s)
        now = _now_iso()
        updated = await db()[COL_WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "locked": {"$gte": amt - _EPS}},
            {"$inc": {"available": amt, "locked": -amt}, "$set": {"updated_at": now}},
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(uid, asset, have=before["locked"], need=amt, bucket="locked")
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            uid=uid, asset=asset, txn_type="margin_unlock", direction="unlock",
            amount=amt, balance_before=before, balance_after=after,
            ref_type=ref_type, ref_id=ref_id, meta=meta, session=s,
        )

    return await _run_in_txn(session, _do)


async def debit_locked(
    uid: str,
    amount: float,
    *,
    asset: str = MARGIN_ASSET,
    txn_type: LedgerType = "premium_pay",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    amt = float(amount)
    if amt <= 0:
        raise ValueError("debit_locked amount must be > 0")

    async def _do(s):
        before = await _read_balance_in(uid, asset, s)
        now = _now_iso()
        updated = await db()[COL_WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "locked": {"$gte": amt - _EPS}},
            {"$inc": {"locked": -amt}, "$set": {"updated_at": now}},
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(uid, asset, have=before["locked"], need=amt, bucket="locked")
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            uid=uid, asset=asset, txn_type=txn_type, direction="debit",
            amount=amt, balance_before=before, balance_after=after,
            ref_type=ref_type, ref_id=ref_id, meta=meta, session=s,
        )

    return await _run_in_txn(session, _do)


async def read_balance(uid: str, asset: str = MARGIN_ASSET) -> Dict[str, float]:
    return await _read_balance_in(uid, asset, None)
