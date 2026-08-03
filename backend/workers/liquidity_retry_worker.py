"""Phase 10 — liquidity retry worker.

Processes queued Binance-liquidity retry jobs with a simple callback hook.
The worker itself is framework-agnostic: queue selection + mutation lives in
server.py so we keep business rules in one place.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Awaitable, Callable, Optional

logger = logging.getLogger(__name__)


def _is_enabled() -> bool:
    raw = (os.getenv("LIQUIDITY_RETRY_WORKER_ENABLED") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _interval_sec() -> float:
    try:
        return max(1.0, float(os.getenv("LIQUIDITY_RETRY_WORKER_INTERVAL_SEC") or "3"))
    except (TypeError, ValueError):
        return 3.0


async def _run_loop(process_once: Callable[[], Awaitable[int]]) -> None:
    interval = _interval_sec()
    logger.info("liquidity_retry_worker: started (interval=%.1fs)", interval)
    while True:
        try:
            processed = await process_once()
            if processed <= 0:
                await asyncio.sleep(interval)
            else:
                # Keep draining quickly while queue is warm.
                await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("liquidity_retry_worker: loop error")
            await asyncio.sleep(interval)


def start(process_once: Callable[[], Awaitable[int]]) -> Optional[asyncio.Task]:
    if not _is_enabled():
        logger.info("liquidity_retry_worker: disabled (set LIQUIDITY_RETRY_WORKER_ENABLED=true)")
        return None
    return asyncio.create_task(_run_loop(process_once), name="ibo-liquidity-retry-worker")


async def stop(task: Optional[asyncio.Task]) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("liquidity_retry_worker: stop raised")
