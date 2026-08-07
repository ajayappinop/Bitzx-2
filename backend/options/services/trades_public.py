"""Public market trade tape for a contract (options_trades)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..constants import COL_TRADES
from ..db import db


async def list_recent_contract_trades(contract_id: str, *, limit: int = 40) -> List[Dict[str, Any]]:
    """Recent fills on ``contract_id`` (no user ids — public tape)."""
    lim = max(1, min(200, int(limit)))
    cur = (
        db()[COL_TRADES]
        .find(
            {"contract_id": contract_id},
            {
                "_id": 0,
                "id": 1,
                "contract_id": 1,
                "price": 1,
                "qty": 1,
                "side": 1,
                "created_at": 1,
                "taker_fee": 1,
                "maker_fee": 1,
            },
        )
        .sort("created_at", -1)
        .limit(lim)
    )
    return await cur.to_list(length=lim)


async def list_recent_trades(
    *,
    underlying_symbol: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Recent public fills across contracts (options analytics tape)."""
    lim = max(1, min(500, int(limit)))
    q: Dict[str, Any] = {}
    if underlying_symbol:
        base = str(underlying_symbol).upper().replace("USDT", "")
        q["contract_id"] = {"$regex": f"^optc_{base}_"}
    cur = (
        db()[COL_TRADES]
        .find(
            q,
            {
                "_id": 0,
                "id": 1,
                "contract_id": 1,
                "price": 1,
                "qty": 1,
                "side": 1,
                "created_at": 1,
            },
        )
        .sort("created_at", -1)
        .limit(lim)
    )
    return await cur.to_list(length=lim)


async def last_trade_by_contract_ids(contract_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Most recent fill per ``contract_id`` (for chain / watchlist summaries)."""
    ids = [str(x) for x in contract_ids if x]
    if not ids:
        return {}
    col = db()[COL_TRADES]
    pipeline = [
        {"$match": {"contract_id": {"$in": ids}}},
        {"$sort": {"created_at": -1}},
        {
            "$group": {
                "_id": "$contract_id",
                "last_price": {"$first": "$price"},
                "last_qty": {"$first": "$qty"},
                "last_side": {"$first": "$side"},
                "last_at": {"$first": "$created_at"},
            }
        },
    ]
    out: Dict[str, Dict[str, Any]] = {}
    async for row in col.aggregate(pipeline):
        cid = str(row.pop("_id", "") or "")
        if cid:
            out[cid] = row
    return out
