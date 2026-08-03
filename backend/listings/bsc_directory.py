"""Public BSC / Web3 token directory — same universe as wallet deposit catalog, market-style rows."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from listings.deposit_catalog import build_deposit_catalog


def _fmt_num(v: Any, *, decimals: int = 8) -> str:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return ""
    if n <= 0:
        return ""
    if n >= 1:
        return f"{n:.{min(decimals, 4)}f}".rstrip("0").rstrip(".")
    return f"{n:.{decimals}f}".rstrip("0").rstrip(".")


def catalog_item_to_display_row(item: Dict[str, Any]) -> Dict[str, Any]:
    """Map deposit-catalog item → landing / markets / admin display row."""
    asset = (item.get("asset") or "").upper()
    network = item.get("network") or ""
    chain_id = (item.get("chain_id") or "bsc").lower()
    src = item.get("catalog_source") or ("listed" if item.get("is_listed") else "platform")
    stats = item.get("stats_source") or (
        "coingecko" if src == "coingecko_bsc" else "listed" if item.get("is_listed") else "platform"
    )
    price = item.get("price") or ""
    pct = item.get("priceChangePercent")
    if pct is None and item.get("price_change_percentage_24h") is not None:
        pct = item.get("price_change_percentage_24h")

    from listings.ibo_pairs import ibo_symbol_for_base

    trading = bool(item.get("trading_enabled"))
    trade_symbol = ibo_symbol_for_base(asset) if asset else ""
    can_ibo_trade = bool(trade_symbol) and (
        trading or (src == "coingecko_bsc" and bool(item.get("deposit_enabled")))
    )
    symbol = f"{asset}USDT" if asset else ""

    return {
        "symbol": symbol,
        "trade_symbol": trade_symbol or (f"{asset}IBO" if asset else ""),
        "base": asset,
        "baseAsset": asset,
        "quoteAsset": "USDT",
        "quote": "USDT",
        "network": network,
        "chain_id": chain_id,
        "source": "web3" if src == "coingecko_bsc" else ("listed" if item.get("is_listed") else "platform"),
        "stats_source": stats,
        "catalog_source": src,
        "price": str(price) if price else "",
        "priceChange": item.get("priceChange") or "0",
        "priceChangePercent": str(pct) if pct is not None else "",
        "highPrice": item.get("highPrice") or "",
        "lowPrice": item.get("lowPrice") or "",
        "volume": item.get("volume") or "0",
        "quoteVolume": item.get("quoteVolume") or "0",
        "logo_url": item.get("logo_url"),
        "token_name": item.get("token_name") or asset,
        "project_name": item.get("project_name"),
        "contract_address": item.get("contract_address"),
        "decimals": item.get("decimals") or 18,
        "deposit_enabled": bool(item.get("deposit_enabled")),
        "withdraw_enabled": bool(item.get("withdraw_enabled")),
        "is_listed": bool(item.get("is_listed")),
        "listed_token_id": item.get("listed_token_id"),
        "market_cap_rank": item.get("market_cap_rank"),
        "market_category": (
            "listed" if item.get("is_listed") else "web3" if src == "coingecko_bsc" else "platform"
        ),
        "market_visible": True,
        "market_tagline": (item.get("description") or "")[:120] or None,
        "universal_bep20": bool(item.get("universal_bep20")),
        "status": item.get("status") or "active",
        "has_live_price": bool(price and stats == "coingecko"),
        "actions": {
            "deposit": True,
            "trade": can_ibo_trade,
            "trade_quote": "IBO",
        },
    }


def build_bsc_directory_display(
    provider_rows: List[Dict[str, Any]],
    *,
    q: Optional[str] = None,
    skip: int = 0,
    limit: int = 60,
    deposit_only: bool = False,
    listed_only: bool = False,
    web3_only: bool = False,
) -> Dict[str, Any]:
    """Paginated BSC directory for exchange + admin (mirrors wallet deposit catalog)."""
    raw = build_deposit_catalog(
        provider_rows,
        chain="bsc",
        q=q,
        deposit_only=deposit_only,
        include_all_listed=True,
        include_web3_directory=True,
        skip=0,
        limit=20000,
    )
    items = raw.get("items") or []
    rows: List[Dict[str, Any]] = []
    for it in items:
        if listed_only and not it.get("is_listed"):
            continue
        if web3_only and it.get("catalog_source") != "coingecko_bsc":
            continue
        rows.append(catalog_item_to_display_row(it))

    rows.sort(
        key=lambda r: (
            0 if r.get("deposit_enabled") else 1,
            0 if r.get("is_listed") else 1,
            r.get("market_cap_rank") or 99999,
            r.get("base") or "",
        )
    )

    total = len(rows)
    skip_i = max(0, int(skip or 0))
    limit_i = min(200, max(1, int(limit or 60)))
    page = rows[skip_i : skip_i + limit_i]

    with_price = sum(1 for r in rows if r.get("has_live_price"))
    return {
        "items": page,
        "total": total,
        "skip": skip_i,
        "limit": limit_i,
        "chain": "bsc",
        "counts": {
            **(raw.get("counts") or {}),
            "with_live_price": with_price,
            "web3_directory": sum(1 for r in rows if r.get("catalog_source") == "coingecko_bsc"),
        },
        "bep20_universal": raw.get("bep20_universal"),
    }
