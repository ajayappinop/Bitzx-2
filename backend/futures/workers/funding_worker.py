"""Funding worker.

Wakes up every :data:`FUNDING_INTERVAL_SEC` (default 8h) and settles
funding for every supported symbol. We anchor on UTC midnight to keep
the schedule predictable across restarts.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from ..constants import FUNDING_INTERVAL_SEC
from ..symbols import get_supported_symbols
from ..services import funding as funding_svc, mark_price as mark_price_svc

logger = logging.getLogger(__name__)

_task: Optional[asyncio.Task] = None
_stop = asyncio.Event()


def _seconds_until_next_settlement() -> float:
    now = datetime.now(timezone.utc)
    seconds_today = now.hour * 3600 + now.minute * 60 + now.second
    next_window = ((seconds_today // FUNDING_INTERVAL_SEC) + 1) * FUNDING_INTERVAL_SEC
    secs = next_window - seconds_today
    return max(5.0, float(secs))


async def _loop() -> None:
    while not _stop.is_set():
        wait = _seconds_until_next_settlement()
        try:
            await asyncio.wait_for(_stop.wait(), timeout=wait)
            return
        except asyncio.TimeoutError:
            pass
        for sym in get_supported_symbols().keys():
            snap = mark_price_svc.get_cached(sym)
            mp = float((snap or {}).get("mark_price") or 0.0)
            if mp <= 0:
                continue
            try:
                res = await funding_svc.settle_symbol(sym, mp)
                logger.info("funding %s rate=%s settled=%s", sym, res.get("rate"), res.get("settled"))
            except Exception as exc:  # noqa: BLE001
                logger.exception("funding settle failed for %s: %s", sym, exc)


def start() -> asyncio.Task:
    global _task
    if _task and not _task.done():
        return _task
    _stop.clear()
    _task = asyncio.create_task(_loop(), name="futures-funding")
    return _task


async def stop() -> None:
    _stop.set()
    if _task:
        try:
            await asyncio.wait_for(_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
