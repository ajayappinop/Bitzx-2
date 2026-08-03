"""Optional background cash-settlement for ``expired`` contracts (env-gated).

Enable with ``OPTIONS_AUTO_SETTLE=true``. Uses the same :func:`settle_contract`
path as admin (Binance index unless override exists in product later).

Each tick processes at most a few contracts to limit load and Binance rate risk.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from ..constants import COL_CONTRACTS
from ..db import db
from . import settlement as settlement_svc

logger = logging.getLogger(__name__)

_settle_task: Optional[asyncio.Task] = None
_last_tick: Optional[Dict[str, Any]] = None


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_last_auto_settle_tick() -> Optional[Dict[str, Any]]:
    """Snapshot from the last :func:`auto_settle_due_contracts` run (for admin overview)."""
    return _last_tick


def _auto_settle_enabled() -> bool:
    return os.environ.get("OPTIONS_AUTO_SETTLE", "").lower() in ("1", "true", "yes")


def _interval_sec() -> float:
    try:
        v = float(os.environ.get("OPTIONS_AUTO_SETTLE_INTERVAL_SEC", "900"))
    except ValueError:
        v = 900.0
    return max(120.0, min(86400.0, v))


async def auto_settle_due_contracts() -> Dict[str, Any]:
    """Attempt live settlement for up to N ``expired`` contracts (not yet ``settled``)."""
    global _last_tick
    if not _auto_settle_enabled():
        return {"skipped": True, "reason": "OPTIONS_AUTO_SETTLE not enabled"}

    cur = (
        db()[COL_CONTRACTS]
        .find({"settled_at": {"$exists": False}, "status": "expired"}, {"_id": 0, "id": 1})
        .limit(5)
    )
    rows = await cur.to_list(length=5)
    results: list[Dict[str, Any]] = []
    for row in rows:
        cid = str(row.get("id") or "")
        if not cid:
            continue
        try:
            r = await settlement_svc.settle_contract(cid, dry_run=False, force=False)
            results.append(
                {
                    "contract_id": cid,
                    "ok": bool(r.get("ok")),
                    "settled_at": r.get("settled_at"),
                    "idempotent": bool(r.get("idempotent")),
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("options auto-settle failed for %s: %s", cid, exc)
            results.append({"contract_id": cid, "ok": False, "error": str(exc)[:240]})

    ok_n = sum(1 for r in results if r.get("ok"))
    fail_n = len(results) - ok_n
    out: Dict[str, Any] = {
        "processed": len(results),
        "ok": ok_n,
        "failed": fail_n,
        "results": results,
        "at": _utc_iso(),
    }
    _last_tick = out
    if results:
        logger.info(
            "options auto-settle tick: touched=%s ok=%s failed=%s",
            len(results),
            ok_n,
            fail_n,
        )
    return out


async def _settle_loop() -> None:
    await asyncio.sleep(60.0)
    while True:
        try:
            await auto_settle_due_contracts()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("options auto-settle tick failed")
        await asyncio.sleep(_interval_sec())


async def start_settlement_watcher() -> None:
    global _settle_task
    if not _auto_settle_enabled():
        logger.info("options auto-settle watcher disabled (set OPTIONS_AUTO_SETTLE=true to enable)")
        return
    if _settle_task is not None and not _settle_task.done():
        return
    _settle_task = asyncio.create_task(_settle_loop(), name="options_auto_settle")
    logger.info("options auto-settle watcher started (interval=%ss)", _interval_sec())


async def stop_settlement_watcher() -> None:
    global _settle_task
    if _settle_task is None:
        return
    _settle_task.cancel()
    try:
        await _settle_task
    except asyncio.CancelledError:
        pass
    _settle_task = None
