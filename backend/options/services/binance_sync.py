"""Sync listed contracts from Binance Options exchangeInfo into Mongo."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

from ..constants import COL_CONTRACTS
from ..db import db
from ..providers.binance import BinanceOptionsProvider
from ..providers.registry import get_external_provider
from . import contracts as contracts_svc
from . import underlyings as und_svc
from .contracts import _contract_id

logger = logging.getLogger(__name__)

DEFAULT_UNDERLYINGS: List[str] = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "LTCUSDT",
    "DOTUSDT",
    "TRXUSDT",
    "TONUSDT",
    "NEARUSDT",
    "ATOMUSDT",
    "FILUSDT",
    "OPUSDT",
    "ARBUSDT",
    "SUIUSDT",
    "APTUSDT",
    "INJUSDT",
    "SEIUSDT",
    "WLDUSDT",
    "PEPEUSDT",
    "SHIBUSDT",
]


def _sync_enabled() -> bool:
    return (os.getenv("OPTIONS_BINANCE_SYNC_CONTRACTS") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _provider() -> BinanceOptionsProvider:
    ext = get_external_provider()
    if isinstance(ext, BinanceOptionsProvider):
        return ext
    return BinanceOptionsProvider()


async def discover_binance_underlyings() -> List[str]:
    """Return unique *USDT underlyings from Binance Options exchangeInfo."""
    body = await _provider()._get_json("/eapi/v1/exchangeInfo")  # noqa: SLF001
    if not isinstance(body, dict):
        return []
    rows = body.get("optionSymbols") or body.get("optionContracts") or []
    found: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = str(row.get("underlying") or row.get("underlyingAsset") or "").strip().upper()
        if not raw:
            continue
        sym = raw if raw.endswith("USDT") else f"{raw}USDT"
        if len(sym) >= 7 and sym.endswith("USDT"):
            found.add(sym)
    return sorted(found)


async def resolve_sync_symbols() -> List[str]:
    """Configured symbols, or auto-discover all Binance option underlyings."""
    raw = (
        os.getenv("OPTIONS_BINANCE_SYNC_SYMBOLS")
        or os.getenv("BINANCE_OPTIONS_UNDERLYINGS")
        or "auto"
    ).strip()
    if raw.lower() in ("auto", "*", "all"):
        discovered = await discover_binance_underlyings()
        if discovered:
            return discovered
        return list(DEFAULT_UNDERLYINGS)
    parts = [p.strip().upper() for p in raw.split(",") if p.strip()]
    return parts or list(DEFAULT_UNDERLYINGS)


async def ensure_underlyings_listed(symbols: List[str]) -> int:
    """Create missing underlying rows so mobile /underlyings lists them."""
    created = 0
    for sym in symbols:
        try:
            usym = und_svc._norm_symbol(sym)
        except ValueError:
            continue
        if await und_svc.get_by_symbol(usym):
            continue
        try:
            await und_svc.create({"symbol": usym, "listed": True})
            created += 1
        except ValueError:
            pass
    return created

async def sync_underlying_from_binance(
    underlying_symbol: str,
    *,
    limit: int = 400,
) -> Dict[str, Any]:
    """Upsert Binance option contracts for one underlying (idempotent)."""
    usym = und_svc._norm_symbol(underlying_symbol)
    provider = _provider()

    refs = await provider.list_external_contracts(usym, limit=limit)
    if not refs:
        return {"underlying_symbol": usym, "created": 0, "skipped": 0, "reason": "no_binance_contracts"}

    u = await und_svc.get_by_symbol(usym)
    if not u:
        try:
            await und_svc.create({"symbol": usym, "listed": True})
        except ValueError:
            pass

    created = 0
    skipped = 0
    for ref in refs:
        expiry = ref.get("expiry")
        strike = float(ref.get("strike") or 0)
        opt = str(ref.get("option_type") or "call").lower()
        if not expiry or strike <= 0 or opt not in ("call", "put"):
            skipped += 1
            continue
        cid = _contract_id(usym, expiry, strike, opt)
        existing = await contracts_svc.get(cid)
        if existing:
            skipped += 1
            continue
        try:
            await contracts_svc.create(
                {
                    "underlying_symbol": usym,
                    "expiry": expiry,
                    "strike": strike,
                    "option_type": opt,
                    "tick_size": float(ref.get("tick_size") or 0.01),
                    "lot_size": float(ref.get("lot_size") or 0.01),
                    "min_qty": float(ref.get("lot_size") or 0.01),
                    "max_qty": 1_000_000.0,
                    "listed": True,
                    "trading_enabled": True,
                }
            )
            created += 1
        except ValueError:
            skipped += 1

    total = int(await db()[COL_CONTRACTS].count_documents({"underlying_symbol": usym, "listed": True}))
    return {
        "underlying_symbol": usym,
        "created": created,
        "skipped": skipped,
        "listed_total": total,
        "binance_refs": len(refs),
    }


async def sync_all_configured() -> Dict[str, Any]:
    if not _sync_enabled():
        return {"skipped": True, "reason": "OPTIONS_BINANCE_SYNC_CONTRACTS=0"}
    symbols = await resolve_sync_symbols()
    await ensure_underlyings_listed(symbols)
    sem = asyncio.Semaphore(int(os.getenv("OPTIONS_BINANCE_SYNC_CONCURRENCY", "4")))

    async def _one(sym: str) -> Dict[str, Any]:
        async with sem:
            try:
                return await sync_underlying_from_binance(sym)
            except Exception as exc:  # noqa: BLE001
                logger.warning("binance contract sync failed for %s: %s", sym, exc)
                return {"underlying_symbol": sym, "error": str(exc)}

    results = await asyncio.gather(*[_one(s) for s in symbols])
    return {"ok": True, "symbols": symbols, "results": list(results)}