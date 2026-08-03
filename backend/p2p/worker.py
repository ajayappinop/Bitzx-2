"""MaxByte P2P background worker.

Runs every 30s:
  • Auto-cancel orders whose payment window expired without the buyer marking paid.
  • Decay 24h cancellation strikes (reset if no recent cancellations).
  • Auto-open dispute when seller fails to release within the release window.
  • Auto-ban users who accumulate 3+ cancellation strikes in 24h.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from services.db import get_db

log = logging.getLogger("p2p.worker")
TICK_INTERVAL = 30.0
_task = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _expire_unpaid(db):
    """Auto-cancel orders where the payment window has expired."""
    now_iso = _now().isoformat()
    expired = []
    async for o in db.p2p_orders.find({
        "status": "in_progress",
        "payment_window_expires_at": {"$lt": now_iso},
    }):
        expired.append(o)
    if not expired:
        return 0
    from .api import _do_cancel
    n = 0
    for o in expired:
        try:
            await _do_cancel(
                o, reason="Payment window expired — order auto-cancelled",
                cancelled_by="system", cancelled_by_user_id=o["taker_id"],
            )
            n += 1
        except Exception:
            log.exception("Failed to auto-expire order %s", o.get("order_id"))
    return n


async def _decay_strikes(db):
    """Reset 24h cancellation strikes for users with no recent cancellations."""
    cutoff = (_now() - timedelta(hours=24)).isoformat()
    async for s in db.p2p_user_stats.find({"cancellation_strikes_24h": {"$gt": 0}}):
        recent = await db.p2p_orders.find_one({
            "$or": [{"maker_id": s["user_id"]}, {"taker_id": s["user_id"]}],
            "status": "cancelled",
            "cancelled_at": {"$gte": cutoff},
        })
        if not recent:
            await db.p2p_user_stats.update_one(
                {"user_id": s["user_id"]},
                {"$set": {"cancellation_strikes_24h": 0}},
            )


async def _flag_release_breaches(db):
    """Auto-open a dispute when a seller fails to release within the release window."""
    now_iso = _now().isoformat()
    async for o in db.p2p_orders.find({
        "status": "paid_marked",
        "release_window_expires_at": {"$lt": now_iso},
        "release_breach_logged": {"$ne": True},
    }):
        log.warning("P2P release-window breach on order %s — auto-opening dispute", o["order_id"])
        existing = await db.p2p_disputes.find_one({
            "order_id": o["order_id"], "status": {"$in": ["open", "investigating"]}
        })
        if existing:
            await db.p2p_orders.update_one(
                {"order_id": o["order_id"]},
                {"$set": {"release_breach_logged": True, "updated_at": now_iso}},
            )
            continue
        from .api import _new_id, _post_system_message, _broadcast_order
        dispute_id = _new_id("DSP")
        await db.p2p_disputes.insert_one({
            "dispute_id": dispute_id,
            "order_id": o["order_id"],
            "asset": o["asset"], "fiat": o["fiat"],
            "crypto_amount": o["crypto_amount"],
            "fiat_amount": o["fiat_amount"],
            "raised_by_user_id": o["buyer_id"],
            "raised_by_role": "buyer",
            "buyer_id": o["buyer_id"],
            "seller_id": o["seller_id"],
            "reason": "seller_no_release",
            "description": "Auto-opened: seller did not release crypto within the release window after payment was marked.",
            "evidence_urls": [],
            "status": "open",
            "assigned_admin_id": None,
            "resolution": None,
            "resolution_note": None,
            "resolved_at": None,
            "resolved_by_admin_id": None,
            "auto_opened": True,
            "created_at": now_iso, "updated_at": now_iso,
            "previous_order_status": o["status"],
        })
        await db.p2p_orders.update_one(
            {"order_id": o["order_id"]},
            {"$set": {
                "status": "disputed", "dispute_id": dispute_id,
                "release_breach_logged": True, "updated_at": now_iso,
            }},
        )
        await _post_system_message(
            o["order_id"], "auto_disputed",
            "Release window expired — a dispute has been auto-opened. Admin will review within 2 hours."
        )
        await _broadcast_order(o["order_id"], "status",
                               {"status": "disputed", "dispute_id": dispute_id, "auto_opened": True})


async def _auto_ban_repeat_offenders(db):
    """Auto-ban P2P users with 3+ cancellation strikes in 24h."""
    async for s in db.p2p_user_stats.find({
        "cancellation_strikes_24h": {"$gte": 3},
        "$or": [
            {"is_banned_until": None},
            {"is_banned_until": {"$lt": _now().isoformat()}},
        ],
    }):
        until = (_now() + timedelta(hours=24)).isoformat()
        await db.p2p_user_stats.update_one(
            {"user_id": s["user_id"]},
            {"$set": {
                "is_banned_until": until,
                "ban_reason": "Auto-ban: 3+ cancellations in 24h",
                "banned_by": "system",
                "banned_at": _now().isoformat(),
            }},
        )
        log.warning("Auto-banned P2P user %s (3-strike rule)", s["user_id"])


async def _loop(db):
    while True:
        try:
            n_exp = await _expire_unpaid(db)
            if n_exp:
                log.info("P2P worker: auto-cancelled %d expired orders", n_exp)
            await _decay_strikes(db)
            await _flag_release_breaches(db)
            await _auto_ban_repeat_offenders(db)
        except Exception:
            log.exception("p2p worker tick failed")
        await asyncio.sleep(TICK_INTERVAL)


async def start_p2p_worker(db):
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop(db))
    log.info("P2P background worker started (tick=%.0fs)", TICK_INTERVAL)
