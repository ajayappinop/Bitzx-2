"""Internal spot market data for listed USDT pairs not on Binance."""

from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from listings.registry import get_market_pair_defs

# Demo / pre-list pairs — synthetic ticker, klines, and order book (never sent to Binance).
INTERNAL_MOCK_USDT: Dict[str, Dict[str, Any]] = {
    "MIDASUSDT": {"base": "MIDAS", "quote": "USDT", "price_usd": 0.015},
}


def internal_mock_usdt_pair_map() -> Dict[str, Dict[str, Any]]:
    return {
        sym: {**meta, "symbol": sym, "source": "internal_mock"}
        for sym, meta in INTERNAL_MOCK_USDT.items()
    }


def internal_mock_usdt_symbols() -> frozenset[str]:
    return frozenset(INTERNAL_MOCK_USDT.keys())


def is_internal_mock_usdt_pair(symbol: str) -> bool:
    return (symbol or "").upper() in INTERNAL_MOCK_USDT


def listed_usdt_pair_map() -> Dict[str, Dict[str, Any]]:
    """spot_symbol → pair metadata for approved + trading_enabled listed USDT pairs."""
    out: Dict[str, Dict[str, Any]] = {}
    for p in get_market_pair_defs():
        sym = (p.get("symbol") or "").upper()
        if not sym or (p.get("quote") or "USDT").upper() != "USDT":
            continue
        out[sym] = p
    out.update(internal_mock_usdt_pair_map())
    return out


def is_listed_usdt_pair(symbol: str) -> bool:
    return (symbol or "").upper() in listed_usdt_pair_map()


def non_binance_listed_usdt_symbols() -> frozenset[str]:
    """Listed USDT symbols that must never be sent to Binance REST/WS."""
    from listings.market_data import _CORE_BINANCE_SET

    syms = set(listed_usdt_pair_map().keys()) | set(internal_mock_usdt_symbols())
    return frozenset(s for s in syms if s not in _CORE_BINANCE_SET and s != "IBOUSDT")


def listed_usdt_price(base: str, *, symbol: Optional[str] = None) -> float:
    """Best-effort USD/USDT price hint for a listed base asset."""
    b = (base or "").upper()
    if not b:
        return 0.0
    if b == "IBO":
        from ibo.pricing import platform_ibo_usdt_price

        return platform_ibo_usdt_price()
    sym = (symbol or f"{b}USDT").upper()
    mock = INTERNAL_MOCK_USDT.get(sym) or {}
    try:
        px = float(mock.get("price_usd") or 0)
        if px > 0:
            return px
    except (TypeError, ValueError):
        pass
    try:
        from listings.ibo_pairs import get_ibo_usd_price_hints

        hint = float((get_ibo_usd_price_hints() or {}).get(b) or 0)
        if hint > 0:
            return hint
    except Exception:  # noqa: BLE001
        pass
    return 0.0


def generate_listed_usdt_ticker(
    symbol: str,
    *,
    pair: Optional[Dict[str, Any]] = None,
    flat_24h: bool = False,
) -> Dict[str, Any]:
    """Synthetic 24h ticker for a listed token without a Binance USDT market."""
    sym = (symbol or "").upper()
    meta = pair or listed_usdt_pair_map().get(sym) or {}
    base = (meta.get("base") or sym.replace("USDT", "")).upper()
    px = listed_usdt_price(base, symbol=sym)
    if px <= 0:
        px = 0.0001
    rng = random.Random(f"listed-tick-{sym}")
    live = px if flat_24h else px * rng.uniform(0.997, 1.003)
    if flat_24h:
        pct = 0.0
        open_p = live
        ch = 0.0
        vol = 0.0
    else:
        pct = rng.uniform(-4.0, 4.0)
        open_p = live / (1 + pct / 100)
        ch = live - open_p
        vol = rng.uniform(10_000, 250_000)
    spr = live * 0.0004
    band_hi = live if flat_24h else live * 1.03
    band_lo = live if flat_24h else live * 0.97
    return {
        "symbol": sym,
        "price": f"{live:.8f}".rstrip("0").rstrip("."),
        "priceChange": f"{ch:.8f}".rstrip("0").rstrip("."),
        "priceChangePercent": f"{pct:.2f}",
        "highPrice": f"{band_hi:.8f}".rstrip("0").rstrip("."),
        "lowPrice": f"{band_lo:.8f}".rstrip("0").rstrip("."),
        "volume": f"{vol:.2f}",
        "quoteVolume": f"{vol * live:.2f}",
        "openPrice": f"{open_p:.8f}".rstrip("0").rstrip("."),
        "weightedAvgPrice": f"{live:.8f}".rstrip("0").rstrip("."),
        "bidPrice": f"{max(live - spr / 2, 1e-12):.8f}".rstrip("0").rstrip("."),
        "askPrice": f"{(live + spr / 2):.8f}".rstrip("0").rstrip("."),
        "prevClosePrice": None,
        "count": str(rng.randint(100, 5000)),
    }


def listed_market_row_from_pair(p: Dict[str, Any]) -> Dict[str, Any]:
    """Markets snapshot row for a listed USDT pair not on Binance (stable per symbol)."""
    sym = (p.get("symbol") or "").upper()
    base = (p.get("base") or sym.replace("USDT", "")).upper()
    tick = generate_listed_usdt_ticker(sym, pair=p)
    stats_source = "internal_mock" if is_internal_mock_usdt_pair(sym) else "listed"
    return {
        "symbol": sym,
        "base": base,
        "baseAsset": base,
        "quoteAsset": "USDT",
        "source": "listed",
        "stats_source": stats_source,
        "price": tick["price"],
        "priceChange": tick["priceChange"],
        "priceChangePercent": tick["priceChangePercent"],
        "openPrice": tick["openPrice"],
        "highPrice": tick["highPrice"],
        "lowPrice": tick["lowPrice"],
        "volume": tick["volume"],
        "quoteVolume": tick["quoteVolume"],
        "weightedAvgPrice": tick["weightedAvgPrice"],
        "bidPrice": tick["bidPrice"],
        "askPrice": tick["askPrice"],
        "prevClosePrice": tick.get("prevClosePrice"),
        "count": tick.get("count", "0"),
        "listed_token_id": p.get("token_id"),
        "project_name": p.get("project_name"),
        "token_name": p.get("token_name"),
        "logo_url": p.get("logo_url"),
        "is_listed": True,
    }


def generate_listed_usdt_klines(
    symbol: str,
    interval: str = "1h",
    limit: int = 200,
    *,
    pair: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    sym = (symbol or "").upper()
    meta = pair or listed_usdt_pair_map().get(sym) or {}
    base = (meta.get("base") or sym.replace("USDT", "")).upper()
    target = listed_usdt_price(base, symbol=sym) or 0.0001

    interval_seconds = {
        "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
        "1h": 3600, "4h": 14400, "1d": 86400,
    }.get(interval, 3600)

    now_ts = int(datetime.now(timezone.utc).timestamp())
    boundary = (now_ts // interval_seconds) * interval_seconds
    rng = random.Random(f"listed-{sym}-{interval}")
    candles: List[Dict[str, Any]] = []
    price = target * 0.92

    for i in range(limit, 0, -1):
        t = boundary - i * interval_seconds
        pct = rng.uniform(-0.028, 0.032)
        close = price * (1 + pct)
        high = max(price, close) * (1 + rng.uniform(0, 0.012))
        low = min(price, close) * (1 - rng.uniform(0, 0.012))
        vol = rng.uniform(5_000, 120_000)
        candles.append({
            "time": t,
            "open": round(price, 8),
            "high": round(high, 8),
            "low": round(low, 8),
            "close": round(close, 8),
            "volume": round(vol, 2),
        })
        price = close

    if candles and target > 0:
        scale = target / candles[-1]["close"] if candles[-1]["close"] else 1
        for c in candles:
            for k in ("open", "high", "low", "close"):
                c[k] = round(float(c[k]) * scale, 8)
    return candles


def generate_listed_usdt_orderbook(symbol: str, depth: int = 20, *, mid: Optional[float] = None) -> Dict[str, Any]:
    sym = (symbol or "").upper()
    meta = listed_usdt_pair_map().get(sym) or {}
    base = (meta.get("base") or sym.replace("USDT", "")).upper()
    px = float(mid) if mid and mid > 0 else listed_usdt_price(base, symbol=sym)
    if px <= 0:
        px = 0.0001
    rng = random.Random(f"listed-book-{sym}")
    best_ask = px * 1.0008
    best_bid = px * 0.9992
    asks = [[f"{best_ask * (1 + i * 0.001):.8f}", f"{rng.uniform(50, 5000):.2f}"] for i in range(depth)]
    bids = [[f"{best_bid * (1 - i * 0.001):.8f}", f"{rng.uniform(50, 5000):.2f}"] for i in range(depth)]
    return {"lastUpdateId": int(datetime.now(timezone.utc).timestamp() * 1000), "asks": asks, "bids": bids}
