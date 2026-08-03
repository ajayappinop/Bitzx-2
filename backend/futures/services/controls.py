"""Futures-specific platform controls + per-symbol config overrides.

Why a dedicated layer:
  * Spot already keeps its toggles in ``platform_controls``. We re-use the
    same collection so admins have *one* place to look, but namespace
    every key with ``futures_*`` to keep them visually segregated.
  * Per-symbol overrides (tick/lot/listed/leverage cap) live in a new
    collection ``futures_symbol_config`` so admins can change them at
    runtime without code deploys. The defaults in
    ``futures.constants.SUPPORTED_SYMBOLS`` are the source of truth when
    no override exists.

This module exposes pure read/merge helpers; the admin REST router does
the actual writes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.db import get_db

from ..constants import (
    ALLOWED_LEVERAGE,
    FUNDING_CAP,
    LEVERAGE_TIERS,
    LIQUIDATION_FEE_RATE,
    MAKER_FEE_RATE,
    MIN_ORDER_NOTIONAL_USDT,
    TAKER_FEE_RATE,
)
from ..symbols import get_supported_symbols

logger = logging.getLogger(__name__)

COL_PLATFORM_CONTROLS = "platform_controls"
COL_SYMBOL_CONFIG     = "futures_symbol_config"

# Defaults applied when the platform_controls doc has no value yet.
FUTURES_DEFAULTS: Dict[str, Any] = {
    "futures_enabled":       True,
    "futures_trading_paused": False,
    "futures_new_orders_paused": False,
    "futures_transfers_paused": False,
    "futures_max_leverage_cap": 125,           # global hard cap
    "futures_maker_fee_rate":  MAKER_FEE_RATE,
    "futures_taker_fee_rate":  TAKER_FEE_RATE,
    "futures_liquidation_fee_rate": LIQUIDATION_FEE_RATE,
    "futures_funding_cap":   FUNDING_CAP,
    "futures_min_notional_usdt": MIN_ORDER_NOTIONAL_USDT,
    "futures_synthetic_fills_enabled": True,   # SYSTEM-side fills on market remainders
    "futures_mark_blend_index_weight": 0.7,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Platform controls (futures slice) ─────────────────────────────────────

async def read_controls() -> Dict[str, Any]:
    """Return the merged futures controls document.

    Pulls every ``futures_*`` key from the ``platform_controls`` document
    keyed by ``id="futures"`` (mirrors spot's ``id="global"``) and
    overlays on top of :data:`FUTURES_DEFAULTS`."""
    doc = await get_db()[COL_PLATFORM_CONTROLS].find_one(
        {"id": "futures"}, {"_id": 0}
    ) or {}
    out = dict(FUTURES_DEFAULTS)
    out.update({k: v for k, v in doc.items() if k.startswith("futures_")})
    return out


async def patch_controls(updates: Dict[str, Any], *, admin_email: Optional[str] = None) -> Dict[str, Any]:
    """Patch futures controls. Only known keys are accepted."""
    bad = [k for k in updates if not k.startswith("futures_")]
    if bad:
        raise ValueError(f"unknown control keys: {bad}")

    # Coerce types.
    coerced: Dict[str, Any] = {}
    for k, v in updates.items():
        if v is None:
            continue
        default = FUTURES_DEFAULTS.get(k)
        if isinstance(default, bool):
            coerced[k] = bool(v)
        elif isinstance(default, (int, float)):
            try:
                coerced[k] = type(default)(v)
            except (TypeError, ValueError):
                raise ValueError(f"{k} must be {type(default).__name__}")
        else:
            coerced[k] = v

    if not coerced:
        return await read_controls()

    coerced["updated_at"] = _now_iso()
    if admin_email:
        coerced["updated_by"] = admin_email
    await get_db()[COL_PLATFORM_CONTROLS].update_one(
        {"id": "futures"},
        {
            "$set": coerced,
            "$setOnInsert": {"id": "futures", "created_at": _now_iso()},
        },
        upsert=True,
    )
    return await read_controls()


# Convenience helpers for the engine.

async def is_trading_paused() -> bool:
    c = await read_controls()
    return not bool(c.get("futures_enabled", True)) or bool(c.get("futures_trading_paused", False))


async def is_new_orders_paused() -> bool:
    c = await read_controls()
    if not c.get("futures_enabled", True):
        return True
    return bool(c.get("futures_new_orders_paused", False)) or bool(c.get("futures_trading_paused", False))


async def are_transfers_paused() -> bool:
    c = await read_controls()
    return not bool(c.get("futures_enabled", True)) or bool(c.get("futures_transfers_paused", False))


# ── Per-symbol overrides ─────────────────────────────────────────────────

def _base_symbol_doc(symbol: str) -> Dict[str, Any]:
    meta = get_supported_symbols().get(symbol)
    if not meta:
        raise KeyError(symbol)
    tiers = LEVERAGE_TIERS.get(symbol) or []
    max_lev = int(tiers[0][1]) if tiers else 10
    return {
        "symbol": symbol,
        "base":   meta["base"],
        "quote":  meta["quote"],
        "binance_symbol": meta["binance_symbol"],
        "tick_size": meta["tick_size"],
        "lot_size":  meta["lot_size"],
        "min_qty":   meta["min_qty"],
        "max_qty":   meta["max_qty"],
        "max_leverage": max_lev,
        "listed": True,
        "trading_enabled": True,
        "leverage_tiers": [
            {"max_notional": t[0], "max_leverage": t[1], "imr": t[2], "mmr": t[3]}
            for t in tiers
        ],
    }


async def get_symbol_config(symbol: str) -> Dict[str, Any]:
    base = _base_symbol_doc(symbol)
    override = await get_db()[COL_SYMBOL_CONFIG].find_one(
        {"symbol": symbol}, {"_id": 0}
    ) or {}
    out = {**base, **{k: v for k, v in override.items() if v is not None and k != "symbol"}}
    return out


async def list_symbol_configs() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for sym in get_supported_symbols().keys():
        out.append(await get_symbol_config(sym))
    return out


PATCHABLE_SYMBOL_FIELDS = {
    "tick_size", "lot_size", "min_qty", "max_qty",
    "max_leverage", "listed", "trading_enabled",
}


async def patch_symbol_config(
    symbol: str,
    updates: Dict[str, Any],
    *,
    admin_email: Optional[str] = None,
) -> Dict[str, Any]:
    if symbol not in get_supported_symbols():
        raise KeyError(symbol)
    bad = [k for k in updates if k not in PATCHABLE_SYMBOL_FIELDS]
    if bad:
        raise ValueError(f"unknown symbol fields: {bad}")

    coerced: Dict[str, Any] = {}
    for k, v in updates.items():
        if v is None:
            continue
        if k in ("listed", "trading_enabled"):
            coerced[k] = bool(v)
        elif k == "max_leverage":
            iv = int(v)
            if iv not in ALLOWED_LEVERAGE:
                raise ValueError(f"max_leverage must be one of {ALLOWED_LEVERAGE}")
            coerced[k] = iv
        else:
            try:
                coerced[k] = float(v)
            except (TypeError, ValueError):
                raise ValueError(f"{k} must be numeric")

    if coerced:
        coerced["updated_at"] = _now_iso()
        if admin_email:
            coerced["updated_by"] = admin_email
        await get_db()[COL_SYMBOL_CONFIG].update_one(
            {"symbol": symbol},
            {"$set": coerced, "$setOnInsert": {"created_at": _now_iso()}},
            upsert=True,
        )
    return await get_symbol_config(symbol)


async def is_symbol_tradable(symbol: str) -> bool:
    if symbol not in get_supported_symbols():
        return False
    cfg = await get_symbol_config(symbol)
    return bool(cfg.get("listed", True)) and bool(cfg.get("trading_enabled", True))
