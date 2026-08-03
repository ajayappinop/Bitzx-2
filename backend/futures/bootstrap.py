"""Server-startup hook for the futures module.

Idempotent: ``bootstrap_futures()`` can be called from ``server.py`` on
every boot. It will:

1. ensure all required Mongo indexes exist,
2. start the three background workers (mark price, liquidation, funding).

Stopping is handled by FastAPI's ``shutdown`` event hook.
"""

from __future__ import annotations

import logging

from .db import ensure_indexes
from .workers import funding_worker, liquidation_worker, mark_price_worker

logger = logging.getLogger(__name__)


async def bootstrap_futures() -> None:
    await ensure_indexes()
    mark_price_worker.start()
    liquidation_worker.start()
    funding_worker.start()
    logger.info("futures module booted")


async def shutdown_futures() -> None:
    await mark_price_worker.stop()
    await liquidation_worker.stop()
    await funding_worker.stop()
