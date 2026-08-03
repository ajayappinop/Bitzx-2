"""Constants for the IBO Trading Ecosystem.

All IBO-quoted pair definitions and platform_controls default keys live here
so they can be imported by server.py and the ibo admin module without circular
dependencies.
"""
from __future__ import annotations

from typing import Dict, List

# ── IBO-quoted trading pairs ──────────────────────────────────────────────────
# Symbol → base asset.  Quote is always IBO.
# e.g. BTCIBO means "buy BTC with IBO" or "sell BTC for IBO".
IBO_QUOTED_SYMBOL_MAP: Dict[str, str] = {
    "BTCIBO":  "BTC",
    "ETHIBO":  "ETH",
    "BNBIBO":  "BNB",
    "SOLIBO":  "SOL",
    "XRPIBO":  "XRP",
    "DOGEIBO": "DOGE",
}

IBO_QUOTED_PAIRS: List[str] = list(IBO_QUOTED_SYMBOL_MAP.keys())

# All IBO pairs treat IBO as the quote asset
IBO_QUOTED_QUOTE_ASSET = "IBO"

# ── Fallback USDT prices for each base (used to derive IBO price when
#    Binance is unreachable; mirrored from server.py FALLBACK_PRICES) ──────────
IBO_PAIR_FALLBACK_USDT: Dict[str, float] = {
    "BTC":  84500.0,
    "ETH":  3200.0,
    "BNB":  580.0,
    "SOL":  145.0,
    "XRP":  0.52,
    "DOGE": 0.12,
}

# ── platform_controls defaults for the IBO market module ─────────────────────
IBO_CONTROL_DEFAULTS: Dict[str, object] = {
    # float or None — when set, overrides the runtime IBO_BASE_PRICE constant
    "ibo_price_override":        None,
    # When True, IBO mark rises with net credited IBO (on-chain + INR) minus withdrawals.
    "ibo_price_deposit_driven":    True,
    # Launch floor before any investment (also used to value deposits for the curve).
    "ibo_price_floor_usdt":      0.4523,
    # +100% mark multiplier per this much net IBO invested (USD at floor). 250k → 2× at $250k.
    "ibo_deposit_price_scale_usd": 250_000.0,
    # Optional cap on deposit-driven mark (None/0 = no cap).
    "ibo_deposit_price_ceiling_usdt": None,
    # Basis points added to each synthetic fill (1 bp = 0.01 %)
    "ibo_spread_bps_default":    25.0,
    # Per-symbol overrides, e.g. {"BTCIBO": 30.0}
    "ibo_spread_bps_by_symbol":  {},
    # Master switch for IBO-market treasury/SYSTEM fills
    "ibo_liquidity_enabled":     True,
    # How many levels deep to generate in synthetic order books
    "ibo_market_depth_levels":   20,
    # Per-pair enable/disable toggle
    "ibo_pairs_enabled":         {s: True for s in IBO_QUOTED_PAIRS},
    # Minimum order size in base units per pair (0 = use global default)
    "ibo_min_order_size":        {},
}
