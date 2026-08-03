"""Platform default token (IBO) — on-chain reads, explorer links, deposit rail status."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from listings.constants import COL_TOKENS, STATUS_APPROVED
from listings import registry
from listings.secure_store import decrypt_contract
from listings.service import seed_platform_default_ibo

logger = logging.getLogger(__name__)

# ERC-20 function selectors
_SEL_NAME = "0x06fdde03"
_SEL_SYMBOL = "0x95d89b41"
_SEL_DECIMALS = "0x313ce567"
_SEL_TOTAL_SUPPLY = "0x18160ddd"


def _env_bool(key: str, default: str = "false") -> bool:
    return (os.getenv(key) or default).strip().lower() in ("1", "true", "yes", "on")


def _env_checklist() -> List[Dict[str, Any]]:
    contract = (os.getenv("IBO_CONTRACT_ADDRESS") or "").strip()
    mnemonic = (os.getenv("BLOCKCHAIN_MASTER_MNEMONIC") or "").strip()
    bsc = (os.getenv("QUICKNODE_BSC_URL") or "").strip()
    provider = (os.getenv("BLOCKCHAIN_PROVIDER") or "").strip().lower()
    rows = [
        {"key": "IBO_CONTRACT_ADDRESS", "label": "IBO contract", "set": bool(contract), "ok": contract.startswith("0x") and len(contract) == 42 and contract != "0x" + "0" * 40},
        {"key": "QUICKNODE_BSC_URL", "label": "BSC RPC (deposits)", "set": bool(bsc), "ok": bool(bsc)},
        {"key": "BLOCKCHAIN_PROVIDER", "label": "Blockchain provider", "set": bool(provider), "ok": provider == "quicknode"},
        {"key": "BLOCKCHAIN_MASTER_MNEMONIC", "label": "HD mnemonic (addresses)", "set": bool(mnemonic), "ok": bool(mnemonic)},
        {"key": "DEPOSIT_POLL_ENABLED", "label": "Deposit poller", "set": True, "ok": _env_bool("DEPOSIT_POLL_ENABLED")},
        {"key": "DEPOSIT_CREDIT_ENABLED", "label": "Auto-credit deposits", "set": True, "ok": _env_bool("DEPOSIT_CREDIT_ENABLED")},
        {"key": "IBO_DEPOSIT_ENABLED", "label": "IBO deposits (seed)", "set": True, "ok": _env_bool("IBO_DEPOSIT_ENABLED", "true")},
    ]
    return rows


def _decode_abi_string(hex_result: Any) -> Optional[str]:
    if not hex_result or not isinstance(hex_result, str) or not hex_result.startswith("0x"):
        return None
    raw = hex_result[2:]
    if len(raw) < 128:
        return None
    try:
        offset = int(raw[0:64], 16) * 2
        length = int(raw[offset : offset + 64], 16)
        data = bytes.fromhex(raw[offset + 64 : offset + 64 + length * 2])
        return data.decode("utf-8", errors="replace").strip("\x00")
    except (ValueError, IndexError):
        return None


def _decode_uint(hex_result: Any) -> Optional[int]:
    if not hex_result or not isinstance(hex_result, str):
        return None
    try:
        return int(hex_result, 16)
    except ValueError:
        return None


async def _eth_call(rpc_url: str, contract: str, data: str) -> Any:
    from services.rpc_endpoints import get_rpc_transport

    transport = get_rpc_transport(rpc_url)
    return await transport.json_rpc(
        "eth_call",
        [{"to": contract, "data": data}, "latest"],
    )


async def read_erc20_on_chain(
    contract: str,
    *,
    rpc_url: str,
    decimals_hint: int = 18,
) -> Dict[str, Any]:
    """Read name, symbol, decimals, totalSupply from BSC/ETH RPC."""
    out: Dict[str, Any] = {
        "contract_address": contract,
        "rpc_available": bool(rpc_url),
        "name": None,
        "symbol": None,
        "decimals": decimals_hint,
        "total_supply_raw": None,
        "total_supply_human": None,
        "read_errors": [],
    }
    if not rpc_url or not contract.startswith("0x"):
        out["read_errors"].append("RPC or contract not configured")
        return out
    try:
        name_raw = await _eth_call(rpc_url, contract, _SEL_NAME)
        sym_raw = await _eth_call(rpc_url, contract, _SEL_SYMBOL)
        dec_raw = await _eth_call(rpc_url, contract, _SEL_DECIMALS)
        sup_raw = await _eth_call(rpc_url, contract, _SEL_TOTAL_SUPPLY)
        out["name"] = _decode_abi_string(name_raw)
        out["symbol"] = _decode_abi_string(sym_raw)
        dec = _decode_uint(dec_raw)
        if dec is not None:
            out["decimals"] = dec
        supply = _decode_uint(sup_raw)
        if supply is not None:
            out["total_supply_raw"] = str(supply)
            div = 10 ** int(out["decimals"] or 18)
            out["total_supply_human"] = supply / div
    except Exception as exc:  # noqa: BLE001
        logger.warning("platform_token: on-chain read failed: %s", exc)
        out["read_errors"].append(str(exc))
    return out


async def fetch_bscscan_token_stats(contract: str) -> Dict[str, Any]:
    """Optional BscScan stats (holders, transfers) when BSCSCAN_API_KEY is set."""
    api_key = (os.getenv("BSCSCAN_API_KEY") or "").strip()
    out: Dict[str, Any] = {
        "api_configured": bool(api_key),
        "holders": None,
        "transfers": None,
        "price_usd": None,
        "errors": [],
    }
    if not api_key:
        return out
    from services.rpc_endpoints import _shared_http_client

    client = await _shared_http_client()
    base = "https://api.bscscan.com/api"
    try:
        for action, field in (("tokenholdercount", "holders"), ("tokentxnx", "transfers")):
            params = {
                "module": "token",
                "action": action,
                "contractaddress": contract,
                "apikey": api_key,
            }
            resp = await client.get(base, params=params, timeout=20.0)
            data = resp.json()
            if str(data.get("status")) == "1" and data.get("result") is not None:
                res = data["result"]
                if field == "holders":
                    out["holders"] = int(res) if str(res).isdigit() else res
                else:
                    out["transfers"] = int(res) if str(res).isdigit() else res
            elif data.get("message"):
                out["errors"].append(f"{action}: {data.get('message')}")
    except Exception as exc:  # noqa: BLE001
        out["errors"].append(str(exc))
    return out


def _explorer_links(contract: str) -> Dict[str, str]:
    c = contract.lower()
    return {
        "bscscan_token": f"https://bscscan.com/token/{c}",
        "bscscan_contract": f"https://bscscan.com/address/{c}#code",
        "bscscan_holders": f"https://bscscan.com/token/{c}#balances",
        "bscscan_transfers": f"https://bscscan.com/token/{c}#transfers",
    }


async def _sync_rpc_admin_from_db(db) -> None:
    """Apply platform_controls.blockchain_chain_settings to the RPC registry."""
    if db is None:
        return
    try:
        from services.blockchain_chain_controls import apply_admin_settings_to_registry

        doc = await db.platform_controls.find_one({"id": "global"}, {"_id": 0, "blockchain_chain_settings": 1})
        apply_admin_settings_to_registry((doc or {}).get("blockchain_chain_settings"))
        provider = None
        try:
            from services import blockchain_service

            provider = blockchain_service.get_provider()
            if hasattr(provider, "refresh_rpc_urls_from_registry"):
                provider.refresh_rpc_urls_from_registry()
        except Exception:  # noqa: BLE001
            pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("platform_token: RPC admin sync failed: %s", exc)


async def _deposit_rails(db, token: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    await _sync_rpc_admin_from_db(db)
    from services.blockchain_chain_controls import normalize_blockchain_chain_settings
    from services.rpc_endpoints import get_registry

    reg = get_registry()
    bsc_env = reg.get_env("bsc").http_url if reg else None
    bsc_active = reg.http_url("bsc") if reg else None
    admin_settings: Dict[str, bool] = {}
    if db is not None:
        doc = await db.platform_controls.find_one({"id": "global"}, {"_id": 0})
        admin_settings = normalize_blockchain_chain_settings((doc or {}).get("blockchain_chain_settings"))
    bsc_admin_on = admin_settings.get("bsc", True)
    sym = (token or {}).get("token_symbol") or "IBO"
    net = "BEP-20 (BNB Chain)"
    scan_groups = registry.get_scan_groups()
    ibo_scan = next(
        (g for g in scan_groups if (g.get("asset") or "").upper() == sym.upper()),
        None,
    )
    addr_count = 0
    event_count = 0
    recent: List[Dict[str, Any]] = []
    if db is not None:
        addr_count = await db.deposit_addresses.count_documents(
            {"asset": sym.upper(), "network": net, "enabled": True},
        )
        event_count = await db.deposit_events.count_documents(
            {"asset": sym.upper(), "network": net},
        )
        recent = await db.deposit_events.find(
            {"asset": sym.upper(), "network": net},
            {"_id": 0},
        ).sort("last_seen_at", -1).limit(8).to_list(8)

    nets = (token or {}).get("networks") or []
    net0 = nets[0] if nets else {}
    return {
        "network_label": net,
        "bsc_rpc_configured": bool(bsc_active),
        "bsc_rpc_env_configured": bool(bsc_env),
        "bsc_rpc_admin_enabled": bsc_admin_on,
        "bsc_rpc_masked": reg.get("bsc").label if reg and reg.get("bsc") else None,
        "deposit_enabled": bool((token or {}).get("deposit_enabled")),
        "withdraw_enabled": bool((token or {}).get("withdraw_enabled")),
        "trading_enabled": bool((token or {}).get("trading_enabled")),
        "deposit_scan_enabled": bool(net0.get("deposit_scan_enabled", True)),
        "scan_group_active": ibo_scan is not None,
        "scan_contract": (ibo_scan or {}).get("contract"),
        "user_deposit_address_count": addr_count,
        "deposit_event_count": event_count,
        "recent_deposit_events": recent,
        "wallet_api": "/api/wallet/deposit-addresses",
    }


def _public_token_fields(tok: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(tok)
    for n in out.get("networks") or []:
        if n.get("contract_encrypted"):
            n["contract_address"] = decrypt_contract(
                n.get("contract_address_enc") or "",
                encrypted=True,
            )
    return out


async def get_platform_token_overview(db) -> Dict[str, Any]:
    """Full IBO / platform-token dashboard payload for admin UI."""
    tok = await db[COL_TOKENS].find_one(
        {"is_platform_default": True},
        {"_id": 0},
    ) if db is not None else None

    env_contract = (os.getenv("IBO_CONTRACT_ADDRESS") or "").strip()
    contract = env_contract or (tok or {}).get("contract_address") or ""
    if tok:
        tok = _public_token_fields(tok)

    await _sync_rpc_admin_from_db(db)
    from services.rpc_endpoints import get_registry

    reg = get_registry()
    bsc_url = reg.http_url("bsc") if reg else None
    if not bsc_url:
        bsc_url = (os.getenv("QUICKNODE_BSC_URL") or "").strip() or None

    decimals = int((tok or {}).get("networks", [{}])[0].get("decimals") or os.getenv("IBO_TOKEN_DECIMALS", "18") or 18)
    on_chain = await read_erc20_on_chain(contract, rpc_url=bsc_url or "", decimals_hint=decimals)
    bscscan = await fetch_bscscan_token_stats(contract) if contract.startswith("0x") else {}

    max_supply_env = (os.getenv("IBO_MAX_TOTAL_SUPPLY") or "1000000000").strip()

    return {
        "ok": True,
        "symbol": (tok or {}).get("token_symbol") or os.getenv("IBO_TOKEN_SYMBOL", "IBO"),
        "seeded": tok is not None and tok.get("status") == STATUS_APPROVED,
        "env_contract_set": bool(env_contract) and env_contract != "0x" + "0" * 40,
        "env": {
            "project_name": os.getenv("IBO_PROJECT_NAME", ""),
            "token_name": os.getenv("IBO_TOKEN_NAME", ""),
            "token_symbol": os.getenv("IBO_TOKEN_SYMBOL", "IBO"),
            "blockchain_network": os.getenv("IBO_BLOCKCHAIN_NETWORK", "BEP-20 (BNB Chain)"),
            "contract_address": env_contract,
            "decimals": os.getenv("IBO_TOKEN_DECIMALS", "18"),
            "max_total_supply": max_supply_env,
            "dex_swap_link": os.getenv("IBO_DEX_SWAP_LINK", ""),
            "official_website": os.getenv("IBO_OFFICIAL_WEBSITE", ""),
            "deposit_enabled": _env_bool("IBO_DEPOSIT_ENABLED", "true"),
            "withdraw_enabled": _env_bool("IBO_WITHDRAW_ENABLED", "true"),
            "trading_enabled": _env_bool("IBO_TRADING_ENABLED", "true"),
        },
        "token": tok,
        "on_chain": on_chain,
        "bscscan": bscscan,
        "explorer": _explorer_links(contract) if contract.startswith("0x") else {},
        "deposit_rails": await _deposit_rails(db, tok),
        "env_checklist": _env_checklist(),
        "standard": "BEP-20",
        "network_display": "BNB Smart Chain (BSC)",
    }


async def reseed_platform_token(db, upload_root) -> Dict[str, Any]:
    await seed_platform_default_ibo(db, upload_root)
    await registry.refresh(db)
    return await get_platform_token_overview(db)
