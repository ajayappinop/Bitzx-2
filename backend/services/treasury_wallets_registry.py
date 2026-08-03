"""Phase 1 — Hot/cold omnibus watch addresses (no private keys).

v1 scope: BTC on Bitcoin Network; ETH and USDT on ERC-20 (Ethereum).
Ledger remains source of truth; this registry is configuration + audit only.

Phase 2 guardrails: enabled hot omnibus address must match the on-chain
treasury signer from :meth:`BlockchainProvider.treasury_address` so payouts
cannot target a watch-only address that signing will never use.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from services import alert_service, blockchain_service
from services.blockchain_service import BlockchainError

logger = logging.getLogger(__name__)

# Canonical (asset, network) pairs for treasury omnibus rows (Phase 1 + IBO).
TREASURY_WALLET_V1_ASSET_NETWORKS: Tuple[Tuple[str, str], ...] = (
    ("BTC", "Bitcoin Network"),
    ("ETH", "ERC-20 (Ethereum)"),
    ("USDT", "ERC-20 (Ethereum)"),
    ("USDT", "BEP-20 (BNB Chain)"),
    ("BNB", "BEP-20 (BNB Chain)"),
    ("USDT", "TRC-20 (Tron)"),
    ("TRX", "TRC-20 (Tron)"),
    ("IBO", "BEP-20 (BNB Chain)"),
)

_ALLOWED_SET = frozenset(TREASURY_WALLET_V1_ASSET_NETWORKS)


def treasury_gate_applies(asset: Optional[str], network: Optional[str]) -> bool:
    """True when Phase 2 hot-wallet gate applies (v1 BTC / ETH-USDT ERC-20 pairs)."""
    return is_allowed_v1(asset or "", network or "")


def is_allowed_v1(asset: str, network: str) -> bool:
    a = (asset or "").strip().upper()
    n = (network or "").strip()
    return (a, n) in _ALLOWED_SET


def canonicalize_address(asset: str, address: str, network: Optional[str] = None) -> str:
    """Return checksummed / validated address; raises ValueError on invalid."""
    try:
        return blockchain_service.validate_address(asset, address, network)
    except BlockchainError as exc:
        raise ValueError(str(exc)) from exc


def _addresses_equal_for_asset(asset: str, left: str, right: str) -> bool:
    """Compare two on-chain addresses for equality (asset-aware)."""
    a = (asset or "").strip().upper()
    la = (left or "").strip()
    ra = (right or "").strip()
    if a in ("ETH", "USDT", "IBO", "BNB"):
        return la.lower() == ra.lower()
    if a in ("TRX",):
        return la == ra
    return la == ra


def _treasury_signer_address(asset: str) -> Optional[str]:
    prov = blockchain_service.get_provider()
    return prov.treasury_address((asset or "").strip().upper())


def _treasury_cold_signer_address() -> Optional[str]:
    prov = blockchain_service.get_provider()
    fn = getattr(prov, "treasury_cold_address", None)
    return fn() if callable(fn) else None


def treasury_cold_signer_address() -> Optional[str]:
    """On-chain cold treasury signer (IBO signup bonus on BSC)."""
    return _treasury_cold_signer_address()


def treasury_signer_for_asset(asset: str) -> Optional[str]:
    """Configured on-chain treasury signer for ``asset`` (used by hot gate + sweeps)."""
    return _treasury_signer_address(asset)


def validate_wallet_row(
    *,
    role: str,
    asset: str,
    network: str,
    address: str,
    label: Optional[str],
) -> Dict[str, Any]:
    """Return normalised fields or raise ValueError."""
    r = (role or "").strip().lower()
    if r not in ("hot", "cold"):
        raise ValueError("role must be 'hot' or 'cold'")
    a = (asset or "").strip().upper()
    n = (network or "").strip()
    if not is_allowed_v1(a, n):
        raise ValueError(
            f"Unsupported asset/network for Phase 1 treasury wallet: {a!r} / {n!r}. "
            f"Allowed: {', '.join(f'{x[0]}/{x[1]}' for x in TREASURY_WALLET_V1_ASSET_NETWORKS)}",
        )
    addr = canonicalize_address(a, address, n)
    if r == "hot":
        if n == "TRC-20 (Tron)":
            prov = blockchain_service.get_provider()
            signer_fn = getattr(prov, "treasury_tron_address", None)
            signer = signer_fn() if callable(signer_fn) else None
        else:
            signer = treasury_signer_for_asset(a)
        if signer is None:
            raise ValueError(
                f"Cannot register hot omnibus for {a}: treasury on-chain signer is not configured "
                f"(provider has no signing address for this asset).",
            )
        if not _addresses_equal_for_asset(a, addr, signer):
            raise ValueError(
                f"Hot omnibus address must exactly match the configured treasury signer for {a}; "
                f"signer={signer!r}, given={addr!r}.",
            )
    elif r == "cold" and a == "IBO":
        cold_signer = treasury_cold_signer_address()
        if cold_signer and not _addresses_equal_for_asset(a, addr, cold_signer):
            raise ValueError(
                f"Cold omnibus address must match TREASURY_COLD_PRIVATE_KEY signer for IBO; "
                f"signer={cold_signer!r}, given={addr!r}.",
            )
    lab = (label or "").strip()[:200] or None
    return {"role": r, "asset": a, "network": n, "address": addr, "label": lab}


def new_wallet_id() -> str:
    return f"tw_{uuid.uuid4().hex[:18]}"


def new_audit_id() -> str:
    return f"twa_{uuid.uuid4().hex[:18]}"


def wallet_doc_to_public(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id" and not str(k).startswith("_")}
    return out


async def append_audit(
    db,
    *,
    wallet_id: str,
    action: str,
    admin_aid: Optional[str],
    admin_email: Optional[str],
    before: Optional[Dict[str, Any]],
    after: Optional[Dict[str, Any]],
    idempotency_key: Optional[str] = None,
) -> None:
    """Append-only treasury wallet audit row (in addition to admin_audit_logs)."""
    await db.treasury_wallet_audit.insert_one(
        {
            "id": new_audit_id(),
            "wallet_id": wallet_id,
            "action": action,
            "admin_aid": admin_aid,
            "admin_email": admin_email,
            "before": before or {},
            "after": after or {},
            "idempotency_key": (idempotency_key or "").strip() or None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )


async def list_wallets(
    db,
    *,
    role: Optional[str] = None,
    enabled: Optional[bool] = None,
    asset: Optional[str] = None,
    network: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> Tuple[List[Dict[str, Any]], int]:
    q: Dict[str, Any] = {}
    if role:
        q["role"] = role.strip().lower()
    if enabled is not None:
        q["enabled"] = bool(enabled)
    if asset:
        q["asset"] = asset.strip().upper()
    if network:
        q["network"] = network.strip()
    cur = (
        db.treasury_wallets.find(q, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    raw = await cur.to_list(length=limit)
    items = [wallet_doc_to_public(d) for d in raw]
    total = await db.treasury_wallets.count_documents(q)
    return items, total


async def get_wallet(db, wallet_id: str) -> Optional[Dict[str, Any]]:
    doc = await db.treasury_wallets.find_one({"id": wallet_id}, {"_id": 0})
    return wallet_doc_to_public(doc) if doc else None


def new_gate_event_id() -> str:
    return f"twge_{uuid.uuid4().hex[:18]}"


async def log_withdrawal_gate_transition(
    db,
    *,
    action: str,
    withdrawal_id: str,
    from_status: str,
    to_status: str,
    reason_code: str,
    reason: str,
    actor: str = "system",
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Append-only audit for treasury gate promote/demote and queue entry."""
    if db is None:
        return
    doc = {
        "id": new_gate_event_id(),
        "action": (action or "").strip(),
        "withdrawal_id": withdrawal_id,
        "from_status": from_status,
        "to_status": to_status,
        "reason_code": (reason_code or "").strip(),
        "reason": (reason or "").strip()[:500],
        "actor": (actor or "").strip()[:120],
        "meta": dict(meta or {}),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.treasury_withdrawal_gate_events.insert_one(doc)
    except Exception:  # noqa: BLE001
        logger.exception("treasury gate event insert failed wd=%s", withdrawal_id)
    logger.info(
        "treasury_gate action=%s withdrawal_id=%s %s→%s reason_code=%s actor=%s",
        doc["action"],
        withdrawal_id,
        from_status,
        to_status,
        reason_code,
        actor,
    )


async def _read_alert_webhook_params(db) -> Tuple[Optional[str], Optional[str]]:
    if db is None:
        return None, None
    doc = await db.platform_controls.find_one(
        {"id": "global"},
        {"_id": 0, "alert_webhook_url": 1, "alert_webhook_min_severity": 1},
    )
    if not doc:
        return None, None
    url = str(doc.get("alert_webhook_url") or "").strip() or None
    min_sev = str(doc.get("alert_webhook_min_severity") or "").strip().lower() or None
    return url, min_sev


async def notify_withdrawal_entered_awaiting_treasury(
    db,
    wd: Dict[str, Any],
    *,
    entry_source: str,
) -> None:
    """Operational alert when a withdrawal lands in awaiting_treasury."""
    if db is None:
        return
    wd_id = str(wd.get("id") or "")
    uid = str(wd.get("uid") or "")
    asset = str(wd.get("asset") or "")
    amount = wd.get("amount")
    reason_code = str(wd.get("treasury_gate_reason") or "unknown")
    url, min_sev = await _read_alert_webhook_params(db)
    try:
        await alert_service.raise_alert(
            type="withdrawal.awaiting_treasury",
            severity="warn",
            source="treasury_gate",
            title=f"Withdrawal queued for treasury ({wd_id})",
            message=(
                f"Withdrawal {wd_id} ({asset} {amount}) is awaiting_treasury "
                f"(reason={reason_code}, source={entry_source})."
            ),
            meta={
                "withdrawal_id": wd_id,
                "uid": uid,
                "asset": asset,
                "network": wd.get("network"),
                "amount": amount,
                "treasury_gate_reason": reason_code,
                "entry_source": entry_source,
            },
            dedupe_key=f"withdrawal.awaiting_treasury:{wd_id}",
            webhook_url=url,
            webhook_min_severity=min_sev,
        )
    except Exception:  # noqa: BLE001
        logger.exception("notify_withdrawal_entered_awaiting_treasury failed wd=%s", wd_id)


async def withdrawal_demote_approved_to_awaiting_treasury(
    db,
    *,
    withdrawal_id: str,
    reason_code: str,
    actor: str,
    entry_source: str,
    meta: Optional[Dict[str, Any]] = None,
) -> bool:
    """Move ``approved`` → ``awaiting_treasury`` with audit log + alert."""
    if db is None:
        return False
    now = datetime.now(timezone.utc).isoformat()
    res = await db.withdrawal_requests.update_one(
        {"id": withdrawal_id, "status": "approved"},
        {
            "$set": {
                "status": "awaiting_treasury",
                "treasury_gate_reason": reason_code,
                "treasury_gate_at": now,
                "updated_at": now,
            },
        },
    )
    if not int(res.modified_count or 0):
        return False
    wd = await db.withdrawal_requests.find_one({"id": withdrawal_id}, {"_id": 0}) or {}
    await log_withdrawal_gate_transition(
        db,
        action="demote",
        withdrawal_id=withdrawal_id,
        from_status="approved",
        to_status="awaiting_treasury",
        reason_code=reason_code,
        reason=f"Approved payout blocked by treasury gate ({reason_code})",
        actor=actor,
        meta={**(meta or {}), "entry_source": entry_source},
    )
    await notify_withdrawal_entered_awaiting_treasury(db, wd, entry_source=entry_source)
    return True


async def sweep_destination_treasury_address(db, asset: str, network: str) -> Optional[str]:
    """Return the treasury signer address funds should be swept to, or None if the gate blocks."""
    a = (asset or "").strip().upper()
    n = (network or "").strip()
    if not is_allowed_v1(a, n):
        return None
    if await treasury_gate_block_reason(db, a, n) is not None:
        return None
    return treasury_signer_for_asset(a)


async def treasury_gate_block_reason(
    db,
    asset: Optional[str],
    network: Optional[str],
) -> Optional[str]:
    """When gate applies, return a machine reason why payout is blocked, else None.

    Reasons: ``no_hot_wallet``, ``signer_not_configured``, ``hot_signer_mismatch``.
    """
    if db is None:
        return None
    a = (asset or "").strip().upper()
    n = (network or "").strip()
    if not is_allowed_v1(a, n):
        return None
    signer = treasury_signer_for_asset(a)
    if signer is None:
        return "signer_not_configured"
    cur = db.treasury_wallets.find(
        {"role": "hot", "enabled": True, "asset": a, "network": n},
        {"_id": 0, "address": 1},
    )
    hots = await cur.to_list(length=50)
    if not hots:
        return "no_hot_wallet"
    if not any(_addresses_equal_for_asset(a, str(h.get("address") or ""), signer) for h in hots):
        return "hot_signer_mismatch"
    return None


async def has_enabled_hot_payout_wallet(db, asset: Optional[str], network: Optional[str]) -> bool:
    """True when v1 gate does not apply, or hot row exists and matches treasury signer."""
    if db is None:
        return True
    a = (asset or "").strip().upper()
    n = (network or "").strip()
    if not is_allowed_v1(a, n):
        return True
    return await treasury_gate_block_reason(db, a, n) is None


async def promote_awaiting_treasury_to_approved(db, *, context: str = "unknown") -> int:
    """Flip awaiting_treasury → approved when hot wallet matches signer. Idempotent per row."""
    if db is None:
        return 0
    cur = db.withdrawal_requests.find(
        {"status": "awaiting_treasury"},
        {"_id": 0, "id": 1, "asset": 1, "network": 1, "uid": 1},
    )
    rows = await cur.to_list(length=200)
    promoted = 0
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        wid = r.get("id")
        a = r.get("asset")
        net = r.get("network")
        if not wid or not treasury_gate_applies(a, net):
            continue
        if await treasury_gate_block_reason(db, str(a or ""), str(net or "")) is not None:
            continue
        res = await db.withdrawal_requests.update_one(
            {"id": wid, "status": "awaiting_treasury"},
            {
                "$set": {
                    "status": "approved",
                    "treasury_ready_at": now,
                    "updated_at": now,
                },
                "$unset": {"treasury_gate_reason": "", "treasury_gate_at": ""},
            },
        )
        if int(res.modified_count or 0) > 0:
            promoted += 1
            await log_withdrawal_gate_transition(
                db,
                action="promote",
                withdrawal_id=str(wid),
                from_status="awaiting_treasury",
                to_status="approved",
                reason_code="hot_matches_signer",
                reason=f"Treasury hot omnibus matches signer; gate cleared ({context})",
                actor="system",
                meta={"trigger": context, "asset": a, "network": net, "uid": r.get("uid")},
            )
    return promoted


async def clear_default_payout_for_hot_asset_network(
    db,
    *,
    asset: str,
    network: str,
    except_wallet_id: Optional[str] = None,
) -> None:
    """At most one is_default_payout=True per (hot, asset, network)."""
    flt: Dict[str, Any] = {
        "role": "hot",
        "asset": asset,
        "network": network,
        "is_default_payout": True,
    }
    if except_wallet_id:
        flt["id"] = {"$ne": except_wallet_id}
    await db.treasury_wallets.update_many(
        flt,
        {"$set": {"is_default_payout": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
