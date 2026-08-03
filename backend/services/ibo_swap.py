"""Instant IBO ↔ USDT swap via IBOUSDT market orders."""

from __future__ import annotations

import math
from typing import Any, Dict, Literal, Tuple

SwapDirection = Literal["ibo_to_usdt", "usdt_to_ibo"]
SWAP_SYMBOL = "IBOUSDT"
FROM_ASSETS: Dict[SwapDirection, Tuple[str, str]] = {
    "ibo_to_usdt": ("IBO", "USDT"),
    "usdt_to_ibo": ("USDT", "IBO"),
}


def swap_usdt_notional(direction: SwapDirection, from_amount: float, price_usdt: float) -> float:
    """USDT notional of the swap leg (for fee %)."""
    px = max(float(price_usdt or 0.0), 1e-12)
    amt = max(float(from_amount or 0.0), 0.0)
    if direction == "ibo_to_usdt":
        return amt * px
    return amt


def compute_swap_platform_fee_ibo(
    direction: SwapDirection,
    from_amount: float,
    price_usdt: float,
    *,
    swap_fee_rate: float,
    swap_fee_ibo_fixed: float,
    ibo_price_usdt: float,
) -> Dict[str, float]:
    """
    Admin-configured swap charge (always settled in IBO).
    ``swap_fee_rate`` is a fraction of USDT notional; ``swap_fee_ibo_fixed`` is flat IBO per swap.
    """
    from services import ibo_fee as ibo_fee_svc

    rate = max(float(swap_fee_rate or 0.0), 0.0)
    fixed = max(float(swap_fee_ibo_fixed or 0.0), 0.0)
    notional = swap_usdt_notional(direction, from_amount, price_usdt)
    fee_usdt = notional * rate if rate > 0 else 0.0
    px = max(float(ibo_price_usdt or 0.0), 1e-12)
    fee_from_rate = ibo_fee_svc.usdt_notional_to_ibo_fee(fee_usdt, px) if fee_usdt > 0 else 0.0
    fee_ibo = round(fee_from_rate + fixed, 8)
    return {
        "swap_fee_rate": rate,
        "swap_fee_ibo_fixed": fixed,
        "swap_fee_usdt_component": round(fee_usdt, 8),
        "fee_ibo_estimated": fee_ibo,
        "usdt_notional": round(notional, 8),
    }


def _round_down(value: float, decimals: int = 8) -> float:
    if not math.isfinite(value) or value <= 0:
        return 0.0
    factor = 10 ** decimals
    return math.floor(value * factor + 1e-12) / factor


def estimate_swap_output(
    direction: SwapDirection,
    from_amount: float,
    price_usdt: float,
    *,
    swap_fee_rate: float,
    swap_fee_ibo_fixed: float,
    ibo_price_usdt: float,
    trading_fee_ibo_estimated: float = 0.0,
) -> Dict[str, Any]:
    """Rough preview — actual fill may differ slightly (spread, partial fills)."""
    px = max(float(price_usdt or 0.0), 1e-12)
    amt = max(float(from_amount or 0.0), 0.0)
    from_asset, to_asset = FROM_ASSETS[direction]

    if direction == "ibo_to_usdt":
        to_amount = amt * px
    else:
        to_amount = amt / px

    fee_parts = compute_swap_platform_fee_ibo(
        direction,
        amt,
        px,
        swap_fee_rate=swap_fee_rate,
        swap_fee_ibo_fixed=swap_fee_ibo_fixed,
        ibo_price_usdt=ibo_price_usdt,
    )
    swap_fee_ibo = fee_parts["fee_ibo_estimated"]
    trading_fee = max(float(trading_fee_ibo_estimated or 0.0), 0.0)
    fee_total = round(swap_fee_ibo + trading_fee, 8)

    return {
        "direction": direction,
        "symbol": SWAP_SYMBOL,
        "from_asset": from_asset,
        "to_asset": to_asset,
        "from_amount": round(amt, 8),
        "to_amount_estimated": round(to_amount, 8),
        "price_usdt": round(px, 8),
        "swap_fee_rate": fee_parts["swap_fee_rate"],
        "swap_fee_ibo_fixed": fee_parts["swap_fee_ibo_fixed"],
        "fee_ibo_estimated": swap_fee_ibo,
        "trading_fee_ibo_estimated": round(trading_fee, 8),
        "fee_ibo_total": fee_total,
        "fee_asset": "IBO",
        "usdt_notional": fee_parts["usdt_notional"],
    }


def build_market_order(
    direction: SwapDirection,
    from_amount: float,
    price_usdt: float,
    *,
    min_base_amount: float,
    min_order_value_usdt: float,
) -> Tuple[str, float]:
    """
    Returns (side, base_qty) for IBOUSDT market order.
    ``from_amount`` is always in the source asset (IBO or USDT).
    """
    px = max(float(price_usdt or 0.0), 1e-12)
    amt = float(from_amount or 0.0)
    if amt <= 0:
        raise ValueError("Amount must be greater than zero.")

    if direction == "ibo_to_usdt":
        base_qty = _round_down(amt, 8)
        if base_qty < min_base_amount:
            raise ValueError(f"Minimum swap is {min_base_amount} IBO.")
        if base_qty * px < min_order_value_usdt:
            raise ValueError(
                f"Minimum order value is ${min_order_value_usdt:.2f} USDT "
                f"(≈ {min_order_value_usdt / px:.4f} IBO at current price)."
            )
        return "sell", base_qty

    # USDT → IBO: convert quote spend to base size (slightly conservative)
    if amt < min_order_value_usdt:
        raise ValueError(f"Minimum swap is ${min_order_value_usdt:.2f} USDT.")
    base_qty = _round_down(amt / px, 8)
    if base_qty < min_base_amount:
        raise ValueError(
            f"Amount too small — need at least {min_base_amount} IBO "
            f"(≈ ${min_base_amount * px:.2f} USDT)."
        )
    return "buy", base_qty
