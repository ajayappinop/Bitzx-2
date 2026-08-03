"""Pydantic models for listing APIs."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TokenNetworkConfigIn(BaseModel):
    network: str
    contract_address: Optional[str] = None
    chain_id: Optional[str] = None
    decimals: int = Field(18, ge=0, le=30)
    deposit_enabled: bool = False
    withdraw_enabled: bool = False
    deposit_scan_enabled: bool = True
    rpc_chain_key: Optional[str] = None


class ListingSubmitOut(BaseModel):
    ok: bool = True
    request_id: str
    status: str = "pending"
    message: str = "Listing request submitted. Our team will review it shortly."


class AdminTokenCreateIn(BaseModel):
    project_name: str
    token_name: str
    token_symbol: str
    blockchain_network: str
    contract_address: str
    dex_swap_link: Optional[str] = None
    official_website: Optional[str] = None
    twitter_link: Optional[str] = None
    telegram_link: Optional[str] = None
    contact_email: Optional[str] = None
    description: Optional[str] = ""
    logo_url: Optional[str] = None
    quote_asset: str = "USDT"
    deposit_enabled: bool = False
    withdraw_enabled: bool = False
    trading_enabled: bool = False
    is_platform_default: bool = False
    networks: Optional[List[TokenNetworkConfigIn]] = None
    status: str = "approved"


class AdminTokenPatchIn(BaseModel):
    project_name: Optional[str] = None
    token_name: Optional[str] = None
    token_symbol: Optional[str] = None
    blockchain_network: Optional[str] = None
    contract_address: Optional[str] = None
    dex_swap_link: Optional[str] = None
    official_website: Optional[str] = None
    twitter_link: Optional[str] = None
    telegram_link: Optional[str] = None
    contact_email: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    quote_asset: Optional[str] = None
    deposit_enabled: Optional[bool] = None
    withdraw_enabled: Optional[bool] = None
    trading_enabled: Optional[bool] = None
    networks: Optional[List[TokenNetworkConfigIn]] = None
    status: Optional[str] = None
    admin_notes: Optional[str] = None
    market_visible: Optional[bool] = None
    featured_landing: Optional[bool] = None
    market_sort_order: Optional[int] = Field(None, ge=0, le=9999)
    market_tagline: Optional[str] = Field(None, max_length=160)
    market_category: Optional[str] = Field(None, max_length=32)


class MarketDisplayOverrideIn(BaseModel):
    """Per-symbol display override for built-in pairs (BTCUSDT, etc.)."""

    market_visible: Optional[bool] = None
    featured_landing: Optional[bool] = None
    market_sort_order: Optional[int] = Field(None, ge=0, le=9999)
    market_tagline: Optional[str] = Field(None, max_length=160)
    market_category: Optional[str] = Field(None, max_length=32)
    project_name: Optional[str] = None
    token_name: Optional[str] = None
    logo_url: Optional[str] = None
    description: Optional[str] = Field(None, max_length=500)


class MarketCatalogBulkPatchIn(BaseModel):
    """Batch-update market display for listed tokens and/or platform symbols."""

    tokens: Optional[List[Dict[str, Any]]] = None
    platform_symbols: Optional[Dict[str, MarketDisplayOverrideIn]] = None


class RequestReviewIn(BaseModel):
    status: str
    admin_notes: Optional[str] = None
    deposit_enabled: Optional[bool] = None
    withdraw_enabled: Optional[bool] = None
    trading_enabled: Optional[bool] = None
    networks: Optional[List[TokenNetworkConfigIn]] = None
