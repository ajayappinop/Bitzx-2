"""Option positions — long vanilla; MOVE supports long and short (straddle)."""

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
    """Buy fill: cover short first, otherwise open/add long."""
    qty = abs(qty)
    if qty <= 0:
        return
    pos = await get_position(uid, contract_id, session=session)
    if pos is not None and str(pos.get("side") or "long").lower() == "short":
        short_q = float(pos.get("qty") or 0)
        cover_q = min(short_q, qty)
        await _reduce_position(pos, cover_q, session=session)
        rem = qty - cover_q
        if rem > 1e-12:
            await apply_buy_open(uid, contract_id, rem, fill_premium, session=session)
        return

    if pos is None:
        doc = {
            "id": f"optp_{uuid.uuid4().hex[:16]}",
            "uid": uid,
            "contract_id": contract_id,
            "side": "long",
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
        {
            "$set": {
                "side": "long",
                "qty": _round(new_q),
                "avg_premium": _round(new_a),
                "updated_at": _now_iso(),
            }
        },
        session=session,
    )


async def apply_sell_close(uid: str, contract_id: str, qty: float, *, session: Any = None) -> None:
    """Reduce-only close of a long (legacy name kept for matching)."""
    qty = abs(qty)
    pos = await get_position(uid, contract_id, session=session)
    if not pos:
        raise ValueError("no position to close")
    if str(pos.get("side") or "long").lower() != "long":
        raise ValueError("reduce_only sell requires a long position")
    await _reduce_position(pos, qty, session=session)


async def apply_sell_fill(
    uid: str,
    contract_id: str,
    qty: float,
    fill_premium: float,
    *,
    allow_short_open: bool = False,
    session: Any = None,
) -> None:
    """Sell fill: close long first; optionally open/add short (MOVE)."""
    qty = abs(qty)
    if qty <= 0:
        return
    pos = await get_position(uid, contract_id, session=session)
    if pos is not None and str(pos.get("side") or "long").lower() == "long":
        long_q = float(pos.get("qty") or 0)
        close_q = min(long_q, qty)
        await _reduce_position(pos, close_q, session=session)
        rem = qty - close_q
        if rem > 1e-12:
            if not allow_short_open:
                raise ValueError("insufficient long position for reduce_only sell")
            await apply_sell_fill(
                uid, contract_id, rem, fill_premium, allow_short_open=True, session=session
            )
        return

    if not allow_short_open:
        raise ValueError("insufficient long position for reduce_only sell")

    if pos is None:
        doc = {
            "id": f"optp_{uuid.uuid4().hex[:16]}",
            "uid": uid,
            "contract_id": contract_id,
            "side": "short",
            "qty": _round(qty),
            "avg_premium": _round(fill_premium),
            "status": "open",
            "opened_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        await db()[COL_POSITIONS].insert_one(doc, session=session)
        return

    # Existing short — add
    old_q = float(pos.get("qty") or 0.0)
    old_a = float(pos.get("avg_premium") or 0.0)
    new_q = old_q + qty
    new_a = ((old_q * old_a) + (qty * fill_premium)) / new_q if new_q > 0 else fill_premium
    await db()[COL_POSITIONS].update_one(
        {"id": pos["id"]},
        {
            "$set": {
                "side": "short",
                "qty": _round(new_q),
                "avg_premium": _round(new_a),
                "updated_at": _now_iso(),
            }
        },
        session=session,
    )


async def _reduce_position(pos: Dict[str, Any], qty: float, *, session: Any = None) -> None:
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
    """Total absolute contracts outstanding per ``contract_id`` for open positions."""
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
