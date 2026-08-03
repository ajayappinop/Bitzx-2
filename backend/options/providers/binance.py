"""Binance European Options (eapi) market-data provider.

Public REST docs: https://developers.binance.com/docs/derivatives/options-trading/market-data
Order routing and settlement remain on the internal Ibo exchange.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .base import OptionsMarketProvider

logger = logging.getLogger(__name__)

_BINANCE_EAPI = os.getenv("BINANCE_OPTIONS_API_URL", "https://eapi.binance.com")
_TIMEOUT = float(os.getenv("OPTIONS_PROVIDER_TIMEOUT_SEC", "8"))
_MAX_RETRIES = int(os.getenv("OPTIONS_PROVIDER_MAX_RETRIES", "2"))
_http_client: Optional[httpx.AsyncClient] = None


def _http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=_TIMEOUT)
    return _http_client


def _underlying_asset(symbol: str) -> str:
    sym = (symbol or "").strip().upper()
    if sym.endswith("USDT"):
        return sym[:-4]
    return sym.replace("USDT", "").replace("-", "") or sym


def internal_to_binance_symbol(contract_id: str) -> Optional[str]:
    """Map internal id ``optc_BTC_20260627_95000_C`` → ``BTC-260627-95000-C``."""
    parts = (contract_id or "").split("_")
    if len(parts) < 5 or parts[0] != "optc":
        return None
    base, day, strike_s, cp = parts[1], parts[2], parts[3], parts[4]
    strike = strike_s.replace("p", ".")
    opt = "C" if cp.upper().startswith("C") else "P"
    if len(day) == 8:
        day = day[2:]
    return f"{base}-{day}-{strike}-{opt}"


def binance_symbol_to_internal(symbol: str, *, underlying_symbol: str) -> Optional[str]:
    """Best-effort reverse map for reference contract ingestion."""
    raw = (symbol or "").strip().upper()
    chunks = raw.split("-")
    if len(chunks) < 4:
        return None
    base, exp_yy, strike, side = chunks[0], chunks[1], chunks[2], chunks[3]
    if len(exp_yy) == 6:
        exp_day = f"20{exp_yy}"
    else:
        return None
    strike_token = strike.replace(".", "p")
    opt = "C" if side.startswith("C") else "P"
    usym = underlying_symbol.strip().upper() or f"{base}USDT"
    return f"optc_{base}_{exp_day}_{strike_token}_{opt}"


class BinanceOptionsProvider(OptionsMarketProvider):
    name = "binance_options"

    async def _get_json(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{_BINANCE_EAPI.rstrip('/')}{path}"
        last_exc: Optional[Exception] = None
        for attempt in range(_MAX_RETRIES + 1):
            try:
                resp = await _http_client().get(url, params=params or {})
                if resp.status_code == 429:
                    logger.warning("Binance options rate limit on %s", path)
                    continue
                if resp.status_code >= 500:
                    continue
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                logger.debug(
                    "Binance options request failed (%s) attempt=%s: %s",
                    path,
                    attempt,
                    exc,
                )
        if last_exc:
            logger.debug("Binance options exhausted retries for %s: %s", path, last_exc)
        return None

    async def get_index_price(self, underlying_symbol: str) -> Optional[float]:
        sym = (underlying_symbol or "").strip().upper()
        asset = _underlying_asset(sym)

        try:
            from ..stream import binance_options_ws

            cached = binance_options_ws.get_index_price(sym)
            if cached is not None and cached > 0:
                return cached
        except Exception:  # noqa: BLE001
            pass

        for param in (sym, f"{asset}USDT", asset):
            body = await self._get_json("/eapi/v1/index", {"underlying": param})
            px = _index_from_body(body)
            if px is not None:
                return px

        try:
            from ..services import index_price as spot_idx

            return await spot_idx.get_index_price(sym)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Binance options index fallback failed for %s: %s", sym, exc)
            return None

    async def list_external_contracts(
        self,
        underlying_symbol: str,
        *,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        usym = (underlying_symbol or "").strip().upper()
        asset = _underlying_asset(usym)
        body = await self._get_json("/eapi/v1/exchangeInfo")
        if not isinstance(body, dict):
            return []
        rows = body.get("optionSymbols") or body.get("optionContracts") or []
        out: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_under = str(row.get("underlying") or row.get("underlyingAsset") or "").upper()
            if row_under and row_under not in (usym, asset, f"{asset}USDT"):
                continue
            symbol = str(row.get("symbol") or "")
            if not symbol:
                continue
            side = str(row.get("side") or row.get("optionSide") or "").upper()
            opt_type = "call" if side.startswith("C") else "put"
            exp_ms = row.get("expiryDate") or row.get("expiration")
            expiry = None
            if exp_ms:
                try:
                    expiry = datetime.fromtimestamp(int(exp_ms) / 1000.0, tz=timezone.utc).isoformat()
                except (TypeError, ValueError):
                    expiry = None
            strike_raw = row.get("strikePrice") or row.get("strike")
            out.append(
                {
                    "external_symbol": symbol,
                    "underlying_symbol": usym or f"{asset}USDT",
                    "underlying_asset": asset,
                    "expiry": expiry,
                    "strike": float(strike_raw or 0),
                    "option_type": opt_type,
                    "multiplier": float(row.get("unit") or row.get("contractSize") or 1),
                    "settlement_asset": str(row.get("quoteAsset") or "USDT"),
                    "tick_size": float(row.get("tickSize") or 0.0001),
                    "lot_size": float(row.get("minQty") or row.get("minTradeAmount") or 0.01),
                    "status": "listed" if row.get("status", "TRADING") in ("TRADING", "listed", 1, True) else "halted",
                    "provider": self.name,
                }
            )
            if len(out) >= int(limit):
                break
        return out

    async def get_external_ticker(self, external_symbol: str) -> Optional[Dict[str, Any]]:
        sym = (external_symbol or "").strip().upper()
        try:
            from ..stream import binance_options_ws

            cached = binance_options_ws.get_mark(sym)
            if cached:
                return {**cached, "provider": self.name}
        except Exception:  # noqa: BLE001
            pass

        mark_rows = await self._get_json("/eapi/v1/mark", {"symbol": sym})
        mark = _first_dict(mark_rows)
        ticker_rows = await self._get_json("/eapi/v1/ticker", {"symbol": sym})
        tick = _first_dict(ticker_rows)
        if not mark and not tick:
            return None
        return {
            "symbol": sym,
            "last_price": _f((tick or {}).get("lastPrice")),
            "mark_price": _f((mark or {}).get("markPrice")),
            "index_price": _f((mark or {}).get("indexPrice")),
            "best_bid": _f((tick or {}).get("bidPrice")),
            "best_ask": _f((tick or {}).get("askPrice")),
            "bid_qty": _f((tick or {}).get("bidQty")),
            "ask_qty": _f((tick or {}).get("askQty")),
            "volume_24h": _f((tick or {}).get("volume")),
            "change_24h_pct": _f((tick or {}).get("priceChangePercent")),
            "open_interest": _f((mark or {}).get("openInterest") or (tick or {}).get("openInterest")),
            "iv": _f((mark or {}).get("markIV")),
            "delta": _f((mark or {}).get("delta")),
            "gamma": _f((mark or {}).get("gamma")),
            "theta": _f((mark or {}).get("theta")),
            "vega": _f((mark or {}).get("vega")),
            "rho": _f((mark or {}).get("rho")),
            "provider": self.name,
        }

    async def get_external_orderbook(
        self,
        external_symbol: str,
        *,
        depth: int = 20,
    ) -> Optional[Dict[str, Any]]:
        body = await self._get_json(
            "/eapi/v1/depth",
            {"symbol": external_symbol.strip().upper(), "limit": int(depth)},
        )
        if not isinstance(body, dict):
            return None
        bids = [[float(p), float(q)] for p, q in (body.get("bids") or [])[:depth]]
        asks = [[float(p), float(q)] for p, q in (body.get("asks") or [])[:depth]]
        return {"bids": bids, "asks": asks, "provider": self.name}

    async def get_external_trades(
        self,
        external_symbol: str,
        *,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        rows = await self._get_json(
            "/eapi/v1/trades",
            {"symbol": external_symbol.strip().upper(), "limit": min(int(limit), 500)},
        )
        if not isinstance(rows, list):
            return []
        out: List[Dict[str, Any]] = []
        for t in rows:
            if not isinstance(t, dict):
                continue
            out.append(
                {
                    "price": _f(t.get("price")),
                    "qty": _f(t.get("qty") or t.get("quantity")),
                    "side": t.get("side"),
                    "trade_id": t.get("id") or t.get("tradeId"),
                    "timestamp": t.get("time") or t.get("tradeTime"),
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
        rows = await self._get_json(
            "/eapi/v1/klines",
            {
                "symbol": external_symbol.strip().upper(),
                "interval": _interval_to_binance(interval),
                "limit": min(int(limit), 1500),
            },
        )
        if not isinstance(rows, list):
            return []
        out: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, (list, tuple)) or len(row) < 6:
                continue
            out.append(
                {
                    "time": int(row[0]),
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": float(row[5]),
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


def _first_dict(rows: Any) -> Optional[Dict[str, Any]]:
    if isinstance(rows, dict):
        return rows
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return rows[0]
    return None


def _index_from_body(body: Any) -> Optional[float]:
    if isinstance(body, dict):
        for key in ("indexPrice", "price", "index"):
            px = _f(body.get(key))
            if px is not None and px > 0:
                return px
    if isinstance(body, list) and body:
        row = body[0]
        if isinstance(row, dict):
            return _index_from_body(row)
    return None


def _interval_to_binance(interval: str) -> str:
    mapping = {
        "1m": "1m",
        "3m": "3m",
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "1h",
        "2h": "2h",
        "4h": "4h",
        "6h": "6h",
        "12h": "12h",
        "1d": "1d",
        "3d": "3d",
        "1w": "1w",
    }
    return mapping.get((interval or "1h").lower(), "1h")
