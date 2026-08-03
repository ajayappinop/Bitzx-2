"""Atomic wallet/ledger operations for IBO.

Every balance-changing call in this module performs:

1. A single ``$inc`` on the ``wallets`` document (optionally upserting it).
2. A matching insert into ``wallet_txns`` that records
   ``balance_before`` / ``balance_after`` / ``type`` / ``ref_id``.

Both writes happen inside a MongoDB transaction when the cluster supports
them (``services.db.supports_transactions()``). The service also accepts
a caller-supplied ``session`` so multiple wallet operations can be composed
inside one outer transaction (e.g. the full buy-fill settlement).

Primitives:

- :func:`credit`   – increase ``available``
- :func:`debit`    – decrease ``available`` (guarded with ``$gte``)
- :func:`lock`     – move ``available`` → ``locked`` (guarded)
- :func:`unlock`   – move ``locked`` → ``available`` (guarded)

Composites:

- :func:`settle_buy_fill`  – full bookkeeping for one BUY fill leg
- :func:`settle_sell_fill` – full bookkeeping for one SELL fill leg

Read helpers:

- :func:`read_balance`  – snapshot of a single ``(uid, asset)`` wallet row
- :func:`list_txns`     – paginated ledger query
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional

from pymongo import ReturnDocument

from .db import get_client, get_db, supports_transactions
from .errors import InsufficientFundsError

logger = logging.getLogger(__name__)

# Canonical ledger types. Admin/user-facing reports should only show the first
# five; the rest are internal bookkeeping but still auditable.
TxnType = Literal[
    "deposit",
    "withdraw",
    "trade",
    "fee",
    "adjustment",
    "lock",
    "unlock",
    "seed",
    "opening_balance",
    "referral",
]

WALLETS = "wallets"
WALLET_TXNS = "wallet_txns"

_EPS = 1e-12


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(value: float) -> float:
    return round(float(value), 8)


async def _run_in_txn(session, coro: Callable[[Any], Awaitable]):
    """Run ``coro(session)`` inside a Mongo transaction when the cluster supports it.

    When a non-None ``session`` is passed the coroutine runs inside that
    existing transaction. When None and the cluster supports transactions,
    a fresh transaction is started. Otherwise the coroutine runs without a
    session (best-effort — each individual ``$inc``/``insert_one`` is still
    atomic, only the two are not co-atomic).
    """
    if session is not None:
        return await coro(session)

    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await coro(sess)

    return await coro(None)


async def _read_balance_in(db, uid: str, asset: str, session) -> Dict[str, float]:
    doc = await db[WALLETS].find_one(
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


async def _snapshot_after(db, uid: str, asset: str, session) -> Dict[str, float]:
    """Read the wallet doc after an update (inside the same session)."""
    return await _read_balance_in(db, uid, asset, session)


async def _write_txn(
    db,
    *,
    uid: str,
    asset: str,
    txn_type: TxnType,
    direction: str,
    amount: float,
    balance_before: Dict[str, float],
    balance_after: Dict[str, float],
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    status: str = "completed",
    session=None,
) -> Dict[str, Any]:
    doc: Dict[str, Any] = {
        "id": f"tx_{uuid.uuid4().hex[:20]}",
        "uid": uid,
        "asset": asset,
        "type": txn_type,
        "direction": direction,
        "amount": _round(amount),
        "balance_before": {
            "available": _round(balance_before.get("available", 0.0)),
            "locked": _round(balance_before.get("locked", 0.0)),
        },
        "balance_after": {
            "available": _round(balance_after.get("available", 0.0)),
            "locked": _round(balance_after.get("locked", 0.0)),
        },
        "ref_type": ref_type,
        "ref_id": ref_id,
        "meta": meta or {},
        "status": status,
        "created_at": _now_iso(),
    }
    await db[WALLET_TXNS].insert_one(doc, session=session)
    # Mongo's insert_one mutates the input with ``_id``; strip it before returning.
    doc.pop("_id", None)
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# Primitives
# ─────────────────────────────────────────────────────────────────────────────

async def credit(
    uid: str,
    asset: str,
    amount: float,
    *,
    txn_type: TxnType = "adjustment",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Add ``amount`` to ``available``. Upserts the wallet doc if missing."""
    if amount is None or amount <= 0:
        raise ValueError("credit amount must be > 0")
    amt = float(amount)
    db = get_db()

    async def _do(s):
        before = await _read_balance_in(db, uid, asset, s)
        now = _now_iso()
        updated = await db[WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset},
            {
                "$inc": {"available": amt},
                "$set": {"updated_at": now},
                "$setOnInsert": {
                    "uid": uid,
                    "asset": asset,
                    "locked": 0.0,
                    "created_at": now,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        after = {
            "available": float((updated or {}).get("available") or 0.0),
            "locked": float((updated or {}).get("locked") or 0.0),
        }
        return await _write_txn(
            db,
            uid=uid,
            asset=asset,
            txn_type=txn_type,
            direction="credit",
            amount=amt,
            balance_before=before,
            balance_after=after,
            ref_type=ref_type,
            ref_id=ref_id,
            meta=meta,
            session=s,
        )

    return await _run_in_txn(session, _do)


async def debit(
    uid: str,
    asset: str,
    amount: float,
    *,
    txn_type: TxnType = "adjustment",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Deduct ``amount`` from ``available``. Fails atomically if insufficient."""
    if amount is None or amount <= 0:
        raise ValueError("debit amount must be > 0")
    amt = float(amount)
    db = get_db()

    async def _do(s):
        before = await _read_balance_in(db, uid, asset, s)
        now = _now_iso()
        updated = await db[WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "available": {"$gte": amt - _EPS}},
            {"$inc": {"available": -amt}, "$set": {"updated_at": now}},
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(
                uid, asset, have=before["available"], need=amt, bucket="available"
            )
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            db,
            uid=uid,
            asset=asset,
            txn_type=txn_type,
            direction="debit",
            amount=amt,
            balance_before=before,
            balance_after=after,
            ref_type=ref_type,
            ref_id=ref_id,
            meta=meta,
            session=s,
        )

    return await _run_in_txn(session, _do)


async def lock(
    uid: str,
    asset: str,
    amount: float,
    *,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Move ``amount`` from ``available`` to ``locked`` (atomic ``$gte`` guard)."""
    if amount is None or amount <= 0:
        raise ValueError("lock amount must be > 0")
    amt = float(amount)
    db = get_db()

    async def _do(s):
        before = await _read_balance_in(db, uid, asset, s)
        now = _now_iso()
        updated = await db[WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "available": {"$gte": amt - _EPS}},
            {
                "$inc": {"available": -amt, "locked": amt},
                "$set": {"updated_at": now},
            },
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(
                uid, asset, have=before["available"], need=amt, bucket="available"
            )
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            db,
            uid=uid,
            asset=asset,
            txn_type="lock",
            direction="lock",
            amount=amt,
            balance_before=before,
            balance_after=after,
            ref_type=ref_type,
            ref_id=ref_id,
            meta=meta,
            session=s,
        )

    return await _run_in_txn(session, _do)


async def debit_locked(
    uid: str,
    asset: str,
    amount: float,
    *,
    txn_type: TxnType = "withdraw",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Deduct ``amount`` directly from ``locked`` (leaves ``available`` alone).

    Phase 6 — used by the withdrawal executor once an on-chain broadcast
    is confirmed: the user's funds were reserved in ``locked`` at submit
    time, and the broadcast is now final, so the lock is consumed rather
    than released back to ``available``.

    Refuses to go negative (``locked >= amount``). The complementary
    operation for *refund* on reject/fail remains :func:`unlock`.
    """
    if amount is None or amount <= 0:
        raise ValueError("debit_locked amount must be > 0")
    amt = float(amount)
    db = get_db()

    async def _do(s):
        before = await _read_balance_in(db, uid, asset, s)
        now = _now_iso()
        updated = await db[WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "locked": {"$gte": amt - _EPS}},
            {"$inc": {"locked": -amt}, "$set": {"updated_at": now}},
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(
                uid, asset, have=before["locked"], need=amt, bucket="locked"
            )
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            db,
            uid=uid,
            asset=asset,
            txn_type=txn_type,
            direction="debit",
            amount=amt,
            balance_before=before,
            balance_after=after,
            ref_type=ref_type,
            ref_id=ref_id,
            meta=meta,
            session=s,
        )

    return await _run_in_txn(session, _do)


async def unlock(
    uid: str,
    asset: str,
    amount: float,
    *,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Move ``amount`` from ``locked`` back to ``available`` (guarded by ``$gte``).

    Used for order cancels, withdrawal rejections, and as the first step of
    a fill settlement (release the reserve, then debit the actual spend).
    """
    if amount is None or amount <= 0:
        raise ValueError("unlock amount must be > 0")
    amt = float(amount)
    db = get_db()

    async def _do(s):
        before = await _read_balance_in(db, uid, asset, s)
        now = _now_iso()
        updated = await db[WALLETS].find_one_and_update(
            {"uid": uid, "asset": asset, "locked": {"$gte": amt - _EPS}},
            {
                "$inc": {"available": amt, "locked": -amt},
                "$set": {"updated_at": now},
            },
            return_document=ReturnDocument.AFTER,
            session=s,
        )
        if updated is None:
            raise InsufficientFundsError(
                uid, asset, have=before["locked"], need=amt, bucket="locked"
            )
        after = {
            "available": float(updated.get("available") or 0.0),
            "locked": float(updated.get("locked") or 0.0),
        }
        return await _write_txn(
            db,
            uid=uid,
            asset=asset,
            txn_type="unlock",
            direction="unlock",
            amount=amt,
            balance_before=before,
            balance_after=after,
            ref_type=ref_type,
            ref_id=ref_id,
            meta=meta,
            session=s,
        )

    return await _run_in_txn(session, _do)


# ─────────────────────────────────────────────────────────────────────────────
# Composites — trade-fill settlement
# ─────────────────────────────────────────────────────────────────────────────

async def settle_buy_fill(
    uid: str,
    base_asset: str,
    fill_price: float,
    fill_amount: float,
    lock_price: float,
    fee_rate: float,
    ibo_price_usdt: float,
    quote_asset: str = "USDT",
    *,
    order_id: Optional[str] = None,
    trade_id: Optional[str] = None,
    session=None,
) -> tuple:
    """Settle one BUY fill leg for ``uid`` and emit matching ledger rows.

    Supports variable quote assets (default ``"USDT"``; pass ``"IBO"`` for
    IBO-quoted pairs such as BTCIBO).

    - ``locked(quote_asset)  -=  lock_price × fill_amount``
    - ``available(quote_asset) +=  max(0, lock_price − fill_price) × fill_amount``
    - ``available(base) += fill_amount``
    - ``available(IBO) -= fee_ibo`` where ``fee_ibo`` is derived from quote notional

    Emits 4 ledger rows (unlock quote, debit quote cost, credit base gross,
    debit IBO fee) so the ledger is fully auditable.

    Returns ``(fee_amount, fee_asset)``.
    """
    fill_price = float(fill_price)
    fill_amount = float(fill_amount)
    lock_price = float(lock_price)
    fee_rate = max(float(fee_rate or 0.0), 0.0)
    _quote = str(quote_asset or "USDT").upper()

    total_locked = _round(lock_price * fill_amount)
    # Effective cost preserves the legacy behaviour: when fill_price > lock_price
    # we never debit more than was actually reserved. The difference is a known
    # accounting gap carried over from the pre-ledger engine and is logged in meta.
    effective_cost = _round(min(fill_price, lock_price) * fill_amount)
    quote_notional = _round(fill_price * fill_amount)
    if _quote == "IBO":
        fee_ibo = _round(quote_notional * fee_rate)
    else:
        px = float(ibo_price_usdt or 0.0)
        if px <= 0:
            raise ValueError("ibo_price_usdt must be > 0 for non-IBO quotes")
        fee_ibo = _round((quote_notional * fee_rate) / px)

    async def _do(s):
        # 1) Release the full lock on the quote side.
        if total_locked > 0:
            await unlock(
                uid, _quote, total_locked,
                ref_type="trade", ref_id=trade_id,
                meta={
                    "phase": "buy_unlock",
                    "order_id": order_id,
                    "lock_price": lock_price,
                    "fill_amount": fill_amount,
                },
                session=s,
            )
        # 2) Debit the actual quote spend.
        if effective_cost > 0:
            await debit(
                uid, _quote, effective_cost,
                txn_type="trade",
                ref_type="trade", ref_id=trade_id,
                meta={
                    "phase": "buy_cost",
                    "order_id": order_id,
                    "fill_price": fill_price,
                    "fill_amount": fill_amount,
                    "underpaid_vs_fill_price": _round(
                        max(0.0, (fill_price - lock_price) * fill_amount)
                    ),
                },
                session=s,
            )
        # 3) Credit the gross base received.
        await credit(
            uid, base_asset, fill_amount,
            txn_type="trade",
            ref_type="trade", ref_id=trade_id,
            meta={
                "phase": "buy_receive",
                "order_id": order_id,
                "fill_price": fill_price,
                "fill_amount": fill_amount,
            },
            session=s,
        )
        # 4) Charge the IBO-denominated fee.
        if fee_ibo > 0:
            await debit(
                uid, "IBO", fee_ibo,
                txn_type="fee",
                ref_type="trade", ref_id=trade_id,
                meta={
                    "phase": "buy_fee",
                    "order_id": order_id,
                    "fee_rate": fee_rate,
                    "fee_asset": "IBO",
                    "fee_quote_notional": quote_notional,
                    "fee_quote_asset": _quote,
                    "ibo_price_usdt": float(ibo_price_usdt or 0.0),
                },
                session=s,
            )
        return fee_ibo, "IBO"

    return await _run_in_txn(session, _do)


async def settle_sell_fill(
    uid: str,
    base_asset: str,
    fill_price: float,
    fill_amount: float,
    fee_rate: float,
    ibo_price_usdt: float,
    quote_asset: str = "USDT",
    *,
    order_id: Optional[str] = None,
    trade_id: Optional[str] = None,
    session=None,
) -> tuple:
    """Settle one SELL fill leg for ``uid`` and emit matching ledger rows.

    Supports variable quote assets (default ``"USDT"``; pass ``"IBO"`` for
    IBO-quoted pairs such as BTCIBO).

    - ``locked(base) -= fill_amount``
    - ``available(quote_asset) += fill_price × fill_amount``
    - ``available(IBO) -= fee_ibo`` where ``fee_ibo`` is derived from quote notional

    Emits 4 ledger rows (unlock base, debit base sold, credit quote gross,
    debit IBO fee).

    Returns ``(fee_amount, fee_asset)`` where ``fee_asset`` is always ``"IBO"``.
    """
    fill_price = float(fill_price)
    fill_amount = float(fill_amount)
    fee_rate = max(float(fee_rate or 0.0), 0.0)
    _quote = str(quote_asset or "USDT").upper()

    quote_gross = _round(fill_price * fill_amount)
    if _quote == "IBO":
        fee_ibo = _round(quote_gross * fee_rate)
    else:
        px = float(ibo_price_usdt or 0.0)
        if px <= 0:
            raise ValueError("ibo_price_usdt must be > 0 for non-IBO quotes")
        fee_ibo = _round((quote_gross * fee_rate) / px)

    async def _do(s):
        # 1) Release the base reserve to available.
        await unlock(
            uid, base_asset, fill_amount,
            ref_type="trade", ref_id=trade_id,
            meta={
                "phase": "sell_unlock",
                "order_id": order_id,
                "fill_price": fill_price,
            },
            session=s,
        )
        # 2) Debit the base that is actually sold.
        await debit(
            uid, base_asset, fill_amount,
            txn_type="trade",
            ref_type="trade", ref_id=trade_id,
            meta={
                "phase": "sell_deliver",
                "order_id": order_id,
                "fill_price": fill_price,
            },
            session=s,
        )
        # 3) Credit gross quote proceeds.
        if quote_gross > 0:
            await credit(
                uid, _quote, quote_gross,
                txn_type="trade",
                ref_type="trade", ref_id=trade_id,
                meta={
                    "phase": "sell_proceeds",
                    "order_id": order_id,
                    "fill_price": fill_price,
                    "fill_amount": fill_amount,
                },
                session=s,
            )
        # 4) Charge IBO-denominated fee.
        if fee_ibo > 0:
            await debit(
                uid, "IBO", fee_ibo,
                txn_type="fee",
                ref_type="trade", ref_id=trade_id,
                meta={
                    "phase": "sell_fee",
                    "order_id": order_id,
                    "fee_rate": fee_rate,
                    "fee_asset": "IBO",
                    "fee_quote_notional": quote_gross,
                    "fee_quote_asset": _quote,
                    "ibo_price_usdt": float(ibo_price_usdt or 0.0),
                },
                session=s,
            )
        return fee_ibo, "IBO"

    return await _run_in_txn(session, _do)


# ─────────────────────────────────────────────────────────────────────────────
# Reads
# ─────────────────────────────────────────────────────────────────────────────

async def read_balance(uid: str, asset: str) -> Dict[str, float]:
    """Return the current ``available`` / ``locked`` for one wallet row."""
    db = get_db()
    return await _read_balance_in(db, uid, asset, session=None)


async def list_txns(
    *,
    uid: Optional[str] = None,
    asset: Optional[str] = None,
    txn_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    ref_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Paginated ledger query. Returns raw docs (minus Mongo ``_id``)."""
    db = get_db()
    q: Dict[str, Any] = {}
    if uid:
        q["uid"] = uid
    if asset:
        q["asset"] = asset.upper()
    if txn_type:
        q["type"] = txn_type
    if ref_id:
        q["ref_id"] = ref_id
    if ref_type:
        q["ref_type"] = ref_type
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["created_at"] = rng
    skip = max(0, int(skip))
    limit = max(1, min(int(limit), 500))
    cursor = (
        db[WALLET_TXNS]
        .find(q, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    return await cursor.to_list(limit)


async def count_txns(
    *,
    uid: Optional[str] = None,
    asset: Optional[str] = None,
    txn_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    ref_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> int:
    db = get_db()
    q: Dict[str, Any] = {}
    if uid:
        q["uid"] = uid
    if asset:
        q["asset"] = asset.upper()
    if txn_type:
        q["type"] = txn_type
    if ref_id:
        q["ref_id"] = ref_id
    if ref_type:
        q["ref_type"] = ref_type
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["created_at"] = rng
    return int(await db[WALLET_TXNS].count_documents(q))
