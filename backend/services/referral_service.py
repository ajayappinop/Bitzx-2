"""Refer & Earn — multi-level referral tracking + on-chain IBO reward crediting.

Mirrors ``signup_bonus_service.py`` exactly: rewards are broadcast on-chain
from the treasury wallet to the *beneficiary's own* IBO deposit address the
moment the downstream referral signs up (tracked via the shared
``deposit_events`` collection, the same one the RPC deposit poller and
deposit crediter watch). The transfer is real and on-chain immediately, but
it is only released into the beneficiary's spendable wallet balance once the
*referred* user passes KYC — enforced both by ``deposit_crediter``'s
``kyc_gate_uid`` check (background loop) and by an instant credit hook fired
from every KYC-approval code path (see :func:`credit_referral_rewards_on_kyc_approval`).

Data shape (all schemaless Mongo collections, matching the rest of the app):

- ``users.referral_code``   — short unique code every user can share.
- ``users.referred_by``     — uid of the direct (level-1) sponsor, or None.
- ``referral_edges``        — one doc per user: ``{uid, referred_by, ancestors,
                               created_at}`` where ``ancestors`` is the ordered
                               uplink chain (``ancestors[0]`` = direct sponsor,
                               ``ancestors[1]`` = sponsor's sponsor, ...),
                               truncated to the configured level count. This
                               materialised list avoids a recursive graph
                               lookup on every read.
- ``deposit_events``        — same collection signup bonus / real deposits use.
                               Referral reward rows carry ``source="referral_bonus"``,
                               ``uid`` = the beneficiary who owns the wallet /
                               receives the on-chain transfer, ``source_uid`` =
                               the referred user whose KYC gates the credit, and
                               ``level``. This collection is the single source
                               of truth for both "pending" and "credited" amounts
                               — there is no separate rewards ledger, exactly
                               like signup bonus.
"""

from __future__ import annotations

import logging
import random
import string
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from listings.wallet_assets import BEP20_NETWORK
from services import blockchain_service, treasury_service
from services.blockchain_service import BlockchainError, ProviderUnavailable

logger = logging.getLogger(__name__)

COL_USERS = "users"
COL_EDGES = "referral_edges"
COL_EVENTS = "deposit_events"

SOURCE = "referral_bonus"
IBO_ASSET = "IBO"
CODE_ALPHABET = string.ascii_uppercase + string.digits
CODE_LEN = 8
MAX_LEVELS_HARD_CAP = 20

# Terminal statuses that should never be counted as "pending" money.
_DEAD_STATUSES = ("failed", "orphan", "reorg_review")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_code() -> str:
    return "".join(random.choices(CODE_ALPHABET, k=CODE_LEN))


async def get_referral_levels(controls: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Normalised, sorted ``[{"level": int, "amount_ibo": float}, ...]`` from settings."""
    raw = controls.get("referral_levels") or []
    out: List[Dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        try:
            lvl = int(row.get("level"))
            amt = float(row.get("amount_ibo") or 0)
        except (TypeError, ValueError):
            continue
        if lvl < 1 or lvl > MAX_LEVELS_HARD_CAP:
            continue
        out.append({"level": lvl, "amount_ibo": max(0.0, amt)})
    out.sort(key=lambda r: r["level"])
    return out


def referral_flat_from_level(controls: Dict[str, Any]) -> int:
    """Level at which every deeper ancestor earns the same flat IBO amount (0 = off)."""
    try:
        val = int(controls.get("referral_flat_from_level") or 0)
    except (TypeError, ValueError):
        return 0
    return val if 1 <= val <= MAX_LEVELS_HARD_CAP else 0


def referral_flat_amount_ibo(controls: Dict[str, Any]) -> float:
    try:
        return max(0.0, float(controls.get("referral_flat_amount_ibo") or 0))
    except (TypeError, ValueError):
        return 0.0


def validate_referral_settings(
    levels: List[Dict[str, Any]],
    *,
    flat_from_level: int = 0,
    flat_amount_ibo: float = 0.0,
) -> Optional[str]:
    """Return an error message when referral level config is invalid, else None."""
    flat_from = int(flat_from_level or 0)
    flat_amt = max(0.0, float(flat_amount_ibo or 0))

    level_nums: List[int] = []
    for row in levels:
        if not isinstance(row, dict):
            continue
        try:
            lvl = int(row.get("level"))
            amt = float(row.get("amount_ibo") or 0)
        except (TypeError, ValueError):
            return "referral_levels rows need integer level + numeric amount_ibo"
        if lvl < 1 or lvl > MAX_LEVELS_HARD_CAP:
            return f"referral_levels level must be between 1 and {MAX_LEVELS_HARD_CAP}"
        if amt < 0 or amt > 1_000_000:
            return "referral_levels amount_ibo must be in 0..1000000"
        level_nums.append(lvl)

    if not level_nums:
        return "referral_levels must include at least level 1"

    distinct = sorted(set(level_nums))
    if len(distinct) != len(level_nums):
        return "referral_levels must not contain duplicate level numbers"

    if flat_from > 0:
        if flat_from < 2:
            return "referral_flat_from_level must be at least 2 when flat overflow is enabled"
        if flat_amt < 0 or flat_amt > 1_000_000:
            return "referral_flat_amount_ibo must be in 0..1000000"
        required = list(range(1, flat_from))
        if distinct != required:
            missing = [n for n in required if n not in distinct]
            extra = [n for n in distinct if n >= flat_from]
            if missing:
                return (
                    f"referral_flat_from_level={flat_from} requires distinct reward levels "
                    f"1 through {flat_from - 1}; missing level(s): {', '.join(map(str, missing))}"
                )
            if extra:
                return (
                    f"when referral_flat_from_level={flat_from} is set, distinct levels must "
                    f"only be 1..{flat_from - 1}; remove level(s): {', '.join(map(str, extra))}"
                )
    else:
        if distinct[0] != 1:
            return "referral_levels must start at level 1"

    return None


async def resolve_referral_amount_ibo(level: int, controls: Dict[str, Any]) -> float:
    """IBO reward for ``level`` (1 = direct sponsor) from admin settings."""
    if level < 1 or level > MAX_LEVELS_HARD_CAP:
        return 0.0
    levels = await get_referral_levels(controls)
    amount_by_level = {r["level"]: r["amount_ibo"] for r in levels}
    if level in amount_by_level:
        return float(amount_by_level[level])
    flat_from = referral_flat_from_level(controls)
    if flat_from > 0 and level >= flat_from:
        return referral_flat_amount_ibo(controls)
    return 0.0


async def max_referral_level(controls: Dict[str, Any]) -> int:
    """Deepest level we track in edges, tree views, and reward dispatch."""
    flat_from = referral_flat_from_level(controls)
    if flat_from > 0:
        return MAX_LEVELS_HARD_CAP
    levels = await get_referral_levels(controls)
    return max((r["level"] for r in levels), default=1)


async def referral_display_levels(controls: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Level rows for API/UI: distinct levels plus flat overflow metadata."""
    levels = await get_referral_levels(controls)
    flat_from = referral_flat_from_level(controls)
    flat_amt = referral_flat_amount_ibo(controls)
    out = list(levels)
    if flat_from > 0:
        out.append({
            "level": flat_from,
            "amount_ibo": flat_amt,
            "flat_overflow": True,
            "flat_from_level": flat_from,
            "flat_to_level": MAX_LEVELS_HARD_CAP,
        })
    return out


async def generate_referral_code(db) -> str:
    """Generate a unique referral code, retrying on the rare collision."""
    for _ in range(20):
        code = _new_code()
        existing = await db[COL_USERS].find_one({"referral_code": code}, {"_id": 1})
        if not existing:
            return code
    # Extremely unlikely fallback: uuid-derived code, still short + unique enough.
    return uuid.uuid4().hex[:CODE_LEN].upper()


async def ensure_referral_code(db, uid: str) -> str:
    """Return the user's referral code, lazily backfilling it if missing."""
    user = await db[COL_USERS].find_one({"uid": uid}, {"_id": 0, "referral_code": 1})
    code = (user or {}).get("referral_code")
    if code:
        return code
    code = await generate_referral_code(db)
    await db[COL_USERS].update_one({"uid": uid}, {"$set": {"referral_code": code}})
    return code


async def resolve_sponsor(db, code: str) -> Optional[Dict[str, Any]]:
    """Look up the user owning ``code``, or None if not found / blank."""
    code = (code or "").strip()
    if not code:
        return None
    return await db[COL_USERS].find_one(
        {"referral_code": code}, {"_id": 0, "uid": 1, "referral_code": 1},
    )


async def record_referral_edge(db, uid: str, sponsor_uid: str, *, max_levels: int) -> None:
    """Write the ``referral_edges`` doc for a brand-new user.

    ``ancestors`` = [sponsor_uid, *sponsor's own ancestors], truncated to
    ``max_levels``. Called once at signup — sponsor's ancestor chain is
    already resolved by the time their own edge doc was written, so this is
    O(1) rather than a recursive walk.
    """
    if not sponsor_uid:
        return
    sponsor_edge = await db[COL_EDGES].find_one({"uid": sponsor_uid}, {"_id": 0, "ancestors": 1})
    sponsor_ancestors = (sponsor_edge or {}).get("ancestors") or []
    ancestors = [sponsor_uid, *sponsor_ancestors][:max_levels]
    await db[COL_EDGES].update_one(
        {"uid": uid},
        {"$set": {
            "uid": uid,
            "referred_by": sponsor_uid,
            "ancestors": ancestors,
            "created_at": _now_iso(),
        }},
        upsert=True,
    )


async def apply_referral_signup(
    db,
    uid: str,
    referral_code: Optional[str],
    controls: Dict[str, Any],
    *,
    get_or_create_address: Optional[Callable[..., Awaitable[Optional[Dict[str, Any]]]]] = None,
) -> None:
    """Resolve ``referral_code`` (if any) and persist the sponsor link + edges.

    Safe no-op when the feature is disabled, the code is blank/unknown, or
    the code belongs to the user themself (defensive, should not happen).

    When ``get_or_create_address`` is supplied, also fires the on-chain
    treasury dispatch (background, never blocks signup) for every ancestor's
    configured reward level — mirroring how ``seed_wallet`` dispatches the
    signup bonus immediately at registration time.
    """
    if not controls.get("referral_enabled", False):
        return
    code = (referral_code or "").strip()
    if not code:
        return
    sponsor = await resolve_sponsor(db, code)
    if not sponsor or sponsor.get("uid") == uid:
        return
    sponsor_uid = sponsor["uid"]
    await db[COL_USERS].update_one({"uid": uid}, {"$set": {"referred_by": sponsor_uid}})
    max_levels = await max_referral_level(controls)
    await record_referral_edge(db, uid, sponsor_uid, max_levels=max_levels)

    if get_or_create_address is not None:
        await _dispatch_referral_rewards_on_signup(
            db, uid, controls, get_or_create_address=get_or_create_address,
        )


async def _dispatch_referral_rewards_on_signup(
    db,
    uid: str,
    controls: Dict[str, Any],
    *,
    get_or_create_address: Callable[..., Awaitable[Optional[Dict[str, Any]]]],
) -> None:
    """Fire-and-forget on-chain dispatch of every ancestor's referral reward.

    The treasury IBO transfer happens now (background task, never blocks the
    registration response); the amount only becomes spendable once ``uid``
    (the referred user) passes KYC.
    """
    edge = await db[COL_EDGES].find_one({"uid": uid}, {"_id": 0, "ancestors": 1})
    ancestors = (edge or {}).get("ancestors") or []
    if not ancestors:
        return
    import asyncio as _asyncio

    for idx, beneficiary_uid in enumerate(ancestors):
        level = idx + 1
        amount = await resolve_referral_amount_ibo(level, controls)
        if amount <= 0:
            continue

        async def _dispatch(beneficiary_uid: str = beneficiary_uid, level: int = level, amount: float = amount) -> None:
            try:
                await dispatch_on_chain_referral_reward(
                    db, beneficiary_uid, uid, level, amount,
                    get_or_create_address=get_or_create_address,
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "referral: background dispatch failed beneficiary=%s source=%s level=%s",
                    beneficiary_uid, uid, level,
                )

        _asyncio.create_task(_dispatch())


async def _existing_referral_dispatch(db, beneficiary_uid: str, source_uid: str, level: int) -> Optional[Dict[str, Any]]:
    """Return an already-broadcast referral reward event (has a tx_hash), if any.

    Placeholder rows (no tx_hash yet) are excluded so a failed dispatch can
    be retried without being blocked.
    """
    return await db[COL_EVENTS].find_one(
        {
            "uid": beneficiary_uid,
            "source": SOURCE,
            "source_uid": source_uid,
            "level": level,
            "tx_hash": {"$exists": True, "$ne": ""},
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def dispatch_on_chain_referral_reward(
    db,
    beneficiary_uid: str,
    source_uid: str,
    level: int,
    amount_ibo: float,
    *,
    get_or_create_address: Callable[..., Awaitable[Optional[Dict[str, Any]]]],
) -> Dict[str, Any]:
    """Broadcast a referral reward from treasury to the beneficiary's own IBO address.

    Mirrors :func:`signup_bonus_service.dispatch_on_chain_signup_bonus` step
    for step: a placeholder ``deposit_events`` row appears immediately (so
    the beneficiary sees "pending" right away, even before the tx is
    broadcast), then the on-chain send follows and the row is upgraded with
    the real ``tx_hash``. The reward is only released into the
    beneficiary's spendable wallet once ``source_uid`` (the referred user)
    passes KYC — see :func:`credit_referral_rewards_on_kyc_approval` and
    ``workers.deposit_crediter``'s ``kyc_gate_uid`` check.
    """
    amount = float(amount_ibo or 0)
    if amount <= 0:
        return {"ok": True, "skipped": True, "reason": "zero_amount"}

    if await _existing_referral_dispatch(db, beneficiary_uid, source_uid, level):
        return {"ok": True, "skipped": True, "reason": "already_dispatched"}

    addr_doc = await get_or_create_address(
        beneficiary_uid, IBO_ASSET, BEP20_NETWORK, created_by="referral_bonus",
    )
    to_raw = (addr_doc or {}).get("address") or ""
    if not to_raw.strip():
        logger.error("referral: no IBO deposit address for beneficiary=%s", beneficiary_uid)
        return {"ok": False, "error": "no_deposit_address"}

    to_addr = to_raw.strip().lower()
    now = _now_iso()

    # ── Step 1: placeholder row so the beneficiary sees "pending" without delay.
    placeholder_id = f"rfp_{uuid.uuid4().hex[:16]}"
    try:
        await db[COL_EVENTS].update_one(
            {
                "uid": beneficiary_uid,
                "source": SOURCE,
                "source_uid": source_uid,
                "level": level,
                "status": "pending",
                "tx_hash": {"$exists": False},
            },
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
                    "uid": beneficiary_uid,
                    "source": SOURCE,
                    "source_uid": source_uid,
                    "level": level,
                    "kyc_gate_uid": source_uid,
                    "status": "pending",
                    "amount": amount,
                    "updated_at": now,
                    "last_seen_at": now,
                },
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "referral: placeholder deposit_events row failed beneficiary=%s source=%s level=%s",
            beneficiary_uid, source_uid, level, exc_info=True,
        )

    async def _cleanup_placeholder() -> None:
        try:
            await db[COL_EVENTS].delete_one({"id": placeholder_id})
        except Exception:  # noqa: BLE001
            logger.debug("referral: placeholder cleanup on failure skipped", exc_info=True)

    # ── Step 2: broadcast the on-chain transfer (treasury → beneficiary).
    provider = blockchain_service.get_provider()
    try:
        result = await provider.send_ibo_signup_bonus(to_raw.strip(), amount)
    except (ProviderUnavailable, BlockchainError) as exc:
        logger.error("referral: broadcast failed beneficiary=%s: %s", beneficiary_uid, exc)
        await _cleanup_placeholder()
        return {"ok": False, "error": str(exc)}
    except Exception:  # noqa: BLE001
        logger.exception("referral: unexpected broadcast error beneficiary=%s", beneficiary_uid)
        await _cleanup_placeholder()
        return {"ok": False, "error": "broadcast_failed"}

    tx_hash = (result.tx_hash or "").strip()
    if not tx_hash:
        await _cleanup_placeholder()
        return {"ok": False, "error": "missing_tx_hash"}

    now = _now_iso()

    # ── Step 3: record treasury outflow.
    try:
        await treasury_service.record_custody_withdrawal(
            IBO_ASSET,
            amount,
            ref_type=SOURCE,
            ref_id=beneficiary_uid,
            meta={
                "tx_hash": tx_hash,
                "to": to_addr,
                "wallet_role": (result.raw or {}).get("wallet_role", "cold"),
                "from": (result.from_address or "").lower(),
                "source_uid": source_uid,
                "level": level,
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("referral: treasury custody withdrawal mirror failed beneficiary=%s", beneficiary_uid)

    # ── Step 4: upgrade placeholder row to a real deposit_events row (with tx_hash).
    event_id = f"rfd_{uuid.uuid4().hex[:16]}"
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
                # Seed ≥1 — we broadcast this ourselves from treasury and know
                # it will be mined; avoids stalling on the confirmations gate.
                "confirmations": 1,
            },
            "$set": {
                "uid": beneficiary_uid,
                "source": SOURCE,
                "source_uid": source_uid,
                "level": level,
                "kyc_gate_uid": source_uid,
                "amount": amount,
                "updated_at": now,
                "last_seen_at": now,
            },
        },
        upsert=True,
    )

    # ── Step 5: remove the no-tx_hash placeholder (now superseded by the real row).
    try:
        await db[COL_EVENTS].delete_one({"id": placeholder_id})
    except Exception:  # noqa: BLE001
        logger.debug("referral: placeholder cleanup skipped", exc_info=True)

    try:
        from workers import deposit_poller

        await deposit_poller._load_active_addresses(db, force=True)  # noqa: SLF001
    except Exception:  # noqa: BLE001
        logger.debug("referral: address cache refresh skipped", exc_info=True)

    logger.info(
        "referral: dispatched beneficiary=%s source=%s level=%s amount=%s IBO tx=%s to=%s",
        beneficiary_uid, source_uid, level, amount, tx_hash[:18], to_addr[:12],
    )
    return {"ok": True, "tx_hash": tx_hash, "event_id": event_id, "amount_ibo": amount}


async def credit_referral_rewards_on_kyc_approval(db, uid: str) -> Dict[str, Any]:
    """Instantly release every pending referral reward once ``uid`` (the referred user) is KYC-approved.

    ``uid`` here is the *source* of the reward (the person who just got
    KYC-approved), not the beneficiary. The on-chain transfer already
    happened at signup time (see :func:`dispatch_on_chain_referral_reward`);
    this just promotes the matching ``deposit_events`` rows straight to
    ``credited`` without waiting for the next ``deposit_crediter`` tick —
    mirrors :func:`signup_bonus_service.credit_signup_bonus_on_kyc_approval`.

    Idempotent: each event is atomically reserved (status flip to
    ``crediting``) before the wallet credit, so a duplicated KYC-approval
    call can never double-pay.
    """
    from pymongo import ReturnDocument

    from services import wallet_service

    actionable_statuses = ("pending", "confirming", "pending_kyc")
    events = await db[COL_EVENTS].find(
        {"source_uid": uid, "source": SOURCE, "status": {"$in": list(actionable_statuses)}},
        {"_id": 0, "raw": 0},
    ).sort("created_at", 1).to_list(length=100)

    credited = 0
    skipped = 0
    for ev in events:
        event_id = ev.get("id") or ""
        beneficiary_uid = ev.get("uid") or ""
        amount = float(ev.get("amount") or 0)
        level = ev.get("level")
        tx_hash = ev.get("tx_hash") or ""
        asset = (ev.get("asset") or IBO_ASSET).upper()

        if not event_id or not beneficiary_uid or amount <= 0:
            skipped += 1
            continue

        now_ts = _now_iso()
        before = await db[COL_EVENTS].find_one_and_update(
            {"id": event_id, "status": {"$in": list(actionable_statuses)}},
            {"$set": {"status": "crediting", "crediting_started_at": now_ts}},
            return_document=ReturnDocument.BEFORE,
        )
        if before is None:
            # Already grabbed by another worker (deposit_crediter tick) or admin override.
            skipped += 1
            continue

        prev_status = (before.get("status") or "pending").lower()

        try:
            txn = await wallet_service.credit(
                beneficiary_uid, asset, amount,
                txn_type="referral",
                ref_type="deposit_event",
                ref_id=event_id,
                meta={
                    "tx_hash": tx_hash,
                    "network": ev.get("network"),
                    "address": ev.get("address"),
                    "confirmations": ev.get("confirmations"),
                    "source": SOURCE,
                    "source_uid": uid,
                    "level": level,
                    "credited_by": "kyc_approval",
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "referral: kyc-approval credit failed event=%s beneficiary=%s amount=%s",
                event_id, beneficiary_uid, amount,
            )
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
            "referral: kyc-approval credited event=%s beneficiary=%s level=%s amount=%s IBO",
            event_id, beneficiary_uid, level, amount,
        )

    return {"credited": credited, "skipped": skipped, "total": len(events)}


async def _get_controls(db) -> Dict[str, Any]:
    doc = await db.platform_controls.find_one({"id": "global"}, {"_id": 0})
    return doc or {}


async def ensure_referral_indexes(db) -> None:
    """Indexes for referral tree/summary reads (safe to call at startup)."""
    await db[COL_EDGES].create_index("uid", unique=True)
    await db[COL_EDGES].create_index("referred_by")
    await db[COL_EDGES].create_index("ancestors")
    await db[COL_USERS].create_index("referral_code", unique=True, sparse=True)
    await db[COL_EVENTS].create_index([("uid", 1), ("source", 1)])
    await db[COL_EVENTS].create_index([("source_uid", 1), ("source", 1), ("status", 1)])


async def _fetch_downstream_edges(
    db, uid: str, *, max_levels: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """All downstream referral_edges where ``uid`` appears in ``ancestors``.

    When ``max_levels`` is None, every downstream user is included (admin full graph).
    """
    rows: List[Dict[str, Any]] = []
    async for doc in db[COL_EDGES].find(
        {"ancestors": uid},
        {"_id": 0, "uid": 1, "referred_by": 1, "ancestors": 1},
    ):
        ancestors = doc.get("ancestors") or []
        try:
            level = ancestors.index(uid) + 1
        except ValueError:
            continue
        if max_levels is not None and level > max_levels:
            continue
        rows.append({
            "uid": doc.get("uid"),
            "referred_by": doc.get("referred_by"),
            "ancestors": ancestors,
            "level": level,
        })
    rows.sort(key=lambda r: (r.get("level") or 0, r.get("uid") or ""))
    return rows


async def _users_by_uid(db, uids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not uids:
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    async for user in db[COL_USERS].find(
        {"uid": {"$in": uids}},
        {"_id": 0, "uid": 1, "name": 1, "email": 1, "avatar_url": 1, "created_at": 1, "kyc_status": 1},
    ):
        out[user["uid"]] = user
    return out


async def _load_referral_reward_events(
    db, beneficiary_uid: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, float], Dict[str, float]]:
    """Single scan of referral bonus events for summary + per-source tree earnings."""
    events: List[Dict[str, Any]] = []
    earned_by_source: Dict[str, float] = {}
    pending_by_source: Dict[str, float] = {}
    async for ev in db[COL_EVENTS].find(
        {"uid": beneficiary_uid, "source": SOURCE},
        {"_id": 0, "level": 1, "amount": 1, "status": 1, "source_uid": 1},
    ):
        events.append(ev)
        src = ev.get("source_uid")
        if not src:
            continue
        amt = float(ev.get("amount") or 0)
        status = (ev.get("status") or "").lower()
        if status == "credited":
            earned_by_source[src] = earned_by_source.get(src, 0.0) + amt
        elif status not in _DEAD_STATUSES:
            pending_by_source[src] = pending_by_source.get(src, 0.0) + amt
    return events, earned_by_source, pending_by_source


async def _load_referral_context(db, uid: str, *, admin_unlimited: bool = False) -> Dict[str, Any]:
    """Shared bulk load for summary + tree (3 Mongo round-trips)."""
    controls = await _get_controls(db)
    max_levels = None if admin_unlimited else await max_referral_level(controls)
    edges = await _fetch_downstream_edges(db, uid, max_levels=max_levels)
    child_uids = [e["uid"] for e in edges if e.get("uid")]
    users_coro = _users_by_uid(db, child_uids)
    events_coro = _load_referral_reward_events(db, uid)
    users_by_uid, (events, earned_by_source, pending_by_source) = await asyncio.gather(
        users_coro, events_coro,
    )
    return {
        "controls": controls,
        "max_levels": max_levels,
        "edges": edges,
        "users_by_uid": users_by_uid,
        "events": events,
        "earned_by_source": earned_by_source,
        "pending_by_source": pending_by_source,
    }


def _tree_nodes_from_context(ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    earned_by_source = ctx["earned_by_source"]
    pending_by_source = ctx["pending_by_source"]
    for edge in ctx["edges"]:
        uid = edge.get("uid")
        if not uid:
            continue
        user = ctx["users_by_uid"].get(uid, {})
        out.append({
            "uid": uid,
            "name": user.get("name") or "Unknown",
            "email": _mask_email(user.get("email")),
            "avatar_url": user.get("avatar_url") or "",
            "level": edge.get("level"),
            "joined_at": user.get("created_at"),
            "kyc_status": user.get("kyc_status") or "unverified",
            "referred_by": edge.get("referred_by"),
            "earned_from_this_referral_ibo": round(earned_by_source.get(uid, 0.0), 8),
            "pending_from_this_referral_ibo": round(pending_by_source.get(uid, 0.0), 8),
        })
    return out


async def get_referral_dashboard(db, uid: str) -> Dict[str, Any]:
    """Summary + tree in one optimized pass."""
    ctx = await _load_referral_context(db, uid)
    summary = await _summary_from_context(ctx, uid)
    return {
        "summary": summary,
        "referrals": _tree_nodes_from_context(ctx),
    }


async def _summary_from_context(ctx: Dict[str, Any], uid: str) -> Dict[str, Any]:
    controls = ctx["controls"]
    levels_cfg = await referral_display_levels(controls)
    flat_from = referral_flat_from_level(controls)
    flat_amt = referral_flat_amount_ibo(controls)

    per_level: Dict[int, Dict[str, Any]] = {}
    for r in levels_cfg:
        if r.get("flat_overflow"):
            continue
        per_level[r["level"]] = {
            "level": r["level"], "amount_ibo": r["amount_ibo"],
            "referral_count": 0, "earned_ibo": 0.0, "pending_ibo": 0.0,
        }

    amount_cache: Dict[int, float] = {}
    distinct_levels = sorted({
        int(edge.get("level") or 0) for edge in ctx["edges"] if edge.get("level")
    })
    amount_tasks = []
    amount_levels = []
    for lvl in distinct_levels:
        if flat_from > 0 and lvl >= flat_from:
            continue
        amount_levels.append(lvl)
        amount_tasks.append(resolve_referral_amount_ibo(lvl, controls))
    if amount_tasks:
        resolved = await asyncio.gather(*amount_tasks)
        amount_cache = dict(zip(amount_levels, resolved))

    for edge in ctx["edges"]:
        lvl = int(edge.get("level") or 0)
        if lvl < 1:
            continue
        if flat_from > 0 and lvl >= flat_from:
            per_level.setdefault(flat_from, {
                "level": flat_from,
                "amount_ibo": flat_amt,
                "flat_overflow": True,
                "flat_from_level": flat_from,
                "flat_to_level": MAX_LEVELS_HARD_CAP,
                "referral_count": 0,
                "earned_ibo": 0.0,
                "pending_ibo": 0.0,
            })
            per_level[flat_from]["referral_count"] += 1
            per_level[flat_from]["amount_ibo"] = flat_amt
            continue
        per_level.setdefault(lvl, {
            "level": lvl, "amount_ibo": amount_cache.get(lvl, 0.0), "referral_count": 0,
            "earned_ibo": 0.0, "pending_ibo": 0.0,
        })
        per_level[lvl]["referral_count"] += 1
        per_level[lvl]["amount_ibo"] = amount_cache.get(lvl, 0.0)

    total_earned = 0.0
    total_pending = 0.0
    for ev in ctx["events"]:
        lvl = int(ev.get("level") or 0)
        amt = float(ev.get("amount") or 0)
        status = (ev.get("status") or "").lower()
        bucket_lvl = flat_from if flat_from > 0 and lvl >= flat_from else lvl
        per_level.setdefault(bucket_lvl, {
            "level": bucket_lvl,
            "amount_ibo": amount_cache.get(lvl) or flat_amt if flat_from > 0 and lvl >= flat_from else 0.0,
            "referral_count": 0,
            "earned_ibo": 0.0,
            "pending_ibo": 0.0,
        })
        if flat_from > 0 and lvl >= flat_from:
            per_level[bucket_lvl]["flat_overflow"] = True
            per_level[bucket_lvl]["flat_from_level"] = flat_from
            per_level[bucket_lvl]["flat_to_level"] = MAX_LEVELS_HARD_CAP
            per_level[bucket_lvl]["amount_ibo"] = flat_amt
        if status == "credited":
            total_earned += amt
            per_level[bucket_lvl]["earned_ibo"] += amt
        elif status not in _DEAD_STATUSES:
            total_pending += amt
            per_level[bucket_lvl]["pending_ibo"] += amt

    if flat_from > 0:
        for key in list(per_level):
            if key > flat_from:
                del per_level[key]

    direct_count = per_level.get(1, {}).get("referral_count", 0)
    total_count = sum(v["referral_count"] for v in per_level.values())

    return {
        "referral_enabled": bool(controls.get("referral_enabled", False)),
        "referral_flat_from_level": flat_from or None,
        "referral_flat_amount_ibo": flat_amt if flat_from > 0 else None,
        "direct_referral_count": direct_count,
        "total_referral_count": total_count,
        "total_earned_ibo": round(total_earned, 8),
        "total_pending_ibo": round(total_pending, 8),
        "levels": [per_level[k] for k in sorted(per_level)],
    }


async def get_referral_summary(db, uid: str) -> Dict[str, Any]:
    """Direct/total downstream counts + IBO earned & pending, broken down by level."""
    ctx = await _load_referral_context(db, uid)
    return await _summary_from_context(ctx, uid)


async def get_referral_tree(db, uid: str, *, max_levels: Optional[int] = None) -> List[Dict[str, Any]]:
    """Strict downward walk of ``uid``'s own subtree — never siblings/upline."""
    if max_levels is not None:
        controls = await _get_controls(db)
        edges = await _fetch_downstream_edges(db, uid, max_levels=max_levels)
        child_uids = [e["uid"] for e in edges if e.get("uid")]
        users_by_uid, (events, earned_by_source, pending_by_source) = await asyncio.gather(
            _users_by_uid(db, child_uids),
            _load_referral_reward_events(db, uid),
        )
        ctx = {
            "edges": edges,
            "users_by_uid": users_by_uid,
            "earned_by_source": earned_by_source,
            "pending_by_source": pending_by_source,
        }
        return _tree_nodes_from_context(ctx)
    ctx = await _load_referral_context(db, uid)
    return _tree_nodes_from_context(ctx)


async def get_admin_referral_dashboard(db, uid: str) -> Dict[str, Any]:
    """Admin view: full downstream graph (direct + indirect), not capped at reward levels."""
    ctx = await _load_referral_context(db, uid, admin_unlimited=True)
    summary = await _summary_from_context(ctx, uid)
    return {
        "summary": summary,
        "referrals": _tree_nodes_from_context(ctx),
    }


async def get_upline_chain(db, uid: str, *, limit: int = 30) -> List[Dict[str, Any]]:
    """Sponsor chain from root signup down to ``uid``'s immediate parent (for admin breadcrumbs)."""
    chain: List[Dict[str, Any]] = []
    current = uid
    for _ in range(limit):
        doc = await db[COL_USERS].find_one(
            {"uid": current},
            {"_id": 0, "uid": 1, "name": 1, "email": 1, "referred_by": 1},
        )
        if not doc:
            break
        parent_uid = doc.get("referred_by")
        if not parent_uid:
            break
        parent = await db[COL_USERS].find_one(
            {"uid": parent_uid},
            {"_id": 0, "uid": 1, "name": 1, "email": 1},
        )
        if not parent:
            break
        chain.insert(0, {
            "uid": parent["uid"],
            "name": parent.get("name"),
            "email": parent.get("email"),
        })
        current = parent_uid
    return chain


def _mask_email(email: Optional[str]) -> str:
    if not email or "@" not in email:
        return email or ""
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        masked = local[:1] + "*"
    else:
        masked = local[:2] + "*" * (len(local) - 2)
    return f"{masked}@{domain}"
