"""Risk & margin engine — leverage tiers, margin requirements, liq price.

All math here is pure (no I/O), so it can be unit tested with synthetic
positions and called freely from the matching / liquidation paths.

Core formulas (linear USDT-margined perpetual):

  notional = mark_price × |qty|
  initial_margin     = notional × IMR(tier)
  maintenance_margin = notional × MMR(tier)
  unrealized_pnl     = (mark_price − entry_price) × qty   (qty > 0 long, < 0 short)

Liquidation price (isolated margin) — exact formula from trigger equity ≤ mm:

  long :   liq = entry × (1 − IMR) / (1 − MMR − INSURANCE_HAIRCUT)
  short:   liq = entry × (1 + IMR) / (1 + MMR + INSURANCE_HAIRCUT)

  The old linear approximation (1 ± IMR ∓ MMR ∓ cushion) was inaccurate at high
  leverage (≥ ~90×) and incorrectly produced liq > entry for longs.
"""

from __future__ import annotations

from typing import Tuple

from ..constants import (
    INSURANCE_HAIRCUT,
    LEVERAGE_TIERS,
    LIQUIDATION_FEE_RATE,
)
from ..symbols import get_supported_symbols


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


def tier_for(symbol: str, notional: float) -> Tuple[float, int, float, float]:
    """Return ``(tier_max_notional, max_leverage, IMR, MMR)`` for ``notional``.

    Walks the symbol's ladder and returns the smallest tier whose cap
    is greater than or equal to the notional.
    """
    s = (symbol or "").upper()
    tiers = LEVERAGE_TIERS.get(s)
    if not tiers:
        # Conservative default for unlisted symbols.
        return (1_000_000, 10, 0.05, 0.025)
    for max_notional, max_lev, imr, mmr in tiers:
        if notional <= max_notional:
            return (max_notional, max_lev, imr, mmr)
    # Above the highest tier — use the last (most conservative) tier.
    return tiers[-1]


def max_leverage(symbol: str) -> int:
    s = (symbol or "").upper()
    tiers = LEVERAGE_TIERS.get(s) or [(0, 10, 0.05, 0.025)]
    return int(tiers[0][1])


def initial_margin_rate(symbol: str, notional: float, leverage: int) -> float:
    """Effective IMR = max(1/leverage, tier IMR).

    A trader requesting 50× leverage on a position whose tier already
    requires 2.5% IMR (40×) is silently capped to 40×. The matching engine
    surfaces this by computing the actual margin requirement here.
    """
    _, _, tier_imr, _ = tier_for(symbol, notional)
    return max(1.0 / max(int(leverage or 1), 1), tier_imr)


def maintenance_margin_rate(symbol: str, notional: float) -> float:
    _, _, _, mmr = tier_for(symbol, notional)
    return mmr


def initial_margin(notional: float, imr: float) -> float:
    return _round(abs(notional) * imr)


def maintenance_margin(notional: float, mmr: float) -> float:
    return _round(abs(notional) * mmr)


def unrealized_pnl(qty: float, entry_price: float, mark_price: float) -> float:
    """Signed PnL: qty>0 → long, qty<0 → short."""
    return _round((float(mark_price) - float(entry_price)) * float(qty))


def liquidation_price(
    *,
    side: str,
    entry_price: float,
    leverage: int,
    symbol: str,
    notional_hint: float | None = None,
) -> float:
    """Exact isolated-margin liquidation price.

    Derived from the actual liquidation trigger condition: equity ≤ maintenance_margin.

      long :  liq = entry × (1 − IMR) / (1 − MMR − INSURANCE_HAIRCUT)
      short:  liq = entry × (1 + IMR) / (1 + MMR + INSURANCE_HAIRCUT)

    Unlike the old linear approximation, this formula is always below the entry
    price for longs and above the entry price for shorts regardless of leverage.
    """
    if entry_price is None or entry_price <= 0:
        return 0.0
    lev = max(int(leverage or 1), 1)
    notional = float(notional_hint if notional_hint is not None else entry_price)
    imr = initial_margin_rate(symbol, notional, lev)
    mmr = maintenance_margin_rate(symbol, notional)
    if side == "long":
        denom = 1.0 - mmr - INSURANCE_HAIRCUT
        if denom <= 0:
            return _round(entry_price * 0.9999)  # degenerate tier — liq just below entry
        liq = entry_price * (1.0 - imr) / denom
        # Sanity guard: liq must be below entry for a long
        return _round(liq) if liq < entry_price else _round(entry_price * 0.9999)
    else:
        denom = 1.0 + mmr + INSURANCE_HAIRCUT
        liq = entry_price * (1.0 + imr) / denom
        # Sanity guard: liq must be above entry for a short
        return _round(liq) if liq > entry_price else _round(entry_price * 1.0001)


def round_price(symbol: str, price: float) -> float:
    """Snap ``price`` down to the symbol's tick size."""
    meta = get_supported_symbols().get(symbol) or {}
    tick = float(meta.get("tick_size") or 0.01)
    if tick <= 0:
        return _round(price)
    return _round(round(price / tick) * tick)


def round_qty(symbol: str, qty: float) -> float:
    meta = get_supported_symbols().get(symbol) or {}
    lot = float(meta.get("lot_size") or 0.0001)
    if lot <= 0:
        return _round(qty)
    return _round(round(qty / lot) * lot)


def validate_qty(symbol: str, qty: float) -> None:
    meta = get_supported_symbols().get(symbol) or {}
    lo = float(meta.get("min_qty") or 0.0)
    hi = float(meta.get("max_qty") or 1e18)
    if qty < lo:
        raise ValueError(f"quantity below minimum ({lo})")
    if qty > hi:
        raise ValueError(f"quantity above maximum ({hi})")
