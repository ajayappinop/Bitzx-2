"""Unified market-data service — composes local exchange + external providers."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from ..cache import redis_cache
from ..providers.registry import get_external_provider, get_index_price, get_local_provider
from ..schemas.documents import enrich_contract_row
from . import binance_reference as binance_ref
from . import greeks as greeks_svc
from .settlement import parse_contract_expiry

logger = logging.getLogger(__name__)


async def list_contracts(
    *,
    underlying_symbol: Optional[str] = None,
    listed_only: bool = True,
    option_type: Optional[str] = None,
    limit: int = 200,
    use_cache: bool = True,
) -> List[Dict[str, Any]]:
    key = redis_cache.cache_key(
        "contracts",
        underlying_symbol or "all",
        str(listed_only),
        option_type or "all",
        str(limit),
    )
    if use_cache:
        cached = await redis_cache.get(key)
        if cached is not None:
            return cached
    local = get_local_provider()
    rows = await local.list_contracts(
        underlying_symbol=underlying_symbol,
        listed_only=listed_only,
        option_type=option_type,
        limit=limit,
    )
    out = [enrich_contract_row(r) for r in rows]
    await redis_cache.set(key, out, key_type="contracts")
    return out


async def get_chain(
    underlying_symbol: str,
    *,
    listed_only: bool = True,
    include_market: bool = True,
    use_cache: bool = True,
) -> Dict[str, Any]:
    sym = underlying_symbol.strip().upper()
    key = redis_cache.cache_key("chain", "vanilla", sym, str(listed_only), str(include_market))
    if use_cache:
        cached = await redis_cache.get(key)
        if cached is not None:
            return cached
    # Vanilla chain only — MOVE (straddle) lives on /move, never on Options.
    rows = await list_contracts(
        underlying_symbol=sym,
        listed_only=listed_only,
        option_type="vanilla",
        limit=500,
        use_cache=True,
    )
    rows = [r for r in rows if str(r.get("option_type") or "").lower() not in ("move",)]
    index_px = await get_index_price(sym)
    now_dt = datetime.now(timezone.utc)
    if include_market and rows:
        local = get_local_provider()
        ids = [str(r["id"]) for r in rows if r.get("id")]
        quotes, lasts, oi_map = await asyncio.gather(
            local.get_best_quotes(ids),
            local.get_last_trades_map(ids),
            local.get_open_interest(ids),
        )
        for r in rows:
            cid = str(r.get("id") or "")
            if not cid:
                continue
            q = quotes.get(cid, {})
            lt = lasts.get(cid, {})
            bb, ba = q.get("best_bid"), q.get("best_ask")
            mid = spread = None
            if bb is not None and ba is not None:
                bb_f, ba_f = float(bb), float(ba)
                if ba_f > bb_f:
                    mid = (bb_f + ba_f) / 2.0
                    spread = ba_f - bb_f
            greeks = _contract_greeks(r, index_px, mid, now_dt)
            r["market"] = {
                "best_bid": bb,
                "bid_qty": q.get("bid_qty"),
                "best_ask": ba,
                "ask_qty": q.get("ask_qty"),
                "mid": mid,
                "mark_price": mid,
                "spread": spread,
                "last_price": lt.get("last_price"),
                "last_qty": lt.get("last_qty"),
                "last_side": lt.get("last_side"),
                "last_at": lt.get("last_at"),
                "open_interest": oi_map.get(cid),
                **greeks,
            }
        # Instant synthetic quotes so chain UI is usable before Binance REST returns.
        if index_px:
            for r in rows:
                syn = binance_ref._synthetic_quote(r, float(index_px), now_dt)
                if syn:
                    binance_ref._apply_market_to_row(r, syn, index_px=index_px, now_dt=now_dt)
        binance_timeout = float(os.getenv("OPTIONS_CHAIN_BINANCE_TIMEOUT_SEC", "5"))
        try:
            await asyncio.wait_for(
                binance_ref.enrich_chain_rows(rows, underlying_symbol=sym, index_px=index_px),
                timeout=binance_timeout,
            )
        except asyncio.TimeoutError:
            logger.debug("options chain binance enrich timed out for %s", sym)
        except Exception:  # noqa: BLE001
            logger.exception("options chain binance enrich failed for %s", sym)
    elif include_market and rows and index_px:
        for r in rows:
            syn = binance_ref._synthetic_quote(r, float(index_px), now_dt)
            if syn:
                binance_ref._apply_market_to_row(r, syn, index_px=index_px, now_dt=now_dt)
        try:
            await asyncio.wait_for(
                binance_ref.enrich_chain_rows(rows, underlying_symbol=sym, index_px=index_px),
                timeout=float(os.getenv("OPTIONS_CHAIN_BINANCE_TIMEOUT_SEC", "5")),
            )
        except asyncio.TimeoutError:
            logger.debug("options chain binance enrich timed out for %s", sym)
        except Exception:  # noqa: BLE001
            logger.exception("options chain binance enrich failed for %s", sym)
    payload = {"underlying_symbol": sym, "index_price": index_px, "contracts": rows}
    await redis_cache.set(key, payload, key_type="chain")
    return payload


def _contract_greeks(contract: dict, index_px, mid, now_dt: datetime) -> dict:
    if index_px is None or mid is None:
        return {}
    try:
        exp_dt = parse_contract_expiry(str(contract.get("expiry") or ""))
        T = max(0.0, (exp_dt - now_dt).total_seconds() / (365.25 * 24 * 3600))
        return greeks_svc.compute_greeks(
            S=float(index_px),
            K=float(contract.get("strike") or 0),
            T=T,
            option_type=str(contract.get("option_type") or "").lower(),
            mid_price=float(mid),
        )
    except Exception:
        return {}


async def get_orderbook(contract_id: str, *, depth: int = 25, use_cache: bool = True) -> Dict[str, Any]:
    key = redis_cache.cache_key("ob", contract_id, str(depth))
    if use_cache:
        cached = await redis_cache.get(key)
        if cached is not None:
            return cached
    local = get_local_provider()
    snap = await local.get_orderbook(contract_id, depth=depth)
    snap["contract_id"] = contract_id
    if not (snap.get("bids") or snap.get("asks")):
        ref = await binance_ref.reference_orderbook(contract_id, depth=depth)
        if ref:
            snap = ref
    await redis_cache.set(key, snap, key_type="orderbook")
    return snap


async def get_trades(contract_id: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    local = get_local_provider()
    rows = await local.get_trades(contract_id, limit=limit)
    if rows:
        return rows
    return await binance_ref.reference_trades(contract_id, limit=limit)
