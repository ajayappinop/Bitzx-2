"""Market catalog — admin-managed display metadata merged into trading markets."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

MAJOR_BASES = frozenset({"BTC", "ETH", "BNB", "SOL", "XRP"})
MARKET_CATEGORIES = ("major", "alt", "ibo", "listed", "defi", "meme")

_DEFAULT_NAMES = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "BNB": "BNB",
    "SOL": "Solana",
    "XRP": "XRP",
    "DOGE": "Dogecoin",
    "ADA": "Cardano",
    "POL": "Polygon",
    "AVAX": "Avalanche",
    "DOT": "Polkadot",
    "LINK": "Chainlink",
    "LTC": "Litecoin",
    "IBO": "Ibo Token",
    "TRX": "TRON",
}


def _default_category(base: str, *, source: str = "", is_platform: bool = False) -> str:
    b = (base or "").upper()
    if b == "IBO" or source == "internal":
        return "ibo"
    if b in MAJOR_BASES:
        return "major"
    if source == "listed" or is_platform:
        return "listed"
    return "alt"


def _display_fields_from_token(tok: Dict[str, Any]) -> Dict[str, Any]:
    sym = tok.get("spot_symbol") or f"{tok.get('token_symbol', '')}{tok.get('quote_asset', 'USDT')}"
    base = tok.get("token_symbol", "")
    return {
        "symbol": sym.upper(),
        "base": base.upper(),
        "quote": (tok.get("quote_asset") or "USDT").upper(),
        "project_name": tok.get("project_name") or tok.get("token_name") or base,
        "token_name": tok.get("token_name") or base,
        "logo_url": tok.get("logo_url"),
        "description": (tok.get("description") or "")[:500],
        "market_tagline": (tok.get("market_tagline") or "").strip(),
        "market_category": (tok.get("market_category") or "listed").lower(),
        "market_visible": tok.get("market_visible", True) is not False,
        "featured_landing": bool(tok.get("featured_landing")),
        "market_sort_order": int(tok.get("market_sort_order") or 500),
        "blockchain_network": tok.get("blockchain_network"),
        "official_website": tok.get("official_website"),
        "twitter_link": tok.get("twitter_link"),
        "telegram_link": tok.get("telegram_link"),
        "listed_token_id": tok.get("id"),
        "is_listed": True,
        "is_platform_default": bool(tok.get("is_platform_default")),
        "trading_enabled": bool(tok.get("trading_enabled")),
        "deposit_enabled": bool(tok.get("deposit_enabled")),
    }


def get_token_market_meta_map() -> Dict[str, Dict[str, Any]]:
    """spot_symbol → display metadata from approved listed tokens."""
    from listings.registry import get_approved_tokens

    out: Dict[str, Dict[str, Any]] = {}
    for tok in get_approved_tokens():
        if tok.get("status") != "approved":
            continue
        if not tok.get("trading_enabled"):
            continue
        fields = _display_fields_from_token(tok)
        out[fields["symbol"]] = fields
        out[fields["base"]] = fields
    return out


def get_platform_market_overrides(controls: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Per-symbol overrides from platform_controls.market_display (built-in pairs)."""
    raw = (controls or {}).get("market_display")
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for sym, row in raw.items():
        if not isinstance(row, dict):
            continue
        key = str(sym).upper()
        out[key] = row
    return out


def _apply_override(meta: Dict[str, Any], override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not override:
        return meta
    o = dict(meta)
    for k in (
        "market_visible",
        "featured_landing",
        "market_sort_order",
        "market_tagline",
        "market_category",
        "project_name",
        "token_name",
        "logo_url",
        "description",
    ):
        if k in override and override[k] is not None:
            o[k] = override[k]
    return o


def enrich_market_row(
    row: Dict[str, Any],
    *,
    token_meta: Dict[str, Dict[str, Any]],
    platform_overrides: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """Attach catalog fields to a trading markets snapshot row."""
    sym = (row.get("symbol") or "").upper()
    base = (row.get("base") or row.get("baseAsset") or sym.replace("USDT", "").replace("IBO", "")).upper()
    quote = (row.get("quoteAsset") or ("IBO" if sym.endswith("IBO") else "USDT")).upper()
    source = row.get("source") or ""

    tok = token_meta.get(sym) or token_meta.get(base)
    override = platform_overrides.get(sym) or platform_overrides.get(base)

    if tok:
        meta = {
            **tok,
            "source": source or ("listed" if tok.get("is_listed") else source),
        }
    else:
        meta = {
            "symbol": sym,
            "base": base,
            "quote": quote,
            "project_name": _DEFAULT_NAMES.get(base, base),
            "token_name": _DEFAULT_NAMES.get(base, base),
            "logo_url": None,
            "description": "",
            "market_tagline": "",
            "market_category": _default_category(base, source=source),
            "market_visible": True,
            "featured_landing": base in ("IBO", "BTC", "ETH", "BNB", "SOL"),
            "market_sort_order": 10 if base in MAJOR_BASES else (5 if base == "IBO" else 200),
            "listed_token_id": row.get("listed_token_id"),
            "is_listed": source == "listed",
            "is_platform_default": base == "IBO",
            "trading_enabled": True,
            "deposit_enabled": None,
        }

    meta = _apply_override(meta, override)
    out = {**row, **{k: v for k, v in meta.items() if k not in row or k.startswith("market_") or k in (
        "project_name", "token_name", "logo_url", "description", "market_tagline",
        "market_category", "market_visible", "featured_landing", "market_sort_order",
        "listed_token_id", "is_listed", "is_platform_default", "blockchain_network",
        "official_website", "twitter_link", "telegram_link", "trading_enabled", "deposit_enabled",
    )}}
    return out


def enrich_markets_snapshot(
    rows: List[Dict[str, Any]],
    *,
    controls: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    token_meta = get_token_market_meta_map()
    overrides = get_platform_market_overrides(controls)
    enriched = [enrich_market_row(r, token_meta=token_meta, platform_overrides=overrides) for r in rows]
    return [r for r in enriched if r.get("market_visible", True) is not False]


def build_public_market_catalog(
    rows: List[Dict[str, Any]],
    *,
    controls: Optional[Dict[str, Any]] = None,
    featured_limit: int = 8,
) -> Dict[str, Any]:
    """Public catalog payload for landing + markets pages (live stats only)."""
    items = enrich_markets_snapshot(rows or [], controls=controls)
    items.sort(key=lambda r: (int(r.get("market_sort_order") or 500), r.get("symbol") or ""))

    featured = [r for r in items if r.get("featured_landing")]
    featured.sort(key=lambda r: (int(r.get("market_sort_order") or 500), r.get("symbol") or ""))
    if len(featured) < 3:
        for r in items:
            if r not in featured and (r.get("market_category") in ("major", "ibo")):
                featured.append(r)
            if len(featured) >= featured_limit:
                break
    featured = featured[:featured_limit]

    by_cat: Dict[str, int] = {}
    for r in items:
        c = (r.get("market_category") or "alt").lower()
        by_cat[c] = by_cat.get(c, 0) + 1

    return {
        "items": items,
        "featured": featured,
        "total": len(items),
        "categories": by_cat,
        "category_labels": {
            "major": "Major",
            "alt": "Altcoins",
            "ibo": "IBO ecosystem",
            "listed": "Listed projects",
            "defi": "DeFi",
            "meme": "Meme",
        },
    }
