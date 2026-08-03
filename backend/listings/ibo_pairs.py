"""Dynamic IBO-quoted trading pairs — Web3 / BSC catalog + core majors."""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from ibo.constants import IBO_QUOTED_SYMBOL_MAP

logger = logging.getLogger(__name__)

IBO_SUFFIX = "IBO"
# Quote / platform token only — stables like USDD are tradable vs IBO.
IBO_TRADING_EXCLUDED = frozenset({"IBO", "USDT"})

_CACHE: Dict[str, Any] = {"map": {}, "price_usd": {}, "logo_urls": {}, "fetched_at": 0.0}
_CACHE_TTL_SEC = 3600

# Core majors — same URLs as exchange COIN_ICONS (catalog may omit some).
_CORE_LOGO_URLS: Dict[str, str] = {
    "IBO": (os.getenv("IBO_LOGO_URL") or "").strip(),
    "BTC": "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
    "ETH": "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    "BNB": "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
    "SOL": "https://assets.coingecko.com/coins/images/4128/small/solana.png",
    "XRP": "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png",
    "DOGE": "https://assets.coingecko.com/coins/images/5/small/dogecoin.png",
    "ADA": "https://assets.coingecko.com/coins/images/975/small/cardano.png",
    "POL": "https://assets.coingecko.com/coins/images/32440/small/polygon.png",
    "AVAX": "https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png",
    "DOT": "https://assets.coingecko.com/coins/images/12171/small/polkadot.png",
    "LINK": "https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png",
    "LTC": "https://assets.coingecko.com/coins/images/2/small/litecoin.png",
}


def _web3_ibo_trading_enabled() -> bool:
    return (os.getenv("BSC_WEB3_IBO_TRADING_ENABLED") or "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _web3_ibo_trading_max() -> int:
    """Max dynamic Web3 IBO pairs. 0 = no cap (use full deposit catalog)."""
    try:
        return max(0, min(5000, int(os.getenv("BSC_WEB3_IBO_TRADING_MAX", "2000") or "2000")))
    except (TypeError, ValueError):
        return 2000


def _valid_base(asset: str) -> bool:
    ast = (asset or "").upper()
    if not ast or ast in IBO_TRADING_EXCLUDED:
        return False
    return bool(re.match(r"^[A-Z0-9]{2,12}$", ast))


def ibo_symbol_for_base(base: str) -> str:
    return f"{(base or '').upper()}{IBO_SUFFIX}"


def refresh_tradable_ibo_cache(
    provider_rows: Optional[List[Dict[str, Any]]] = None,
    *,
    force: bool = False,
) -> None:
    """Rebuild symbol map + USD price hints from deposit catalog (CoinGecko BSC)."""
    now = time.time()
    if (
        not force
        and _CACHE["map"]
        and (now - float(_CACHE.get("fetched_at") or 0)) < _CACHE_TTL_SEC
    ):
        return

    sym_map: Dict[str, str] = dict(IBO_QUOTED_SYMBOL_MAP)
    price_usd: Dict[str, float] = {}
    logo_urls: Dict[str, str] = dict(_CORE_LOGO_URLS)

    if _web3_ibo_trading_enabled():
        try:
            from listings.deposit_catalog import _MAX_CATALOG_LIMIT, build_deposit_catalog

            catalog_items: List[Dict[str, Any]] = []
            skip = 0
            total = 1
            while skip < total:
                raw = build_deposit_catalog(
                    list(provider_rows or []),
                    chain="bsc",
                    deposit_only=False,
                    include_all_listed=True,
                    include_web3_directory=True,
                    skip=skip,
                    limit=_MAX_CATALOG_LIMIT,
                )
                batch = raw.get("items") or []
                total = int(raw.get("total") or 0)
                catalog_items.extend(batch)
                skip += len(batch)
                if not batch:
                    break
            added = 0
            max_n = _web3_ibo_trading_max()
            for it in catalog_items:
                if max_n > 0 and added >= max_n:
                    break
                base = (it.get("asset") or "").upper()
                if not _valid_base(base):
                    continue
                sym = ibo_symbol_for_base(base)
                if sym in sym_map:
                    continue
                sym_map[sym] = base
                added += 1
                try:
                    px = float(it.get("price") or 0)
                    if px > 0 and base != "IBO":
                        price_usd[base] = px
                except (TypeError, ValueError):
                    pass
                logo = (it.get("logo_url") or "").strip()
                if logo:
                    logo_urls[base] = logo
            logger.info(
                "ibo_pairs: %d dynamic IBO pairs (%d with CoinGecko USD hint, %d logos)",
                added,
                len(price_usd),
                len(logo_urls),
            )
        except Exception:  # noqa: BLE001
            logger.exception("ibo_pairs: catalog refresh failed")

    try:
        from listings.registry import get_market_pair_defs

        for p in get_market_pair_defs():
            base = (p.get("base") or "").upper()
            if not _valid_base(base):
                continue
            sym = ibo_symbol_for_base(base)
            if sym in sym_map:
                continue
            sym_map[sym] = base
            logo = (p.get("logo_url") or "").strip()
            if logo:
                logo_urls[base] = logo
    except Exception:  # noqa: BLE001
        logger.exception("ibo_pairs: listed registry merge failed")

    _CACHE["map"] = sym_map
    try:
        from ibo.pricing import platform_ibo_usdt_price

        price_usd["IBO"] = platform_ibo_usdt_price()
    except Exception:  # noqa: BLE001
        pass
    _CACHE["price_usd"] = price_usd
    _CACHE["logo_urls"] = logo_urls
    _CACHE["fetched_at"] = now


def get_tradable_ibo_symbol_map(
    provider_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, str]:
    refresh_tradable_ibo_cache(provider_rows)
    return dict(_CACHE["map"])


def get_tradable_ibo_pairs() -> List[str]:
    return list(get_tradable_ibo_symbol_map().keys())


def get_ibo_usd_price_hints() -> Dict[str, float]:
    refresh_tradable_ibo_cache()
    out = dict(_CACHE["price_usd"])
    try:
        from ibo.pricing import platform_ibo_usdt_price

        out["IBO"] = platform_ibo_usdt_price()
    except Exception:  # noqa: BLE001
        pass
    return out


def get_ibo_logo_urls() -> Dict[str, str]:
    """Base asset → logo URL (deposit catalog + core majors)."""
    refresh_tradable_ibo_cache()
    return dict(_CACHE.get("logo_urls") or {})


def is_ibo_quoted_pair(symbol: str) -> bool:
    sym = (symbol or "").upper()
    return sym in get_tradable_ibo_symbol_map()


def resolve_ibo_base(symbol: str) -> Optional[str]:
    sym = (symbol or "").upper()
    return get_tradable_ibo_symbol_map().get(sym)


def merge_ibo_symbols_into_map(static_map: Dict[str, str]) -> Dict[str, str]:
    merged = dict(static_map)
    merged.update(get_tradable_ibo_symbol_map())
    return merged


def base_usdt_for_ibo_pair(
    base: str,
    *,
    by_sym: Optional[Dict[str, Dict[str, Any]]] = None,
    usd_hints: Optional[Dict[str, float]] = None,
) -> Optional[float]:
    """Underlying USDT price for a base asset (Binance ticker row or CoinGecko USD)."""
    b = (base or "").upper()
    if not b:
        return None
    usdt_sym = f"{b}USDT"
    t = (by_sym or {}).get(usdt_sym)
    if t and isinstance(t, dict):
        try:
            px = float(t.get("lastPrice") or 0)
            if px > 0:
                return px
        except (TypeError, ValueError):
            pass
    hints = usd_hints if usd_hints is not None else get_ibo_usd_price_hints()
    hint = hints.get(b)
    if hint and hint > 0:
        return float(hint)
    from ibo.constants import IBO_PAIR_FALLBACK_USDT

    fb = IBO_PAIR_FALLBACK_USDT.get(b)
    return float(fb) if fb else None
