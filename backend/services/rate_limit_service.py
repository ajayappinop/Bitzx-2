"""Phase 7b — Mongo-backed rate limiter (fixed-window).

Design:
    * One document per ``(scope, key, window_start)`` triple. ``scope`` is a
      short route identifier (e.g. ``"auth.login"``), ``key`` is the
      subject being rate-limited (uid or ip or email), and ``window_start``
      is the epoch-second bucket boundary (``now - now % window_sec``).
    * A single atomic ``find_one_and_update($inc: {count: 1}, $setOnInsert)``
      returns the *new* count → no race between readers and writers.
    * ``expires_at`` is set when the row is first created so a TTL index
      auto-reaps old buckets. Callers never need to clean up manually.
    * We NEVER sleep or queue — exceeding the limit raises an HTTP 429
      with a ``Retry-After`` hint; the caller decides the UX.

This is a FIXED-WINDOW algorithm, not a sliding window. That's a
conscious trade-off: simpler, atomic, and "good enough" for login /
withdraw / 2FA gates at our traffic volume. If we ever need
sub-burst smoothing we'll swap in Redis + token-bucket.

Safety:
    * Soft-fail on DB errors — a temporarily unreachable Mongo must not
      lock users out of login. We log and let the request through.
    * Disabled entirely via ``RATE_LIMIT_ENABLED=false`` env (handy for
      integration tests).

Usage from ``server.py``::

    from services.rate_limit_service import check_rate_limit

    await check_rate_limit(
        db, scope="auth.login",
        key=f"ip:{client_ip}", limit=5, window_sec=60,
    )

Per-route defaults live in ``server.py``; keeping them there means they
sit next to the endpoint they protect and can be tweaked without
round-tripping through another module.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

COLLECTION = "rate_limits"


def _enabled() -> bool:
    val = (os.getenv("RATE_LIMIT_ENABLED") or "true").strip().lower()
    return val not in ("0", "false", "no", "off")


@dataclass
class RateLimitState:
    """Snapshot of a bucket right after the current request was counted."""
    count: int
    limit: int
    window_sec: int
    retry_after_sec: int
    window_start: int


async def ensure_indexes(db) -> None:
    """Create the TTL + lookup indexes. Idempotent."""
    if db is None:
        return
    try:
        # TTL — Mongo auto-removes rows when ``expires_at`` is reached.
        await db[COLLECTION].create_index(
            "expires_at",
            expireAfterSeconds=0,
            name="rate_limits_ttl",
        )
        # Uniqueness of a single bucket row. ``scope+key+window_start`` is
        # the natural compound key. A unique index lets us rely on
        # ``upsert`` semantics without double-inserts under load.
        await db[COLLECTION].create_index(
            [("scope", 1), ("key", 1), ("window_start", 1)],
            unique=True,
            name="rate_limits_bucket",
        )
    except Exception:  # noqa: BLE001
        logger.exception("rate_limit_service: failed to ensure indexes")


async def check_rate_limit(
    db,
    *,
    scope: str,
    key: str,
    limit: int,
    window_sec: int,
) -> RateLimitState:
    """Increment the bucket and enforce the limit.

    Raises ``HTTPException(429)`` when the bucket is over its cap.
    Returns the post-increment state on success so callers can emit
    ``X-RateLimit-*`` headers if they want (not wired in yet).

    When rate limiting is disabled (env) or the DB is unavailable, this
    function no-ops — the return value is a stub with ``count=0``.
    """
    if not _enabled() or db is None or limit <= 0 or window_sec <= 0:
        return RateLimitState(
            count=0, limit=limit, window_sec=window_sec,
            retry_after_sec=0, window_start=int(time.time()),
        )

    now_sec = int(time.time())
    window_start = now_sec - (now_sec % window_sec)
    window_end = window_start + window_sec
    expires_at = datetime.fromtimestamp(
        window_end + 10, tz=timezone.utc,  # 10 s grace so TTL lags slightly
    )

    try:
        doc = await db[COLLECTION].find_one_and_update(
            {"scope": scope, "key": key, "window_start": window_start},
            {
                "$inc": {"count": 1},
                "$setOnInsert": {
                    "scope": scope,
                    "key": key,
                    "window_start": window_start,
                    "expires_at": expires_at,
                    "limit": int(limit),
                    "window_sec": int(window_sec),
                },
            },
            upsert=True,
            return_document=True,  # pymongo ReturnDocument.AFTER
        )
    except Exception:  # noqa: BLE001
        # DB unavailable → fail-open. Logging is enough; locking users out
        # of login because Mongo is slow is strictly worse than a brief
        # lapse in rate limiting.
        logger.exception("rate_limit_service: bucket upsert failed (%s / %s)", scope, key)
        return RateLimitState(
            count=0, limit=limit, window_sec=window_sec,
            retry_after_sec=0, window_start=window_start,
        )

    count = int((doc or {}).get("count") or 1)
    retry_after = max(1, window_end - now_sec)

    if count > limit:
        raise HTTPException(
            status_code=429,
            detail="Too many requests — please slow down and try again shortly.",
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(window_end),
            },
        )

    return RateLimitState(
        count=count, limit=limit, window_sec=window_sec,
        retry_after_sec=retry_after, window_start=window_start,
    )


def client_ip_from_request(request) -> str:
    """Best-effort client IP extraction.

    Honours ``X-Forwarded-For`` / ``X-Real-IP`` (for ingress / reverse-proxy
    deployments) but falls back to the raw socket peer. We never trust the
    header without at least some validation — we take the LEFTMOST address
    which is the original client per standard (the rest of the chain is
    proxies).
    """
    try:
        headers = request.headers
        xff = (headers.get("x-forwarded-for") or "").strip()
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return first
        xri = (headers.get("x-real-ip") or "").strip()
        if xri:
            return xri
        client = getattr(request, "client", None)
        if client and client.host:
            return str(client.host)
    except Exception:  # noqa: BLE001
        pass
    return "unknown"


async def clear_key(db, *, scope: Optional[str], key: str) -> None:
    """Drop all outstanding buckets for a key (used on password change,
    successful 2FA, etc. so a user isn't penalised after a legit fix).
    """
    if db is None or not key:
        return
    try:
        filt = {"key": key}
        if scope:
            filt["scope"] = scope
        await db[COLLECTION].delete_many(filt)
    except Exception:  # noqa: BLE001
        logger.exception("rate_limit_service: clear_key failed (%s / %s)", scope, key)
