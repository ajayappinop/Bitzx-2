"""Shared MongoDB client/database accessor for the service layer.

`server.py` initialises the Motor client on startup and then calls
``set_client(client, db, supports_transactions=...)`` so every service can
reach the same connection without re-importing ``server``.
"""

from __future__ import annotations

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None
_supports_transactions: bool = False


def set_client(
    client: Optional[AsyncIOMotorClient],
    database: Optional[AsyncIOMotorDatabase],
    *,
    supports_transactions: bool = False,
) -> None:
    """Register the active client/database for the service layer."""
    global _client, _db, _supports_transactions
    _client = client
    _db = database
    _supports_transactions = bool(supports_transactions)
    logger.info(
        "services.db registered (transactions=%s)",
        "yes" if _supports_transactions else "no",
    )


def get_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError(
            "MongoDB client not initialised. Call services.db.set_client(...) first."
        )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError(
            "Database not initialised. Call services.db.set_client(...) first."
        )
    return _db


def supports_transactions() -> bool:
    return _supports_transactions


async def detect_transaction_support(client: AsyncIOMotorClient) -> bool:
    """Best-effort check: Mongo transactions require a replica set or shard.

    Returns ``True`` when the cluster reports a replica-set name via ``hello``.
    """
    try:
        info = await client.admin.command("hello")
    except Exception as exc:  # noqa: BLE001
        logger.debug("detect_transaction_support: hello failed (%s)", exc)
        return False
    return bool(info.get("setName"))
