"""MaxByte P2P REST routes.

Marketplace (browse + filter ads), ad CRUD with escrow, payment-method CRUD,
order lifecycle, chat, disputes, OCR, ratings, merchant apply, user profiles.

Escrow model using MaxByte wallet_service lock/unlock primitives:
  • SELL ad created     → lock(maker, asset, total_amount)
  • SELL ad cancelled   → unlock(maker, asset, available_amount)
  • BUY order opened    → lock(taker/seller, asset, crypto_amount)
  • BUY order cancelled → unlock(taker/seller, asset, crypto_amount)
  • Order released      → debit_locked(seller, crypto_amount) + credit(buyer, full crypto);
                          taker fee charged in IBO from spot wallet
  • Dispute → seller    → (SELL ad) restore available_amount only;
                          (BUY ad) unlock(taker, crypto_amount)
  • Dispute → buyer     → same as release
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from bson import ObjectId
import pathlib
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File

from services.db import get_db
from services import wallet_service, twofa_service, ibo_fee as ibo_fee_svc
from services.errors import InsufficientFundsError
from services.bank_verification import verify_bank_or_raise

from .deps import current_user
from .models import (
    AdCreate, AdUpdate, OrderCreate,
    PaymentMethodCreate, PaymentMethodUpdate,
    MarkPaidRequest, ReleaseRequest, CancelOrderRequest,
    RateOrderRequest, MessageCreate,
    DisputeOpen, DisputeEvidence,
    MerchantApply,
    ALLOWED_FIATS, ALLOWED_ASSETS,
)

log = logging.getLogger("p2p.api")
router = APIRouter(prefix="/api/p2p", tags=["p2p"])

D = Decimal
ZERO = Decimal("0")
DEFAULT_TAKER_FEE_PCT = D("0.2")   # 0.2 %
MIN_FEE_INR = D("5")               # ₹5 floor


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:14].upper()}"


def _strip(d: dict) -> dict:
    if not d:
        return d
    d.pop("_id", None)
    return d


def _d(v) -> Decimal:
    """Safe Decimal conversion; raises HTTPException 400 on invalid input."""
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError):
        raise HTTPException(400, f"Invalid numeric value: {v!r}")


async def _require_kyc(uid: str) -> dict:
    db = get_db()
    u = await db.users.find_one({"uid": uid})
    if not u:
        raise HTTPException(401, "User not found")
    if u.get("kyc_status") != "approved":
        raise HTTPException(403, "KYC verification required for P2P trading")
    return u


async def _user_nickname(user_doc: dict) -> str:
    email = user_doc.get("email") or ""
    uid = str(user_doc.get("uid") or "")
    return f"{email[:2].title()}***{uid[-4:]}" if email else f"User-{uid[-6:]}"


async def _ensure_user_stats(uid: str) -> dict:
    """Create-on-first-use stats row for ad badges + filter gates."""
    db = get_db()
    s = await db.p2p_user_stats.find_one({"user_id": uid})
    if s:
        return s
    user = await db.users.find_one({"uid": uid})
    nickname = await _user_nickname(user) if user else f"User-{uid[-6:]}"
    doc = {
        "user_id": uid,
        "nickname": nickname,
        "joined_at": _now_iso(),
        "trades_30d": 0, "trades_total": 0,
        "completion_rate_30d": 100.0,
        "avg_release_time_seconds": 0,
        "positive_ratings": 0, "negative_ratings": 0,
        "is_merchant": False,
        "cancellation_strikes_24h": 0,
        "is_banned_until": None,
    }
    try:
        await db.p2p_user_stats.insert_one(doc)
    except Exception:
        s = await db.p2p_user_stats.find_one({"user_id": uid})
        return s or doc
    return doc


async def _floating_market_price(db, asset: str, fiat: str) -> Decimal:
    """Return the current asset/fiat price from available market data.

    Strategy:
      1. Look for a direct ticker in market_tickers (asset + fiat).
      2. For INR pairs, compute via USDT/INR rate × asset/USDT rate.
      3. Fall back to a hardcoded safety rate so the server never crashes.
    """
    asset = asset.upper()
    fiat = fiat.upper()

    # Try direct ticker
    ticker = await db.market_tickers.find_one(
        {"$or": [
            {"pair": f"{asset}/{fiat}"},
            {"symbol": f"{asset}{fiat}"},
        ]},
        sort=[("updated_at", -1)],
    )
    if ticker and ticker.get("price"):
        try:
            return D(str(ticker["price"]))
        except (InvalidOperation, TypeError):
            pass

    # Fallback: use USDT as bridge for INR pairs
    if fiat == "INR" and asset != "USDT":
        usdt_inr = await _floating_market_price(db, "USDT", "INR")
        asset_usdt = await db.market_tickers.find_one(
            {"$or": [
                {"pair": f"{asset}/USDT"},
                {"symbol": f"{asset}USDT"},
            ]},
            sort=[("updated_at", -1)],
        )
        if asset_usdt and asset_usdt.get("price"):
            try:
                return D(str(asset_usdt["price"])) * usdt_inr
            except (InvalidOperation, TypeError):
                pass

    # Last resort hardcoded fallbacks (prevents startup crash)
    fallbacks = {"USDT": D("84"), "BTC": D("7560000"), "ETH": D("255000")}
    return fallbacks.get(asset, D("84"))


async def _effective_price(ad: dict, db) -> Decimal:
    if ad.get("price_type") == "fixed":
        return _d(ad["price"])
    market = await _floating_market_price(db, ad["asset"], ad["fiat"])
    margin = _d(ad.get("margin_pct") or "0") / D("100")
    return market * (D("1") + margin)


async def _resolve_taker_fee_pct(db) -> Decimal:
    fc = await db.fee_config.find_one({"_id": "global"}) or {}
    pct = fc.get("p2p_taker_pct", float(DEFAULT_TAKER_FEE_PCT))
    try:
        return _d(str(pct))
    except Exception:
        return DEFAULT_TAKER_FEE_PCT


async def _fiat_notional_to_usdt(db, fiat: str, fiat_amount: Decimal) -> Decimal:
    amt = _d(fiat_amount)
    if amt <= ZERO:
        return ZERO
    fiat_u = str(fiat or "USDT").upper()
    if fiat_u == "USDT":
        return amt
    usdt_per_fiat = await _floating_market_price(db, "USDT", fiat_u)
    if usdt_per_fiat <= ZERO:
        return ZERO
    return (amt / usdt_per_fiat).quantize(Decimal("0.000001"))


async def _compute_p2p_taker_fee(
    db,
    *,
    crypto_amount: Decimal,
    price_fiat: Decimal,
    fiat: str,
    fee_pct: Decimal,
) -> tuple[Decimal, Decimal, Decimal]:
    """Return (fee_crypto_equiv, fee_fiat_notional, fee_usdt). Taker pays in IBO."""
    fee_crypto = (crypto_amount * fee_pct / D("100")).quantize(Decimal("0.000001"))
    if price_fiat > ZERO:
        min_fee_crypto = (MIN_FEE_INR / price_fiat).quantize(Decimal("0.000001"))
        if fee_crypto < min_fee_crypto:
            fee_crypto = min_fee_crypto
    fee_crypto = min(fee_crypto, crypto_amount * D("0.01"))
    fee_fiat = (
        (fee_crypto * price_fiat).quantize(Decimal("0.000001"))
        if price_fiat > ZERO
        else ZERO
    )
    fee_usdt = await _fiat_notional_to_usdt(db, fiat, fee_fiat)
    return fee_crypto, fee_fiat, fee_usdt


async def _charge_p2p_taker_fee_ibo(
    taker_id: str,
    fee_usdt: Decimal,
    *,
    order_id: str,
    meta: dict | None = None,
    precheck_balance: bool = True,
) -> float:
    usdt = float(fee_usdt)
    if usdt <= 1e-12:
        return 0.0
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()
    fee_ibo = ibo_fee_svc.usdt_notional_to_ibo_fee(usdt, ibo_px)
    if precheck_balance:
        await ibo_fee_svc.ensure_ibo_fee_balance(taker_id, fee_ibo, context="P2P")
    return await ibo_fee_svc.charge_ibo_fee_from_usdt(
        taker_id,
        usdt,
        ibo_price_usdt=ibo_px,
        trade_id=order_id,
        ref_type="p2p_order",
        meta=meta,
    )


# ─────────────────────────────────────────────────────────────────────────────
# WS broadcast helper (lazy import to avoid circular dependency)
# ─────────────────────────────────────────────────────────────────────────────

async def _broadcast_order(order_id: str, event: str, payload: dict | None = None):
    try:
        from . import ws as p2p_ws
        await p2p_ws.broadcast(order_id, event, payload or {})
    except Exception:
        log.debug("p2p ws broadcast suppressed", exc_info=True)


async def _post_system_message(order_id: str, kind: str, body: str):
    db = get_db()
    msg = {
        "message_id": _new_id("MSG"),
        "order_id": order_id,
        "sender_id": "system",
        "sender_role": "system",
        "kind": kind,
        "body": body,
        "attachment_url": None,
        "created_at": _now_iso(),
    }
    await db.p2p_messages.insert_one(msg)
    await _broadcast_order(order_id, "message", _strip(msg))


# ─────────────────────────────────────────────────────────────────────────────
# Payment methods CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/payment-methods")
async def list_payment_methods(user=Depends(current_user)):
    db = get_db()
    out = []
    async for pm in db.p2p_payment_methods.find({"user_id": user["uid"]}).sort("created_at", -1):
        out.append(_strip(pm))
    return {"payment_methods": out}


@router.post("/payment-methods")
async def create_payment_method(req: PaymentMethodCreate, user=Depends(current_user)):
    await _require_kyc(user["uid"])
    bank_verified = False
    verified_account_name: Optional[str] = None

    if req.type in ("UPI", "PAYTM", "PHONEPE", "GPAY"):
        if not req.upi_id or "@" not in req.upi_id:
            raise HTTPException(400, "A valid UPI ID is required for this method")
    elif req.type in ("IMPS", "BANK"):
        if not (req.bank_name and req.account_number and req.ifsc):
            raise HTTPException(400, "Bank name, account number and IFSC are required")
        if len(req.ifsc) != 11:
            raise HTTPException(400, "IFSC must be exactly 11 characters")
        # Verify bank account via Signzy before saving
        verification = await verify_bank_or_raise(
            account_number=req.account_number,
            ifsc=req.ifsc,
            holder_name=req.holder_name or None,
        )
        bank_verified = verification.active
        verified_account_name = verification.account_holder_name

    db = get_db()
    pm_id = _new_id("PM")
    doc = {
        "pm_id": pm_id,
        "user_id": user["uid"],
        "type": req.type,
        "display_name": req.display_name,
        "upi_id": req.upi_id,
        "bank_name": req.bank_name,
        "account_number": req.account_number,
        "ifsc": req.ifsc.upper() if req.ifsc else None,
        "holder_name": req.holder_name,
        "is_default": req.is_default,
        "verified": bank_verified,
        "verified_account_name": verified_account_name,
        "created_at": _now_iso(),
    }
    if req.is_default:
        await db.p2p_payment_methods.update_many(
            {"user_id": user["uid"]}, {"$set": {"is_default": False}}
        )
    await db.p2p_payment_methods.insert_one(doc)
    return _strip(doc)


@router.patch("/payment-methods/{pm_id}")
async def update_payment_method(pm_id: str, req: PaymentMethodUpdate, user=Depends(current_user)):
    db = get_db()
    pm = await db.p2p_payment_methods.find_one({"pm_id": pm_id, "user_id": user["uid"]})
    if not pm:
        raise HTTPException(404, "Payment method not found")
    update = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    if update.get("ifsc"):
        update["ifsc"] = update["ifsc"].upper()
    if update.get("is_default"):
        await db.p2p_payment_methods.update_many(
            {"user_id": user["uid"]}, {"$set": {"is_default": False}}
        )
    await db.p2p_payment_methods.update_one({"pm_id": pm_id}, {"$set": update})
    return _strip(await db.p2p_payment_methods.find_one({"pm_id": pm_id}))


@router.delete("/payment-methods/{pm_id}")
async def delete_payment_method(pm_id: str, user=Depends(current_user)):
    db = get_db()
    in_use = await db.p2p_ads.find_one({
        "user_id": user["uid"], "status": "active",
        "payment_method_ids": pm_id,
    })
    if in_use:
        raise HTTPException(400, f"Payment method is in use by ad {in_use['ad_id']}. Pause or cancel that ad first.")
    res = await db.p2p_payment_methods.delete_one({"pm_id": pm_id, "user_id": user["uid"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Payment method not found")
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Ads CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/ads")
async def create_ad(req: AdCreate, user=Depends(current_user)):
    await _require_kyc(user["uid"])
    if req.fiat not in ALLOWED_FIATS or req.asset not in ALLOWED_ASSETS:
        raise HTTPException(400, f"Unsupported asset/fiat pair. Assets: {', '.join(sorted(ALLOWED_ASSETS))}. Fiat: {', '.join(ALLOWED_FIATS)}")

    db = get_db()
    active_count = await db.p2p_ads.count_documents({
        "user_id": user["uid"], "status": {"$in": ["active", "paused"]},
    })
    if active_count >= 5:
        raise HTTPException(400, "Maximum 5 active ads per user")

    user_pms = await db.p2p_payment_methods.find(
        {"pm_id": {"$in": req.payment_method_ids}, "user_id": user["uid"]}
    ).to_list(10)
    if len(user_pms) != len(req.payment_method_ids):
        raise HTTPException(400, "One or more payment methods not found in your saved methods")

    min_inr = _d(req.min_order_inr)
    max_inr = _d(req.max_order_inr)
    total = _d(req.total_amount)
    if min_inr <= ZERO or max_inr <= ZERO or total <= ZERO:
        raise HTTPException(400, "Amounts must be > 0")
    if min_inr > max_inr:
        raise HTTPException(400, "min_order_inr cannot exceed max_order_inr")

    if req.price_type == "fixed":
        if not req.price:
            raise HTTPException(400, "Fixed-price ads require a price")
        price = _d(req.price)
        if price <= ZERO:
            raise HTTPException(400, "Price must be > 0")
    else:
        if not req.margin_pct:
            raise HTTPException(400, "Floating ads require a margin_pct")
        price = await _floating_market_price(db, req.asset, req.fiat)
        margin = _d(req.margin_pct) / D("100")
        price = price * (D("1") + margin)

    if max_inr > total * price:
        raise HTTPException(400, "max_order_inr exceeds the total amount at the listed price")

    # Escrow: SELL ads lock the full crypto amount upfront
    ad_id = _new_id("P2P-AD")
    if req.side == "sell":
        try:
            await wallet_service.lock(
                user["uid"], req.asset, float(total),
                ref_type="p2p_ad", ref_id=ad_id,
                meta={"action": "p2p_sell_ad_escrow"},
            )
        except InsufficientFundsError:
            raise HTTPException(400, f"Insufficient {req.asset} balance to post this sell ad")

    await _ensure_user_stats(user["uid"])
    user_doc = await db.users.find_one({"uid": user["uid"]})
    doc = {
        "ad_id": ad_id,
        "user_id": user["uid"],
        "user_email": (user_doc or {}).get("email"),
        "side": req.side,
        "asset": req.asset, "fiat": req.fiat,
        "price_type": req.price_type,
        "price": str(price) if req.price_type == "fixed" else None,
        "margin_pct": req.margin_pct if req.price_type == "floating" else None,
        "total_amount": str(total),
        "available_amount": str(total),
        "escrowed_amount": str(total) if req.side == "sell" else "0",
        "min_order_inr": str(min_inr),
        "max_order_inr": str(max_inr),
        "payment_method_ids": req.payment_method_ids,
        "payment_window_min": req.payment_window_min,
        "terms": req.terms,
        "auto_reply": req.auto_reply,
        "filter_kyc_tier": req.filter_kyc_tier,
        "filter_min_completed_trades": req.filter_min_completed_trades,
        "filter_min_completion_rate": req.filter_min_completion_rate,
        "status": "active",
        "active_orders_count": 0,
        "completed_orders_count": 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.p2p_ads.insert_one(doc)
    return _strip(doc)


@router.get("/ads")
async def list_ads(
    side: str = Query(..., description="buy|sell — what the viewer wants to DO"),
    asset: str = Query("USDT"),
    fiat: str = Query("INR"),
    payment_method: Optional[str] = Query(None, description="UPI|IMPS|BANK|PAYTM|PHONEPE|GPAY"),
    min_amount_inr: Optional[str] = Query(None),
    max_amount_inr: Optional[str] = Query(None),
    sort: str = Query("price", description="price|recent"),
    limit: int = Query(20, ge=1, le=100),
    skip: int = Query(0, ge=0),
):
    """Public marketplace listing.

    When viewer wants to BUY, show ads where someone is SELLING (and vice versa).
    """
    db = get_db()
    ad_side = "sell" if side == "buy" else "buy"
    q: dict = {
        "status": "active", "side": ad_side,
        "asset": asset.upper(), "fiat": fiat.upper(),
    }
    if payment_method:
        pm_ids = [
            pm["pm_id"] async for pm in db.p2p_payment_methods.find(
                {"type": payment_method.upper()}, {"pm_id": 1}
            )
        ]
        q["payment_method_ids"] = {"$in": pm_ids}
    if min_amount_inr:
        q["min_order_inr"] = {"$lte": str(_d(min_amount_inr))}
    if max_amount_inr:
        q["max_order_inr"] = {"$gte": str(_d(max_amount_inr))}

    sort_spec = (
        [("created_at", -1)] if sort == "recent"
        else [("price", 1 if ad_side == "sell" else -1)]
    )
    rows = []
    async for ad in db.p2p_ads.find(q).sort(sort_spec).skip(skip).limit(limit):
        if ad.get("price_type") == "floating":
            ad["price"] = str(await _effective_price(ad, db))
        stats = await db.p2p_user_stats.find_one({"user_id": ad["user_id"]}) or {}
        pm_types = []
        async for pm in db.p2p_payment_methods.find(
            {"pm_id": {"$in": ad["payment_method_ids"]}}, {"type": 1}
        ):
            if pm["type"] not in pm_types:
                pm_types.append(pm["type"])
        ad["maker"] = {
            "nickname": stats.get("nickname") or "Trader",
            "trades_total": stats.get("trades_total", 0),
            "completion_rate_30d": stats.get("completion_rate_30d", 100.0),
            "is_merchant": stats.get("is_merchant", False),
        }
        ad["payment_method_types"] = pm_types
        rows.append(_strip(ad))
    total_count = await db.p2p_ads.count_documents(q)
    return {"ads": rows, "total": total_count}


@router.get("/ads/mine")
async def list_my_ads(user=Depends(current_user)):
    db = get_db()
    rows = []
    async for ad in db.p2p_ads.find({"user_id": user["uid"]}).sort("created_at", -1):
        if ad.get("price_type") == "floating":
            ad["price"] = str(await _effective_price(ad, db))
        rows.append(_strip(ad))
    return {"ads": rows}


@router.get("/ads/{ad_id}")
async def ad_detail(ad_id: str):
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": ad_id})
    if not ad:
        raise HTTPException(404, "Ad not found")
    if ad.get("price_type") == "floating":
        ad["price"] = str(await _effective_price(ad, db))
    stats = await db.p2p_user_stats.find_one({"user_id": ad["user_id"]}) or {}
    pms = []
    async for pm in db.p2p_payment_methods.find({"pm_id": {"$in": ad["payment_method_ids"]}}):
        # Expose only non-PII fields publicly; full details revealed after order opens
        pms.append({"pm_id": pm["pm_id"], "type": pm["type"], "display_name": pm["display_name"]})
    ad["maker"] = {
        "nickname": stats.get("nickname") or "Trader",
        "trades_total": stats.get("trades_total", 0),
        "completion_rate_30d": stats.get("completion_rate_30d", 100.0),
        "is_merchant": stats.get("is_merchant", False),
        "joined_at": stats.get("joined_at"),
    }
    ad["payment_methods"] = pms
    return _strip(ad)


@router.patch("/ads/{ad_id}")
async def update_ad(ad_id: str, req: AdUpdate, user=Depends(current_user)):
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": ad_id, "user_id": user["uid"]})
    if not ad:
        raise HTTPException(404, "Ad not found")
    if ad["status"] not in ("active", "paused"):
        raise HTTPException(400, f"Cannot edit ad with status '{ad['status']}'")
    if ad.get("active_orders_count", 0) > 0:
        raise HTTPException(400, "Cannot edit while there are active orders against this ad")

    update = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    if update.get("payment_method_ids"):
        user_pms = await db.p2p_payment_methods.find(
            {"pm_id": {"$in": update["payment_method_ids"]}, "user_id": user["uid"]}
        ).to_list(10)
        if len(user_pms) != len(update["payment_method_ids"]):
            raise HTTPException(400, "One or more payment methods not found")
    update["updated_at"] = _now_iso()
    await db.p2p_ads.update_one({"ad_id": ad_id}, {"$set": update})
    return _strip(await db.p2p_ads.find_one({"ad_id": ad_id}))


@router.post("/ads/{ad_id}/pause")
async def pause_ad(ad_id: str, user=Depends(current_user)):
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": ad_id, "user_id": user["uid"]})
    if not ad:
        raise HTTPException(404, "Ad not found")
    if ad["status"] != "active":
        raise HTTPException(400, f"Ad is currently '{ad['status']}'")
    await db.p2p_ads.update_one(
        {"ad_id": ad_id}, {"$set": {"status": "paused", "updated_at": _now_iso()}}
    )
    return {"ok": True}


@router.post("/ads/{ad_id}/resume")
async def resume_ad(ad_id: str, user=Depends(current_user)):
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": ad_id, "user_id": user["uid"]})
    if not ad:
        raise HTTPException(404, "Ad not found")
    if ad["status"] != "paused":
        raise HTTPException(400, f"Ad is currently '{ad['status']}'")
    await db.p2p_ads.update_one(
        {"ad_id": ad_id}, {"$set": {"status": "active", "updated_at": _now_iso()}}
    )
    return {"ok": True}


@router.post("/ads/{ad_id}/cancel")
async def cancel_ad(ad_id: str, user=Depends(current_user)):
    """Cancel ad and unlock any escrowed crypto (sell side)."""
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": ad_id, "user_id": user["uid"]})
    if not ad:
        raise HTTPException(404, "Ad not found")
    if ad["status"] in ("cancelled", "completed"):
        raise HTTPException(400, f"Ad is already '{ad['status']}'")
    if ad.get("active_orders_count", 0) > 0:
        raise HTTPException(400, "Cannot cancel — there are active orders. Wait for them to complete or cancel them first.")

    # Return remaining escrowed crypto to seller's available balance
    if ad["side"] == "sell":
        refund = _d(ad.get("available_amount", "0"))
        if refund > ZERO:
            try:
                await wallet_service.unlock(
                    user["uid"], ad["asset"], float(refund),
                    ref_type="p2p_ad", ref_id=ad_id,
                    meta={"action": "p2p_sell_ad_cancelled"},
                )
            except InsufficientFundsError:
                log.warning("p2p ad cancel: unlock failed for ad %s (already unlocked?)", ad_id)

    await db.p2p_ads.update_one(
        {"ad_id": ad_id},
        {"$set": {"status": "cancelled", "available_amount": "0",
                  "escrowed_amount": "0", "updated_at": _now_iso()}},
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Orders
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/orders")
async def open_order(req: OrderCreate, user=Depends(current_user)):
    """Open a trade order against an ad. Locks crypto escrow and starts the payment window."""
    await _require_kyc(user["uid"])
    db = get_db()
    ad = await db.p2p_ads.find_one({"ad_id": req.ad_id})
    if not ad:
        raise HTTPException(404, "Ad not found")
    if ad["status"] != "active":
        raise HTTPException(400, f"Ad is not active (status: {ad['status']})")
    if ad["user_id"] == user["uid"]:
        raise HTTPException(400, "Cannot trade against your own ad")

    # Counter-party filter gates
    stats = await _ensure_user_stats(user["uid"])
    if stats.get("is_banned_until"):
        try:
            ban = datetime.fromisoformat(stats["is_banned_until"])
            if ban > _now():
                raise HTTPException(403, "Your P2P trading is temporarily suspended")
        except (ValueError, TypeError):
            pass
    if stats.get("trades_total", 0) < ad.get("filter_min_completed_trades", 0):
        raise HTTPException(403, "You do not meet this maker's minimum completed-trades requirement")
    if stats.get("completion_rate_30d", 100.0) < ad.get("filter_min_completion_rate", 0):
        raise HTTPException(403, "You do not meet this maker's completion-rate requirement")

    # Validate payment method
    pm = await db.p2p_payment_methods.find_one({"pm_id": req.payment_method_id})
    if not pm:
        raise HTTPException(404, "Payment method not found")

    seller_id = ad["user_id"] if ad["side"] == "sell" else user["uid"]
    buyer_id = user["uid"] if ad["side"] == "sell" else ad["user_id"]

    if pm["user_id"] != seller_id:
        raise HTTPException(400, "Payment method must belong to the seller")

    if ad["side"] == "sell":
        if pm["pm_id"] not in ad["payment_method_ids"]:
            raise HTTPException(400, "Selected payment method is not accepted by this ad")
    else:
        accepted_types: set[str] = set()
        async for ad_pm in db.p2p_payment_methods.find({"pm_id": {"$in": ad["payment_method_ids"]}}):
            accepted_types.add(ad_pm["type"])
        if accepted_types and pm["type"] not in accepted_types:
            raise HTTPException(
                400,
                f"Buyer does not accept {pm['type']}. Accepted: {', '.join(sorted(accepted_types))}",
            )

    # Amount math
    fiat_amt = _d(req.fiat_amount)
    if fiat_amt < _d(ad["min_order_inr"]) or fiat_amt > _d(ad["max_order_inr"]):
        raise HTTPException(400, f"Order amount must be between ₹{ad['min_order_inr']} and ₹{ad['max_order_inr']}")

    eff_price = await _effective_price(ad, db)
    crypto_amt = (fiat_amt / eff_price).quantize(Decimal("0.000001"))
    if crypto_amt > _d(ad["available_amount"]):
        raise HTTPException(400, "Order exceeds the ad's remaining liquidity")

    order_id = _new_id("P2P-ORD")

    # Escrow: BUY ads require locking the taker (seller) crypto per order
    if ad["side"] == "buy":
        try:
            await wallet_service.lock(
                user["uid"], ad["asset"], float(crypto_amt),
                ref_type="p2p_order", ref_id=order_id,
                meta={"action": "p2p_buy_ad_order_escrow"},
            )
        except InsufficientFundsError:
            raise HTTPException(400, f"Insufficient {ad['asset']} balance to fulfill this order")

    # Reserve from ad's available_amount (atomic guard)
    res = await db.p2p_ads.update_one(
        {"ad_id": req.ad_id, "available_amount": {"$gte": str(crypto_amt)}},
        {
            "$inc": {"active_orders_count": 1},
            "$set": {
                "available_amount": str(_d(ad["available_amount"]) - crypto_amt),
                "updated_at": _now_iso(),
            },
        },
    )
    if res.matched_count == 0:
        # Race condition — another order grabbed the liquidity
        if ad["side"] == "buy":
            try:
                await wallet_service.unlock(user["uid"], ad["asset"], float(crypto_amt),
                                             ref_type="p2p_order", ref_id=order_id)
            except Exception:
                pass
        raise HTTPException(400, "Ad liquidity was taken by another order. Please try again.")

    payment_window_min = ad.get("payment_window_min", 15)
    expires_at = _now() + timedelta(minutes=payment_window_min)

    order = {
        "order_id": order_id,
        "ad_id": req.ad_id,
        "asset": ad["asset"], "fiat": ad["fiat"],
        "side": ad["side"],
        "maker_id": ad["user_id"], "taker_id": user["uid"],
        "buyer_id": buyer_id, "seller_id": seller_id,
        "crypto_amount": str(crypto_amt),
        "fiat_amount": str(fiat_amt),
        "price": str(eff_price),
        "fee_amount_crypto": "0",
        "payment_method_id": req.payment_method_id,
        "payment_method_snapshot": {
            "type": pm["type"],
            "display_name": pm["display_name"],
            "upi_id": pm.get("upi_id"),
            "bank_name": pm.get("bank_name"),
            "account_number": pm.get("account_number"),
            "ifsc": pm.get("ifsc"),
            "holder_name": pm.get("holder_name"),
        },
        "status": "in_progress",
        "payment_window_expires_at": expires_at.isoformat(),
        "release_window_expires_at": None,
        "payment_proof_url": None,
        "buyer_paid_note": None,
        "buyer_marked_paid_at": None,
        "rating_by_maker": None, "rating_by_taker": None,
        "rating_by_maker_comment": None, "rating_by_taker_comment": None,
        "auto_reply_sent": False,
        "created_at": _now_iso(), "updated_at": _now_iso(),
        "completed_at": None, "cancelled_at": None,
        "release_breach_logged": False,
    }
    await db.p2p_orders.insert_one(order)

    # Send auto-reply if ad maker configured one
    if ad.get("auto_reply") and not order["auto_reply_sent"]:
        await _post_system_message(order_id, "auto_reply", ad["auto_reply"])
        await db.p2p_orders.update_one({"order_id": order_id}, {"$set": {"auto_reply_sent": True}})

    return _strip(order)


@router.get("/orders")
async def list_orders(
    status: Optional[str] = Query(None),
    role: str = Query("all", description="all|buyer|seller|maker|taker"),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    user=Depends(current_user),
):
    db = get_db()
    uid = user["uid"]
    if role == "all":
        q: dict = {"$or": [{"maker_id": uid}, {"taker_id": uid}]}
    elif role == "buyer":
        q = {"buyer_id": uid}
    elif role == "seller":
        q = {"seller_id": uid}
    elif role == "maker":
        q = {"maker_id": uid}
    else:
        q = {"taker_id": uid}
    if status:
        q["status"] = status
    rows = []
    async for o in db.p2p_orders.find(q).sort("created_at", -1).skip(skip).limit(limit):
        rows.append(_strip(o))
    total = await db.p2p_orders.count_documents(q)
    return {"orders": rows, "total": total}


@router.get("/orders/{order_id}")
async def order_detail(order_id: str, user=Depends(current_user)):
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        raise HTTPException(403, "You are not a party to this order")
    return _strip(o)


@router.get("/me/stats")
async def my_stats(user=Depends(current_user)):
    s = await _ensure_user_stats(user["uid"])
    return _strip(s)


@router.get("/users/{counterparty_id}/profile")
async def counterparty_profile(counterparty_id: str, user=Depends(current_user)):
    """Public profile of a P2P counterparty.
    Access gate: caller must share at least one order with the requested user.
    """
    db = get_db()
    if counterparty_id == user["uid"]:
        raise HTTPException(400, "Use /me/stats for your own profile")

    shared = await db.p2p_orders.find_one({
        "$or": [
            {"maker_id": user["uid"], "taker_id": counterparty_id},
            {"maker_id": counterparty_id, "taker_id": user["uid"]},
        ]
    })
    if not shared:
        raise HTTPException(403, "You have not traded with this user")

    u = await db.users.find_one({"uid": counterparty_id})
    if not u:
        raise HTTPException(404, "User not found")

    stats = await _ensure_user_stats(counterparty_id)
    nickname = stats.get("nickname") or await _user_nickname(u)

    base_q = {"$or": [{"maker_id": counterparty_id}, {"taker_id": counterparty_id}]}
    completed_total = await db.p2p_orders.count_documents({**base_q, "status": "completed"})
    cancelled_total = await db.p2p_orders.count_documents({**base_q, "status": "cancelled"})
    denom_total = completed_total + cancelled_total
    total_completion_rate = (completed_total / denom_total * 100.0) if denom_total else 100.0

    since_30d = (_now() - timedelta(days=30)).isoformat()
    completed_30d = await db.p2p_orders.count_documents(
        {**base_q, "status": "completed", "created_at": {"$gte": since_30d}}
    )
    cancelled_30d = await db.p2p_orders.count_documents(
        {**base_q, "status": "cancelled", "created_at": {"$gte": since_30d}}
    )
    denom_30d = completed_30d + cancelled_30d
    completion_rate_30d = (completed_30d / denom_30d * 100.0) if denom_30d else 100.0

    pay_times: list[float] = []
    async for o in db.p2p_orders.find(
        {**base_q, "status": "completed", "paid_at": {"$ne": None}},
        {"created_at": 1, "paid_at": 1, "_id": 0},
    ).limit(200):
        try:
            t0 = datetime.fromisoformat(o["created_at"])
            t1 = datetime.fromisoformat(o["paid_at"])
            pay_times.append((t1 - t0).total_seconds())
        except Exception:
            continue
    avg_payment_time_seconds = round(sum(pay_times) / len(pay_times)) if pay_times else 0

    return {
        "user_id": counterparty_id,
        "nickname": nickname,
        "country": u.get("country"),
        "kyc_verified": u.get("kyc_status") == "approved",
        "email_verified": bool(u.get("email_verified")),
        "phone_verified": bool(u.get("mobile_verified")),
        "is_merchant": stats.get("is_merchant", False),
        "joined_at": stats.get("joined_at"),
        "trades_30d": completed_30d,
        "completion_rate_30d": round(completion_rate_30d, 2),
        "trades_total": completed_total,
        "total_completion_rate": round(total_completion_rate, 2),
        "avg_payment_time_seconds": avg_payment_time_seconds,
        "avg_release_time_seconds": int(stats.get("avg_release_time_seconds") or 0),
        "positive_ratings": stats.get("positive_ratings", 0),
        "negative_ratings": stats.get("negative_ratings", 0),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Trade-room actions
# ─────────────────────────────────────────────────────────────────────────────

async def _bump_user_stats(uid: str, *, completed: bool, cancelled: bool, release_seconds: int = 0):
    db = get_db()
    inc: dict = {"trades_total": 1 if completed else 0}
    if completed:
        inc["trades_30d"] = 1
    update: dict = {"$inc": {k: v for k, v in inc.items() if v}}
    if completed and release_seconds:
        s = await db.p2p_user_stats.find_one({"user_id": uid})
        if s:
            prev = float(s.get("avg_release_time_seconds") or 0)
            new_avg = round(prev * 0.9 + release_seconds * 0.1) if prev else release_seconds
            update.setdefault("$set", {})["avg_release_time_seconds"] = new_avg
    if completed:
        s = await db.p2p_user_stats.find_one({"user_id": uid}) or {}
        c30 = (s.get("trades_30d") or 0) + 1
        update.setdefault("$set", {})["completion_rate_30d"] = min(
            100.0, round(((s.get("completion_rate_30d", 100.0) * (c30 - 1)) + 100.0) / c30, 2)
        )
    if cancelled:
        update.setdefault("$inc", {})["cancellation_strikes_24h"] = 1
    if update:
        await db.p2p_user_stats.update_one({"user_id": uid}, update, upsert=True)


@router.post("/orders/{order_id}/mark-paid")
async def mark_paid(order_id: str, req: MarkPaidRequest, user=Depends(current_user)):
    """Buyer marks INR as sent. Starts the seller's release-window countdown."""
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] != o["buyer_id"]:
        raise HTTPException(403, "Only the buyer can mark this order as paid")
    if o["status"] != "in_progress":
        raise HTTPException(400, f"Cannot mark paid — order status is '{o['status']}'")
    # Payment proof is optional — users can also share proof via the order chat

    release_window_min = 30
    expires = (_now() + timedelta(minutes=release_window_min)).isoformat()
    await db.p2p_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": "paid_marked",
            "payment_proof_url": req.payment_proof_url,
            "buyer_paid_note": req.note,
            "buyer_marked_paid_at": _now_iso(),
            "paid_at": _now_iso(),
            "release_window_expires_at": expires,
            "updated_at": _now_iso(),
        }},
    )
    await _post_system_message(
        order_id, "buyer_marked_paid",
        f"Buyer marked the payment as sent. Seller has {release_window_min} minutes to confirm and release crypto."
    )
    await _broadcast_order(order_id, "status", {"status": "paid_marked", "release_window_expires_at": expires})
    return {"ok": True, "status": "paid_marked"}


@router.post("/orders/{order_id}/release")
async def release_crypto(order_id: str, req: ReleaseRequest, user=Depends(current_user)):
    """Seller releases escrowed crypto to the buyer. Final settlement step."""
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] != o["seller_id"]:
        raise HTTPException(403, "Only the seller can release crypto")
    if o["status"] not in ("paid_marked", "in_progress"):
        raise HTTPException(400, f"Cannot release — order status is '{o['status']}'")

    # TOTP gate (if seller has 2FA enabled)
    twofa_doc = await db.user_2fa.find_one({"uid": user["uid"]})
    if twofa_doc and twofa_doc.get("enabled") and twofa_doc.get("secret"):
        if not req.totp_code or not twofa_service.verify_totp(twofa_doc["secret"], req.totp_code):
            raise HTTPException(401, "Invalid 2FA code — release requires your authenticator code")

    crypto_amount = _d(o["crypto_amount"])
    fee_pct = await _resolve_taker_fee_pct(db)
    price_d = _d(o.get("price") or "1")
    fiat = str(o.get("fiat") or "INR")
    _fee_crypto, _fee_fiat, fee_usdt = await _compute_p2p_taker_fee(
        db,
        crypto_amount=crypto_amount,
        price_fiat=price_d,
        fiat=fiat,
        fee_pct=fee_pct,
    )

    taker_id = o["taker_id"]
    buyer_id = o["buyer_id"]
    seller_id = o["seller_id"]
    net_to_buyer = crypto_amount

    if fee_usdt > ZERO:
        try:
            ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()
            fee_ibo_est = ibo_fee_svc.usdt_notional_to_ibo_fee(float(fee_usdt), ibo_px)
            await ibo_fee_svc.ensure_ibo_fee_balance(taker_id, fee_ibo_est, context="P2P")
        except InsufficientFundsError as exc:
            raise HTTPException(400, str(exc)) from exc

    # Settle: remove from locked, credit buyer full crypto; taker fee is IBO
    try:
        await wallet_service.debit_locked(
            seller_id, o["asset"], float(crypto_amount),
            txn_type="trade", ref_type="p2p_order", ref_id=order_id,
            meta={
                "action": "p2p_release",
                "buyer_id": buyer_id,
                "fee_ibo": str(fee_ibo_charged),
                "fee_usdt": str(fee_usdt),
            },
        )
    except InsufficientFundsError:
        log.error("p2p release: debit_locked failed for order %s seller %s", order_id, seller_id)
        raise HTTPException(500, "Settlement error — please contact support")

    await wallet_service.credit(
        buyer_id, o["asset"], float(net_to_buyer),
        txn_type="trade", ref_type="p2p_order", ref_id=order_id,
        meta={
            "action": "p2p_receive",
            "seller_id": seller_id,
            "fee_usdt": str(fee_usdt),
        },
    )

    fee_ibo_charged = 0.0
    if fee_usdt > ZERO:
        try:
            fee_ibo_charged = await _charge_p2p_taker_fee_ibo(
                taker_id,
                fee_usdt,
                order_id=order_id,
                precheck_balance=False,
                meta={
                    "action": "p2p_taker_fee",
                    "fee_usdt": str(fee_usdt),
                    "asset": o["asset"],
                    "buyer_id": buyer_id,
                },
            )
        except InsufficientFundsError as exc:
            log.error(
                "p2p release: IBO fee debit failed after crypto settled order=%s taker=%s",
                order_id,
                taker_id,
            )
            raise HTTPException(500, f"Fee settlement failed: {exc}") from exc

    await db.p2p_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": "completed",
            "fee_amount_crypto": "0",
            "fee_amount_ibo": str(fee_ibo_charged),
            "fee_asset": ibo_fee_svc.FEE_ASSET,
            "fee_usdt_notional": str(fee_usdt),
            "completed_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
    )
    await db.p2p_ads.update_one(
        {"ad_id": o["ad_id"], "active_orders_count": {"$gt": 0}},
        {"$inc": {"active_orders_count": -1, "completed_orders_count": 1},
         "$set": {"updated_at": _now_iso()}},
    )
    # Auto-complete the ad if fully exhausted
    ad = await db.p2p_ads.find_one({"ad_id": o["ad_id"]})
    if ad and _d(ad.get("available_amount", "0")) <= ZERO and ad.get("status") == "active":
        await db.p2p_ads.update_one(
            {"ad_id": o["ad_id"]},
            {"$set": {"status": "completed", "updated_at": _now_iso()}},
        )

    secs = 0
    try:
        marked = o.get("buyer_marked_paid_at")
        if marked:
            secs = int((_now() - datetime.fromisoformat(marked)).total_seconds())
    except Exception:
        pass
    await _bump_user_stats(o["maker_id"], completed=True, cancelled=False, release_seconds=secs)
    await _bump_user_stats(o["taker_id"], completed=True, cancelled=False)

    await _post_system_message(
        order_id, "released",
        f"Crypto released. {net_to_buyer} {o['asset']} credited to buyer. "
        f"Taker fee: {fee_ibo_charged} {ibo_fee_svc.FEE_ASSET}.",
    )
    await _broadcast_order(order_id, "status", {
        "status": "completed",
        "fee_ibo": str(fee_ibo_charged),
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "net_credited": str(net_to_buyer),
    })
    return {
        "ok": True,
        "status": "completed",
        "fee_paid_ibo": str(fee_ibo_charged),
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "net_credited_to_buyer": str(net_to_buyer),
    }


@router.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: str, req: CancelOrderRequest, user=Depends(current_user)):
    """Cancel order. Only allowed while in_progress (before buyer marks paid)."""
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        raise HTTPException(403, "You are not a party to this order")
    if o["status"] != "in_progress":
        raise HTTPException(
            400,
            f"Cannot cancel — order status is '{o['status']}'. Use the dispute flow instead.",
        )
    cancelled_by_role = "buyer" if user["uid"] == o["buyer_id"] else "seller"
    return await _do_cancel(
        o, reason=req.reason or "Cancelled by user",
        cancelled_by=cancelled_by_role,
        cancelled_by_user_id=user["uid"],
    )


async def _do_cancel(o: dict, *, reason: str, cancelled_by: str, cancelled_by_user_id: str | None):
    """Shared cancel implementation used by user-cancel and the auto-expire worker."""
    db = get_db()
    crypto = _d(o["crypto_amount"])
    order_id = o["order_id"]

    # Return crypto allocation to ad
    cur_ad = await db.p2p_ads.find_one({"ad_id": o["ad_id"]})
    new_avail = _d((cur_ad or {}).get("available_amount", "0")) + crypto
    await db.p2p_ads.update_one(
        {"ad_id": o["ad_id"], "active_orders_count": {"$gt": 0}},
        {"$inc": {"active_orders_count": -1},
         "$set": {"available_amount": str(new_avail), "updated_at": _now_iso()}},
    )

    # BUY ads: taker (seller) had crypto locked per-order → unlock it
    if o["side"] == "buy":
        try:
            await wallet_service.unlock(
                o["taker_id"], o["asset"], float(crypto),
                ref_type="p2p_order", ref_id=order_id,
                meta={"action": "p2p_order_cancelled"},
            )
        except InsufficientFundsError:
            log.warning("p2p cancel: unlock failed for order %s (already unlocked?)", order_id)

    await db.p2p_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": "cancelled",
            "cancellation_reason": reason,
            "cancelled_by": cancelled_by,
            "cancelled_at": _now_iso(),
            "updated_at": _now_iso(),
        }},
    )
    if cancelled_by_user_id and cancelled_by == "buyer":
        await _bump_user_stats(cancelled_by_user_id, completed=False, cancelled=True)

    await _post_system_message(order_id, "cancelled", f"Order cancelled by {cancelled_by}. {reason}")
    await _broadcast_order(order_id, "status", {"status": "cancelled", "reason": reason})
    return {"ok": True, "status": "cancelled"}


# ─────────────────────────────────────────────────────────────────────────────
# Order chat
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/orders/{order_id}/messages")
async def list_messages(
    order_id: str,
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0),
    user=Depends(current_user),
):
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        raise HTTPException(403, "You are not a party to this order")
    out = []
    async for m in db.p2p_messages.find({"order_id": order_id}).sort("created_at", 1).skip(skip).limit(limit):
        out.append(_strip(m))
    return {"messages": out}


@router.post("/orders/{order_id}/messages")
async def post_message(order_id: str, req: MessageCreate, user=Depends(current_user)):
    if not req.body and not req.attachment_url:
        raise HTTPException(400, "Either body or attachment_url is required")
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        raise HTTPException(403, "You are not a party to this order")
    if o["status"] in ("completed", "cancelled", "refunded"):
        raise HTTPException(400, "Cannot send messages on a finalised order")

    role = "buyer" if user["uid"] == o["buyer_id"] else "seller"
    msg = {
        "message_id": _new_id("MSG"),
        "order_id": order_id,
        "sender_id": user["uid"],
        "sender_role": role,
        "kind": "user",
        "body": req.body,
        "attachment_url": req.attachment_url,
        "created_at": _now_iso(),
    }
    await db.p2p_messages.insert_one(msg)
    await _broadcast_order(order_id, "message", _strip(msg))
    return _strip(msg)


_P2P_UPLOAD_DIR = pathlib.Path(__file__).parent.parent / "uploads" / "p2p"
_P2P_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_P2P_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/orders/{order_id}/upload-image")
async def upload_chat_image(
    order_id: str,
    image: UploadFile = File(...),
    user=Depends(current_user),
):
    """Upload an image and post it as a chat message attachment."""
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        raise HTTPException(403, "You are not a party to this order")
    if o["status"] in ("completed", "cancelled", "refunded"):
        raise HTTPException(400, "Cannot send files on a finalised order")

    mime = (image.content_type or "").split(";")[0].strip().lower()
    if mime not in _P2P_ALLOWED_MIME:
        raise HTTPException(400, f"Only JPEG, PNG, WebP, or GIF images are allowed (got {mime or 'unknown'})")

    raw = await image.read()
    if len(raw) > _P2P_MAX_BYTES:
        raise HTTPException(400, "Image too large (max 10 MB)")

    _P2P_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
    ext = ext_map.get(mime, ".jpg")
    fname = f"p2p_{uuid.uuid4().hex[:20]}{ext}"
    (_P2P_UPLOAD_DIR / fname).write_bytes(raw)

    attachment_url = f"/uploads/p2p/{fname}"
    role = "buyer" if user["uid"] == o.get("buyer_id") else "seller"
    msg = {
        "message_id": _new_id("MSG"),
        "order_id": order_id,
        "sender_id": user["uid"],
        "sender_role": role,
        "kind": "user",
        "body": None,
        "attachment_url": attachment_url,
        "created_at": _now_iso(),
    }
    await db.p2p_messages.insert_one(msg)
    await _broadcast_order(order_id, "message", _strip(msg))
    return _strip(msg)


# ─────────────────────────────────────────────────────────────────────────────
# Ratings
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/orders/{order_id}/rate")
async def rate_order(order_id: str, req: RateOrderRequest, user=Depends(current_user)):
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        raise HTTPException(403, "Not a party to this order")
    if o["status"] != "completed":
        raise HTTPException(400, "Can only rate completed orders")
    field = "rating_by_maker" if user["uid"] == o["maker_id"] else "rating_by_taker"
    if o.get(field) is not None:
        raise HTTPException(400, "You have already rated this order")

    await db.p2p_orders.update_one(
        {"order_id": order_id},
        {"$set": {
            field: req.rating,
            f"{field}_comment": req.comment,
            "updated_at": _now_iso(),
        }},
    )
    counter_id = o["taker_id"] if user["uid"] == o["maker_id"] else o["maker_id"]
    inc_field = "positive_ratings" if req.rating >= 4 else "negative_ratings"
    await db.p2p_user_stats.update_one(
        {"user_id": counter_id}, {"$inc": {inc_field: 1}}, upsert=True
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Disputes
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/orders/{order_id}/dispute")
async def open_dispute(order_id: str, req: DisputeOpen, user=Depends(current_user)):
    """Open a dispute. Freezes the order and sends it to the admin queue."""
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["maker_id"], o["taker_id"]):
        raise HTTPException(403, "You are not a party to this order")
    if o["status"] not in ("paid_marked", "in_progress", "completed"):
        raise HTTPException(400, f"Cannot dispute — order status is '{o['status']}'")
    if o["status"] == "completed":
        completed_at = o.get("completed_at")
        try:
            if completed_at and (_now() - datetime.fromisoformat(completed_at)) > timedelta(hours=24):
                raise HTTPException(400, "Post-completion dispute window (24h) has expired")
        except ValueError:
            pass
    existing = await db.p2p_disputes.find_one(
        {"order_id": order_id, "status": {"$in": ["open", "investigating"]}}
    )
    if existing:
        raise HTTPException(400, f"Dispute {existing['dispute_id']} is already open on this order")

    role = "buyer" if user["uid"] == o["buyer_id"] else "seller"
    dispute_id = _new_id("DSP")
    doc = {
        "dispute_id": dispute_id,
        "order_id": order_id,
        "asset": o["asset"], "fiat": o["fiat"],
        "crypto_amount": o["crypto_amount"],
        "fiat_amount": o["fiat_amount"],
        "raised_by_user_id": user["uid"],
        "raised_by_role": role,
        "buyer_id": o["buyer_id"],
        "seller_id": o["seller_id"],
        "reason": req.reason,
        "description": req.description,
        "evidence_urls": list(req.evidence_urls or []),
        "status": "open",
        "assigned_admin_id": None,
        "resolution": None,
        "resolution_note": None,
        "resolved_at": None,
        "resolved_by_admin_id": None,
        "auto_opened": False,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "previous_order_status": o["status"],
    }
    await db.p2p_disputes.insert_one(doc)
    await db.p2p_orders.update_one(
        {"order_id": order_id},
        {"$set": {"status": "disputed", "dispute_id": dispute_id, "updated_at": _now_iso()}},
    )
    await _post_system_message(
        order_id, "disputed",
        f"Dispute opened by {role} — reason: {req.reason}. Funds frozen pending admin review (SLA: 2 hours)."
    )
    await _broadcast_order(order_id, "status", {"status": "disputed", "dispute_id": dispute_id})
    return _strip(doc)


@router.post("/disputes/{dispute_id}/evidence")
async def add_dispute_evidence(dispute_id: str, req: DisputeEvidence, user=Depends(current_user)):
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    if user["uid"] not in (d["buyer_id"], d["seller_id"]):
        raise HTTPException(403, "You are not a party to this dispute")
    if d["status"] not in ("open", "investigating", "evidence_requested"):
        raise HTTPException(400, f"Dispute is {d['status']} — evidence locked")
    role = "buyer" if user["uid"] == d["buyer_id"] else "seller"
    payload = [{"url": u, "uploaded_by": role, "uploaded_at": _now_iso()} for u in req.evidence_urls]
    await db.p2p_disputes.update_one(
        {"dispute_id": dispute_id},
        {
            "$push": {
                "evidence_urls": {"$each": req.evidence_urls},
                "evidence_log": {"$each": payload},
            },
            "$set": {"updated_at": _now_iso()},
        },
    )
    if req.note:
        await _post_system_message(d["order_id"], "evidence",
                                   f"{role.title()} added evidence: {req.note}")
    await _broadcast_order(d["order_id"], "appeal", {
        "event": "evidence_added", "dispute_id": dispute_id,
        "by_role": role, "added": len(req.evidence_urls),
    })
    return {"ok": True, "added": len(req.evidence_urls)}


@router.get("/disputes/mine")
async def list_my_disputes(user=Depends(current_user)):
    db = get_db()
    rows = []
    cursor = db.p2p_disputes.find(
        {"$or": [{"buyer_id": user["uid"]}, {"seller_id": user["uid"]}]}
    ).sort("created_at", -1)
    async for d in cursor:
        rows.append(_strip(d))
    return {"disputes": rows}


@router.get("/disputes/{dispute_id}")
async def dispute_detail(dispute_id: str, user=Depends(current_user)):
    db = get_db()
    d = await db.p2p_disputes.find_one({"dispute_id": dispute_id})
    if not d:
        raise HTTPException(404, "Dispute not found")
    if user["uid"] not in (d["buyer_id"], d["seller_id"]):
        raise HTTPException(403, "Not a party to this dispute")
    return _strip(d)


@router.get("/orders/{order_id}/appeal")
async def order_appeal_bundle(order_id: str, user=Depends(current_user)):
    """Aggregated appeal/dispute view — dispute + order + parties + timeline + OCR."""
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["buyer_id"], o["seller_id"]):
        raise HTTPException(403, "Not a party to this order")
    if not o.get("dispute_id"):
        raise HTTPException(404, "No active dispute on this order")

    d = await db.p2p_disputes.find_one({"dispute_id": o["dispute_id"]})
    if not d:
        raise HTTPException(404, "Dispute not found")

    parties: dict = {}
    for role, uid in (("buyer", o["buyer_id"]), ("seller", o["seller_id"])):
        u = await db.users.find_one({"uid": uid})
        s = await db.p2p_user_stats.find_one({"user_id": uid}) or {}
        parties[role] = {
            "user_id": uid,
            "nickname": s.get("nickname") or (await _user_nickname(u) if u else f"User-{uid[-6:]}"),
            "country": (u or {}).get("country"),
            "kyc_verified": (u or {}).get("kyc_status") == "approved",
            "email_verified": bool((u or {}).get("email_verified")),
            "phone_verified": bool((u or {}).get("mobile_verified")),
            "trades_total": s.get("trades_total", 0),
            "completion_rate_30d": s.get("completion_rate_30d", 100.0),
            "is_self": uid == user["uid"],
        }

    timeline: list[dict] = [
        {"at": o.get("created_at"), "key": "order_created", "label": "Order created"},
    ]
    if o.get("buyer_marked_paid_at"):
        timeline.append({"at": o["buyer_marked_paid_at"], "key": "buyer_paid_marked",
                         "label": "Buyer marked payment as sent"})
    if d.get("created_at"):
        timeline.append({"at": d["created_at"], "key": "appeal_filed",
                         "label": f"Appeal filed by {d.get('raised_by_role', 'user')}"})
    for ev in (d.get("evidence_log") or []):
        timeline.append({"at": ev.get("uploaded_at"), "key": "evidence_added",
                         "label": f"{(ev.get('uploaded_by') or 'user').title()} added evidence"})
    if d.get("assigned_at"):
        timeline.append({"at": d["assigned_at"], "key": "admin_assigned", "label": "Admin assigned"})
    if d.get("resolved_at"):
        timeline.append({"at": d["resolved_at"], "key": "resolved",
                         "label": f"Resolution: {d.get('resolution') or 'closed'}"})
    timeline = [t for t in timeline if t.get("at")]
    timeline.sort(key=lambda x: x["at"])

    sla_target_at = None
    try:
        if d.get("created_at") and d.get("status") in ("open", "investigating"):
            sla_target_at = (
                datetime.fromisoformat(d["created_at"]) + timedelta(hours=2)
            ).isoformat()
    except Exception:
        pass

    return {
        "dispute": _strip(d),
        "order": _strip(o),
        "parties": parties,
        "timeline": timeline,
        "sla_target_at": sla_target_at,
        "ocr_result": d.get("ocr_result") or o.get("ocr_result"),
    }


@router.post("/orders/{order_id}/receipt-ocr")
async def order_receipt_ocr(order_id: str, user=Depends(current_user)):
    """Run AI OCR on the payment receipt. Result is cached on the dispute/order."""
    db = get_db()
    o = await db.p2p_orders.find_one({"order_id": order_id})
    if not o:
        raise HTTPException(404, "Order not found")
    if user["uid"] not in (o["buyer_id"], o["seller_id"]):
        raise HTTPException(403, "Not a party to this order")
    proof = o.get("payment_proof_url")
    if not proof:
        raise HTTPException(400, "No payment receipt on this order")

    from .ocr import extract_receipt_fields, compare_with_order
    try:
        fields = await extract_receipt_fields(proof, session_id=f"ocr-{order_id}")
    except RuntimeError as e:
        if "EMERGENT_LLM_KEY" in str(e):
            raise HTTPException(503, "OCR temporarily unavailable")
        log.exception("OCR upstream error")
        raise HTTPException(502, "Could not process the receipt — please try again")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        log.exception("OCR unexpected error")
        raise HTTPException(502, "OCR failed")

    checks = compare_with_order(fields, o)
    bundle = {"fields": fields, "checks": checks, "verified_at": _now_iso(), "verified_by_user_id": user["uid"]}

    if o.get("dispute_id"):
        await db.p2p_disputes.update_one(
            {"dispute_id": o["dispute_id"]},
            {"$set": {"ocr_result": bundle, "updated_at": _now_iso()}},
        )
        await _broadcast_order(order_id, "appeal", {
            "event": "ocr_completed", "dispute_id": o["dispute_id"],
            "confidence": fields.get("confidence", 0.0),
        })
    else:
        await db.p2p_orders.update_one(
            {"order_id": order_id},
            {"$set": {"ocr_result": bundle, "updated_at": _now_iso()}},
        )
    return bundle


# ─────────────────────────────────────────────────────────────────────────────
# Merchant application (Phase 4)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/merchants/apply")
async def apply_for_merchant(req: MerchantApply, user=Depends(current_user)):
    """Apply for verified merchant status."""
    await _require_kyc(user["uid"])
    db = get_db()

    existing = await db.p2p_merchants.find_one({"user_id": user["uid"]})
    if existing:
        if existing["status"] in ("pending", "approved"):
            raise HTTPException(400, f"You already have a merchant application with status '{existing['status']}'")

    stats = await _ensure_user_stats(user["uid"])
    if stats.get("trades_total", 0) < 10:
        raise HTTPException(400, "Minimum 10 completed P2P trades required to apply for merchant status")

    merchant_id = _new_id("MCH")
    doc = {
        "merchant_id": merchant_id,
        "user_id": user["uid"],
        # New form fields
        "monthly_volume_usd": req.monthly_volume_usd,
        "trading_experience": req.trading_experience,
        "application_reason": req.application_reason,
        # Legacy / optional fields
        "display_name": req.display_name,
        "business_type": req.business_type,
        "description": req.description,
        "status": "pending",
        "applied_at": _now_iso(),
        "approved_at": None,
        "approved_by": None,
        "suspended_at": None,
        "suspended_by": None,
        "suspend_reason": None,
    }
    await db.p2p_merchants.update_one(
        {"user_id": user["uid"]},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True, "merchant_id": merchant_id, "status": "pending"}


@router.get("/merchants/me")
async def my_merchant_status(user=Depends(current_user)):
    db = get_db()
    m = await db.p2p_merchants.find_one({"user_id": user["uid"]})
    if not m:
        return {"status": "none"}
    return _strip(m)
