"""Wallet asset/network validation — platform + listed tokens."""

from __future__ import annotations

from typing import Dict, List

# Mirrors server.ASSET_NETWORKS for deposit/withdraw validation.
ASSET_NETWORKS: Dict[str, List[str]] = {
    "USDT": ["BEP-20 (BNB Chain)", "ERC-20 (Ethereum)", "TRC-20 (Tron)"],
    "IBO": ["BEP-20 (BNB Chain)"],
    "BTC": ["Bitcoin Network", "BEP-20 (BNB Chain)"],
    "ETH": ["ERC-20 (Ethereum)", "BEP-20 (BNB Chain)"],
    "BNB": ["BEP-20 (BNB Chain)"],
    "TRX": ["TRC-20 (Tron)"],
    "SOL": ["Solana"],
    "XRP": ["XRP Ledger", "BEP-20 (BNB Chain)"],
    "DOGE": ["Dogecoin Network", "BEP-20 (BNB Chain)"],
    "ADA": ["Cardano", "BEP-20 (BNB Chain)"],
    "POL": ["Polygon PoS", "BEP-20 (BNB Chain)"],
    "AVAX": ["Avalanche C-Chain", "BEP-20 (BNB Chain)"],
    "DOT": ["Polkadot", "BEP-20 (BNB Chain)"],
    "LINK": ["ERC-20 (Ethereum)", "BEP-20 (BNB Chain)"],
    "LTC": ["Litecoin Network", "BEP-20 (BNB Chain)"],
}

BEP20_NETWORK = "BEP-20 (BNB Chain)"
BEP20_CANONICAL_ASSET_ORDER = ("BNB", "USDT", "ETH")


def deposit_asset_network_ok(asset: str, network: str) -> bool:
    """True if (asset, network) is allowed for deposits (platform, listed, or Web3 BEP-20)."""
    ast = (asset or "").strip().upper()
    net = (network or "").strip()
    if not ast or not net:
        return False
    if is_bep20_universal_asset(ast, net):
        return True
    try:
        from listings.registry import is_asset_network_supported

        if is_asset_network_supported(ast, net):
            return True
    except Exception:  # noqa: BLE001
        pass
    nets = ASSET_NETWORKS.get(ast)
    return bool(nets) and net in nets


def is_bep20_universal_asset(asset: str, network: str) -> bool:
    """Whether this pair uses the shared BNB Chain EVM deposit address."""
    from listings.deposit_catalog import _is_universal_bep20  # noqa: PLC0415

    return _is_universal_bep20(network, "bsc", asset)
