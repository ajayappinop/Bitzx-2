"""Mark price worker.

Loop:
  every MARK_PRICE_INTERVAL_SEC:
    for each supported symbol:
      refresh mark price (binance index + local mid blend)
      sample funding premium
      mark every open position to market

Cheap and idempotent — safe to run as multiple replicas (each caches
locally; no shared state). The DB writes are insert-only (mark history)
or trivially idempotent (per-position field updates).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from ..constants import MARK_PRICE_INTERVAL_SEC
from ..symbols import get_supported_symbols
from ..services import (
    funding as funding_svc,
    mark_price as mark_price_svc,
    position as position_svc,
)

logger = logging.getLogger(__name__)

_task: Optional[asyncio.Task] = None
_stop = asyncio.Event()


async def _loop() -> None:
    while not _stop.is_set():
        try:
            for sym in get_supported_symbols().keys():
                snap = await mark_price_svc.refresh(sym)
                if snap and snap.get("mark_price"):
                    funding_svc.record_premium(
                        sym,
                        snap.get("mark_price"),
                        snap.get("index_price") or snap.get("mark_price"),
                    )
                    await position_svc.mark_to_market(sym, float(snap["mark_price"]))
        except Exception as exc:  # noqa: BLE001
            logger.warning("mark price tick failed: %s", exc)
        try:
            await asyncio.wait_for(_stop.wait(), timeout=MARK_PRICE_INTERVAL_SEC)
        except asyncio.TimeoutError:
            pass


def start() -> asyncio.Task:
    global _task
    if _task and not _task.done():
        return _task
    _stop.clear()
    _task = asyncio.create_task(_loop(), name="futures-mark-price")
    return _task


async def stop() -> None:
    _stop.set()
    if _task:
        try:
            await asyncio.wait_for(_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
