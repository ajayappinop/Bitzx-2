"""In-memory cache of approved listed tokens for hot paths (deposits, trading, scans)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from listings.constants import CHAIN_ID_BY_NETWORK, COL_TOKENS, STATUS_APPROVED
from listings.secure_store import decrypt_contract

logger = logging.getLogger(__name__)

_lock = asyncio.Lock()
_cache: Dict[str, Any] = {
    "tokens": [],
    "symbol_map": {},
    "network_pairs": set(),
    "deposit_network_rows": [],
    "scan_groups": [],
    "pairs_for_markets": [],
}


def _spot_symbol(base: str, quote: str) -> str:
    return f"{base.upper()}{quote.upper()}"


def _network_row_from_token(tok: Dict[str, Any], net: Dict[str, Any]) -> Dict[str, Any]:
    network = net.get("network") or tok.get("blockchain_network")
    chain_id = net.get("chain_id") or CHAIN_ID_BY_NETWORK.get(network, "")
    return {
        "asset": tok["token_symbol"],
        "network": network,
        "chain": chain_id,
        "label": f"{tok.get('token_name', tok['token_symbol'])} — {network}",
        "testnet": False,
        "chain_id": chain_id,
        "endpoint_label": net.get("endpoint_label") or chain_id.upper(),
        "deposit_enabled": bool(net.get("deposit_enabled", tok.get("deposit_enabled"))),
        "withdraw_enabled": bool(net.get("withdraw_enabled", tok.get("withdraw_enabled"))),
        "status": "active" if net.get("deposit_scan_enabled", True) else "coming_soon",
        "rpc_configured": True,
        "listed_token_id": tok.get("id"),
        "token_decimals": int(net.get("decimals") or 18),
    }


def _build_scan_groups(tokens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group deposit addresses scan config by (chain_id, contract, network_label, decimals)."""
    groups: Dict[Tuple, Dict[str, Any]] = {}
    for tok in tokens:
        if not tok.get("deposit_enabled"):
            continue
        sym = tok["token_symbol"]
        for net in tok.get("networks") or []:
            if not net.get("deposit_enabled"):
                continue
            if not net.get("deposit_scan_enabled", True):
                continue
            chain = (net.get("chain_id") or "").lower()
            contract = decrypt_contract(
                net.get("contract_address_enc") or net.get("contract_address") or "",
                encrypted=bool(net.get("contract_encrypted")),
            )
            if not contract:
                continue
            network_label = net.get("network") or ""
            decimals = int(net.get("decimals") or 18)
            key = (chain, contract.lower(), network_label, decimals)
            if key not in groups:
                groups[key] = {
                    "asset": sym,
                    "chain_id": chain,
                    "contract": contract.lower(),
                    "network_label": network_label,
                    "decimals": decimals,
                    "rpc_chain_key": net.get("rpc_chain_key") or chain,
                }
    return list(groups.values())


def _rebuild(tokens: List[Dict[str, Any]]) -> None:
    symbol_map: Dict[str, str] = {}
    network_pairs: Set[Tuple[str, str]] = set()
    deposit_rows: List[Dict[str, Any]] = []
    market_pairs: List[Dict[str, Any]] = []

    for tok in tokens:
        if tok.get("status") != STATUS_APPROVED:
            continue
        base = tok["token_symbol"]
        quote = (tok.get("quote_asset") or "USDT").upper()
        if tok.get("trading_enabled"):
            sym = _spot_symbol(base, quote)
            symbol_map[sym] = base
            market_pairs.append({
                "token_id": tok["id"],
                "symbol": sym,
                "base": base,
                "quote": quote,
                "source": "listed",
                "project_name": tok.get("project_name"),
                "logo_url": tok.get("logo_url"),
            })
        for net in tok.get("networks") or []:
            network_pairs.add((base, net.get("network") or ""))
            if tok.get("deposit_enabled") and net.get("deposit_enabled"):
                deposit_rows.append(_network_row_from_token(tok, net))

    _cache["tokens"] = tokens
    _cache["symbol_map"] = symbol_map
    _cache["network_pairs"] = network_pairs
    _cache["deposit_network_rows"] = deposit_rows
    _cache["scan_groups"] = _build_scan_groups(tokens)
    _cache["pairs_for_markets"] = market_pairs


async def refresh(db) -> None:
    if db is None:
        return
    rows = await db[COL_TOKENS].find(
        {"status": STATUS_APPROVED},
        {"_id": 0},
    ).to_list(500)
    async with _lock:
        _rebuild(rows)
    try:
        from listings.ibo_pairs import refresh_tradable_ibo_cache
        from listings.ibo_markets import invalidate_ibo_rows_cache
        from futures.symbols import invalidate_supported_symbols_cache

        refresh_tradable_ibo_cache(force=True)
        invalidate_ibo_rows_cache()
        invalidate_supported_symbols_cache()
    except Exception:  # noqa: BLE001
        logger.exception("listings: cache invalidation after registry refresh failed")
    logger.info("listings: registry refreshed (%d approved tokens)", len(rows))


def get_approved_tokens() -> List[Dict[str, Any]]:
    """Approved listed tokens from the in-memory cache (no contract secrets stripped)."""
    return list(_cache.get("tokens") or [])


def get_deposit_network_rows() -> List[Dict[str, Any]]:
    return list(_cache.get("deposit_network_rows") or [])


def get_scan_groups() -> List[Dict[str, Any]]:
    return list(_cache.get("scan_groups") or [])


def get_symbol_map() -> Dict[str, str]:
    return dict(_cache.get("symbol_map") or {})


def get_market_pair_defs() -> List[Dict[str, Any]]:
    return list(_cache.get("pairs_for_markets") or [])


def is_asset_network_supported(asset: str, network: str) -> bool:
    return (asset.upper(), network) in (_cache.get("network_pairs") or set())


def get_evm_listed_assets() -> Set[str]:
    out: Set[str] = set()
    for a, _n in _cache.get("network_pairs") or set():
        out.add(a)
    return out


def asset_uses_evm_derivation(asset: str) -> bool:
    """Listed tokens on EVM networks use the same HD path as ETH/USDT."""
    sym = asset.upper()
    for a, net in _cache.get("network_pairs") or set():
        if a != sym:
            continue
        if net in ("ERC-20 (Ethereum)", "BEP-20 (BNB Chain)"):
            return True
    return False
