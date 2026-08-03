"""Binance spot price feed — persistent WebSocket for both mainnet and testnet.

Endpoint selection
------------------
* ``BINANCE_TESTNET=false`` (default/production)
  → Combined-stream WS: ``wss://stream.binance.com:9443/stream?streams=…``
    One connection subscribed to ``<sym>@miniTicker`` for every tracked
    symbol.  Each message is the combined-stream envelope
    ``{"stream":"…","data":{…}}``.

* ``BINANCE_TESTNET=true`` (dev/staging)
  → All-market mini-ticker WS: ``wss://testnet.binance.vision/ws/!miniTicker@arr``
    Binance testnet does **not** support the combined-stream ``/stream``
    path (returns HTTP 404) and is missing many symbols (SOL, POL, AVAX…).
    The ``!miniTicker@arr`` stream pushes an array of all available tickers
    every second via the ``/ws/`` path — no per-symbol subscriptions needed.
    We filter client-side to our tracked symbols; missing ones fall back to
    the REST-seeded value or ``FALLBACK_PRICES``.

Both modes use the same reconnect logic and in-memory cache.
No REST polling loop runs after startup — the WS keeps prices live.


In-memory price cache
---------------------
``symbol → (price: float, updated_at: float)``  where ``updated_at``
is a ``time.monotonic()`` timestamp.  Prices older than
``STALE_AFTER_SEC`` (45 s) are treated as stale.  Callers that need
a guaranteed-fresh value should fall back to REST when
``is_stale(symbol)`` returns True.

Start-up sequence
-----------------
1. **Batch REST seed** — ``GET /api/v3/ticker/price?symbols=[...]``
   fills the cache before the WS handshake completes, so internal
   services never see a cold-miss on their first call.
2. **WebSocket stream** — subsequent ``miniTicker`` messages keep the
   cache fresh.  The WS carries the last traded price (``"c"`` field)
   for every tracked symbol at roughly the same cadence as trade
   activity on Binance.

Auto-reconnect
--------------
On disconnect the task sleeps ``RECONNECT_BACKOFF_SEC`` (4 s) then
re-establishes the combined stream.  Stale-detection remains active
during the gap so callers degrade to REST as expected.

Public API
----------
``await start(symbols)`` — idempotent; call once at FastAPI startup.
``await stop()``          — cancels the background task; call at shutdown.
``get_price(symbol)``     — sync; returns ``(price, age_sec)`` or
                            ``(None, math.inf)`` on miss.
``is_stale(symbol)``      — True when absent or age > STALE_AFTER_SEC.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
from typing import Dict, List, Optional, Sequence, Tuple

import httpx

logger = logging.getLogger(__name__)

# ── Tunables ──────────────────────────────────────────────────────────────────

STALE_AFTER_SEC: float = 45.0
RECONNECT_BACKOFF_SEC: float = 4.0
_REST_SEED_TIMEOUT_SEC: float = 12.0
_WS_RECV_TIMEOUT_SEC: float = 65.0   # > Binance's 60 s silent-disconnect threshold

# Mainnet: combined stream — one WS subscription per tracked symbol.
# URL built dynamically with ?streams= in _ws_url_for().
_WS_MAINNET   = "wss://stream.binance.com:9443/stream"
_REST_MAINNET = "https://api.binance.com/api/v3/ticker/price"

# Testnet: all-market mini-ticker array stream — one connection, all symbols,
# no per-symbol URL needed, no 404 from missing symbols.
# Message format: a JSON array [{e,s,c,…}, …] instead of the combined envelope.
_WS_TESTNET   = "wss://testnet.binance.vision/ws/!miniTicker@arr"
_REST_TESTNET = "https://testnet.binance.vision/api/v3/ticker/price"

# ── In-memory cache ───────────────────────────────────────────────────────────

# symbol → (price, monotonic_timestamp)
# Reads are lock-free (CPython GIL + dict reads are atomic).
# Writes happen only from the single WS task via _set_price_sync,
# so no async lock is needed on the write path either.
_cache: Dict[str, Tuple[float, float]] = {}

_feed_task: Optional[asyncio.Task] = None
_started: bool = False


# ── Env helper ────────────────────────────────────────────────────────────────

def _use_testnet() -> bool:
    return (os.getenv("BINANCE_TESTNET") or "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _ws_url_for(symbols: Sequence[str]) -> str:
    """Return the WS URL for the active environment.

    * Testnet → ``wss://testnet.binance.vision/ws/!miniTicker@arr``
      (all-market array stream; symbols param is ignored at URL level).
    * Mainnet → combined stream with per-symbol ``@miniTicker`` subscriptions.
    """
    if _use_testnet():
        return _WS_TESTNET
    streams = "/".join(f"{s.lower()}@miniTicker" for s in symbols)
    return f"{_WS_MAINNET}?streams={streams}"


def _rest_url() -> str:
    return _REST_TESTNET if _use_testnet() else _REST_MAINNET


# ── Public read API ───────────────────────────────────────────────────────────

def get_price(symbol: str) -> Tuple[Optional[float], float]:
    """Return ``(price, age_seconds)`` for *symbol* (case-insensitive).

    Returns ``(None, math.inf)`` on cache miss.  Safe to call from any
    coroutine or synchronous context without blocking.
    """
    entry = _cache.get((symbol or "").upper())
    if entry is None:
        return None, math.inf
    price, ts = entry
    return price, time.monotonic() - ts


def is_stale(symbol: str) -> bool:
    """``True`` when the cache entry is absent or older than STALE_AFTER_SEC."""
    _, age = get_price(symbol)
    return age > STALE_AFTER_SEC


# ── Cache writer ─────────────────────────────────────────────────────────────

def _set_price_sync(symbol: str, price: float) -> None:
    """Write directly into the cache dict.

    Called only from within the single WS-feed asyncio task, so there is
    no concurrent writer.  Dict item assignment is atomic under the GIL,
    so readers (``get_price``) always see a complete ``(price, ts)`` tuple.
    """
    _cache[symbol.upper()] = (price, time.monotonic())


# ── REST seed ────────────────────────────────────────────────────────────────

async def _seed_via_rest(symbols: Sequence[str]) -> None:
    """Pre-populate the cache via the batch ticker/price endpoint.

    Falls back to per-symbol requests when the batch call fails (e.g.
    testnet returns a 400 for the ``symbols`` array parameter on some
    plan tiers).
    """
    if not symbols:
        return
    url = _rest_url()
    sym_list = [s.upper() for s in symbols if s]

    try:
        async with httpx.AsyncClient(timeout=_REST_SEED_TIMEOUT_SEC) as client:
            # Batch request: ?symbols=["BTCUSDT","ETHUSDT",...]
            resp = await client.get(url, params={"symbols": json.dumps(sym_list)})
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    seeded = 0
                    for item in data:
                        sym = str(item.get("symbol") or "").upper()
                        try:
                            px = float(item.get("price") or 0)
                        except (TypeError, ValueError):
                            px = 0.0
                        if sym and px > 0:
                            _set_price_sync(sym, px)
                            seeded += 1
                    logger.info(
                        "binance_spot_feed: REST seed OK — %d/%d symbols cached "
                        "(testnet=%s)",
                        seeded, len(sym_list), _use_testnet(),
                    )
                    return
            logger.warning(
                "binance_spot_feed: batch REST seed returned HTTP %d — "
                "trying per-symbol fallback",
                resp.status_code,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("binance_spot_feed: batch REST seed error: %s", exc)

    # Per-symbol fallback
    seeded = 0
    try:
        async with httpx.AsyncClient(timeout=_REST_SEED_TIMEOUT_SEC) as client:
            for sym in sym_list:
                try:
                    r = await client.get(url, params={"symbol": sym})
                    if r.status_code == 200:
                        px = float(r.json().get("price") or 0)
                        if px > 0:
                            _set_price_sync(sym, px)
                            seeded += 1
                except Exception:  # noqa: BLE001
                    pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("binance_spot_feed: per-symbol REST seed error: %s", exc)
    logger.info(
        "binance_spot_feed: per-symbol REST seed — %d/%d cached",
        seeded, len(sym_list),
    )


# ── WebSocket feed loop ───────────────────────────────────────────────────────

def _parse_ws_message(msg: Any, tracked: frozenset) -> None:
    """Update the cache from a WS frame.  Handles both message formats:

    * **Mainnet combined stream** — ``{"stream":"…","data":{"s":"BTCUSDT","c":"…"}}``
    * **Testnet !miniTicker@arr** — ``[{"s":"BTCUSDT","c":"…"}, …]`` (JSON array)

    Symbols not in ``tracked`` are silently ignored so we only cache what
    the application actually uses.
    """
    try:
        if isinstance(msg, list):
            # Testnet !miniTicker@arr — iterate the array.
            for item in msg:
                sym = str(item.get("s") or "").upper()
                if sym not in tracked:
                    continue
                px = float(item.get("c") or 0)
                if px > 0:
                    _set_price_sync(sym, px)
        elif isinstance(msg, dict):
            # Mainnet combined-stream envelope.
            data = msg.get("data") or {}
            sym = str(data.get("s") or "").upper()
            if sym in tracked:
                px = float(data.get("c") or 0)
                if px > 0:
                    _set_price_sync(sym, px)
    except Exception:  # noqa: BLE001
        pass  # Malformed frame — keep running.


async def _ws_feed_loop(symbols: Sequence[str]) -> None:
    """Seed the cache via REST then maintain a persistent WebSocket forever.

    Works on both mainnet and testnet — see module docstring for URL details.
    Reconnects automatically after ``RECONNECT_BACKOFF_SEC`` on any error.
    """
    await _seed_via_rest(symbols)

    tracked = frozenset(s.upper() for s in symbols if s)
    ws_url  = _ws_url_for(symbols)
    testnet = _use_testnet()

    try:
        import websockets  # type: ignore[import-untyped]
    except ImportError:
        logger.error(
            "binance_spot_feed: 'websockets' package not installed — "
            "WS feed disabled; prices will fall back to per-call REST. "
            "Fix: pip install 'websockets>=12.0'"
        )
        return

    while True:
        try:
            logger.info(
                "binance_spot_feed: connecting to %s WS",
                "testnet (!miniTicker@arr)" if testnet else f"mainnet ({len(symbols)} symbols)",
            )
            async with websockets.connect(
                ws_url,
                ping_interval=20,
                ping_timeout=30,
                close_timeout=5,
            ) as ws:
                logger.info(
                    "binance_spot_feed: WS connected (testnet=%s, tracking %d symbols)",
                    testnet, len(tracked),
                )
                while True:
                    try:
                        raw = await asyncio.wait_for(
                            ws.recv(), timeout=_WS_RECV_TIMEOUT_SEC,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "binance_spot_feed: no message in %.0fs — reconnecting",
                            _WS_RECV_TIMEOUT_SEC,
                        )
                        break

                    _parse_ws_message(json.loads(raw), tracked)

        except asyncio.CancelledError:
            logger.info("binance_spot_feed: WS task cancelled")
            raise

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "binance_spot_feed: WS disconnected (%s) — reconnecting in %.0fs",
                exc, RECONNECT_BACKOFF_SEC,
            )

        try:
            await asyncio.sleep(RECONNECT_BACKOFF_SEC)
        except asyncio.CancelledError:
            raise


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def start(symbols: Sequence[str]) -> None:
    """Start the WS price feed (idempotent).

    Safe to call multiple times — a running feed is left untouched.
    Call once during FastAPI startup *before* any service that reads
    prices, so the REST seed is in place before the first request.
    """
    global _feed_task, _started  # noqa: PLW0603
    if _started and _feed_task is not None and not _feed_task.done():
        return  # Already running — do nothing.

    sym_list: List[str] = [s.upper() for s in symbols if s]
    if not sym_list:
        logger.info("binance_spot_feed: no symbols supplied — feed disabled")
        return

    _feed_task = asyncio.create_task(
        _ws_feed_loop(sym_list),
        name="ibo-binance-spot-feed",
    )
    _started = True
    mode = "testnet (!miniTicker@arr WS)" if _use_testnet() else "mainnet (combined WS)"
    logger.info(
        "binance_spot_feed: started [%s] tracking %d symbols: %s",
        mode, len(sym_list),
        ", ".join(sym_list[:6]) + ("…" if len(sym_list) > 6 else ""),
    )


async def stop() -> None:
    """Stop the WS price feed.  Call during FastAPI shutdown."""
    global _feed_task, _started  # noqa: PLW0603
    _started = False
    if _feed_task is not None and not _feed_task.done():
        _feed_task.cancel()
        try:
            await _feed_task
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("binance_spot_feed: error while stopping")
    _feed_task = None
    logger.info("binance_spot_feed: stopped")
