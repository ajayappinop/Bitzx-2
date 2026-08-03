"""Phase 8 — treasury inventory accounting + risk envelope.

The platform acts as the implicit counterparty for any leftover quantity on a
market order (the ``maker_uid="SYSTEM"`` path inside ``run_matching_engine``).
Without a real liquidity provider that means the platform is literally taking
the other side: a user buying 1 ETH from SYSTEM leaves the platform short
1 ETH and long the corresponding USDT.

Phase 8 makes that exposure **visible and bounded**:

- **8a — accounting.** Every SYSTEM fill writes a mirror pair of
  ``wallet_txns`` rows on a special internal user (``TREASURY_UID``). The
  treasury balance is allowed to go *negative*: a negative ETH balance is the
  natural representation of "the platform owes 1 ETH to its users".
- **8b — spread.** SYSTEM fills price the user *worse* than the mark
  (``mark × (1 + spread)`` for buys, ``mark × (1 − spread)`` for sells). The
  difference is captured as treasury USDT revenue (one extra
  ``adjustment`` ledger row of type ``system_spread_pnl``).
- **8c — limits.** A per-symbol cap (``treasury_inventory_limit_base_*``)
  bounds how short / long the treasury can become. When a SYSTEM fill would
  breach the cap, the matching engine falls back to a partial fill (book +
  whatever the treasury can still absorb) and the unfilled remainder is
  refunded to the user.

Design notes:

- We deliberately do NOT use ``wallet_service.debit`` for the treasury side:
  ``debit`` enforces ``available >= amount`` which is exactly what we *want*
  to allow violating here. Instead :func:`apply_delta` does a raw signed
  ``$inc`` and writes the matching ledger row.
- All writes go through the ledger so :mod:`services.wallet_service` style
  reconciliation continues to work unchanged.
- ``meta`` carries the per-fill spread + capacity decisions so the admin
  treasury page can later show "5,200 USDT collected as spread on 312 fills"
  without scanning the trades collection.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Literal, Optional

from pymongo import ReturnDocument

from .db import get_db
from .wallet_service import (
    WALLETS,
    WALLET_TXNS,
    _read_balance_in,
    _round,
    _run_in_txn,
    _write_txn,
)

logger = logging.getLogger(__name__)

# Internal pseudo-user id for the platform's own balance sheet. Not a real
# row in ``users`` — never shows up in admin user lists, never owns orders.
# Hard-coded so it can never collide with a generated uid (real uids are
# ``usr_<hex>``).
TREASURY_UID: str = "__TREASURY__"

Side = Literal["buy", "sell"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap
# ─────────────────────────────────────────────────────────────────────────────

async def ensure_treasury_wallet(asset: str, *, session=None) -> Dict[str, Any]:
    """Idempotent: create the treasury wallet row for ``asset`` if missing.

    Treasury rows look exactly like any user wallet row (so the existing
    aggregations, indexes, and ledger work unchanged), but the ``uid`` is
    the special :data:`TREASURY_UID` value and we tag the row with
    ``role: "treasury"`` so admin listings can filter it out.
    """
    db = get_db()
    if db is None:
        return {"available": 0.0, "locked": 0.0}
    now = _now_iso()
    await db[WALLETS].update_one(
        {"uid": TREASURY_UID, "asset": asset},
        {
            "$setOnInsert": {
                "uid": TREASURY_UID,
                "asset": asset,
                "available": 0.0,
                "locked": 0.0,
                "role": "treasury",
                "created_at": now,
            },
            "$set": {"updated_at": now},
        },
        upsert=True,
        session=session,
    )
    return await _read_balance_in(db, TREASURY_UID, asset, session)


async def bootstrap(assets: Iterable[str]) -> None:
    """Ensure a treasury wallet row exists for every asset we list.

    Called once at server startup with ``SYMBOL_BASE_MAP`` bases + USDT.
    Safe to call repeatedly — every operation is an upsert.
    """
    for asset in {(a or "").upper() for a in assets if a}:
        if not asset:
            continue
        await ensure_treasury_wallet(asset)


async def stamp_started_at(controls_collection, *, when: Optional[str] = None) -> str:
    """Write ``treasury_started_at`` into platform_controls if not already set.

    Returns the effective timestamp. Idempotent: subsequent calls are no-ops
    so the cutover moment is preserved across restarts.
    """
    when = when or _now_iso()
    doc = await controls_collection.find_one(
        {"id": "global"}, {"_id": 0, "treasury_started_at": 1},
    )
    if doc and doc.get("treasury_started_at"):
        return str(doc["treasury_started_at"])
    await controls_collection.update_one(
        {"id": "global"},
        {
            "$setOnInsert": {"id": "global"},
            "$set": {"treasury_started_at": when},
        },
        upsert=True,
    )
    return when


# ─────────────────────────────────────────────────────────────────────────────
# Signed-delta primitive (allows negative balance — the whole point)
# ─────────────────────────────────────────────────────────────────────────────

async def apply_delta(
    asset: str,
    delta: float,
    *,
    txn_type: str,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Atomically ``$inc`` the treasury ``available`` by ``delta`` (signed).

    Unlike :func:`wallet_service.credit` / :func:`wallet_service.debit`, this
    helper does NOT enforce a non-negative balance — the treasury legitimately
    goes negative when it owes inventory to users.

    Always writes a ``wallet_txns`` row so the ledger stays authoritative.
    Direction is derived from the sign of ``delta``.
    """
    if delta is None or abs(float(delta)) < 1e-15:
        # Skip zero-delta calls so we don't pollute the ledger with no-ops.
        # Caller can still pass a meaningful ref_id to attach context — it
        # just won't produce a row.
        return {}
    amt = float(delta)
    direction = "credit" if amt > 0 else "debit"
    abs_amt = abs(amt)
    db = get_db()
    if db is None:
        return {}

    async def _do(s):
        # Ensure the row exists before reading its before-state. The upsert
        # in ``ensure_treasury_wallet`` is what makes the ``$inc`` below work
        # against fresh deployments.
        await ensure_treasury_wallet(asset, session=s)
        before = await _read_balance_in(db, TREASURY_UID, asset, s)
        now = _now_iso()
        updated = await db[WALLETS].find_one_and_update(
            {"uid": TREASURY_UID, "asset": asset},
            {"$inc": {"available": amt}, "$set": {"updated_at": now}},
            session=s,
            return_document=ReturnDocument.AFTER,
        )
        after = {
            "available": float((updated or {}).get("available") or 0.0),
            "locked": float((updated or {}).get("locked") or 0.0),
        }
        return await _write_txn(
            db,
            uid=TREASURY_UID,
            asset=asset,
            txn_type=txn_type,
            direction=direction,
            amount=abs_amt,
            balance_before=before,
            balance_after=after,
            ref_type=ref_type,
            ref_id=ref_id,
            meta=meta,
            session=s,
        )

    return await _run_in_txn(session, _do)


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM-fill mirror
# ─────────────────────────────────────────────────────────────────────────────

async def record_system_fill(
    *,
    side: Side,
    base_asset: str,
    fill_amount: float,
    fill_price_user: float,
    mark_price: float,
    spread_bps: float,
    trade_id: str,
    order_id: str,
    user_uid: str,
    session=None,
) -> Dict[str, float]:
    """Mirror one SYSTEM fill onto the treasury ledger.

    Convention:

    - ``fill_price_user`` is the price the **user** transacted at (already
      adjusted for spread by the caller).
    - ``mark_price`` is the unadjusted reference price (Binance ticker).
    - The difference between the two * fill_amount is the spread revenue.

    Returns a small dict useful for the trade row / logging::

        {
          "treasury_base_delta":   -fill_amount  if side == "buy" else +fill_amount,
          "treasury_quote_delta":  +user_paid    if side == "buy" else -user_received,
          "spread_revenue_usdt":   nonnegative,
        }
    """
    fill_amount = float(fill_amount)
    fill_price_user = float(fill_price_user)
    mark_price = float(mark_price)
    base = (base_asset or "").upper()
    quote_amount_user = fill_amount * fill_price_user

    if side == "buy":
        # User bought from us → treasury releases ``fill_amount`` base, gets
        # ``quote_amount_user`` USDT (which already includes our spread).
        base_delta  = -fill_amount
        quote_delta = +quote_amount_user
        # Spread revenue is positive when fill_price_user > mark.
        spread_rev = (fill_price_user - mark_price) * fill_amount
    else:
        # User sold to us → treasury absorbs ``fill_amount`` base, pays
        # ``quote_amount_user`` USDT (less than mark thanks to spread).
        base_delta  = +fill_amount
        quote_delta = -quote_amount_user
        spread_rev = (mark_price - fill_price_user) * fill_amount

    meta = {
        "trade_id": trade_id,
        "order_id": order_id,
        "user_uid": user_uid,
        "side": side,
        "fill_amount": _round(fill_amount),
        "fill_price_user": _round(fill_price_user),
        "mark_price": _round(mark_price),
        "spread_bps": _round(spread_bps),
    }

    # Mirror the base-asset leg first (the inventory move).
    await apply_delta(
        base, base_delta,
        txn_type="trade",
        ref_type="trade",
        ref_id=trade_id,
        meta=meta,
        session=session,
    )

    # Quote leg (USDT). Recorded as a separate row so the per-asset trail
    # stays clean. The same trade_id stitches them together.
    if abs(quote_delta) > 1e-12:
        await apply_delta(
            "USDT", quote_delta,
            txn_type="trade",
            ref_type="trade",
            ref_id=trade_id,
            meta=meta,
            session=session,
        )

    # Spread revenue is just bookkeeping — the USDT was already moved by
    # the leg above. We record an additional row of type ``system_spread_pnl``
    # with delta=0 so reports can group on it without double-counting.
    # (We use a near-zero rounded amount to satisfy ``apply_delta``'s skip
    # threshold by passing it via meta only.)
    if abs(spread_rev) > 1e-12:
        db = get_db()
        if db is not None:
            now = _now_iso()
            spread_doc: Dict[str, Any] = {
                "id": f"tx_{uuid.uuid4().hex[:20]}",
                "uid": TREASURY_UID,
                "asset": "USDT",
                "type": "system_spread_pnl",
                "direction": "credit" if spread_rev > 0 else "debit",
                "amount": _round(abs(spread_rev)),
                "balance_before": {"available": 0.0, "locked": 0.0},
                "balance_after":  {"available": 0.0, "locked": 0.0},
                "ref_type": "trade",
                "ref_id":   trade_id,
                "meta": {**meta, "kind": "spread_pnl"},
                "status": "completed",
                "created_at": now,
            }
            await db[WALLET_TXNS].insert_one(spread_doc, session=session)
            spread_doc.pop("_id", None)

    return {
        "treasury_base_delta":  _round(base_delta),
        "treasury_quote_delta": _round(quote_delta),
        "spread_revenue_usdt":  _round(spread_rev),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Inventory cap math
# ─────────────────────────────────────────────────────────────────────────────

def system_capacity(
    *,
    side: Side,
    requested_qty: float,
    treasury_position_base: float,
    inventory_limit_base: Optional[float],
) -> float:
    """How much of ``requested_qty`` the SYSTEM may fill before breaching the cap.

    - ``treasury_position_base`` is the *current* treasury ``available``
      balance for the base asset (signed — negative means short).
    - ``inventory_limit_base`` is the per-symbol absolute cap. ``None`` or
      ``0`` means uncapped (legacy behaviour).
    - For a **buy** from SYSTEM (user buys → treasury goes more negative):
      capacity = ``inventory_limit_base + treasury_position_base`` clamped to
      ``[0, requested_qty]``.
    - For a **sell** to SYSTEM (user sells → treasury goes more positive):
      capacity = ``inventory_limit_base - treasury_position_base`` clamped.

    Returns 0 when the cap is already breached, ``requested_qty`` when the
    cap allows the full fill (or no cap is set).
    """
    if inventory_limit_base is None or inventory_limit_base <= 0:
        return float(requested_qty)
    pos = float(treasury_position_base)
    lim = float(inventory_limit_base)
    if side == "buy":
        cap = lim + pos        # how much more we can owe before hitting -lim
    else:
        cap = lim - pos        # how much more we can hold before hitting +lim
    if cap <= 0:
        return 0.0
    return min(float(requested_qty), cap)


async def get_position(asset: str) -> float:
    """Return the current treasury ``available`` balance for ``asset``.

    Negative means short. Returns 0.0 when the wallet doc doesn't exist
    yet (e.g. asset never traded against SYSTEM).
    """
    db = get_db()
    if db is None:
        return 0.0
    doc = await db[WALLETS].find_one(
        {"uid": TREASURY_UID, "asset": (asset or "").upper()},
        {"available": 1, "_id": 0},
    )
    if not doc:
        return 0.0
    try:
        return float(doc.get("available") or 0.0)
    except (TypeError, ValueError):
        return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Reporting helpers (admin /api/admin/treasury endpoint)
# ─────────────────────────────────────────────────────────────────────────────

async def list_wallets() -> List[Dict[str, Any]]:
    """All treasury wallet rows, regardless of balance."""
    db = get_db()
    if db is None:
        return []
    cur = db[WALLETS].find(
        {"uid": TREASURY_UID},
        {"_id": 0, "asset": 1, "available": 1, "locked": 1, "updated_at": 1},
    )
    return await cur.to_list(length=500)


async def aggregate_spread_revenue() -> Dict[str, Any]:
    """Total USDT spread revenue collected since cutover.

    Returns ``{"total_usdt": <float>, "fill_count": <int>}``.
    """
    db = get_db()
    if db is None:
        return {"total_usdt": 0.0, "fill_count": 0}
    pipeline = [
        {"$match": {"uid": TREASURY_UID, "type": "system_spread_pnl"}},
        {
            "$group": {
                "_id": None,
                "total": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$direction", "credit"]},
                            "$amount",
                            {"$multiply": ["$amount", -1]},
                        ],
                    },
                },
                "count": {"$sum": 1},
            },
        },
    ]
    cur = db[WALLET_TXNS].aggregate(pipeline)
    docs = await cur.to_list(length=1)
    if not docs:
        return {"total_usdt": 0.0, "fill_count": 0}
    return {
        "total_usdt": _round(float(docs[0].get("total") or 0.0)),
        "fill_count": int(docs[0].get("count") or 0),
    }


async def aggregate_fills_by_asset() -> Dict[str, Dict[str, float]]:
    """Per-base-asset SYSTEM-fill volume + count.

    Used by the admin treasury page to show "we've filled 12.3 ETH in 47
    trades since cutover". Source of truth is the ``trade`` ledger rows on
    the treasury account.
    """
    db = get_db()
    if db is None:
        return {}
    pipeline = [
        {"$match": {"uid": TREASURY_UID, "type": "trade"}},
        {
            "$group": {
                "_id": "$asset",
                "in":  {"$sum": {"$cond": [{"$eq": ["$direction", "credit"]}, "$amount", 0.0]}},
                "out": {"$sum": {"$cond": [{"$eq": ["$direction", "debit"]},  "$amount", 0.0]}},
                "fills": {"$sum": 1},
            },
        },
    ]
    cur = db[WALLET_TXNS].aggregate(pipeline)
    out: Dict[str, Dict[str, float]] = {}
    async for d in cur:
        ast = str(d.get("_id") or "").upper()
        if not ast:
            continue
        out[ast] = {
            "inflow":  _round(float(d.get("in") or 0.0)),
            "outflow": _round(float(d.get("out") or 0.0)),
            "fill_legs": int(d.get("fills") or 0),
        }
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Custody mirroring (deposits / withdrawals → treasury reserves)
# ─────────────────────────────────────────────────────────────────────────────

async def record_custody_deposit(
    asset: str,
    amount: float,
    *,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Mirror an inbound user deposit onto the treasury custody ledger (+asset)."""
    return await apply_delta(
        asset,
        float(amount),
        txn_type="deposit_custody",
        ref_type=ref_type,
        ref_id=ref_id,
        meta=meta,
        session=session,
    )


async def record_custody_withdrawal(
    asset: str,
    amount: float,
    *,
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> Dict[str, Any]:
    """Mirror an outbound withdrawal from treasury custody (−asset)."""
    return await apply_delta(
        asset,
        -float(amount),
        txn_type="withdrawal_custody",
        ref_type=ref_type,
        ref_id=ref_id,
        meta=meta,
        session=session,
    )


async def aggregate_user_liabilities() -> Dict[str, float]:
    """Sum of all user wallet balances by asset (excludes treasury pseudo-user)."""
    db = get_db()
    if db is None:
        return {}
    pipe = [
        {"$match": {"uid": {"$ne": TREASURY_UID}}},
        {
            "$project": {
                "asset": 1,
                "bal": {"$add": [{"$ifNull": ["$available", 0]}, {"$ifNull": ["$locked", 0]}]},
            },
        },
        {"$group": {"_id": "$asset", "total": {"$sum": "$bal"}}},
    ]
    rows = await db[WALLETS].aggregate(pipe).to_list(length=500)
    out: Dict[str, float] = {}
    for row in rows:
        ast = str(row.get("_id") or "").upper()
        if not ast:
            continue
        out[ast] = _round(float(row.get("total") or 0.0))
    return out


async def _aggregate_custody_mirrored() -> Dict[str, float]:
    """Net custody already mirrored on the treasury ledger."""
    db = get_db()
    if db is None:
        return {}
    pipe = [
        {
            "$match": {
                "uid": TREASURY_UID,
                "type": {"$in": ["deposit_custody", "withdrawal_custody", "custody_sync"]},
            },
        },
        {
            "$group": {
                "_id": "$asset",
                "net": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$direction", "credit"]},
                            "$amount",
                            {"$multiply": ["$amount", -1]},
                        ],
                    },
                },
            },
        },
    ]
    rows = await db[WALLET_TXNS].aggregate(pipe).to_list(length=500)
    out: Dict[str, float] = {}
    for row in rows:
        ast = str(row.get("_id") or "").upper()
        if not ast:
            continue
        out[ast] = _round(float(row.get("net") or 0.0))
    return out


async def _aggregate_credited_deposits() -> Dict[str, float]:
    db = get_db()
    if db is None:
        return {}
    pipe = [
        {"$match": {"status": "credited"}},
        {
            "$group": {
                "_id": "$asset",
                "total": {
                    "$sum": {
                        "$ifNull": ["$credited_amount", {"$ifNull": ["$amount", 0]}],
                    },
                },
            },
        },
    ]
    rows = await db.deposit_events.aggregate(pipe).to_list(length=500)
    out: Dict[str, float] = {}
    for row in rows:
        ast = str(row.get("_id") or "").upper()
        if not ast:
            continue
        out[ast] = _round(float(row.get("total") or 0.0))
    return out


async def _aggregate_confirmed_withdrawals() -> Dict[str, float]:
    db = get_db()
    if db is None:
        return {}
    pipe = [
        {"$match": {"status": "confirmed"}},
        {"$group": {"_id": "$asset", "total": {"$sum": {"$ifNull": ["$amount", 0]}}}},
    ]
    rows = await db.withdrawal_requests.aggregate(pipe).to_list(length=500)
    out: Dict[str, float] = {}
    for row in rows:
        ast = str(row.get("_id") or "").upper()
        if not ast:
            continue
        out[ast] = _round(float(row.get("total") or 0.0))
    return out


async def get_custody_reserves_summary() -> Dict[str, Any]:
    """Expected treasury custody (credited deposits − confirmed withdrawals) vs ledger mirror."""
    credited = await _aggregate_credited_deposits()
    withdrawn = await _aggregate_confirmed_withdrawals()
    mirrored = await _aggregate_custody_mirrored()
    assets = sorted({*credited.keys(), *withdrawn.keys(), *mirrored.keys()})
    rows: List[Dict[str, Any]] = []
    for ast in assets:
        expected = _round(float(credited.get(ast, 0.0)) - float(withdrawn.get(ast, 0.0)))
        recorded = float(mirrored.get(ast, 0.0))
        gap = _round(expected - recorded)
        if abs(expected) < 1e-12 and abs(recorded) < 1e-12:
            continue
        rows.append({
            "asset": ast,
            "expected_net": expected,
            "mirrored_net": _round(recorded),
            "sync_gap": gap,
        })
    return {
        "rows": rows,
        "totals": {
            "expected_by_asset": credited,
            "withdrawn_by_asset": withdrawn,
            "mirrored_by_asset": mirrored,
        },
    }


async def sync_custody_from_events() -> Dict[str, Any]:
    """Backfill treasury custody rows from credited deposits minus confirmed withdrawals.

    Safe to run repeatedly — only applies the gap between event totals and
    custody ledger rows already mirrored.
    """
    credited = await _aggregate_credited_deposits()
    withdrawn = await _aggregate_confirmed_withdrawals()
    mirrored = await _aggregate_custody_mirrored()
    assets = sorted({*credited.keys(), *withdrawn.keys(), *mirrored.keys()})
    adjustments: List[Dict[str, Any]] = []
    for ast in assets:
        expected = _round(float(credited.get(ast, 0.0)) - float(withdrawn.get(ast, 0.0)))
        recorded = float(mirrored.get(ast, 0.0))
        gap = _round(expected - recorded)
        if abs(gap) < 1e-12:
            continue
        await apply_delta(
            ast,
            gap,
            txn_type="custody_sync",
            ref_type="custody_sync",
            ref_id=f"sync_{uuid.uuid4().hex[:12]}",
            meta={"expected_net": expected, "recorded_net": recorded, "gap": gap},
        )
        adjustments.append({"asset": ast, "gap": gap, "expected_net": expected, "recorded_net": recorded})
    return {"adjustments": adjustments, "asset_count": len(adjustments)}
