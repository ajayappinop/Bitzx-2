"""Abstract market-data provider interface for options.

External providers (Binance options, Deribit reference) and the
internal exchange (Mongo order book / trades) all implement this contract so
the REST layer and WebSocket fan-out never depend on a specific vendor.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class OptionsMarketProvider(ABC):
    """Vendor-neutral read-only market data."""

    name: str = "base"

    @abstractmethod
    async def get_index_price(self, underlying_symbol: str) -> Optional[float]:
        """Spot index for an underlying (e.g. BTCUSDT)."""

    async def list_external_contracts(
        self,
        underlying_symbol: str,
        *,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        """Optional reference contracts from an external venue."""
        return []

    async def get_external_ticker(self, external_symbol: str) -> Optional[Dict[str, Any]]:
        return None

    async def get_external_orderbook(
        self,
        external_symbol: str,
        *,
        depth: int = 20,
    ) -> Optional[Dict[str, Any]]:
        return None

    async def get_external_trades(
        self,
        external_symbol: str,
        *,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        return []

    async def get_external_candles(
        self,
        external_symbol: str,
        *,
        interval: str = "1h",
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        return []
