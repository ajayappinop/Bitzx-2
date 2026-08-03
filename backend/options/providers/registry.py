"""Provider registry and composite facade with graceful fallback."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from .base import OptionsMarketProvider
from .binance import BinanceOptionsProvider
from .deribit import DeribitOptionsProvider
from .local import LocalExchangeProvider

logger = logging.getLogger(__name__)

_index_provider: Optional[OptionsMarketProvider] = None
_external_provider: Optional[OptionsMarketProvider] = None
_local_provider: Optional[LocalExchangeProvider] = None


def _env(name: str, default: str) -> str:
    return (os.getenv(name) or default).strip().lower()


def _build_binance_provider() -> BinanceOptionsProvider:
    return BinanceOptionsProvider()


def _build_index_provider() -> OptionsMarketProvider:
    choice = _env("OPTIONS_INDEX_PROVIDER", "binance")
    if choice == "deribit":
        return DeribitOptionsProvider()
    if choice == "local":
        return LocalExchangeProvider()
    if choice in ("binance", "binance_options"):
        return _build_binance_provider()
    if choice == "kucoin":
        logger.warning(
            "OPTIONS_INDEX_PROVIDER=kucoin is deprecated — using binance_options instead"
        )
        return _build_binance_provider()
    logger.warning("unknown OPTIONS_INDEX_PROVIDER=%s — defaulting to binance", choice)
    return _build_binance_provider()


def _build_external_provider() -> Optional[OptionsMarketProvider]:
    choice = _env("OPTIONS_EXTERNAL_PROVIDER", "binance")
    if choice in ("none", "off", "local", ""):
        return None
    if choice == "deribit":
        return DeribitOptionsProvider()
    if choice in ("binance", "binance_options"):
        return _build_binance_provider()
    if choice == "kucoin":
        logger.warning(
            "OPTIONS_EXTERNAL_PROVIDER=kucoin is deprecated — using binance_options instead"
        )
        return _build_binance_provider()
    logger.warning("unknown OPTIONS_EXTERNAL_PROVIDER=%s — external disabled", choice)
    return None


def get_index_provider() -> OptionsMarketProvider:
    global _index_provider
    if _index_provider is None:
        _index_provider = _build_index_provider()
    return _index_provider


def get_external_provider() -> Optional[OptionsMarketProvider]:
    global _external_provider
    if _external_provider is None:
        _external_provider = _build_external_provider()
    return _external_provider


def get_local_provider() -> LocalExchangeProvider:
    global _local_provider
    if _local_provider is None:
        _local_provider = LocalExchangeProvider()
    return _local_provider


async def get_index_price(underlying_symbol: str) -> Optional[float]:
    """Index price: Binance options (default) → external → local Binance spot cache."""
    sym = (underlying_symbol or "").strip().upper()
    for provider in (get_index_provider(), get_external_provider(), get_local_provider()):
        if provider is None:
            continue
        try:
            px = await provider.get_index_price(sym)
            if px is not None and px > 0:
                return px
        except Exception as exc:  # noqa: BLE001
            logger.debug("index provider %s failed for %s: %s", provider.name, sym, exc)
    return None


async def list_reference_contracts(underlying_symbol: str, *, limit: int = 500) -> List[Dict[str, Any]]:
    ext = get_external_provider()
    if ext is None:
        return []
    try:
        return await ext.list_external_contracts(underlying_symbol, limit=limit)
    except Exception as exc:  # noqa: BLE001
        logger.debug("external contracts failed: %s", exc)
        return []
