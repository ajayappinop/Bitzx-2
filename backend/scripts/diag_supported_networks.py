"""One-shot diagnostic for GET /api/wallet/supported-networks.

Loads the same .env the server loads, builds the blockchain provider,
and prints every relevant value the user asked about. Deletes itself
from importance after we're done — it's purely for debugging.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

env_path = ROOT / ".env"
print(f"[diag] .env path           : {env_path}")
print(f"[diag] .env exists         : {env_path.exists()}")
loaded = load_dotenv(env_path)
print(f"[diag] load_dotenv ok      : {loaded}")

# Raw env read (exactly what get_provider() does):
print()
print("--- raw os.getenv values (after load_dotenv) ----------------------")
from services.rpc_endpoints import get_registry, mask_rpc_url  # noqa: E402

for key in (
    "BLOCKCHAIN_PROVIDER",
    "BLOCKCHAIN_MASTER_MNEMONIC",
    "BLOCKCHAIN_MASTER_PASSPHRASE",
    "USDT_ERC20_CONTRACT",
    "DEPOSIT_POLL_ETH_LOOKBACK_BLOCKS",
):
    raw = os.getenv(key)
    if raw is None:
        print(f"  {key:32s} = <UNSET>")
    else:
        shown = raw if "MNEMONIC" not in key else (raw[:12] + "…(" + str(len(raw)) + " chars)")
        print(f"  {key:32s} = {shown!r}")

print()
print("--- RPC registry (masked) -----------------------------------------")
reg = get_registry()
for c in reg.all_chains():
    print(f"  {c.chain_id:8s} scan={c.deposit_scan_enabled} http={mask_rpc_url(c.http_url)} ws={mask_rpc_url(c.ws_url)}")

# Import AFTER load_dotenv so the singleton builds with real env.
from services import blockchain_service  # noqa: E402
from services.blockchain_service import (  # noqa: E402
    _detect_chain, _ETH_CHAIN_HINTS, _BTC_CHAIN_HINTS,
    QuickNodeProvider, DisabledProvider,
)

blockchain_service.reset_provider_for_tests()
provider = blockchain_service.get_provider()

print()
print("--- provider singleton --------------------------------------------")
print(f"  type                    : {type(provider).__name__}")
print(f"  name                    : {getattr(provider, 'name', '?')}")

if isinstance(provider, QuickNodeProvider):
    print(f"  _eth_rpc_url            : {mask_rpc_url(provider._eth_rpc_url)}")
    print(f"  _btc_rpc_url            : {mask_rpc_url(provider._btc_rpc_url)}")
    print(f"  _bsc_rpc_url            : {mask_rpc_url(provider._bsc_rpc_url)}")
    print(f"  _usdt_contract          : {provider._usdt_contract!r}")
    eth_chain, eth_testnet = _detect_chain(
        provider._eth_rpc_url, _ETH_CHAIN_HINTS, "mainnet", False,
    )
    btc_chain, btc_testnet = _detect_chain(
        provider._btc_rpc_url, _BTC_CHAIN_HINTS, "mainnet", False,
    )
    print(f"  detect_chain(eth)       : chain={eth_chain!r}, testnet={eth_testnet}")
    print(f"  detect_chain(btc)       : chain={btc_chain!r}, testnet={btc_testnet}")
elif isinstance(provider, DisabledProvider):
    print("  !! DisabledProvider is active — list_supported_networks() will return [].")

print()
print("--- list_supported_networks() output ------------------------------")
nets = provider.list_supported_networks()
print(f"  count                   : {len(nets)}")
for row in nets:
    print(f"  - {row}")

print()
print("--- simulated GET /api/wallet/supported-networks response ---------")
import json
print(json.dumps(nets, indent=2))
