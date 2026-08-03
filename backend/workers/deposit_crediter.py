"""Product Phase 4 — deposit auto-crediter (module historically labeled Phase 5).

Manual overrides: ``POST /api/admin/deposit-events/{event_id}/credit`` and the
admin **Deposit events** page (Phase 5 operations tooling).

Consumes ``deposit_events`` rows that the :mod:`workers.deposit_poller`
has already recorded and promotes them into real wallet balances once
the per-asset confirmation threshold is met. Every balance mutation
goes through :func:`services.wallet_service.credit` so the ``wallet_txns``
ledger (Phase 1) stays authoritative — no direct ``$inc`` writes on
``wallets``.

State machine (on ``deposit_events.status``):

    pending / confirming  →  credited        (happy path)
                         →  pending_kyc     (KYC required, not approved)
                         →  below_min       (amount dust-filtered)
                         →  orphan          (uid missing — can't route)

Re-orgs are handled passively: the poller flags previously-credited
events as ``reorg_review`` if the same tx reappears at a different
block height. The crediter never processes ``reorg_review`` or
already-``credited`` events, so double-credit is impossible.

Safety rails:

- Opt-in — runs only when ``platform_controls.deposit_auto_credit_enabled``
  is truthy *and* the provider is not disabled.
- Per-tick guard rails: we re-read platform_controls on every tick so
  admins can pause/tune without restarting the process.
- Atomic promotion: ``find_one_and_update`` with a ``status``-scoped
  filter flips the event to an intermediate ``crediting`` status before
  writing the ledger, so two workers (or an admin override firing
  simultaneously) can never both credit the same sighting.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

from pymongo import ReturnDocument

from services import blockchain_service, treasury_service, wallet_service
from services.blockchain_service import BlockchainProvider, DisabledProvider

logger = logging.getLogger(__name__)


# Statuses the crediter is willing to re-evaluate on each tick. Terminal
# states (``credited``, ``orphan``, ``reorg_review``) are ignored.
_ACTIONABLE_STATUSES = ("pending", "confirming", "pending_kyc", "below_min")


def _is_enabled() -> bool:
    val = (os.getenv("DEPOSIT_CREDIT_ENABLED") or "").strip().lower()
    return val in ("1", "true", "yes", "on")


def _interval_sec() -> float:
    try:
        return max(5.0, float(os.getenv("DEPOSIT_CREDIT_INTERVAL_SEC") or "15"))
    except ValueError:
        return 15.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_controls(get_platform_controls: Callable[[], Awaitable[Dict[str, Any]]]):
    """Fetch the live platform_controls dict, swallowing DB hiccups."""
    try:
        return await get_platform_controls()
    except Exception:  # noqa: BLE001
        logger.exception("deposit_crediter: failed to read platform_controls — retrying next tick")
        return None


async def _reserve_event(db, event_id: str) -> Optional[Dict[str, Any]]:
    """Atomically move an actionable event into ``crediting`` state.

    Returns the original document (pre-update) when the reservation
    succeeded, or ``None`` if someone else already claimed it. The caller
    MUST either commit the credit (→ ``credited``) or release it (→
    previous status) — we use ``crediting`` as an exclusive lock.
    """
    return await db.deposit_events.find_one_and_update(
        {
            "id": event_id,
            "status": {"$in": list(_ACTIONABLE_STATUSES)},
        },
        {
            "$set": {
                "status": "crediting",
                "crediting_started_at": _now_iso(),
            },
        },
        return_document=ReturnDocument.BEFORE,
    )


async def _release_event(db, event_id: str, *, new_status: str, extra: Optional[Dict[str, Any]] = None) -> None:
    """Move an event out of ``crediting`` into a terminal or retry state.

    Only flips ``crediting`` → ``new_status`` so an external admin action
    that already settled the row wins.
    """
    payload: Dict[str, Any] = {
        "status": new_status,
        "updated_at": _now_iso(),
    }
    if extra:
        payload.update(extra)
    await db.deposit_events.update_one(
        {"id": event_id, "status": "crediting"},
        {"$set": payload},
    )


async def _credit_one(
    db,
    ev: Dict[str, Any],
    controls: Dict[str, Any],
    *,
    resolve_min_confirmations: Callable[[Dict[str, Any], str], int],
    min_notional_usdt: float,
    price_lookup: Optional[Callable[[str], float]] = None,
) -> str:
    """Evaluate one event and return the new status after processing."""
    event_id = ev.get("id") or ""
    uid = (ev.get("uid") or "").strip()
    asset = (ev.get("asset") or "").upper()
    amount = float(ev.get("amount") or 0.0)
    confirmations = int(ev.get("confirmations") or 0)
    tx_hash = ev.get("tx_hash") or ""

    if not event_id:
        return "pending"  # should never happen — poller always stamps an id

    if not uid:
        # No mapping — address isn't ours (or user was deleted). We keep
        # the row for audit but mark it orphan so it's out of the queue.
        return "orphan"

    threshold = resolve_min_confirmations(controls, asset)
    # Signup-bonus / referral-bonus transfers are treasury-to-user sends we
    # broadcast ourselves. The tx_hash is recorded at dispatch time so we
    # trust the transfer is on-chain even when the deposit poller hasn't yet
    # updated the confirmations field in DB. Bypassing the confirmation gate
    # here prevents these events from being permanently stuck in "confirming"
    # due to poller-lag or a stale confirmations=0 value — the atomic
    # _reserve_event lock still prevents any double-credit.
    is_treasury_send = (ev.get("source") or "").lower() in ("signup_bonus", "referral_bonus")
    if not is_treasury_send and confirmations < max(1, threshold):
        # Not enough confirmations yet. Bump to "confirming" so the UI can
        # distinguish "first-seen" from "progressing".
        return "confirming"

    # Phase 5 — optional KYC gate. Wallet address is still usable; we just
    # hold the credit until compliance catches up. Referral-bonus events gate
    # on the *referred* user's KYC (``kyc_gate_uid``), not the wallet owner's —
    # the person who did the referring should not need their own KYC approved
    # to receive a reward triggered by someone else's KYC.
    if controls.get("credit_requires_kyc_approval", True):
        kyc_gate_uid = (ev.get("kyc_gate_uid") or uid or "").strip() or uid
        user = await db.users.find_one({"uid": kyc_gate_uid}, {"_id": 0, "kyc_status": 1})
        kyc_status = ((user or {}).get("kyc_status") or "unverified").lower()
        if kyc_status != "approved":
            return "pending_kyc"

    # Min-notional filter — never credit dust. For non-USDT assets we only
    # filter when a price lookup is available; otherwise we err on the
    # side of crediting (rare in practice because trading provides prices).
    if amount <= 0:
        return "below_min"
    notional_usdt = amount
    if asset != "USDT":
        px = None
        if price_lookup is not None:
            try:
                px = float(price_lookup(asset) or 0.0)
            except Exception:  # noqa: BLE001
                px = None
        if px and px > 0:
            notional_usdt = amount * px
        else:
            notional_usdt = None  # unknown — skip min-notional gate
    if notional_usdt is not None and notional_usdt < float(min_notional_usdt or 0.0):
        return "below_min"

    # ---- Reserve the row so nobody else credits it at the same time. ----
    before = await _reserve_event(db, event_id)
    if before is None:
        # Already consumed by another worker / admin override. Nothing to do.
        return (ev.get("status") or "pending")

    prev_status = (before.get("status") or "pending").lower()

    try:
        txn = await wallet_service.credit(
            uid, asset, amount,
            txn_type="deposit",
            ref_type="deposit_event",
            ref_id=event_id,
            meta={
                "tx_hash": tx_hash,
                "network": ev.get("network"),
                "address": ev.get("address"),
                "confirmations": confirmations,
                "block_height": ev.get("block_height"),
                "threshold": threshold,
                "source": ev.get("source"),
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "deposit_crediter: wallet credit failed for event=%s uid=%s asset=%s",
            event_id, uid, asset,
        )
        await _release_event(db, event_id, new_status=prev_status)
        return prev_status

    try:
        await treasury_service.record_custody_deposit(
            asset,
            amount,
            ref_type="deposit_event",
            ref_id=event_id,
            meta={"uid": uid, "tx_hash": tx_hash},
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "deposit_crediter: treasury custody mirror failed for event=%s asset=%s",
            event_id, asset,
        )

    await _release_event(
        db, event_id,
        new_status="credited",
        extra={
            "credited_at": _now_iso(),
            "credited_amount": amount,
            "credited_block_height": ev.get("block_height"),
            "wallet_txn_id": txn.get("id") if isinstance(txn, dict) else None,
            "threshold": threshold,
        },
    )
    logger.info(
        "deposit_crediter: credited event=%s uid=%s asset=%s amount=%s conf=%d/%d",
        event_id, uid, asset, amount, confirmations, threshold,
    )
    if asset == "IBO":
        try:
            from ibo.pricing import refresh_deposit_driven_ibo_price

            await refresh_deposit_driven_ibo_price(controls=controls)
        except Exception:  # noqa: BLE001
            logger.exception("deposit_crediter: IBO deposit-driven price refresh failed")
    return "credited"


async def _tick(
    db,
    *,
    get_platform_controls: Callable[[], Awaitable[Dict[str, Any]]],
    resolve_min_confirmations: Callable[[Dict[str, Any], str], int],
    min_notional_usdt: float,
    price_lookup: Optional[Callable[[str], float]] = None,
) -> Dict[str, int]:
    """One pass over all actionable deposit events."""
    controls = await _get_controls(get_platform_controls)
    if controls is None:
        return {"scanned": 0, "credited": 0, "pending_kyc": 0, "below_min": 0}

    # Master kill-switch — admins can disable auto-crediting without
    # restarting the worker. We still advance ``confirming`` though so
    # the UI keeps its progress counter moving.
    auto_enabled = bool(controls.get("deposit_auto_credit_enabled", False))

    cur = db.deposit_events.find(
        {"status": {"$in": list(_ACTIONABLE_STATUSES)}},
        {"_id": 0, "raw": 0},
    ).sort("created_at", 1).limit(200)
    rows = await cur.to_list(length=200)

    counts = {"scanned": len(rows), "credited": 0, "pending_kyc": 0, "below_min": 0, "confirming": 0, "orphan": 0}
    if not rows:
        return counts

    for ev in rows:
        event_id = ev.get("id")
        if not event_id:
            continue

        prev_status = (ev.get("status") or "pending").lower()

        # When auto-credit is off, we still want to update the "confirming"
        # progress field so the frontend can show 3/12 etc. but we never
        # promote to credited / pending_kyc / below_min.
        if not auto_enabled:
            threshold = resolve_min_confirmations(controls, (ev.get("asset") or "").upper())
            confirmations = int(ev.get("confirmations") or 0)
            desired = "confirming" if confirmations < max(1, threshold) else "pending"
            if prev_status != desired:
                await db.deposit_events.update_one(
                    {"id": event_id, "status": prev_status},
                    {"$set": {"status": desired, "updated_at": _now_iso()}},
                )
            continue

        new_status = await _credit_one(
            db, ev, controls,
            resolve_min_confirmations=resolve_min_confirmations,
            min_notional_usdt=min_notional_usdt,
            price_lookup=price_lookup,
        )
        if new_status in counts:
            counts[new_status] = counts.get(new_status, 0) + 1
        # Persist intermediate statuses (pending_kyc / below_min / confirming)
        # that didn't go through _reserve_event above.
        if new_status in ("pending_kyc", "below_min", "confirming", "orphan") and new_status != prev_status:
            await db.deposit_events.update_one(
                {"id": event_id, "status": {"$in": list(_ACTIONABLE_STATUSES)}},
                {"$set": {"status": new_status, "updated_at": _now_iso()}},
            )

    return counts


async def _run_loop(
    db,
    provider: BlockchainProvider,
    *,
    get_platform_controls: Callable[[], Awaitable[Dict[str, Any]]],
    resolve_min_confirmations: Callable[[Dict[str, Any], str], int],
    min_notional_usdt: float,
    price_lookup: Optional[Callable[[str], float]] = None,
) -> None:
    interval = _interval_sec()
    logger.info(
        "deposit_crediter: started (provider=%s, interval=%.1fs)",
        provider.name, interval,
    )
    while True:
        try:
            stats = await _tick(
                db,
                get_platform_controls=get_platform_controls,
                resolve_min_confirmations=resolve_min_confirmations,
                min_notional_usdt=min_notional_usdt,
                price_lookup=price_lookup,
            )
            if stats.get("scanned"):
                logger.info(
                    "deposit_crediter: tick scanned=%d credited=%d pending_kyc=%d below_min=%d confirming=%d",
                    stats.get("scanned", 0),
                    stats.get("credited", 0),
                    stats.get("pending_kyc", 0),
                    stats.get("below_min", 0),
                    stats.get("confirming", 0),
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("deposit_crediter: tick failed — sleeping before retry")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise


def start(
    db,
    *,
    get_platform_controls: Callable[[], Awaitable[Dict[str, Any]]],
    resolve_min_confirmations: Callable[[Dict[str, Any], str], int],
    min_notional_usdt: float,
    price_lookup: Optional[Callable[[str], float]] = None,
) -> Optional[asyncio.Task]:
    """Start the crediter if enabled. Returns the task (or ``None``)."""
    if not _is_enabled():
        logger.info(
            "deposit_crediter: disabled (set DEPOSIT_CREDIT_ENABLED=true to enable)",
        )
        return None
    provider = blockchain_service.get_provider()
    if isinstance(provider, DisabledProvider):
        logger.info("deposit_crediter: provider disabled — skipping crediter startup")
        return None
    task = asyncio.create_task(
        _run_loop(
            db, provider,
            get_platform_controls=get_platform_controls,
            resolve_min_confirmations=resolve_min_confirmations,
            min_notional_usdt=min_notional_usdt,
            price_lookup=price_lookup,
        ),
        name="ibo-deposit-crediter",
    )
    return task


async def stop(task: Optional[asyncio.Task]) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("deposit_crediter: error while stopping")
