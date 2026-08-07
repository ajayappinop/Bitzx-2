"""Constants for the options module (European-style USDT premium trading, v1)."""

from __future__ import annotations

from typing import Final, Literal

COL_UNDERLYINGS = "options_underlyings"
COL_CONTRACTS = "options_contracts"
COL_ORDERS = "options_orders"
COL_TRADES = "options_trades"
COL_POSITIONS = "options_positions"
COL_WALLETS = "options_wallets"
COL_WALLET_TXNS = "options_wallet_txns"
COL_SYMBOL_CONFIG = "options_symbol_config"
COL_SETTLEMENT_EVENTS = "options_settlement_events"

MARGIN_ASSET: Final = "USDT"
SYSTEM_LIQUIDITY_UID: Final = "__OPTIONS_SYSTEM__"

OPTION_TYPES = ("call", "put", "move")
ORDER_SIDES = ("buy", "sell")
ORDER_TYPES = ("limit", "market")
TIME_IN_FORCE = ("gtc", "ioc", "fok")
ORDER_STATUSES = ("open", "partially_filled", "filled", "cancelled", "rejected")

CONTRACT_STATUSES = ("draft", "listed", "halted", "expired", "settling", "settled")

# Fraction of premium notional (price × qty) charged per fill — aligned with futures defaults.
TAKER_FEE_RATE = 0.0005  # 5 bps
MAKER_FEE_RATE = 0.0002  # 2 bps

# MOVE (straddle) short initial margin ≈ IM% × index + mark (per contract), Delta-style.
MOVE_SHORT_IM_PCT = 0.10

MIN_PREMIUM_LOCK_USDT = 1.0

OptionType = Literal["call", "put", "move"]
OrderSide = Literal["buy", "sell"]
