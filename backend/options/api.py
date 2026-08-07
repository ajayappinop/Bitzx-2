"""User-facing REST API for options (v1)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from services.errors import InsufficientFundsError

from .deps import current_user
from .models import OrderCreateRequest, TransferRequest
from .services import contracts as contracts_svc
from .services import controls as controls_svc
from .services import greeks as greeks_svc
from .services import orderbook as orderbook_svc
from .services import orders as orders_svc
from .services import underlyings as und_svc
from .services import positions as pos_svc
from .routes import market_router
from .services import portfolio as portfolio_svc
from .services import trades_public as trades_pub_svc
from .services import wallet as wallet_svc
from .services.settlement import parse_contract_expiry

router = APIRouter(prefix="/api/options", tags=["options"])


@router.get("/trades/me")
async def my_trades(
    contract_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    user: dict = Depends(current_user),
):
    # Registered before market routes so it is not shadowed by any /trades/{…} path.
    return {"trades": await orders_svc.list_user_trades(user["uid"], contract_id=contract_id, limit=limit)}


router.include_router(market_router)


@router.get("/underlyings")
async def list_underlyings(listed_only: bool = Query(True)):
    rows = await und_svc.list_all(listed_only=listed_only)
    return {"underlyings": rows}


@router.get("/fee-rates")
async def public_fee_rates():
    """Effective taker/maker fee fractions on premium notional (``price × qty`` per fill). Maker may be negative (rebate)."""
    from services import ibo_fee as ibo_fee_svc

    taker_r, maker_r = await controls_svc.effective_fee_rates()
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()
    return {
        "taker_fee_rate": taker_r,
        "maker_fee_rate": maker_r,
        "basis": "premium_notional",
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "ibo_price_usdt": float(ibo_px),
    }


@router.get("/index-price")
async def index_price(symbol: str = Query(..., min_length=5, description="e.g. BTCUSDT")):
    """Cached index price (Binance options by default, with provider fallback)."""
    from .providers.registry import get_index_price as resolve_index

    sym = symbol.strip().upper()
    price = await resolve_index(sym)
    if price is None:
        raise HTTPException(status_code=503, detail=f"index price for {sym} currently unavailable")
    from .providers.registry import get_index_provider

    return {"symbol": sym, "price": price, "source": get_index_provider().name}


@router.get("/contracts")
async def list_contracts(
    underlying_symbol: Optional[str] = Query(None),
    listed_only: bool = Query(True),
    # Default vanilla so the Options chain never mixes MOVE/straddle contracts.
    # Pass option_type=move|all explicitly when needed.
    option_type: Optional[str] = Query("vanilla", description="call|put|move|vanilla|all"),
    limit: int = Query(200, ge=1, le=500),
):
    ot = (option_type or "vanilla").lower().strip()
    rows = await contracts_svc.list_contracts(
        underlying_symbol=underlying_symbol,
        listed_only=listed_only,
        option_type=None if ot == "all" else ot,
        limit=limit,
    )
    return {"contracts": rows}


@router.get("/contracts/{contract_id}/depth")
async def contract_depth(contract_id: str, levels: int = Query(20, ge=1, le=100)):
    """Public aggregate depth (resting limit orders) for a contract."""
    c = await contracts_svc.get(contract_id)
    if not c:
        raise HTTPException(status_code=404, detail="contract not found")
    return await orderbook_svc.depth_snapshot(contract_id, levels=levels)


@router.get("/contracts/{contract_id}/trades")
async def contract_public_trades(contract_id: str, limit: int = Query(40, ge=1, le=200)):
    """Public recent fills (tape) for a contract — no account identifiers."""
    c = await contracts_svc.get(contract_id)
    if not c:
        raise HTTPException(status_code=404, detail="contract not found")
    rows = await trades_pub_svc.list_recent_contract_trades(contract_id, limit=limit)
    return {"contract_id": contract_id, "trades": rows}


@router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str):
    c = await contracts_svc.get(contract_id)
    if not c:
        raise HTTPException(status_code=404, detail="contract not found")
    return c


@router.get("/chain")
async def get_chain(
    underlying_symbol: str = Query(..., min_length=5),
    listed_only: bool = Query(True),
    include_market: bool = Query(
        True,
        description="Attach best bid/ask, last trade, OI, and Black-Scholes greeks per contract.",
    ),
):
    """Listed contracts for an underlying, with market data and greeks for chain UIs."""
    from .services import market_data as market_svc

    sym = underlying_symbol.strip().upper()
    return await market_svc.get_chain(sym, listed_only=listed_only, include_market=include_market)


@router.get("/move-chain")
async def get_move_chain(
    underlying_symbol: str = Query(..., min_length=5),
    listed_only: bool = Query(True),
):
    """MOVE / straddle contracts (Delta-style MV product) for the Move trade page."""
    from datetime import datetime, timezone

    from .providers.registry import get_index_price
    from .services import binance_reference as binance_ref
    from .demo_data import build_demo_contract_dicts, resolve_demo_spot

    sym = underlying_symbol.strip().upper()
    rows = await contracts_svc.list_contracts(
        underlying_symbol=sym,
        listed_only=listed_only,
        option_type="move",
        limit=200,
    )
    index_px = await get_index_price(sym)
    if not rows:
        # Preview from demo geometry when DB has no MOVE listings yet
        try:
            spot = float(index_px) if index_px else await resolve_demo_spot(sym)
            rows = [r for r in build_demo_contract_dicts(sym, spot) if r.get("option_type") == "move"]
            index_px = spot
        except Exception:
            rows = []
    now_dt = datetime.now(timezone.utc)
    spot = float(index_px or 0)
    if spot > 0:
        for row in rows:
            syn = binance_ref._synthetic_quote(row, spot, now_dt)
            if syn:
                binance_ref._apply_market_to_row(row, syn, index_px=spot, now_dt=now_dt)
    return {
        "underlying_symbol": sym,
        "product": "move",
        "index_price": index_px,
        "contracts": rows,
    }


@router.get("/demo-chain")
async def get_demo_chain(underlying_symbol: str = Query(..., min_length=5)):
    """Synthetic chain from live Binance spot (for empty dev DBs). Not persisted; UI may merge as preview."""
    from .demo_data import demo_chain_payload

    try:
        payload = await demo_chain_payload(underlying_symbol)
        # Vanilla options page only — MOVE has /move-chain
        payload["contracts"] = [
            c for c in (payload.get("contracts") or [])
            if str(c.get("option_type") or "").lower() != "move"
        ]
        return payload
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/analytics/recent-trades")
async def analytics_recent_trades(
    underlying_symbol: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
):
    """Public recent options fills for the Options Analytics tape (Delta-style)."""
    from .services import contracts as c_svc

    rows = await trades_pub_svc.list_recent_trades(
        underlying_symbol=underlying_symbol,
        limit=limit,
    )
    # Enrich with strike / type / expiry from contract docs when available
    enriched = []
    for t in rows:
        cid = str(t.get("contract_id") or "")
        c = await c_svc.get(cid) if cid else None
        enriched.append({
            **t,
            "underlying_symbol": (c or {}).get("underlying_symbol"),
            "option_type": (c or {}).get("option_type"),
            "strike": (c or {}).get("strike"),
            "expiry": (c or {}).get("expiry"),
            "taker": "buy" if str(t.get("side") or "").lower() == "buy" else "sell",
            "notional": float(t.get("price") or 0) * float(t.get("qty") or 0),
        })
    return {"trades": enriched, "count": len(enriched)}


@router.get("/wallet")
async def wallet(user: dict = Depends(current_user)):
    return await wallet_svc.snapshot(user["uid"])


@router.post("/wallet/transfer")
async def wallet_transfer(body: TransferRequest, user: dict = Depends(current_user)):
    try:
        if body.direction == "spot_to_options":
            return await wallet_svc.transfer_in(user["uid"], body.amount, asset=body.asset)
        return await wallet_svc.transfer_out(user["uid"], body.amount, asset=body.asset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except InsufficientFundsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/wallet/txns")
async def wallet_txns(
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    user: dict = Depends(current_user),
):
    return {"txns": await wallet_svc.list_txns(user["uid"], limit=limit, skip=skip)}


@router.post("/orders")
async def create_order(body: OrderCreateRequest, user: dict = Depends(current_user)):
    try:
        return await orders_svc.place_order(user["uid"], body)
    except (ValueError, InsufficientFundsError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/orders/{order_id}")
async def cancel_order(order_id: str, user: dict = Depends(current_user)):
    try:
        return await orders_svc.cancel_order(user["uid"], order_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/orders/open")
async def open_orders(contract_id: Optional[str] = Query(None), user: dict = Depends(current_user)):
    return {"orders": await orders_svc.list_open(user["uid"], contract_id=contract_id)}


@router.get("/orders/history")
async def order_history(
    contract_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    user: dict = Depends(current_user),
):
    return {"orders": await orders_svc.list_history(user["uid"], contract_id=contract_id, limit=limit)}


@router.get("/positions")
async def positions(user: dict = Depends(current_user)):
    return {"positions": await pos_svc.list_open(user["uid"])}


@router.get("/portfolio")
async def portfolio(user: dict = Depends(current_user)):
    return await portfolio_svc.snapshot(user["uid"])
