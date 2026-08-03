"""Startup hook for options (indexes + light background workers)."""

from __future__ import annotations

import asyncio
import logging

from services.db import supports_transactions

from .db import ensure_indexes
from .services.expiry_watch import start_expiry_watcher, stop_expiry_watcher
from .services.settlement_watch import start_settlement_watcher, stop_settlement_watcher

logger = logging.getLogger(__name__)


async def bootstrap_options() -> None:
    await ensure_indexes()
    try:
        from .cache import redis_cache

        redis_cache._redis()  # warm provider selection
    except Exception:  # noqa: BLE001
        pass
    if not supports_transactions():
        logger.warning(
            "MongoDB multi-document transactions are unavailable; options fills are best-effort without a "
            "replica set. Use a replica set for atomic matching + ledger updates."
        )
    try:
        from .demo_data import seed_demo_options_if_needed

        async def _demo_seed_background() -> None:
            try:
                await seed_demo_options_if_needed()
            except Exception:  # noqa: BLE001
                logger.exception("options demo seed failed")

        asyncio.create_task(_demo_seed_background(), name="options-demo-seed")
    except Exception:  # noqa: BLE001
        logger.exception("options demo seed task failed to schedule")
    try:
        await start_expiry_watcher()
    except Exception:  # noqa: BLE001
        logger.exception("options expiry watcher failed to start")
    try:
        await start_settlement_watcher()
    except Exception:  # noqa: BLE001
        logger.exception("options auto-settle watcher failed to start")
    try:
        from .services import system_liquidity

        await system_liquidity.ensure_system_wallet()
    except Exception:  # noqa: BLE001
        logger.exception("options SYSTEM wallet bootstrap failed")
    try:
        from .services.binance_sync import DEFAULT_UNDERLYINGS, ensure_underlyings_listed

        await ensure_underlyings_listed(DEFAULT_UNDERLYINGS)
    except Exception:  # noqa: BLE001
        logger.exception("options underlying bootstrap failed")
    try:
        from .services import binance_sync

        async def _binance_sync_background() -> None:
            try:
                result = await binance_sync.sync_all_configured()
                logger.info("options binance contract sync: %s", result)
            except Exception:  # noqa: BLE001
                logger.exception("options binance contract sync failed")

        asyncio.create_task(_binance_sync_background(), name="options-binance-sync")
    except Exception:  # noqa: BLE001
        logger.exception("options binance sync task failed to schedule")
    try:
        from .stream import binance_options_ws

        await binance_options_ws.start()
    except Exception:  # noqa: BLE001
        logger.exception("binance options WS feed failed to start")
    logger.info("options module booted")


async def shutdown_options() -> None:
    try:
        from .stream import binance_options_ws

        await binance_options_ws.stop()
    except Exception:  # noqa: BLE001
        logger.exception("binance options WS feed failed to stop")
    try:
        await stop_settlement_watcher()
    except Exception:  # noqa: BLE001
        logger.exception("options auto-settle watcher failed to stop")
    try:
        await stop_expiry_watcher()
    except Exception:  # noqa: BLE001
        logger.exception("options expiry watcher failed to stop")
