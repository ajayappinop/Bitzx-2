"""Dynamic USDT perpetuals for admin-listed spot tokens."""

from __future__ import annotations

from typing import Any, Dict

from listings.registry import get_market_pair_defs


def _default_futures_meta(base: str, spot_symbol: str) -> Dict[str, Any]:
    b = (base or "").upper()
    # Conservative defaults for thin / DEX-listed assets.
    if b in {"BTC", "ETH"}:
        tick, lot, min_q, max_q = 0.10, 0.001, 0.001, 1000.0
    elif b in {"BNB", "SOL"}:
        tick, lot, min_q, max_q = 0.01, 0.01, 0.01, 50_000.0
    else:
        tick, lot, min_q, max_q = 0.00001, 1.0, 1.0, 10_000_000.0
    return {
        "base": b,
        "quote": "USDT",
        "binance_symbol": spot_symbol.upper(),
        "index_source": "listed",
        "tick_size": tick,
        "lot_size": lot,
        "min_qty": min_q,
        "max_qty": max_q,
        "is_listed": True,
    }


def merge_listed_into_futures(static: Dict[str, Dict[str, object]]) -> Dict[str, Dict[str, object]]:
    merged: Dict[str, Dict[str, object]] = {k: dict(v) for k, v in static.items()}
    for p in get_market_pair_defs():
        if (p.get("quote") or "USDT").upper() != "USDT":
            continue
        base = (p.get("base") or "").upper()
        spot = (p.get("symbol") or f"{base}USDT").upper()
        if not base or not spot:
            continue
        perp = f"{spot}-PERP"
        if perp in merged:
            continue
        merged[perp] = _default_futures_meta(base, spot)
    return merged
