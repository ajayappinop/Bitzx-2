"""
Cached Binance spot price for options reference index.

Usage:
    from options.services.index_price import get_index_price

    price = await get_index_price("BTCUSDT")  # returns float or None

Cache hierarchy
---------------
1. ``services.binance_spot_feed`` shared WS cache (updated ~per-trade by
   the combined miniTicker stream, stale threshold 45 s).
2. Local 15-second TTL cache populated by REST fallback calls.
3. Most-recent stale local value (never returns ``None`` if any value has
   ever been fetched).

The WS feed is the primary source; REST is only hit when the WS entry is
absent or older than ``STALE_AFTER_SEC``.
"""

from __future__ import annotations

import logging
import time
from typing import Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_BINANCE_PRICE = "https://api.binance.com/api/v3/ticker/price"
_BINANCE_TESTNET = "https://testnet.binance.vision/api/v3/ticker/price"
_LOCAL_CACHE_TTL_SECONDS = 15.0

# symbol -> (price, monotonic_timestamp)
_cache: Dict[str, Tuple[float, float]] = {}


async def _fetch(symbol: str) -> float:
    async with httpx.AsyncClient(timeout=8.0) as client:
        for label, url in (("mainnet", _BINANCE_PRICE), ("testnet", _BINANCE_TESTNET)):
            try:
                r = await client.get(url, params={"symbol": symbol})
                if r.status_code == 200:
                    px = float(r.json().get("price", 0))
                    if px > 0:
                        return px
            except Exception as exc:
                logger.debug("index_price %s from %s failed: %s", symbol, label, exc)
    raise ValueError(f"could not fetch index price for {symbol} from Binance")


async def get_index_price(symbol: str) -> Optional[float]:
    """Return the current Binance spot price for *symbol* (e.g. ``"BTCUSDT"``).

    Priority:
    1. Shared WS feed cache (``services.binance_spot_feed``) — zero REST.
    2. Local 15-second cache populated by REST.
    3. Stale local value when Binance is unreachable.
    """
    sym = (symbol or "").strip().upper()
    if not sym:
        return None

    # ── 1. WS feed cache ─────────────────────────────────────────────────
    try:
        from services import binance_spot_feed  # type: ignore[import]
        ws_price, ws_age = binance_spot_feed.get_price(sym)
        if ws_price is not None and ws_age <= binance_spot_feed.STALE_AFTER_SEC:
            # Keep local cache warm so fallback works if the WS drops.
            _cache[sym] = (ws_price, time.monotonic())
            return ws_price
    except Exception:  # noqa: BLE001
        pass  # Feed not started yet — fall through to REST.

    # ── 2. Local 15-second REST cache ────────────────────────────────────
    now = time.monotonic()
    cached = _cache.get(sym)
    if cached and (now - cached[1]) < _LOCAL_CACHE_TTL_SECONDS:
        return cached[0]

    try:
        price = await _fetch(sym)
        _cache[sym] = (price, now)
        return price
    except Exception as exc:
        logger.debug("index price miss for %s: %s", sym, exc)
        if cached:
            return cached[0]   # stale rather than None
        return None


async def warmup(symbols: list[str]) -> None:
    """Pre-populate the cache for a list of symbols at startup."""
    for sym in symbols:
        try:
            await get_index_price(sym)
        except Exception:
            pass


def cached_price(symbol: str) -> Optional[float]:
    """Synchronous read of the cache (returns ``None`` on miss). No network I/O."""
    sym = (symbol or "").strip().upper()

    # Try WS feed first.
    try:
        from services import binance_spot_feed  # type: ignore[import]
        ws_price, ws_age = binance_spot_feed.get_price(sym)
        if ws_price is not None and ws_age <= binance_spot_feed.STALE_AFTER_SEC:
            return ws_price
    except Exception:  # noqa: BLE001
        pass

    entry = _cache.get(sym)
    return entry[0] if entry else None
