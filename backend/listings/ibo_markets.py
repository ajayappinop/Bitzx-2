"""Optimized IBO markets payloads — paginated API + small WS broadcast."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from ibo.constants import IBO_QUOTED_SYMBOL_MAP

logger = logging.getLogger(__name__)

_ROWS_CACHE: Dict[str, Any] = {"rows": [], "fetched_at": 0.0}
_ROWS_TTL_SEC = 55


def invalidate_ibo_rows_cache() -> None:
    _ROWS_CACHE["rows"] = []
    _ROWS_CACHE["fetched_at"] = 0.0

BROADCAST_LIMIT = int(os.getenv("IBO_MARKETS_WS_LIMIT", "48") or "48")
DEFAULT_PAGE_LIMIT = int(os.getenv("IBO_MARKETS_PAGE_LIMIT", "40") or "40")
MAX_PAGE_LIMIT = 80


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_all_ibo_market_rows(ibo_usdt_price: float) -> List[Dict[str, Any]]:
    """Full tradable IBO rows (cached). Expensive — call sparingly."""
    from listings.ibo_pairs import get_ibo_usd_price_hints
    from listings.market_data import core_binance_usdt_symbols, fetch_binance_24hr_map
    import ibo.market_data as ibo_market_data

    by_sym = fetch_binance_24hr_map(core_binance_usdt_symbols())
    usd_hints = get_ibo_usd_price_hints()
    rows = ibo_market_data.generate_ibo_markets_snapshot_from_binance(
        ibo_usdt_price, by_sym, usd_hints=usd_hints,
    )
    if not rows:
        rows = ibo_market_data.generate_ibo_markets_snapshot(ibo_usdt_price)
    else:
        seen = {(r.get("symbol") or "").upper() for r in rows}
        from listings.ibo_pairs import get_tradable_ibo_symbol_map

        for sym, base in get_tradable_ibo_symbol_map().items():
            if sym in seen:
                continue
            stub = ibo_market_data.generate_ibo_pair_ticker(
                sym, ibo_usdt_price, base_usdt=usd_hints.get(base),
            )
            if stub:
                rows.append(stub)
                seen.add(sym)
    for r in rows:
        sym = (r.get("symbol") or "").upper()
        base = (r.get("base") or sym.replace("IBO", "")).upper()
        r["base"] = base
        r["tier"] = "major" if sym in IBO_QUOTED_SYMBOL_MAP else "web3"
    rows.sort(
        key=lambda r: (
            0 if r.get("tier") == "major" else 1,
            -_num(r.get("quoteVolume")),
            r.get("base") or "",
        )
    )
    from listings.ibo_pairs import get_ibo_logo_urls

    logos = get_ibo_logo_urls()
    for r in rows:
        base = (r.get("base") or "").upper()
        if not r.get("logo_url") and base:
            lu = logos.get(base)
            if lu:
                r["logo_url"] = lu
    try:
        from listings.registry import get_market_pair_defs

        listed_bases = {(p.get("base") or "").upper() for p in get_market_pair_defs()}
        for r in rows:
            base = (r.get("base") or "").upper()
            if base in listed_bases:
                r["is_listed"] = True
                r["source"] = r.get("source") or "listed"
    except Exception:  # noqa: BLE001
        pass
    return rows


def get_cached_ibo_rows(ibo_usdt_price: float, *, force: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    if (
        not force
        and _ROWS_CACHE["rows"]
        and (now - float(_ROWS_CACHE.get("fetched_at") or 0)) < _ROWS_TTL_SEC
    ):
        return list(_ROWS_CACHE["rows"])
    rows = build_all_ibo_market_rows(ibo_usdt_price)
    _ROWS_CACHE["rows"] = rows
    _ROWS_CACHE["fetched_at"] = now
    return rows


def summarize_ibo_rows(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    up = sum(1 for r in rows if _num(r.get("priceChangePercent")) > 0)
    down = sum(1 for r in rows if _num(r.get("priceChangePercent")) < 0)
    tvol = sum(_num(r.get("quoteVolume")) for r in rows)
    return {
        "total_pairs": len(rows),
        "gainers": up,
        "losers": down,
        "total_quote_volume": tvol,
    }


def top_gainers_losers(rows: List[Dict[str, Any]], *, n: int = 6) -> Tuple[List[Dict], List[Dict]]:
    sorted_rows = sorted(rows, key=lambda r: _num(r.get("priceChangePercent")), reverse=True)
    gain = [r for r in sorted_rows if _num(r.get("priceChangePercent")) > 0][:n]
    lose = sorted(
        [r for r in rows if _num(r.get("priceChangePercent")) < 0],
        key=lambda r: _num(r.get("priceChangePercent")),
    )[:n]
    return gain, lose


def broadcast_ibo_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Small set for WebSocket (majors + top Web3 by volume)."""
    majors = [r for r in rows if r.get("tier") == "major"]
    web3 = [r for r in rows if r.get("tier") != "major"]
    web3.sort(key=lambda r: -_num(r.get("quoteVolume")))
    cap = max(BROADCAST_LIMIT - len(majors), 0)
    return majors + web3[:cap]


def _filter_rows(
    rows: List[Dict[str, Any]],
    *,
    tier: str,
    q: Optional[str],
) -> List[Dict[str, Any]]:
    tier_f = (tier or "featured").strip().lower()
    needle = (q or "").strip().lower()
    out: List[Dict[str, Any]] = []
    for r in rows:
        if tier_f == "major" and r.get("tier") != "major":
            continue
        if tier_f == "web3" and r.get("tier") == "major":
            continue
        if tier_f == "featured":
            sym = (r.get("symbol") or "").upper()
            if sym not in IBO_QUOTED_SYMBOL_MAP and _num(r.get("quoteVolume")) <= 0:
                if r.get("stats_source") != "binance" and not r.get("is_listed") and r.get("source") != "listed":
                    continue
        if needle:
            hay = " ".join(
                filter(
                    None,
                    [r.get("symbol"), r.get("base"), r.get("token_name"), r.get("project_name")],
                )
            ).lower()
            if needle not in hay:
                continue
        out.append(r)
    if tier_f == "featured" and not needle:
        majors = [r for r in out if r.get("tier") == "major"]
        rest = [r for r in out if r.get("tier") != "major"]
        rest.sort(key=lambda r: -_num(r.get("quoteVolume")))
        return majors + rest[: max(0, DEFAULT_PAGE_LIMIT - len(majors))]
    return out


def paginate_ibo_markets(
    ibo_usdt_price: float,
    *,
    skip: int = 0,
    limit: int = DEFAULT_PAGE_LIMIT,
    q: Optional[str] = None,
    tier: str = "featured",
) -> Dict[str, Any]:
    """Paginated IBO markets for UI (no 500-row payloads)."""
    all_rows = get_cached_ibo_rows(ibo_usdt_price)
    filtered = _filter_rows(all_rows, tier=tier, q=q)
    skip_i = max(0, int(skip or 0))
    limit_i = max(1, min(MAX_PAGE_LIMIT, int(limit or DEFAULT_PAGE_LIMIT)))
    page = filtered[skip_i : skip_i + limit_i]
    summary = summarize_ibo_rows(all_rows)
    gainers, losers = top_gainers_losers(all_rows)
    return {
        "markets": page,
        "items": page,
        "total": len(filtered),
        "total_catalog": len(all_rows),
        "skip": skip_i,
        "limit": limit_i,
        "tier": tier,
        "summary": summary,
        "top_gainers": gainers,
        "top_losers": losers,
        "ibo_usdt_price": ibo_usdt_price,
    }
