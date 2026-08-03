"""Admin toggles for QuickNode / JSON-RPC chain endpoints.

Settings live in ``platform_controls.blockchain_chain_settings`` (Mongo
``id: global``). When a chain is disabled, :mod:`services.rpc_endpoints`
masks HTTP/WS URLs so deposits, scanning, and wallet UIs treat the rail as
offline without removing env configuration.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from services.rpc_endpoints import get_registry

KNOWN_CHAIN_IDS: tuple[str, ...] = ("btc", "eth", "bsc", "tron", "solana")

DEFAULT_BLOCKCHAIN_CHAIN_SETTINGS: Dict[str, bool] = {
    chain_id: True for chain_id in KNOWN_CHAIN_IDS
}

CHAIN_ADMIN_LABELS: Dict[str, str] = {
    "btc": "Bitcoin (QUICKNODE_BTC_URL)",
    "eth": "Ethereum (QUICKNODE_ETH_URL)",
    "bsc": "BNB Smart Chain (QUICKNODE_BSC_URL)",
    "tron": "Tron (QUICKNODE_TRON_URL)",
    "solana": "Solana (QUICKNODE_SOLANA_URL)",
}


def normalize_blockchain_chain_settings(raw: Any) -> Dict[str, bool]:
    """Coerce stored controls into ``{chain_id: enabled}``."""
    out = dict(DEFAULT_BLOCKCHAIN_CHAIN_SETTINGS)
    if not raw:
        return out
    if not isinstance(raw, dict):
        return out
    for key, val in raw.items():
        cid = (str(key) or "").strip().lower()
        if cid not in out:
            continue
        if isinstance(val, bool):
            out[cid] = val
        elif isinstance(val, dict):
            out[cid] = bool(val.get("enabled", val.get("admin_enabled", True)))
        elif isinstance(val, (int, float)):
            out[cid] = bool(val)
        elif isinstance(val, str):
            out[cid] = val.strip().lower() in ("1", "true", "yes", "on", "enabled")
    return out


def apply_admin_settings_to_registry(settings_raw: Any) -> Dict[str, bool]:
    """Push admin chain toggles into the in-process RPC registry."""
    settings = normalize_blockchain_chain_settings(settings_raw)
    get_registry().set_admin_chain_settings(settings)
    return settings


def merge_blockchain_chain_settings_patch(
    current_raw: Any,
    patch_raw: Any,
) -> Dict[str, bool]:
    """Deep-merge a partial admin PATCH into the effective settings dict."""
    merged = normalize_blockchain_chain_settings(current_raw)
    patch = normalize_blockchain_chain_settings(patch_raw)
    merged.update(patch)
    return merged
