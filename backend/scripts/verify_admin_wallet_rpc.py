"""Verify admin-wallet RPC paths (balances + signer config). No broadcasts."""
from __future__ import annotations

import asyncio
import os
import sys

# backend root on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

from listings.wallet_assets import BEP20_NETWORK
from services import blockchain_service
from services.blockchain_service import normalise_network


def mask(addr: str | None) -> str:
    if not addr:
        return "(not set)"
    if len(addr) < 12:
        return addr
    return f"{addr[:6]}…{addr[-4:]}"


async def main() -> int:
    print("=== Admin wallet / signup bonus RPC verification ===\n")

    provider_kind = (os.getenv("BLOCKCHAIN_PROVIDER") or "disabled").strip()
    bsc_url = os.getenv("QUICKNODE_BSC_URL", "").strip()
    ibo_contract = os.getenv("IBO_CONTRACT_ADDRESS", "").strip()
    cold_set = bool(os.getenv("TREASURY_COLD_PRIVATE_KEY", "").strip())
    hot_set = bool(os.getenv("TREASURY_ETH_PRIVATE_KEY", "").strip())

    print(f"BLOCKCHAIN_PROVIDER     : {provider_kind or '(empty/disabled)'}")
    print(f"QUICKNODE_BSC_URL       : {'set' if bsc_url else 'MISSING'}")
    print(f"IBO_CONTRACT_ADDRESS    : {'set' if ibo_contract else 'MISSING'}")
    print(f"TREASURY_COLD_PRIVATE_KEY: {'set' if cold_set else 'MISSING'}")
    print(f"TREASURY_ETH_PRIVATE_KEY: {'set' if hot_set else 'MISSING'}")
    print()

    net_ibo = normalise_network("IBO", BEP20_NETWORK)
    net_bnb = normalise_network("BNB", BEP20_NETWORK)
    print(f"normalise_network IBO   : {net_ibo!r}")
    print(f"normalise_network BNB   : {net_bnb!r}")
    if net_ibo is None or net_bnb is None:
        print("FAIL: network labels not recognised — balance RPC will be skipped")
        return 1

    blockchain_service.reset_provider_for_tests()
    provider = blockchain_service.get_provider()
    print(f"Provider class          : {type(provider).__name__}")

    if type(provider).__name__ == "DisabledProvider":
        print("FAIL: provider is disabled — set BLOCKCHAIN_PROVIDER=quicknode")
        return 1

    bsc_rpc = getattr(provider, "_bsc_rpc_url", None)
    print(f"Provider BSC RPC        : {'set' if bsc_rpc else 'MISSING'}")
    print(f"Provider IBO contract   : {'set' if getattr(provider, '_ibo_contract', None) else 'MISSING'}")
    print(f"can_broadcast(IBO)      : {provider.can_broadcast('IBO')}")

    hot = provider.treasury_address("IBO")
    cold_fn = getattr(provider, "treasury_cold_address", None)
    cold = cold_fn() if callable(cold_fn) else None
    print(f"Hot signer address      : {mask(hot)}")
    print(f"Cold signer address     : {mask(cold)}")
    print()

    has_send_bonus = hasattr(provider, "send_ibo_signup_bonus")
    print(f"send_ibo_signup_bonus() : {'present' if has_send_bonus else 'MISSING'}")
    if not has_send_bonus:
        return 1

    if not bsc_rpc:
        print("FAIL: no BSC RPC on provider — cannot query balances")
        return 1

    errors = 0
    for role, addr in [("hot", hot), ("cold", cold)]:
        if not addr:
            print(f"[{role}] skip balance RPC — address not configured")
            continue
        print(f"[{role}] RPC balance check for {mask(addr)} …")
        try:
            ibo = await provider.read_deposit_address_balance_human(
                asset="IBO", network=BEP20_NETWORK, address=addr,
            )
            bnb = await provider.read_deposit_address_balance_human(
                asset="BNB", network=BEP20_NETWORK, address=addr,
            )
            if ibo is None and bnb is None:
                print(f"  FAIL: both IBO and BNB returned None (RPC may have failed)")
                errors += 1
            else:
                print(f"  OK  IBO={ibo if ibo is not None else 'None'}  BNB={bnb if bnb is not None else 'None'}")
        except Exception as exc:
            print(f"  FAIL: {exc}")
            errors += 1

    # Direct RPC ping
    print("\nDirect eth_chainId on BSC …")
    try:
        rpc = getattr(provider, "_rpc", None)
        if rpc:
            chain_id = await rpc(bsc_rpc, "eth_chainId", [])
            print(f"  OK  chainId={chain_id} (BSC mainnet=0x38)")
        else:
            print("  SKIP _rpc not accessible")
    except Exception as exc:
        print(f"  FAIL: {exc}")
        errors += 1

    print()
    if errors:
        print(f"RESULT: {errors} check(s) failed")
        return 1
    print("RESULT: RPC paths OK (balances queried via QuickNode BSC)")
    if not cold_set:
        print("WARN: TREASURY_COLD_PRIVATE_KEY unset — signup bonus will fall back to hot wallet")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
