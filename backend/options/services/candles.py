"""Historical candles for options contracts (Binance options + internal tape)."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from ..cache import redis_cache
from ..providers.binance import internal_to_binance_symbol
from ..providers.registry import get_external_provider, get_local_provider

logger = logging.getLogger(__name__)

_BINANCE_SPOT_KLINES = "https://api.binance.com/api/v3/klines"
_TIMEOUT = float(os.getenv("OPTIONS_PROVIDER_TIMEOUT_SEC", "8"))


async def get_history(
    *,
    contract_id: Optional[str] = None,
    underlying_symbol: Optional[str] = None,
    interval: str = "1h",
    limit: int = 200,
    use_cache: bool = True,
) -> Dict[str, Any]:
    sym = (underlying_symbol or "").strip().upper()
    if contract_id and not sym:
        local = get_local_provider()
        c = await local.get_contract(contract_id)
        if c:
            sym = str(c.get("underlying_symbol") or "")

    key = redis_cache.cache_key("hist", contract_id or sym, interval, str(limit))
    if use_cache:
        cached = await redis_cache.get(key)
        if cached is not None:
            return cached

    candles: List[Dict[str, Any]] = []
    source = "binance_spot"

    ext = get_external_provider()
    if contract_id and ext is not None:
        ext_sym = _map_to_external_symbol(contract_id, provider_name=getattr(ext, "name", ""))
        if ext_sym:
            try:
                ext_candles = await ext.get_external_candles(ext_sym, interval=interval, limit=limit)
                if ext_candles:
                    candles = ext_candles
                    source = ext.name
            except Exception as exc:  # noqa: BLE001
                logger.debug("external candles failed: %s", exc)

    if not candles and sym:
        candles = await _binance_spot_candles(sym, interval=interval, limit=limit)
        source = "binance_spot"

    payload = {
        "contract_id": contract_id,
        "underlying_symbol": sym or None,
        "interval": interval,
        "source": source,
        "candles": candles,
    }
    await redis_cache.set(key, payload, key_type="candles")
    return payload


def _map_to_external_symbol(contract_id: str, *, provider_name: str = "") -> Optional[str]:
    """Map internal contract id to an external venue symbol."""
    if provider_name in ("binance_options", "binance"):
        return internal_to_binance_symbol(contract_id)
    # Deribit-style fallback for legacy external provider.
    parts = (contract_id or "").split("_")
    if len(parts) < 5 or parts[0] != "optc":
        return internal_to_binance_symbol(contract_id)
    base, day, strike_s, cp = parts[1], parts[2], parts[3], parts[4]
    strike = strike_s.replace("p", ".")
    opt = "C" if cp.upper().startswith("C") else "P"
    try:
        from datetime import datetime, timezone

        dt = datetime.strptime(day, "%Y%m%d").replace(tzinfo=timezone.utc)
        exp_label = dt.strftime("%d%b%y").upper()
    except ValueError:
        return internal_to_binance_symbol(contract_id)
    return f"{base}-{exp_label}-{strike}-{opt}"


async def _binance_spot_candles(symbol: str, *, interval: str, limit: int) -> List[Dict[str, Any]]:
    import httpx

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                _BINANCE_SPOT_KLINES,
                params={"symbol": symbol.upper(), "interval": interval, "limit": min(limit, 1000)},
            )
            resp.raise_for_status()
            rows = resp.json()
            out: List[Dict[str, Any]] = []
            for row in rows:
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
    except Exception as exc:  # noqa: BLE001
        logger.debug("Binance spot klines fallback failed: %s", exc)
        return []
