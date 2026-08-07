"""MongoDB document shapes for the options module (reference schemas, not ODM)."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional, TypedDict


class OptionContractDoc(TypedDict, total=False):
    id: str
    underlying_id: str
    underlying_symbol: str
    underlying_asset: str
    expiry: str
    strike: float
    option_type: Literal["call", "put", "move"]
    symbol: str
    multiplier: float
    settlement_asset: str
    status: str
    tick_size: float
    lot_size: float
    min_qty: float
    max_qty: float
    listed: bool
    trading_enabled: bool
    created_at: str
    updated_at: str


class OptionTickerDoc(TypedDict, total=False):
    contract_id: str
    last_price: Optional[float]
    mark_price: Optional[float]
    index_price: Optional[float]
    volume_24h: Optional[float]
    change_24h_pct: Optional[float]
    open_interest: Optional[float]
    iv: Optional[float]
    best_bid: Optional[float]
    best_ask: Optional[float]
    updated_at: str


class OptionOrderBookDoc(TypedDict, total=False):
    contract_id: str
    bids: list
    asks: list
    updated_at: str


class OptionTradeDoc(TypedDict, total=False):
    id: str
    contract_id: str
    price: float
    qty: float
    side: str
    taker_uid: str
    maker_uid: str
    created_at: str


class OptionPositionDoc(TypedDict, total=False):
    id: str
    uid: str
    contract_id: str
    qty: float
    avg_premium: float
    status: str
    opened_at: str
    updated_at: str
    closed_at: str


class OptionOrderDoc(TypedDict, total=False):
    id: str
    uid: str
    contract_id: str
    side: Literal["buy", "sell"]
    type: str
    price: float
    quantity: float
    filled: float
    remaining: float
    reduce_only: bool
    post_only: bool
    time_in_force: str
    status: str
    created_at: str
    updated_at: str


class OptionPortfolioDoc(TypedDict, total=False):
    uid: str
    total_pnl: float
    realized_pnl: float
    unrealized_pnl: float
    margin_used: float
    margin_available: float
    portfolio_value: float
    open_interest: float
    today_pnl: float
    updated_at: str


def enrich_contract_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Attach canonical symbol / asset fields expected by frontends."""
    out = dict(row)
    usym = str(out.get("underlying_symbol") or "")
    base = usym.replace("USDT", "") if usym.endswith("USDT") else usym
    out.setdefault("underlying_asset", base)
    out.setdefault("multiplier", float(out.get("multiplier") or 1.0))
    out.setdefault("settlement_asset", out.get("settlement_asset") or "USDT")
    out.setdefault("symbol", out.get("id") or out.get("symbol"))
    return out
