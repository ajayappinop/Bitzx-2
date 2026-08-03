"""Real-time WebSocket endpoints for futures.

Three channels:

* ``/ws/futures/markets``    — public, fan-outs symbol mark/index/funding
* ``/ws/futures/orderbook``  — public, depth snapshots for a symbol
* ``/ws/futures/account``    — authenticated, per-user wallet/positions/orders

Snapshots are pushed every ~1s; in production these should switch to
event-driven fan-out (publish on every fill / position update). The
periodic refresh is good enough for the initial release and avoids
fragile coupling to the matching engine.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from .symbols import get_supported_symbols
from .deps import user_from_ws_token
from .services import (
    mark_price as mark_price_svc,
    orders as orders_svc,
    position as position_svc,
    wallet as wallet_svc,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _safe_send(ws: WebSocket, payload: Dict[str, Any]) -> bool:
    try:
        await ws.send_json(payload)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.debug("ws send failed: %s", exc)
        return False


# ── Public market feed ────────────────────────────────────────────────────

@router.websocket("/ws/futures/markets")
async def ws_markets(websocket: WebSocket):
    """Fan-out of mark prices for every supported symbol."""
    await websocket.accept()
    try:
        while True:
            snaps: List[Dict[str, Any]] = []
            for sym in get_supported_symbols().keys():
                snap = mark_price_svc.get_cached(sym)
                if not snap:
                    snap = await mark_price_svc.refresh(sym)
                if snap:
                    snaps.append(snap)
            if not await _safe_send(websocket, {
                "type": "futures_markets",
                "markets": snaps,
                "updated_at": _iso(),
            }):
                break
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return


@router.websocket("/ws/futures/orderbook")
async def ws_orderbook(websocket: WebSocket, symbol: str = Query(...)):
    await websocket.accept()
    try:
        while True:
            book = await orders_svc.order_book(symbol, depth=25)
            trades = await orders_svc.market_trades(symbol, limit=20)
            if not await _safe_send(websocket, {
                "type": "futures_orderbook",
                "symbol": symbol,
                "book": book,
                "recent_trades": trades,
                "mark": mark_price_svc.get_cached(symbol),
                "updated_at": _iso(),
            }):
                break
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return


# ── Authenticated user feed ──────────────────────────────────────────────

@router.websocket("/ws/futures/account")
async def ws_account(websocket: WebSocket, token: str = Query(None)):
    user = await user_from_ws_token(token)
    if not user:
        await websocket.close(code=4401)
        return
    uid = user["uid"]
    await websocket.accept()
    try:
        while True:
            wallet = await wallet_svc.snapshot(uid)
            positions = await position_svc.list_open(uid)
            open_orders = await orders_svc.list_open(uid)
            history = await orders_svc.list_history(uid, limit=20)
            user_trades = await orders_svc.list_user_trades(uid, limit=20)
            if not await _safe_send(websocket, {
                "type": "futures_account",
                "wallet": wallet,
                "positions": positions,
                "open_orders": open_orders,
                "order_history": history,
                "user_trades": user_trades,
                "updated_at": _iso(),
            }):
                break
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        return
