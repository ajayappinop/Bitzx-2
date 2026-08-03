"""Background tick: mark past-expiry listings as ``expired`` (no auto cash-settle)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from ..constants import COL_CONTRACTS
from ..db import db
from .settlement import parse_contract_expiry

logger = logging.getLogger(__name__)

_expiry_task: Optional[asyncio.Task] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def mark_expired_contracts() -> Dict[str, Any]:
    """Flip ``listed`` / ``halted`` rows past expiry to ``expired``; disables trading."""
    now = datetime.now(timezone.utc)
    updated = 0
    cur = (
        db()[COL_CONTRACTS]
        .find(
            {"settled_at": {"$exists": False}, "status": {"$in": ["listed", "halted"]}},
            {"_id": 0, "id": 1, "expiry": 1},
        )
        .limit(5000)
    )
    async for c in cur:
        try:
            exp = parse_contract_expiry(str(c.get("expiry") or ""))
        except Exception:  # noqa: BLE001
            continue
        if exp > now:
            continue
        cid = str(c.get("id") or "")
        if not cid:
            continue
        r = await db()[COL_CONTRACTS].update_one(
            {
                "id": cid,
                "status": {"$in": ["listed", "halted"]},
                "settled_at": {"$exists": False},
            },
            {
                "$set": {
                    "status": "expired",
                    "trading_enabled": False,
                    "updated_at": _now_iso(),
                }
            },
        )
        if r.modified_count:
            updated += 1
    if updated:
        logger.info("options expiry watch: marked %s contract(s) expired", updated)
    return {"marked_expired": updated}


async def _expiry_loop() -> None:
    await asyncio.sleep(15.0)
    while True:
        try:
            await mark_expired_contracts()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("options expiry tick failed")
        await asyncio.sleep(300.0)


async def start_expiry_watcher() -> None:
    global _expiry_task
    if _expiry_task is not None and not _expiry_task.done():
        return
    _expiry_task = asyncio.create_task(_expiry_loop(), name="options_expiry_watch")


async def stop_expiry_watcher() -> None:
    global _expiry_task
    if _expiry_task is None:
        return
    _expiry_task.cancel()
    try:
        await _expiry_task
    except asyncio.CancelledError:
        pass
    _expiry_task = None
