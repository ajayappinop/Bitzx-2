"""Platform IBO/USDT mark — never confuse with Binance's unrelated IBOUSDT listing."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Launch floor (Ibo IBO on BSC).
DEFAULT_IBO_USDT = 0.4523

# Default: +100% price multiplier per $250k net IBO invested (valued at floor).
DEFAULT_DEPOSIT_PRICE_SCALE_USD = 250_000.0

_controls_cache: Dict[str, Any] = {}
_deposit_cache: Dict[str, Any] = {
    "price": DEFAULT_IBO_USDT,
    "net_ibo": 0.0,
    "investment_usd": 0.0,
    "fetched_at": 0.0,
}
_DEPOSIT_CACHE_TTL_SEC = 30.0


def update_platform_controls_cache(controls: Optional[Dict[str, Any]]) -> None:
    """Called from ``get_platform_controls`` so sync workers can read admin override."""
    _controls_cache.clear()
    if controls:
        _controls_cache.update(controls)


def _floor_usdt(controls: Optional[Dict[str, Any]]) -> float:
    ctrl = controls if controls is not None else _controls_cache
    try:
        floor = float((ctrl or {}).get("ibo_price_floor_usdt") or 0.0)
        if floor > 0:
            return floor
    except (TypeError, ValueError):
        pass
    return float(DEFAULT_IBO_USDT)


def _deposit_driven_enabled(controls: Optional[Dict[str, Any]]) -> bool:
    ctrl = controls if controls is not None else _controls_cache
    if ctrl is None:
        return True
    flag = ctrl.get("ibo_price_deposit_driven")
    return flag is not False and flag != "false"


def _deposit_scale_usd(controls: Optional[Dict[str, Any]]) -> float:
    ctrl = controls if controls is not None else _controls_cache
    try:
        scale = float((ctrl or {}).get("ibo_deposit_price_scale_usd") or 0.0)
        if scale > 0:
            return scale
    except (TypeError, ValueError):
        pass
    return float(DEFAULT_DEPOSIT_PRICE_SCALE_USD)


def _price_ceiling(controls: Optional[Dict[str, Any]]) -> Optional[float]:
    ctrl = controls if controls is not None else _controls_cache
    try:
        cap = float((ctrl or {}).get("ibo_deposit_price_ceiling_usdt") or 0.0)
        return cap if cap > 0 else None
    except (TypeError, ValueError):
        return None


def price_from_investment_usd(
    investment_usd: float,
    *,
    controls: Optional[Dict[str, Any]] = None,
) -> float:
    """Map net IBO investment (USD at floor) → live platform mark."""
    floor = _floor_usdt(controls)
    scale = _deposit_scale_usd(controls)
    inv = max(0.0, float(investment_usd or 0.0))
    px = floor * (1.0 + inv / scale)
    cap = _price_ceiling(controls)
    if cap is not None:
        px = min(px, cap)
    return round(px, 8)


def deposit_driven_price_snapshot() -> Dict[str, Any]:
    """Last cached deposit-driven breakdown (for admin/debug)."""
    return dict(_deposit_cache)


def invalidate_deposit_driven_ibo_price() -> None:
    _deposit_cache["fetched_at"] = 0.0


async def refresh_deposit_driven_ibo_price(
    controls: Optional[Dict[str, Any]] = None,
) -> float:
    """Recompute IBO mark from credited on-chain + INR IBO minus withdrawals."""
    from services.db import get_db

    floor = _floor_usdt(controls)
    if not _deposit_driven_enabled(controls):
        px = floor
        _deposit_cache.update(
            {"price": px, "net_ibo": 0.0, "investment_usd": 0.0, "fetched_at": time.time()},
        )
        return px

    db = get_db()
    on_chain_ibo = 0.0
    inr_ibo = 0.0
    withdrawn_ibo = 0.0

    if db is not None:
        try:
            rows = await db.deposit_events.aggregate(
                [
                    {"$match": {"status": "credited", "asset": "IBO"}},
                    {
                        "$group": {
                            "_id": None,
                            "total": {
                                "$sum": {
                                    "$ifNull": [
                                        "$credited_amount",
                                        {"$ifNull": ["$amount", 0]},
                                    ],
                                },
                            },
                        },
                    },
                ],
            ).to_list(length=1)
            if rows:
                on_chain_ibo = float(rows[0].get("total") or 0.0)
        except Exception:  # noqa: BLE001
            logger.exception("ibo pricing: on-chain IBO aggregate failed")

        try:
            rows = await db.inr_deposits.aggregate(
                [
                    {"$match": {"status": "approved"}},
                    {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$amount_ibo", 0]}}}},
                ],
            ).to_list(length=1)
            if rows:
                inr_ibo = float(rows[0].get("total") or 0.0)
        except Exception:  # noqa: BLE001
            logger.debug("ibo pricing: INR IBO aggregate skipped or failed")

        try:
            rows = await db.withdrawal_requests.aggregate(
                [
                    {"$match": {"status": "confirmed", "asset": "IBO"}},
                    {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$amount", 0]}}}},
                ],
            ).to_list(length=1)
            if rows:
                withdrawn_ibo = float(rows[0].get("total") or 0.0)
        except Exception:  # noqa: BLE001
            logger.exception("ibo pricing: IBO withdrawal aggregate failed")

    net_ibo = max(0.0, on_chain_ibo + inr_ibo - withdrawn_ibo)
    investment_usd = net_ibo * floor
    px = price_from_investment_usd(investment_usd, controls=controls)

    _deposit_cache.update(
        {
            "price": px,
            "net_ibo": round(net_ibo, 8),
            "investment_usd": round(investment_usd, 4),
            "on_chain_ibo": round(on_chain_ibo, 8),
            "inr_ibo": round(inr_ibo, 8),
            "withdrawn_ibo": round(withdrawn_ibo, 8),
            "fetched_at": time.time(),
        },
    )
    logger.info(
        "ibo pricing: deposit-driven mark=%.8f net_ibo=%.4f investment_usd=%.2f",
        px, net_ibo, investment_usd,
    )
    return px


async def ensure_deposit_driven_ibo_price(
    controls: Optional[Dict[str, Any]] = None,
) -> float:
    """Cached async refresh — used on startup / after credits."""
    now = time.time()
    if (now - float(_deposit_cache.get("fetched_at") or 0.0)) < _DEPOSIT_CACHE_TTL_SEC:
        return float(_deposit_cache.get("price") or _floor_usdt(controls))
    return await refresh_deposit_driven_ibo_price(controls)


def platform_ibo_usdt_price(controls: Optional[Dict[str, Any]] = None) -> float:
    """Sync mark for wallets, markets, fees.

    Precedence: admin override → deposit-driven cache → floor constant.
    """
    ctrl = controls if controls is not None else _controls_cache
    try:
        p = float((ctrl or {}).get("ibo_price_override") or 0.0)
        if p > 0:
            return p
    except (TypeError, ValueError):
        pass

    if _deposit_driven_enabled(controls):
        cached = float(_deposit_cache.get("price") or 0.0)
        fetched = float(_deposit_cache.get("fetched_at") or 0.0)
        if cached > 0 and (time.time() - fetched) < _DEPOSIT_CACHE_TTL_SEC * 4:
            return cached
        # Cold start — return floor until async refresh runs.
        return price_from_investment_usd(0.0, controls=controls)

    return _floor_usdt(controls)
