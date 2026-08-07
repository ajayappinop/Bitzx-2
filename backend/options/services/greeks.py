"""Black-Scholes European option pricing, Greeks, and implied volatility solver.

MOVE contracts are priced as ATM straddles (call + put) — Delta-style.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Optional

_SQRT_2 = math.sqrt(2)
_SQRT_2PI = math.sqrt(2 * math.pi)


def _phi(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-0.5 * x * x) / _SQRT_2PI


def _Phi(x: float) -> float:
    """Standard normal CDF via erfc."""
    return 0.5 * math.erfc(-x / _SQRT_2)


def _d1d2(S: float, K: float, T: float, r: float, sigma: float) -> tuple[float, float]:
    sq = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / sq
    return d1, d1 - sq


def bs_price(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float:
    """Black-Scholes theoretical price for a European option (or MOVE = call+put straddle)."""
    ot = (option_type or "call").lower()
    if ot == "move":
        return bs_price(S, K, T, r, sigma, "call") + bs_price(S, K, T, r, sigma, "put")
    if T <= 1e-10 or sigma <= 1e-10 or S <= 0 or K <= 0:
        return max(0.0, S - K) if ot == "call" else max(0.0, K - S)
    d1, d2 = _d1d2(S, K, T, r, sigma)
    disc = math.exp(-r * T)
    if ot == "call":
        return S * _Phi(d1) - K * disc * _Phi(d2)
    return K * disc * _Phi(-d2) - S * _Phi(-d1)


def bs_delta(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float:
    ot = (option_type or "call").lower()
    if ot == "move":
        return bs_delta(S, K, T, r, sigma, "call") + bs_delta(S, K, T, r, sigma, "put")
    if T <= 1e-10 or sigma <= 1e-10 or S <= 0 or K <= 0:
        return 0.0
    d1, _ = _d1d2(S, K, T, r, sigma)
    return _Phi(d1) if ot == "call" else _Phi(d1) - 1.0


def bs_gamma(S: float, K: float, T: float, r: float, sigma: float) -> float:
    if T <= 1e-10 or sigma <= 1e-10 or S <= 0 or K <= 0:
        return 0.0
    d1, _ = _d1d2(S, K, T, r, sigma)
    return _phi(d1) / (S * sigma * math.sqrt(T))


def bs_theta_per_day(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float:
    """Theta in USDT per calendar day."""
    ot = (option_type or "call").lower()
    if ot == "move":
        return bs_theta_per_day(S, K, T, r, sigma, "call") + bs_theta_per_day(S, K, T, r, sigma, "put")
    if T <= 1e-10 or sigma <= 1e-10 or S <= 0 or K <= 0:
        return 0.0
    sq = math.sqrt(T)
    d1, d2 = _d1d2(S, K, T, r, sigma)
    decay = -(S * _phi(d1) * sigma) / (2 * sq)
    disc = math.exp(-r * T)
    if ot == "call":
        carry = -r * K * disc * _Phi(d2)
    else:
        carry = r * K * disc * _Phi(-d2)
    return (decay + carry) / 365.0


def bs_vega_per_vol_pct(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Vega: USDT change per +1 percentage-point of IV."""
    if T <= 1e-10 or sigma <= 1e-10 or S <= 0 or K <= 0:
        return 0.0
    d1, _ = _d1d2(S, K, T, r, sigma)
    return S * _phi(d1) * math.sqrt(T) / 100.0


def bs_rho(S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float:
    """Rho: USDT change per +1 percentage-point of risk-free rate."""
    ot = (option_type or "call").lower()
    if ot == "move":
        return bs_rho(S, K, T, r, sigma, "call") + bs_rho(S, K, T, r, sigma, "put")
    if T <= 1e-10 or sigma <= 1e-10 or S <= 0 or K <= 0:
        return 0.0
    _, d2 = _d1d2(S, K, T, r, sigma)
    disc = math.exp(-r * T)
    if ot == "call":
        return K * T * disc * _Phi(d2) / 100.0
    return -K * T * disc * _Phi(-d2) / 100.0


def implied_vol(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str,
    *,
    max_iter: int = 60,
    tol: float = 1e-6,
) -> Optional[float]:
    """Newton-Raphson IV solver with bisection fallback. Returns None on failure."""
    ot = (option_type or "call").lower()
    if T <= 1e-10 or S <= 0 or K <= 0 or market_price <= 0:
        return None
    if ot == "move":
        intrinsic = abs(S - K)
    else:
        intrinsic = max(0.0, S - K) if ot == "call" else max(0.0, K - S)
    if market_price < intrinsic - 1e-8:
        return None

    try:
        sigma = max(0.01, min(1.0, math.sqrt(2 * abs(math.log(S / K)) / max(T, 1e-10))))
    except (ValueError, ZeroDivisionError):
        sigma = 0.5

    for _ in range(max_iter):
        price = bs_price(S, K, T, r, sigma, ot)
        vega_unit = bs_vega_per_vol_pct(S, K, T, r, sigma) * 100.0 * (2.0 if ot == "move" else 1.0)
        diff = price - market_price
        if abs(diff) < tol:
            return max(0.001, min(sigma, 20.0))
        if abs(vega_unit) < 1e-12:
            break
        sigma -= diff / vega_unit
        sigma = max(0.001, min(sigma, 20.0))

    lo, hi = 0.001, 10.0
    for _ in range(120):
        mid = (lo + hi) * 0.5
        p = bs_price(S, K, T, r, mid, ot)
        if abs(p - market_price) < tol:
            return mid
        if p < market_price:
            lo = mid
        else:
            hi = mid
    result = (lo + hi) * 0.5
    return result if result > 0 else None


def compute_greeks(
    S: float,
    K: float,
    T: float,
    option_type: str,
    *,
    mid_price: Optional[float] = None,
    r: float = 0.0,
) -> Dict[str, Any]:
    """Return iv, delta, gamma, theta, vega for a contract. All None when inputs are degenerate."""
    ot = (option_type or "call").lower()
    result: Dict[str, Any] = {"iv": None, "delta": None, "gamma": None, "theta": None, "vega": None, "rho": None}
    if S <= 0 or K <= 0 or T <= 0:
        return result

    iv = None
    if mid_price is not None and mid_price > 0:
        try:
            iv = implied_vol(mid_price, S, K, T, r, ot)
        except Exception:
            iv = None

    if iv is not None and iv > 0:
        try:
            mul = 2.0 if ot == "move" else 1.0
            result["iv"] = round(iv, 6)
            result["delta"] = round(bs_delta(S, K, T, r, iv, ot), 6)
            result["gamma"] = round(bs_gamma(S, K, T, r, iv) * mul, 8)
            result["theta"] = round(bs_theta_per_day(S, K, T, r, iv, ot), 6)
            result["vega"] = round(bs_vega_per_vol_pct(S, K, T, r, iv) * mul, 6)
            result["rho"] = round(bs_rho(S, K, T, r, iv, ot), 6)
        except Exception:
            pass
    else:
        try:
            sigma_est = 0.5
            result["delta"] = round(bs_delta(S, K, T, r, sigma_est, ot), 6)
        except Exception:
            pass

    return result
