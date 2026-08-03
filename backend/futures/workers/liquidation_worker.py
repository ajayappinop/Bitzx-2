"""Liquidation worker.

Scans every supported symbol every :data:`LIQUIDATION_SCAN_INTERVAL_SEC`
seconds. Uses the cached mark price from :mod:`mark_price` so it's
cheap and self-throttling — if the mark feed stalls (no recent snapshot),
the worker simply skips that symbol until the next price arrives.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from ..constants import LIQUIDATION_SCAN_INTERVAL_SEC
from ..symbols import get_supported_symbols
from ..services import liquidation as liq_svc, mark_price as mark_price_svc

logger = logging.getLogger(__name__)

_task: Optional[asyncio.Task] = None
_stop = asyncio.Event()


async def _loop() -> None:
    while not _stop.is_set():
        for sym in get_supported_symbols().keys():
            snap = mark_price_svc.get_cached(sym)
            if not snap or not snap.get("mark_price"):
                continue
            try:
                await liq_svc.scan_symbol(sym, float(snap["mark_price"]))
            except Exception as exc:  # noqa: BLE001
                logger.exception("liquidation scan %s failed: %s", sym, exc)
        try:
            await asyncio.wait_for(_stop.wait(), timeout=LIQUIDATION_SCAN_INTERVAL_SEC)
        except asyncio.TimeoutError:
            pass


def start() -> asyncio.Task:
    global _task
    if _task and not _task.done():
        return _task
    _stop.clear()
    _task = asyncio.create_task(_loop(), name="futures-liquidation")
    return _task


async def stop() -> None:
    _stop.set()
    if _task:
        try:
            await asyncio.wait_for(_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
