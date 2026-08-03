"""Aggregate metrics for the admin overview page.

Cheap server-side aggregations only — no per-user PnL replays. The
overview is meant to load in <100ms even with millions of trades.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from ..constants import (
    COL_LIQUIDATIONS,
    COL_ORDERS,
    COL_POSITIONS,
    COL_TRADES,
    COL_WALLETS,
    COL_WALLET_TXNS,
)
from ..symbols import get_supported_symbols
from ..db import db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def overview() -> Dict[str, Any]:
    d = db()

    # Open positions / open interest
    open_positions = 0
    long_oi = 0.0
    short_oi = 0.0
    total_margin_locked = 0.0
    per_symbol: Dict[str, Dict[str, float]] = {}

    cur = d[COL_POSITIONS].find(
        {"status": "open"},
        {"_id": 0, "symbol": 1, "qty": 1, "entry_price": 1, "mark_price": 1, "isolated_margin": 1, "leverage": 1},
    )
    async for p in cur:
        sym = p.get("symbol") or "?"
        qty = float(p.get("qty") or 0.0)
        mp = float(p.get("mark_price") or p.get("entry_price") or 0.0)
        notional = abs(qty) * mp
        long_oi  += notional if qty > 0 else 0.0
        short_oi += notional if qty < 0 else 0.0
        total_margin_locked += float(p.get("isolated_margin") or 0.0)
        open_positions += 1
        s = per_symbol.setdefault(sym, {"open_positions": 0, "open_interest": 0.0, "long_oi": 0.0, "short_oi": 0.0})
        s["open_positions"] += 1
        s["open_interest"] += notional
        s["long_oi"]  += notional if qty > 0 else 0.0
        s["short_oi"] += notional if qty < 0 else 0.0

    # Open orders
    open_orders = await d[COL_ORDERS].count_documents(
        {"status": {"$in": ["open", "partially_filled"]}}
    )

    # 24h volume + trade count
    cutoff = (_now() - timedelta(hours=24)).isoformat()
    pipe = [
        {"$match": {"created_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": "$symbol",
            "trades": {"$sum": 1},
            "volume": {"$sum": {"$multiply": ["$price", "$qty"]}},
        }},
    ]
    vol_total = 0.0
    trade_count = 0
    async for r in d[COL_TRADES].aggregate(pipe):
        sym = r.get("_id") or "?"
        v = float(r.get("volume") or 0.0)
        c = int(r.get("trades") or 0)
        vol_total += v
        trade_count += c
        s = per_symbol.setdefault(sym, {"open_positions": 0, "open_interest": 0.0, "long_oi": 0.0, "short_oi": 0.0})
        s["volume_24h"] = v
        s["trades_24h"] = c

    # Liquidations 24h
    liq_24h = await d[COL_LIQUIDATIONS].count_documents({"created_at": {"$gte": cutoff}})

    # Fees / funding 24h (sum over wallet ledger types)
    fee_pipe = [
        {"$match": {
            "type": {"$in": ["fee", "funding", "realized_pnl", "liquidation"]},
            "created_at": {"$gte": cutoff},
        }},
        {"$group": {"_id": "$type",
                    "credit": {"$sum": {"$cond": [{"$eq": ["$direction", "credit"]}, "$amount", 0]}},
                    "debit":  {"$sum": {"$cond": [{"$eq": ["$direction", "debit"]},  "$amount", 0]}}}},
    ]
    fees_paid = 0.0
    funding_paid = 0.0
    funding_received = 0.0
    realized_paid = 0.0
    realized_received = 0.0
    liq_burned = 0.0
    async for r in d[COL_WALLET_TXNS].aggregate(fee_pipe):
        t = r.get("_id")
        cr = float(r.get("credit") or 0.0)
        db_ = float(r.get("debit") or 0.0)
        if t == "fee":
            fees_paid = db_
        elif t == "funding":
            funding_paid = db_
            funding_received = cr
        elif t == "realized_pnl":
            realized_paid = db_
            realized_received = cr
        elif t == "liquidation":
            liq_burned = db_

    # Total wallet balance across users
    bal_pipe = [
        {"$group": {
            "_id": None,
            "available": {"$sum": "$available"},
            "locked":    {"$sum": "$locked"},
        }},
    ]
    bal_doc = None
    async for r in d[COL_WALLETS].aggregate(bal_pipe):
        bal_doc = r
        break
    avail = float((bal_doc or {}).get("available") or 0.0)
    locked = float((bal_doc or {}).get("locked") or 0.0)

    return {
        "open_positions": open_positions,
        "open_orders": open_orders,
        "long_oi": round(long_oi, 2),
        "short_oi": round(short_oi, 2),
        "total_oi": round(long_oi + short_oi, 2),
        "skew": round(long_oi - short_oi, 2),
        "total_margin_locked": round(total_margin_locked, 2),
        "wallet_total_available": round(avail, 2),
        "wallet_total_locked":    round(locked, 2),
        "trades_24h": trade_count,
        "volume_24h": round(vol_total, 2),
        "liquidations_24h": liq_24h,
        "fees_paid_24h": round(fees_paid, 4),
        "funding_paid_24h": round(funding_paid, 4),
        "funding_received_24h": round(funding_received, 4),
        "realized_pnl_paid_24h": round(realized_paid, 4),
        "realized_pnl_received_24h": round(realized_received, 4),
        "liquidation_burned_24h": round(liq_burned, 4),
        "per_symbol": per_symbol,
        "supported_symbols": list(get_supported_symbols().keys()),
    }
