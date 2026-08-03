"""Synthetic market-data generators for IBO-quoted pairs.

Prices are derived as:
    pair_price_in_ibo = base_usdt_price / ibo_usdt_price

All generators mirror the style of generate_ibo_* in server.py so they
slot into the same REST/WS dispatch paths.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .constants import (
    IBO_PAIR_FALLBACK_USDT,
    IBO_QUOTED_PAIRS,
    IBO_QUOTED_SYMBOL_MAP,
)


def _pair_base(symbol: str) -> Optional[str]:
    from listings.ibo_pairs import resolve_ibo_base

    return resolve_ibo_base(symbol.upper())

# ── Interval → seconds ────────────────────────────────────────────────────────
_INTERVAL_SECS: Dict[str, int] = {
    "1m":  60,   "3m":  180,  "5m":  300,  "15m": 900,
    "30m": 1800, "1h":  3600, "2h":  7200, "4h":  14400,
    "6h":  21600,"8h":  28800,"12h": 43200,"1d":  86400,
    "3d":  259200,"1w": 604800,
}

def _interval_secs(interval: str) -> int:
    return _INTERVAL_SECS.get(interval.lower(), 3600)


def _derived_price(base: str, ibo_price: float, *, jitter: bool = False) -> float:
    """Return price of ``base`` denominated in IBO."""
    base_usdt = IBO_PAIR_FALLBACK_USDT.get(base.upper(), 1.0)
    price = base_usdt / max(ibo_price, 1e-12)
    if jitter:
        price *= random.uniform(0.997, 1.003)
    return price


# ── Public helpers ────────────────────────────────────────────────────────────

def generate_ibo_pair_ticker(
    symbol: str,
    ibo_price: float,
    *,
    base_usdt: Optional[float] = None,
    pct_24h: Optional[float] = None,
) -> Dict[str, Any]:
    """Return a 24-h ticker dict for a IBO-quoted pair."""
    base = _pair_base(symbol)
    if base is None:
        return {}

    ibo_px = max(float(ibo_price or 0), 1e-12)
    usdt = base_usdt
    if usdt is None or usdt <= 0:
        live = _derived_price(base, ibo_px, jitter=True)
    else:
        live = float(usdt) / ibo_px * random.uniform(0.997, 1.003)
    change_pct = float(pct_24h) if pct_24h is not None else random.uniform(-3.5, 3.5)
    open_p = live / (1 + change_pct / 100)
    high_p = live * random.uniform(1.001, 1.02)
    low_p  = live * random.uniform(0.98,  0.999)
    volume = random.uniform(5_000, 500_000)
    spread = live * 0.0004

    return {
        "symbol":             symbol.upper(),
        "base":               base,
        "baseAsset":          base,
        "quoteAsset":         "IBO",
        "source":             "internal",
        "price":              f"{live:.6f}",
        "priceChange":        f"{live - open_p:.6f}",
        "priceChangePercent": f"{change_pct:.2f}",
        "highPrice":          f"{high_p:.6f}",
        "lowPrice":           f"{low_p:.6f}",
        "volume":             f"{volume:.2f}",
        "quoteVolume":        f"{volume * live:.2f}",
        "openPrice":          f"{open_p:.6f}",
        "weightedAvgPrice":   f"{live:.6f}",
        "bidPrice":           f"{max(live - spread / 2, 1e-8):.6f}",
        "askPrice":           f"{live + spread / 2:.6f}",
        "prevClosePrice":     None,
        "count":              str(random.randint(500, 8_000)),
    }


def generate_ibo_pair_klines(
    symbol: str,
    ibo_price: float,
    interval: str = "1h",
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """Synthetic OHLCV candles for a IBO-quoted pair."""
    base = _pair_base(symbol)
    if base is None:
        return []

    target = _derived_price(base, ibo_price)
    step   = _interval_secs(interval)
    now    = datetime.now(timezone.utc)
    rng    = random.Random(f"{symbol}-{now.date()}-{interval}")

    price  = target * 0.82
    candles: List[Dict[str, Any]] = []
    for i in range(limit):
        price *= rng.uniform(0.992, 1.010)
        o = price
        h = price * rng.uniform(1.000, 1.015)
        l = price * rng.uniform(0.985, 1.000)
        c = rng.uniform(l, h)
        v = rng.uniform(1_000, 100_000)
        ts = int((now - timedelta(seconds=step * (limit - i))).timestamp())
        candles.append({"time": ts, "open": round(o, 6), "high": round(h, 6),
                        "low": round(l, 6), "close": round(c, 6), "volume": round(v, 2)})
        price = c

    # Anchor last close to current derived price
    if candles:
        scale = target / candles[-1]["close"] if candles[-1]["close"] else 1
        for c in candles:
            for k in ("open", "high", "low", "close"):
                c[k] = round(c[k] * scale, 6)
    return candles


def generate_ibo_pair_orderbook(
    symbol: str,
    ibo_price: float,
    depth: int = 20,
    *,
    mid_price: Optional[float] = None,
) -> Dict[str, Any]:
    """Synthetic order book for a IBO-quoted pair (anchored to live ticker when provided)."""
    base = _pair_base(symbol)
    if base is None:
        return {"bids": [], "asks": []}

    if mid_price is not None and float(mid_price) > 0:
        mid = float(mid_price)
    else:
        from listings.ibo_pairs import base_usdt_for_ibo_pair

        usdt = base_usdt_for_ibo_pair(base)
        mid = (usdt / max(ibo_price, 1e-12)) if usdt and usdt > 0 else _derived_price(base, ibo_price)

    best_ask = mid * 1.0008
    best_bid = mid * 0.9992
    rng = random.Random(f"book-{symbol}-{int(mid * 1e6)}")

    asks = [[f"{best_ask * (1 + i * 0.001):.8f}", f"{rng.uniform(0.01, 5.0):.4f}"]
            for i in range(depth)]
    bids = [[f"{best_bid * (1 - i * 0.001):.8f}", f"{rng.uniform(0.01, 5.0):.4f}"]
            for i in range(depth)]
    return {"bids": bids, "asks": asks}


def generate_ibo_pair_trades(
    symbol: str,
    ibo_price: float,
    limit: int = 50,
    *,
    mid_price: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Synthetic recent trades for a IBO-quoted pair."""
    base = _pair_base(symbol)
    if base is None:
        return []

    if mid_price is not None and float(mid_price) > 0:
        mid = float(mid_price)
    else:
        from listings.ibo_pairs import base_usdt_for_ibo_pair

        usdt = base_usdt_for_ibo_pair(base)
        mid = (usdt / max(ibo_price, 1e-12)) if usdt and usdt > 0 else _derived_price(base, ibo_price)
    now  = datetime.now(timezone.utc)
    rng  = random.Random()
    trades = []
    for i in range(limit):
        price = mid * rng.uniform(0.994, 1.006)
        qty   = rng.uniform(0.001, 2.0)
        ts    = now - timedelta(seconds=i * rng.uniform(3, 60))
        trades.append({
            "id":           limit - i,
            "price":        f"{price:.6f}",
            "qty":          f"{qty:.4f}",
            "quoteQty":     f"{price * qty:.6f}",
            "time":         int(ts.timestamp() * 1000),
            "isBuyerMaker": rng.random() > 0.5,
        })
    return trades


def _row_from_binance_ticker(
    sym: str,
    base: str,
    t: Dict[str, Any],
    ibo_px: float,
) -> Optional[Dict[str, Any]]:
    try:
        last_usdt = float(t.get("lastPrice") or 0)
        open_usdt = float(t.get("openPrice") or last_usdt)
        high_usdt = float(t.get("highPrice") or last_usdt)
        low_usdt = float(t.get("lowPrice") or last_usdt)
        bid_usdt = float(t.get("bidPrice") or last_usdt)
        ask_usdt = float(t.get("askPrice") or last_usdt)
    except (TypeError, ValueError):
        return None
    if last_usdt <= 0:
        return None
    live = last_usdt / ibo_px
    open_p = open_usdt / ibo_px
    ch = live - open_p
    vol = t.get("volume", "0")
    qvol = t.get("quoteVolume", "0")
    return {
        "symbol": sym.upper(),
        "base": base,
        "baseAsset": base,
        "quoteAsset": "IBO",
        "source": "binance",
        "stats_source": "binance",
        "price": f"{live:.8f}".rstrip("0").rstrip("."),
        "priceChange": f"{ch:.8f}".rstrip("0").rstrip("."),
        "priceChangePercent": str(t.get("priceChangePercent", "0")),
        "highPrice": f"{(high_usdt / ibo_px):.8f}".rstrip("0").rstrip("."),
        "lowPrice": f"{(low_usdt / ibo_px):.8f}".rstrip("0").rstrip("."),
        "volume": str(vol),
        "quoteVolume": str(qvol),
        "openPrice": f"{open_p:.8f}".rstrip("0").rstrip("."),
        "weightedAvgPrice": f"{live:.8f}".rstrip("0").rstrip("."),
        "bidPrice": f"{(bid_usdt / ibo_px):.8f}".rstrip("0").rstrip("."),
        "askPrice": f"{(ask_usdt / ibo_px):.8f}".rstrip("0").rstrip("."),
        "prevClosePrice": t.get("prevClosePrice"),
        "count": str(t.get("count", "0")),
    }


def _row_from_coingecko_hint(
    sym: str,
    base: str,
    usdt_px: float,
    ibo_px: float,
    *,
    pct: Optional[float] = None,
) -> Dict[str, Any]:
    live = usdt_px / ibo_px
    pct_v = float(pct) if pct is not None else random.uniform(-3.5, 3.5)
    open_p = live / (1 + pct_v / 100)
    ch = live - open_p
    vol = random.uniform(5_000, 500_000)
    return {
        "symbol": sym.upper(),
        "base": base,
        "baseAsset": base,
        "quoteAsset": "IBO",
        "source": "web3",
        "stats_source": "coingecko",
        "price": f"{live:.8f}".rstrip("0").rstrip("."),
        "priceChange": f"{ch:.8f}".rstrip("0").rstrip("."),
        "priceChangePercent": f"{pct_v:.2f}",
        "highPrice": f"{(live * 1.02):.8f}".rstrip("0").rstrip("."),
        "lowPrice": f"{(live * 0.98):.8f}".rstrip("0").rstrip("."),
        "volume": f"{vol:.2f}",
        "quoteVolume": f"{vol * live:.2f}",
        "openPrice": f"{open_p:.8f}".rstrip("0").rstrip("."),
        "weightedAvgPrice": f"{live:.8f}".rstrip("0").rstrip("."),
        "bidPrice": f"{(live * 0.9996):.8f}".rstrip("0").rstrip("."),
        "askPrice": f"{(live * 1.0004):.8f}".rstrip("0").rstrip("."),
        "prevClosePrice": None,
        "count": str(random.randint(500, 8_000)),
    }


def generate_ibo_markets_snapshot_from_binance(
    ibo_price: float,
    by_sym: Dict[str, Any],
    *,
    usd_hints: Optional[Dict[str, float]] = None,
) -> List[Dict[str, Any]]:
    """IBO-quoted pairs using Binance USDT tickers or CoinGecko USD hints."""
    from listings.ibo_pairs import get_tradable_ibo_symbol_map

    rows: List[Dict[str, Any]] = []
    ibo_px = max(float(ibo_price or 0), 1e-12)
    hints = usd_hints or {}
    for sym, base in get_tradable_ibo_symbol_map().items():
        usdt_sym = f"{base}USDT"
        t = by_sym.get(usdt_sym)
        if t and isinstance(t, dict):
            row = _row_from_binance_ticker(sym, base, t, ibo_px)
            if row:
                rows.append(row)
            continue
        hint = hints.get(base)
        if hint and hint > 0:
            rows.append(_row_from_coingecko_hint(sym, base, float(hint), ibo_px))
    return rows


def generate_ibo_markets_snapshot(ibo_price: float) -> List[Dict[str, Any]]:
    """Return ticker rows for all tradable IBO-quoted pairs (synthetic fallback)."""
    from listings.ibo_pairs import get_ibo_usd_price_hints, get_tradable_ibo_symbol_map

    hints = get_ibo_usd_price_hints()
    out: List[Dict[str, Any]] = []
    for sym, base in get_tradable_ibo_symbol_map().items():
        row = generate_ibo_pair_ticker(
            sym,
            ibo_price,
            base_usdt=hints.get(base),
        )
        if row:
            out.append(row)
    return out
