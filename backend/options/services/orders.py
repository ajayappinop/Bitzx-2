"""Options order lifecycle (v1: limit only; sell must be reduce_only)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument

from services import ibo_fee as ibo_fee_svc
from services.errors import InsufficientFundsError

from ..constants import COL_ORDERS, MIN_PREMIUM_LOCK_USDT, ORDER_TYPES
from ..db import db
from ..fee_sink import get_fee_sink_uid
from . import contracts as contracts_svc
from . import controls as controls_svc
from . import ledger as oledger
from . import matching as match_svc
from . import positions as pos_svc

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


def _round_qty(contract: Dict[str, Any], qty: float) -> float:
    lot = float(contract.get("lot_size") or 1.0)
    if lot <= 0:
        return _round(qty)
    return _round(round(qty / lot) * lot)


def _round_price(contract: Dict[str, Any], price: float) -> float:
    tick = float(contract.get("tick_size") or 0.01)
    if tick <= 0:
        return _round(price)
    return _round(round(price / tick) * tick)


async def place_order(uid: str, body: Any) -> Dict[str, Any]:
    if await controls_svc.is_trading_blocked():
        raise ValueError("options trading is paused")
    if await controls_svc.is_new_orders_blocked():
        raise ValueError("new options orders are paused")

    contract = await contracts_svc.get(body.contract_id)
    if not contract:
        raise ValueError("unknown contract")
    if not await contracts_svc.is_tradable(body.contract_id):
        raise ValueError("contract is not tradable")

    if body.type.lower() not in ORDER_TYPES:
        raise ValueError(f"supported order types: {ORDER_TYPES}")

    otype = body.type.lower()
    tif = (getattr(body, "time_in_force", None) or "gtc").lower()
    post_only = bool(getattr(body, "post_only", False))

    side = body.side.lower()
    if side not in ("buy", "sell"):
        raise ValueError("invalid side")
    if side == "sell" and not body.reduce_only:
        raise ValueError("opening short options is not enabled — use reduce_only to close longs")

    qty = _round_qty(contract, float(body.quantity))
    min_q = float(contract.get("min_qty") or 1.0)
    max_q = float(contract.get("max_qty") or 1e18)
    if qty < min_q:
        raise ValueError(f"quantity below minimum ({min_q})")
    if qty > max_q:
        raise ValueError(f"quantity above maximum ({max_q})")

    price = _round_price(contract, float(body.price)) if otype == "limit" else 0.0
    if otype == "limit" and price <= 0:
        raise ValueError("invalid price")
    if otype == "market":
        slip = 0.0005
        if await controls_svc.synthetic_fills_enabled():
            from . import ticker as ticker_svc

            tick = await ticker_svc.get_ticker(contract["id"], use_cache=True)
            mp = float((tick or {}).get("mark_price") or (tick or {}).get("last_price") or 0.0)
            if mp > 0:
                px = mp * (1 + slip) if side == "buy" else mp * (1 - slip)
                price = _round_price(contract, px)
        if price <= 0:
            from . import orderbook as ob_svc

            snap = await ob_svc.depth_snapshot(contract["id"], levels=5)
            if side == "buy":
                asks = snap.get("asks") or []
                if not asks:
                    raise ValueError("no liquidity for market buy")
                price = _round_price(contract, float(asks[0][0]))
            else:
                bids = snap.get("bids") or []
                if not bids:
                    raise ValueError("no liquidity for market sell")
                price = _round_price(contract, float(bids[0][0]))

    if side == "sell":
        pos = await pos_svc.get_position(uid, contract["id"])
        if not pos or float(pos.get("qty") or 0) + 1e-12 < qty:
            raise ValueError("insufficient long position for reduce_only sell")

    premium_usdt = _round(price * qty)
    if side == "buy" and premium_usdt < MIN_PREMIUM_LOCK_USDT:
        raise ValueError(f"order premium lock below minimum ({MIN_PREMIUM_LOCK_USDT} USDT)")

    taker_r, maker_r = await controls_svc.effective_fee_rates()
    if float(maker_r) < -1e-12 and not get_fee_sink_uid():
        raise ValueError(
            "maker rebates are disabled until OPTIONS_FEE_SINK_UID is set (IBO rebates debit the spot fee sink wallet)"
        )

    fee_rate_est = max(float(taker_r), max(0.0, float(maker_r)))
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()
    est_fee_ibo = ibo_fee_svc.estimate_ibo_fee(
        quote_asset="USDT",
        quote_notional=premium_usdt,
        fee_rate=fee_rate_est,
        ibo_price_usdt=ibo_px,
    )
    if est_fee_ibo > 0:
        await ibo_fee_svc.ensure_ibo_fee_balance(uid, est_fee_ibo, context="options")

    notional_lock = premium_usdt if side == "buy" else 0.0

    order_id = f"optord_{uuid.uuid4().hex[:16]}"
    order_doc: Dict[str, Any] = {
        "id": order_id,
        "uid": uid,
        "contract_id": contract["id"],
        "side": side,
        "type": otype,
        "price": price,
        "quantity": qty,
        "filled": 0.0,
        "remaining": qty,
        "reduce_only": bool(body.reduce_only),
        "post_only": post_only,
        "time_in_force": tif,
        "init_lock": notional_lock if side == "buy" else 0.0,
        "estimated_fee_ibo": float(est_fee_ibo),
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "status": "open",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    if side == "buy" and notional_lock > 0:
        try:
            await oledger.lock(
                uid,
                notional_lock,
                ref_type="order",
                ref_id=order_id,
                meta={"contract_id": contract["id"], "side": side, "price": price},
            )
        except InsufficientFundsError:
            raise

    await db()[COL_ORDERS].insert_one(order_doc)

    result = await match_svc.run_matching(order_id)

    out = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    out["fills"] = result.get("fills", [])
    if out and out.get("status") in ("open", "partially_filled") and tif in ("ioc", "fok"):
        rem = float(out.get("remaining") or 0.0)
        filled = float(out.get("filled") or 0.0)
        if tif == "fok" and rem > 1e-12:
            await cancel_order(uid, order_id)
            out = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
        elif tif == "ioc" and rem > 1e-12:
            await cancel_order(uid, order_id)
            out = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    return out


async def cancel_order(uid: str, order_id: str) -> Dict[str, Any]:
    o = await db()[COL_ORDERS].find_one({"id": order_id, "uid": uid}, {"_id": 0})
    if not o:
        raise ValueError("order not found")
    if o["status"] in ("cancelled", "filled", "rejected"):
        return o

    updated = await db()[COL_ORDERS].find_one_and_update(
        {"id": order_id, "uid": uid, "status": {"$in": ["open", "partially_filled"]}},
        {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise ValueError("order not cancellable")

    if updated.get("side") == "buy":
        rem = float(updated.get("remaining") or 0.0)
        lim = float(updated.get("price") or 0.0)
        pad = float(updated.get("fee_lock_pad") or 0.0)
        unused = _round(rem * lim * (1.0 + pad)) if pad > 0 else _round(rem * lim)
        if unused > 0:
            try:
                await oledger.unlock(
                    uid,
                    unused,
                    ref_type="order",
                    ref_id=order_id,
                    meta={"phase": "cancel_unlock"},
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("options cancel unlock failed: %s", exc)

    return await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})


async def cancel_order_system(order_id: str) -> Dict[str, Any]:
    """Cancel an order by id (admin / settlement). Same unlock rules as ``cancel_order``."""
    o = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise ValueError("order not found")
    if o["status"] in ("cancelled", "filled", "rejected"):
        return o

    updated = await db()[COL_ORDERS].find_one_and_update(
        {"id": order_id, "status": {"$in": ["open", "partially_filled"]}},
        {"$set": {"status": "cancelled", "updated_at": _now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise ValueError("order not cancellable")

    uid = str(updated.get("uid") or "")
    if updated.get("side") == "buy" and uid:
        rem = float(updated.get("remaining") or 0.0)
        lim = float(updated.get("price") or 0.0)
        pad = float(updated.get("fee_lock_pad") or 0.0)
        unused = _round(rem * lim * (1.0 + pad)) if pad > 0 else _round(rem * lim)
        if unused > 0:
            try:
                await oledger.unlock(
                    uid,
                    unused,
                    ref_type="order",
                    ref_id=order_id,
                    meta={"phase": "cancel_unlock", "system": True},
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("options system cancel unlock failed: %s", exc)

    return await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})


async def cancel_all_open_for_contract(contract_id: str) -> Dict[str, int]:
    cur = db()[COL_ORDERS].find(
        {"contract_id": contract_id, "status": {"$in": ["open", "partially_filled"]}},
        {"id": 1},
    )
    rows = await cur.to_list(length=10_000)
    n = 0
    for row in rows:
        try:
            await cancel_order_system(str(row["id"]))
            n += 1
        except ValueError:
            continue
    return {"cancelled_orders": n}


async def list_open(uid: str, *, contract_id: Optional[str] = None) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"uid": uid, "status": {"$in": ["open", "partially_filled"]}}
    if contract_id:
        q["contract_id"] = contract_id
    cur = db()[COL_ORDERS].find(q, {"_id": 0}).sort("created_at", -1).limit(200)
    return await cur.to_list(length=200)


async def list_history(uid: str, *, contract_id: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"uid": uid, "status": {"$in": ["filled", "cancelled", "rejected"]}}
    if contract_id:
        q["contract_id"] = contract_id
    cur = db()[COL_ORDERS].find(q, {"_id": 0}).sort("updated_at", -1).limit(int(limit))
    return await cur.to_list(length=int(limit))


async def list_user_trades(uid: str, *, contract_id: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    from ..constants import COL_TRADES

    q: Dict[str, Any] = {"$or": [{"taker_uid": uid}, {"maker_uid": uid}]}
    if contract_id:
        q["contract_id"] = contract_id
    cur = db()[COL_TRADES].find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit))
    return await cur.to_list(length=int(limit))
