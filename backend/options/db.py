"""Mongo indexes for options."""

from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING, DESCENDING

from services.db import get_db

from .constants import (
    COL_CONTRACTS,
    COL_ORDERS,
    COL_POSITIONS,
    COL_SETTLEMENT_EVENTS,
    COL_TRADES,
    COL_UNDERLYINGS,
    COL_WALLET_TXNS,
    COL_WALLETS,
)

logger = logging.getLogger(__name__)


def db() -> Any:
    return get_db()


async def ensure_indexes() -> None:
    d = db()
    await d[COL_UNDERLYINGS].create_index([("symbol", ASCENDING)], unique=True)
    await d[COL_UNDERLYINGS].create_index([("listed", ASCENDING)])

    await d[COL_CONTRACTS].create_index([("id", ASCENDING)], unique=True)
    await d[COL_CONTRACTS].create_index(
        [("underlying_symbol", ASCENDING), ("expiry", ASCENDING), ("strike", ASCENDING), ("option_type", ASCENDING)]
    )
    await d[COL_CONTRACTS].create_index([("listed", ASCENDING), ("trading_enabled", ASCENDING), ("status", ASCENDING)])

    await d[COL_ORDERS].create_index(
        [("contract_id", ASCENDING), ("status", ASCENDING), ("side", ASCENDING), ("price", ASCENDING), ("created_at", ASCENDING)]
    )
    await d[COL_ORDERS].create_index([("uid", ASCENDING), ("created_at", DESCENDING)])

    await d[COL_TRADES].create_index([("contract_id", ASCENDING), ("created_at", DESCENDING)])
    await d[COL_TRADES].create_index([("taker_uid", ASCENDING), ("created_at", DESCENDING)])

    await d[COL_POSITIONS].create_index([("uid", ASCENDING), ("contract_id", ASCENDING), ("status", ASCENDING)])
    await d[COL_POSITIONS].create_index([("contract_id", ASCENDING), ("status", ASCENDING)])

    await d[COL_WALLETS].create_index([("uid", ASCENDING), ("asset", ASCENDING)], unique=True)
    await d[COL_WALLET_TXNS].create_index([("uid", ASCENDING), ("created_at", DESCENDING)])

    await d[COL_SETTLEMENT_EVENTS].create_index([("id", ASCENDING)], unique=True)
    await d[COL_SETTLEMENT_EVENTS].create_index([("contract_id", ASCENDING), ("created_at", DESCENDING)])

    logger.info("options indexes ensured")
