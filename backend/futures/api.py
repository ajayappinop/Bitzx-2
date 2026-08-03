"""REST router for the futures module.

Mounted at ``/api/futures/...``. Endpoints are intentionally small —
they validate input, delegate to a service, and shape the response.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from services.errors import InsufficientFundsError

from .constants import (
    ALLOWED_LEVERAGE,
    LEVERAGE_TIERS,
    MIN_ORDER_NOTIONAL_USDT,
)
from .symbols import get_supported_symbols
from .deps import current_user
from .models import (
    ClosePositionRequest,
    LeverageUpdateRequest,
    MarginModeUpdateRequest,
    OrderCancelRequest,
    OrderCreateRequest,
    TransferRequest,
)
from .services import (
    funding as funding_svc,
    ledger as fledger,
    mark_price as mark_price_svc,
    orders as orders_svc,
    position as position_svc,
    risk,
    wallet as wallet_svc,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/futures", tags=["futures"])


# ── Catalog / market data ────────────────────────────────────────────────

@router.get("/symbols")
async def list_symbols():
    out = []
    for sym, meta in get_supported_symbols().items():
        tiers = LEVERAGE_TIERS.get(sym) or []
        max_lev = int(tiers[0][1]) if tiers else 10
        out.append({
            "symbol": sym,
            "base":   meta["base"],
            "quote":  meta["quote"],
            "tick_size": meta["tick_size"],
            "lot_size":  meta["lot_size"],
            "min_qty":   meta["min_qty"],
            "max_qty":   meta["max_qty"],
            "max_leverage": max_lev,
            "min_notional": MIN_ORDER_NOTIONAL_USDT,
            "binance_symbol": meta["binance_symbol"],
        })
    return {"symbols": out, "leverage_options": ALLOWED_LEVERAGE}


@router.get("/mark-price")
async def get_mark_price(symbol: str = Query(..., min_length=3)):
    cached = mark_price_svc.get_cached(symbol)
    if not cached:
        cached = await mark_price_svc.refresh(symbol)
    return cached or {"symbol": symbol, "mark_price": None}


@router.get("/orderbook")
async def get_orderbook(symbol: str = Query(...), depth: int = Query(25, ge=1, le=100)):
    return await orders_svc.order_book(symbol, depth=depth)


@router.get("/trades")
async def get_market_trades(symbol: str = Query(...), limit: int = Query(50, ge=1, le=200)):
    return {"symbol": symbol, "trades": await orders_svc.market_trades(symbol, limit=limit)}


@router.get("/funding-rate")
async def latest_funding_rate(symbol: str = Query(...)):
    from .constants import COL_FUNDING_RATES
    from .db import db
    doc = await db()[COL_FUNDING_RATES].find_one(
        {"symbol": symbol}, {"_id": 0}, sort=[("settled_at", -1)]
    )
    return doc or {"symbol": symbol, "rate": None}


# ── Wallet ───────────────────────────────────────────────────────────────

@router.get("/wallet")
async def wallet(user: dict = Depends(current_user)):
    return await wallet_svc.snapshot(user["uid"])


@router.post("/wallet/transfer")
async def wallet_transfer(body: TransferRequest, user: dict = Depends(current_user)):
    try:
        if body.direction == "spot_to_futures":
            return await wallet_svc.transfer_in(user["uid"], body.amount, asset=body.asset)
        return await wallet_svc.transfer_out(user["uid"], body.amount, asset=body.asset)
    except InsufficientFundsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/wallet/txns")
async def wallet_txns(
    limit: int = Query(50, ge=1, le=500),
    skip:  int = Query(0, ge=0),
    user: dict = Depends(current_user),
):
    return {"txns": await wallet_svc.list_txns(user["uid"], limit=limit, skip=skip)}


@router.post("/wallet/sync-locked")
async def sync_locked_margin(user: dict = Depends(current_user)):
    """Recalculate the user's locked futures margin from open positions.

    Fixes any historical double-lock that occurred before the margin
    lifecycle bug-fix.  Safe to call at any time: it only adjusts
    ``locked`` / ``available`` by the exact delta needed.
    """
    from .constants import COL_WALLETS, MARGIN_ASSET, COL_POSITIONS
    from .db import db as fdb
    from datetime import datetime, timezone

    uid = user["uid"]

    # Sum isolated_margin across all open positions — this is the correct
    # total that should be in ``locked``.
    correct_locked = 0.0
    async for pos in fdb()[COL_POSITIONS].find(
        {"uid": uid, "status": "open"}, {"_id": 0, "isolated_margin": 1}
    ):
        correct_locked += float(pos.get("isolated_margin") or 0.0)
    correct_locked = round(correct_locked, 8)

    # Read current wallet state.
    wallet_doc = await fdb()[COL_WALLETS].find_one(
        {"uid": uid, "asset": MARGIN_ASSET}, {"_id": 0, "available": 1, "locked": 1}
    )
    if wallet_doc is None:
        return {"ok": True, "adjusted": 0.0, "locked_now": 0.0}

    current_locked    = float(wallet_doc.get("locked") or 0.0)
    current_available = float(wallet_doc.get("available") or 0.0)
    delta = round(correct_locked - current_locked, 8)

    if abs(delta) < 1e-6:
        return {"ok": True, "adjusted": 0.0, "locked_now": current_locked}

    new_locked    = round(current_locked + delta, 8)
    new_available = round(current_available - delta, 8)
    if new_locked < 0 or new_available < 0:
        return {"ok": False, "error": "sync would result in negative balance — contact support"}

    await fdb()[COL_WALLETS].update_one(
        {"uid": uid, "asset": MARGIN_ASSET},
        {"$set": {"locked": new_locked, "available": new_available,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True, "adjusted": round(-delta, 8), "locked_now": new_locked}


# ── Risk settings ────────────────────────────────────────────────────────

@router.get("/settings")
async def settings(symbol: str = Query(...), user: dict = Depends(current_user)):
    return await position_svc.get_settings(user["uid"], symbol)


@router.post("/leverage")
async def set_leverage(body: LeverageUpdateRequest, user: dict = Depends(current_user)):
    try:
        return await position_svc.set_leverage(user["uid"], body.symbol, body.leverage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/margin-mode")
async def set_margin_mode(body: MarginModeUpdateRequest, user: dict = Depends(current_user)):
    try:
        return await position_svc.set_margin_mode(user["uid"], body.symbol, body.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Orders ───────────────────────────────────────────────────────────────

@router.post("/orders")
async def create_order(body: OrderCreateRequest, user: dict = Depends(current_user)):
    try:
        return await orders_svc.place_order(user["uid"], body)
    except (ValueError, InsufficientFundsError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/orders/{order_id}")
async def cancel_order(order_id: str, user: dict = Depends(current_user)):
    try:
        return await orders_svc.cancel_order(user["uid"], order_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/orders/open")
async def my_open_orders(symbol: Optional[str] = Query(None), user: dict = Depends(current_user)):
    return {"orders": await orders_svc.list_open(user["uid"], symbol=symbol)}


@router.get("/orders/history")
async def my_order_history(
    symbol: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    user: dict = Depends(current_user),
):
    return {"orders": await orders_svc.list_history(user["uid"], symbol=symbol, limit=limit)}


@router.get("/trades/me")
async def my_trades(
    symbol: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    user: dict = Depends(current_user),
):
    return {"trades": await orders_svc.list_user_trades(user["uid"], symbol=symbol, limit=limit)}


# ── Positions ────────────────────────────────────────────────────────────

@router.get("/positions")
async def my_positions(user: dict = Depends(current_user)):
    return {"positions": await position_svc.list_open(user["uid"])}


@router.get("/positions/history")
async def my_position_history(limit: int = Query(50, ge=1, le=500), user: dict = Depends(current_user)):
    return {"positions": await position_svc.list_history(user["uid"], limit=limit)}


@router.post("/positions/close")
async def close_position(body: ClosePositionRequest, user: dict = Depends(current_user)):
    """Close (or reduce) an open position via a *reduce-only market order*.

    This is a thin wrapper over the matching engine — we synthesize an
    opposite-side market order with ``reduce_only=True`` and let the
    engine handle the rest.
    """
    pos = await position_svc.get_open(user["uid"], body.symbol)
    if not pos:
        raise HTTPException(status_code=400, detail="no open position")

    qty = abs(float(pos.get("qty") or 0.0))
    target = float(body.quantity) if body.quantity else qty
    target = min(qty, max(target, 0.0))
    if target <= 0:
        raise HTTPException(status_code=400, detail="invalid quantity")

    # Opposite side closes the position.
    side = "sell" if pos["side"] == "long" else "buy"

    body_create = OrderCreateRequest(
        symbol=body.symbol, side=side, type="market",
        quantity=risk.round_qty(body.symbol, target),
        leverage=int(pos.get("leverage") or 10),
        reduce_only=True,
    )
    try:
        return await orders_svc.place_order(user["uid"], body_create)
    except (ValueError, InsufficientFundsError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
