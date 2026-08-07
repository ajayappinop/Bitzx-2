"""Public market-data REST routes for options."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..services import candles as candles_svc
from ..services import contracts as contracts_svc
from ..services import market_data as market_svc
from ..services import ticker as ticker_svc
from ..schemas.documents import enrich_contract_row

router = APIRouter(tags=["options-market"])


@router.get("/chain/{symbol}")
async def chain_by_symbol(
    symbol: str,
    listed_only: bool = Query(True),
    include_market: bool = Query(True),
):
    sym = symbol.strip().upper()
    return await market_svc.get_chain(sym, listed_only=listed_only, include_market=include_market)


@router.get("/orderbook/{contract}")
async def orderbook_by_contract(contract: str, limit: int = Query(25, ge=1, le=100)):
    c = await contracts_svc.get(contract)
    if not c:
        raise HTTPException(status_code=404, detail="contract not found")
    snap = await market_svc.get_orderbook(contract, depth=limit)
    return {"contract_id": contract, **snap}


@router.get("/market/trades/{contract}")
async def trades_by_contract(contract: str, limit: int = Query(50, ge=1, le=200)):
    """Public tape for a contract. Prefer /contracts/{id}/trades; this path avoids clashing with /trades/me."""
    c = await contracts_svc.get(contract)
    if not c:
        raise HTTPException(status_code=404, detail="contract not found")
    rows = await market_svc.get_trades(contract, limit=limit)
    return {"contract_id": contract, "trades": rows}


@router.get("/ticker/{contract}")
async def ticker_by_contract(contract: str):
    tick = await ticker_svc.get_ticker(contract)
    if not tick:
        raise HTTPException(status_code=404, detail="contract not found")
    return tick


@router.get("/history")
async def history_candles(
    contract_id: Optional[str] = Query(None),
    underlying_symbol: Optional[str] = Query(None),
    interval: str = Query("1h"),
    limit: int = Query(200, ge=1, le=1000),
):
    if not contract_id and not underlying_symbol:
        raise HTTPException(status_code=400, detail="contract_id or underlying_symbol required")
    return await candles_svc.get_history(
        contract_id=contract_id,
        underlying_symbol=underlying_symbol,
        interval=interval,
        limit=limit,
    )
