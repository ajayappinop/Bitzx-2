"""Compliance helpers: sanctions name screening, AML score, tx monitoring, freeze expiry.

Kept dependency-light: callers pass the Motor ``db`` handle from ``server.py``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _norm_wallet(value: str) -> str:
    return str(value or "").strip().lower()


def _name_ratio(a: str, b: str) -> float:
    a = (a or "").strip().lower()
    b = (b or "").strip().lower()
    if not a or not b:
        return 0.0
    return float(SequenceMatcher(None, a, b).ratio())


def _event_risk_score(ev: Dict[str, Any]) -> float:
    sev = str(ev.get("severity") or "info").lower()
    base = 15.0
    if sev == "critical":
        base += 50.0
    elif sev == "high":
        base += 38.0
    elif sev == "medium":
        base += 22.0
    else:
        base += 5.0
    try:
        n = abs(float(ev.get("amount_usdt") or 0.0))
    except (TypeError, ValueError):
        n = 0.0
    base += min(30.0, n / 15_000.0)
    return round(min(100.0, base), 2)


def _dedupe_key(ev: Dict[str, Any]) -> str:
    uid = str(ev.get("uid") or "")
    ref = str(ev.get("ref_id") or "")
    et = str(ev.get("event_type") or "")
    day = (str(ev.get("created_at") or "")[:10]) or "unknown"
    return f"{et}|{uid}|{ref}|{day}"


async def screen_kyc_name(db, full_name: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Fuzzy match ``full_name`` against active sanctions rows."""
    if not cfg.get("enabled", True):
        return {"blocked": False, "best_score": 0.0, "hits": [], "checked_at": _now_iso()}
    min_score = float(cfg.get("min_match_score") or 0.8)
    hits: List[Dict[str, Any]] = []
    best = 0.0
    fn = (full_name or "").strip()
    if not fn:
        return {"blocked": False, "best_score": 0.0, "hits": [], "checked_at": _now_iso()}
    cur = db.sanctions_list.find({"is_active": True}, {"_id": 0})
    async for row in cur:
        names = [row.get("entity_name") or "", row.get("entity_name_norm") or ""]
        for al in row.get("aliases") or []:
            names.append(str(al))
        local_best = 0.0
        for n in names:
            r = _name_ratio(fn, n)
            if r > local_best:
                local_best = r
        if local_best > best:
            best = local_best
        if local_best >= min_score:
            hits.append(
                {
                    "sanction_id": row.get("id"),
                    "entity_name": row.get("entity_name"),
                    "list_source": row.get("list_source"),
                    "reference_id": row.get("reference_id"),
                    "score": round(local_best, 4),
                }
            )
    blocked = bool(cfg.get("block_on_sanctions")) and bool(hits)
    return {"blocked": blocked, "best_score": round(best, 4), "hits": hits[:30], "checked_at": _now_iso()}


async def check_wallet_blacklist_hit(db, address: str, network: str) -> Optional[Dict[str, Any]]:
    wn = _norm_wallet(address)
    net = str(network or "").strip().upper()
    if not wn or not net:
        return None
    return await db.wallet_blacklist.find_one(
        {"wallet_address_norm": wn, "network": net, "is_active": True},
        {"_id": 0},
    )


async def build_tx_monitor_events(
    db,
    cfg: Dict[str, Any],
    tf: str,
    tt: str,
    limit: int,
) -> List[Dict[str, Any]]:
    """Scan trades + withdrawal velocity; thresholds from ``cfg`` and enabled ``compliance_rules``."""
    large_trade = float(cfg.get("monitor_large_trade_usdt") or 25000.0)
    daily_turnover = float(cfg.get("monitor_daily_turnover_usdt") or 100000.0)

    # Optional overrides from published rules (same keys as screening config).
    rules = await db.compliance_rules.find({"enabled": True}, {"_id": 0}).to_list(200)
    v_thr = int(cfg.get("velocity_withdraw_count_24h") or 3)
    for r in rules:
        rk = str(r.get("rule_kind") or "")
        params = r.get("params") if isinstance(r.get("params"), dict) else {}
        if rk == "builtin_large_trade" and params.get("threshold_usdt") is not None:
            try:
                large_trade = float(params["threshold_usdt"])
            except (TypeError, ValueError):
                pass
        if rk == "builtin_high_turnover" and params.get("threshold_usdt") is not None:
            try:
                daily_turnover = float(params["threshold_usdt"])
            except (TypeError, ValueError):
                pass
        if rk == "builtin_withdraw_velocity" and params.get("count_24h") is not None:
            try:
                v_thr = int(params["count_24h"])
            except (TypeError, ValueError):
                pass

    events: List[Dict[str, Any]] = []
    trades = (
        await db.trades.find({"created_at": {"$gte": tf, "$lte": tt}}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit * 2)
        .to_list(limit * 2)
    )
    for t in trades:
        try:
            notional = abs(float(t.get("price", 0)) * float(t.get("qty", 0)))
        except (TypeError, ValueError):
            notional = 0.0
        if notional >= large_trade:
            uid = t.get("taker_uid") or t.get("maker_uid")
            ev = {
                "event_type": "large_trade",
                "uid": uid,
                "ref_id": t.get("id"),
                "symbol": t.get("symbol"),
                "amount_usdt": round(notional, 4),
                "severity": "high",
                "created_at": t.get("created_at"),
                "reason": f"Trade notional >= {large_trade:.2f} USDT",
                "rule_ids": [r.get("id") for r in rules if r.get("rule_kind") == "builtin_large_trade"],
            }
            ev["risk_score"] = _event_risk_score(ev)
            ev["dedupe_key"] = _dedupe_key(ev)
            events.append(ev)

    turnover_rows = await db.trades.aggregate(
        [
            {"$match": {"created_at": {"$gte": tf, "$lte": tt}}},
            {
                "$project": {
                    "day": {"$substrBytes": ["$created_at", 0, 10]},
                    "uid": {"$ifNull": ["$taker_uid", "$maker_uid"]},
                    "notional": {"$multiply": [{"$toDouble": "$price"}, {"$toDouble": "$qty"}]},
                }
            },
            {"$group": {"_id": {"uid": "$uid", "day": "$day"}, "turnover": {"$sum": {"$abs": "$notional"}}}},
            {"$match": {"turnover": {"$gte": daily_turnover}}},
            {"$sort": {"turnover": -1}},
            {"$limit": limit},
        ]
    ).to_list(limit)
    for row in turnover_rows:
        _id = row.get("_id") or {}
        uid = _id.get("uid")
        day = _id.get("day") or ""
        ev = {
            "event_type": "high_daily_turnover",
            "uid": uid,
            "ref_id": f"{day}/{uid}",
            "symbol": None,
            "amount_usdt": round(float(row.get("turnover") or 0.0), 4),
            "severity": "medium",
            "created_at": f"{day}T23:59:59+00:00",
            "reason": f"Daily turnover >= {daily_turnover:.2f} USDT",
            "rule_ids": [r.get("id") for r in rules if r.get("rule_kind") == "builtin_high_turnover"],
        }
        ev["risk_score"] = _event_risk_score(ev)
        ev["dedupe_key"] = _dedupe_key(ev)
        events.append(ev)

    # Withdrawal velocity (24h) — configurable count threshold
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    pipe = [
        {"$match": {"created_at": {"$gte": since}, "status": {"$nin": ["rejected", "failed"]}}},
        {"$group": {"_id": "$uid", "c": {"$sum": 1}}},
        {"$match": {"c": {"$gte": v_thr}}},
        {"$sort": {"c": -1}},
        {"$limit": limit},
    ]
    vel_rows = await db.withdrawal_requests.aggregate(pipe).to_list(limit)
    for row in vel_rows:
        uid = row.get("_id")
        c = int(row.get("c") or 0)
        ev = {
            "event_type": "withdraw_velocity",
            "uid": uid,
            "ref_id": f"vel24h:{uid}",
            "symbol": None,
            "amount_usdt": float(c),
            "severity": "medium",
            "created_at": _now_iso(),
            "reason": f"{c} non-failed withdrawals in 24h (threshold {v_thr})",
            "rule_ids": [r.get("id") for r in rules if r.get("rule_kind") == "builtin_withdraw_velocity"],
        }
        ev["risk_score"] = _event_risk_score(ev)
        ev["dedupe_key"] = _dedupe_key(ev)
        events.append(ev)

    events.sort(key=lambda e: e.get("created_at") or "", reverse=True)
    return events[:limit]


async def persist_tx_monitor_events(
    db,
    events: List[Dict[str, Any]],
    *,
    source: str,
) -> Tuple[int, List[str]]:
    """Upsert by ``dedupe_key``; returns (inserted_or_updated, sample_ids)."""
    inserted = 0
    ids: List[str] = []
    now = _now_iso()
    for ev in events:
        dk = ev.get("dedupe_key") or _dedupe_key(ev)
        ev = {**ev, "dedupe_key": dk, "source": source, "persisted_at": now}
        existing = await db.tx_monitor_events.find_one({"dedupe_key": dk}, {"_id": 0, "id": 1})
        if existing:
            await db.tx_monitor_events.update_one(
                {"dedupe_key": dk},
                {"$set": {k: v for k, v in ev.items() if k != "id"}},
            )
            continue
        eid = f"txm_{uuid.uuid4().hex[:16]}"
        ev["id"] = eid
        await db.tx_monitor_events.insert_one(ev)
        inserted += 1
        ids.append(eid)
    return inserted, ids


async def list_tx_monitor_events(db, skip: int, limit: int) -> Tuple[List[Dict[str, Any]], int]:
    cur = db.tx_monitor_events.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.tx_monitor_events.count_documents({})
    return items, int(total)


async def recompute_aml_risk_for_user(db, uid: str) -> Dict[str, Any]:
    """Persist a coarse 0–100 AML score on the user row (deterministic heuristics)."""
    user = await db.users.find_one({"uid": uid}) or {}
    kyc = await db.kyc.find_one({"uid": uid}) or {}
    score = 5.0
    factors: List[str] = []
    if kyc.get("pep_flag"):
        score += 22.0
        factors.append("pep")
    if kyc.get("sanctions_flag"):
        score += 40.0
        factors.append("manual_sanctions_flag")
    scr = kyc.get("screening") or {}
    if scr.get("name_screening", {}).get("hits"):
        score += min(35.0, 10.0 + 5.0 * len(scr["name_screening"]["hits"]))
        factors.append("sanctions_screening_hit")
    recent_wd = await db.withdrawal_requests.count_documents(
        {
            "uid": uid,
            "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()},
            "status": {"$nin": ["rejected", "failed"]},
        }
    )
    if recent_wd >= 3:
        score += 12.0
        factors.append("withdraw_velocity")
    if bool(user.get("user_trading_paused")) or bool(user.get("user_withdrawals_paused")):
        score += 8.0
        factors.append("admin_restrictions")
    score = round(min(100.0, score), 2)
    now = _now_iso()
    await db.users.update_one(
        {"uid": uid},
        {"$set": {"aml_risk_score": score, "aml_risk_factors": factors, "aml_risk_updated_at": now}},
    )
    await db.user_risk_profiles.update_one(
        {"uid": uid},
        {"$set": {"uid": uid, "aml_risk_score": score, "factors": factors, "updated_at": now}},
        upsert=True,
    )
    return {"uid": uid, "aml_risk_score": score, "aml_risk_factors": factors}


async def apply_auto_unfreeze(db, user: Dict[str, Any]) -> Dict[str, Any]:
    """Clear freeze metadata + pause flags when ``account_frozen_until`` is in the past."""
    uid = user.get("uid")
    until = user.get("account_frozen_until")
    if not uid or not until:
        return user
    try:
        dt = datetime.fromisoformat(str(until).replace("Z", "+00:00"))
    except Exception:
        return user
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if dt > datetime.now(timezone.utc):
        return user
    await db.users.update_one(
        {"uid": uid},
        {
            "$set": {
                "user_features_paused": False,
                "user_trading_paused": False,
                "user_withdrawals_paused": False,
                "user_pause_note": "",
                "account_frozen_until": None,
                "account_frozen_at": None,
                "account_frozen_by": None,
                "account_frozen_reason": None,
                "account_frozen_scope": None,
            }
        },
    )
    return await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0}) or user


async def record_account_restriction_event(
    db,
    *,
    uid: str,
    action: str,
    scope: str,
    reason: str,
    admin_aid: Optional[str],
    frozen_until: Optional[str] = None,
) -> None:
    await db.account_restriction_events.insert_one(
        {
            "id": f"are_{uuid.uuid4().hex[:14]}",
            "uid": uid,
            "action": action,
            "scope": scope,
            "reason": reason,
            "frozen_until": frozen_until,
            "admin_aid": admin_aid,
            "created_at": _now_iso(),
        }
    )


async def seed_default_compliance_rules(db) -> None:
    if await db.compliance_rules.count_documents({}) > 0:
        return
    now = _now_iso()
    rows = [
        {
            "id": "rule_builtin_large_trade",
            "name": "Large single trade",
            "enabled": True,
            "rule_kind": "builtin_large_trade",
            "params": {"threshold_usdt": 25000.0},
            "severity_default": "high",
            "created_at": now,
            "updated_at": now,
        },
        {
            "id": "rule_builtin_high_turnover",
            "name": "High daily turnover",
            "enabled": True,
            "rule_kind": "builtin_high_turnover",
            "params": {"threshold_usdt": 100000.0},
            "severity_default": "medium",
            "created_at": now,
            "updated_at": now,
        },
        {
            "id": "rule_builtin_withdraw_velocity",
            "name": "Withdrawal velocity (24h)",
            "enabled": True,
            "rule_kind": "builtin_withdraw_velocity",
            "params": {"count_24h": 3},
            "severity_default": "medium",
            "created_at": now,
            "updated_at": now,
        },
    ]
    await db.compliance_rules.insert_many(rows)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def submit_fiu_report(
    db,
    *,
    report_id: str,
    admin_aid: Optional[str],
) -> Dict[str, Any]:
    """Mark report submitted, store submission row, optional webhook to ``FIU_WEBHOOK_URL``."""
    import httpx

    row = await db.compliance_reports.find_one({"id": report_id}, {"_id": 0})
    if not row:
        return {"ok": False, "error": "not_found"}
    payload_b64 = row.get("payload_b64") or ""
    raw = base64.b64decode(payload_b64) if payload_b64 else b""
    h = hashlib.sha256(raw).hexdigest()
    sub_id = f"fiu_{uuid.uuid4().hex[:14]}"
    now = _now_iso()
    url = (os.environ.get("FIU_WEBHOOK_URL") or "").strip()
    ext_ref = None
    channel = "internal_db_only"
    status = "submitted"
    err = None
    if url:
        channel = "webhook"
        body = {
            "submission_id": sub_id,
            "report_id": report_id,
            "report_type": row.get("report_type"),
            "payload_sha256": h,
            "rows_count": row.get("rows_count"),
            "created_at": row.get("created_at"),
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(url, json=body)
                ext_ref = f"http_{r.status_code}"
                if r.status_code >= 400:
                    status = "failed"
                    err = r.text[:500]
        except Exception as exc:  # noqa: BLE001
            status = "failed"
            err = str(exc)[:500]

    await db.fiu_submissions.insert_one(
        {
            "id": sub_id,
            "report_id": report_id,
            "payload_sha256": h,
            "status": status,
            "channel": channel,
            "external_ref": ext_ref,
            "error": err,
            "submitted_at": now,
            "submitted_by": admin_aid,
        }
    )
    await db.compliance_reports.update_one(
        {"id": report_id},
        {
            "$set": {
                "fiu_status": "submitted" if status != "failed" else "failed",
                "fiu_submitted_at": now,
                "fiu_submitted_by": admin_aid,
                "fiu_submission_id": sub_id,
                "fiu_channel": channel,
                "fiu_external_ref": ext_ref,
                "fiu_last_error": err,
            }
        },
    )
    return {
        "ok": status != "failed",
        "submission_id": sub_id,
        "fiu_status": "submitted" if status != "failed" else "failed",
        "channel": channel,
        "error": err,
    }
