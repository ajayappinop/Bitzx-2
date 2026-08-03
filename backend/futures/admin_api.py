"""Admin REST router for the futures module.

Mounted at ``/api/admin/futures/...``. Every endpoint requires an admin
JWT (no static API key). Per-action permissions follow the same names
the spot admin already uses (``view_orders``, ``manage_settings``,
``adjust_wallets``, ``view_finance`` …).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from services.errors import InsufficientFundsError

from .constants import (
    COL_FUNDING_PAYS,
    COL_FUNDING_RATES,
    COL_LIQUIDATIONS,
    COL_ORDERS,
    COL_POSITIONS,
    COL_TRADES,
    COL_WALLETS,
    COL_WALLET_TXNS,
    MARGIN_ASSET,
)
from .symbols import get_supported_symbols
from .db import db
from .deps import current_admin, require_admin_permission
from .services import (
    admin_metrics,
    controls as controls_svc,
    funding as funding_svc,
    ledger as fledger,
    mark_price as mark_price_svc,
    orders as orders_svc,
    position as position_svc,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/futures", tags=["admin-futures"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Request bodies ────────────────────────────────────────────────────────

class ControlsPatch(BaseModel):
    futures_enabled: Optional[bool] = None
    futures_trading_paused: Optional[bool] = None
    futures_new_orders_paused: Optional[bool] = None
    futures_transfers_paused: Optional[bool] = None
    futures_max_leverage_cap: Optional[int] = None
    futures_maker_fee_rate: Optional[float] = None
    futures_taker_fee_rate: Optional[float] = None
    futures_liquidation_fee_rate: Optional[float] = None
    futures_funding_cap: Optional[float] = None
    futures_min_notional_usdt: Optional[float] = None
    futures_synthetic_fills_enabled: Optional[bool] = None
    futures_mark_blend_index_weight: Optional[float] = None


class SymbolPatch(BaseModel):
    tick_size: Optional[float] = None
    lot_size:  Optional[float] = None
    min_qty:   Optional[float] = None
    max_qty:   Optional[float] = None
    max_leverage: Optional[int] = None
    listed: Optional[bool] = None
    trading_enabled: Optional[bool] = None


class WalletAdjustment(BaseModel):
    uid: str
    direction: str = Field(..., pattern="^(credit|debit)$")
    amount: float = Field(gt=0)
    reason: str
    note: Optional[str] = None


class FundingSettleRequest(BaseModel):
    symbol: str


class ForceCloseRequest(BaseModel):
    reason: Optional[str] = "admin_force_close"


# ── Overview / controls ──────────────────────────────────────────────────

@router.get("/overview", dependencies=[Depends(require_admin_permission("view_orders", "view_trades", "view_dashboard"))])
async def overview():
    return await admin_metrics.overview()


@router.get("/controls", dependencies=[Depends(require_admin_permission("view_orders", "view_settings"))])
async def get_controls():
    return await controls_svc.read_controls()


@router.patch("/controls")
async def patch_controls(
    body: ControlsPatch,
    admin: dict = Depends(require_admin_permission("manage_settings", "manage_hedger")),
):
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    try:
        return await controls_svc.patch_controls(updates, admin_email=admin.get("email"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Symbols ──────────────────────────────────────────────────────────────

@router.get("/symbols", dependencies=[Depends(require_admin_permission("view_markets", "view_orders"))])
async def list_symbols():
    return {"symbols": await controls_svc.list_symbol_configs()}


@router.get("/symbols/{symbol}", dependencies=[Depends(require_admin_permission("view_markets", "view_orders"))])
async def get_symbol(symbol: str):
    if symbol not in get_supported_symbols():
        raise HTTPException(status_code=404, detail="symbol not found")
    return await controls_svc.get_symbol_config(symbol)


@router.patch("/symbols/{symbol}")
async def patch_symbol(
    symbol: str,
    body: SymbolPatch,
    admin: dict = Depends(require_admin_permission("manage_settings", "manage_hedger")),
):
    if symbol not in get_supported_symbols():
        raise HTTPException(status_code=404, detail="symbol not found")
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    try:
        return await controls_svc.patch_symbol_config(symbol, updates, admin_email=admin.get("email"))
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Positions ────────────────────────────────────────────────────────────

@router.get("/positions", dependencies=[Depends(require_admin_permission("view_orders", "view_trades"))])
async def list_positions(
    status: str = Query("open", pattern="^(open|closed)$"),
    symbol: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
):
    q: Dict[str, Any] = {"status": status}
    if symbol: q["symbol"] = symbol
    if uid:    q["uid"] = uid
    sort_field = "opened_at" if status == "open" else "closed_at"
    cur = (
        db()[COL_POSITIONS].find(q, {"_id": 0})
        .sort(sort_field, -1).skip(skip).limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db()[COL_POSITIONS].count_documents(q)
    return {"positions": rows, "total": total}


@router.post("/positions/{position_id}/force-close")
async def force_close_position(
    position_id: str,
    body: ForceCloseRequest,
    admin: dict = Depends(require_admin_permission("manage_settings", "adjust_wallets")),
):
    pos = await db()[COL_POSITIONS].find_one({"id": position_id, "status": "open"}, {"_id": 0})
    if not pos:
        raise HTTPException(status_code=404, detail="position not found")
    cached = mark_price_svc.get_cached(pos["symbol"])
    mp = float((cached or {}).get("mark_price") or 0.0)
    if mp <= 0:
        refreshed = await mark_price_svc.refresh(pos["symbol"])
        mp = float((refreshed or {}).get("mark_price") or 0.0)
    if mp <= 0:
        raise HTTPException(status_code=400, detail="no mark price available")
    res = await position_svc.force_close(pos, mp, reason=body.reason or "admin_force_close")
    res["admin_email"] = admin.get("email")
    return res


# ── Orders / trades ──────────────────────────────────────────────────────

@router.get("/orders", dependencies=[Depends(require_admin_permission("view_orders"))])
async def list_orders(
    status: Optional[str] = Query(None),
    symbol: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = {"$in": ["open", "partially_filled"]} if status == "open" else status
    if symbol: q["symbol"] = symbol
    if uid:    q["uid"] = uid
    cur = (
        db()[COL_ORDERS].find(q, {"_id": 0})
        .sort("created_at", -1).skip(skip).limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db()[COL_ORDERS].count_documents(q)
    return {"orders": rows, "total": total}


@router.delete("/orders/{order_id}")
async def admin_cancel_order(
    order_id: str,
    admin: dict = Depends(require_admin_permission("manage_settings", "adjust_wallets")),
):
    o = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="order not found")
    if o["status"] not in ("open", "partially_filled"):
        return o
    try:
        return await orders_svc.cancel_order(o["uid"], order_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/trades", dependencies=[Depends(require_admin_permission("view_trades"))])
async def list_trades(
    symbol: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    skip: int = Query(0, ge=0),
    synthetic: Optional[bool] = None,
):
    q: Dict[str, Any] = {}
    if symbol: q["symbol"] = symbol
    if uid:    q["$or"] = [{"taker_uid": uid}, {"maker_uid": uid}]
    if synthetic is not None:
        q["synthetic"] = bool(synthetic)
    cur = (
        db()[COL_TRADES].find(q, {"_id": 0})
        .sort("created_at", -1).skip(skip).limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db()[COL_TRADES].count_documents(q)
    return {"trades": rows, "total": total}


# ── Liquidations ────────────────────────────────────────────────────────

@router.get("/liquidations", dependencies=[Depends(require_admin_permission("view_orders", "view_finance"))])
async def list_liquidations(
    symbol: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
):
    q: Dict[str, Any] = {}
    if symbol: q["symbol"] = symbol
    if uid:    q["uid"] = uid
    cur = (
        db()[COL_LIQUIDATIONS].find(q, {"_id": 0})
        .sort("created_at", -1).skip(skip).limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db()[COL_LIQUIDATIONS].count_documents(q)
    return {"liquidations": rows, "total": total}


# ── Funding ─────────────────────────────────────────────────────────────

@router.get("/funding/rates", dependencies=[Depends(require_admin_permission("view_finance", "view_orders"))])
async def list_funding_rates(
    symbol: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
):
    q: Dict[str, Any] = {}
    if symbol: q["symbol"] = symbol
    cur = (
        db()[COL_FUNDING_RATES].find(q, {"_id": 0})
        .sort("settled_at", -1).limit(limit)
    )
    return {"rates": await cur.to_list(length=limit)}


@router.get("/funding/payments", dependencies=[Depends(require_admin_permission("view_finance"))])
async def list_funding_payments(
    symbol: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
):
    q: Dict[str, Any] = {}
    if symbol: q["symbol"] = symbol
    if uid:    q["uid"] = uid
    cur = (
        db()[COL_FUNDING_PAYS].find(q, {"_id": 0})
        .sort("settled_at", -1).skip(skip).limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db()[COL_FUNDING_PAYS].count_documents(q)
    return {"payments": rows, "total": total}


@router.post("/funding/settle")
async def settle_funding(
    body: FundingSettleRequest,
    admin: dict = Depends(require_admin_permission("manage_settings", "manage_hedger")),
):
    """Manually trigger a funding settlement for ``symbol`` (uses cached mark)."""
    cached = mark_price_svc.get_cached(body.symbol)
    mp = float((cached or {}).get("mark_price") or 0.0)
    if mp <= 0:
        refreshed = await mark_price_svc.refresh(body.symbol)
        mp = float((refreshed or {}).get("mark_price") or 0.0)
    if mp <= 0:
        raise HTTPException(status_code=400, detail="no mark price for symbol")
    res = await funding_svc.settle_symbol(body.symbol, mp)
    return {"symbol": body.symbol, "mark_price": mp, **res, "admin_email": admin.get("email")}


# ── Wallets ─────────────────────────────────────────────────────────────

@router.get("/wallets", dependencies=[Depends(require_admin_permission("view_finance", "view_ledger", "view_users", "adjust_wallets"))])
async def list_wallets(
    uid: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
):
    q: Dict[str, Any] = {}
    if uid: q["uid"] = uid
    cur = (
        db()[COL_WALLETS].find(q, {"_id": 0})
        .sort("updated_at", -1).skip(skip).limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db()[COL_WALLETS].count_documents(q)
    return {"wallets": rows, "total": total}


# Snapshot + per-user txns are allowed for any admin who can already
# view the user (``view_users``) or the financial picture
# (``view_finance``/``view_ledger``). Otherwise looking at a user's
# detail page would silently 403 the futures section even though the
# admin can clearly see the spot rows on the same page.
@router.get("/wallets/{uid}/snapshot", dependencies=[Depends(require_admin_permission("view_finance", "view_ledger", "view_users", "adjust_wallets"))])
async def wallet_snapshot(uid: str):
    from .services import wallet as wallet_svc
    return await wallet_svc.snapshot(uid)


@router.get("/wallets/{uid}/txns", dependencies=[Depends(require_admin_permission("view_finance", "view_ledger", "view_users", "adjust_wallets"))])
async def wallet_txns(
    uid: str,
    limit: int = Query(100, ge=1, le=1000),
    skip: int = Query(0, ge=0),
):
    cur = (
        db()[COL_WALLET_TXNS].find({"uid": uid}, {"_id": 0})
        .sort("created_at", -1).skip(skip).limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db()[COL_WALLET_TXNS].count_documents({"uid": uid})
    return {"txns": rows, "total": total}


@router.post("/wallets/adjust")
async def admin_adjust_wallet(
    body: WalletAdjustment,
    admin: dict = Depends(require_admin_permission("adjust_wallets", "manage_settings")),
):
    """Admin-only wallet credit / debit. Always emits a ledger row tagged
    with the admin email and reason for full audit traceability."""
    meta = {
        "phase": "admin_adjustment",
        "reason": body.reason,
        "note": body.note,
        "admin_email": admin.get("email"),
    }
    try:
        if body.direction == "credit":
            row = await fledger.credit(
                body.uid, body.amount, asset=MARGIN_ASSET,
                txn_type="adjustment",
                ref_type="admin_adjustment", ref_id=admin.get("aid") or "admin",
                meta=meta,
            )
        else:
            row = await fledger.debit(
                body.uid, body.amount, asset=MARGIN_ASSET,
                txn_type="adjustment",
                ref_type="admin_adjustment", ref_id=admin.get("aid") or "admin",
                meta=meta,
            )
    except InsufficientFundsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return row


# ── Mark price (read for admin charts) ─────────────────────────────────

@router.get("/mark-prices", dependencies=[Depends(require_admin_permission("view_orders", "view_markets"))])
async def list_marks():
    out = []
    for sym in get_supported_symbols().keys():
        snap = mark_price_svc.get_cached(sym)
        if not snap:
            snap = await mark_price_svc.refresh(sym)
        if snap:
            out.append(snap)
    return {"marks": out}
