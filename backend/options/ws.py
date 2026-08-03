"""Extended WebSocket channels for options market data."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from .deps import user_from_ws_token
from .services import contracts as contracts_svc
from .services import market_data as market_svc
from .services import orderbook as orderbook_svc
from .services import orders as orders_svc
from .services import portfolio as portfolio_svc
from .services import ticker as ticker_svc
from .services import trades_public as trades_pub_svc
from .services import positions as pos_svc
from .services import wallet as wallet_svc

logger = logging.getLogger(__name__)

router = APIRouter()

HEARTBEAT_SEC = 25.0
POLL_SEC = 1.0


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _safe_send(ws: WebSocket, payload: Dict[str, Any]) -> bool:
    try:
        await ws.send_json(payload)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.debug("options ws send failed: %s", exc)
        return False


async def _ws_loop(
    websocket: WebSocket,
    *,
    build_payload,
    interval: float = POLL_SEC,
) -> None:
    last_ping = asyncio.get_event_loop().time()
    try:
        while True:
            payload = await build_payload()
            if payload is None:
                break
            if not await _safe_send(websocket, payload):
                break
            now = asyncio.get_event_loop().time()
            if now - last_ping >= HEARTBEAT_SEC:
                await _safe_send(websocket, {"type": "ping", "ts": _iso()})
                last_ping = now
            await asyncio.sleep(interval)
    except WebSocketDisconnect:
        return


@router.websocket("/ws/options/ticker")
async def ws_options_ticker(websocket: WebSocket, contract_id: str = Query(..., min_length=4)):
    c = await contracts_svc.get(contract_id)
    if not c:
        await websocket.close(code=4404)
        return
    await websocket.accept()

    async def build():
        tick = await ticker_svc.get_ticker(contract_id, use_cache=True)
        return {"type": "options_ticker", "contract_id": contract_id, "ticker": tick, "updated_at": _iso()}

    await _ws_loop(websocket, build_payload=build)


@router.websocket("/ws/options/orderbook")
async def ws_options_orderbook(
    websocket: WebSocket,
    contract_id: str = Query(..., min_length=4),
    levels: int = Query(20, ge=1, le=100),
):
    c = await contracts_svc.get(contract_id)
    if not c:
        await websocket.close(code=4404)
        return
    await websocket.accept()

    async def build():
        snap = await market_svc.get_orderbook(contract_id, depth=levels, use_cache=True)
        return {
            "type": "options_orderbook",
            "contract_id": contract_id,
            "bids": snap.get("bids", []),
            "asks": snap.get("asks", []),
            "updated_at": _iso(),
        }

    await _ws_loop(websocket, build_payload=build)


@router.websocket("/ws/options/trades")
async def ws_options_trades(
    websocket: WebSocket,
    contract_id: str = Query(..., min_length=4),
    limit: int = Query(30, ge=1, le=100),
):
    c = await contracts_svc.get(contract_id)
    if not c:
        await websocket.close(code=4404)
        return
    await websocket.accept()

    async def build():
        tape = await trades_pub_svc.list_recent_contract_trades(contract_id, limit=limit)
        return {"type": "options_trades", "contract_id": contract_id, "trades": tape, "updated_at": _iso()}

    await _ws_loop(websocket, build_payload=build)


@router.websocket("/ws/options/open-interest")
async def ws_options_open_interest(
    websocket: WebSocket,
    underlying_symbol: str = Query(..., min_length=5),
):
    await websocket.accept()
    sym = underlying_symbol.strip().upper()

    async def build():
        chain = await market_svc.get_chain(sym, include_market=True, use_cache=True)
        oi_rows: List[Dict[str, Any]] = []
        for row in chain.get("contracts") or []:
            cid = str(row.get("id") or "")
            oi = (row.get("market") or {}).get("open_interest")
            if cid:
                oi_rows.append({"contract_id": cid, "open_interest": oi})
        return {
            "type": "options_open_interest",
            "underlying_symbol": sym,
            "contracts": oi_rows,
            "updated_at": _iso(),
        }

    await _ws_loop(websocket, build_payload=build, interval=2.0)


@router.websocket("/ws/options/greeks")
async def ws_options_greeks(
    websocket: WebSocket,
    contract_id: str = Query(..., min_length=4),
):
    c = await contracts_svc.get(contract_id)
    if not c:
        await websocket.close(code=4404)
        return
    await websocket.accept()

    async def build():
        tick = await ticker_svc.get_ticker(contract_id, use_cache=True)
        greeks = {
            k: (tick or {}).get(k)
            for k in ("iv", "delta", "gamma", "theta", "vega", "rho", "mark_price", "index_price")
        }
        return {"type": "options_greeks", "contract_id": contract_id, "greeks": greeks, "updated_at": _iso()}

    await _ws_loop(websocket, build_payload=build)


@router.websocket("/ws/options/chain")
async def ws_options_chain(
    websocket: WebSocket,
    underlying_symbol: str = Query(..., min_length=5),
):
    await websocket.accept()
    sym = underlying_symbol.strip().upper()

    async def build():
        chain = await market_svc.get_chain(sym, include_market=True, use_cache=True)
        return {"type": "options_chain", **chain, "updated_at": _iso()}

    await _ws_loop(websocket, build_payload=build, interval=2.0)


@router.websocket("/ws/options/depth")
async def ws_options_depth(
    websocket: WebSocket,
    contract_id: str = Query(..., min_length=4),
    levels: int = Query(20, ge=1, le=100),
):
    """Legacy combined depth + tape channel."""
    c = await contracts_svc.get(contract_id)
    if not c:
        await websocket.close(code=4404)
        return
    await websocket.accept()

    async def build():
        snap = await orderbook_svc.depth_snapshot(contract_id, levels=levels)
        tape = await trades_pub_svc.list_recent_contract_trades(contract_id, limit=25)
        return {
            "type": "options_depth",
            "contract_id": contract_id,
            "bids": snap.get("bids", []),
            "asks": snap.get("asks", []),
            "recent_trades": tape,
            "updated_at": _iso(),
        }

    await _ws_loop(websocket, build_payload=build)


@router.websocket("/ws/options/account")
async def ws_options_account(websocket: WebSocket, token: str = Query(None)):
    user = await user_from_ws_token(token)
    if not user:
        await websocket.close(code=4401)
        return
    uid = user["uid"]
    await websocket.accept()

    async def build():
        port = await portfolio_svc.snapshot(uid)
        open_orders, order_history, user_trades = await asyncio.gather(
            orders_svc.list_open(uid),
            orders_svc.list_history(uid, limit=20),
            orders_svc.list_user_trades(uid, limit=20),
        )
        return {
            "type": "options_account",
            "wallet": port.get("wallet"),
            "portfolio": port,
            "positions": port.get("positions"),
            "open_orders": open_orders,
            "order_history": order_history,
            "user_trades": user_trades,
            "updated_at": _iso(),
        }

    await _ws_loop(websocket, build_payload=build, interval=2.0)
