"""Real market stats for listed USDT pairs (Binance 24hr ticker)."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional, Set

import requests

from listings.registry import get_market_pair_defs

logger = logging.getLogger(__name__)

_BINANCE_24HR = "https://api.binance.com/api/v3/ticker/24hr"
_MAX_BATCH = 100
_ALL_TICKERS_TTL_SEC = 45

# Not listed on Binance spot — including these in a batched ``symbols`` param fails the whole request.
_NON_BINANCE_USDT_SYMBOLS = frozenset({"IBOUSDT"})


def _dynamic_non_binance_usdt() -> frozenset[str]:
    try:
        from listings.listed_trading import non_binance_listed_usdt_symbols

        return non_binance_listed_usdt_symbols()
    except Exception:  # noqa: BLE001
        return frozenset()


def _non_binance_usdt() -> frozenset[str]:
    return _NON_BINANCE_USDT_SYMBOLS | _dynamic_non_binance_usdt()

# Validated Binance USDT spot pairs (batch-safe). Web3 CoinGecko symbols are NOT Binance tickers.
CORE_BINANCE_USDT_PAIRS: List[str] = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "POLUSDT",
    "AVAXUSDT", "DOTUSDT", "LINKUSDT", "LTCUSDT",
]
_CORE_BINANCE_SET = frozenset(CORE_BINANCE_USDT_PAIRS)

_all_tickers_cache: Dict[str, Any] = {"map": {}, "fetched_at": 0.0}


def symbols_for_binance_24hr(symbols: List[str]) -> List[str]:
    """Strip internal/synthetic symbols before calling Binance batch ticker API."""
    out: List[str] = []
    seen: Set[str] = set()
    for s in symbols:
        sym = (s or "").upper()
        if not sym or sym in _non_binance_usdt() or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def core_binance_usdt_symbols() -> List[str]:
    """USDT symbols safe for Binance batch API (platform majors + listed trading pairs)."""
    seen: Set[str] = set(_CORE_BINANCE_SET)
    out: List[str] = list(CORE_BINANCE_USDT_PAIRS)
    for p in get_market_pair_defs():
        sym = (p.get("symbol") or "").upper()
        quote = (p.get("quote") or "USDT").upper()
        if sym and quote == "USDT" and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def _fetch_binance_24hr_all_cached() -> Dict[str, Dict[str, Any]]:
    """Full Binance 24h ticker map (one request). Used when batch would include invalid symbols."""
    now = time.time()
    if _all_tickers_cache["map"] and (now - float(_all_tickers_cache["fetched_at"] or 0)) < _ALL_TICKERS_TTL_SEC:
        return dict(_all_tickers_cache["map"])
    try:
        r = requests.get(_BINANCE_24HR, timeout=25)
        r.raise_for_status()
        raw = r.json()
    except requests.RequestException as e:
        logger.warning("Binance 24hr full ticker fetch failed: %s", e)
        return dict(_all_tickers_cache["map"])
    by_sym: Dict[str, Dict[str, Any]] = {}
    if isinstance(raw, list):
        for t in raw:
            if isinstance(t, dict) and t.get("symbol"):
                by_sym[str(t["symbol"]).upper()] = t
    _all_tickers_cache["map"] = by_sym
    _all_tickers_cache["fetched_at"] = now
    return by_sym


def _symbols_safe_for_binance_batch(symbols: List[str]) -> List[str]:
    """Only core Binance USDT pairs — listed non-Binance symbols must not break batch API."""
    return [s for s in symbols_for_binance_24hr(symbols) if s in _CORE_BINANCE_SET]


def usdt_symbols_for_snapshot(core_symbols: List[str]) -> List[str]:
    """Core Binance pairs plus every listed USDT trading symbol (deduped, order preserved)."""
    seen: Set[str] = set()
    out: List[str] = []
    for s in core_symbols:
        sym = (s or "").upper()
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    for p in get_market_pair_defs():
        sym = (p.get("symbol") or "").upper()
        quote = (p.get("quote") or "USDT").upper()
        if sym and quote == "USDT" and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def _fetch_binance_24hr_single(symbol: str) -> Optional[Dict[str, Any]]:
    sym = (symbol or "").upper()
    if not sym or sym in _non_binance_usdt():
        return None
    try:
        r = requests.get(_BINANCE_24HR, params={"symbol": sym}, timeout=10)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, dict) and data.get("symbol") else None
    except requests.RequestException as e:
        logger.debug("Binance 24hr single %s failed: %s", sym, e)
        return None


def fetch_binance_24hr_map(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """Fetch Binance 24h tickers for ``symbols``. Returns symbol → raw ticker."""
    fetchable = symbols_for_binance_24hr(symbols)
    if not fetchable:
        return {}

    want = set(fetchable)
    batch_safe = _symbols_safe_for_binance_batch(fetchable)
    non_batch = want - set(batch_safe)

    # CoinGecko-style fake USDT symbols (0GUSDT, AAPLONUSDT, …) — filter from full ticker map.
    if non_batch:
        full = _fetch_binance_24hr_all_cached()
        by_sym = {sym: full[sym] for sym in non_batch if sym in full}
    else:
        by_sym = {}

    for i in range(0, len(batch_safe), _MAX_BATCH):
        chunk = batch_safe[i : i + _MAX_BATCH]
        if not chunk:
            continue
        try:
            r = requests.get(
                _BINANCE_24HR,
                params={"symbols": json.dumps(chunk, separators=(",", ":"))},
                timeout=15,
            )
            r.raise_for_status()
            raw = r.json()
            if isinstance(raw, list):
                for t in raw:
                    if isinstance(t, dict) and t.get("symbol"):
                        by_sym[str(t["symbol"]).upper()] = t
        except requests.RequestException as e:
            logger.debug(
                "Binance 24hr batch failed (%s…): %s — using full ticker filter",
                chunk[:2],
                e,
            )
            full = _fetch_binance_24hr_all_cached()
            for sym in chunk:
                if sym in full:
                    by_sym[sym] = full[sym]
    by_sym.pop("IBOUSDT", None)
    return by_sym


def append_listed_rows_from_binance(
    rows: List[Dict[str, Any]],
    by_sym: Dict[str, Dict[str, Any]],
    *,
    row_from_ticker,
) -> List[Dict[str, Any]]:
    """Add listed trading pairs that have a live Binance USDT ticker (no synthetic OHLC)."""
    seen = {(r.get("symbol") or "").upper() for r in rows}
    for p in get_market_pair_defs():
        sym = (p.get("symbol") or "").upper()
        if not sym or sym in seen:
            continue
        quote = (p.get("quote") or "USDT").upper()
        if quote != "USDT":
            continue
        ticker = by_sym.get(sym)
        if not ticker:
            continue
        row = row_from_ticker(ticker)
        row["source"] = "listed"
        row["stats_source"] = "binance"
        row["listed_token_id"] = p.get("token_id")
        row["project_name"] = p.get("project_name")
        row["logo_url"] = p.get("logo_url")
        rows.append(row)
        seen.add(sym)
    return rows


def _row_needs_listed_stub(row: Dict[str, Any]) -> bool:
    """True when an existing markets row lacks usable listed-token stats."""
    try:
        px = float(row.get("price") or 0)
    except (TypeError, ValueError):
        px = 0.0
    stats = str(row.get("stats_source") or "")
    if px <= 0:
        return True
    if stats == "fallback":
        return True
    pct = row.get("priceChangePercent")
    if px > 0 and (pct is None or pct == "") and row.get("source") in ("listed", "internal_mock"):
        return True
    return False


def append_listed_stub_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Listed USDT pairs without a Binance ticker — metadata + synthetic OHLC for UI."""
    from listings.listed_trading import listed_market_row_from_pair

    index_by_sym = {(r.get("symbol") or "").upper(): i for i, r in enumerate(rows)}
    for p in get_market_pair_defs():
        sym = (p.get("symbol") or "").upper()
        if not sym:
            continue
        if sym == "IBOUSDT":
            continue
        if (p.get("quote") or "USDT").upper() != "USDT":
            continue
        stub = listed_market_row_from_pair(p)
        if sym in index_by_sym:
            if _row_needs_listed_stub(rows[index_by_sym[sym]]):
                rows[index_by_sym[sym]] = stub
            continue
        rows.append(stub)
        index_by_sym[sym] = len(rows) - 1
    return rows
