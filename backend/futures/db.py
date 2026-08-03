"""Mongo collection helpers + index setup for futures.

The futures module deliberately does *not* import :mod:`server` — it goes
through :mod:`services.db` which already exposes the active client/db.
"""

from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING, DESCENDING

from services.db import get_db
from .constants import (
    COL_FUNDING_PAYS,
    COL_FUNDING_RATES,
    COL_LIQUIDATIONS,
    COL_MARK_PRICES,
    COL_ORDERS,
    COL_POSITIONS,
    COL_TRADES,
    COL_WALLETS,
    COL_WALLET_TXNS,
)

logger = logging.getLogger(__name__)


def db() -> Any:
    """Shortcut to the active database. Must be called after services.db init."""
    return get_db()


async def ensure_indexes() -> None:
    """Idempotent: declare every index the futures module relies on.

    Called once from :func:`backend.futures.bootstrap.bootstrap_futures` at
    server startup. Mongo treats duplicate ``create_index`` calls as no-ops,
    so this is safe to invoke on every boot.
    """
    d = db()

    # Wallets — one row per (uid, asset). For now asset is always USDT but
    # the schema supports multi-collateral if we add BUSD/USDC later.
    await d[COL_WALLETS].create_index(
        [("uid", ASCENDING), ("asset", ASCENDING)], unique=True
    )

    # Wallet ledger — ordered scan by user/time.
    await d[COL_WALLET_TXNS].create_index(
        [("uid", ASCENDING), ("created_at", DESCENDING)]
    )
    await d[COL_WALLET_TXNS].create_index([("ref_type", ASCENDING), ("ref_id", ASCENDING)])

    # Positions — one row per (uid, symbol). Closed positions are kept in
    # the same collection with ``status="closed"`` for history.
    await d[COL_POSITIONS].create_index(
        [("uid", ASCENDING), ("symbol", ASCENDING), ("status", ASCENDING)]
    )
    await d[COL_POSITIONS].create_index(
        [("status", ASCENDING), ("symbol", ASCENDING)]  # liquidation scanner
    )

    # Orders — book lookups + per-user listing.
    await d[COL_ORDERS].create_index(
        [("symbol", ASCENDING), ("status", ASCENDING), ("side", ASCENDING),
         ("price", ASCENDING), ("created_at", ASCENDING)]
    )
    await d[COL_ORDERS].create_index([("uid", ASCENDING), ("created_at", DESCENDING)])
    await d[COL_ORDERS].create_index([("status", ASCENDING)])  # trigger scanner

    # Trades — by symbol/time + by user/time.
    await d[COL_TRADES].create_index([("symbol", ASCENDING), ("created_at", DESCENDING)])
    await d[COL_TRADES].create_index([("taker_uid", ASCENDING), ("created_at", DESCENDING)])
    await d[COL_TRADES].create_index([("maker_uid", ASCENDING), ("created_at", DESCENDING)])

    # Liquidations — recent first.
    await d[COL_LIQUIDATIONS].create_index(
        [("symbol", ASCENDING), ("created_at", DESCENDING)]
    )

    # Funding — one rate doc per (symbol, settled_at).
    await d[COL_FUNDING_RATES].create_index(
        [("symbol", ASCENDING), ("settled_at", DESCENDING)]
    )
    await d[COL_FUNDING_PAYS].create_index(
        [("uid", ASCENDING), ("settled_at", DESCENDING)]
    )

    # Mark prices — point-in-time snapshots used by the WS feed and
    # liquidation scanner. We keep a TTL of ~7 days.
    await d[COL_MARK_PRICES].create_index([("symbol", ASCENDING), ("created_at", DESCENDING)])
    await d[COL_MARK_PRICES].create_index("created_at", expireAfterSeconds=7 * 86400)

    logger.info("futures indexes ensured")
