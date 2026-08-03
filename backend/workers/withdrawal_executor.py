"""Phase 6 — withdrawal executor.

Two logical phases, one background loop:

1. **Broadcast**: pull ``withdrawal_requests`` rows where ``status='approved'``,
   atomically reserve them as ``broadcasting`` (so a restart mid-tx can't
   double-send), call :meth:`BlockchainProvider.send_transaction`, record
   the returned ``tx_hash``, and flip status to ``broadcasted``.

2. **Confirm**: pull ``status='broadcasted'`` rows, fetch the on-chain
   receipt via :meth:`BlockchainProvider.get_transaction_receipt`, and
   when confirmations clear the asset's threshold debit the user's
   ``locked`` balance via :func:`services.wallet_service.debit_locked`
   (and the platform fee as a separate ledger row) to flip the request
   to ``confirmed``. Failed receipts (EVM revert) refund the lock.

Safety:

- Opt-in via ``WITHDRAWAL_EXEC_ENABLED=true``. Silently no-ops with a
  disabled provider.
- No broadcast can happen twice for the same request: the atomic
  ``find_one_and_update`` on ``status`` is the lock.
- Every balance mutation goes through ``wallet_service`` so
  ``wallet_txns`` stays authoritative. No direct ``$inc`` on ``wallets``.
- Broadcast RPC failures flip the row back to ``approved`` (retryable).
  A receipt with EVM status=0 flips to ``failed`` and **refunds the
  lock** — the funds never actually left the chain-side of the house.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from pymongo import ReturnDocument

from services import blockchain_service, wallet_service
from services import treasury_service, treasury_wallets_registry as tw_registry
from services.blockchain_service import (
    BlockchainError,
    BlockchainProvider,
    BroadcastResult,
    DisabledProvider,
    ReceiptStatus,
    UnsupportedAssetNetwork,
)

logger = logging.getLogger(__name__)


def _is_enabled() -> bool:
    val = (os.getenv("WITHDRAWAL_EXEC_ENABLED") or "").strip().lower()
    return val in ("1", "true", "yes", "on")


def _interval_sec() -> float:
    try:
        return max(5.0, float(os.getenv("WITHDRAWAL_EXEC_INTERVAL_SEC") or "20"))
    except ValueError:
        return 20.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Broadcast phase ─────────────────────────────────────────────────────────
async def _broadcast_one(
    db,
    provider: BlockchainProvider,
    request: Dict[str, Any],
    *,
    refund_quota: Callable[[str, float, Optional[str]], Awaitable[None]],
    usdt_notional: Callable[[str, float], float],
) -> None:
    """Broadcast a single approved withdrawal. Never raises.

    Writes either:
      - ``status=broadcasted`` with ``tx_hash``, OR
      - ``status=approved`` (retryable RPC error), OR
      - ``status=failed`` (non-retryable — broadcast rejected by chain),
        after refunding the user's lock + quota.
    """
    wd_id = request.get("id") or ""
    uid = request.get("uid") or ""
    asset = (request.get("asset") or "").upper()
    network = request.get("network") or ""
    address = request.get("address") or ""
    amount = float(request.get("amount") or 0.0)

    if not (wd_id and uid and asset and address and amount > 0):
        logger.warning("withdrawal_executor: malformed row skipped (id=%s)", wd_id)
        return

    try:
        result: BroadcastResult = await provider.send_transaction(
            asset, address, amount, network=network,
        )
    except UnsupportedAssetNetwork as exc:
        # This is terminal — the operator enabled an asset the provider can't
        # actually broadcast. Refund and mark failed so the user isn't stuck.
        logger.error(
            "withdrawal_executor: unsupported asset/network for %s: %s — refunding",
            wd_id, exc,
        )
        await _fail_and_refund(
            db, wd_id, reason=str(exc),
            refund_quota=refund_quota, usdt_notional=usdt_notional,
        )
        return
    except BlockchainError as exc:
        # Transient — bump back to ``approved`` so the next tick retries.
        logger.warning(
            "withdrawal_executor: broadcast failed (id=%s): %s — will retry",
            wd_id, exc,
        )
        await db.withdrawal_requests.update_one(
            {"id": wd_id, "status": "broadcasting"},
            {"$set": {
                "status": "approved",
                "last_broadcast_error": str(exc),
                "last_broadcast_error_at": _now_iso(),
                "updated_at": _now_iso(),
            },
             "$inc": {"broadcast_attempts": 1}},
        )
        return
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "withdrawal_executor: unexpected broadcast error (id=%s)", wd_id,
        )
        await db.withdrawal_requests.update_one(
            {"id": wd_id, "status": "broadcasting"},
            {"$set": {
                "status": "approved",
                "last_broadcast_error": f"unexpected: {exc}",
                "last_broadcast_error_at": _now_iso(),
                "updated_at": _now_iso(),
            },
             "$inc": {"broadcast_attempts": 1}},
        )
        return

    # Happy path: commit the tx_hash.
    await db.withdrawal_requests.update_one(
        {"id": wd_id, "status": "broadcasting"},
        {"$set": {
            "status": "broadcasted",
            "tx_hash": result.tx_hash,
            "from_address": result.from_address,
            "to_address": result.to_address,
            "broadcasted_at": _now_iso(),
            "broadcast_raw": result.raw or {},
            "updated_at": _now_iso(),
        },
         "$inc": {"broadcast_attempts": 1}},
    )
    logger.info(
        "withdrawal_executor: broadcast id=%s asset=%s amount=%s tx=%s",
        wd_id, asset, amount, result.tx_hash,
    )


async def _fail_and_refund(
    db,
    wd_id: str,
    *,
    reason: str,
    refund_quota: Callable[[str, float, Optional[str]], Awaitable[None]],
    usdt_notional: Callable[[str, float], float],
) -> None:
    """Mark a request ``failed`` and refund the lock + quota. Idempotent."""
    before = await db.withdrawal_requests.find_one_and_update(
        {"id": wd_id, "status": {"$in": ["broadcasting", "approved", "broadcasted"]}},
        {"$set": {
            "status": "failed",
            "failure_reason": reason,
            "failed_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
        return_document=ReturnDocument.BEFORE,
    )
    if before is None:
        return

    uid = before.get("uid")
    asset = before.get("asset")
    total_charge = float(before.get("total_charge") or 0.0)
    if uid and asset and total_charge > 0:
        try:
            await wallet_service.unlock(
                uid, asset, total_charge,
                ref_type="withdrawal", ref_id=wd_id,
                meta={"phase": "withdrawal_failed_refund", "reason": reason},
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "withdrawal_executor: lock refund failed on terminal failure (%s) — flagging reconcile",
                wd_id,
            )
            await db.withdrawal_requests.update_one(
                {"id": wd_id},
                {"$set": {"reconcile_required": True, "updated_at": _now_iso()}},
            )

    # Refund IBO fees: credit if charged at submit, else unlock (legacy lock model).
    fee_asset = (before.get("fee_asset") or "").upper()
    ibo_platform_fee = (
        float(before.get("fee_amount") or 0.0)
        if fee_asset == "IBO" or before.get("ibo_fees_settled")
        else 0.0
    )
    ibo_gas_fee = float(before.get("ibo_gas_fee") or 0.0)
    settled = bool(before.get("ibo_fees_settled"))
    for amount, fee_kind in ((ibo_platform_fee, "platform"), (ibo_gas_fee, "gas")):
        if not uid or amount <= 0:
            continue
        meta = {
            "phase": f"withdrawal_failed_ibo_{fee_kind}_refund",
            "reason": reason,
            "fee_kind": fee_kind,
        }
        try:
            if settled:
                await wallet_service.credit(
                    uid, "IBO", amount,
                    txn_type="adjustment",
                    ref_type="withdrawal", ref_id=wd_id,
                    meta=meta,
                )
            else:
                await wallet_service.unlock(
                    uid, "IBO", amount,
                    ref_type="withdrawal", ref_id=wd_id,
                    meta=meta,
                )
        except Exception:  # noqa: BLE001
            logger.exception(
                "withdrawal_executor: IBO %s fee refund failed on terminal failure (%s)",
                fee_kind, wd_id,
            )
    try:
        fee_usdt = float(before.get("fee_usdt") or 0.0)
        notional = usdt_notional(asset or "", total_charge) + fee_usdt
        # ``_refund_withdrawal_quota`` declares ``day`` as keyword-only, so we
        # must hand it over by name (TypeError otherwise).
        await refund_quota(uid, notional, day=before.get("day_key"))
    except Exception:  # noqa: BLE001
        logger.exception("withdrawal_executor: quota refund failed (%s)", wd_id)


# ── Confirm phase ───────────────────────────────────────────────────────────
async def _confirm_one(
    db,
    provider: BlockchainProvider,
    request: Dict[str, Any],
    *,
    resolve_min_confirmations: Callable[[Dict[str, Any], str], int],
    controls: Dict[str, Any],
    refund_quota: Callable[[str, float, Optional[str]], Awaitable[None]],
    usdt_notional: Callable[[str, float], float],
) -> None:
    wd_id = request.get("id") or ""
    asset = (request.get("asset") or "").upper()
    tx_hash = request.get("tx_hash") or ""
    network = request.get("network") or ""
    if not wd_id or not asset or not tx_hash:
        return

    try:
        receipt: ReceiptStatus = await provider.get_transaction_receipt(
            asset, tx_hash, network=network,
        )
    except Exception:  # noqa: BLE001
        logger.exception("withdrawal_executor: receipt poll failed for %s", wd_id)
        return

    # Track the latest confirmation count for UX — safe to overwrite even
    # when the tx isn't mined yet (conf=0).
    await db.withdrawal_requests.update_one(
        {"id": wd_id, "status": "broadcasted"},
        {"$set": {
            "confirmations": int(receipt.confirmations or 0),
            "block_height": receipt.block_height,
            "updated_at": _now_iso(),
        }},
    )

    if receipt.state == "pending":
        return

    if receipt.state == "failed":
        # EVM reverted the tx. Refund the user — their funds never actually
        # moved on-chain beyond the gas the treasury ate.
        await _fail_and_refund(
            db, wd_id,
            reason="on-chain execution reverted",
            refund_quota=refund_quota, usdt_notional=usdt_notional,
        )
        logger.warning("withdrawal_executor: tx reverted for %s (tx=%s)", wd_id, tx_hash)
        return

    # mined — check confirmation threshold.
    threshold = resolve_min_confirmations(controls, asset)
    if int(receipt.confirmations or 0) < max(1, threshold):
        return

    # Threshold met — commit the debit.
    await _commit_confirmed(db, wd_id, receipt)


async def _commit_confirmed(db, wd_id: str, receipt: ReceiptStatus) -> None:
    """Move a request ``broadcasted → confirmed`` and debit locked balance.

    Atomic reservation via ``status`` filter so a restart mid-commit
    can't double-debit.
    """
    row = await db.withdrawal_requests.find_one_and_update(
        {"id": wd_id, "status": "broadcasted"},
        {"$set": {
            "status": "confirming",
            "updated_at": _now_iso(),
        }},
        return_document=ReturnDocument.BEFORE,
    )
    if row is None:
        return  # already consumed by another worker / admin

    uid = row.get("uid")
    asset = (row.get("asset") or "").upper()
    amount = float(row.get("amount") or 0.0)
    fee_amount = float(row.get("fee_amount") or 0.0)
    fee_asset = (row.get("fee_asset") or "").upper()
    ibo_gas_fee = float(row.get("ibo_gas_fee") or 0.0)

    try:
        # 1) Debit the on-chain amount from locked.
        if amount > 0:
            await wallet_service.debit_locked(
                uid, asset, amount,
                txn_type="withdraw",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "withdrawal_confirmed",
                    "tx_hash": row.get("tx_hash"),
                    "block_height": receipt.block_height,
                    "confirmations": int(receipt.confirmations or 0),
                },
            )
            try:
                await treasury_service.record_custody_withdrawal(
                    asset,
                    amount,
                    ref_type="withdrawal",
                    ref_id=wd_id,
                    meta={"uid": uid, "tx_hash": row.get("tx_hash")},
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "withdrawal_executor: treasury custody mirror failed for %s asset=%s",
                    wd_id, asset,
                )
        # 2) Platform fee — only for legacy rows that locked fees until confirm.
        # New withdrawals charge IBO fees at submit (``ibo_fees_settled``).
        if fee_amount > 0 and not row.get("ibo_fees_settled"):
            fee_debit_asset = "IBO" if fee_asset == "IBO" else asset
            await wallet_service.debit_locked(
                uid, fee_debit_asset, fee_amount,
                txn_type="fee",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": (
                        "withdrawal_ibo_platform_fee"
                        if fee_asset == "IBO"
                        else "withdrawal_fee"
                    ),
                    "tx_hash": row.get("tx_hash"),
                    "fee_rate": row.get("fee_rate"),
                    "fee_usdt": row.get("fee_usdt"),
                    "fee_asset": fee_debit_asset,
                },
            )
        # 3) Debit IBO gas fee — legacy lock model only.
        if ibo_gas_fee > 0 and not row.get("ibo_fees_settled"):
            await wallet_service.debit_locked(
                uid, "IBO", ibo_gas_fee,
                txn_type="fee",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "withdrawal_ibo_gas_fee",
                    "tx_hash": row.get("tx_hash"),
                    "fee_asset": "IBO",
                },
            )
    except Exception:  # noqa: BLE001
        logger.exception(
            "withdrawal_executor: confirmed-debit failed for %s — marking reconcile",
            wd_id,
        )
        await db.withdrawal_requests.update_one(
            {"id": wd_id, "status": "confirming"},
            {"$set": {
                "status": "broadcasted",
                "reconcile_required": True,
                "updated_at": _now_iso(),
            }},
        )
        return

    await db.withdrawal_requests.update_one(
        {"id": wd_id, "status": "confirming"},
        {"$set": {
            "status": "confirmed",
            "confirmed_at": _now_iso(),
            "confirmations": int(receipt.confirmations or 0),
            "block_height": receipt.block_height,
            "gas_used": receipt.gas_used,
            "effective_gas_price": receipt.effective_gas_price,
            "updated_at": _now_iso(),
        }},
    )
    logger.info(
        "withdrawal_executor: confirmed id=%s uid=%s asset=%s amount=%s tx=%s",
        wd_id, uid, asset, amount, row.get("tx_hash"),
    )


# ── Main loop ───────────────────────────────────────────────────────────────
async def _load_batch(db, status: str, limit: int = 50) -> List[Dict[str, Any]]:
    cur = (
        db.withdrawal_requests.find(
            {
                "status": status,
                # Platform-retained settlements never go on-chain.
                "skip_broadcast": {"$ne": True},
            },
            {"_id": 0, "broadcast_raw": 0},
        ).sort("created_at", 1).limit(limit)
    )
    return await cur.to_list(length=limit)


async def _tick(
    db,
    provider: BlockchainProvider,
    *,
    get_platform_controls: Callable[[], Awaitable[Dict[str, Any]]],
    resolve_min_confirmations: Callable[[Dict[str, Any], str], int],
    refund_quota: Callable[[str, float, Optional[str]], Awaitable[None]],
    usdt_notional: Callable[[str, float], float],
) -> Dict[str, int]:
    try:
        controls = await get_platform_controls()
    except Exception:  # noqa: BLE001
        logger.exception("withdrawal_executor: failed to read platform_controls")
        return {"approved": 0, "broadcasted": 0}

    if not controls.get("withdrawal_auto_execute_enabled", False):
        # Worker is attached but admin has the master kill-switch off.
        # Nothing to do — admin still has manual ``/reject`` available.
        return {"approved": 0, "broadcasted": 0}

    # Phase 2 — unblock withdrawals once hot omnibus is configured.
    try:
        promoted = await tw_registry.promote_awaiting_treasury_to_approved(
            db, context="withdrawal_executor_tick",
        )
        if promoted:
            logger.info("withdrawal_executor: promoted %s row(s) awaiting_treasury → approved", promoted)
    except Exception:  # noqa: BLE001
        logger.exception("withdrawal_executor: promote_awaiting_treasury_to_approved failed")

    # Phase 1: broadcast
    approved_rows = await _load_batch(db, "approved")
    for row in approved_rows:
        wd_id = row.get("id") or ""
        asset = (row.get("asset") or "").upper()
        network = row.get("network") or ""
        if tw_registry.treasury_gate_applies(asset, network):
            if not await tw_registry.has_enabled_hot_payout_wallet(db, asset, network):
                reason = await tw_registry.treasury_gate_block_reason(db, asset, network) or "no_hot_wallet"
                await tw_registry.withdrawal_demote_approved_to_awaiting_treasury(
                    db,
                    withdrawal_id=wd_id,
                    reason_code=reason,
                    actor="withdrawal_executor",
                    entry_source="withdrawal_executor_demote",
                    meta={"asset": asset, "network": network},
                )
                logger.warning(
                    "withdrawal_executor: id=%s moved approved → awaiting_treasury (reason=%s)",
                    wd_id,
                    reason,
                )
                continue
        claimed = await db.withdrawal_requests.find_one_and_update(
            {"id": wd_id, "status": "approved"},
            {"$set": {
                "status": "broadcasting",
                "broadcasting_started_at": _now_iso(),
                "updated_at": _now_iso(),
            }},
            return_document=ReturnDocument.AFTER,
        )
        if claimed is None:
            continue
        await _broadcast_one(
            db, provider, claimed,
            refund_quota=refund_quota,
            usdt_notional=usdt_notional,
        )

    # Phase 2: confirm
    broadcasted_rows = await _load_batch(db, "broadcasted")
    for row in broadcasted_rows:
        await _confirm_one(
            db, provider, row,
            resolve_min_confirmations=resolve_min_confirmations,
            controls=controls,
            refund_quota=refund_quota,
            usdt_notional=usdt_notional,
        )

    return {"approved": len(approved_rows), "broadcasted": len(broadcasted_rows)}


async def _run_loop(
    db,
    provider: BlockchainProvider,
    *,
    get_platform_controls,
    resolve_min_confirmations,
    refund_quota,
    usdt_notional,
) -> None:
    interval = _interval_sec()
    logger.info(
        "withdrawal_executor: started (provider=%s, interval=%.1fs)",
        provider.name, interval,
    )
    while True:
        try:
            stats = await _tick(
                db, provider,
                get_platform_controls=get_platform_controls,
                resolve_min_confirmations=resolve_min_confirmations,
                refund_quota=refund_quota,
                usdt_notional=usdt_notional,
            )
            if stats.get("approved") or stats.get("broadcasted"):
                logger.info(
                    "withdrawal_executor: tick approved=%d broadcasted=%d",
                    stats.get("approved", 0), stats.get("broadcasted", 0),
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("withdrawal_executor: tick failed — sleeping before retry")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise


def start(
    db,
    *,
    get_platform_controls,
    resolve_min_confirmations,
    refund_quota,
    usdt_notional,
) -> Optional[asyncio.Task]:
    """Start the executor if enabled + provider is configured."""
    if not _is_enabled():
        logger.info(
            "withdrawal_executor: disabled (set WITHDRAWAL_EXEC_ENABLED=true to enable)",
        )
        return None
    provider = blockchain_service.get_provider()
    if isinstance(provider, DisabledProvider):
        logger.info("withdrawal_executor: provider disabled — skipping executor startup")
        return None
    task = asyncio.create_task(
        _run_loop(
            db, provider,
            get_platform_controls=get_platform_controls,
            resolve_min_confirmations=resolve_min_confirmations,
            refund_quota=refund_quota,
            usdt_notional=usdt_notional,
        ),
        name="ibo-withdrawal-executor",
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
        logger.exception("withdrawal_executor: error while stopping")
