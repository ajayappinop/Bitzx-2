"""Admin REST API for options."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from services.db import supports_transactions

from .db import db
from .deps import require_admin_permission
from .models import ContractCreate, ContractPatch, ControlsPatch, SettleContractRequest, UnderlyingCreate, UnderlyingPatch
from .services import contracts as contracts_svc
from .services import controls as controls_svc
from .services import orders as orders_svc
from .services import settlement as settlement_svc
from .services import underlyings as und_svc
from .constants import MAKER_FEE_RATE, TAKER_FEE_RATE
from .services import wallet as wallet_svc
from .services.matching import MATCH_LOCK_SHARD_COUNT
from .services.settlement_watch import get_last_auto_settle_tick
from .fee_sink import get_fee_sink_uid
from .demo_data import seed_demo_options_into_db
from .services import binance_sync as binance_sync_svc

router = APIRouter(prefix="/api/admin/options", tags=["admin-options"])


@router.post("/sync-binance-contracts", dependencies=[Depends(require_admin_permission("manage_settings"))])
async def sync_binance_contracts(body: Optional[Dict[str, Any]] = Body(default=None)):
    """Import listed contracts from Binance Options exchangeInfo (BTC/ETH by default)."""
    symbols = None
    if isinstance(body, dict) and body.get("symbols"):
        symbols = body["symbols"] if isinstance(body["symbols"], list) else None
    if symbols:
        results = []
        for sym in symbols:
            try:
                results.append(await binance_sync_svc.sync_underlying_from_binance(str(sym)))
            except Exception as exc:  # noqa: BLE001
                results.append({"underlying_symbol": sym, "error": str(exc)})
        return {"ok": True, "results": results}
    return await binance_sync_svc.sync_all_configured()


@router.post("/seed-demo-data", dependencies=[Depends(require_admin_permission("manage_settings"))])
async def seed_demo_data(body: Optional[Dict[str, Any]] = Body(default=None)):
    """
    Insert demo underlyings + contracts from **live Binance spot** (idempotent).
    Optional JSON body: ``{ "symbols": ["BTCUSDT", "ETHUSDT"] }`` (defaults to env or BTC+ETH).
    """
    symbols = None
    if isinstance(body, dict) and body.get("symbols"):
        symbols = body["symbols"] if isinstance(body["symbols"], list) else None
    try:
        return await seed_demo_options_into_db(symbols=symbols, force=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/overview", dependencies=[Depends(require_admin_permission("view_markets", "view_orders"))])
async def overview():
    d = db()
    taker_r, maker_r = await controls_svc.effective_fee_rates()
    return {
        "underlyings": await d["options_underlyings"].count_documents({}),
        "contracts": await d["options_contracts"].count_documents({}),
        "open_orders": await d["options_orders"].count_documents({"status": {"$in": ["open", "partially_filled"]}}),
        "open_positions": await d["options_positions"].count_documents({"status": "open"}),
        "controls": await controls_svc.read_controls(),
        "effective_fee_rates": {"taker": taker_r, "maker": maker_r},
        "defaults_fee_rates": {"taker": float(TAKER_FEE_RATE), "maker": float(MAKER_FEE_RATE)},
        "ops": {
            "mongo_multi_document_transactions": supports_transactions(),
            "match_lock_shard_count": MATCH_LOCK_SHARD_COUNT,
            "fee_sink_configured": bool(get_fee_sink_uid()),
            "last_auto_settle_tick": get_last_auto_settle_tick(),
        },
    }


@router.get("/controls", dependencies=[Depends(require_admin_permission("view_markets", "view_orders"))])
async def get_controls():
    return await controls_svc.read_controls()


@router.get(
    "/fee-sink-wallet",
    dependencies=[Depends(require_admin_permission("view_markets", "view_orders"))],
)
async def fee_sink_wallet():
    """Options USDT balance for the configured fee sink uid (same ledger as trading fees)."""
    uid = get_fee_sink_uid()
    if not uid:
        return {"enabled": False, "uid": None, "wallet": None}
    try:
        snap = await wallet_svc.snapshot(uid)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"enabled": True, "uid": uid, "wallet": snap}


@router.patch("/controls")
async def patch_controls(
    body: ControlsPatch,
    admin: dict = Depends(require_admin_permission("manage_settings")),
):
    raw = body.dict(exclude_unset=True)
    clear_fees = bool(raw.pop("options_clear_fee_overrides", False))
    updates = {k: v for k, v in raw.items() if v is not None}
    try:
        if clear_fees:
            await controls_svc.unset_stored_fee_rates()
        if updates:
            return await controls_svc.patch_controls(updates, admin_email=admin.get("email"))
        return await controls_svc.read_controls()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/underlyings", dependencies=[Depends(require_admin_permission("view_markets", "view_orders"))])
async def list_underlyings_admin(listed_only: bool = Query(False)):
    return {"underlyings": await und_svc.list_all(listed_only=listed_only)}


@router.post("/underlyings")
async def create_underlying(
    body: UnderlyingCreate,
    admin: dict = Depends(require_admin_permission("manage_settings")),
):
    try:
        row = await und_svc.create(body.dict())
        return row
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/underlyings/{underlying_id}")
async def patch_underlying(
    underlying_id: str,
    body: UnderlyingPatch,
    admin: dict = Depends(require_admin_permission("manage_settings")),
):
    try:
        return await und_svc.patch_by_id(underlying_id, body.dict(exclude_unset=True))
    except KeyError:
        raise HTTPException(status_code=404, detail="underlying not found")


@router.get("/contracts", dependencies=[Depends(require_admin_permission("view_markets", "view_orders"))])
async def list_contracts_admin(
    underlying_symbol: Optional[str] = Query(None),
    listed_only: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
):
    rows = await contracts_svc.list_contracts(
        underlying_symbol=underlying_symbol,
        listed_only=listed_only,
        limit=limit,
    )
    return {"contracts": rows}


@router.post("/contracts")
async def create_contract(
    body: ContractCreate,
    admin: dict = Depends(require_admin_permission("manage_settings")),
):
    try:
        return await contracts_svc.create(body.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/contracts/{contract_id}")
async def patch_contract(
    contract_id: str,
    body: ContractPatch,
    admin: dict = Depends(require_admin_permission("manage_settings")),
):
    try:
        return await contracts_svc.patch(contract_id, body.dict(exclude_unset=True))
    except KeyError:
        raise HTTPException(status_code=404, detail="contract not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/contracts/{contract_id}/settle")
async def settle_contract_admin(
    contract_id: str,
    dry_run: bool = Query(False, description="Compute payout preview without writing"),
    body: SettleContractRequest = Body(default_factory=SettleContractRequest),
    _admin: dict = Depends(require_admin_permission("manage_settings")),
):
    try:
        return await settlement_svc.settle_contract(
            contract_id,
            dry_run=dry_run,
            force=body.force,
            settlement_index_override=body.settlement_index,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/orders/{order_id}")
async def admin_cancel_order(
    order_id: str,
    admin: dict = Depends(require_admin_permission("manage_settings", "adjust_wallets")),
):
    o = await db()["options_orders"].find_one({"id": order_id}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="order not found")
    try:
        return await orders_svc.cancel_order(o["uid"], order_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
