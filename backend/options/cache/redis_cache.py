"""Redis-backed cache with in-memory fallback for options market data."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "").strip()
_ENABLED = os.getenv("OPTIONS_CACHE_ENABLED", "true").lower() not in ("0", "false", "no")

_memory: dict[str, tuple[Any, float]] = {}
_redis_client: Any = None
_redis_checked = False


def _ttl(key_type: str) -> int:
    defaults = {
        "contracts": int(os.getenv("OPTIONS_CACHE_TTL_CONTRACTS", "120")),
        "chain": int(os.getenv("OPTIONS_CACHE_TTL_CHAIN", "10")),
        "ticker": int(os.getenv("OPTIONS_CACHE_TTL_TICKER", "2")),
        "orderbook": int(os.getenv("OPTIONS_CACHE_TTL_ORDERBOOK", "1")),
        "candles": int(os.getenv("OPTIONS_CACHE_TTL_CANDLES", "60")),
    }
    return defaults.get(key_type, 5)


def _redis():
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client
    _redis_checked = True
    if not _ENABLED or not _REDIS_URL:
        return None
    try:
        import redis.asyncio as aioredis  # type: ignore[import-untyped]

        _redis_client = aioredis.from_url(_REDIS_URL, decode_responses=True)
        logger.info("options Redis cache enabled")
    except Exception as exc:  # noqa: BLE001
        logger.warning("options Redis unavailable — using in-memory cache: %s", exc)
        _redis_client = None
    return _redis_client


async def get(key: str) -> Optional[Any]:
    r = _redis()
    if r is not None:
        try:
            raw = await r.get(key)
            if raw is not None:
                return json.loads(raw)
        except Exception as exc:  # noqa: BLE001
            logger.debug("redis get failed: %s", exc)
    entry = _memory.get(key)
    if entry and entry[1] > time.monotonic():
        return entry[0]
    return None


async def set(key: str, value: Any, *, key_type: str = "ticker") -> None:
    ttl = _ttl(key_type)
    r = _redis()
    if r is not None:
        try:
            await r.set(key, json.dumps(value), ex=ttl)
            return
        except Exception as exc:  # noqa: BLE001
            logger.debug("redis set failed: %s", exc)
    _memory[key] = (value, time.monotonic() + ttl)


async def delete_prefix(prefix: str) -> None:
    r = _redis()
    if r is not None:
        try:
            keys = [k async for k in r.scan_iter(match=f"{prefix}*")]
            if keys:
                await r.delete(*keys)
        except Exception as exc:  # noqa: BLE001
            logger.debug("redis delete_prefix failed: %s", exc)
    stale = [k for k in _memory if k.startswith(prefix)]
    for k in stale:
        _memory.pop(k, None)


def cache_key(*parts: str) -> str:
    return "opt:" + ":".join(str(p).strip().lower() for p in parts if p)
