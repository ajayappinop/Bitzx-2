"""Pydantic models used by the futures REST API.

Domain objects (positions, orders, wallet rows) are stored as plain dicts
in Mongo; these models exist only to validate request bodies and shape
JSON responses.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, validator

from .constants import (
    ALLOWED_LEVERAGE,
    DEFAULT_MARGIN_MODE,
    MARGIN_MODES,
    ORDER_TYPES,
    TIF_VALUES,
)
from .symbols import get_supported_symbols


def _norm_symbol(sym: str) -> str:
    s = (sym or "").upper()
    if s not in get_supported_symbols():
        raise ValueError(f"unsupported symbol {sym!r}")
    return s


# ── Wallet / transfer ─────────────────────────────────────────────────────

class TransferRequest(BaseModel):
    """Body for ``POST /api/futures/wallet/transfer``."""

    direction: Literal["spot_to_futures", "futures_to_spot"]
    asset: Literal["USDT"] = "USDT"
    amount: float = Field(gt=0)


# ── Risk settings ─────────────────────────────────────────────────────────

class LeverageUpdateRequest(BaseModel):
    symbol: str
    leverage: int

    @validator("symbol")
    def _v_sym(cls, v: str) -> str:
        return _norm_symbol(v)

    @validator("leverage")
    def _v_lev(cls, v: int) -> int:
        if v in ALLOWED_LEVERAGE:
            return v
        cap = max(1, min(int(v), ALLOWED_LEVERAGE[-1]))
        return min(ALLOWED_LEVERAGE, key=lambda x: abs(x - cap))


class MarginModeUpdateRequest(BaseModel):
    symbol: str
    mode: str = DEFAULT_MARGIN_MODE

    @validator("symbol")
    def _v_sym(cls, v: str) -> str:
        return _norm_symbol(v)

    @validator("mode")
    def _v_mode(cls, v: str) -> str:
        if v not in MARGIN_MODES:
            raise ValueError(f"mode must be one of {MARGIN_MODES}")
        return v


# ── Orders ────────────────────────────────────────────────────────────────

class OrderCreateRequest(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    type: str = "limit"
    quantity: float = Field(gt=0)
    price: Optional[float] = None
    stop_price: Optional[float] = None
    take_profit_price: Optional[float] = None
    stop_loss_price: Optional[float] = None
    leverage: Optional[int] = None
    tif: str = "GTC"
    reduce_only: bool = False
    client_order_id: Optional[str] = None

    @validator("symbol")
    def _v_sym(cls, v: str) -> str:
        return _norm_symbol(v)

    @validator("type")
    def _v_type(cls, v: str) -> str:
        v = (v or "").lower()
        if v not in ORDER_TYPES:
            raise ValueError(f"type must be one of {ORDER_TYPES}")
        return v

    @validator("tif")
    def _v_tif(cls, v: str) -> str:
        v = (v or "GTC").upper()
        if v not in TIF_VALUES:
            raise ValueError(f"tif must be one of {TIF_VALUES}")
        return v


class OrderCancelRequest(BaseModel):
    order_id: str


# ── Positions ─────────────────────────────────────────────────────────────

class ClosePositionRequest(BaseModel):
    symbol: str
    quantity: Optional[float] = None  # None => full close
    price: Optional[float] = None     # None => market

    @validator("symbol")
    def _v_sym(cls, v: str) -> str:
        return _norm_symbol(v)


# ── Read DTOs (free-form dicts on the wire; documented for clarity) ──────

class WalletSnapshot(BaseModel):
    asset: str
    available: float
    locked: float
    wallet_balance: float
    unrealized_pnl: float
    margin_balance: float
    used_margin: float
    free_margin: float


class SymbolMeta(BaseModel):
    symbol: str
    base: str
    quote: str
    tick_size: float
    lot_size: float
    min_qty: float
    max_qty: float
    max_leverage: int
    min_notional: float


class SymbolListResponse(BaseModel):
    symbols: List[SymbolMeta]
