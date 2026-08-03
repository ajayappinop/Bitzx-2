"""On-demand deposit monitoring — session-based and simple verify-deposit paths.

Architecture
------------
Instead of polling the blockchain 24/7, deposit verification only happens when a
user is actively viewing their Deposit/Fund page.

Two modes
---------
1. **verify_deposit_on_demand** (preferred) — a single stateless RPC call
   triggered by ``GET /api/wallet/verify-deposit``.  The frontend calls this
   every ``VERIFY_DEPOSIT_INTERVAL_MINUTES`` (default 5) while the deposit
   page is open and stops completely when the user navigates away.
   Scans the last ``VERIFY_BLOCK_LOOKBACK`` (default 100) blocks per chain.

2. **Session-based monitor** (legacy) — ``POST /wallet/deposit-monitor/start``
   + ``POST /wallet/deposit-monitor/scan`` + ``DELETE /wallet/deposit-monitor/stop``.
   Still supported but the simpler verify path is preferred for new code.

Credit comparison (BSC example)
--------------------------------
Background poller (old):  ~166 creds × 28 800 BSC blocks/day = 4.78 M creds/day
                          regardless of whether any user is active.

On-demand (new):          ~200 creds/verify × 12 verifies/hour × active users
                          e.g. 10 users/day → ~24 K creds/day  (~99 % savings)

Security
--------
- All state is server-side.  The client never controls block ranges.
- verify_deposit_on_demand enforces a per-user cooldown (min 60 s).
- Session ownership checked on every scan/stop request.
"""

from __future__ import annotations

import logging
import os
import time as _time
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from services.blockchain_service import QuickNodeProvider

logger = logging.getLogger(__name__)

MONITOR_COLL = "deposit_monitor_sessions"

# ── Defaults (overridden live via platform_controls) ──────────────────────────

_D_SESSION_DURATION_SEC     = 420    # 7 minutes
_D_SCAN_INTERVAL_SEC        = 30     # scan every 30 s
_D_MAX_SCANS_PER_SESSION    = 20     # generous headroom (7 min / 30 s = 14 ideal)
_D_MAX_ACTIVE_SESSIONS      = 1      # one active session per user
_D_COOLDOWN_SEC             = 60     # 60 s cooldown between sessions
_D_MESSAGE                  = (
    "Monitoring active — new deposits typically appear within 1–3 minutes."
)
_D_EXPIRED_MESSAGE          = (
    "Monitoring stopped. Tap Restart to resume watching for deposits."
)


# ── Config helper ─────────────────────────────────────────────────────────────

def get_monitor_config(controls: Dict[str, Any]) -> Dict[str, Any]:
    """Extract deposit-monitor settings from a platform_controls snapshot."""
    return {
        "enabled":               bool(controls.get("deposit_monitor_enabled", True)),
        "session_duration_sec":  int(controls.get("deposit_monitor_session_duration_sec", _D_SESSION_DURATION_SEC)),
        "scan_interval_sec":     int(controls.get("deposit_monitor_scan_interval_sec", _D_SCAN_INTERVAL_SEC)),
        "max_scans_per_session": int(controls.get("deposit_monitor_max_scans_per_session", _D_MAX_SCANS_PER_SESSION)),
        "max_active_sessions":   int(controls.get("deposit_monitor_max_active_sessions", _D_MAX_ACTIVE_SESSIONS)),
        "cooldown_sec":          int(controls.get("deposit_monitor_cooldown_sec", _D_COOLDOWN_SEC)),
        "message":               str(controls.get("deposit_monitor_message", _D_MESSAGE)),
        "expired_message":       str(controls.get("deposit_monitor_expired_message", _D_EXPIRED_MESSAGE)),
    }


# ── Session management ────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


async def create_session(
    db,
    uid: str,
    controls: Dict[str, Any],
    *,
    ip: str = "",
    user_agent: str = "",
) -> Dict[str, Any]:
    """Start a new monitoring session.

    If the user already has an active session the existing one is returned
    (handles browser refresh / page re-navigation without creating duplicates).

    Raises ``ValueError`` when:
    - deposit monitoring is disabled by the platform.
    - the user is within the cooldown window.
    """
    cfg = get_monitor_config(controls)

    if not cfg["enabled"]:
        raise ValueError("Deposit monitoring is currently disabled.")

    now = _utcnow()
    now_iso = _iso(now)

    # ── Return existing active session (idempotent start) ────────────────────
    existing = await db[MONITOR_COLL].find_one(
        {"uid": uid, "status": "active"},
        {"_id": 0},
    )
    if existing:
        # Auto-expire stale sessions that were never cleaned up by the client.
        if existing.get("expires_at", "") < now_iso:
            await db[MONITOR_COLL].update_one(
                {"id": existing["id"]},
                {"$set": {"status": "expired", "ended_at": now_iso}},
            )
            existing["status"] = "expired"
            existing["ended_at"] = now_iso
        else:
            return _public(existing)

    # ── Cooldown enforcement ─────────────────────────────────────────────────
    cooldown = cfg["cooldown_sec"]
    if cooldown > 0:
        cutoff_iso = _iso(now - timedelta(seconds=cooldown))
        recent = await db[MONITOR_COLL].find_one(
            {
                "uid": uid,
                "status": {"$in": ["expired", "stopped"]},
                "ended_at": {"$gt": cutoff_iso},
            },
            {"_id": 0, "ended_at": 1},
        )
        if recent:
            try:
                ended_dt = _parse_iso(recent["ended_at"])
                wait = cooldown - int((now - ended_dt).total_seconds())
                if wait > 0:
                    raise ValueError(
                        f"Please wait {wait} second{'s' if wait != 1 else ''} "
                        "before starting a new monitoring session."
                    )
            except ValueError:
                raise
            except Exception:
                pass

    # ── Create session ───────────────────────────────────────────────────────
    sid = str(uuid.uuid4())
    expires_at = _iso(now + timedelta(seconds=cfg["session_duration_sec"]))

    doc: Dict[str, Any] = {
        "_id":             sid,
        "id":              sid,
        "uid":             uid,
        "status":          "active",
        "created_at":      now_iso,
        "expires_at":      expires_at,
        "ended_at":        None,
        "scan_count":      0,
        "max_scans":       cfg["max_scans_per_session"],
        "scan_interval_sec": cfg["scan_interval_sec"],
        "last_scan_at":    None,
        "last_eth_block":  0,
        "last_bsc_block":  0,
        "events_found":    0,
        "ip":              ip[:64],
        "user_agent":      user_agent[:200],
        "config_snapshot": {
            k: v for k, v in cfg.items() if k not in ("message", "expired_message")
        },
    }

    await db[MONITOR_COLL].insert_one(doc)
    logger.info("deposit_monitor: session started uid=%s sid=%s expires=%s", uid, sid, expires_at)
    return _public(doc)


async def get_session_status(db, uid: str) -> Optional[Dict[str, Any]]:
    """Return the user's most recent session (any status), or None."""
    doc = await db[MONITOR_COLL].find_one(
        {"uid": uid},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not doc:
        return None
    # Expire in-flight active sessions server-side.
    if doc.get("status") == "active" and doc.get("expires_at", "") < _iso(_utcnow()):
        now_iso = _iso(_utcnow())
        await db[MONITOR_COLL].update_one(
            {"id": doc["id"]},
            {"$set": {"status": "expired", "ended_at": now_iso}},
        )
        doc["status"] = "expired"
        doc["ended_at"] = now_iso
    return _public(doc)


async def stop_session(db, uid: str, session_id: str) -> bool:
    """User-initiated stop. Returns True when a session was actually stopped."""
    now_iso = _iso(_utcnow())
    result = await db[MONITOR_COLL].update_one(
        {"id": session_id, "uid": uid, "status": "active"},
        {"$set": {"status": "stopped", "ended_at": now_iso}},
    )
    if result.modified_count:
        logger.info("deposit_monitor: session stopped uid=%s sid=%s", uid, session_id)
    return bool(result.modified_count)


# ── On-demand scan ────────────────────────────────────────────────────────────

_BEP20_NET = "BEP-20 (BNB Chain)"
_ERC20_NET = "ERC-20 (Ethereum)"
_TRON_NET  = "TRC-20 (Tron)"


async def run_scan(
    db,
    uid: str,
    session_id: str,
    *,
    provider: "QuickNodeProvider",
) -> Dict[str, Any]:
    """Perform an on-demand blockchain scan for a single user.

    Scans **only blocks produced since the last scan** for **only this user's
    deposit addresses**, using ``scan_multi_token_range`` for a single merged
    ``eth_getLogs`` call per chain — maximally credit-efficient.

    Returns a dict with ``ok``, ``events_found``, ``scan_count``,
    ``scans_remaining``, ``expires_at``, and ``status``.
    """
    from services.blockchain_service import QuickNodeProvider as _QNP, _hex_to_int
    from workers.deposit_poller import (
        _build_addr_index,
        _build_bsc_token_configs,
        _build_eth_token_configs,
        _build_network_addr_index,
        _record_events,
    )

    now = _utcnow()
    now_iso = _iso(now)

    # ── Load & validate session ───────────────────────────────────────────────
    session = await db[MONITOR_COLL].find_one({"id": session_id, "uid": uid}, {"_id": 0})

    if not session:
        return _err("Session not found.", "not_found")

    if session.get("status") != "active":
        return _err(f"Session is {session.get('status', 'unknown')}.", session.get("status", "unknown"))

    if session.get("expires_at", "") < now_iso:
        await db[MONITOR_COLL].update_one(
            {"id": session_id},
            {"$set": {"status": "expired", "ended_at": now_iso}},
        )
        return _err("Session expired.", "expired")

    scan_count = int(session.get("scan_count", 0))
    max_scans  = int(session.get("max_scans", _D_MAX_SCANS_PER_SESSION))
    if scan_count >= max_scans:
        await db[MONITOR_COLL].update_one(
            {"id": session_id},
            {"$set": {"status": "expired", "ended_at": now_iso}},
        )
        return _err("Scan limit reached.", "expired")

    # ── Rate-limit: enforce minimum gap between scans ────────────────────────
    interval    = max(10, int(session.get("scan_interval_sec", _D_SCAN_INTERVAL_SEC)))
    grace       = 5  # allow 5 s tolerance for network latency
    last_at_str = session.get("last_scan_at")
    if last_at_str:
        try:
            elapsed = (now - _parse_iso(last_at_str)).total_seconds()
            remaining = (interval - grace) - elapsed
            if remaining > 0:
                return {
                    "ok":            True,
                    "skipped":       True,
                    "retry_in_sec":  int(remaining),
                    "scan_count":    scan_count,
                    "scans_remaining": max_scans - scan_count,
                    "expires_at":    session["expires_at"],
                    "status":        "active",
                    "events_found":  0,
                }
        except Exception:
            pass

    if not isinstance(provider, _QNP):
        return _err("Blockchain provider not available.", "provider_unavailable")

    # ── Load this user's deposit addresses ───────────────────────────────────
    try:
        rows: List[Dict] = await db.deposit_addresses.find(
            {"uid": uid, "enabled": True},
            {"_id": 0, "uid": 1, "asset": 1, "network": 1, "address": 1},
        ).to_list(500)
    except Exception as exc:
        logger.warning("deposit_monitor: address load failed uid=%s: %s", uid, exc)
        return _err("Could not load deposit addresses.", "error")

    if not rows:
        await _bump_scan(db, session_id, scan_count, now_iso, 0, 0, 0)
        return {
            "ok":              True,
            "events_found":    0,
            "scan_count":      scan_count + 1,
            "scans_remaining": max_scans - scan_count - 1,
            "expires_at":      session["expires_at"],
            "status":          "active",
            "no_addresses":    True,
        }

    addr_index     = _build_addr_index(rows)
    net_addr_index = _build_network_addr_index(rows)

    last_eth_block = int(session.get("last_eth_block") or 0)
    last_bsc_block = int(session.get("last_bsc_block") or 0)
    new_eth_block  = last_eth_block
    new_bsc_block  = last_bsc_block
    all_events: List[Any] = []

    # ── ETH chain ─────────────────────────────────────────────────────────────
    eth_rows = [r for r in rows if (r.get("network") or "") not in (_BEP20_NET, _TRON_NET)]
    if eth_rows and provider._eth_rpc_url:
        try:
            cur_eth = _hex_to_int(
                await provider._rpc(provider._eth_rpc_url, "eth_blockNumber", [])
            )
            if cur_eth > 0:
                from_eth = (last_eth_block + 1) if last_eth_block > 0 else max(0, cur_eth - 5)
                to_eth   = cur_eth
                new_eth_block = cur_eth

                if from_eth <= to_eth:
                    # ERC-20 tokens (USDT + listed)
                    eth_cfgs = await _build_eth_token_configs(rows, provider, _ERC20_NET)
                    if eth_cfgs:
                        txs = await provider.scan_multi_token_range(
                            from_eth, to_eth,
                            rpc_url=provider._eth_rpc_url,
                            token_configs=eth_cfgs,
                        )
                        all_events.extend(txs)

                    # Native ETH deposits
                    native_eth_rows = [
                        r for r in rows
                        if (r.get("asset") or "").upper() == "ETH"
                        and (r.get("network") or "") != _BEP20_NET
                    ]
                    if native_eth_rows:
                        for blk in range(from_eth, min(to_eth + 1, from_eth + 10)):
                            txs = await provider.scan_eth_block(blk, native_eth_rows)
                            all_events.extend(txs)
        except Exception as exc:
            logger.warning("deposit_monitor: ETH scan error uid=%s: %s", uid, exc)

    # ── BSC chain ─────────────────────────────────────────────────────────────
    bsc_rows = [r for r in rows if (r.get("network") or "") == _BEP20_NET]
    if bsc_rows and provider._bsc_rpc_url:
        try:
            cur_bsc = _hex_to_int(
                await provider._rpc(provider._bsc_rpc_url, "eth_blockNumber", [])
            )
            if cur_bsc > 0:
                from_bsc = (last_bsc_block + 1) if last_bsc_block > 0 else max(0, cur_bsc - 20)
                to_bsc   = cur_bsc
                new_bsc_block = cur_bsc

                if from_bsc <= to_bsc:
                    bsc_cfgs = await _build_bsc_token_configs(rows, provider, _BEP20_NET)
                    if bsc_cfgs:
                        txs = await provider.scan_multi_token_range(
                            from_bsc, to_bsc,
                            rpc_url=provider._bsc_rpc_url,
                            token_configs=bsc_cfgs,
                        )
                        all_events.extend(txs)
        except Exception as exc:
            logger.warning("deposit_monitor: BSC scan error uid=%s: %s", uid, exc)

    # ── BTC ───────────────────────────────────────────────────────────────────
    btc_rows = [r for r in rows if (r.get("asset") or "").upper() == "BTC"]
    if btc_rows and provider._btc_rpc_url:
        try:
            txs = await provider.get_transactions(addresses=btc_rows)
            all_events.extend(txs)
        except Exception as exc:
            logger.warning("deposit_monitor: BTC scan error uid=%s: %s", uid, exc)

    # ── TRON ─────────────────────────────────────────────────────────────────
    tron_net_rows  = [r for r in rows if (r.get("network") or "") == _TRON_NET]
    usdt_trc_rows  = [r for r in tron_net_rows if (r.get("asset") or "").upper() == "USDT"]
    trx_rows       = [r for r in tron_net_rows if (r.get("asset") or "").upper() == "TRX"]
    if (tron_net_rows or trx_rows or usdt_trc_rows) and provider._tron_rpc_url:
        try:
            txs = await provider._scan_tron(trx_rows, usdt_trc_rows)
            all_events.extend(txs)
        except Exception as exc:
            logger.warning("deposit_monitor: TRON scan error uid=%s: %s", uid, exc)

    # ── Persist events ────────────────────────────────────────────────────────
    new_events = 0
    if all_events:
        try:
            new_events = await _record_events(
                db, all_events,
                addr_index=addr_index,
                net_addr_index=net_addr_index,
            )
        except Exception as exc:
            logger.warning("deposit_monitor: record_events failed uid=%s: %s", uid, exc)

    await _bump_scan(db, session_id, scan_count, now_iso, new_eth_block, new_bsc_block, new_events)

    new_scan_count = scan_count + 1
    logger.debug(
        "deposit_monitor: scan uid=%s sid=%s scan=%d/%d blocks eth=%d bsc=%d events=%d",
        uid, session_id, new_scan_count, max_scans,
        new_eth_block, new_bsc_block, new_events,
    )

    return {
        "ok":              True,
        "events_found":    new_events,
        "scan_count":      new_scan_count,
        "scans_remaining": max_scans - new_scan_count,
        "expires_at":      session["expires_at"],
        "status":          "active",
        "eth_block":       new_eth_block,
        "bsc_block":       new_bsc_block,
    }


# ── Background cleanup ────────────────────────────────────────────────────────

async def expire_stale_sessions(db) -> int:
    """Mark any active sessions whose expires_at has passed. Call periodically."""
    result = await db[MONITOR_COLL].update_many(
        {"status": "active", "expires_at": {"$lt": _iso(_utcnow())}},
        {"$set": {"status": "expired", "ended_at": _iso(_utcnow())}},
    )
    return result.modified_count


# ── DB index bootstrap ────────────────────────────────────────────────────────

async def ensure_indexes(db) -> None:
    coll = db[MONITOR_COLL]
    await coll.create_index([("uid", 1), ("status", 1)])
    await coll.create_index([("uid", 1), ("created_at", -1)])
    await coll.create_index("expires_at")


# ── Internal helpers ──────────────────────────────────────────────────────────

def _public(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Strip MongoDB-internal fields before returning to caller / API layer."""
    return {k: v for k, v in doc.items() if k != "_id"}


def _err(message: str, status: str) -> Dict[str, Any]:
    return {"ok": False, "error": message, "status": status}


async def _bump_scan(
    db,
    session_id: str,
    old_count: int,
    now_iso: str,
    eth_block: int,
    bsc_block: int,
    new_events: int,
) -> None:
    update: Dict[str, Any] = {
        "last_scan_at": now_iso,
        "scan_count":   old_count + 1,
    }
    if eth_block:
        update["last_eth_block"] = eth_block
    if bsc_block:
        update["last_bsc_block"] = bsc_block
    inc: Dict[str, Any] = {}
    if new_events:
        inc["events_found"] = new_events
    op: Dict[str, Any] = {"$set": update}
    if inc:
        op["$inc"] = inc
    await db[MONITOR_COLL].update_one({"id": session_id}, op)


# ── On-demand verify-deposit (stateless, no session) ──────────────────────────

# In-memory per-user rate-limit: uid → monotonic timestamp of last verify call.
# Prevents a single user from hammering the RPC by calling the endpoint faster
# than the configured minimum interval.
_verify_rate_limit: Dict[str, float] = {}

# Minimum seconds between verify-deposit calls per user (server-side guard).
_VERIFY_MIN_INTERVAL_SEC: float = 60.0


def _verify_block_lookback() -> int:
    """Number of recent blocks to scan on each verify-deposit call."""
    try:
        return max(10, int(os.getenv("VERIFY_BLOCK_LOOKBACK", "100") or "100"))
    except ValueError:
        return 100


async def verify_deposit_on_demand(
    db,
    uid: str,
    *,
    provider: "QuickNodeProvider",
) -> Dict[str, Any]:
    """Scan recent blocks for the authenticated user's deposit addresses.

    Called by ``GET /api/wallet/verify-deposit`` when the frontend deposit
    page polls for new deposits.  No session is required.

    Rate-limited server-side: returns ``{"ok": True, "skipped": True}`` when
    called within ``_VERIFY_MIN_INTERVAL_SEC`` of the previous call.

    Uses exactly one ``eth_getLogs`` per chain (batched across all token
    contracts) so the RPC cost per call is minimal (~75–200 QuickNode CUs).
    """
    from services.blockchain_service import QuickNodeProvider as _QNP, _hex_to_int
    from workers.deposit_poller import (
        _build_addr_index,
        _build_bsc_token_configs,
        _build_eth_token_configs,
        _build_network_addr_index,
        _record_events,
    )

    now_mono = _time.monotonic()

    # ── Per-user rate limit ───────────────────────────────────────────────────
    last_call = _verify_rate_limit.get(uid, 0.0)
    elapsed = now_mono - last_call
    if elapsed < _VERIFY_MIN_INTERVAL_SEC:
        retry_in = int(_VERIFY_MIN_INTERVAL_SEC - elapsed)
        return {
            "ok": True,
            "skipped": True,
            "retry_in_sec": retry_in,
            "events_found": 0,
        }

    if not isinstance(provider, _QNP):
        return {"ok": False, "error": "Blockchain provider not available.", "events_found": 0}

    # ── Load this user's deposit addresses ───────────────────────────────────
    try:
        rows: List[Dict] = await db.deposit_addresses.find(
            {"uid": uid, "enabled": True},
            {"_id": 0, "uid": 1, "asset": 1, "network": 1, "address": 1},
        ).to_list(500)
    except Exception as exc:
        logger.warning("verify_deposit: address load failed uid=%s: %s", uid, exc)
        return {"ok": False, "error": "Could not load deposit addresses.", "events_found": 0}

    if not rows:
        _verify_rate_limit[uid] = now_mono
        return {"ok": True, "events_found": 0, "no_addresses": True}

    lookback = _verify_block_lookback()
    addr_index = _build_addr_index(rows)
    net_addr_index = _build_network_addr_index(rows)
    all_events: List[Any] = []

    # ── ETH chain ─────────────────────────────────────────────────────────────
    eth_rows = [r for r in rows if (r.get("network") or "") not in (_BEP20_NET, _TRON_NET)]
    if eth_rows and provider._eth_rpc_url:
        try:
            cur_eth = _hex_to_int(
                await provider._rpc(provider._eth_rpc_url, "eth_blockNumber", [])
            )
            if cur_eth > 0:
                from_eth = max(0, cur_eth - lookback)
                to_eth = cur_eth
                eth_cfgs = await _build_eth_token_configs(rows, provider, _ERC20_NET)
                if eth_cfgs:
                    txs = await provider.scan_multi_token_range(
                        from_eth, to_eth,
                        rpc_url=provider._eth_rpc_url,
                        token_configs=eth_cfgs,
                    )
                    all_events.extend(txs)
                # Native ETH (per-block scan, capped to avoid excessive calls)
                native_eth_rows = [
                    r for r in rows
                    if (r.get("asset") or "").upper() == "ETH"
                    and (r.get("network") or "") != _BEP20_NET
                ]
                if native_eth_rows:
                    scan_cap = min(lookback, 10)
                    for blk in range(max(0, cur_eth - scan_cap + 1), cur_eth + 1):
                        txs = await provider.scan_eth_block(blk, native_eth_rows)
                        all_events.extend(txs)
        except Exception as exc:
            logger.warning("verify_deposit: ETH scan error uid=%s: %s", uid, exc)

    # ── BSC chain ─────────────────────────────────────────────────────────────
    bsc_rows = [r for r in rows if (r.get("network") or "") == _BEP20_NET]
    if bsc_rows and provider._bsc_rpc_url:
        try:
            cur_bsc = _hex_to_int(
                await provider._rpc(provider._bsc_rpc_url, "eth_blockNumber", [])
            )
            if cur_bsc > 0:
                from_bsc = max(0, cur_bsc - lookback)
                to_bsc = cur_bsc
                bsc_cfgs = await _build_bsc_token_configs(rows, provider, _BEP20_NET)
                if bsc_cfgs:
                    txs = await provider.scan_multi_token_range(
                        from_bsc, to_bsc,
                        rpc_url=provider._bsc_rpc_url,
                        token_configs=bsc_cfgs,
                    )
                    all_events.extend(txs)
        except Exception as exc:
            logger.warning("verify_deposit: BSC scan error uid=%s: %s", uid, exc)

    # ── BTC ───────────────────────────────────────────────────────────────────
    btc_rows = [r for r in rows if (r.get("asset") or "").upper() == "BTC"]
    if btc_rows and provider._btc_rpc_url:
        try:
            txs = await provider.get_transactions(addresses=btc_rows)
            all_events.extend(txs)
        except Exception as exc:
            logger.warning("verify_deposit: BTC scan error uid=%s: %s", uid, exc)

    # ── TRON ─────────────────────────────────────────────────────────────────
    tron_net_rows = [r for r in rows if (r.get("network") or "") == _TRON_NET]
    usdt_trc_rows = [r for r in tron_net_rows if (r.get("asset") or "").upper() == "USDT"]
    trx_rows      = [r for r in tron_net_rows if (r.get("asset") or "").upper() == "TRX"]
    if (tron_net_rows or trx_rows or usdt_trc_rows) and provider._tron_rpc_url:
        try:
            txs = await provider._scan_tron(trx_rows, usdt_trc_rows)
            all_events.extend(txs)
        except Exception as exc:
            logger.warning("verify_deposit: TRON scan error uid=%s: %s", uid, exc)

    # ── Persist events ────────────────────────────────────────────────────────
    new_events = 0
    if all_events:
        try:
            new_events = await _record_events(
                db, all_events,
                addr_index=addr_index,
                net_addr_index=net_addr_index,
            )
        except Exception as exc:
            logger.warning("verify_deposit: record_events failed uid=%s: %s", uid, exc)

    # Record rate-limit timestamp AFTER the scan completes.
    _verify_rate_limit[uid] = _time.monotonic()

    logger.debug(
        "verify_deposit: uid=%s addresses=%d lookback=%d events=%d new=%d",
        uid, len(rows), lookback, len(all_events), new_events,
    )
    return {
        "ok": True,
        "events_found": new_events,
        "addresses_scanned": len(rows),
        "block_lookback": lookback,
    }
