"""Per-contract ticker snapshots."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from ..cache import redis_cache
from ..providers.registry import get_index_price, get_local_provider
from . import greeks as greeks_svc
from .market_data import _contract_greeks
from .settlement import parse_contract_expiry

logger = logging.getLogger(__name__)


async def get_ticker(contract_id: str, *, use_cache: bool = True) -> Optional[Dict[str, Any]]:
    key = redis_cache.cache_key("ticker", contract_id)
    if use_cache:
        cached = await redis_cache.get(key)
        if cached is not None:
            return cached

    local = get_local_provider()
    contract = await local.get_contract(contract_id)
    if not contract:
        return None

    usym = str(contract.get("underlying_symbol") or "")
    index_px, quotes, lasts, oi_map = await asyncio.gather(
        get_index_price(usym),
        local.get_best_quotes([contract_id]),
        local.get_last_trades_map([contract_id]),
        local.get_open_interest([contract_id]),
    )

    q = quotes.get(contract_id, {})
    lt = lasts.get(contract_id, {})
    bb, ba = q.get("best_bid"), q.get("best_ask")
    mid = None
    if bb is not None and ba is not None:
        bb_f, ba_f = float(bb), float(ba)
        if ba_f > bb_f:
            mid = (bb_f + ba_f) / 2.0

    last_price = lt.get("last_price")
    mark_price = mid if mid is not None else last_price
    now_dt = datetime.now(timezone.utc)
    greeks = _contract_greeks(contract, index_px, mark_price, now_dt)

    payload: Dict[str, Any] = {
        "contract_id": contract_id,
        "underlying_symbol": usym,
        "last_price": last_price,
        "mark_price": mark_price,
        "index_price": index_px,
        "best_bid": bb,
        "best_ask": ba,
        "bid_qty": q.get("bid_qty"),
        "ask_qty": q.get("ask_qty"),
        "volume_24h": None,
        "change_24h_pct": None,
        "open_interest": oi_map.get(contract_id),
        "updated_at": now_dt.isoformat(),
        **greeks,
    }
    if payload.get("best_bid") is None or payload.get("mark_price") is None:
        from . import binance_reference as binance_ref

        ref_row = {"id": contract_id, **contract}
        await binance_ref.enrich_chain_rows([ref_row], underlying_symbol=usym, index_px=index_px)
        mkt = ref_row.get("market") or {}
        for k in (
            "best_bid", "best_ask", "mark_price", "mid", "iv", "delta", "gamma",
            "theta", "vega", "rho", "open_interest", "last_price", "volume_24h",
        ):
            if mkt.get(k) is not None and payload.get(k) is None:
                payload[k] = mkt[k]
    await redis_cache.set(key, payload, key_type="ticker")
    return payload
