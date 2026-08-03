"""Binance European Options WebSocket market-data feed.

Connects to ``wss://nbstream.binance.com/eoptions/stream`` and caches:
* underlying index prices (``{underlying}@optionIndex``)
* mark prices + greeks (``{underlying}@optionMarkPrice``)

Auto-reconnect, heartbeat detection, and subscription management mirror
``services.binance_spot_feed``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

logger = logging.getLogger(__name__)

STALE_AFTER_SEC: float = 45.0
RECONNECT_BACKOFF_SEC: float = 4.0
_WS_RECV_TIMEOUT_SEC: float = 65.0
_HEARTBEAT_SEC: float = 25.0

_WS_MAINNET = os.getenv(
    "BINANCE_OPTIONS_WS_URL",
    "wss://nbstream.binance.com/eoptions/stream",
)
_EAPI = os.getenv("BINANCE_OPTIONS_API_URL", "https://eapi.binance.com")

_index_cache: Dict[str, Tuple[float, float]] = {}
_mark_cache: Dict[str, Tuple[Dict[str, Any], float]] = {}

_feed_task: Optional[asyncio.Task] = None
_started: bool = False
_tracked_underlyings: List[str] = []


def _normalize_underlying(symbol: str) -> str:
    sym = (symbol or "").strip().upper()
    if sym.endswith("USDT"):
        return sym
    base = sym.replace("USDT", "").replace("-", "")
    return f"{base}USDT" if base else sym


def get_index_price(underlying_symbol: str) -> Optional[float]:
    sym = _normalize_underlying(underlying_symbol)
    entry = _index_cache.get(sym)
    if not entry:
        return None
    price, ts = entry
    if (time.monotonic() - ts) > STALE_AFTER_SEC:
        return None
    return price


def get_mark(option_symbol: str) -> Optional[Dict[str, Any]]:
    sym = (option_symbol or "").strip().upper()
    entry = _mark_cache.get(sym)
    if not entry:
        return None
    payload, ts = entry
    if (time.monotonic() - ts) > STALE_AFTER_SEC:
        return None
    return dict(payload)


def is_stale(underlying_symbol: str) -> bool:
    sym = _normalize_underlying(underlying_symbol)
    entry = _index_cache.get(sym)
    if not entry:
        return True
    return (time.monotonic() - entry[1]) > STALE_AFTER_SEC


def _ws_url_for(underlyings: Sequence[str]) -> str:
    streams: List[str] = []
    for raw in underlyings:
        u = _normalize_underlying(raw).lower()
        streams.append(f"{u}@optionIndex")
        streams.append(f"{u}@optionMarkPrice")
    if not streams:
        return _WS_MAINNET
    joined = "/".join(streams)
    if "?" in _WS_MAINNET:
        return f"{_WS_MAINNET}&streams={joined}"
    return f"{_WS_MAINNET}?streams={joined}"


async def _rest_seed_index(underlyings: Sequence[str]) -> None:
    timeout = float(os.getenv("OPTIONS_PROVIDER_TIMEOUT_SEC", "8"))
    async with httpx.AsyncClient(timeout=timeout) as client:
        for raw in underlyings:
            sym = _normalize_underlying(raw)
            asset = sym[:-4] if sym.endswith("USDT") else sym
            for param in (sym, asset):
                try:
                    resp = await client.get(
                        f"{_EAPI.rstrip('/')}/eapi/v1/index",
                        params={"underlying": param},
                    )
                    if resp.status_code != 200:
                        continue
                    body = resp.json()
                    px = _parse_index(body)
                    if px is not None and px > 0:
                        _index_cache[sym] = (px, time.monotonic())
                        break
                except Exception as exc:  # noqa: BLE001
                    logger.debug("options WS REST seed failed for %s: %s", sym, exc)


def _parse_index(body: Any) -> Optional[float]:
    if isinstance(body, dict):
        for key in ("indexPrice", "price", "index"):
            try:
                px = float(body.get(key))
                if px > 0:
                    return px
            except (TypeError, ValueError):
                pass
    if isinstance(body, list) and body and isinstance(body[0], dict):
        return _parse_index(body[0])
    return None


def _set_index_sync(underlying: str, price: float) -> None:
    sym = _normalize_underlying(underlying)
    if price > 0:
        _index_cache[sym] = (price, time.monotonic())


def _set_mark_sync(symbol: str, payload: Dict[str, Any]) -> None:
    sym = (symbol or "").strip().upper()
    if sym:
        _mark_cache[sym] = (payload, time.monotonic())


def _handle_message(raw: str) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return

    data = msg.get("data") if isinstance(msg, dict) and "data" in msg else msg
    if not isinstance(data, dict):
        return

    event = str(data.get("e") or data.get("event") or "").lower()
    if event in ("optionindex", "index"):
        underlying = str(data.get("u") or data.get("underlying") or data.get("s") or "")
        px = _parse_index(data) or _parse_index({"indexPrice": data.get("i")})
        if px is not None:
            _set_index_sync(underlying or "BTCUSDT", px)
        return

    if event in ("optionmarkprice", "markprice"):
        symbol = str(data.get("s") or data.get("symbol") or "")
        payload = {
            "symbol": symbol,
            "mark_price": _safe_float(data.get("mp") or data.get("markPrice")),
            "index_price": _safe_float(data.get("i") or data.get("indexPrice")),
            "iv": _safe_float(data.get("mi") or data.get("markIV")),
            "delta": _safe_float(data.get("d") or data.get("delta")),
            "gamma": _safe_float(data.get("g") or data.get("gamma")),
            "theta": _safe_float(data.get("t") or data.get("theta")),
            "vega": _safe_float(data.get("v") or data.get("vega")),
            "rho": _safe_float(data.get("r") or data.get("rho")),
            "open_interest": _safe_float(data.get("o") or data.get("openInterest")),
        }
        if symbol:
            _set_mark_sync(symbol, payload)
        underlying = str(data.get("u") or data.get("underlying") or "")
        idx = payload.get("index_price")
        if underlying and idx:
            _set_index_sync(underlying, float(idx))


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def _ws_loop(underlyings: Sequence[str]) -> None:
    try:
        import websockets  # type: ignore[import-untyped]
    except ImportError:
        logger.warning(
            "binance_options_ws: 'websockets' package not installed — feed disabled"
        )
        return

    url = _ws_url_for(underlyings)
    while True:
        try:
            logger.info("binance_options_ws: connecting to %s", url.split("?", 1)[0])
            async with websockets.connect(
                url,
                ping_interval=_HEARTBEAT_SEC,
                ping_timeout=_HEARTBEAT_SEC,
                close_timeout=5,
                max_size=2**22,
            ) as ws:
                logger.info(
                    "binance_options_ws: connected (%d underlyings)",
                    len(underlyings),
                )
                while True:
                    try:
                        raw = await asyncio.wait_for(
                            ws.recv(),
                            timeout=_WS_RECV_TIMEOUT_SEC,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "binance_options_ws: no message in %.0fs — reconnecting",
                            _WS_RECV_TIMEOUT_SEC,
                        )
                        break
                    if isinstance(raw, bytes):
                        raw = raw.decode("utf-8", errors="replace")
                    _handle_message(str(raw))
        except asyncio.CancelledError:
            logger.info("binance_options_ws: task cancelled")
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "binance_options_ws: disconnected (%s) — reconnecting in %.0fs",
                exc,
                RECONNECT_BACKOFF_SEC,
            )
        await asyncio.sleep(RECONNECT_BACKOFF_SEC)


async def start(underlyings: Optional[Sequence[str]] = None) -> None:
    global _feed_task, _started, _tracked_underlyings
    if _started:
        return
    if underlyings:
        syms = [_normalize_underlying(s) for s in underlyings if str(s).strip()]
    else:
        raw = (os.getenv("BINANCE_OPTIONS_UNDERLYINGS") or "auto").strip()
        if raw.lower() in ("auto", "*", "all"):
            from ..services.binance_sync import DEFAULT_UNDERLYINGS

            syms = [_normalize_underlying(s) for s in DEFAULT_UNDERLYINGS]
        else:
            syms = [_normalize_underlying(s) for s in raw.split(",") if str(s).strip()]
    if not syms:
        logger.info("binance_options_ws: no underlyings — feed disabled")
        return
    _tracked_underlyings = syms
    await _rest_seed_index(syms)
    _feed_task = asyncio.create_task(_ws_loop(syms), name="binance-options-ws")
    _started = True
    logger.info("binance_options_ws: started tracking %s", ", ".join(syms))


async def stop() -> None:
    global _feed_task, _started
    if _feed_task is not None:
        _feed_task.cancel()
        try:
            await _feed_task
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001
            logger.exception("binance_options_ws: error while stopping")
        _feed_task = None
    _started = False
    logger.info("binance_options_ws: stopped")
