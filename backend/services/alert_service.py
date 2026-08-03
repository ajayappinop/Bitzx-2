"""Phase 9c — Alert service.

A tiny, opinionated alerting pipeline that lives entirely inside the
existing Mongo / FastAPI stack. No Redis, no queue, no external SaaS.

Design goals
------------

1. **Dedupe by key.** Callers pass a ``dedupe_key`` (e.g.
   ``"hedger.reconcile.critical:ETH"``). An OPEN alert with the same
   key gets its counter bumped and its ``last_seen_at`` + TTL refreshed
   instead of inserting a new row. This keeps the alert table readable
   when a worker tick keeps tripping the same rule.

2. **30-day TTL.** ``expires_at`` is a BSON ``datetime`` and is indexed
   with Mongo's native TTL expirer. Resolved alerts age out naturally
   without a cron. ``expires_at`` is refreshed on every hit.

3. **Optional webhook.** ``platform_controls.alert_webhook_url``, if
   set, receives a JSON POST on every ``raise_alert`` call that clears
   ``alert_webhook_min_severity``. Delivery is fire-and-forget (a
   detached asyncio task) so the caller is never blocked on an
   external HTTP round-trip.

4. **Auto-recovery.** ``auto_resolve_by_dedupe`` lets the producer
   flip all open alerts matching a set of keys to ``resolved`` when
   the underlying condition has recovered — used by
   ``hedger_service.reconcile`` to close drift alerts as soon as an
   asset comes back inside the warn threshold.

5. **Level-free.** Severity is ``info | warn | critical``. Callers
   decide; the service never infers.

Schema (``alerts`` collection)
------------------------------

.. code-block:: text

    id:              "alt_<hex>"
    type:            "hedger.reconcile.critical"  # dotted path
    severity:        "info" | "warn" | "critical"
    source:          "hedger" | "treasury" | "deposit" | "withdrawal" | "system"
    title:           short human string
    message:         long human string
    meta:            { ... } arbitrary context for the UI detail drawer
    dedupe_key:      stable string used to collapse repeats
    status:          "open" | "resolved" | "muted"
    occurrences:     int — # of raise_alert calls folded into this row
    first_seen_at:   ISO — original trigger
    last_seen_at:    ISO — most recent raise
    created_at:      ISO — = first_seen_at on insert, immutable after
    updated_at:      ISO
    resolved_at:     ISO | null
    resolved_by:     str | null  (admin email)
    resolved_note:   str | null
    muted_until:     ISO | null  (reserved for future)
    webhook_sent:    bool
    webhook_error:   str | null
    expires_at:      BSON Date — TTL target; drops row after 30d.

Indexes (created in ``server.py`` startup):

- ``id``          unique
- ``dedupe_key + status``   (fast upsert path)
- ``status + severity + last_seen_at``  (list queries)
- ``expires_at`` with ``expireAfterSeconds=0``  (TTL)
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx

from .db import get_db

logger = logging.getLogger(__name__)


ALERTS_COLLECTION = "alerts"

ALLOWED_SEVERITIES: Tuple[str, ...] = ("info", "warn", "critical")
ALLOWED_STATUSES:   Tuple[str, ...] = ("open", "resolved", "muted")

SEVERITY_RANK: Dict[str, int] = {"info": 0, "warn": 1, "critical": 2}

# 30-day TTL per the 9c decision. Kept centralised so admins tuning the
# retention only have to change one constant (or env override).
ALERT_TTL_DAYS: int = int(os.getenv("ALERT_TTL_DAYS", "30"))

WEBHOOK_TIMEOUT_SEC: float = float(os.getenv("ALERT_WEBHOOK_TIMEOUT_SEC", "5.0"))


class AlertError(Exception):
    """Base class for alert-service errors."""


# ─────────────────────────────────────────────────────────────────────────────
# Time helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _ttl_target(now: Optional[datetime] = None) -> datetime:
    """Compute the ``expires_at`` for a fresh or just-refreshed alert.

    Returned as a **naive** UTC datetime. Motor/PyMongo convert this to
    a BSON Date automatically, which the TTL monitor understands. Using
    an ISO string here would silently disable the TTL (Mongo only
    expires Date fields).
    """
    return (now or _now()).replace(tzinfo=None) + timedelta(days=ALERT_TTL_DAYS)


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

def _norm_severity(v: Any) -> str:
    s = str(v or "").strip().lower()
    if s not in ALLOWED_SEVERITIES:
        raise AlertError(f"Unknown severity: {v!r}")
    return s


def _norm_source(v: Any) -> str:
    s = str(v or "").strip().lower() or "system"
    return s


def _norm_type(v: Any) -> str:
    s = str(v or "").strip()
    if not s:
        raise AlertError("type is required")
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Webhook dispatcher
# ─────────────────────────────────────────────────────────────────────────────

async def _deliver_webhook(
    url: str,
    payload: Dict[str, Any],
    alert_id: str,
) -> None:
    """POST the alert payload to ``url`` and record the outcome.

    Runs as a detached task so the caller of ``raise_alert`` never
    blocks on the network. Errors are swallowed after a single attempt
    — this is a notification channel, not a delivery guarantee. A
    future phase can add retries + a dead-letter collection.
    """
    db = get_db()
    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT_SEC) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
        if db is not None:
            await db[ALERTS_COLLECTION].update_one(
                {"id": alert_id},
                {"$set": {
                    "webhook_sent":  True,
                    "webhook_error": None,
                    "updated_at":    _now_iso(),
                }},
            )
        logger.info("alerts: webhook delivered id=%s url=%s", alert_id, url)
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {exc}"
        # Truncate to avoid blowing up the doc if the remote dumps a big
        # HTML error page. 400 chars is plenty for the UI.
        err = err[:400]
        if db is not None:
            try:
                await db[ALERTS_COLLECTION].update_one(
                    {"id": alert_id},
                    {"$set": {
                        "webhook_sent":  False,
                        "webhook_error": err,
                        "updated_at":    _now_iso(),
                    }},
                )
            except Exception:  # noqa: BLE001
                logger.exception("alerts: failed to record webhook error")
        logger.warning(
            "alerts: webhook delivery FAILED id=%s url=%s err=%s",
            alert_id, url, err,
        )


def _schedule_webhook(
    *,
    webhook_url: Optional[str],
    webhook_min_severity: Optional[str],
    severity: str,
    alert_doc: Dict[str, Any],
) -> None:
    """Fire-and-forget dispatch. No-op if webhook isn't configured or if
    the alert's severity is below the configured floor."""
    if not webhook_url:
        return
    min_sev = (webhook_min_severity or "warn").strip().lower()
    if min_sev not in ALLOWED_SEVERITIES:
        min_sev = "warn"
    if SEVERITY_RANK.get(severity, 0) < SEVERITY_RANK.get(min_sev, 0):
        return
    payload = {
        "event": "alert.raised",
        "alert": _jsonable(alert_doc),
    }
    # Detach so the caller isn't bound to webhook latency. Python's
    # garbage collector would happily drop this task; stash it on the
    # module level to keep the reference alive until it settles.
    task = asyncio.create_task(
        _deliver_webhook(webhook_url, payload, alert_doc["id"]),
        name=f"alert-webhook-{alert_doc['id']}",
    )
    _WEBHOOK_TASKS.add(task)
    task.add_done_callback(_WEBHOOK_TASKS.discard)


# Strong ref set so fire-and-forget tasks aren't GC'd mid-flight.
_WEBHOOK_TASKS: "set[asyncio.Task[None]]" = set()


# ─────────────────────────────────────────────────────────────────────────────
# JSON helpers
# ─────────────────────────────────────────────────────────────────────────────

def _jsonable(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Convert ``datetime`` fields to ISO strings for webhook payload +
    API responses. Mongo leaves BSON Dates as ``datetime`` on read."""
    out: Dict[str, Any] = {}
    for k, v in doc.items():
        if k == "_id":
            continue
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Primary API
# ─────────────────────────────────────────────────────────────────────────────

async def raise_alert(
    *,
    type: str,
    severity: str,
    source: str,
    title: str,
    message: str,
    meta: Optional[Dict[str, Any]] = None,
    dedupe_key: Optional[str] = None,
    webhook_url: Optional[str] = None,
    webhook_min_severity: Optional[str] = None,
) -> Dict[str, Any]:
    """Raise (or dedupe) an alert and return the stored doc.

    Dedupe behaviour:

    - If ``dedupe_key`` is provided and an OPEN alert exists for that
      key, bump ``occurrences``, refresh ``last_seen_at`` + TTL, and
      overwrite ``severity``/``title``/``message``/``meta`` with the
      latest values (the worker's current read of the world is always
      more authoritative than a stale snapshot).
    - Otherwise, insert a new alert row with ``status="open"``.

    ``webhook_url`` / ``webhook_min_severity`` are threaded in by the
    caller (usually ``server.py`` reading ``platform_controls``) so the
    service itself doesn't need a dependency on the controls model.
    """
    severity = _norm_severity(severity)
    source = _norm_source(source)
    alert_type = _norm_type(type)
    title = str(title or "").strip()[:200]
    message = str(message or "").strip()[:2000]
    meta = dict(meta or {})

    db = get_db()
    if db is None:
        raise AlertError("database unavailable")

    now = _now()
    now_iso = now.isoformat()
    expires_at = _ttl_target(now)

    existing: Optional[Dict[str, Any]] = None
    if dedupe_key:
        existing = await db[ALERTS_COLLECTION].find_one(
            {"dedupe_key": dedupe_key, "status": "open"},
        )

    if existing:
        alert_id = existing["id"]
        await db[ALERTS_COLLECTION].update_one(
            {"id": alert_id},
            {
                "$set": {
                    "severity":     severity,
                    "source":       source,
                    "type":         alert_type,
                    "title":        title,
                    "message":      message,
                    "meta":         meta,
                    "last_seen_at": now_iso,
                    "updated_at":   now_iso,
                    "expires_at":   expires_at,
                },
                "$inc": {"occurrences": 1},
            },
        )
        doc = await db[ALERTS_COLLECTION].find_one({"id": alert_id}) or {}
    else:
        alert_id = f"alt_{uuid.uuid4().hex[:16]}"
        doc = {
            "id":            alert_id,
            "type":          alert_type,
            "severity":      severity,
            "source":        source,
            "title":         title,
            "message":       message,
            "meta":          meta,
            "dedupe_key":    dedupe_key,
            "status":        "open",
            "occurrences":   1,
            "first_seen_at": now_iso,
            "last_seen_at":  now_iso,
            "created_at":    now_iso,
            "updated_at":    now_iso,
            "resolved_at":   None,
            "resolved_by":   None,
            "resolved_note": None,
            "muted_until":   None,
            "webhook_sent":  False,
            "webhook_error": None,
            "expires_at":    expires_at,
        }
        await db[ALERTS_COLLECTION].insert_one(dict(doc))
        logger.info(
            "alerts: raised type=%s severity=%s source=%s id=%s dedupe=%s",
            alert_type, severity, source, alert_id, dedupe_key or "-",
        )

    _schedule_webhook(
        webhook_url=webhook_url,
        webhook_min_severity=webhook_min_severity,
        severity=severity,
        alert_doc=doc,
    )
    return _jsonable(doc)


async def resolve_alert(
    alert_id: str,
    *,
    resolved_by: Optional[str],
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Mark ``alert_id`` as resolved. Idempotent — already-resolved or
    already-muted alerts are returned unchanged."""
    db = get_db()
    if db is None:
        raise AlertError("database unavailable")
    now_iso = _now_iso()
    res = await db[ALERTS_COLLECTION].find_one_and_update(
        {"id": alert_id, "status": "open"},
        {"$set": {
            "status":        "resolved",
            "resolved_at":   now_iso,
            "resolved_by":   resolved_by,
            "resolved_note": (note or None),
            "updated_at":    now_iso,
        }},
        return_document=True,
    )
    if res is None:
        res = await db[ALERTS_COLLECTION].find_one({"id": alert_id})
        if res is None:
            raise AlertError(f"alert not found: {alert_id}")
    logger.info("alerts: resolved id=%s by=%s", alert_id, resolved_by or "unknown")
    return _jsonable(res)


async def mute_alert(
    alert_id: str,
    *,
    muted_by: Optional[str],
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Mark ``alert_id`` as muted (operator has seen it and intentionally
    suppressed; no auto-recovery). A subsequent raise with the same
    dedupe_key will NOT reopen this row — it'll insert a new one."""
    db = get_db()
    if db is None:
        raise AlertError("database unavailable")
    now_iso = _now_iso()
    res = await db[ALERTS_COLLECTION].find_one_and_update(
        {"id": alert_id, "status": "open"},
        {"$set": {
            "status":        "muted",
            "resolved_at":   now_iso,
            "resolved_by":   muted_by,
            "resolved_note": (note or None),
            "updated_at":    now_iso,
        }},
        return_document=True,
    )
    if res is None:
        res = await db[ALERTS_COLLECTION].find_one({"id": alert_id})
        if res is None:
            raise AlertError(f"alert not found: {alert_id}")
    logger.info("alerts: muted id=%s by=%s", alert_id, muted_by or "unknown")
    return _jsonable(res)


async def auto_resolve_by_dedupe(
    dedupe_keys: Iterable[str],
    *,
    note: str = "auto-resolved (condition cleared)",
) -> int:
    """Bulk-close any OPEN alerts whose ``dedupe_key`` is in ``keys``.

    Used by the reconcile loop to close drift alerts as soon as the
    asset returns to within the warn threshold. Returns the number of
    rows updated (0 is fine — it means nothing was open).
    """
    keys = [k for k in dedupe_keys if k]
    if not keys:
        return 0
    db = get_db()
    if db is None:
        return 0
    now_iso = _now_iso()
    res = await db[ALERTS_COLLECTION].update_many(
        {"dedupe_key": {"$in": keys}, "status": "open"},
        {"$set": {
            "status":        "resolved",
            "resolved_at":   now_iso,
            "resolved_by":   "system",
            "resolved_note": note,
            "updated_at":    now_iso,
        }},
    )
    if res.modified_count:
        logger.info(
            "alerts: auto-resolved %d open alerts (keys=%s)",
            res.modified_count, keys,
        )
    return int(res.modified_count or 0)


# ─────────────────────────────────────────────────────────────────────────────
# Read API
# ─────────────────────────────────────────────────────────────────────────────

async def list_alerts(
    *,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    source: Optional[str] = None,
    type: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> Dict[str, Any]:
    """Paginated list of alerts, newest ``last_seen_at`` first.

    ``search`` does a case-insensitive substring match against
    ``title`` + ``message`` + ``type``. Kept as a regex query rather
    than a text index because the collection is tiny (TTL = 30d) and a
    text index is overkill + adds a write-amp tax.
    """
    db = get_db()
    if db is None:
        return {"items": [], "page": 1, "limit": limit, "total": 0, "pages": 0}

    page = max(1, int(page or 1))
    limit = max(1, min(200, int(limit or 50)))

    query: Dict[str, Any] = {}
    if status and status in ALLOWED_STATUSES:
        query["status"] = status
    elif status == "all":
        pass
    else:
        query["status"] = {"$in": list(ALLOWED_STATUSES)}
    if severity and severity in ALLOWED_SEVERITIES:
        query["severity"] = severity
    if source:
        query["source"] = source
    if type:
        query["type"] = type
    if search:
        import re
        pat = re.compile(re.escape(search.strip()), re.IGNORECASE)
        query["$or"] = [{"title": pat}, {"message": pat}, {"type": pat}]

    total = await db[ALERTS_COLLECTION].count_documents(query)
    cursor = (
        db[ALERTS_COLLECTION]
        .find(query)
        .sort("last_seen_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items: List[Dict[str, Any]] = []
    async for row in cursor:
        items.append(_jsonable(row))

    pages = max(1, (total + limit - 1) // limit) if total else 0
    return {
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
        "pages": pages,
    }


async def count_stats() -> Dict[str, Any]:
    """Summary counts for the nav badge + header.

    Returns ``{open: {info, warn, critical, total}, last_seen_at}``.
    ``last_seen_at`` is the newest open-alert timestamp, used by the
    frontend to drive the "pulse" animation when a fresh critical
    comes in.
    """
    db = get_db()
    if db is None:
        return {"open": {"info": 0, "warn": 0, "critical": 0, "total": 0}, "last_seen_at": None}

    pipeline: Sequence[Dict[str, Any]] = [
        {"$match": {"status": "open"}},
        {"$group": {
            "_id": "$severity",
            "count": {"$sum": 1},
            "last_seen_at": {"$max": "$last_seen_at"},
        }},
    ]
    buckets = {"info": 0, "warn": 0, "critical": 0}
    newest: Optional[str] = None
    async for row in db[ALERTS_COLLECTION].aggregate(pipeline):
        sev = str(row.get("_id") or "").lower()
        if sev in buckets:
            buckets[sev] = int(row.get("count") or 0)
        ls = row.get("last_seen_at")
        if ls and (newest is None or str(ls) > newest):
            newest = str(ls)
    total = sum(buckets.values())
    return {
        "open": {**buckets, "total": total},
        "last_seen_at": newest,
    }


async def get_alert(alert_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db is None:
        return None
    doc = await db[ALERTS_COLLECTION].find_one({"id": alert_id})
    return _jsonable(doc) if doc else None
