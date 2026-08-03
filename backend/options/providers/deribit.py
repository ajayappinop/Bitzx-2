"""Deribit public options reference data (plug-in external venue).

Used when ``OPTIONS_EXTERNAL_PROVIDER=deribit`` for reference IV, mark prices,
and contract metadata. Order routing always stays on the internal exchange.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .base import OptionsMarketProvider

logger = logging.getLogger(__name__)

_DERIBIT_API = os.getenv("DERIBIT_API_URL", "https://www.deribit.com/api/v2")
_TIMEOUT = float(os.getenv("OPTIONS_PROVIDER_TIMEOUT_SEC", "8"))
_MAX_RETRIES = int(os.getenv("OPTIONS_PROVIDER_MAX_RETRIES", "2"))


def _underlying_currency(symbol: str) -> str:
    sym = (symbol or "").strip().upper()
    if sym.endswith("USDT"):
        return sym[:-4]
    return sym.replace("USDT", "").replace("-", "") or sym


class DeribitOptionsProvider(OptionsMarketProvider):
    name = "deribit"

    async def _rpc(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{_DERIBIT_API.rstrip('/')}/{method}"
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
        last_exc: Optional[Exception] = None
        for attempt in range(_MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                    resp = await client.get(url, params=payload["params"])
                    if resp.status_code == 429:
                        continue
                    resp.raise_for_status()
                    body = resp.json()
                    if body.get("error"):
                        logger.debug("Deribit RPC error %s: %s", method, body["error"])
                        return None
                    return body.get("result")
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                logger.debug("Deribit RPC failed %s attempt=%s: %s", method, attempt, exc)
        if last_exc:
            logger.debug("Deribit exhausted retries for %s", method)
        return None

    async def get_index_price(self, underlying_symbol: str) -> Optional[float]:
        currency = _underlying_currency(underlying_symbol)
        result = await self._rpc("public/get_index_price", {"index_name": f"{currency.lower()}_usd"})
        if result is None:
            return None
        try:
            px = float(result.get("index_price", 0))
            return px if px > 0 else None
        except (TypeError, ValueError, AttributeError):
            return None

    async def list_external_contracts(
        self,
        underlying_symbol: str,
        *,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        currency = _underlying_currency(underlying_symbol)
        rows = await self._rpc(
            "public/get_instruments",
            {"currency": currency, "kind": "option", "expired": False},
        )
        if not isinstance(rows, list):
            return []
        out: List[Dict[str, Any]] = []
        for row in rows[: int(limit)]:
            if not isinstance(row, dict):
                continue
            opt_type = "call" if str(row.get("option_type", "")).lower() == "call" else "put"
            exp_ms = row.get("expiration_timestamp")
            expiry = (
                datetime.fromtimestamp(int(exp_ms) / 1000.0, tz=timezone.utc).isoformat()
                if exp_ms
                else None
            )
            out.append(
                {
                    "external_symbol": row.get("instrument_name"),
                    "underlying_symbol": f"{currency}USDT",
                    "underlying_asset": currency,
                    "expiry": expiry,
                    "strike": float(row.get("strike") or 0),
                    "option_type": opt_type,
                    "multiplier": float(row.get("contract_size") or 1),
                    "settlement_asset": "USDT",
                    "tick_size": float(row.get("tick_size") or 0.0001),
                    "lot_size": float(row.get("min_trade_amount") or 0.1),
                    "status": "listed" if row.get("is_active") else "halted",
                    "provider": self.name,
                }
            )
        return out

    async def get_external_ticker(self, external_symbol: str) -> Optional[Dict[str, Any]]:
        result = await self._rpc("public/ticker", {"instrument_name": external_symbol})
        if not isinstance(result, dict):
            return None
        stats = result.get("stats") or {}
        greeks = result.get("greeks") or {}
        return {
            "symbol": external_symbol,
            "last_price": _f(result.get("last_price")),
            "mark_price": _f(result.get("mark_price")),
            "index_price": _f(result.get("index_price")),
            "best_bid": _f(result.get("best_bid_price")),
            "best_ask": _f(result.get("best_ask_price")),
            "volume_24h": _f(stats.get("volume")),
            "change_24h_pct": _f(stats.get("price_change")),
            "open_interest": _f(result.get("open_interest")),
            "iv": _f(result.get("mark_iv")),
            "delta": _f(greeks.get("delta")),
            "gamma": _f(greeks.get("gamma")),
            "theta": _f(greeks.get("theta")),
            "vega": _f(greeks.get("vega")),
            "rho": _f(greeks.get("rho")),
            "provider": self.name,
        }

    async def get_external_orderbook(
        self,
        external_symbol: str,
        *,
        depth: int = 20,
    ) -> Optional[Dict[str, Any]]:
        result = await self._rpc(
            "public/get_order_book",
            {"instrument_name": external_symbol, "depth": int(depth)},
        )
        if not isinstance(result, dict):
            return None
        bids = [[float(p), float(q)] for p, q in (result.get("bids") or [])[:depth]]
        asks = [[float(p), float(q)] for p, q in (result.get("asks") or [])[:depth]]
        return {"bids": bids, "asks": asks, "provider": self.name}

    async def get_external_trades(
        self,
        external_symbol: str,
        *,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        result = await self._rpc(
            "public/get_last_trades_by_instrument",
            {"instrument_name": external_symbol, "count": int(limit)},
        )
        if not isinstance(result, dict):
            return []
        trades = result.get("trades") or []
        out: List[Dict[str, Any]] = []
        for t in trades:
            if not isinstance(t, dict):
                continue
            out.append(
                {
                    "price": _f(t.get("price")),
                    "qty": _f(t.get("amount")),
                    "side": t.get("direction"),
                    "trade_id": t.get("trade_id"),
                    "timestamp": t.get("timestamp"),
                    "provider": self.name,
                }
            )
        return out

    async def get_external_candles(
        self,
        external_symbol: str,
        *,
        interval: str = "1h",
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        resolution = _interval_to_deribit_resolution(interval)
        result = await self._rpc(
            "public/get_tradingview_chart_data",
            {
                "instrument_name": external_symbol,
                "resolution": resolution,
                "start_timestamp": 0,
                "end_timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
            },
        )
        if not isinstance(result, dict):
            return []
        ticks = result.get("ticks") or []
        opens = result.get("open") or []
        highs = result.get("high") or []
        lows = result.get("low") or []
        closes = result.get("close") or []
        vols = result.get("volume") or []
        out: List[Dict[str, Any]] = []
        n = min(len(ticks), len(closes))
        start = max(0, n - int(limit))
        for i in range(start, n):
            out.append(
                {
                    "time": int(ticks[i]),
                    "open": _f(opens[i]) if i < len(opens) else None,
                    "high": _f(highs[i]) if i < len(highs) else None,
                    "low": _f(lows[i]) if i < len(lows) else None,
                    "close": _f(closes[i]) if i < len(closes) else None,
                    "volume": _f(vols[i]) if i < len(vols) else None,
                }
            )
        return out


def _f(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _interval_to_deribit_resolution(interval: str) -> str:
    mapping = {
        "1m": "1",
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "1h": "60",
        "4h": "240",
        "1d": "1D",
    }
    return mapping.get((interval or "1h").lower(), "60")
