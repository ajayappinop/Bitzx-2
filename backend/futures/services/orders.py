"""Order lifecycle: place, cancel, list, history.

This is the only entry point a controller (REST/WS) should use to mutate
orders. It calls :mod:`matching` and :mod:`position` as needed.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services import ibo_fee as ibo_fee_svc
from services.errors import InsufficientFundsError

from ..constants import (
    MAKER_FEE_RATE,
    TAKER_FEE_RATE,
    COL_ORDERS,
    DEFAULT_MARGIN_MODE,
    MIN_ORDER_NOTIONAL_USDT,
)
from ..symbols import get_supported_symbols
from ..db import db
from . import controls as controls_svc
from . import ledger as fledger
from .ledger import safe_unlock as _safe_unlock
from . import matching as matching_svc
from . import mark_price as mark_price_svc
from . import position as position_svc
from . import risk

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


# ── Place ────────────────────────────────────────────────────────────────

async def place_order(uid: str, body: Any) -> Dict[str, Any]:
    """Validate, lock initial margin, insert order, run the matcher."""
    symbol = body.symbol
    side   = body.side
    type_  = body.type
    qty    = float(body.quantity)
    price  = float(body.price) if body.price is not None else None

    meta = get_supported_symbols().get(symbol) or {}
    if not meta:
        raise ValueError(f"unsupported symbol {symbol}")

    # Admin gates: global pause / per-symbol delisted / new orders paused.
    if await controls_svc.is_new_orders_paused():
        raise ValueError("futures trading is paused by the platform")
    if not await controls_svc.is_symbol_tradable(symbol):
        raise ValueError(f"{symbol} is not tradable right now")
    sym_cfg = await controls_svc.get_symbol_config(symbol)
    # Per-symbol overrides take precedence over the static metadata.
    meta = {**meta, **{k: sym_cfg.get(k) for k in ("tick_size", "lot_size", "min_qty", "max_qty", "max_leverage") if sym_cfg.get(k) is not None}}

    qty = risk.round_qty(symbol, qty)
    risk.validate_qty(symbol, qty)

    # Resolve a reference price for margin sizing
    ref_price = price
    if ref_price is None or ref_price <= 0:
        cached = mark_price_svc.get_cached(symbol)
        ref_price = float((cached or {}).get("mark_price") or 0.0)
        if ref_price <= 0:
            refreshed = await mark_price_svc.refresh(symbol)
            ref_price = float((refreshed or {}).get("mark_price") or 0.0)
    if ref_price is None or ref_price <= 0:
        raise ValueError("no reference price available — try again shortly")
    if price is not None:
        price = risk.round_price(symbol, price)
        ref_price = price

    controls_doc = await controls_svc.read_controls()
    min_notional = float(controls_doc.get("futures_min_notional_usdt", MIN_ORDER_NOTIONAL_USDT))
    notional = qty * float(ref_price)
    if notional < min_notional:
        raise ValueError(f"order notional below minimum ({min_notional} USDT)")

    # Resolve user's leverage / margin mode preference.
    settings = await position_svc.get_settings(uid, symbol)
    leverage = int(body.leverage or settings["leverage"])
    leverage_cap = int(controls_doc.get("futures_max_leverage_cap", 125))
    sym_lev_cap  = int(sym_cfg.get("max_leverage") or risk.max_leverage(symbol))
    leverage = max(1, min(leverage, sym_lev_cap, leverage_cap))
    margin_mode = settings["margin_mode"] or DEFAULT_MARGIN_MODE

    imr = risk.initial_margin_rate(symbol, notional, leverage)
    init_margin = _round(notional * imr)

    maker_r = float(controls_doc.get("futures_maker_fee_rate", MAKER_FEE_RATE))
    taker_r = float(controls_doc.get("futures_taker_fee_rate", TAKER_FEE_RATE))
    fee_rate_est = max(maker_r, taker_r)
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()
    est_fee_ibo = ibo_fee_svc.estimate_ibo_fee(
        quote_asset="USDT",
        quote_notional=notional,
        fee_rate=fee_rate_est,
        ibo_price_usdt=ibo_px,
    )
    if est_fee_ibo > 0:
        await ibo_fee_svc.ensure_ibo_fee_balance(uid, est_fee_ibo, context="futures")

    order_id = f"ford_{uuid.uuid4().hex[:18]}"
    order_doc: Dict[str, Any] = {
        "id": order_id,
        "uid": uid,
        "symbol": symbol,
        "side": side,
        "type": type_,
        "price": price,
        "stop_price": float(body.stop_price) if body.stop_price else None,
        "tp_price": float(body.take_profit_price) if body.take_profit_price else None,
        "sl_price": float(body.stop_loss_price) if body.stop_loss_price else None,
        "quantity": _round(qty),
        "filled": 0.0,
        "remaining": _round(qty),
        "tif": body.tif,
        "leverage": leverage,
        "margin_mode": margin_mode,
        "reduce_only": bool(body.reduce_only),
        "client_order_id": body.client_order_id,
        "init_margin": init_margin,
        "estimated_fee_ibo": float(est_fee_ibo),
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "status": "open" if type_ != "stop_limit" and type_ != "stop_market" else "triggered",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    if type_ in ("stop_limit", "stop_market") and body.stop_price:
        order_doc["status"] = "open"  # waiting for trigger; matcher checks stop fields

    # Reduce-only orders don't lock new margin; they only release it.
    if not body.reduce_only and init_margin > 0:
        try:
            await fledger.lock(
                uid, init_margin,
                ref_type="order", ref_id=order_id,
                meta={"symbol": symbol, "side": side, "type": type_, "leverage": leverage},
            )
        except InsufficientFundsError:
            raise

    await db()[COL_ORDERS].insert_one(order_doc)

    # For market and limit orders that aren't conditional triggers, run the
    # matcher immediately. Stops sit on the book and are activated by the
    # trigger scanner (see workers/liquidation_worker.py — same loop reuses).
    if type_ in ("market", "limit"):
        try:
            result = await matching_svc.run_matching(order_id)
        except Exception as match_exc:
            # The matching engine raised unexpectedly (should never happen after
            # the safe-fee-debit fix, but guard against future regressions).
            # Mark the order as rejected and release its margin lock so the
            # wallet is never left in a permanently depleted state.
            logger.error("run_matching raised for order %s: %s", order_id, match_exc)
            await db()[COL_ORDERS].update_one(
                {"id": order_id},
                {"$set": {
                    "status": "rejected",
                    "reject_reason": str(match_exc)[:300],
                    "updated_at": _now_iso(),
                }},
            )
            if not body.reduce_only and init_margin > 0:
                try:
                    await _safe_unlock(
                        uid, init_margin,
                        ref_type="order", ref_id=order_id,
                        meta={"symbol": symbol, "phase": "emergency_unlock"},
                    )
                except Exception as unlock_exc:
                    logger.error("emergency unlock failed for order %s: %s",
                                 order_id, unlock_exc)
            raise
    else:
        result = {"fills": [], "remaining": qty, "status": order_doc["status"]}

    # ── Release order-level margin lock ──────────────────────────────────────
    # The order lock IS the position's margin reservation — apply_fill no
    # longer adds a separate position lock (it was causing double-depletion of
    # available balance, leading to InsufficientFundsError and a partial DB
    # state where the position existed but the HTTP response said "Order
    # failed").
    #
    # Rules:
    #   filled / partially_filled / open → KEEP lock intact (it now backs the
    #     open position and/or the remaining order on the book).
    #   cancelled / rejected → release only the *unfilled* portion because the
    #     filled portion's lock is still needed by the open position.
    #     (cancel_order handles the user-initiated cancel path; this block
    #      covers immediate rejections from the matcher.)
    #
    # Reconcile (filled only): synthetic fill uses mark ± 5 bps as the fill
    # price, so the position's isolated_margin is computed at a slightly
    # different notional than init_margin.  For sell/short orders the fill
    # price is mark * 0.9995, making isolated_margin < init_margin and leaving
    # a tiny residual permanently stuck in `locked`.  We release the excess
    # here so it never accumulates.
    final = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    if final and not body.reduce_only and init_margin > 0:
        final_status = final.get("status", "")
        orig_qty     = float(final.get("quantity") or qty)
        remaining_qty = float(final.get("remaining") or orig_qty)
        to_unlock    = 0.0

        if final_status in ("cancelled", "rejected"):
            # Release only the unfilled (remaining) portion.
            unfilled_frac = remaining_qty / orig_qty if orig_qty > 0 else 1.0
            to_unlock = _round(init_margin * unfilled_frac)

        elif final_status == "filled":
            # Fully filled — reconcile init_margin vs actual position
            # isolated_margin to release any tiny excess caused by fill-price
            # deviation (synthetic slippage).
            pos_after = await position_svc.get_open(uid, symbol)
            if pos_after:
                pos_iso = float(pos_after.get("isolated_margin") or 0.0)
                excess  = _round(init_margin - pos_iso)
                if excess > 1e-8:
                    to_unlock = excess

        if to_unlock > 0:
            try:
                await _safe_unlock(
                    uid, to_unlock,
                    ref_type="order", ref_id=order_id,
                    meta={"symbol": symbol, "phase": "place_order_reconcile_unlock"},
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("place_order unlock failed: %s", exc)

    out = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    out["fills"] = result.get("fills", [])
    return out


# ── Cancel ────────────────────────────────────────────────────────────────

async def cancel_order(uid: str, order_id: str) -> Dict[str, Any]:
    o = await db()[COL_ORDERS].find_one(
        {"id": order_id, "uid": uid}, {"_id": 0}
    )
    if not o:
        raise ValueError("order not found")
    if o["status"] in ("cancelled", "filled", "rejected"):
        return o

    updated = await db()[COL_ORDERS].find_one_and_update(
        {"id": order_id, "uid": uid, "status": {"$in": ["open", "partially_filled"]}},
        {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        return_document=__import__("pymongo").ReturnDocument.AFTER,
    )
    if updated is None:
        raise ValueError("order not cancellable")

    # Refund unused margin proportional to remaining (unfilled) quantity.
    # The filled portion's lock must stay — it now backs the open position.
    # safe_unlock caps at the actual locked amount to handle edge cases where
    # the user already closed their position before cancelling the order.
    if not updated.get("reduce_only"):
        rem = float(updated.get("remaining") or 0.0)
        qty_total = float(updated.get("quantity") or 0.0)
        init_margin = float(updated.get("init_margin") or 0.0)
        if qty_total > 0 and rem > 0 and init_margin > 0:
            unused = _round(init_margin * (rem / qty_total))
            if unused > 0:
                try:
                    await _safe_unlock(
                        uid, unused,
                        ref_type="order", ref_id=order_id,
                        meta={"phase": "cancel_unlock"},
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("cancel unlock failed: %s", exc)
    out = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    return out


# ── Reads ─────────────────────────────────────────────────────────────────

async def list_open(uid: str, *, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"uid": uid, "status": {"$in": ["open", "partially_filled"]}}
    if symbol:
        q["symbol"] = symbol
    cur = db()[COL_ORDERS].find(q, {"_id": 0}).sort("created_at", -1).limit(200)
    return await cur.to_list(length=200)


async def list_history(uid: str, *, symbol: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"uid": uid, "status": {"$in": ["filled", "cancelled", "rejected"]}}
    if symbol:
        q["symbol"] = symbol
    cur = db()[COL_ORDERS].find(q, {"_id": 0}).sort("updated_at", -1).limit(int(limit))
    return await cur.to_list(length=int(limit))


async def list_user_trades(uid: str, *, symbol: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    from ..constants import COL_TRADES
    q: Dict[str, Any] = {"$or": [{"taker_uid": uid}, {"maker_uid": uid}]}
    if symbol:
        q["symbol"] = symbol
    cur = db()[COL_TRADES].find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    return await cur.to_list(length=int(limit))


async def market_trades(symbol: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    from ..constants import COL_TRADES
    cur = db()[COL_TRADES].find({"symbol": symbol}, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    return await cur.to_list(length=int(limit))


async def order_book(symbol: str, *, depth: int = 25) -> Dict[str, Any]:
    """Aggregate the live order book by price level for ``symbol``."""
    pipeline_buy = [
        {"$match": {
            "symbol": symbol, "side": "buy",
            "status": {"$in": ["open", "partially_filled"]},
        }},
        {"$group": {"_id": "$price", "qty": {"$sum": "$remaining"}}},
        {"$sort": {"_id": -1}},
        {"$limit": int(depth)},
    ]
    pipeline_sell = [
        {"$match": {
            "symbol": symbol, "side": "sell",
            "status": {"$in": ["open", "partially_filled"]},
        }},
        {"$group": {"_id": "$price", "qty": {"$sum": "$remaining"}}},
        {"$sort": {"_id": 1}},
        {"$limit": int(depth)},
    ]
    bids = [
        {"price": float(r["_id"] or 0), "qty": float(r["qty"] or 0)}
        async for r in db()[COL_ORDERS].aggregate(pipeline_buy)
        if r.get("_id") is not None
    ]
    asks = [
        {"price": float(r["_id"] or 0), "qty": float(r["qty"] or 0)}
        async for r in db()[COL_ORDERS].aggregate(pipeline_sell)
        if r.get("_id") is not None
    ]
    return {"symbol": symbol, "bids": bids, "asks": asks}
