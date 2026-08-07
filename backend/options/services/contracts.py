"""Option contracts (per strike / expiry / call|put)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..constants import COL_CONTRACTS, CONTRACT_STATUSES, OPTION_TYPES
from ..db import db
from . import underlyings as und_svc

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _contract_id(underlying: str, expiry_iso: str, strike: float, opt: str) -> str:
    base = underlying.replace("USDT", "")
    day = expiry_iso[:10].replace("-", "")
    strike_s = str(int(strike)) if float(strike).is_integer() else str(strike).replace(".", "p")
    letter = "MV" if opt.lower() == "move" else opt[0].upper()
    return f"optc_{base}_{day}_{strike_s}_{letter}"


async def create(body: Dict[str, Any]) -> Dict[str, Any]:
    usym = und_svc._norm_symbol(body["underlying_symbol"])
    u = await und_svc.get_by_symbol(usym)
    if not u:
        raise ValueError(f"underlying {usym} not found — create it first")
    opt = body["option_type"].lower()
    if opt not in OPTION_TYPES:
        raise ValueError("option_type must be call, put, or move")
    expiry = body["expiry"].strip()
    strike = float(body["strike"])
    cid = _contract_id(usym, expiry, strike, opt)
    if await db()[COL_CONTRACTS].find_one({"id": cid}, {"_id": 1}):
        raise ValueError(f"contract {cid} already exists")
    row = {
        "id": cid,
        "underlying_id": u["id"],
        "underlying_symbol": usym,
        "expiry": expiry,
        "strike": strike,
        "option_type": opt,
        "product": "move" if opt == "move" else "vanilla",
        "tick_size": float(body.get("tick_size") or 0.01),
        "lot_size": float(body.get("lot_size") or 1.0),
        "min_qty": float(body.get("min_qty") or 1.0),
        "max_qty": float(body.get("max_qty") or 1_000_000.0),
        "listed": bool(body.get("listed", True)),
        "trading_enabled": bool(body.get("trading_enabled", True)),
        "status": "listed" if body.get("listed", True) else "draft",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db()[COL_CONTRACTS].insert_one(row)
    row.pop("_id", None)
    return row


async def get(contract_id: str) -> Optional[Dict[str, Any]]:
    return await db()[COL_CONTRACTS].find_one({"id": contract_id}, {"_id": 0})


async def get_many(contract_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    ids = [str(i).strip() for i in contract_ids if i]
    if not ids:
        return {}
    cur = db()[COL_CONTRACTS].find({"id": {"$in": ids}}, {"_id": 0})
    rows = await cur.to_list(length=len(ids))
    return {str(r["id"]): r for r in rows if r.get("id")}


async def list_contracts(
    *,
    underlying_symbol: Optional[str] = None,
    listed_only: bool = True,
    option_type: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {}
    if underlying_symbol:
        q["underlying_symbol"] = und_svc._norm_symbol(underlying_symbol)
    if option_type:
        ot = option_type.lower().strip()
        if ot in OPTION_TYPES:
            q["option_type"] = ot
        elif ot == "vanilla":
            q["option_type"] = {"$in": ["call", "put"]}
    if listed_only:
        q["listed"] = True
        q["trading_enabled"] = True
        q["status"] = "listed"
    cur = db()[COL_CONTRACTS].find(q, {"_id": 0}).sort([("expiry", 1), ("strike", 1)]).limit(int(limit))
    return await cur.to_list(length=int(limit))


async def patch(contract_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {"tick_size", "lot_size", "min_qty", "max_qty", "listed", "trading_enabled", "status"}
    coerced = {k: v for k, v in updates.items() if k in allowed and v is not None}
    if "status" in coerced and coerced["status"] not in CONTRACT_STATUSES:
        raise ValueError("invalid status")
    if not coerced:
        c = await get(contract_id)
        if not c:
            raise KeyError(contract_id)
        return c
    coerced["updated_at"] = _now_iso()
    await db()[COL_CONTRACTS].update_one({"id": contract_id}, {"$set": coerced})
    c = await get(contract_id)
    if not c:
        raise KeyError(contract_id)
    return c


async def is_tradable(contract_id: str) -> bool:
    c = await get(contract_id)
    if not c:
        return False
    if c.get("status") in ("settled", "settling"):
        return False
    if c.get("settled_at"):
        return False
    return bool(c.get("listed")) and bool(c.get("trading_enabled")) and c.get("status") == "listed"
