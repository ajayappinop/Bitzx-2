"""Platform controls for options (``platform_controls`` id=options)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from services.db import get_db

from ..fee_sink import get_fee_sink_uid

logger = logging.getLogger(__name__)

COL_PLATFORM_CONTROLS = "platform_controls"

DEFAULTS: Dict[str, Any] = {
    "options_enabled": True,
    "options_trading_paused": False,
    "options_new_orders_paused": False,
    "options_transfers_paused": False,
    "options_synthetic_fills_enabled": True,
    # None → use module constants in ``options.constants`` (see ``effective_fee_rates``).
    "options_taker_fee_rate": None,
    "options_maker_fee_rate": None,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def read_controls() -> Dict[str, Any]:
    doc = await get_db()[COL_PLATFORM_CONTROLS].find_one({"id": "options"}, {"_id": 0}) or {}
    out = dict(DEFAULTS)
    out.update({k: v for k, v in doc.items() if k.startswith("options_")})
    return out


async def effective_fee_rates() -> tuple[float, float]:
    """Return ``(taker_rate, maker_rate)`` as fractions of premium notional.

    Taker: 0–0.1. Maker: -0.05–0.1 (negative = rebate).
    """
    from ..constants import MAKER_FEE_RATE as DEF_MAKER
    from ..constants import TAKER_FEE_RATE as DEF_TAKER

    c = await read_controls()

    def _taker(key: str, default: float) -> float:
        v = c.get(key)
        if v is None:
            return float(default)
        if isinstance(v, (int, float)):
            x = float(v)
            if 0.0 <= x <= 0.1:
                return x
        return float(default)

    def _maker(key: str, default: float) -> float:
        v = c.get(key)
        if v is None:
            return float(default)
        if isinstance(v, (int, float)):
            x = float(v)
            if -0.05 <= x <= 0.1:
                return x
        return float(default)

    return (
        _taker("options_taker_fee_rate", DEF_TAKER),
        _maker("options_maker_fee_rate", DEF_MAKER),
    )


async def unset_stored_fee_rates() -> None:
    """Drop stored fee overrides so :func:`effective_fee_rates` uses code defaults."""
    await get_db()[COL_PLATFORM_CONTROLS].update_one(
        {"id": "options"},
        {"$unset": {"options_taker_fee_rate": "", "options_maker_fee_rate": ""}},
    )


async def patch_controls(updates: Dict[str, Any], *, admin_email: Optional[str] = None) -> Dict[str, Any]:
    bad = [k for k in updates if not k.startswith("options_")]
    if bad:
        raise ValueError(f"unknown control keys: {bad}")
    coerced: Dict[str, Any] = {}
    for k, v in updates.items():
        if v is None:
            continue
        default = DEFAULTS.get(k)
        if isinstance(default, bool):
            coerced[k] = bool(v)
        elif k == "options_taker_fee_rate":
            try:
                x = float(v)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{k} must be a number between 0 and 0.1") from exc
            if not 0.0 <= x <= 0.1:
                raise ValueError(f"{k} must be between 0 and 0.1")
            coerced[k] = x
        elif k == "options_maker_fee_rate":
            try:
                x = float(v)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{k} must be a number between -0.05 and 0.1") from exc
            if not -0.05 <= x <= 0.1:
                raise ValueError(f"{k} must be between -0.05 and 0.1")
            if x < 0 and not get_fee_sink_uid():
                raise ValueError(
                    "negative maker fee (IBO rebate) requires OPTIONS_FEE_SINK_UID so rebates debit the spot IBO fee sink wallet"
                )
            coerced[k] = x
        else:
            coerced[k] = v
    if not coerced:
        return await read_controls()
    coerced["updated_at"] = _now_iso()
    if admin_email:
        coerced["updated_by"] = admin_email
    await get_db()[COL_PLATFORM_CONTROLS].update_one(
        {"id": "options"},
        {"$set": coerced, "$setOnInsert": {"id": "options", "created_at": _now_iso()}},
        upsert=True,
    )
    return await read_controls()


async def is_trading_blocked() -> bool:
    c = await read_controls()
    if not c.get("options_enabled", True):
        return True
    return bool(c.get("options_trading_paused", False))


async def is_new_orders_blocked() -> bool:
    c = await read_controls()
    if not c.get("options_enabled", True):
        return True
    return bool(c.get("options_new_orders_paused", False)) or bool(c.get("options_trading_paused", False))


async def are_transfers_blocked() -> bool:
    c = await read_controls()
    if not c.get("options_enabled", True):
        return True
    return bool(c.get("options_transfers_paused", False)) or bool(c.get("options_trading_paused", False))


async def synthetic_fills_enabled() -> bool:
    c = await read_controls()
    return bool(c.get("options_synthetic_fills_enabled", True))
