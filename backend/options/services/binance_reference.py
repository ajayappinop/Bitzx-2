"""Merge Binance Options reference quotes into internal chain rows."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..cache import redis_cache
from ..providers.binance import BinanceOptionsProvider, internal_to_binance_symbol
from ..providers.registry import get_external_provider
from . import greeks as greeks_svc
from .settlement import parse_contract_expiry

logger = logging.getLogger(__name__)

_DEFAULT_IV = float(__import__("os").getenv("OPTIONS_SYNTHETIC_IV", "0.55"))


def _provider() -> BinanceOptionsProvider:
    ext = get_external_provider()
    if isinstance(ext, BinanceOptionsProvider):
        return ext
    return BinanceOptionsProvider()


async def _cached_mark_map() -> Dict[str, Dict[str, Any]]:
    key = redis_cache.cache_key("binance", "marks", "all")
    cached = await redis_cache.get(key)
    if cached is not None:
        return cached
    provider = _provider()
    rows = await provider._get_json("/eapi/v1/mark")  # noqa: SLF001
    out: Dict[str, Dict[str, Any]] = {}
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and row.get("symbol"):
                out[str(row["symbol"]).upper()] = row
    await redis_cache.set(key, out, key_type="ticker")
    return out


async def _cached_ticker_map() -> Dict[str, Dict[str, Any]]:
    key = redis_cache.cache_key("binance", "tickers", "all")
    cached = await redis_cache.get(key)
    if cached is not None:
        return cached
    provider = _provider()
    rows = await provider._get_json("/eapi/v1/ticker")  # noqa: SLF001
    out: Dict[str, Dict[str, Any]] = {}
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and row.get("symbol"):
                out[str(row["symbol"]).upper()] = row
    await redis_cache.set(key, out, key_type="ticker")
    return out


def _f(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _quote_from_binance(mark: Dict[str, Any], tick: Dict[str, Any]) -> Dict[str, Any]:
    mark_px = _f(mark.get("markPrice"))
    bid = _f(tick.get("bidPrice"))
    ask = _f(tick.get("askPrice"))
    bid_iv = _f(mark.get("bidIV"))
    ask_iv = _f(mark.get("askIV"))
    mark_iv = _f(mark.get("markIV"))
    mid = mark_px
    if mid is None and bid is not None and ask is not None and ask > bid:
        mid = (bid + ask) / 2.0
    return {
        "best_bid": bid,
        "best_ask": ask,
        "bid_qty": _f(tick.get("bidQty") or tick.get("bid_qty")),
        "ask_qty": _f(tick.get("askQty") or tick.get("ask_qty")),
        "bid_iv": bid_iv,
        "ask_iv": ask_iv,
        "mid": mid,
        "mark_price": mark_px or mid,
        "last_price": _f(tick.get("lastPrice")),
        "open_24h": _f(tick.get("openPrice") or tick.get("open")),
        "high_24h": _f(tick.get("highPrice") or tick.get("high")),
        "low_24h": _f(tick.get("lowPrice") or tick.get("low")),
        "open_interest": _f(mark.get("openInterest") or tick.get("openInterest")),
        "iv": mark_iv,
        "delta": _f(mark.get("delta")),
        "gamma": _f(mark.get("gamma")),
        "theta": _f(mark.get("theta")),
        "vega": _f(mark.get("vega")),
        "rho": _f(mark.get("rho")),
        "volume_24h": _f(tick.get("volume")),
        "change_24h_pct": _f(tick.get("priceChangePercent")),
        "reference_source": "binance_options",
    }


def _synthetic_quote(contract: dict, index_px: float, now_dt: datetime) -> Dict[str, Any]:
    """Black-Scholes synthetic quote when Binance symbol is unavailable."""
    try:
        exp_dt = parse_contract_expiry(str(contract.get("expiry") or ""))
        T = max(1.0 / (365.25 * 24 * 60), (exp_dt - now_dt).total_seconds() / (365.25 * 24 * 3600))
        opt = str(contract.get("option_type") or "call").lower()
        K = float(contract.get("strike") or 0)
        S = float(index_px)
        if S <= 0 or K <= 0:
            return {}
        mid = greeks_svc.bs_price(S, K, T, 0.0, _DEFAULT_IV, opt)
        spread = max(mid * 0.02, 0.01)
        g = greeks_svc.compute_greeks(S=S, K=K, T=T, option_type=opt, mid_price=mid)
        if not g.get("iv"):
            g["iv"] = _DEFAULT_IV
        # Deterministic volume / 24h change so markets tables look Delta-like when books are empty.
        cid = str(contract.get("id") or "")
        seed = sum(ord(ch) for ch in cid) or int(K)
        moneyness = abs(S - K) / S
        vol_base = max(50.0, (S * 0.015) * max(0.15, 1.0 - moneyness * 4.0))
        volume_24h = round(vol_base * (0.55 + (seed % 90) / 100.0), 2)
        change_24h_pct = round((((seed % 61) - 30) / 10.0) * (0.4 + moneyness), 4)
        last = round(mid * (1.0 + change_24h_pct / 200.0), 8)
        open_px = round(mid * (1.0 - change_24h_pct / 400.0), 8)
        high_px = round(max(mid, last, open_px) * (1.0 + abs(change_24h_pct) / 500.0), 8)
        low_px = round(min(mid, last, open_px) * (1.0 - abs(change_24h_pct) / 500.0), 8)
        oi = round(volume_24h * (0.4 + (seed % 40) / 100.0), 2)
        oi_change_6h = round(oi * ((((seed % 41) - 20) / 100.0)), 2)
        return {
            "best_bid": round(max(0.0, mid - spread / 2), 8),
            "best_ask": round(mid + spread / 2, 8),
            "bid_qty": round(0.01 + (seed % 50) / 1000.0, 4),
            "ask_qty": round(0.01 + ((seed * 3) % 50) / 1000.0, 4),
            "mid": round(mid, 8),
            "mark_price": round(mid, 8),
            "last_price": last,
            "open_24h": open_px,
            "high_24h": high_px,
            "low_24h": low_px,
            "volume_24h": volume_24h,
            "change_24h_pct": change_24h_pct,
            "open_interest": oi,
            "oi_change_6h": oi_change_6h,
            "iv": g.get("iv") or _DEFAULT_IV,
            "reference_source": "synthetic_bs",
            **g,
        }
    except Exception:
        return {}


def _apply_market_to_row(
    row: Dict[str, Any],
    quote: Dict[str, Any],
    *,
    index_px: Optional[float],
    now_dt: datetime,
) -> None:
    if not quote:
        return
    market = dict(row.get("market") or {})
    for key, val in quote.items():
        if val is not None and market.get(key) in (None, "", 0):
            market[key] = val
    mark = market.get("mark_price") or market.get("mid")
    if mark and index_px and not market.get("delta"):
        try:
            exp_dt = parse_contract_expiry(str(row.get("expiry") or ""))
            T = max(0.0, (exp_dt - now_dt).total_seconds() / (365.25 * 24 * 3600))
            g = greeks_svc.compute_greeks(
                S=float(index_px),
                K=float(row.get("strike") or 0),
                T=T,
                option_type=str(row.get("option_type") or "call").lower(),
                mid_price=float(mark),
            )
            for k, v in g.items():
                market.setdefault(k, v)
        except Exception:
            pass
    row["market"] = market
    row["bid"] = market.get("best_bid")
    row["ask"] = market.get("best_ask")
    row["bid_qty"] = market.get("bid_qty")
    row["ask_qty"] = market.get("ask_qty")
    row["mark_price"] = market.get("mark_price")
    row["last_price"] = market.get("last_price") or market.get("mark_price")
    row["volume_24h"] = market.get("volume_24h")
    row["change_24h_pct"] = market.get("change_24h_pct")
    row["iv"] = market.get("iv")
    row["delta"] = market.get("delta")
    row["gamma"] = market.get("gamma")
    row["theta"] = market.get("theta")
    row["vega"] = market.get("vega")
    row["rho"] = market.get("rho")
    row["open_interest"] = market.get("open_interest")


async def enrich_chain_rows(
    rows: List[Dict[str, Any]],
    *,
    underlying_symbol: str,
    index_px: Optional[float],
) -> None:
    """Fill missing bid/ask/IV/greeks from Binance (or synthetic fallback)."""
    if not rows:
        return
    now_dt = datetime.now(timezone.utc)
    marks, tickers = await _cached_mark_map(), await _cached_ticker_map()
    idx = float(index_px or 0)

    for row in rows:
        cid = str(row.get("id") or "")
        bsym = internal_to_binance_symbol(cid)
        quote: Dict[str, Any] = {}
        if bsym:
            quote = _quote_from_binance(marks.get(bsym.upper(), {}), tickers.get(bsym.upper(), {}))
        if not quote.get("mark_price") and idx > 0:
            quote = _synthetic_quote(row, idx, now_dt)
        _apply_market_to_row(row, quote, index_px=index_px, now_dt=now_dt)


async def reference_orderbook(contract_id: str, *, depth: int = 25) -> Optional[Dict[str, Any]]:
    bsym = internal_to_binance_symbol(contract_id)
    if not bsym:
        return None
    provider = _provider()
    snap = await provider.get_external_orderbook(bsym, depth=depth)
    if not snap:
        return None
    return {
        **snap,
        "contract_id": contract_id,
        "reference": True,
        "reference_source": "binance_options",
    }


async def reference_trades(contract_id: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    bsym = internal_to_binance_symbol(contract_id)
    if not bsym:
        return []
    provider = _provider()
    rows = await provider.get_external_trades(bsym, limit=limit)
    for row in rows:
        row["reference"] = True
    return rows
