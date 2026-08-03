"""CRUD for option underlyings (e.g. BTCUSDT)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..constants import COL_UNDERLYINGS
from ..db import db

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_symbol(sym: str) -> str:
    s = (sym or "").strip().upper()
    if not re.match(r"^[A-Z0-9]{2,20}USDT$", s):
        raise ValueError("underlying symbol must look like BASEUSDT")
    return s


async def create(doc: Dict[str, Any]) -> Dict[str, Any]:
    sym = _norm_symbol(doc["symbol"])
    if await db()[COL_UNDERLYINGS].find_one({"symbol": sym}, {"_id": 1}):
        raise ValueError(f"underlying {sym} already exists")
    oid = f"optu_{uuid.uuid4().hex[:16]}"
    row = {
        "id": oid,
        "symbol": sym,
        "display_name": doc.get("display_name") or sym.replace("USDT", ""),
        "listed": bool(doc.get("listed", True)),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db()[COL_UNDERLYINGS].insert_one(row)
    row.pop("_id", None)
    return row


async def list_all(*, listed_only: bool = False) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {}
    if listed_only:
        q["listed"] = True
    cur = db()[COL_UNDERLYINGS].find(q, {"_id": 0}).sort("symbol", 1)
    return await cur.to_list(length=500)


async def get_by_symbol(symbol: str) -> Optional[Dict[str, Any]]:
    return await db()[COL_UNDERLYINGS].find_one({"symbol": _norm_symbol(symbol)}, {"_id": 0})


async def get_by_id(uid: str) -> Optional[Dict[str, Any]]:
    return await db()[COL_UNDERLYINGS].find_one({"id": uid}, {"_id": 0})


async def patch_by_id(uid: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    updates = {k: v for k, v in updates.items() if v is not None}
    if not updates:
        row = await get_by_id(uid)
        if not row:
            raise KeyError(uid)
        return row
    updates["updated_at"] = _now_iso()
    await db()[COL_UNDERLYINGS].update_one({"id": uid}, {"$set": updates})
    row = await get_by_id(uid)
    if not row:
        raise KeyError(uid)
    return row
