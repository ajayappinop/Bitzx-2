"""Deposit-detection poller — WebSocket-driven, event-based architecture.

Replaces fixed-interval REST polling (~22 RPC calls / 30 s) with an
event-driven loop that wakes on every new Ethereum block delivered by
``services.eth_ws_listener``.

WS-driven path (ETH + USDT)
----------------------------
* The poller ``await``s ``eth_ws_listener.new_block_event`` instead of
  ``asyncio.sleep``.
* On wake it scans the **single new block** for native ETH deposits via
  ``provider.scan_eth_block`` — one ``eth_getBlockByNumber`` call.
* For USDT it calls ``provider.scan_usdt_block`` — one ``eth_getLogs``
  call filtered to our deposit addresses only (~75 QuickNode credits).

WHY NOT ``eth_subscribe logs``
-------------------------------
A global WS subscription for USDT Transfer events delivers every
Transfer on the entire Ethereum network (500-2 000 per block on
mainnet).  QuickNode charges credits per notification received, which
burns 3 000-10 000+ credits per block with zero user activity.
``eth_getLogs`` filtered to our addresses costs ~75 credits per block
regardless of global activity — roughly 66× cheaper.

BTC path
---------
BTC has no WebSocket support and is scanned every ``BTC_SCAN_EVERY_N``
(50) Ethereum blocks to amortise its ``scantxoutset`` cost.

REST fallback
-------------
When the WS listener is disconnected the poller falls back to a
300-second fixed-interval REST scan so deposits are never blocked by a
WS outage.

Idempotency
-----------
The ``deposit_events`` upsert key is ``(asset, network, tx_hash, address)``,
so re-scanning a block never creates duplicate rows.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from services import blockchain_service, eth_ws_listener
from services.blockchain_service import (
    BlockchainProvider,
    DisabledProvider,
    IncomingTx,
    QuickNodeProvider,
    _hex_to_int,
    deposit_scan_chain_enabled,
)

logger = logging.getLogger(__name__)

# How many ETH blocks between BTC scans.
BTC_SCAN_EVERY_N: int = 50
TRON_SCAN_EVERY_N: int = max(1, int(os.getenv("DEPOSIT_POLL_TRON_EVERY_N", "5") or "5"))
SOLANA_SCAN_EVERY_N: int = max(1, int(os.getenv("DEPOSIT_POLL_SOLANA_EVERY_N", "5") or "5"))
# REST fallback interval when the WS is disconnected.
REST_FALLBACK_INTERVAL_SEC: float = 300.0
# How long to wait for a new block event before checking WS health.
_BLOCK_WAIT_TIMEOUT_SEC: float = 60.0
# How long to cache the deposit address list before re-querying MongoDB.
# Keeps the per-block DB round-trip off the hot path; new addresses become
# visible within this window (default 60 s).
_ADDR_CACHE_TTL_SEC: float = 60.0
# Last BSC block fully scanned on the WS path (catch-up if poller was behind).
_last_bsc_scanned_block: int = 0

# ── Poller-state persistence (eliminates 12k startup backfill) ───────────────
_POLLER_STATE_COLL = "poller_scan_state"


async def _load_poller_state(db) -> Dict[str, int]:
    """Return {eth_last_block, bsc_last_block} from MongoDB (0 if never saved)."""
    try:
        doc = await db[_POLLER_STATE_COLL].find_one({"_id": "scan_progress"})
        if doc:
            return {
                "eth": int(doc.get("eth_last_block") or 0),
                "bsc": int(doc.get("bsc_last_block") or 0),
            }
    except Exception:  # noqa: BLE001
        logger.warning("deposit_poller: failed to load poller state from MongoDB")
    return {"eth": 0, "bsc": 0}


async def _save_poller_state(db, *, eth_block: int = 0, bsc_block: int = 0) -> None:
    """Persist the last fully-scanned block numbers so restarts resume cheaply."""
    if not db:
        return
    update: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if eth_block > 0:
        update["eth_last_block"] = eth_block
    if bsc_block > 0:
        update["bsc_last_block"] = bsc_block
    if not update:
        return
    try:
        await db[_POLLER_STATE_COLL].update_one(
            {"_id": "scan_progress"},
            {"$set": update},
            upsert=True,
        )
    except Exception:  # noqa: BLE001
        logger.warning("deposit_poller: failed to save poller state")


async def _resolve_bsc_latest(provider: QuickNodeProvider) -> int:
    """Latest BSC block from WS, or ``eth_blockNumber`` when BSC WS is down."""
    ws_blk = eth_ws_listener.latest_bsc_block()
    if ws_blk > 0:
        return ws_blk
    if not provider._bsc_rpc_url:
        return 0
    try:
        latest_hex = await provider._rpc(provider._bsc_rpc_url, "eth_blockNumber", [])
        return max(0, _hex_to_int(latest_hex))
    except Exception:  # noqa: BLE001
        logger.warning("deposit_poller: BSC eth_blockNumber failed", exc_info=True)
        return 0


def _bsc_block_range(latest: int) -> tuple[int, int] | None:
    """Return (from_block, to_block) for the BSC range to scan this tick.

    Returns ``None`` when there is nothing new to scan.
    The range is capped at ``DEPOSIT_POLL_BSC_CATCHUP_MAX`` (default 20) blocks
    to prevent BSC falling behind from exploding into a huge burst.
    """
    global _last_bsc_scanned_block  # noqa: PLW0603
    if latest <= 0:
        return None
    try:
        cap = max(1, int(os.getenv("DEPOSIT_POLL_BSC_CATCHUP_MAX", "20") or "20"))
    except ValueError:
        cap = 20
    if _last_bsc_scanned_block <= 0:
        # First tick — scan only the latest block, no history.
        _last_bsc_scanned_block = latest
        return (latest, latest)
    from_b = _last_bsc_scanned_block + 1
    to_b = latest
    if to_b < from_b:
        return None  # Already up to date.
    if to_b - from_b + 1 > cap:
        from_b = to_b - cap + 1
    _last_bsc_scanned_block = to_b
    return (from_b, to_b)


# ── Environment helpers ───────────────────────────────────────────────────────

def _is_enabled() -> bool:
    val = (os.getenv("DEPOSIT_POLL_ENABLED") or "").strip().lower()
    return val in ("1", "true", "yes", "on")


def _rest_interval_sec() -> float:
    """Legacy REST interval (used when WS is down)."""
    try:
        return max(5.0, float(os.getenv("DEPOSIT_POLL_INTERVAL_SEC") or "30"))
    except ValueError:
        return 30.0


# ── Address cache (avoids a MongoDB round-trip on every block) ────────────────

import time as _time  # noqa: E402 (after logger)

_addr_cache: List[Dict[str, Any]] = []
_addr_cache_ts: float = 0.0          # monotonic timestamp of last refresh
_addr_cache_db = None                 # db reference used for the cached result


async def _load_active_addresses(db, *, force: bool = False) -> List[Dict[str, Any]]:
    """Return the active deposit addresses, refreshing from MongoDB at most
    once every ``_ADDR_CACHE_TTL_SEC`` seconds.

    On mainnet Ethereum (~12 s blocks), this reduces MongoDB queries from
    once-per-block (5/min) to once per minute — and skips ALL QuickNode
    RPC calls when the cache is empty (no users have generated addresses yet).

    Pass ``force=True`` to bypass the cache (e.g. after a new address is
    generated by the wallet endpoint).
    """
    global _addr_cache, _addr_cache_ts, _addr_cache_db  # noqa: PLW0603
    now = _time.monotonic()
    if (
        not force
        and _addr_cache_db is db
        and (now - _addr_cache_ts) < _ADDR_CACHE_TTL_SEC
    ):
        return _addr_cache

    cur = db.deposit_addresses.find(
        {"enabled": True, "uid": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "uid": 1, "asset": 1, "network": 1, "address": 1},
    )
    rows = await cur.to_list(length=5000)
    _addr_cache    = rows
    _addr_cache_ts = now
    _addr_cache_db = db
    return rows


async def _record_events(
    db,
    events: List[IncomingTx],
    *,
    addr_index: Dict[Tuple, Dict[str, Any]],
    net_addr_index: Optional[Dict[Tuple[str, str], Dict[str, Any]]] = None,
) -> int:
    """Upsert one ``deposit_events`` row per sighting. Returns new-row count."""
    if not events:
        return 0
    if net_addr_index is None:
        net_addr_index = _build_network_addr_index(list(addr_index.values()))
    inserted = 0
    now = datetime.now(timezone.utc).isoformat()
    skipped_dust = 0
    for ev in events:
        if _is_dust_deposit(ev):
            skipped_dust += 1
            logger.debug(
                "deposit_poller: skipping dust %s %s amount=%s tx=%s",
                ev.asset, ev.network, ev.amount, (ev.tx_hash or "")[:18],
            )
            continue
        asset, norm_addr, uid = _resolve_deposit_owner(ev, addr_index, net_addr_index)
        key = {
            "asset":   asset,
            "network": ev.network,
            "tx_hash": ev.tx_hash,
            "address": norm_addr,
        }
        set_on_insert: Dict[str, Any] = {
            "id":            f"dev_{uuid.uuid4().hex[:16]}",
            "created_at":    now,
            "first_seen_at": now,
            "status":        "pending",
        }
        if uid:
            set_on_insert["uid"] = uid
        set_fields: Dict[str, Any] = {
            "amount":        float(ev.amount),
            "confirmations": int(ev.confirmations),
            "block_height":  ev.block_height,
            "raw":           ev.raw or {},
            "updated_at":    now,
            "last_seen_at":  now,
        }
        try:
            res = await db.deposit_events.update_one(
                key,
                {
                    "$setOnInsert": set_on_insert,
                    "$set": set_fields,
                },
                upsert=True,
            )
            # Backfill uid on rows created earlier without owner (do not put uid in $set above — Mongo conflict).
            if uid and not res.upserted_id:
                await db.deposit_events.update_one(
                    {**key, "$or": [{"uid": None}, {"uid": {"$exists": False}}]},
                    {"$set": {"uid": uid, "updated_at": now}},
                )
            if res.upserted_id is not None:
                inserted += 1
                continue

            # Reorg check: if a credited tx resurfaces at a different block,
            # flag it for admin review (never auto-debit).
            if ev.block_height is not None:
                existing = await db.deposit_events.find_one(
                    key,
                    {"_id": 0, "status": 1, "credited_block_height": 1},
                )
                if (
                    existing
                    and existing.get("status") == "credited"
                    and existing.get("credited_block_height") is not None
                    and int(existing["credited_block_height"]) != int(ev.block_height)
                ):
                    await db.deposit_events.update_one(
                        key,
                        {"$set": {
                            "status":                "reorg_review",
                            "reorg_flagged_at":      now,
                            "reorg_new_block_height": int(ev.block_height),
                        }},
                    )
                    logger.warning(
                        "deposit_poller: reorg detected for %s/%s "
                        "(was block=%s, now=%s)",
                        ev.asset, ev.tx_hash,
                        existing.get("credited_block_height"), ev.block_height,
                    )
        except Exception:  # noqa: BLE001
            logger.exception(
                "deposit_poller: failed to upsert event %s/%s",
                ev.asset, ev.tx_hash,
            )
    if skipped_dust:
        logger.info("deposit_poller: skipped %d dust deposit(s)", skipped_dust)
    return inserted


# ── Address index ─────────────────────────────────────────────────────────────

_CASE_SENSITIVE_ADDR_ASSETS = frozenset({"BTC", "TRX", "SOL"})


def _norm_deposit_addr(asset: str, address: str) -> str:
    """Normalize address for index keys (EVM lowercased; Tron/Solana/BTC exact)."""
    a = (asset or "").upper()
    raw = (address or "").strip()
    if a in _CASE_SENSITIVE_ADDR_ASSETS:
        return raw
    return raw.lower()


def _build_addr_index(rows: List[Dict[str, Any]]) -> Dict[Tuple, Dict[str, Any]]:
    idx: Dict[Tuple, Dict[str, Any]] = {}
    for r in rows:
        asset = (r.get("asset") or "").upper()
        net   = r.get("network") or ""
        addr  = _norm_deposit_addr(asset, r.get("address") or "")
        idx[(asset, net, addr)] = r
    return idx


def _build_network_addr_index(rows: List[Dict[str, Any]]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """EVM fallback: map (network, normalized_address) → deposit row."""
    idx: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for r in rows:
        asset = (r.get("asset") or "").upper()
        if asset in _CASE_SENSITIVE_ADDR_ASSETS:
            continue
        net = r.get("network") or ""
        addr = _norm_deposit_addr(asset, r.get("address") or "")
        if net and addr:
            idx[(net, addr)] = r
    return idx


def _resolve_deposit_owner(
    ev: IncomingTx,
    addr_index: Dict[Tuple, Dict[str, Any]],
    net_addr_index: Dict[Tuple[str, str], Dict[str, Any]],
) -> Tuple[str, str, Optional[str]]:
    """Return (asset, normalized_address, uid) for a chain sighting."""
    asset = (ev.asset or "").upper()
    net = ev.network or ""
    norm_addr = _norm_deposit_addr(asset, ev.address or "")

    row = addr_index.get((asset, net, norm_addr))
    if row and row.get("uid"):
        return asset, norm_addr, row.get("uid")

    if asset not in _CASE_SENSITIVE_ADDR_ASSETS:
        row = net_addr_index.get((net, norm_addr))
        if row and row.get("uid"):
            # Keep ev.asset (token contract label) — universal BEP-20 address may be stored under USDT/BNB.
            return asset, norm_addr, row.get("uid")

    return asset, norm_addr, None


# ── Hex helper ────────────────────────────────────────────────────────────────

def _hex_to_int(val: Any) -> int:
    if val is None:
        return 0
    if isinstance(val, int):
        return val
    s = str(val).strip()
    if s.startswith(("0x", "0X")):
        try:
            return int(s, 16)
        except ValueError:
            return 0
    try:
        return int(s)
    except ValueError:
        return 0


async def repair_orphan_deposit_events(db) -> Dict[str, int]:
    """Attach uid (and correct asset) to poller rows saved with wrong asset labels."""
    rows = await _load_active_addresses(db, force=True)
    if not rows:
        return {"checked": 0, "repaired": 0, "removed_dupes": 0}
    net_idx = _build_network_addr_index(rows)
    orphans = await db.deposit_events.find(
        {"$or": [{"uid": None}, {"uid": {"$exists": False}}]},
        {"_id": 0},
    ).to_list(500)
    repaired = 0
    removed = 0
    for doc in orphans:
        net = doc.get("network") or ""
        norm = _norm_deposit_addr(doc.get("asset") or "", doc.get("address") or "")
        row = net_idx.get((net, norm))
        if not row or not row.get("uid"):
            continue
        correct_asset = (row.get("asset") or "").upper()
        uid = row["uid"]
        tx_hash = doc.get("tx_hash") or ""
        canonical = await db.deposit_events.find_one(
            {
                "tx_hash": tx_hash,
                "network": net,
                "asset": correct_asset,
                "address": norm,
            },
            {"_id": 0, "id": 1},
        )
        if canonical and canonical.get("id") != doc.get("id"):
            await db.deposit_events.delete_one({"id": doc["id"]})
            removed += 1
            continue
        await db.deposit_events.update_one(
            {"id": doc["id"]},
            {"$set": {"uid": uid, "asset": correct_asset, "updated_at": _now_iso()}},
        )
        repaired += 1
    if repaired or removed:
        logger.info(
            "deposit_poller: repaired %d orphan deposit_events, removed %d dupes",
            repaired, removed,
        )
    return {"checked": len(orphans), "repaired": repaired, "removed_dupes": removed}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record_min_usdt() -> float:
    """Minimum USDT notional to create a ``deposit_events`` row (blocks spam/dust)."""
    try:
        floor = float(os.getenv("DEPOSIT_RECORD_MIN_USDT", "0.01") or "0.01")
    except ValueError:
        floor = 0.01
    try:
        platform = float(os.getenv("MIN_WALLET_NOTIONAL_USDT", "1.0") or "1.0")
    except ValueError:
        platform = 1.0
    if platform > 0:
        return max(floor, platform)
    return floor


def _is_dust_deposit(ev: IncomingTx) -> bool:
    """True when the sighting should not be stored (dust / spam transfers)."""
    amount = float(ev.amount or 0.0)
    if amount <= 0:
        return True
    asset = (ev.asset or "").upper()
    if asset == "USDT":
        return amount < _record_min_usdt()
    # Listed stables quoted in USDT — apply the same floor to IBO on BSC for now.
    if asset == "IBO":
        return amount < _record_min_usdt()
    return False


async def rescan_listed_token_deposits(db) -> Dict[str, Any]:
    """Operator-triggered full-chain deposit lookback + orphan repair."""
    provider = blockchain_service.get_provider()
    if not isinstance(provider, QuickNodeProvider):
        return {"ok": False, "detail": "QuickNode provider not active"}
    backfill_stats = await _startup_full_deposit_backfill(db, provider)
    repair_stats = await repair_orphan_deposit_events(db)
    return {"ok": True, "backfill": backfill_stats, "repair": repair_stats}


async def _startup_full_deposit_backfill(
    db, provider: QuickNodeProvider,
) -> Dict[str, Any]:
    """Startup scan that resumes from the last persisted block instead of
    always rescanning 12 000 blocks.

    Strategy
    --------
    1. Load ``poller_scan_state`` from MongoDB to find the last block
       successfully processed on each chain.
    2. If a saved block exists, scan only the gap since then
       (capped at ``DEPOSIT_POLL_STARTUP_MAX_CATCHUP``, default 500 blocks).
    3. If no saved block exists (first-ever start), scan
       ``DEPOSIT_POLL_STARTUP_LOOKBACK_BLOCKS`` (default 200 — was 12 000).

    This reduces the per-restart credit burst from ~20 000 credits down to
    a few hundred in normal operation, and eliminates it entirely once the
    poller has been running for a few minutes.
    """
    try:
        from listings import registry
        await registry.refresh(db)
    except Exception:  # noqa: BLE001
        logger.exception("deposit_poller: registry refresh before startup backfill failed")

    rows = await _load_active_addresses(db, force=True)
    if not rows:
        return {"events": 0, "new": 0, "addresses": 0}

    # How many blocks to scan when we have no saved state (first start).
    try:
        cold_start_lb = max(50, int(
            os.getenv("DEPOSIT_POLL_STARTUP_LOOKBACK_BLOCKS", "200") or "200",
        ))
    except ValueError:
        cold_start_lb = 200

    # Maximum catch-up on restart even when saved state exists.
    try:
        max_catchup = max(50, int(
            os.getenv("DEPOSIT_POLL_STARTUP_MAX_CATCHUP", "500") or "500",
        ))
    except ValueError:
        max_catchup = 500

    saved = await _load_poller_state(db)
    eth_last = saved.get("eth", 0)
    bsc_last = saved.get("bsc", 0)

    # Set in-memory BSC pointer so the first WS tick doesn't re-scan.
    global _last_bsc_scanned_block  # noqa: PLW0603
    if bsc_last > 0:
        _last_bsc_scanned_block = bsc_last

    # Determine effective lookback for this restart.
    eth_lb = cold_start_lb if eth_last == 0 else min(max_catchup, cold_start_lb)
    bsc_lb = cold_start_lb if bsc_last == 0 else min(max_catchup, cold_start_lb)

    # Temporarily override provider lookback so scan_deposits_lookback uses
    # our calculated values.
    orig_eth_lb = provider._eth_lookback_blocks
    orig_startup_lb = provider._startup_lookback_blocks
    try:
        provider._eth_lookback_blocks = eth_lb
        provider._startup_lookback_blocks = max(eth_lb, bsc_lb)

        addr_index = _build_addr_index(rows)
        net_addr_index = _build_network_addr_index(rows)
        try:
            events = await provider.scan_deposits_lookback(addresses=rows)
        except Exception:  # noqa: BLE001
            logger.exception("deposit_poller: startup backfill RPC failed")
            return {"events": 0, "new": 0, "error": True}

        new_count = await _record_events(
            db, events, addr_index=addr_index, net_addr_index=net_addr_index,
        )
        logger.info(
            "deposit_poller: startup backfill addresses=%d events=%d new=%d "
            "eth_lb=%d bsc_lb=%d (saved eth=%d bsc=%d)",
            len(rows), len(events), new_count, eth_lb, bsc_lb, eth_last, bsc_last,
        )
        return {
            "addresses": len(rows),
            "events": len(events),
            "new": new_count,
            "eth_lookback": eth_lb,
            "bsc_lookback": bsc_lb,
            "resumed_from_saved_state": eth_last > 0 or bsc_last > 0,
        }
    finally:
        provider._eth_lookback_blocks = orig_eth_lb
        provider._startup_lookback_blocks = orig_startup_lb


async def _startup_listed_token_backfill(
    db, provider: QuickNodeProvider,
) -> Dict[str, int]:
    """One-time lookback for listed ERC-20/BEP-20 deposits (e.g. IBO) after restart."""
    try:
        lookback = max(50, int(os.getenv("DEPOSIT_POLL_LISTED_LOOKBACK_BLOCKS", "12000") or "12000"))
    except ValueError:
        lookback = 12000
    try:
        from listings import registry

        await registry.refresh(db)
    except Exception:  # noqa: BLE001
        logger.exception("deposit_poller: registry refresh before listed backfill failed")
    rows = await _load_active_addresses(db, force=True)
    if not rows:
        return {"events": 0, "new": 0}
    groups = []
    try:
        from listings.registry import get_scan_groups

        groups = get_scan_groups()
    except Exception:  # noqa: BLE001
        logger.exception("deposit_poller: get_scan_groups failed")
        return {"events": 0, "new": 0, "groups": 0}
    if not groups:
        logger.warning(
            "deposit_poller: listed-token backfill skipped — no scan groups "
            "(registry empty; ensure listings bootstrap runs before poller)",
        )
        return {"events": 0, "new": 0, "groups": 0}
    addr_index = _build_addr_index(rows)
    net_addr_index = _build_network_addr_index(rows)
    _bep20_net = "BEP-20 (BNB Chain)"
    _erc20_net = "ERC-20 (Ethereum)"
    events: List[IncomingTx] = []
    try:
        for grp in groups:
            asset_sym = (grp.get("asset") or "").upper()
            net_label = grp.get("network_label") or ""
            chain = (grp.get("chain_id") or "").lower()
            dyn_rows = [
                r for r in rows
                if (r.get("asset") or "").upper() == asset_sym
                and (r.get("network") or "") == net_label
            ]
            if not dyn_rows or asset_sym in ("USDT", "ETH", "BNB"):
                continue
            if chain == "eth" and provider._eth_rpc_url:
                events.extend(await provider.scan_erc20_transfers_lookback(
                    dyn_rows,
                    contract=grp["contract"],
                    network_label=net_label,
                    decimals=int(grp.get("decimals") or 18),
                    rpc_url=provider._eth_rpc_url,
                    lookback_blocks=lookback,
                ))
            elif chain == "bsc" and provider._bsc_rpc_url:
                events.extend(await provider.scan_erc20_transfers_lookback(
                    dyn_rows,
                    contract=grp["contract"],
                    network_label=net_label,
                    decimals=int(grp.get("decimals") or 18),
                    rpc_url=provider._bsc_rpc_url,
                    lookback_blocks=lookback,
                ))
    except Exception:  # noqa: BLE001
        logger.exception("deposit_poller: startup listed-token backfill failed")
        return {"events": 0, "new": 0, "error": True}
    new_count = await _record_events(
        db, events, addr_index=addr_index, net_addr_index=net_addr_index,
    )
    if events or new_count:
        logger.info(
            "deposit_poller: startup listed-token backfill lookback=%d events=%d new=%d",
            lookback, len(events), new_count,
        )
    return {"events": len(events), "new": new_count, "lookback": lookback, "groups": len(groups)}


async def _startup_usdt_bep20_backfill(
    db, provider: QuickNodeProvider,
) -> Dict[str, int]:
    """One-time BSC USDT lookback after restart (WS path only scans recent blocks)."""
    _bep20_net = "BEP-20 (BNB Chain)"
    if not provider._bsc_rpc_url or not provider._bsc_usdt_contract:
        return {"events": 0, "new": 0, "skipped": True}
    try:
        lookback = max(
            50,
            int(os.getenv("DEPOSIT_POLL_BSC_USDT_LOOKBACK_BLOCKS", "12000") or "12000"),
        )
    except ValueError:
        lookback = 3000
    rows = await _load_active_addresses(db, force=True)
    usdt_bep20_rows = [
        r for r in rows
        if (r.get("asset") or "").upper() == "USDT"
        and (r.get("network") or "") == _bep20_net
    ]
    if not usdt_bep20_rows:
        return {"events": 0, "new": 0}
    addr_index = _build_addr_index(rows)
    net_addr_index = _build_network_addr_index(rows)
    try:
        events = await provider.scan_erc20_transfers_lookback(
            usdt_bep20_rows,
            contract=provider._bsc_usdt_contract,
            network_label=_bep20_net,
            decimals=18,
            rpc_url=provider._bsc_rpc_url,
            lookback_blocks=lookback,
        )
    except Exception:  # noqa: BLE001
        logger.exception("deposit_poller: startup USDT BEP-20 backfill failed")
        return {"events": 0, "new": 0, "error": True}
    new_count = await _record_events(
        db, events, addr_index=addr_index, net_addr_index=net_addr_index,
    )
    if events or new_count:
        logger.info(
            "deposit_poller: startup USDT BEP-20 backfill lookback=%d events=%d new=%d",
            lookback, len(events), new_count,
        )
    return {"events": len(events), "new": new_count, "lookback": lookback}


# ── WS-driven tick ────────────────────────────────────────────────────────────

def _network_watch_rows(
    rows: List[Dict[str, Any]],
    network_label: str,
    *,
    asset_label: str,
) -> List[Dict[str, Any]]:
    """Unique BEP-20/ERC-20 deposit addresses on a network for listed-token scans.

    Listed tokens (IBO, MIDAS, …) share the same EVM address as USDT/BNB per user.
    Scan every address on the network so Trust Wallet sends to the universal address
    are still detected by the token contract watcher.
    """
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []
    sym = (asset_label or "").upper()
    for r in rows:
        if (r.get("network") or "") != network_label:
            continue
        addr = _norm_deposit_addr((r.get("asset") or "").upper(), r.get("address") or "")
        if not addr or addr in seen:
            continue
        seen.add(addr)
        out.append({**r, "asset": sym, "network": network_label})
    return out


async def _build_bsc_token_configs(
    rows: List[Dict[str, Any]],
    provider: "QuickNodeProvider",
    _bep20_net: str,
) -> List[Dict[str, Any]]:
    """Build the token_configs list for a single merged BSC eth_getLogs call.

    Includes USDT BEP-20 (from env contract) plus every listed token on BSC
    (e.g. IBO) that has active deposit addresses.  USDT/ETH/BNB are handled
    separately so we exclude them from the listings loop.
    """
    usdt_bep20_rows = [
        r for r in rows
        if (r.get("asset") or "").upper() == "USDT"
        and (r.get("network") or "") == _bep20_net
    ]
    cfgs: List[Dict[str, Any]] = []
    if usdt_bep20_rows and provider._bsc_usdt_contract:
        cfgs.append({
            "contract": provider._bsc_usdt_contract,
            "asset": "USDT",
            "network_label": _bep20_net,
            "decimals": 18,
            "rows": usdt_bep20_rows,
        })
    try:
        from listings.registry import get_scan_groups
        for grp in get_scan_groups():
            asset_sym = (grp.get("asset") or "").upper()
            if asset_sym in ("USDT", "ETH", "BNB"):
                continue
            if (grp.get("chain_id") or "").lower() != "bsc":
                continue
            net_label = grp.get("network_label") or ""
            dyn_rows = _network_watch_rows(rows, net_label, asset_label=asset_sym)
            if not dyn_rows:
                continue
            cfgs.append({
                "contract": grp["contract"],
                "asset": asset_sym,
                "network_label": net_label,
                "decimals": int(grp.get("decimals") or 18),
                "rows": dyn_rows,
            })
    except Exception:  # noqa: BLE001
        logger.exception("deposit_poller: failed to build BSC token configs from listings")
    return cfgs


async def _build_eth_token_configs(
    rows: List[Dict[str, Any]],
    provider: "QuickNodeProvider",
    _erc20_net: str,
) -> List[Dict[str, Any]]:
    """Build token_configs for a single merged ETH eth_getLogs call.

    Includes USDT ERC-20 plus listed ERC-20 tokens with active deposit rows.
    """
    usdt_erc20_rows = [
        r for r in rows
        if (r.get("asset") or "").upper() == "USDT"
        and (r.get("network") or "") not in ("BEP-20 (BNB Chain)", "TRC-20 (Tron)")
    ]
    cfgs: List[Dict[str, Any]] = []
    if usdt_erc20_rows and provider._usdt_contract:
        cfgs.append({
            "contract": provider._usdt_contract,
            "asset": "USDT",
            "network_label": _erc20_net,
            "decimals": 6,
            "rows": usdt_erc20_rows,
        })
    try:
        from listings.registry import get_scan_groups
        for grp in get_scan_groups():
            asset_sym = (grp.get("asset") or "").upper()
            if asset_sym in ("USDT", "ETH", "BNB"):
                continue
            if (grp.get("chain_id") or "").lower() != "eth":
                continue
            net_label = grp.get("network_label") or ""
            dyn_rows = _network_watch_rows(rows, net_label, asset_label=asset_sym)
            if not dyn_rows:
                continue
            cfgs.append({
                "contract": grp["contract"],
                "asset": asset_sym,
                "network_label": net_label,
                "decimals": int(grp.get("decimals") or 18),
                "rows": dyn_rows,
            })
    except Exception:  # noqa: BLE001
        logger.exception("deposit_poller: failed to build ETH token configs from listings")
    return cfgs


async def _tick_ws(
    db,
    provider: QuickNodeProvider,
    block_num: int,
    *,
    do_btc: bool,
    do_tron: bool = True,
    do_solana: bool = True,
) -> Dict[str, int]:
    """Scan deposits using the optimised WS-driven path.

    Credit optimisations vs the old per-block-per-token approach
    ------------------------------------------------------------
    ETH (1 call):  scan_eth_block — only when native ETH deposit rows exist.
    ETH tokens:    ONE merged scan_multi_token_range call covering USDT +
                   every listed ERC-20 for the single new block.
    BSC tokens:    ONE merged scan_multi_token_range call covering the ENTIRE
                   BSC block range (e.g. 4 blocks) × ALL token contracts.
                   Old: 4 blocks × 2 tokens = 8 getLogs (600 credits).
                   New: 1 range  × all tokens = 1 getLogs (~75 credits).
    Native BNB:    Per-block scan_bsc_block ONLY when users have BNB/ETH-BSC
                   deposit addresses (usually empty during testing).

    Zero RPC calls are made when no active deposit addresses exist.
    """
    rows = await _load_active_addresses(db)
    if not rows:
        try:
            from services.rpc_usage import record_poller_tick
            record_poller_tick(idle=True)
        except Exception:
            pass
        return {"addresses": 0, "events": 0, "new": 0}

    try:
        from services.rpc_usage import record_poller_tick
        record_poller_tick(idle=False)
    except Exception:
        pass

    addr_index = _build_addr_index(rows)
    net_addr_index = _build_network_addr_index(rows)

    _erc20_net = "ERC-20 (Ethereum)"
    _bep20_net = "BEP-20 (BNB Chain)"
    _tron_net  = "TRC-20 (Tron)"

    eth_erc20_rows = [
        r for r in rows
        if (r.get("asset") or "").upper() == "ETH"
        and (r.get("network") or "") != _bep20_net
    ]
    bnb_bep20_rows = [
        r for r in rows
        if (r.get("asset") or "").upper() in ("BNB", "ETH")
        and (r.get("network") or "") == _bep20_net
    ]
    btc_rows  = [r for r in rows if (r.get("asset") or "").upper() == "BTC"]
    trx_rows  = [r for r in rows if (r.get("asset") or "").upper() == "TRX"]
    usdt_rows = [r for r in rows if (r.get("asset") or "").upper() == "USDT"]
    usdt_trc_rows = [r for r in usdt_rows if (r.get("network") or "") == _tron_net]
    sol_rows  = [r for r in rows if (r.get("asset") or "").upper() == "SOL"]

    events: List[IncomingTx] = []

    # ── Ethereum: native ETH (1 getBlockByNumber, only if needed) ────────
    if eth_erc20_rows and block_num > 0:
        try:
            events.extend(await provider.scan_eth_block(block_num, eth_erc20_rows))
        except Exception:  # noqa: BLE001
            logger.exception("deposit_poller: scan_eth_block failed for block %d", block_num)

    # ── Ethereum: USDT + all listed ERC-20 tokens — ONE merged getLogs ───
    if block_num > 0 and provider._eth_rpc_url:
        eth_token_cfgs = await _build_eth_token_configs(rows, provider, _erc20_net)
        if eth_token_cfgs:
            try:
                events.extend(await provider.scan_multi_token_range(
                    block_num, block_num,
                    rpc_url=provider._eth_rpc_url,
                    token_configs=eth_token_cfgs,
                ))
            except Exception:  # noqa: BLE001
                logger.exception(
                    "deposit_poller: ETH multi-token range scan failed block %d", block_num,
                )

    # ── BSC: catch-up RANGE — ONE merged getLogs for ALL BSC tokens ───────
    # This is the largest credit saving: instead of looping over each BSC
    # block and calling getLogs per-token, we issue ONE getLogs covering the
    # entire range for ALL contracts simultaneously.
    bsc_latest = await _resolve_bsc_latest(provider)
    bsc_range = _bsc_block_range(bsc_latest)

    if bsc_range and provider._bsc_rpc_url:
        from_b, to_b = bsc_range

        # One merged getLogs for all BSC ERC-20/BEP-20 tokens.
        bsc_token_cfgs = await _build_bsc_token_configs(rows, provider, _bep20_net)
        if bsc_token_cfgs:
            try:
                events.extend(await provider.scan_multi_token_range(
                    from_b, to_b,
                    rpc_url=provider._bsc_rpc_url,
                    token_configs=bsc_token_cfgs,
                ))
            except Exception:  # noqa: BLE001
                logger.exception(
                    "deposit_poller: BSC multi-token range scan failed %d-%d", from_b, to_b,
                )

        # Native BNB deposits still require per-block getBlockByNumber.
        # Only run when users actually have BNB/ETH-BSC deposit addresses.
        if bnb_bep20_rows:
            for bsc_block_num in range(from_b, to_b + 1):
                try:
                    events.extend(await provider.scan_bsc_block(bsc_block_num, bnb_bep20_rows))
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "deposit_poller: scan_bsc_block failed for block %d", bsc_block_num,
                    )

        # Persist the latest BSC block after a successful range scan.
        try:
            await _save_poller_state(db, bsc_block=to_b)
        except Exception:  # noqa: BLE001
            pass

    # ── BTC (every N ETH blocks) ──────────────────────────────────────────
    if btc_rows and do_btc and deposit_scan_chain_enabled("btc", rpc_configured=bool(provider._btc_rpc_url)):
        try:
            events.extend(await provider.get_transactions(addresses=btc_rows))
        except Exception:  # noqa: BLE001
            logger.exception("deposit_poller: BTC scan failed")

    if (
        do_tron
        and provider._tron_rpc_url
        and (trx_rows or usdt_trc_rows)
        and deposit_scan_chain_enabled("tron", rpc_configured=True)
    ):
        try:
            events.extend(await provider._scan_tron(trx_rows, usdt_trc_rows))
        except Exception:  # noqa: BLE001
            logger.exception("deposit_poller: Tron scan failed")

    if (
        do_solana
        and provider._solana_rpc_url
        and sol_rows
        and deposit_scan_chain_enabled("solana", rpc_configured=True)
    ):
        try:
            events.extend(await provider._scan_solana(sol_rows))
        except Exception:  # noqa: BLE001
            logger.exception("deposit_poller: Solana scan failed")

    new_count = await _record_events(
        db, events, addr_index=addr_index, net_addr_index=net_addr_index,
    )

    # Persist ETH last-scanned block after successful tick.
    if block_num > 0:
        try:
            await _save_poller_state(db, eth_block=block_num)
        except Exception:  # noqa: BLE001
            pass

    return {"addresses": len(rows), "events": len(events), "new": new_count}


# ── REST tick (WS fallback — capped, persisted-state aware) ──────────────────

async def _tick_rest(db, provider: BlockchainProvider) -> Dict[str, int]:
    """REST-based deposit scan used when the ETH WS listener is disconnected.

    Credit-safe: uses ``DEPOSIT_POLL_REST_MAX_CATCHUP`` (default 200 blocks)
    instead of the historical 12 000-block BSC lookback.  This prevents the
    REST fallback from blowing the credit budget when the WS reconnects.
    """
    rows = await _load_active_addresses(db)
    if not rows:
        try:
            from services.rpc_usage import record_poller_tick
            record_poller_tick(idle=True)
        except Exception:
            pass
        return {"addresses": 0, "events": 0, "new": 0}
    try:
        from services.rpc_usage import record_poller_tick
        record_poller_tick(idle=False)
    except Exception:
        pass

    # Cap REST-mode lookback to avoid the historical 12 000-block default.
    try:
        rest_cap = max(20, int(
            os.getenv("DEPOSIT_POLL_REST_MAX_CATCHUP", "200") or "200",
        ))
    except ValueError:
        rest_cap = 200

    if isinstance(provider, QuickNodeProvider):
        orig_eth_lb = provider._eth_lookback_blocks
        orig_bsc_lb = provider._bsc_lookback_blocks
        try:
            provider._eth_lookback_blocks = min(orig_eth_lb, rest_cap)
            provider._bsc_lookback_blocks = min(orig_bsc_lb, rest_cap)
            addr_index = _build_addr_index(rows)
            events = await provider.get_transactions(addresses=rows)
        finally:
            provider._eth_lookback_blocks = orig_eth_lb
            provider._bsc_lookback_blocks = orig_bsc_lb
    else:
        addr_index = _build_addr_index(rows)
        events = await provider.get_transactions(addresses=rows)

    net_addr_index = _build_network_addr_index(rows)
    new_count = await _record_events(
        db, events, addr_index=addr_index, net_addr_index=net_addr_index,
    )
    return {"addresses": len(rows), "events": len(events), "new": new_count}


# ── Main run loop ─────────────────────────────────────────────────────────────

async def _run_loop(db, provider: BlockchainProvider) -> None:
    is_quicknode = isinstance(provider, QuickNodeProvider)
    eth_block_count: int = 0          # number of new-block wakes since start
    _idle_logged_at: float = 0.0      # throttle the "no addresses" log line
    _IDLE_LOG_INTERVAL: float = 300.0 # log idle status at most once per 5 min
    logger.info(
        "deposit_poller: started (provider=%s, mode=%s)",
        provider.name,
        "ws-driven" if is_quicknode else "rest-only",
    )

    if isinstance(provider, QuickNodeProvider):
        try:
            await _startup_full_deposit_backfill(db, provider)
            await repair_orphan_deposit_events(db)
        except Exception:  # noqa: BLE001
            logger.exception("deposit_poller: startup backfill error")

    while True:
        try:
            if is_quicknode and eth_ws_listener.is_connected():
                # ── WS path ────────────────────────────────────────────────
                # Wait for the next block event (with a safety timeout).
                # IMPORTANT: clear() is called only on the success path, NOT
                # in a finally block.  Clearing on timeout would discard a
                # block signal that arrived just before the deadline fired.
                try:
                    await asyncio.wait_for(
                        eth_ws_listener.new_block_event.wait(),
                        timeout=_BLOCK_WAIT_TIMEOUT_SEC,
                    )
                except asyncio.TimeoutError:
                    # No ETH block for 60s — still sweep BSC (USDT/BEP-20) via RPC
                    # so BSC deposits are not missed when BSC WS is down.
                    if isinstance(provider, QuickNodeProvider):
                        try:
                            stats = await _tick_rest(db, provider)
                            if stats.get("events") or stats.get("new"):
                                logger.info(
                                    "deposit_poller[timeout-bsc-rest]: events=%d new=%d",
                                    stats.get("events", 0), stats.get("new", 0),
                                )
                        except Exception:  # noqa: BLE001
                            logger.exception("deposit_poller: timeout BSC REST sweep failed")
                    continue

                # Consume the signal AFTER successfully receiving it.
                eth_ws_listener.new_block_event.clear()
                block_num = eth_ws_listener.latest_block()
                eth_block_count += 1
                do_btc = (eth_block_count % BTC_SCAN_EVERY_N) == 0
                do_tron = (eth_block_count % TRON_SCAN_EVERY_N) == 0
                do_solana = (eth_block_count % SOLANA_SCAN_EVERY_N) == 0

                try:
                    stats = await _tick_ws(
                        db,
                        provider,  # type: ignore[arg-type]
                        block_num,
                        do_btc=do_btc,
                        do_tron=do_tron,
                        do_solana=do_solana,
                    )
                    if stats["addresses"] == 0:
                        # No deposit addresses exist yet — zero RPC calls were
                        # made.  Log occasionally so the operator knows the
                        # poller is alive but idle.
                        now = _time.monotonic()
                        if now - _idle_logged_at >= _IDLE_LOG_INTERVAL:
                            logger.info(
                                "deposit_poller[ws]: block=%d — no active deposit "
                                "addresses, skipping QuickNode calls (0 CUs used)",
                                block_num,
                            )
                            _idle_logged_at = now
                    elif stats["events"] or stats["new"]:
                        logger.info(
                            "deposit_poller[ws]: block=%d addresses=%d "
                            "events=%d new=%d btc_scan=%s",
                            block_num, stats["addresses"],
                            stats["events"], stats["new"],
                            do_btc,
                        )
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "deposit_poller[ws]: tick failed for block %d", block_num,
                    )

            else:
                # ── REST fallback path ─────────────────────────────────────
                interval = (
                    REST_FALLBACK_INTERVAL_SEC
                    if is_quicknode          # WS *should* be up — use long interval
                    else _rest_interval_sec()
                )
                if is_quicknode:
                    logger.debug(
                        "deposit_poller: ETH WS not connected — "
                        "REST fallback in %.0fs", interval,
                    )
                try:
                    await asyncio.sleep(interval)
                except asyncio.CancelledError:
                    raise

                try:
                    stats = await _tick_rest(db, provider)
                    if stats["events"] or stats["new"]:
                        logger.info(
                            "deposit_poller[rest]: addresses=%d events=%d new=%d",
                            stats["addresses"], stats["events"], stats["new"],
                        )
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001
                    logger.exception("deposit_poller[rest]: tick failed")

        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("deposit_poller: unexpected error in run loop")
            try:
                await asyncio.sleep(5.0)
            except asyncio.CancelledError:
                raise


# ── Lifecycle ─────────────────────────────────────────────────────────────────

def start(db) -> Optional[asyncio.Task]:
    """Start the poller if enabled.  Returns the task (or ``None``)."""
    if not _is_enabled():
        logger.info(
            "deposit_poller: disabled (set DEPOSIT_POLL_ENABLED=true to enable)"
        )
        return None
    provider = blockchain_service.get_provider()
    if isinstance(provider, DisabledProvider):
        logger.info("deposit_poller: provider disabled — skipping startup")
        return None
    task = asyncio.create_task(
        _run_loop(db, provider),
        name="ibo-deposit-poller",
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
        logger.exception("deposit_poller: error while stopping")
