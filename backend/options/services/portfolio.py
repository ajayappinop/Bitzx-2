"""Portfolio metrics: PNL, margin, liquidation estimates."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..constants import COL_TRADES, MARGIN_ASSET
from ..db import db
from ..providers.registry import get_index_price
from . import contracts as contracts_svc
from . import greeks as greeks_svc
from . import positions as pos_svc
from . import ticker as ticker_svc
from . import wallet as wallet_svc
from .settlement import parse_contract_expiry

logger = logging.getLogger(__name__)


async def snapshot(uid: str) -> Dict[str, Any]:
    wallet, positions, realized, today_pnl = await asyncio.gather(
        wallet_svc.snapshot(uid),
        pos_svc.list_open(uid),
        _realized_pnl(uid),
        _today_pnl(uid),
    )
    margin_available = float(wallet.get("available") or wallet.get("balance") or 0.0)
    margin_used = float(wallet.get("locked") or 0.0)

    enriched: List[Dict[str, Any]] = []
    unrealized = 0.0
    total_oi = 0.0
    now_dt = datetime.now(timezone.utc)

    cids = [str(p.get("contract_id") or "") for p in positions if p.get("contract_id")]
    contract_map = await contracts_svc.get_many(cids)
    unique_underlyings = {
        str(c.get("underlying_symbol") or "")
        for c in contract_map.values()
        if c.get("underlying_symbol")
    }
    index_pairs = await asyncio.gather(
        *[get_index_price(u) for u in unique_underlyings],
        return_exceptions=True,
    )
    index_by_underlying = {
        u: (px if not isinstance(px, Exception) else None)
        for u, px in zip(unique_underlyings, index_pairs)
    }

    tickers = await asyncio.gather(
        *[ticker_svc.get_ticker(cid, use_cache=True) for cid in cids if cid in contract_map],
        return_exceptions=True,
    )
    tick_by_cid = {
        cid: tick
        for cid, tick in zip([c for c in cids if c in contract_map], tickers)
        if not isinstance(tick, Exception) and tick
    }

    for pos in positions:
        cid = str(pos.get("contract_id") or "")
        contract = contract_map.get(cid)
        if not contract:
            continue
        tick = tick_by_cid.get(cid) or {}
        mark = float(tick.get("mark_price") or tick.get("last_price") or 0.0)
        avg = float(pos.get("avg_premium") or 0.0)
        qty = float(pos.get("qty") or 0.0)
        upnl = (mark - avg) * qty if mark > 0 else 0.0
        unrealized += upnl
        total_oi += qty
        usym = str(contract.get("underlying_symbol") or "")
        index_px = index_by_underlying.get(usym)
        exp_dt = parse_contract_expiry(str(contract.get("expiry") or ""))
        T = max(0.0, (exp_dt - now_dt).total_seconds() / (365.25 * 24 * 3600))
        g = greeks_svc.compute_greeks(
            S=float(index_px or mark or 0),
            K=float(contract.get("strike") or 0),
            T=T,
            option_type=str(contract.get("option_type") or "call"),
            mid_price=mark if mark > 0 else None,
        )
        liq = _estimate_liquidation(mark, avg, qty, margin_available + margin_used)
        enriched.append(
            {
                **pos,
                "contract": contract,
                "mark_price": mark,
                "unrealized_pnl": round(upnl, 8),
                "margin_used": round(avg * qty, 8),
                "liquidation_price": liq,
                "iv": g.get("iv"),
                "delta": g.get("delta"),
                "gamma": g.get("gamma"),
                "theta": g.get("theta"),
                "vega": g.get("vega"),
                "rho": g.get("rho"),
            }
        )

    total_pnl = realized + unrealized
    portfolio_value = margin_available + margin_used + unrealized

    return {
        "uid": uid,
        "asset": MARGIN_ASSET,
        "wallet": wallet,
        "positions": enriched,
        "portfolio_value": round(portfolio_value, 8),
        "total_pnl": round(total_pnl, 8),
        "realized_pnl": round(realized, 8),
        "unrealized_pnl": round(unrealized, 8),
        "margin_used": round(margin_used, 8),
        "margin_available": round(margin_available, 8),
        "open_interest": round(total_oi, 8),
        "today_pnl": round(today_pnl, 8),
        "updated_at": now_dt.isoformat(),
    }


def _estimate_liquidation(mark: float, avg: float, qty: float, equity: float) -> Optional[float]:
    """Long-only v1: liquidation when mark drops enough to wipe equity allocated to position."""
    if qty <= 0 or mark <= 0:
        return None
    premium_at_risk = avg * qty
    if premium_at_risk <= 0:
        return None
    cushion = max(0.0, equity)
    drop_per_contract = cushion / qty if qty > 0 else 0.0
    liq = max(0.0, avg - drop_per_contract)
    return round(liq, 8)


async def _realized_pnl(uid: str) -> float:
    pipeline = [
        {"$match": {"$or": [{"taker_uid": uid}, {"maker_uid": uid}]}},
        {
            "$group": {
                "_id": None,
                "premium": {
                    "$sum": {
                        "$multiply": [
                            "$price",
                            "$qty",
                            {"$cond": [{"$eq": ["$taker_uid", uid]}, 1, -1]},
                        ]
                    }
                },
            }
        },
    ]
    total = 0.0
    async for row in db()[COL_TRADES].aggregate(pipeline):
        total = float(row.get("premium") or 0.0)
    return total


async def _today_pnl(uid: str) -> float:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    cur = db()[COL_TRADES].find(
        {
            "$or": [{"taker_uid": uid}, {"maker_uid": uid}],
            "created_at": {"$gte": start},
        },
        {"_id": 0, "price": 1, "qty": 1, "taker_uid": 1},
    )
    pnl = 0.0
    async for t in cur:
        sign = 1.0 if t.get("taker_uid") == uid else -1.0
        pnl += sign * float(t.get("price") or 0) * float(t.get("qty") or 0)
    return pnl
