"""On-chain signup bonus — treasury IBO → user deposit address → deposit_events → crediter."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable, Dict, Optional

from listings.wallet_assets import BEP20_NETWORK
from services import blockchain_service, treasury_service
from services.blockchain_service import BlockchainError, ProviderUnavailable

logger = logging.getLogger(__name__)

COL_EVENTS = "deposit_events"
SOURCE = "signup_bonus"
IBO_ASSET = "IBO"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_bep20_addr(address: str) -> str:
    return (address or "").strip().lower()


async def _existing_signup_bonus_event(db, uid: str) -> Optional[Dict[str, Any]]:
    """Return an existing signup bonus event that has been dispatched on-chain (has a tx_hash).

    Placeholder rows (no tx_hash, created before the broadcast) are excluded
    so that a failed dispatch can be retried without being blocked.
    """
    return await db[COL_EVENTS].find_one(
        {"uid": uid, "source": SOURCE, "tx_hash": {"$exists": True, "$ne": ""}},
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def dispatch_on_chain_signup_bonus(
    db,
    uid: str,
    amount_ibo: float,
    *,
    get_or_create_address: Callable[..., Awaitable[Optional[Dict[str, Any]]]],
) -> Dict[str, Any]:
    """Broadcast IBO from treasury to the user's BEP-20 address and seed deposit_events.

    A placeholder ``deposit_events`` row is created *immediately* (before the
    on-chain send) so the admin panel and user wallet history show the pending
    bonus right away — even before the IBO transaction is mined.  The row is
    then updated with the real ``tx_hash`` once the broadcast succeeds.
    """
    amount = float(amount_ibo or 0)
    if amount <= 0:
        return {"ok": True, "skipped": True, "reason": "zero_amount"}

    if await _existing_signup_bonus_event(db, uid):
        return {"ok": True, "skipped": True, "reason": "already_dispatched"}

    addr_doc = await get_or_create_address(
        uid, IBO_ASSET, BEP20_NETWORK, created_by="signup_bonus",
    )
    to_raw = (addr_doc or {}).get("address") or ""
    if not to_raw.strip():
        logger.error("signup_bonus: no IBO deposit address for uid=%s", uid)
        return {"ok": False, "error": "no_deposit_address"}

    to_addr = _norm_bep20_addr(to_raw)
    now = _now_iso()

    # ── Step 1: create placeholder deposit_events row immediately so the
    #   admin panel / user history show the pending bonus without delay.
    placeholder_id = f"sbp_{uuid.uuid4().hex[:16]}"
    try:
        await db[COL_EVENTS].update_one(
            # Key: uid + source ensures exactly one pending-bonus row per user
            {"uid": uid, "source": SOURCE, "status": "pending", "tx_hash": {"$exists": False}},
            {
                "$setOnInsert": {
                    "id": placeholder_id,
                    "asset": IBO_ASSET,
                    "network": BEP20_NETWORK,
                    "address": to_addr,
                    "confirmations": 0,
                    "created_at": now,
                    "first_seen_at": now,
                },
                "$set": {
                    "uid": uid,
                    "source": SOURCE,
                    "status": "pending",
                    "amount": amount,
                    "updated_at": now,
                    "last_seen_at": now,
                },
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        logger.warning("signup_bonus: placeholder deposit_events row failed uid=%s", uid, exc_info=True)

    async def _cleanup_placeholder() -> None:
        """Remove the placeholder row so future retries are not blocked."""
        try:
            await db[COL_EVENTS].delete_one({"id": placeholder_id})
        except Exception:  # noqa: BLE001
            logger.debug("signup_bonus: placeholder cleanup on failure skipped uid=%s", uid, exc_info=True)

    # ── Step 2: broadcast the on-chain transfer
    provider = blockchain_service.get_provider()
    try:
        result = await provider.send_ibo_signup_bonus(to_raw.strip(), amount)
    except (ProviderUnavailable, BlockchainError) as exc:
        logger.error("signup_bonus: broadcast failed uid=%s: %s", uid, exc)
        await _cleanup_placeholder()
        return {"ok": False, "error": str(exc)}
    except Exception:  # noqa: BLE001
        logger.exception("signup_bonus: unexpected broadcast error uid=%s", uid)
        await _cleanup_placeholder()
        return {"ok": False, "error": "broadcast_failed"}

    tx_hash = (result.tx_hash or "").strip()
    if not tx_hash:
        await _cleanup_placeholder()
        return {"ok": False, "error": "missing_tx_hash"}

    now = _now_iso()

    # ── Step 3: record treasury outflow
    try:
        await treasury_service.record_custody_withdrawal(
            IBO_ASSET,
            amount,
            ref_type=SOURCE,
            ref_id=uid,
            meta={
                "tx_hash": tx_hash,
                "to": to_addr,
                "wallet_role": (result.raw or {}).get("wallet_role", "cold"),
                "from": (result.from_address or "").lower(),
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("signup_bonus: treasury custody withdrawal mirror failed uid=%s", uid)

    # ── Step 4: upgrade placeholder row to a real deposit_events row (with tx_hash).
    #   Upsert on the canonical key (asset, network, tx_hash, address) so the
    #   deposit crediter and poller can find it normally.  uid is put in BOTH
    #   $setOnInsert AND $set so it is always present even if the deposit poller
    #   created the row first without an owner.
    #
    #   confirmations is placed in $setOnInsert (NOT $set) — if the deposit poller
    #   already observed this tx and recorded a real confirmation count we must
    #   not reset it to 0.  We seed 1 for new rows because we broadcast the tx
    #   ourselves from treasury and know it will be mined; this prevents the event
    #   from being permanently stuck in "confirming" when the poller hasn't yet
    #   re-scanned the address.
    event_id = f"dev_{uuid.uuid4().hex[:16]}"
    key = {
        "asset": IBO_ASSET,
        "network": BEP20_NETWORK,
        "tx_hash": tx_hash,
        "address": to_addr,
    }
    await db[COL_EVENTS].update_one(
        key,
        {
            "$setOnInsert": {
                "id": event_id,
                "created_at": now,
                "first_seen_at": now,
                "status": "pending",
                # Seed ≥1 so the crediter doesn't immediately stall on the
                # confirmation threshold.  Real value arrives on next poller scan.
                "confirmations": 1,
            },
            "$set": {
                # uid and source in $set — survives even if poller created the row first
                "uid": uid,
                "source": SOURCE,
                "amount": amount,
                "updated_at": now,
                "last_seen_at": now,
            },
        },
        upsert=True,
    )

    # ── Step 5: remove the no-tx_hash placeholder (now superseded by the real row)
    try:
        await db[COL_EVENTS].delete_one({"id": placeholder_id})
    except Exception:  # noqa: BLE001
        logger.debug("signup_bonus: placeholder cleanup skipped uid=%s", uid, exc_info=True)

    try:
        from workers import deposit_poller

        await deposit_poller._load_active_addresses(db, force=True)  # noqa: SLF001
    except Exception:  # noqa: BLE001
        logger.debug("signup_bonus: address cache refresh skipped", exc_info=True)

    logger.info(
        "signup_bonus: dispatched uid=%s amount=%s IBO tx=%s to=%s",
        uid, amount, tx_hash[:18], to_addr[:12],
    )
    return {"ok": True, "tx_hash": tx_hash, "event_id": event_id, "amount_ibo": amount}


async def credit_signup_bonus_on_kyc_approval(db, uid: str) -> Dict[str, Any]:
    """Immediately credit any pending signup-bonus deposit events when KYC is approved.

    Called from every KYC-approval code path so the user receives their IBO
    bonus the moment compliance clears them — without waiting for the next
    deposit-crediter tick (≤15 s) and without blocking on blockchain
    confirmation counts for a tx we issued ourselves.

    Returns a summary dict for logging / audit.
    """
    from services import wallet_service

    actionable_statuses = ("pending", "confirming", "pending_kyc")
    events = await db[COL_EVENTS].find(
        {"uid": uid, "source": SOURCE, "status": {"$in": list(actionable_statuses)}},
        {"_id": 0, "raw": 0},
    ).sort("created_at", 1).to_list(length=20)

    credited = 0
    skipped = 0
    for ev in events:
        event_id = ev.get("id") or ""
        amount = float(ev.get("amount") or 0)
        tx_hash = ev.get("tx_hash") or ""
        asset = (ev.get("asset") or IBO_ASSET).upper()

        if not event_id or amount <= 0:
            skipped += 1
            continue

        # Atomically reserve the event (same lock as deposit_crediter uses).
        from pymongo import ReturnDocument
        now_ts = _now_iso()
        before = await db[COL_EVENTS].find_one_and_update(
            {"id": event_id, "status": {"$in": list(actionable_statuses)}},
            {"$set": {"status": "crediting", "crediting_started_at": now_ts}},
            return_document=ReturnDocument.BEFORE,
        )
        if before is None:
            # Already grabbed by another worker or admin override.
            skipped += 1
            continue

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
                    "confirmations": ev.get("confirmations"),
                    "source": SOURCE,
                    "credited_by": "kyc_approval",
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "signup_bonus: kyc-approval credit failed event=%s uid=%s asset=%s amount=%s",
                event_id, uid, asset, amount,
            )
            # Release the lock back to its previous state.
            await db[COL_EVENTS].update_one(
                {"id": event_id, "status": "crediting"},
                {"$set": {"status": prev_status, "updated_at": _now_iso()}},
            )
            skipped += 1
            continue

        await db[COL_EVENTS].update_one(
            {"id": event_id, "status": "crediting"},
            {"$set": {
                "status": "credited",
                "credited_at": _now_iso(),
                "credited_amount": amount,
                "wallet_txn_id": txn.get("id") if isinstance(txn, dict) else None,
                "credited_by": "kyc_approval",
                "updated_at": _now_iso(),
            }},
        )
        credited += 1
        logger.info(
            "signup_bonus: kyc-approval credited event=%s uid=%s asset=%s amount=%s",
            event_id, uid, asset, amount,
        )

    return {"credited": credited, "skipped": skipped, "total": len(events)}


def _recent_signup(created_at_raw: Any, *, hours: float = 72.0) -> bool:
    if not created_at_raw:
        return False
    try:
        text = str(created_at_raw).strip()
        if not text:
            return False
        created = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1.0, float(hours)))
    return created >= cutoff


async def signup_bonus_pending_prompt(
    db,
    uid: str,
    *,
    kyc_status: str,
    configured_bonus_ibo: float = 0.0,
) -> Dict[str, Any]:
    """KYC nudge when signup bonus is on-chain (or pending dispatch for new signups)."""
    if (kyc_status or "").lower() == "approved":
        return {"show_prompt": False}

    ev = await db[COL_EVENTS].find_one(
        {
            "uid": uid,
            "source": SOURCE,
            "status": {"$in": ["pending", "confirming", "pending_kyc"]},
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if ev:
        amount = float(ev.get("amount") or 0)
        status = (ev.get("status") or "pending").lower()
        confirming = (
            "Your on-chain IBO transfer is being confirmed. "
            if status in ("pending", "confirming") else ""
        )
        return {
            "show_prompt": True,
            "amount_ibo": amount,
            "status": status,
            "tx_hash": ev.get("tx_hash"),
            "network": ev.get("network"),
            "title": f"{amount:g} IBO is waiting for you",
            "message": (
                f"{confirming}"
                "Complete identity verification (KYC) to receive it in your trading wallet."
            ),
        }

    amount_cfg = float(configured_bonus_ibo or 0)
    if amount_cfg <= 0:
        return {"show_prompt": False}

    prior = await _existing_signup_bonus_event(db, uid)
    if prior:
        return {"show_prompt": False}

    user = await db.users.find_one({"uid": uid}, {"_id": 0, "created_at": 1})
    if not user or not _recent_signup(user.get("created_at")):
        return {"show_prompt": False}

    return {
        "show_prompt": True,
        "amount_ibo": amount_cfg,
        "status": "pending",
        "title": f"{amount_cfg:g} IBO is waiting for you",
        "message": (
            "Complete identity verification (KYC) to receive it in your trading wallet."
        ),
    }
