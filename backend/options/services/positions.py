"""Long option positions (v1: long-only opens; sells are reduce-only)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..constants import COL_POSITIONS
from ..db import db

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


async def get_position(uid: str, contract_id: str, session: Any = None) -> Optional[Dict[str, Any]]:
    """Return the **open** position row, if any."""
    return await db()[COL_POSITIONS].find_one(
        {"uid": uid, "contract_id": contract_id, "status": "open"},
        {"_id": 0},
        session=session,
    )


async def _row_any_status(uid: str, contract_id: str) -> Optional[Dict[str, Any]]:
    return await db()[COL_POSITIONS].find_one({"uid": uid, "contract_id": contract_id}, {"_id": 0})


async def list_open(uid: str) -> List[Dict[str, Any]]:
    cur = db()[COL_POSITIONS].find({"uid": uid, "status": "open"}, {"_id": 0}).sort("updated_at", -1)
    return await cur.to_list(length=200)


async def apply_buy_open(
    uid: str,
    contract_id: str,
    qty: float,
    fill_premium: float,
    *,
    session: Any = None,
) -> None:
    qty = abs(qty)
    if qty <= 0:
        return
    pos = await get_position(uid, contract_id, session=session)
    if pos is None:
        doc = {
            "id": f"optp_{uuid.uuid4().hex[:16]}",
            "uid": uid,
            "contract_id": contract_id,
            "qty": _round(qty),
            "avg_premium": _round(fill_premium),
            "status": "open",
            "opened_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        await db()[COL_POSITIONS].insert_one(doc, session=session)
        return
    old_q = float(pos.get("qty") or 0.0)
    old_a = float(pos.get("avg_premium") or 0.0)
    new_q = old_q + qty
    new_a = ((old_q * old_a) + (qty * fill_premium)) / new_q if new_q > 0 else fill_premium
    await db()[COL_POSITIONS].update_one(
        {"id": pos["id"]},
        {"$set": {"qty": _round(new_q), "avg_premium": _round(new_a), "updated_at": _now_iso()}},
        session=session,
    )


async def apply_sell_close(uid: str, contract_id: str, qty: float, *, session: Any = None) -> None:
    qty = abs(qty)
    pos = await get_position(uid, contract_id, session=session)
    if not pos:
        raise ValueError("no position to close")
    old_q = float(pos.get("qty") or 0.0)
    if old_q + 1e-12 < qty:
        raise ValueError("insufficient position size")
    new_q = old_q - qty
    if new_q <= 1e-12:
        await db()[COL_POSITIONS].update_one(
            {"id": pos["id"]},
            {"$set": {"qty": 0.0, "status": "closed", "closed_at": _now_iso(), "updated_at": _now_iso()}},
            session=session,
        )
    else:
        await db()[COL_POSITIONS].update_one(
            {"id": pos["id"]},
            {"$set": {"qty": _round(new_q), "updated_at": _now_iso()}},
            session=session,
        )


async def open_interest_by_contract(contract_ids: List[str]) -> Dict[str, float]:
    """Total long contracts outstanding (``qty`` sum) per ``contract_id`` for open positions."""
    ids = [str(x) for x in contract_ids if x]
    if not ids:
        return {}
    pipeline = [
        {
            "$match": {
                "contract_id": {"$in": ids},
                "status": "open",
                "qty": {"$gt": 1e-12},
            }
        },
        {"$group": {"_id": "$contract_id", "open_interest": {"$sum": "$qty"}}},
    ]
    out: Dict[str, float] = {}
    async for row in db()[COL_POSITIONS].aggregate(pipeline):
        cid = str(row.get("_id") or "")
        if cid:
            out[cid] = float(row.get("open_interest") or 0.0)
    return out
