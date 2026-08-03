"""Aggregate resting limit depth per contract (v1 — periodic snapshots)."""

from __future__ import annotations

from typing import Any, Dict, List

from ..constants import COL_ORDERS
from ..db import db


async def depth_snapshot(contract_id: str, *, levels: int = 20) -> Dict[str, Any]:
    """Sum ``remaining`` by limit price for open / partially_filled orders."""
    lv = max(1, min(100, int(levels)))
    col = db()[COL_ORDERS]

    async def _levels(side: str, sort_dir: int) -> List[List[float]]:
        pipeline = [
            {
                "$match": {
                    "contract_id": contract_id,
                    "status": {"$in": ["open", "partially_filled"]},
                    "side": side,
                }
            },
            {"$group": {"_id": "$price", "qty": {"$sum": "$remaining"}}},
            {"$sort": {"_id": sort_dir}},
            {"$limit": lv},
        ]
        out: List[List[float]] = []
        async for row in col.aggregate(pipeline):
            p = float(row["_id"])
            q = float(row.get("qty") or 0.0)
            if q > 1e-12:
                out.append([round(p, 12), round(q, 8)])
        return out

    bids = await _levels("buy", -1)
    asks = await _levels("sell", 1)
    return {"contract_id": contract_id, "bids": bids, "asks": asks}


async def chain_best_quotes(contract_ids: list[str]) -> dict[str, dict[str, float]]:
    """Best bid (highest buy) and best ask (lowest sell) with size at touch, per contract.

    Used by :func:`chain` summaries — two aggregation passes over ``options_orders``.
    """
    ids = [str(x) for x in contract_ids if x]
    if not ids:
        return {}
    col = db()[COL_ORDERS]
    st = ["open", "partially_filled"]

    async def _touch(side: str, sort_px: int) -> dict[str, dict[str, float]]:
        pipeline: list[dict[str, Any]] = [
            {
                "$match": {
                    "contract_id": {"$in": ids},
                    "side": side,
                    "status": {"$in": st},
                    "remaining": {"$gt": 1e-12},
                }
            },
            {"$group": {"_id": {"c": "$contract_id", "p": "$price"}, "qty": {"$sum": "$remaining"}}},
            {"$project": {"cid": "$_id.c", "px": "$_id.p", "qty": 1}},
            {"$sort": {"cid": 1, "px": sort_px}},
            {"$group": {"_id": "$cid", "px": {"$first": "$px"}, "qty": {"$first": "$qty"}}},
        ]
        out: dict[str, dict[str, float]] = {}
        async for row in col.aggregate(pipeline):
            cid = str(row.get("_id") or "")
            if not cid:
                continue
            out[cid] = {"px": float(row.get("px") or 0.0), "qty": float(row.get("qty") or 0.0)}
        return out

    bids = await _touch("buy", -1)
    asks = await _touch("sell", 1)
    merged: dict[str, dict[str, float]] = {}
    for cid in set(bids) | set(asks):
        m: dict[str, float] = {}
        if cid in bids:
            m["best_bid"] = bids[cid]["px"]
            m["bid_qty"] = bids[cid]["qty"]
        if cid in asks:
            m["best_ask"] = asks[cid]["px"]
            m["ask_qty"] = asks[cid]["qty"]
        merged[cid] = m
    return merged
