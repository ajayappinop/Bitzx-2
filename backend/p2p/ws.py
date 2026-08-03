"""MaxByte P2P WebSocket — per-order real-time channel.

Route: /api/ws/p2p/order/{order_id}?token=<access_token>

Uses query-param token auth (Bearer JWT) — same pattern as futures/ws.py.
Streams live status changes and chat messages to both parties of an order.

Payloads: JSON {type: "status"|"message"|"hello"|"ping"|"appeal", ...}
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status

from services.db import get_db
from .deps import user_from_ws_token

router = APIRouter(prefix="/api/ws/p2p", tags=["ws-p2p"])
log = logging.getLogger("p2p.ws")

# order_id → set[WebSocket]
_subs: dict[str, set[WebSocket]] = defaultdict(set)
_lock = asyncio.Lock()


@router.websocket("/order/{order_id}")
async def ws_order(
    ws: WebSocket,
    order_id: str,
    token: Optional[str] = Query(None),
):
    user = await user_from_ws_token(token)
    if not user:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    async with _lock:
        _subs[order_id].add(ws)

    try:
        await ws.send_json({"type": "hello", "order_id": order_id, "status": o["status"]})
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=45.0)
                if msg == "ping":
                    await ws.send_text("pong")
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("ws session error", exc_info=True)
    finally:
        async with _lock:
            _subs[order_id].discard(ws)
            if not _subs[order_id]:
                _subs.pop(order_id, None)


async def broadcast(order_id: str, event_type: str, payload: dict):
    """Fan-out a JSON event to all subscribers of an order."""
    async with _lock:
        peers = list(_subs.get(order_id, ()))
    if not peers:
        return
    body = {"type": event_type, **payload}
    raw = json.dumps(body, default=str)
    dead = []
    for ws in peers:
        try:
            await ws.send_text(raw)
        except Exception:
            dead.append(ws)
    if dead:
        async with _lock:
            for d in dead:
                _subs.get(order_id, set()).discard(d)
