"""Merge dynamic listed tokens into wallet, trading, and deposit pipelines."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from listings.registry import get_deposit_network_rows, get_market_pair_defs, get_symbol_map


def _apply_ibo_withdraw_flags(rows: List[Dict[str, Any]]) -> None:
    """Enable IBO on-chain withdraw in API rows when treasury + BSC are configured."""
    wdr_env = (os.getenv("IBO_WITHDRAW_ENABLED") or "true").strip().lower() in (
        "1", "true", "yes", "on",
    )
    if not wdr_env:
        return
    try:
        from services import blockchain_service

        if not blockchain_service.get_provider().can_broadcast("IBO", network="BEP-20 (BNB Chain)"):
            return
    except Exception:  # noqa: BLE001
        return
    for row in rows:
        if (row.get("asset") or "").upper() == "IBO":
            row["deposit_enabled"] = True
            row["withdraw_enabled"] = True
            if row.get("status") == "coming_soon":
                row["status"] = "active"


def merge_supported_networks(provider_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Append DB-driven (asset, network) rows; dedupe by (asset, network)."""
    seen = {(r.get("asset"), r.get("network")) for r in provider_rows}
    out = list(provider_rows)
    for row in get_deposit_network_rows():
        key = (row.get("asset"), row.get("network"))
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    _apply_ibo_withdraw_flags(out)
    return out


def merge_trading_markets_snapshot(
    rows: List[Dict[str, Any]],
    *,
    ibo_base_price: float,
    controls: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Enrich snapshot rows with admin market catalog metadata (no synthetic prices)."""
    del ibo_base_price  # unused; snapshot builder supplies live rows before enrich
    try:
        from listings.market_catalog import enrich_markets_snapshot

        return enrich_markets_snapshot(rows, controls=controls)
    except Exception:  # noqa: BLE001
        return rows


def effective_symbol_base_map(static_map: Dict[str, str]) -> Dict[str, str]:
    merged = dict(static_map)
    merged.update(get_symbol_map())
    try:
        from listings.listed_trading import internal_mock_usdt_pair_map

        for sym, meta in internal_mock_usdt_pair_map().items():
            merged.setdefault(sym, str(meta.get("base") or sym.replace("USDT", "")).upper())
    except Exception:  # noqa: BLE001
        pass
    try:
        from listings.ibo_pairs import merge_ibo_symbols_into_map

        return merge_ibo_symbols_into_map(merged)
    except Exception:  # noqa: BLE001
        return merged
