"""Constants and tunables for the futures module.

All collection names, supported symbols, leverage tiers, fee schedule,
and engine timings live here so they can be swapped or moved into
``platform_controls`` later without rewriting the engine.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

# ── MongoDB collections (futures-only, never reused across spot) ────────────
COL_WALLETS       = "futures_wallets"
COL_WALLET_TXNS   = "futures_wallet_txns"
COL_POSITIONS     = "futures_positions"
COL_ORDERS        = "futures_orders"
COL_TRADES        = "futures_trades"
COL_LIQUIDATIONS  = "futures_liquidations"
COL_FUNDING_RATES = "futures_funding_rates"
COL_FUNDING_PAYS  = "futures_funding_payments"
COL_MARK_PRICES   = "futures_mark_prices"

# ── Margin currency ────────────────────────────────────────────────────────
# Linear USDT-margined perps. All PnL, margin, fees are in USDT.
MARGIN_ASSET = "USDT"

# ── Listed perpetual contracts ─────────────────────────────────────────────
# Each entry maps ``symbol`` (canonical perp symbol) to the underlying
# Binance spot symbol used to source the mark/index price.
# Listed perps: each ``binance_symbol`` must exist on Binance spot (mark/index feed).
# Kept in sync with ``ibo-exchange`` spot ``PAIRS`` (excluding IBO, which has no Binance index).
SUPPORTED_SYMBOLS: Dict[str, Dict[str, object]] = {
    "BTCUSDT-PERP": {
        "base": "BTC",
        "quote": "USDT",
        "binance_symbol": "BTCUSDT",
        "tick_size": 0.10,
        "lot_size":  0.001,
        "min_qty":   0.001,
        "max_qty":   1000.0,
    },
    "ETHUSDT-PERP": {
        "base": "ETH",
        "quote": "USDT",
        "binance_symbol": "ETHUSDT",
        "tick_size": 0.01,
        "lot_size":  0.01,
        "min_qty":   0.01,
        "max_qty":   10000.0,
    },
    "BNBUSDT-PERP": {
        "base": "BNB",
        "quote": "USDT",
        "binance_symbol": "BNBUSDT",
        "tick_size": 0.01,
        "lot_size":  0.01,
        "min_qty":   0.01,
        "max_qty":   50000.0,
    },
    "SOLUSDT-PERP": {
        "base": "SOL",
        "quote": "USDT",
        "binance_symbol": "SOLUSDT",
        "tick_size": 0.001,
        "lot_size":  0.1,
        "min_qty":   0.1,
        "max_qty":   100000.0,
    },
    "XRPUSDT-PERP": {
        "base": "XRP",
        "quote": "USDT",
        "binance_symbol": "XRPUSDT",
        "tick_size": 0.0001,
        "lot_size":  1.0,
        "min_qty":   1.0,
        "max_qty":   10_000_000.0,
    },
    "DOGEUSDT-PERP": {
        "base": "DOGE",
        "quote": "USDT",
        "binance_symbol": "DOGEUSDT",
        "tick_size": 0.00001,
        "lot_size":  10.0,
        "min_qty":   10.0,
        "max_qty":   100_000_000.0,
    },
    "ADAUSDT-PERP": {
        "base": "ADA",
        "quote": "USDT",
        "binance_symbol": "ADAUSDT",
        "tick_size": 0.0001,
        "lot_size":  1.0,
        "min_qty":   1.0,
        "max_qty":   50_000_000.0,
    },
    "POLUSDT-PERP": {
        "base": "POL",
        "quote": "USDT",
        "binance_symbol": "POLUSDT",
        "tick_size": 0.0001,
        "lot_size":  1.0,
        "min_qty":   1.0,
        "max_qty":   50_000_000.0,
    },
    "AVAXUSDT-PERP": {
        "base": "AVAX",
        "quote": "USDT",
        "binance_symbol": "AVAXUSDT",
        "tick_size": 0.001,
        "lot_size":  0.1,
        "min_qty":   0.1,
        "max_qty":   1_000_000.0,
    },
    "DOTUSDT-PERP": {
        "base": "DOT",
        "quote": "USDT",
        "binance_symbol": "DOTUSDT",
        "tick_size": 0.001,
        "lot_size":  0.1,
        "min_qty":   0.1,
        "max_qty":   1_000_000.0,
    },
    "LINKUSDT-PERP": {
        "base": "LINK",
        "quote": "USDT",
        "binance_symbol": "LINKUSDT",
        "tick_size": 0.001,
        "lot_size":  0.1,
        "min_qty":   0.1,
        "max_qty":   1_000_000.0,
    },
    "LTCUSDT-PERP": {
        "base": "LTC",
        "quote": "USDT",
        "binance_symbol": "LTCUSDT",
        "tick_size": 0.01,
        "lot_size":  0.01,
        "min_qty":   0.01,
        "max_qty":   200_000.0,
    },
}

# ── Leverage / margin tiers (Binance-style risk ladder) ────────────────────
# (max_notional_usd, max_leverage, initial_margin_rate, maintenance_margin_rate)
LeverageTier = Tuple[float, int, float, float]

LEVERAGE_TIERS: Dict[str, List[LeverageTier]] = {
    "BTCUSDT-PERP": [
        (   50_000,  125, 0.004, 0.005),
        (  250_000,  100, 0.005, 0.0065),
        (1_000_000,   50, 0.01,  0.013),
        (5_000_000,   20, 0.025, 0.030),
    ],
    "ETHUSDT-PERP": [
        (   50_000,  100, 0.005, 0.0065),
        (  250_000,   50, 0.01,  0.013),
        (1_000_000,   20, 0.025, 0.030),
    ],
    "BNBUSDT-PERP": [
        (   50_000,  100, 0.005, 0.0065),
        (  250_000,   50, 0.01,  0.013),
        (1_000_000,   20, 0.025, 0.030),
    ],
    "SOLUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "XRPUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "DOGEUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "ADAUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "POLUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "AVAXUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "DOTUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "LINKUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
    "LTCUSDT-PERP": [
        (   50_000,   50, 0.01,  0.013),
        (  250_000,   20, 0.025, 0.030),
    ],
}

# Supported leverage steps the UI exposes.
ALLOWED_LEVERAGE = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125]

# ── Margin modes ───────────────────────────────────────────────────────────
ISOLATED = "isolated"
CROSS    = "cross"
MARGIN_MODES = (ISOLATED, CROSS)
DEFAULT_MARGIN_MODE = ISOLATED  # safer default for retail

# ── Fee schedule ──────────────────────────────────────────────────────────
MAKER_FEE_RATE = 0.0002   # 2 bps
TAKER_FEE_RATE = 0.0005   # 5 bps
LIQUIDATION_FEE_RATE = 0.005   # 50 bps haircut applied during liquidation

# ── Funding ───────────────────────────────────────────────────────────────
FUNDING_INTERVAL_SEC = 8 * 3600        # every 8 hours
FUNDING_CAP = 0.0075                   # ±0.75% per period — cap on rate
FUNDING_PREMIUM_INTERVAL_SEC = 60      # how often we sample the premium

# ── Engine cadences ───────────────────────────────────────────────────────
MARK_PRICE_INTERVAL_SEC = 1.5          # how often the mark feed updates
LIQUIDATION_SCAN_INTERVAL_SEC = 1.0    # how often we scan positions
ORDER_BOOK_DEPTH = 25                  # rows shown in REST orderbook snapshot

# ── Positions / orders ────────────────────────────────────────────────────
ORDER_TYPES = ("limit", "market", "stop_limit", "stop_market", "take_profit")
ORDER_STATUSES = (
    "open", "partially_filled", "filled", "cancelled", "rejected", "triggered"
)
TIF_VALUES = ("GTC", "IOC", "FOK")

# Anti-bankruptcy: a position is force-closed when equity drops to this
# fraction of its notional below maintenance margin (small extra haircut).
INSURANCE_HAIRCUT = 0.001  # 10 bps

# Orders smaller than this in USD notional are rejected — guards against
# dust spam that would otherwise pollute the book.
MIN_ORDER_NOTIONAL_USDT = 5.0
