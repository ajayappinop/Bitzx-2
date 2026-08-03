"""Deposit catalog for wallet UIs — searchable token list with BEP-20 metadata."""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from listings.constants import CHAIN_ID_BY_NETWORK
from listings.integration import merge_supported_networks
from listings.registry import get_approved_tokens, get_deposit_network_rows

logger = logging.getLogger(__name__)

BEP20_NETWORK = "BEP-20 (BNB Chain)"
BEP20_CHAIN_ID = "bsc"

BEP20_UNIVERSAL_ASSETS = frozenset({"BNB", "ETH", "USDT"})

_MAX_CATALOG_LIMIT = 20000

# CoinGecko BSC directory cache (optional — thousands of Web3 tokens for search/discovery)
# version 3: two-phase fetch (all-tokens base + market-data overlay)
_CG_CACHE: Dict[str, Any] = {"rows": [], "fetched_at": 0.0, "version": 3}
# All BSC tokens from /coins/list?include_platform=true  →  {cg_id: {symbol, name, contract}}
_CG_ALL_BSC: Dict[str, Any] = {"tokens": {}, "fetched_at": 0.0}
# Main catalog refresh TTL (controlled by env; default 6h to stay safe on free tier)
_CG_TTL_SEC = int(os.getenv("BSC_WEB3_CATALOG_TTL_SEC", str(6 * 3600)))
# /coins/list rarely changes — refresh every 6 hours regardless
_CG_CONTRACT_TTL_SEC = 6 * 3600

# CoinGecko ``platforms`` keys that map to BNB Chain (BEP-20)
_BSC_PLATFORM_KEYS = ("binance-smart-chain", "bnb-smart-chain", "bsc")


def _token_meta_index() -> Dict[str, Dict[str, Any]]:
    from listings.secure_store import decrypt_contract

    out: Dict[str, Dict[str, Any]] = {}
    for tok in get_approved_tokens():
        if tok.get("status") != "approved":
            continue
        sym = (tok.get("token_symbol") or "").upper()
        if not sym:
            continue
        contract = None
        decimals = 18
        for net in tok.get("networks") or []:
            if (net.get("network") or "") == BEP20_NETWORK or (
                net.get("chain_id") or ""
            ).lower() == BEP20_CHAIN_ID:
                contract = decrypt_contract(
                    net.get("contract_address_enc") or net.get("contract_address") or "",
                    encrypted=bool(net.get("contract_encrypted")),
                )
                decimals = int(net.get("decimals") or 18)
                break
        if not contract:
            contract = (tok.get("contract_address") or "").strip() or None
        out[sym] = {
            "token_name": tok.get("token_name") or sym,
            "project_name": tok.get("project_name"),
            "logo_url": tok.get("logo_url"),
            "contract_address": contract,
            "decimals": decimals,
            "listed_token_id": tok.get("id"),
            "is_listed": True,
            "trading_enabled": bool(tok.get("trading_enabled")),
            "description": (tok.get("description") or "")[:280],
        }
    return out


def _is_universal_bep20(network: str, chain_id: str, asset: str) -> bool:
    """True when (asset, network) uses the shared BNB Chain EVM deposit address."""
    cid = (chain_id or CHAIN_ID_BY_NETWORK.get(network, "")).lower()
    if network != BEP20_NETWORK and cid != BEP20_CHAIN_ID:
        return False
    ast = (asset or "").upper()
    if not ast or not re.match(r"^[A-Z0-9]{2,12}$", ast):
        return False
    if ast in BEP20_UNIVERSAL_ASSETS:
        return True
    try:
        from listings.registry import asset_uses_evm_derivation

        if asset_uses_evm_derivation(ast):
            return True
    except Exception:  # noqa: BLE001
        pass
    # Web3 / CoinGecko BSC directory — same universal address as USDT/BNB (no listing required).
    return True


def _matches_query(item: Dict[str, Any], q: str) -> bool:
    if not q:
        return True
    needle = q.strip().lower()
    if not needle:
        return True
    hay = " ".join(
        filter(
            None,
            [
                item.get("asset"),
                item.get("token_name"),
                item.get("project_name"),
                item.get("network"),
                item.get("contract_address"),
            ],
        )
    ).lower()
    return needle in hay


def _catalog_seen_key(item: Dict[str, Any]) -> Tuple[str, str, str]:
    """Stable dedupe key for catalog rows.

    For CoinGecko Web3 rows we must dedupe by coin id / contract, not symbol,
    because many unrelated tokens share the same ticker on BNB Chain.
    """
    source = str(item.get("catalog_source") or "")
    network = str(item.get("network") or "")
    cg_id = str(item.get("coingecko_id") or "").strip()
    if source == "coingecko_bsc" and cg_id:
        return ("coingecko_id", cg_id, network)

    contract = _normalize_evm_contract(item.get("contract_address"))
    if source == "coingecko_bsc" and contract:
        return ("coingecko_contract", contract.lower(), network)

    asset = str(item.get("asset") or "").upper()
    return ("asset_network", asset, network)


def _catalog_item_from_row(
    row: Dict[str, Any],
    meta: Dict[str, Dict[str, Any]],
    *,
    source: str = "platform",
) -> Optional[Dict[str, Any]]:
    asset = (row.get("asset") or "").strip().upper()
    network = (row.get("network") or "").strip()
    if not asset or not network:
        return None
    chain_id = (row.get("chain_id") or CHAIN_ID_BY_NETWORK.get(network, "")).lower()
    status = row.get("status") or "active"
    dep_on = bool(row.get("deposit_enabled")) and status != "coming_soon"
    tok = meta.get(asset, {})
    contract = tok.get("contract_address") or row.get("contract_address")
    if contract:
        contract = str(contract).strip()
        if not re.match(r"^0x[a-fA-F0-9]{40}$", contract):
            contract = None
    return {
        "asset": asset,
        "network": network,
        "chain_id": chain_id,
        "label": row.get("label") or f"{tok.get('token_name') or asset} — {network}",
        "token_name": tok.get("token_name") or asset,
        "project_name": tok.get("project_name"),
        "logo_url": tok.get("logo_url"),
        "contract_address": contract,
        "decimals": int(tok.get("decimals") or tok.get("token_decimals") or 18),
        "deposit_enabled": dep_on,
        "withdraw_enabled": bool(row.get("withdraw_enabled")),
        "status": status,
        "testnet": bool(row.get("testnet")),
        "listed_token_id": tok.get("listed_token_id") or row.get("listed_token_id"),
        "is_listed": bool(tok.get("is_listed")) or source == "listed",
        "universal_bep20": _is_universal_bep20(network, chain_id, asset),
        "endpoint_label": row.get("endpoint_label"),
        "chain_display": row.get("chain") or chain_id,
        "catalog_source": source,
        "trading_enabled": tok.get("trading_enabled"),
        "description": tok.get("description"),
    }


def _registry_catalog_rows(
    chain_f: Optional[str],
    *,
    include_all_listed: bool,
    deposit_only: bool,
) -> List[Dict[str, Any]]:
    """All approved listed tokens + deposit network rows from registry."""
    meta = _token_meta_index()
    seen: set[Tuple[str, str]] = set()
    out: List[Dict[str, Any]] = []

    def add_row(row: Dict[str, Any], source: str) -> None:
        asset = (row.get("asset") or "").upper()
        network = row.get("network") or ""
        key = (asset, network)
        if key in seen:
            return
        chain_id = (row.get("chain_id") or CHAIN_ID_BY_NETWORK.get(network, "")).lower()
        if chain_f and chain_id != chain_f:
            return
        dep_on = bool(row.get("deposit_enabled"))
        if deposit_only and not dep_on:
            return
        if not include_all_listed and not dep_on:
            return
        item = _catalog_item_from_row(row, meta, source=source)
        if item:
            seen.add(key)
            out.append(item)

    for row in get_deposit_network_rows():
        add_row({**row, "is_listed": True}, "listed")

    for tok in get_approved_tokens():
        if tok.get("status") != "approved":
            continue
        sym = tok["token_symbol"]
        networks = tok.get("networks") or []
        if not networks:
            net_label = tok.get("blockchain_network") or BEP20_NETWORK
            networks = [{
                "network": net_label,
                "chain_id": CHAIN_ID_BY_NETWORK.get(net_label, ""),
                "deposit_enabled": tok.get("deposit_enabled"),
                "withdraw_enabled": tok.get("withdraw_enabled"),
                "deposit_scan_enabled": True,
                "decimals": 18,
            }]
        for net in networks:
            network = net.get("network") or ""
            chain_id = (net.get("chain_id") or CHAIN_ID_BY_NETWORK.get(network, "")).lower()
            dep_net = bool(tok.get("deposit_enabled") and net.get("deposit_enabled"))
            scan_on = net.get("deposit_scan_enabled", True) is not False
            status = "active" if scan_on else "coming_soon"
            add_row({
                "asset": sym,
                "network": network,
                "chain_id": chain_id,
                "label": f"{tok.get('token_name', sym)} — {network}",
                "deposit_enabled": dep_net,
                "withdraw_enabled": bool(tok.get("withdraw_enabled") and net.get("withdraw_enabled")),
                "status": status,
                "listed_token_id": tok.get("id"),
                "is_listed": True,
                "token_decimals": int(net.get("decimals") or 18),
            }, "listed")

    return out


def _coingecko_catalog_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure cached/fresh Web3 rows are depositable via universal BEP-20 address."""
    out = dict(row)
    out["deposit_enabled"] = True
    out["status"] = "active"
    out["universal_bep20"] = True
    out["network"] = out.get("network") or BEP20_NETWORK
    out["chain_id"] = (out.get("chain_id") or BEP20_CHAIN_ID).lower()
    return out


def _normalize_evm_contract(addr: Any) -> Optional[str]:
    if not addr or not isinstance(addr, str):
        return None
    a = addr.strip()
    if not re.match(r"^0x[a-fA-F0-9]{40}$", a):
        return None
    return a


def _bsc_contract_from_platforms(platforms: Any) -> Optional[str]:
    if not isinstance(platforms, dict):
        return None
    for key in _BSC_PLATFORM_KEYS:
        norm = _normalize_evm_contract(platforms.get(key))
        if norm:
            return norm
    return None


def _coingecko_headers() -> Dict[str, str]:
    """Return auth headers if a CoinGecko API key is configured."""
    key = (os.getenv("COINGECKO_API_KEY") or "").strip()
    if key:
        return {"x-cg-demo-api-key": key}
    return {}


def _fetch_coingecko_all_bsc_tokens() -> Dict[str, Dict[str, Any]]:
    """Return ALL CoinGecko-known BEP-20 tokens via a single /coins/list call.

    Result: {cg_id: {"symbol": str, "name": str, "contract": str}}
    Cached for 6 hours (the list rarely changes intra-day).
    This gives us the COMPLETE universe — typically 6,000–12,000 tokens —
    far beyond what /coins/markets pages can cover.
    """
    now = time.time()
    if _CG_ALL_BSC["tokens"] and (now - float(_CG_ALL_BSC.get("fetched_at") or 0)) < _CG_CONTRACT_TTL_SEC:
        return dict(_CG_ALL_BSC["tokens"])

    try:
        import requests
    except ImportError:
        return {}

    tokens: Dict[str, Dict[str, Any]] = {}
    try:
        r = requests.get(
            "https://api.coingecko.com/api/v3/coins/list",
            params={"include_platform": "true"},
            headers=_coingecko_headers(),
            timeout=90,
        )
        if r.status_code == 429:
            logger.warning("CoinGecko /coins/list rate-limited — using cached tokens")
            return dict(_CG_ALL_BSC["tokens"])
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, list):
            return dict(_CG_ALL_BSC["tokens"])
        for coin in data:
            if not isinstance(coin, dict):
                continue
            cid = (coin.get("id") or "").strip()
            sym = (coin.get("symbol") or "").upper()
            name = (coin.get("name") or sym).strip()
            if not cid or not sym:
                continue
            contract = _bsc_contract_from_platforms(coin.get("platforms"))
            if contract:
                tokens[cid] = {"symbol": sym, "name": name, "contract": contract}
        _CG_ALL_BSC["tokens"] = tokens
        _CG_ALL_BSC["fetched_at"] = now
        logger.info("deposit_catalog: %d total BSC tokens from /coins/list", len(tokens))
    except Exception:  # noqa: BLE001
        logger.exception("deposit_catalog: CoinGecko /coins/list fetch failed")
    return dict(_CG_ALL_BSC["tokens"])


def _fetch_coingecko_bsc_directory() -> List[Dict[str, Any]]:
    """Full BSC Web3 catalog: ALL CoinGecko-known BEP-20 tokens, with prices for ranked ones.

    Two-phase strategy:
      Phase 1 — /coins/list gives us EVERY token that has a BNB Chain contract
                 address (~6k–12k tokens). These all appear in the catalog even
                 without price data.
      Phase 2 — /coins/markets pages overlay live prices / volumes on the
                 top-ranked tokens (up to BSC_WEB3_CATALOG_PAGES * 250).

    The result is that ALL tokens are searchable; top-ranked ones show prices.
    """
    enabled = (os.getenv("BSC_WEB3_CATALOG_ENABLED") or "").strip().lower() in (
        "1", "true", "yes", "on",
    )
    if not enabled:
        return []
    now = time.time()
    cache_ok = (
        _CG_CACHE.get("version") == 3
        and _CG_CACHE["rows"]
        and (now - float(_CG_CACHE.get("fetched_at") or 0)) < _CG_TTL_SEC
    )
    if cache_ok:
        return [_coingecko_catalog_row(r) for r in _CG_CACHE["rows"]]

    try:
        import requests
    except ImportError:
        return []

    # ── Phase 1: build base rows for ALL BSC tokens ──────────────────────────
    all_bsc = _fetch_coingecko_all_bsc_tokens()  # {cg_id: {symbol, name, contract}}
    # keyed by cg_id so Phase 2 can overwrite by id
    by_id: Dict[str, Dict[str, Any]] = {}
    for cg_id, meta in all_bsc.items():
        sym = meta["symbol"]
        by_id[cg_id] = {
            "asset": sym,
            "network": BEP20_NETWORK,
            "chain_id": BEP20_CHAIN_ID,
            "label": f"{meta['name']} — {BEP20_NETWORK}",
            "token_name": meta["name"],
            "project_name": meta["name"],
            "logo_url": None,
            "coingecko_id": cg_id,
            "contract_address": meta["contract"],
            "decimals": 18,
            "withdraw_enabled": False,
            "testnet": False,
            "listed_token_id": None,
            "is_listed": False,
            "catalog_source": "coingecko_bsc",
            "market_cap_rank": None,
            "price": "",
            "priceChangePercent": "0",
            "quoteVolume": "0",
            "highPrice": "",
            "lowPrice": "",
            "stats_source": "coingecko",
        }

    # ── Phase 2: overlay market data for top-ranked tokens ───────────────────
    # No hard cap — BSC_WEB3_CATALOG_PAGES controls how many market pages we fetch.
    # Default 8 (2 000 tokens with prices); set higher to get more price data.
    pages = max(1, int(os.getenv("BSC_WEB3_CATALOG_PAGES", "8") or "8"))
    per_page = 250
    # Inter-page pause (ms) to stay within CoinGecko free-tier rate limits.
    # Free tier: ~30 req/min → ~2 s between calls is safe.
    # Set COINGECKO_API_KEY to remove this bottleneck entirely.
    _page_sleep = 0.0 if (os.getenv("COINGECKO_API_KEY") or "").strip() else 2.1
    try:
        for page in range(1, pages + 1):
            if page > 1 and _page_sleep > 0:
                time.sleep(_page_sleep)
            r = requests.get(
                "https://api.coingecko.com/api/v3/coins/markets",
                params={
                    "vs_currency": "usd",
                    "category": "binance-smart-chain",
                    "order": "market_cap_desc",
                    "per_page": per_page,
                    "page": page,
                    "sparkline": "false",
                },
                headers=_coingecko_headers(),
                timeout=20,
            )
            if r.status_code == 429:
                logger.warning(
                    "CoinGecko BSC markets rate-limited on page %d — stopping here. "
                    "Set COINGECKO_API_KEY to remove this limit.",
                    page,
                )
                break
            r.raise_for_status()
            batch = r.json()
            if not isinstance(batch, list) or not batch:
                break
            for c in batch:
                sym = (c.get("symbol") or "").upper()
                if not sym:
                    continue
                cg_id = (c.get("id") or "").strip()
                cp = c.get("current_price")
                pct = c.get("price_change_percentage_24h")
                vol = c.get("total_volume")
                hi = c.get("high_24h")
                lo = c.get("low_24h")
                # Contract: prefer what Phase 1 already resolved from /coins/list.
                # Fall back to a direct BSC platform lookup if this id was missing.
                contract = (by_id.get(cg_id) or {}).get("contract_address")
                row = {
                    "asset": sym,
                    "network": BEP20_NETWORK,
                    "chain_id": BEP20_CHAIN_ID,
                    "label": f"{c.get('name') or sym} — {BEP20_NETWORK}",
                    "token_name": c.get("name") or sym,
                    "project_name": c.get("name"),
                    "logo_url": c.get("image"),
                    "coingecko_id": cg_id or None,
                    "contract_address": contract,
                    "decimals": 18,
                    "withdraw_enabled": False,
                    "testnet": False,
                    "listed_token_id": None,
                    "is_listed": False,
                    "catalog_source": "coingecko_bsc",
                    "market_cap_rank": c.get("market_cap_rank"),
                    "price": f"{float(cp):.8f}".rstrip("0").rstrip(".") if cp else "",
                    "priceChangePercent": (
                        f"{float(pct):.2f}" if pct is not None else "0"
                    ),
                    "quoteVolume": f"{float(vol):.2f}" if vol else "0",
                    "highPrice": f"{float(hi):.8f}" if hi else "",
                    "lowPrice": f"{float(lo):.8f}" if lo else "",
                    "stats_source": "coingecko",
                }
                if cg_id:
                    by_id[cg_id] = row  # overwrite base row with full market data
                else:
                    # No id — still include using symbol as key fallback
                    by_id[f"__sym_{sym}"] = row
            if len(batch) < per_page:
                break
    except Exception:  # noqa: BLE001
        logger.exception("deposit_catalog: CoinGecko BSC markets fetch failed")

    # ── Build final sorted list ───────────────────────────────────────────────
    # Tokens with market data (rank) come first, then unranked alphabetically.
    rows = list(by_id.values())
    rows.sort(
        key=lambda r: (
            0 if r.get("market_cap_rank") else 1,
            r.get("market_cap_rank") or 99999,
            r.get("asset") or "",
        )
    )

    _CG_CACHE["rows"] = rows
    _CG_CACHE["fetched_at"] = now
    _CG_CACHE["version"] = 3
    with_price = sum(1 for r in rows if r.get("price"))
    with_contract = sum(1 for r in rows if r.get("contract_address"))
    logger.info(
        "deposit_catalog: %d total BSC tokens (%d with price, %d with contract)",
        len(rows),
        with_price,
        with_contract,
    )
    return [_coingecko_catalog_row(r) for r in _CG_CACHE["rows"]]


def build_deposit_catalog(
    provider_rows: List[Dict[str, Any]],
    *,
    chain: Optional[str] = None,
    q: Optional[str] = None,
    deposit_only: bool = True,
    include_all_listed: bool = True,
    include_web3_directory: bool = True,
    skip: int = 0,
    limit: int = 500,
) -> Dict[str, Any]:
    """Build paginated deposit catalog: listed tokens + platform + optional Web3 directory."""
    chain_f = (chain or "").strip().lower()
    if chain_f in ("", "all"):
        chain_f = None

    meta = _token_meta_index()
    seen: set[Tuple[str, str, str]] = set()
    items: List[Dict[str, Any]] = []

    def push_item(item: Optional[Dict[str, Any]]) -> None:
        if not item:
            return
        key = _catalog_seen_key(item)
        if key in seen:
            return
        if chain_f and (item.get("chain_id") or "").lower() != chain_f:
            return
        if deposit_only and not item.get("deposit_enabled"):
            return
        if _matches_query(item, q or ""):
            seen.add(key)
            items.append(item)

    for row in _registry_catalog_rows(
        chain_f,
        include_all_listed=include_all_listed,
        deposit_only=False,
    ):
        push_item(row)

    merged = merge_supported_networks(list(provider_rows or []))
    for row in merged:
        push_item(_catalog_item_from_row(row, meta, source="platform"))

    if include_web3_directory and (not chain_f or chain_f == BEP20_CHAIN_ID):
        listed_contracts = {
            c.lower()
            for it in items
            if it.get("is_listed")
            for c in [str(it.get("contract_address") or "").strip()]
            if c and _normalize_evm_contract(c)
        }
        listed_assets = {str(it["asset"]).upper() for it in items if it.get("is_listed")}
        for cg in _fetch_coingecko_bsc_directory():
            cg_contract = _normalize_evm_contract(cg.get("contract_address"))
            if cg_contract and cg_contract.lower() in listed_contracts:
                continue
            if not cg_contract and str(cg.get("asset") or "").upper() in listed_assets:
                continue
            push_item(cg)

    def sort_key(it: Dict[str, Any]) -> tuple:
        dep = 0 if it.get("deposit_enabled") else 1
        listed = 0 if it.get("is_listed") else 1
        cid = (it.get("chain_id") or "").lower()
        bep = 0 if cid == BEP20_CHAIN_ID else 1
        rank = it.get("market_cap_rank") or 99999
        return (dep, listed, bep, rank, it.get("asset") or "")

    items.sort(key=sort_key)

    total = len(items)
    skip_i = max(0, int(skip or 0))
    limit_i = min(_MAX_CATALOG_LIMIT, max(1, int(limit or 500)))
    page = items[skip_i : skip_i + limit_i]

    listed_count = sum(1 for it in items if it.get("is_listed"))
    deposit_count = sum(1 for it in items if it.get("deposit_enabled"))
    bep20_deposit = sum(
        1 for it in items
        if (it.get("chain_id") or "").lower() == BEP20_CHAIN_ID and it.get("deposit_enabled")
    )

    return {
        "items": page,
        "total": total,
        "skip": skip_i,
        "limit": limit_i,
        "chain": chain_f or "all",
        "counts": {
            "listed": listed_count,
            "deposit_enabled": deposit_count,
            "bep20_deposit_enabled": bep20_deposit,
        },
        "bep20_universal": {
            "enabled": bep20_deposit > 0,
            "network": BEP20_NETWORK,
            "chain_id": BEP20_CHAIN_ID,
            "note": (
                "All BEP-20 tokens on BNB Chain share the same deposit address. "
                "Send only the token you selected; we detect the contract on-chain. "
                "Tokens marked directory are informational until enabled in admin."
            ),
        },
    }


def force_refresh_web3_catalog() -> Dict[str, Any]:
    """Force-expire all CoinGecko caches and re-fetch immediately.

    Clears both the full-directory cache (_CG_CACHE) and the all-tokens base
    cache (_CG_ALL_BSC) so Phase 1 + Phase 2 both re-run on the next call.
    Returns a dict with new token counts for logging/admin response.
    """
    _CG_CACHE["fetched_at"] = 0.0
    _CG_ALL_BSC["fetched_at"] = 0.0
    rows = _fetch_coingecko_bsc_directory()
    with_price = sum(1 for r in rows if r.get("price"))
    with_contract = sum(1 for r in rows if r.get("contract_address"))
    return {
        "refreshed": True,
        "total_web3_tokens": len(rows),
        "with_price_data": with_price,
        "without_price_data": len(rows) - with_price,
        "with_contract_address": with_contract,
    }


async def run_periodic_web3_catalog_refresh(interval_sec: int = 3600) -> None:
    """Background asyncio task: refresh the CoinGecko Web3 catalog on a fixed interval.

    Start this from server startup (lifespan). Uses asyncio.sleep so it does
    not block the event loop; the actual HTTP fetch runs in a thread-pool executor.
    """
    import asyncio

    logger.info("web3_catalog_refresh: background task started (interval=%ds)", interval_sec)
    while True:
        await asyncio.sleep(interval_sec)
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, force_refresh_web3_catalog)
            logger.info(
                "web3_catalog_refresh: refreshed %d tokens (%d with contract)",
                result.get("total_web3_tokens", 0),
                result.get("with_contract_address", 0),
            )
        except Exception:  # noqa: BLE001
            logger.exception("web3_catalog_refresh: periodic refresh failed")
