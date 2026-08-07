"""Pydantic models for options REST."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator, validator

from .constants import ORDER_TYPES


class TransferRequest(BaseModel):
    direction: Literal["spot_to_options", "options_to_spot"]
    asset: Literal["USDT"] = "USDT"
    amount: float = Field(gt=0)


class OrderCreateRequest(BaseModel):
    contract_id: str
    side: Literal["buy", "sell"]
    type: str = "limit"
    quantity: float = Field(gt=0)
    price: Optional[float] = Field(None, gt=0, description="Premium per contract in USDT (required for limit)")
    reduce_only: bool = False
    post_only: bool = False
    time_in_force: Literal["gtc", "ioc", "fok"] = "gtc"

    @model_validator(mode="after")
    def _validate_order(self) -> "OrderCreateRequest":
        otype = (self.type or "limit").lower()
        if otype == "limit" and (self.price is None or self.price <= 0):
            raise ValueError("limit orders require price > 0")
        if otype == "market" and self.post_only:
            raise ValueError("post_only is incompatible with market orders")
        # Vanilla options: sell must be reduce_only. MOVE (straddle) may open shorts.
        # Enforced in place_order once the contract type is known.
        return self

    @validator("type")
    def _v_type(cls, v: str) -> str:
        v = (v or "limit").lower()
        if v not in ORDER_TYPES:
            raise ValueError(f"type must be one of {ORDER_TYPES}")
        return v


class UnderlyingCreate(BaseModel):
    symbol: str = Field(..., min_length=5, description="e.g. BTCUSDT")
    display_name: Optional[str] = None
    listed: bool = True


class UnderlyingPatch(BaseModel):
    display_name: Optional[str] = None
    listed: Optional[bool] = None


class ContractCreate(BaseModel):
    underlying_symbol: str
    expiry: str = Field(..., description="ISO8601 UTC")
    strike: float = Field(gt=0)
    option_type: Literal["call", "put", "move"]
    tick_size: float = Field(0.01, gt=0)
    lot_size: float = Field(1.0, gt=0)
    min_qty: float = Field(1.0, gt=0)
    max_qty: float = Field(1_000_000.0, gt=0)
    listed: bool = True
    trading_enabled: bool = True


class ContractPatch(BaseModel):
    tick_size: Optional[float] = None
    lot_size: Optional[float] = None
    min_qty: Optional[float] = None
    max_qty: Optional[float] = None
    listed: Optional[bool] = None
    trading_enabled: Optional[bool] = None
    status: Optional[str] = None


class ControlsPatch(BaseModel):
    options_enabled: Optional[bool] = None
    options_trading_paused: Optional[bool] = None
    options_new_orders_paused: Optional[bool] = None
    options_transfers_paused: Optional[bool] = None
    options_taker_fee_rate: Optional[float] = Field(None, ge=0, le=0.1)
    # Negative = maker rebate (fraction of premium notional credited to maker).
    options_maker_fee_rate: Optional[float] = Field(None, ge=-0.05, le=0.1)
    options_clear_fee_overrides: Optional[bool] = Field(
        None,
        description="When true, remove stored options_taker_fee_rate / options_maker_fee_rate from Mongo",
    )


class SettleContractRequest(BaseModel):
    """Admin settlement: optional Binance index override (e.g. IBO or provider outage)."""

    settlement_index: Optional[float] = Field(None, gt=0, description="Override index price in USDT (underlying quote)")
    force: bool = Field(False, description="Allow settlement before on-chain expiry time")
