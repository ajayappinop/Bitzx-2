"""Futures matching engine.

Adapted from the spot engine, but materially different:

- A fill **does not transfer the base asset** between two users; it
  changes their *positions*. So fills always settle through
  :func:`futures.services.position.apply_fill`.
- Margin is locked at order-place time (initial margin × size), not
  per-asset.
- The book lives in ``futures_orders`` (status ∈ {open, partially_filled})
  with price-time priority.
- A market order's residual quantity (after walking the book) optionally
  routes through a *system synthetic fill* using the latest mark price —
  same fallback pattern your spot engine uses today, so liquidity is
  never zero on a quiet book.

This module exposes one public entry point — :func:`run_matching` —
called from :func:`futures.services.orders.place_order`.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument

from ..constants import (
    COL_ORDERS,
    COL_TRADES,
    DEFAULT_MARGIN_MODE,
    MAKER_FEE_RATE,
    TAKER_FEE_RATE,
)
from ..db import db
from . import mark_price as mark_price_svc
from . import position as position_svc

logger = logging.getLogger(__name__)

_book_lock = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


async def _opposite_makers(symbol: str, side: str, *, limit_price: Optional[float]) -> List[Dict[str, Any]]:
    """Return makers that can fill ``side`` at ``limit_price`` (None = market).

    Buy taker → sell makers ascending price. Sell taker → buy makers
    descending price. Time priority via ``created_at`` ascending.
    """
    q: Dict[str, Any] = {
        "symbol": symbol,
        "status": {"$in": ["open", "partially_filled"]},
        "side": "sell" if side == "buy" else "buy",
    }
    if limit_price is not None:
        if side == "buy":
            q["price"] = {"$lte": float(limit_price)}
        else:
            q["price"] = {"$gte": float(limit_price)}
    sort = [("price", 1 if side == "buy" else -1), ("created_at", 1)]
    cur = db()[COL_ORDERS].find(q, {"_id": 0}).sort(sort).limit(50)
    return await cur.to_list(length=50)


async def _claim_maker(maker_id: str, fill_amount: float) -> Optional[Dict[str, Any]]:
    """Atomically deduct ``fill_amount`` from the maker's remaining size.

    Returns the updated maker doc on success, None if another taker beat
    us to it (in which case the caller skips it)."""
    return await db()[COL_ORDERS].find_one_and_update(
        {
            "id": maker_id,
            "status": {"$in": ["open", "partially_filled"]},
            "remaining": {"$gte": fill_amount - 1e-12},
        },
        {"$inc": {"remaining": -fill_amount, "filled": fill_amount}},
        return_document=ReturnDocument.AFTER,
    )


async def _finalize_order(order_id: str) -> Optional[Dict[str, Any]]:
    """Set status=filled when remaining hits 0, else partially_filled."""
    o = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    if not o:
        return None
    remaining = float(o.get("remaining") or 0.0)
    qty       = float(o.get("quantity") or 0.0)
    if remaining <= 1e-12:
        status = "filled"
    elif remaining < qty:
        status = "partially_filled"
    else:
        status = o.get("status") or "open"
    if status != o.get("status"):
        await db()[COL_ORDERS].update_one(
            {"id": order_id},
            {"$set": {"status": status, "updated_at": _now_iso()}},
        )
        o["status"] = status
    return o


async def _record_trade(
    *,
    taker: Dict[str, Any],
    maker: Optional[Dict[str, Any]],
    price: float,
    qty: float,
    is_synthetic: bool = False,
) -> Dict[str, Any]:
    trade = {
        "id": f"ftrd_{uuid.uuid4().hex[:18]}",
        "symbol": taker["symbol"],
        "price": _round(price),
        "qty": _round(qty),
        "side": taker["side"],
        "taker_uid": taker["uid"],
        "taker_order_id": taker["id"],
        "maker_uid": (maker or {}).get("uid") or "SYSTEM",
        "maker_order_id": (maker or {}).get("id"),
        "synthetic": bool(is_synthetic),
        "fee_rates": {"maker": MAKER_FEE_RATE, "taker": TAKER_FEE_RATE},
        "created_at": _now_iso(),
    }
    await db()[COL_TRADES].insert_one(trade)
    trade.pop("_id", None)  # insert_one injects ObjectId in-place; strip it so callers stay JSON-safe
    return trade


async def run_matching(taker_id: str) -> Dict[str, Any]:
    """Walk the book for ``taker_id`` and apply fills.

    Returns ``{"fills": [...], "remaining": float, "status": str}``.
    Acquires a global async lock so simulator/synthetic fills stay
    deterministic during dev; in production this should be sharded by
    symbol or removed in favour of optimistic concurrency on the makers.
    """
    async with _book_lock:
        taker = await db()[COL_ORDERS].find_one({"id": taker_id}, {"_id": 0})
        if not taker:
            return {"fills": [], "remaining": 0.0, "status": "missing"}
        if taker["status"] not in ("open", "partially_filled"):
            return {"fills": [], "remaining": 0.0, "status": taker["status"]}

        symbol = taker["symbol"]
        side   = taker["side"]
        is_market = taker["type"] == "market"
        limit_price = None if is_market else float(taker.get("price") or 0.0)
        remaining = float(taker.get("remaining") or 0.0)
        fills: List[Dict[str, Any]] = []
        leverage = int(taker.get("leverage") or 10)
        margin_mode = taker.get("margin_mode") or DEFAULT_MARGIN_MODE
        # init_margin per unit of qty — used to pass the exact locked amount
        # to apply_fill so isolated_margin mirrors the wallet lock precisely.
        taker_total_qty = float(taker.get("quantity") or 0.0) or 1.0
        taker_init_margin = float(taker.get("init_margin") or 0.0)

        # 1) Match against the book.
        taker_uid = taker.get("uid") or taker.get("user_id")
        makers = await _opposite_makers(symbol, side, limit_price=limit_price)
        for maker in makers:
            if remaining <= 1e-12:
                break
            # Skip self-trades: the same user's open orders must never fill
            # against each other.  This prevents a stale "open" order (left
            # by a previous failed match attempt) from being consumed by the
            # user's own close order, which would double the position.
            maker_uid = maker.get("uid") or maker.get("user_id")
            if maker_uid and taker_uid and maker_uid == taker_uid:
                continue
            avail = float(maker.get("remaining") or 0.0)
            if avail <= 0:
                continue
            fill_amt   = _round(min(avail, remaining))
            fill_price = float(maker.get("price") or 0.0)
            if fill_amt <= 0 or fill_price <= 0:
                continue
            updated_maker = await _claim_maker(maker["id"], fill_amt)
            if updated_maker is None:
                continue

            trade = await _record_trade(taker=taker, maker=updated_maker, price=fill_price, qty=fill_amt)

            # Pro-rate init_margin by fill fraction so isolated_margin in the
            # position exactly matches the wallet lock for this portion.
            taker_fill_margin  = _round(taker_init_margin * (fill_amt / taker_total_qty)) if taker_init_margin > 0 else 0.0
            maker_total_qty    = float(updated_maker.get("quantity") or 0.0) or 1.0
            maker_init_margin  = float(updated_maker.get("init_margin") or 0.0)
            maker_fill_margin  = _round(maker_init_margin * (fill_amt / maker_total_qty)) if maker_init_margin > 0 else 0.0

            # Settle both sides on positions.
            await position_svc.apply_fill(
                uid=taker["uid"], symbol=symbol, side=side,
                qty=fill_amt, price=fill_price, leverage=leverage,
                role="taker", order_id=taker["id"], trade_id=trade["id"],
                reduce_only=bool(taker.get("reduce_only")),
                margin_mode=margin_mode,
                locked_margin=taker_fill_margin,
            )
            await position_svc.apply_fill(
                uid=updated_maker["uid"], symbol=symbol,
                side=("sell" if side == "buy" else "buy"),
                qty=fill_amt, price=fill_price,
                leverage=int(updated_maker.get("leverage") or leverage),
                role="maker", order_id=updated_maker["id"], trade_id=trade["id"],
                reduce_only=bool(updated_maker.get("reduce_only")),
                margin_mode=updated_maker.get("margin_mode") or DEFAULT_MARGIN_MODE,
                locked_margin=maker_fill_margin,
            )

            await _finalize_order(updated_maker["id"])
            # The maker's order-level lock now serves as the position lock —
            # apply_fill no longer adds a separate position-level lock, so
            # there is nothing to "release" here. The lock will be freed when
            # the maker's position is closed (via apply_fill safe_unlock) or
            # when the maker cancels the remaining open portion of their order.

            await db()[COL_ORDERS].update_one(
                {"id": taker["id"]},
                {"$inc": {"remaining": -fill_amt, "filled": fill_amt},
                 "$set": {"updated_at": _now_iso()}},
            )
            taker["remaining"] = (float(taker.get("remaining") or 0.0)) - fill_amt
            taker["filled"]    = (float(taker.get("filled") or 0.0)) + fill_amt
            remaining -= fill_amt
            fills.append(trade)

        # 2) Synthetic fill for market orders OR crossing limit orders.
        #
        # Crossing limit: user set a BUY limit price >= current mark price
        # (or SELL limit price <= current mark price).  They want immediate
        # execution at the fair market rate, NOT at their inflated/deflated
        # limit price.  After the book walk consumed all visible liquidity,
        # any unfilled remainder is filled synthetically at mark price ± 5 bps
        # — identical to market orders.  The order type stays "limit" in the
        # database so trade history remains accurate.
        cached_snap   = mark_price_svc.get_cached(symbol)
        current_mark  = float((cached_snap or {}).get("mark_price") or 0.0)
        is_crossing_limit = (
            not is_market
            and limit_price is not None
            and current_mark > 0
            and (
                (side == "buy"  and limit_price >= current_mark)
                or
                (side == "sell" and limit_price <= current_mark)
            )
        )

        if (is_market or is_crossing_limit) and remaining > 1e-12:
            cached = mark_price_svc.get_cached(symbol)
            mp = float((cached or {}).get("mark_price") or 0.0)
            if mp <= 0:
                refreshed = await mark_price_svc.refresh(symbol)
                mp = float((refreshed or {}).get("mark_price") or 0.0)
            if mp > 0:
                slip = 0.0005   # 5 bps synthetic spread
                px   = mp * (1 + slip) if side == "buy" else mp * (1 - slip)
                trade = await _record_trade(
                    taker=taker, maker=None, price=px, qty=remaining,
                    is_synthetic=True,
                )
                # Pro-rate the remaining locked margin for this synthetic fill.
                synth_margin = _round(taker_init_margin * (remaining / taker_total_qty)) if taker_init_margin > 0 else 0.0
                await position_svc.apply_fill(
                    uid=taker["uid"], symbol=symbol, side=side,
                    qty=remaining, price=px, leverage=leverage,
                    role="taker", order_id=taker["id"], trade_id=trade["id"],
                    reduce_only=bool(taker.get("reduce_only")),
                    margin_mode=margin_mode,
                    locked_margin=synth_margin,
                )
                await db()[COL_ORDERS].update_one(
                    {"id": taker["id"]},
                    {"$inc": {"remaining": -remaining, "filled": remaining},
                     "$set": {"updated_at": _now_iso()}},
                )
                fills.append(trade)
                remaining = 0.0

        final = await _finalize_order(taker["id"])
        return {
            "fills": fills,
            "remaining": float((final or {}).get("remaining") or remaining),
            "status": (final or {}).get("status") or taker["status"],
        }
