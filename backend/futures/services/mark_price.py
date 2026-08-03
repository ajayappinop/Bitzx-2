"""Mark price service.

Mark price is the *fair* price the engine uses for PnL, liquidation, and
funding settlement — never the last trade (which is manipulable on a
thin book). We pull the index from Binance via the existing hedger
client when available, blend it with the local mid for stability, and
fall back to the last trade only when neither source is reachable.

The service caches the latest snapshot in-process so REST/WS callers
never have to await a network round-trip.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional

from ..constants import COL_MARK_PRICES, COL_TRADES
from ..symbols import get_supported_symbols
from ..db import db

logger = logging.getLogger(__name__)


_cache: Dict[str, Dict[str, float]] = {}
_lock = asyncio.Lock()


def get_cached(symbol: str) -> Optional[Dict[str, float]]:
    return _cache.get(symbol)


def set_cached(symbol: str, mark_price: float, *, index_price: Optional[float] = None) -> Dict[str, float]:
    snap = {
        "symbol": symbol,
        "mark_price": float(mark_price),
        "index_price": float(index_price if index_price is not None else mark_price),
        "ts": time.time(),
    }
    _cache[symbol] = snap
    return snap


async def _binance_index(symbol: str) -> Optional[float]:
    """Best-effort Binance spot price for the corresponding pair.

    Cache priority:
    1. Shared WS feed (``services.binance_spot_feed``) — zero REST.
    2. ``hedger_service`` Binance client (REST fallback).
    """
    meta = get_supported_symbols().get(symbol) or {}
    if str(meta.get("index_source") or "") == "listed":
        try:
            from listings.listed_trading import listed_usdt_price

            base = str(meta.get("base") or "")
            px = listed_usdt_price(base)
            if px > 0:
                return px
        except Exception:  # noqa: BLE001
            pass
        return None
    bin_sym = str(meta.get("binance_symbol") or "")
    if not bin_sym:
        return None

    # ── 1. WS feed cache ─────────────────────────────────────────────────
    try:
        from services import binance_spot_feed  # type: ignore[import]
        ws_price, ws_age = binance_spot_feed.get_price(bin_sym)
        if ws_price is not None and ws_age <= binance_spot_feed.STALE_AFTER_SEC:
            return ws_price
    except Exception:  # noqa: BLE001
        pass

    # ── 2. Hedger client REST fallback ────────────────────────────────────
    try:
        from services import hedger_service  # type: ignore
    except Exception:  # noqa: BLE001
        return None
    try:
        client = getattr(hedger_service, "default_client", None)
        if client is None:
            return None
        ticker = await client.get_ticker(bin_sym)
        if ticker and ticker.get("price"):
            return float(ticker["price"])
    except Exception as exc:  # noqa: BLE001
        logger.debug("binance index fetch failed for %s: %s", symbol, exc)
    return None


async def _last_trade_price(symbol: str) -> Optional[float]:
    doc = await db()[COL_TRADES].find_one(
        {"symbol": symbol},
        {"_id": 0, "price": 1},
        sort=[("created_at", -1)],
    )
    if not doc:
        return None
    return float(doc.get("price") or 0.0) or None


async def _local_mid(symbol: str) -> Optional[float]:
    """Mid of the local order book (best bid + best ask) / 2."""
    from ..constants import COL_ORDERS
    bid = await db()[COL_ORDERS].find_one(
        {"symbol": symbol, "side": "buy", "status": {"$in": ["open", "partially_filled"]}},
        {"_id": 0, "price": 1},
        sort=[("price", -1)],
    )
    ask = await db()[COL_ORDERS].find_one(
        {"symbol": symbol, "side": "sell", "status": {"$in": ["open", "partially_filled"]}},
        {"_id": 0, "price": 1},
        sort=[("price", 1)],
    )
    bid_p = float((bid or {}).get("price") or 0.0)
    ask_p = float((ask or {}).get("price") or 0.0)
    if bid_p > 0 and ask_p > 0:
        return (bid_p + ask_p) / 2.0
    if bid_p > 0:
        return bid_p
    if ask_p > 0:
        return ask_p
    return None


async def refresh(symbol: str) -> Dict[str, Any]:
    """Recompute and cache the mark price for ``symbol``.

    Strategy: 70% Binance index + 30% local mid (when both available);
    otherwise whichever is available; finally falls back to the last
    futures trade. The result is also persisted to ``futures_mark_prices``
    for historical charts.
    """
    async with _lock:
        index = await _binance_index(symbol)
        mid   = await _local_mid(symbol)

        if index and mid:
            mark = 0.7 * index + 0.3 * mid
        elif index:
            mark = index
        elif mid:
            mark = mid
        else:
            mark = await _last_trade_price(symbol)

        if not mark or mark <= 0:
            return {"symbol": symbol, "mark_price": None, "index_price": None}

        snap = set_cached(symbol, mark, index_price=index or mark)
        await db()[COL_MARK_PRICES].insert_one({
            "symbol": symbol,
            "mark_price": float(mark),
            "index_price": float(index or mark),
            "created_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        })
        return snap
