"""MaxByte P2P admin routes — mounted at /api/admin/p2p/*.

Provides:
  • KPI stats dashboard
  • Dispute queue management (assign / resolve / freeze / escalate / request evidence)
  • P2P-specific user ban / unban
  • Ad moderation (list all, suspend/restore)
  • Order monitoring (list all)
  • Merchant applications (approve / suspend)
  • Fraud intelligence panel (duplicate UTR, multi-account IP/UPI, past disputes)
  • Internal admin notes
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query

from services.db import get_db
from services import wallet_service, ibo_fee as ibo_fee_svc
from services.errors import InsufficientFundsError
from .api import (
    _charge_p2p_taker_fee_ibo,
    _compute_p2p_taker_fee,
    _resolve_taker_fee_pct,
)
from .deps import current_admin
from .models import (
    DisputeResolve, P2PBanRequest, DisputeAdminNote,
    DisputeFreezeRequest, DisputeEscalateRequest, DisputeRequestEvidence,
    MerchantAdminAction,
)

log = logging.getLogger("p2p.admin")
router = APIRouter(prefix="/api/admin/p2p", tags=["admin-p2p"])

D = Decimal
ZERO = Decimal("0")
DEFAULT_TAKER_FEE_PCT = D("0.2")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _strip(d: dict) -> dict:
    if not d:
        return d
    d.pop("_id", None)
    return d


def _d(v) -> Decimal:
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError):
        return ZERO


def _admin_id(admin: dict) -> str:
    return admin.get("email") or admin.get("aid") or "admin"


# ─────────────────────────────────────────────────────────────────────────────
# KPI Stats (dashboard-friendly endpoint)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/kpis")
async def kpis(admin=Depends(current_admin)):
    """Compact KPI endpoint shaped exactly for the admin dashboard."""
    db = get_db()
    active_ads       = await db.p2p_ads.count_documents({"status": "active"})
    open_orders      = await db.p2p_orders.count_documents({"status": {"$in": ["in_progress", "paid_marked"]}})
    open_disputes    = await db.p2p_disputes.count_documents({"status": {"$in": ["open", "investigating", "frozen", "evidence_requested"]}})
    pending_merchants = await db.p2p_merchants.count_documents({"status": "pending"})
    banned_users     = await db.p2p_user_stats.count_documents({"is_banned_until": {"$ne": None}})

    cutoff_24h = (_now() - timedelta(hours=24)).isoformat()
    vol_inr = 0.0
    trades_24h = 0
    pipeline = [
        {"$match": {"status": "completed", "completed_at": {"$gte": cutoff_24h}}},
        {"$group": {"_id": None,
                    "total_inr": {"$sum": {"$toDouble": "$fiat_amount"}},
                    "count": {"$sum": 1}}},
    ]
    async for r in db.p2p_orders.aggregate(pipeline):
        vol_inr    = round(float(r.get("total_inr") or 0), 2)
        trades_24h = int(r.get("count") or 0)

    return {
        "active_ads": active_ads,
        "open_orders": open_orders,
        "open_disputes": open_disputes,
        "pending_merchants": pending_merchants,
        "banned_users": banned_users,
        "volume_24h_inr": vol_inr,
        "trades_24h": trades_24h,
    }


@router.get("/stats")
async def stats(admin=Depends(current_admin)):
    db = get_db()
    open_count = await db.p2p_disputes.count_documents({"status": {"$in": ["open", "investigating"]}})
    today_iso = _now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    completed_today = await db.p2p_orders.count_documents(
        {"status": "completed", "completed_at": {"$gte": today_iso}}
    )
    active_ads = await db.p2p_ads.count_documents({"status": "active"})
    banned_users = await db.p2p_user_stats.count_documents({"is_banned_until": {"$ne": None}})
    pending_merchants = await db.p2p_merchants.count_documents({"status": "pending"})

    # Avg resolution time (last 30 days)
    cutoff = (_now() - timedelta(days=30)).isoformat()
    pipeline = [
        {"$match": {"status": "resolved", "resolved_at": {"$gte": cutoff}}},
        {"$project": {
            "diff_min": {"$divide": [
                {"$subtract": [
                    {"$dateFromString": {"dateString": "$resolved_at"}},
                    {"$dateFromString": {"dateString": "$created_at"}},
                ]},
                60000,
            ]}
        }},
        {"$group": {"_id": None, "avg": {"$avg": "$diff_min"}, "count": {"$sum": 1}}},
    ]
    avg_min = 0
    resolved_30d = 0
    async for r in db.p2p_disputes.aggregate(pipeline):
        avg_min = round(r.get("avg") or 0, 1)
        resolved_30d = r.get("count") or 0

    # P2P volume today
    vol_pipeline = [
        {"$match": {"status": "completed", "completed_at": {"$gte": today_iso}}},
        {"$group": {"_id": "$asset", "volume": {"$sum": {"$toDouble": "$crypto_amount"}}}},
    ]
    volume_by_asset: dict = {}
    async for r in db.p2p_orders.aggregate(vol_pipeline):
        volume_by_asset[r["_id"]] = round(r.get("volume") or 0, 6)

    return {
        "open_disputes": open_count,
        "completed_today": completed_today,
        "active_ads": active_ads,
        "banned_users": banned_users,
        "pending_merchants": pending_merchants,
        "avg_resolution_minutes_30d": avg_min,
        "resolved_30d": resolved_30d,
        "sla_target_minutes": 120,
        "volume_today": volume_by_asset,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Ads moderation
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/ads")
async def list_all_ads(
    status: str | None = Query(None),
    side: str | None = Query(None),
    asset: str | None = Query(None),
    user_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    admin=Depends(current_admin),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if side:
        q["side"] = side
    if asset:
        q["asset"] = asset.upper()
    if user_id:
        q["user_id"] = user_id
    rows = []
    async for ad in db.p2p_ads.find(q).sort("created_at", -1).skip(skip).limit(limit):
        rows.append(_strip(ad))
    total = await db.p2p_ads.count_documents(q)
    return {"ads": rows, "total": total}


@router.post("/ads/{ad_id}/suspend")
async def suspend_ad(ad_id: str, admin=Depends(current_admin)):
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": ad_id})
    if not ad:
        raise HTTPException(404, "Ad not found")
    await db.p2p_ads.update_one(
        {"ad_id": ad_id},
        {"$set": {"status": "suspended", "suspended_by": _admin_id(admin),
                  "suspended_at": _now_iso(), "updated_at": _now_iso()}},
    )
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.ad.suspend", "target_id": ad_id, "category": "p2p",
    })
    return {"ok": True, "status": "suspended"}


@router.post("/ads/{ad_id}/restore")
async def restore_ad(ad_id: str, admin=Depends(current_admin)):
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": ad_id})
    if not ad:
        raise HTTPException(404, "Ad not found")
    await db.p2p_ads.update_one(
        {"ad_id": ad_id},
        {"$set": {"status": "active", "updated_at": _now_iso()}},
    )
    return {"ok": True, "status": "active"}


# ─────────────────────────────────────────────────────────────────────────────
# Order monitoring
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/orders")
async def list_all_orders(
    status: str | None = Query(None),
    asset: str | None = Query(None),
    user_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    admin=Depends(current_admin),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if asset:
        q["asset"] = asset.upper()
    if user_id:
        q["$or"] = [{"buyer_id": user_id}, {"seller_id": user_id}]
    rows = []
    async for o in db.p2p_orders.find(q).sort("created_at", -1).skip(skip).limit(limit):
        rows.append(_strip(o))
    total = await db.p2p_orders.count_documents(q)
    return {"orders": rows, "total": total}


# ─────────────────────────────────────────────────────────────────────────────
# Dispute queue
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/disputes")
async def list_disputes(
    status: str | None = Query(None),
    reason: str | None = Query(None),
    sort: str = Query("oldest", description="oldest|newest|amount"),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    admin=Depends(current_admin),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if reason:
        q["reason"] = reason
    sort_spec = (
        [("created_at", 1)] if sort == "oldest"
        else [("crypto_amount", -1)] if sort == "amount"
        else [("created_at", -1)]
    )
    rows = []
    async for d in db.p2p_disputes.find(q).sort(sort_spec).skip(skip).limit(limit):
        try:
            age_min = int((_now() - datetime.fromisoformat(d["created_at"])).total_seconds() / 60)
        except Exception:
            age_min = 0
        d["age_minutes"] = age_min
        d["sla_breached"] = age_min > 120 and d["status"] in ("open", "investigating")
        rows.append(_strip(d))
    total = await db.p2p_disputes.count_documents(q)
    return {"disputes": rows, "total": total}


@router.get("/disputes/{dispute_id}")
async def dispute_detail(dispute_id: str, admin=Depends(current_admin)):
    """Full dispute view: parties, evidence, complete chat transcript, order details."""
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    o = await db.p2p_orders.find_one({"order_id": d["order_id"]}) or {}
    msgs = []
    async for m in db.p2p_messages.find({"order_id": d["order_id"]}).sort("created_at", 1):
        msgs.append(_strip(m))
    parties: dict = {}
    for role, uid in (("buyer", d["buyer_id"]), ("seller", d["seller_id"])):
        u = await db.users.find_one({"uid": uid}, {"email": 1, "uid": 1, "kyc_status": 1}) or {}
        s = await db.p2p_user_stats.find_one({"user_id": uid}) or {}
        parties[role] = {
            "user_id": uid,
            "email": u.get("email"),
            "nickname": s.get("nickname"),
            "trades_total": s.get("trades_total", 0),
            "completion_rate_30d": s.get("completion_rate_30d", 100.0),
            "is_banned_until": s.get("is_banned_until"),
            "cancellation_strikes_24h": s.get("cancellation_strikes_24h", 0),
            "kyc_status": u.get("kyc_status"),
        }
    return {
        "dispute": _strip(d),
        "order": _strip(o),
        "messages": msgs,
        "parties": parties,
    }


@router.post("/disputes/{dispute_id}/assign")
async def assign_dispute(dispute_id: str, admin=Depends(current_admin)):
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    if d["status"] not in ("open", "investigating"):
        raise HTTPException(400, f"Dispute is already '{d['status']}'")
    await db.p2p_disputes.update_one(
        {"dispute_id": dispute_id},
        {"$set": {
            "status": "investigating",
            "assigned_admin_id": _admin_id(admin),
            "assigned_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
    )
    from .api import _broadcast_order
    await _broadcast_order(d["order_id"], "appeal", {
        "event": "admin_assigned", "dispute_id": dispute_id, "assigned_at": _now_iso(),
    })
    return {"ok": True, "status": "investigating"}


@router.post("/disputes/{dispute_id}/resolve")
async def resolve_dispute(dispute_id: str, body: DisputeResolve, admin=Depends(current_admin)):
    """Final admin ruling — settles the underlying order accordingly."""
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    if d["status"] not in ("open", "investigating", "frozen", "evidence_requested"):
        raise HTTPException(400, f"Dispute is already '{d['status']}'")
    o = await db.p2p_orders.find_one({"order_id": d["order_id"]})
    if not o:
        raise HTTPException(404, "Underlying order not found")

    crypto = _d(o["crypto_amount"])
    fee_pct = await _resolve_taker_fee_pct(db)
    price_d = _d(o.get("price") or "1")
    fiat = str(o.get("fiat") or "INR")
    _, _, fee_usdt = await _compute_p2p_taker_fee(
        db,
        crypto_amount=crypto,
        price_fiat=price_d,
        fiat=fiat,
        fee_pct=fee_pct,
    )

    if body.resolution == "release_to_buyer":
        net = crypto
        if fee_usdt > ZERO:
            try:
                ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()
                fee_ibo_est = ibo_fee_svc.usdt_notional_to_ibo_fee(float(fee_usdt), ibo_px)
                await ibo_fee_svc.ensure_ibo_fee_balance(
                    o["taker_id"], fee_ibo_est, context="P2P"
                )
            except InsufficientFundsError as exc:
                raise HTTPException(
                    400,
                    f"Cannot complete release — taker has insufficient IBO for fee: {exc}",
                ) from exc
        fee_ibo_charged = 0.0
        try:
            await wallet_service.debit_locked(
                o["seller_id"], o["asset"], float(crypto),
                txn_type="trade", ref_type="p2p_dispute", ref_id=dispute_id,
                meta={"action": "p2p_dispute_release_to_buyer"},
            )
        except InsufficientFundsError:
            log.error("p2p dispute resolve: debit_locked failed for order %s", o["order_id"])
            raise HTTPException(500, "Settlement error — contact engineering")
        await wallet_service.credit(
            o["buyer_id"], o["asset"], float(net),
            txn_type="trade", ref_type="p2p_dispute", ref_id=dispute_id,
            meta={"action": "p2p_dispute_credit_buyer"},
        )
        if fee_usdt > ZERO:
            try:
                fee_ibo_charged = await _charge_p2p_taker_fee_ibo(
                    o["taker_id"],
                    fee_usdt,
                    order_id=o["order_id"],
                    precheck_balance=False,
                    meta={"action": "p2p_dispute_taker_fee", "dispute_id": dispute_id},
                )
            except InsufficientFundsError as exc:
                log.error(
                    "p2p dispute: IBO fee failed after crypto settled order=%s",
                    o["order_id"],
                )
                raise HTTPException(500, f"Fee settlement failed: {exc}") from exc
        await db.p2p_orders.update_one(
            {"order_id": o["order_id"]},
            {"$set": {
                "status": "completed",
                "fee_amount_crypto": "0",
                "fee_amount_ibo": str(fee_ibo_charged),
                "fee_asset": ibo_fee_svc.FEE_ASSET,
                "fee_usdt_notional": str(fee_usdt),
                "completed_at": _now_iso(),
                "completed_via_dispute": True,
                "updated_at": _now_iso(),
            }},
        )
        await db.p2p_ads.update_one(
            {"ad_id": o["ad_id"], "active_orders_count": {"$gt": 0}},
            {"$inc": {"active_orders_count": -1, "completed_orders_count": 1},
             "$set": {"updated_at": _now_iso()}},
        )
        outcome_msg = (
            f"Admin ruled for BUYER. {net} {o['asset']} released "
            f"(taker fee: {fee_ibo_charged} {ibo_fee_svc.FEE_ASSET})."
        )
        final_order_status = "completed"
    else:
        # Refund to seller — restore ad escrow
        cur_ad = await db.p2p_ads.find_one({"ad_id": o["ad_id"]})
        new_avail = _d((cur_ad or {}).get("available_amount", "0")) + crypto
        await db.p2p_ads.update_one(
            {"ad_id": o["ad_id"], "active_orders_count": {"$gt": 0}},
            {"$inc": {"active_orders_count": -1},
             "$set": {"available_amount": str(new_avail), "updated_at": _now_iso()}},
        )
        # For BUY ads, taker crypto was locked per-order → unlock it
        if o["side"] == "buy":
            try:
                await wallet_service.unlock(
                    o["taker_id"], o["asset"], float(crypto),
                    ref_type="p2p_dispute", ref_id=dispute_id,
                    meta={"action": "p2p_dispute_refund_to_seller"},
                )
            except InsufficientFundsError:
                log.warning("p2p dispute resolve: unlock failed for order %s", o["order_id"])
        # For SELL ads, crypto stays locked at ad level — available_amount restored above
        await db.p2p_orders.update_one(
            {"order_id": o["order_id"]},
            {"$set": {
                "status": "refunded", "refunded_at": _now_iso(),
                "refunded_via_dispute": True, "updated_at": _now_iso(),
            }},
        )
        outcome_msg = f"Admin ruled for SELLER. {crypto} {o['asset']} returned to seller's ad escrow."
        final_order_status = "refunded"

    await db.p2p_disputes.update_one(
        {"dispute_id": dispute_id},
        {"$set": {
            "status": "resolved",
            "resolution": body.resolution,
            "resolution_note": body.note,
            "resolved_at": _now_iso(),
            "resolved_by_admin_id": _admin_id(admin),
            "updated_at": _now_iso(),
        }},
    )
    from .api import _post_system_message, _broadcast_order
    await _post_system_message(o["order_id"], "resolved", f"{outcome_msg} ({body.note})")
    await _broadcast_order(o["order_id"], "status",
                           {"status": final_order_status, "via_dispute": True})
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": f"p2p.dispute.{body.resolution}",
        "target_id": dispute_id, "category": "p2p", "note": body.note,
    })
    return {"ok": True, "resolution": body.resolution}


# ─────────────────────────────────────────────────────────────────────────────
# P2P bans
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/users/{user_id}/ban")
async def ban_user(user_id: str, body: P2PBanRequest, admin=Depends(current_admin)):
    db = get_db()
    until = (_now() + timedelta(hours=body.duration_hours)).isoformat()
    await db.p2p_user_stats.update_one(
        {"user_id": user_id},
        {"$set": {
            "is_banned_until": until,
            "ban_reason": body.reason,
            "banned_by": _admin_id(admin),
            "banned_at": _now_iso(),
        }},
        upsert=True,
    )
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.user.ban", "target_id": user_id, "category": "p2p",
        "note": f"{body.duration_hours}h — {body.reason}",
    })
    return {"ok": True, "banned_until": until}


@router.post("/users/{user_id}/unban")
async def unban_user(user_id: str, admin=Depends(current_admin)):
    db = get_db()
    await db.p2p_user_stats.update_one(
        {"user_id": user_id},
        {"$set": {
            "is_banned_until": None, "ban_reason": None,
            "unbanned_by": _admin_id(admin), "unbanned_at": _now_iso(),
        }},
    )
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.user.unban", "target_id": user_id, "category": "p2p",
    })
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Fraud Intelligence
# ─────────────────────────────────────────────────────────────────────────────

async def _build_intel(db, dispute: dict, order: dict) -> dict:
    findings: list[dict] = []
    risk_score = 0
    buyer_id = dispute["buyer_id"]
    seller_id = dispute["seller_id"]

    async def _brief(uid: str) -> dict:
        u = await db.users.find_one({"uid": uid},
                                     {"email": 1, "signup_ip": 1, "country": 1,
                                      "kyc_status": 1, "created_at": 1})
        if not u:
            return {"user_id": uid, "email": None}
        return {
            "user_id": uid, "email": u.get("email"),
            "signup_ip": u.get("signup_ip"), "country": u.get("country"),
            "kyc_status": u.get("kyc_status"), "created_at": u.get("created_at"),
        }

    buyer = await _brief(buyer_id)
    seller = await _brief(seller_id)

    # 1. Duplicate UTR scan
    utr_candidates: list[str] = []
    if order.get("buyer_paid_note"):
        utr_candidates.append(order["buyer_paid_note"].strip())
    ocr = (dispute.get("ocr_result") or {}).get("fields") or {}
    if ocr.get("utr"):
        utr_candidates.append(ocr["utr"].strip())
    utr_candidates = list({x.lower(): x for x in utr_candidates}.values())
    duplicate_utr_orders: list[dict] = []
    for utr in utr_candidates:
        if not utr:
            continue
        async for row in db.p2p_orders.find(
            {"buyer_paid_note": {"$regex": f".*{utr}.*", "$options": "i"},
             "order_id": {"$ne": order["order_id"]}},
            {"order_id": 1, "buyer_id": 1, "seller_id": 1, "fiat_amount": 1,
             "status": 1, "created_at": 1, "_id": 0},
        ).limit(20):
            duplicate_utr_orders.append({**row, "matched_utr": utr})
    if duplicate_utr_orders:
        risk_score += min(50, 25 * len(duplicate_utr_orders))
        findings.append({
            "key": "duplicate_utr", "severity": "high",
            "label": "Duplicate UTR detected",
            "detail": f"UTR appears on {len(duplicate_utr_orders)} other order(s)",
        })

    # 2. Multi-account by signup IP
    ip_matches_buyer: list[dict] = []
    ip_matches_seller: list[dict] = []
    for tag, party, store in (("buyer", buyer, ip_matches_buyer), ("seller", seller, ip_matches_seller)):
        ip = party.get("signup_ip")
        if not ip or ip in ("unknown", "127.0.0.1"):
            continue
        async for row in db.users.find(
            {"signup_ip": ip, "uid": {"$ne": party["user_id"]}},
            {"email": 1, "uid": 1, "kyc_status": 1, "created_at": 1},
        ).limit(10):
            store.append({
                "user_id": row.get("uid"), "email": row.get("email"),
                "kyc_status": row.get("kyc_status"), "shared_ip": ip, "shared_with": tag,
            })
    if ip_matches_buyer or ip_matches_seller:
        n = len(ip_matches_buyer) + len(ip_matches_seller)
        risk_score += min(40, 15 * n)
        findings.append({
            "key": "multi_account_ip",
            "severity": "high" if n >= 2 else "medium",
            "label": "Multi-account on same IP",
            "detail": f"{n} other account(s) signed up from the same IP",
        })

    # 3. Multi-account by UPI handle
    upi_matches: list[dict] = []
    for tag, uid in (("buyer", buyer_id), ("seller", seller_id)):
        async for pm in db.p2p_payment_methods.find(
            {"user_id": uid, "type": "UPI", "upi_id": {"$ne": None}},
            {"upi_id": 1, "user_id": 1, "_id": 0},
        ).limit(5):
            upi = (pm.get("upi_id") or "").strip().lower()
            if not upi:
                continue
            async for row in db.p2p_payment_methods.find(
                {"upi_id": {"$regex": f"^{upi}$", "$options": "i"},
                 "user_id": {"$ne": pm["user_id"]}},
                {"user_id": 1, "upi_id": 1, "_id": 0},
            ).limit(5):
                upi_matches.append({
                    "user_id": row["user_id"], "upi_id": row.get("upi_id"), "shared_with": tag,
                })
    if upi_matches:
        risk_score += min(30, 12 * len(upi_matches))
        findings.append({
            "key": "multi_account_upi", "severity": "high",
            "label": "UPI used by another account",
            "detail": f"{len(upi_matches)} other account(s) share the same UPI",
        })

    # 4. Prior disputes
    for tag, uid in (("buyer", buyer_id), ("seller", seller_id)):
        prior = await db.p2p_disputes.count_documents({
            "$or": [{"buyer_id": uid}, {"seller_id": uid}],
            "dispute_id": {"$ne": dispute["dispute_id"]},
        })
        if prior >= 2:
            risk_score += 10
            findings.append({
                "key": f"prior_disputes_{tag}", "severity": "medium",
                "label": f"{tag.title()} has {prior} prior disputes",
                "detail": "Recurring participant in P2P disputes",
            })

    # 5. Account age
    for tag, party in (("buyer", buyer), ("seller", seller)):
        ca = party.get("created_at")
        if not ca:
            continue
        try:
            age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(str(ca))).days
        except Exception:
            continue
        if age_days < 7:
            risk_score += 8
            findings.append({
                "key": f"new_account_{tag}", "severity": "medium",
                "label": f"{tag.title()} account is new",
                "detail": f"Created {age_days} day(s) ago",
            })

    # 6. KYC missing
    for tag, party in (("buyer", buyer), ("seller", seller)):
        if party.get("kyc_status") != "approved":
            risk_score += 12
            findings.append({
                "key": f"kyc_missing_{tag}", "severity": "medium",
                "label": f"{tag.title()} not KYC-approved",
                "detail": f"KYC status: {party.get('kyc_status') or 'none'}",
            })

    risk_score = min(100, risk_score)
    return {
        "risk_score": risk_score,
        "risk_band": "low" if risk_score < 30 else "medium" if risk_score < 60 else "high",
        "findings": findings,
        "duplicate_utr_orders": duplicate_utr_orders,
        "multi_account": {
            "by_ip_buyer": ip_matches_buyer,
            "by_ip_seller": ip_matches_seller,
            "by_upi": upi_matches,
        },
        "buyer": buyer,
        "seller": seller,
    }


@router.get("/disputes/{dispute_id}/intel")
async def dispute_intel(dispute_id: str, admin=Depends(current_admin)):
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    o = await db.p2p_orders.find_one({"order_id": d["order_id"]})
    if not o:
        raise HTTPException(404, "Order not found")
    return await _build_intel(db, d, o)


# ─────────────────────────────────────────────────────────────────────────────
# Admin notes
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/disputes/{dispute_id}/notes")
async def list_admin_notes(dispute_id: str, admin=Depends(current_admin)):
    db = get_db()
    notes = []
    async for n in db.p2p_admin_notes.find({"dispute_id": dispute_id}).sort("at", -1).limit(50):
        notes.append(_strip(n))
    return {"notes": notes}


@router.post("/disputes/{dispute_id}/notes")
async def add_admin_note(dispute_id: str, body: DisputeAdminNote, admin=Depends(current_admin)):
    db = get_db()
    if not await db.p2p_disputes.find_one({"dispute_id": dispute_id}):
        raise HTTPException(404, "Dispute not found")
    note = {"dispute_id": dispute_id, "body": body.body, "author": _admin_id(admin), "at": _now_iso()}
    await db.p2p_admin_notes.insert_one(note.copy())
    note.pop("_id", None)
    return {"ok": True, "note": note}


# ─────────────────────────────────────────────────────────────────────────────
# Dispute actions: freeze / request evidence / escalate
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/disputes/{dispute_id}/freeze")
async def freeze_dispute(dispute_id: str, body: DisputeFreezeRequest, admin=Depends(current_admin)):
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    if d["status"] in ("resolved", "rejected"):
        raise HTTPException(400, f"Dispute is already '{d['status']}'")
    await db.p2p_disputes.update_one(
        {"dispute_id": dispute_id},
        {"$set": {"status": "frozen", "freeze_reason": body.reason,
                  "frozen_by": _admin_id(admin), "frozen_at": _now_iso(), "updated_at": _now_iso()}},
    )
    from .api import _post_system_message, _broadcast_order
    await _post_system_message(d["order_id"], "frozen",
                               f"Admin has frozen this trade pending investigation: {body.reason}")
    await _broadcast_order(d["order_id"], "appeal", {"event": "frozen", "dispute_id": dispute_id})
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.dispute.freeze", "target_id": dispute_id, "category": "p2p",
        "note": body.reason,
    })
    return {"ok": True, "status": "frozen"}


@router.post("/disputes/{dispute_id}/request-evidence")
async def request_more_evidence(dispute_id: str, body: DisputeRequestEvidence, admin=Depends(current_admin)):
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    target_label = "Buyer" if body.target == "buyer" else "Seller" if body.target == "seller" else "Both parties"
    await db.p2p_disputes.update_one(
        {"dispute_id": dispute_id},
        {"$set": {"status": "evidence_requested",
                  "evidence_request": {"target": body.target, "note": body.note,
                                        "by": _admin_id(admin), "at": _now_iso()},
                  "updated_at": _now_iso()}},
    )
    from .api import _post_system_message, _broadcast_order
    await _post_system_message(d["order_id"], "evidence_requested",
                               f"Admin has requested more evidence from {target_label}: {body.note}")
    await _broadcast_order(d["order_id"], "appeal",
                           {"event": "evidence_requested", "dispute_id": dispute_id, "target": body.target})
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.dispute.request_evidence", "target_id": dispute_id, "category": "p2p",
        "note": f"target={body.target}; {body.note}",
    })
    return {"ok": True, "target": body.target}


@router.post("/disputes/{dispute_id}/escalate")
async def escalate_dispute(dispute_id: str, body: DisputeEscalateRequest, admin=Depends(current_admin)):
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    await db.p2p_disputes.update_one(
        {"dispute_id": dispute_id},
        {"$set": {
            "priority": body.priority, "escalated": True,
            "escalated_by": _admin_id(admin),
            "escalation_note": body.note, "escalated_at": _now_iso(), "updated_at": _now_iso(),
        }},
    )
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.dispute.escalate", "target_id": dispute_id, "category": "p2p",
        "note": f"priority={body.priority}; {body.note}",
    })
    return {"ok": True, "priority": body.priority}


# ─────────────────────────────────────────────────────────────────────────────
# Merchant management (Phase 4)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/merchants")
async def list_merchants(
    status: str | None = Query(None, description="pending|approved|suspended"),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    admin=Depends(current_admin),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    rows = []
    async for m in db.p2p_merchants.find(q).sort("applied_at", -1).skip(skip).limit(limit):
        rows.append(_strip(m))
    total = await db.p2p_merchants.count_documents(q)
    return {"merchants": rows, "total": total}


@router.post("/merchants/{merchant_id}/approve")
async def approve_merchant(merchant_id: str, admin=Depends(current_admin)):
    db = get_db()
    m = await db.p2p_merchants.find_one({"merchant_id": merchant_id})
    if not m:
        raise HTTPException(404, "Merchant application not found")
    if m["status"] != "pending":
        raise HTTPException(400, f"Application is '{m['status']}', not pending")
    await db.p2p_merchants.update_one(
        {"merchant_id": merchant_id},
        {"$set": {"status": "approved", "approved_at": _now_iso(), "approved_by": _admin_id(admin)}},
    )
    # Mark user as merchant in stats
    await db.p2p_user_stats.update_one(
        {"user_id": m["user_id"]}, {"$set": {"is_merchant": True}}, upsert=True
    )
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.merchant.approve", "target_id": merchant_id, "category": "p2p",
    })
    return {"ok": True, "status": "approved"}


@router.post("/merchants/{merchant_id}/suspend")
async def suspend_merchant(merchant_id: str, body: MerchantAdminAction, admin=Depends(current_admin)):
    db = get_db()
    m = await db.p2p_merchants.find_one({"merchant_id": merchant_id})
    if not m:
        raise HTTPException(404, "Merchant application not found")
    await db.p2p_merchants.update_one(
        {"merchant_id": merchant_id},
        {"$set": {
            "status": "suspended",
            "suspended_at": _now_iso(),
            "suspended_by": _admin_id(admin),
            "suspend_reason": body.reason,
        }},
    )
    await db.p2p_user_stats.update_one(
        {"user_id": m["user_id"]}, {"$set": {"is_merchant": False}}, upsert=True
    )
    await db.admin_audit_log.insert_one({
        "at": _now_iso(), "actor": _admin_id(admin),
        "action": "p2p.merchant.suspend", "target_id": merchant_id, "category": "p2p",
        "note": body.reason or "",
    })
    return {"ok": True, "status": "suspended"}


from pydantic import BaseModel as _BM

class _MerchantReview(_BM):
    action: str  # approve | reject | suspend
    rejection_reason: str | None = None
    reason: str | None = None


@router.post("/merchants/{merchant_id}/review")
async def review_merchant(merchant_id: str, body: _MerchantReview, admin=Depends(current_admin)):
    """Single endpoint that handles approve / reject / suspend actions."""
    db = get_db()
    m = await db.p2p_merchants.find_one({"merchant_id": merchant_id})
    if not m:
        raise HTTPException(404, "Merchant application not found")

    action = body.action or ""
    reason = body.rejection_reason or body.reason or ""

    if action == "approve":
        if m["status"] not in ("pending",):
            raise HTTPException(400, f"Cannot approve: status is '{m['status']}'")
        await db.p2p_merchants.update_one(
            {"merchant_id": merchant_id},
            {"$set": {"status": "approved", "approved_at": _now_iso(), "approved_by": _admin_id(admin)}},
        )
        await db.p2p_user_stats.update_one(
            {"user_id": m["user_id"]}, {"$set": {"is_merchant": True}}, upsert=True
        )
        await db.admin_audit_log.insert_one({
            "at": _now_iso(), "actor": _admin_id(admin),
            "action": "p2p.merchant.approve", "target_id": merchant_id, "category": "p2p",
        })
        return {"ok": True, "status": "approved"}

    elif action in ("reject", "suspend"):
        new_status = "rejected" if action == "reject" else "suspended"
        await db.p2p_merchants.update_one(
            {"merchant_id": merchant_id},
            {"$set": {
                "status": new_status,
                "rejection_reason": reason,
                f"{new_status}_at": _now_iso(),
                f"{new_status}_by": _admin_id(admin),
            }},
        )
        if action == "suspend":
            await db.p2p_user_stats.update_one(
                {"user_id": m["user_id"]}, {"$set": {"is_merchant": False}}, upsert=True
            )
        await db.admin_audit_log.insert_one({
            "at": _now_iso(), "actor": _admin_id(admin),
            "action": f"p2p.merchant.{new_status}", "target_id": merchant_id, "category": "p2p",
            "note": reason,
        })
        return {"ok": True, "status": new_status}

    raise HTTPException(400, f"Unknown action '{action}'. Use approve, reject, or suspend.")


# ─────────────────────────────────────────────────────────────────────────────
# Fraud Intelligence panel
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/fraud-intel")
async def fraud_intel(
    risk_level: str | None = Query(None, description="low|medium|high|critical"),
    is_banned: str | None = Query(None, description="true|false"),
    uid: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    admin=Depends(current_admin),
):
    """List users flagged by automated fraud intelligence scoring."""
    db = get_db()
    q: dict = {}

    if is_banned == "true":
        q["is_banned_until"] = {"$ne": None}
    elif is_banned == "false":
        q["is_banned_until"] = None

    if uid:
        q["user_id"] = {"$regex": uid, "$options": "i"}

    # Only show users with at least one fraud signal
    if not uid and not is_banned:
        q["$or"] = [
            {"cancellation_strikes_24h": {"$gt": 0}},
            {"is_banned_until": {"$ne": None}},
            {"dispute_loss_rate": {"$gt": 0}},
        ]

    rows = []
    async for u in db.p2p_user_stats.find(q).sort("updated_at", -1).skip(skip).limit(limit):
        cancel_rate = float(u.get("cancel_rate_30d") or 0)
        completion  = float(u.get("completion_rate_30d") or 100)
        strikes     = int(u.get("cancellation_strikes_24h") or 0)
        loss_rate   = float(u.get("dispute_loss_rate") or 0)
        is_banned_doc = u.get("is_banned_until") is not None

        # Compute risk band
        score = 0
        if is_banned_doc:       score += 40
        if strikes >= 3:        score += 30
        elif strikes >= 1:      score += 15
        if loss_rate > 50:      score += 20
        elif loss_rate > 20:    score += 10
        if cancel_rate > 30:    score += 15
        if completion < 70:     score += 10

        if score >= 70:   band = "critical"
        elif score >= 45: band = "high"
        elif score >= 20: band = "medium"
        else:             band = "low"

        if risk_level and band != risk_level:
            continue

        rows.append({
            "uid": u.get("user_id"),
            "strike_count": strikes,
            "disputes_lost": u.get("disputes_lost", 0),
            "dispute_loss_rate": loss_rate,
            "cancel_rate_30d": cancel_rate,
            "completion_rate_30d": completion,
            "trades_total": u.get("trades_total", 0),
            "is_banned": is_banned_doc,
            "is_banned_until": u.get("is_banned_until"),
            "ban_reason": u.get("ban_reason"),
            "ban_expires_at": u.get("is_banned_until"),
            "risk_level": band,
            "risk_score": score,
            "last_flag_at": u.get("updated_at"),
            "updated_at": u.get("updated_at"),
        })

    total = await db.p2p_user_stats.count_documents(q)
    return {"users": rows, "total": total}
