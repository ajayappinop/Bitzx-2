"""Internal exchange market data (Mongo-backed order book, trades, contracts)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..services import contracts as contracts_svc
from ..services import index_price as idx_svc
from ..services import orderbook as orderbook_svc
from ..services import positions as pos_svc
from ..services import trades_public as trades_pub_svc
from .base import OptionsMarketProvider


class LocalExchangeProvider(OptionsMarketProvider):
    name = "local"

    async def get_index_price(self, underlying_symbol: str) -> Optional[float]:
        return await idx_svc.get_index_price(underlying_symbol)

    async def list_contracts(
        self,
        *,
        underlying_symbol: Optional[str] = None,
        listed_only: bool = True,
        option_type: Optional[str] = None,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        return await contracts_svc.list_contracts(
            underlying_symbol=underlying_symbol,
            listed_only=listed_only,
            option_type=option_type,
            limit=limit,
        )

    async def get_contract(self, contract_id: str) -> Optional[Dict[str, Any]]:
        return await contracts_svc.get(contract_id)

    async def get_orderbook(self, contract_id: str, *, depth: int = 25) -> Dict[str, Any]:
        return await orderbook_svc.depth_snapshot(contract_id, levels=depth)

    async def get_trades(self, contract_id: str, *, limit: int = 50) -> List[Dict[str, Any]]:
        return await trades_pub_svc.list_recent_contract_trades(contract_id, limit=limit)

    async def get_open_interest(self, contract_ids: List[str]) -> Dict[str, float]:
        return await pos_svc.open_interest_by_contract(contract_ids)

    async def get_last_trades_map(self, contract_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        return await trades_pub_svc.last_trade_by_contract_ids(contract_ids)

    async def get_best_quotes(self, contract_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        return await orderbook_svc.chain_best_quotes(contract_ids)
