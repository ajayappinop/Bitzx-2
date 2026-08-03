"""Tron withdrawal broadcast + receipt polling (TRX native + USDT TRC-20)."""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

from services.blockchain_service import BlockchainError, BroadcastResult, ReceiptStatus
from services.chain_scan_tron_solana import _tron_hex_to_base58

logger = logging.getLogger(__name__)

_TRON_NETWORK = "TRC-20 (Tron)"
_SUN_PER_TRX = 1_000_000
_DEFAULT_FEE_LIMIT = 50_000_000


def tron_api_base_url(rpc_url: Optional[str]) -> Optional[str]:
    """QuickNode Tron wallet API base (strip ``/jsonrpc`` suffix)."""
    u = (rpc_url or "").strip().rstrip("/")
    if not u:
        return None
    if u.lower().endswith("/jsonrpc"):
        return u[: -len("/jsonrpc")]
    return u


def evm_address_to_tron(evm_addr: str) -> Optional[str]:
    """Convert a 0x EVM treasury address to Tron base58 (T…)."""
    h = (evm_addr or "").strip().lower().replace("0x", "")
    if len(h) != 40:
        return None
    return _tron_hex_to_base58("41" + h)


def _load_tronpy():
    try:
        from tronpy import Tron  # type: ignore
        from tronpy.keys import PrivateKey  # type: ignore
        from tronpy.providers import HTTPProvider  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise BlockchainError(f"tronpy is not installed (needed for Tron withdrawals): {exc}") from exc
    return Tron, PrivateKey, HTTPProvider


def _client_for_url(api_base: str):
    Tron, _, HTTPProvider = _load_tronpy()
    return Tron(HTTPProvider(api_base))


async def broadcast_trx(
    *,
    api_base: str,
    privkey_bytes: bytes,
    from_tron: str,
    to_tron: str,
    amount_trx: float,
) -> BroadcastResult:
    """Broadcast a native TRX transfer from the treasury hot wallet."""
    if amount_trx <= 0:
        raise BlockchainError("amount must be > 0")
    to_tron = (to_tron or "").strip()
    if to_tron == from_tron:
        raise BlockchainError("refusing to broadcast to the treasury address")

    _, PrivateKey, _ = _load_tronpy()
    pk = PrivateKey(privkey_bytes)
    client = _client_for_url(api_base)
    sun = int(round(float(amount_trx) * _SUN_PER_TRX))
    if sun <= 0:
        raise BlockchainError("TRX amount too small after conversion")

    try:
        txn = (
            client.trx.transfer(from_tron, to_tron, sun)
            .fee_limit(_DEFAULT_FEE_LIMIT)
            .build()
            .sign(pk)
        )
        result = txn.broadcast()
    except Exception as exc:  # noqa: BLE001
        raise BlockchainError(f"tron TRX broadcast failed: {exc}") from exc

    txid = ""
    if isinstance(result, dict):
        txid = str(result.get("txid") or result.get("txID") or "")
    if not txid:
        raise BlockchainError(f"tron TRX broadcast returned no txid: {result!r}")

    return BroadcastResult(
        asset="TRX",
        network=_TRON_NETWORK,
        tx_hash=txid,
        from_address=from_tron,
        to_address=to_tron,
        amount=float(amount_trx),
        raw={"chain": "tron", "kind": "native", "broadcast": result},
    )


async def broadcast_usdt_trc20(
    *,
    api_base: str,
    privkey_bytes: bytes,
    from_tron: str,
    to_tron: str,
    amount_usdt: float,
    contract_address: str,
    decimals: int = 6,
) -> BroadcastResult:
    """Broadcast a USDT TRC-20 ``transfer`` from treasury."""
    if amount_usdt <= 0:
        raise BlockchainError("amount must be > 0")
    to_tron = (to_tron or "").strip()
    if to_tron == from_tron:
        raise BlockchainError("refusing to broadcast to the treasury address")
    contract = (contract_address or "").strip()
    if not contract:
        raise BlockchainError("USDT TRC-20 contract is not configured")

    _, PrivateKey, _ = _load_tronpy()
    pk = PrivateKey(privkey_bytes)
    client = _client_for_url(api_base)
    dec = max(0, int(decimals))
    base_amount = int(round(float(amount_usdt) * (10 ** dec)))
    if base_amount <= 0:
        raise BlockchainError("USDT amount too small after conversion")

    try:
        contract_obj = client.get_contract(contract)
        txn = (
            contract_obj.functions.transfer(to_tron, base_amount)
            .with_owner(from_tron)
            .fee_limit(_DEFAULT_FEE_LIMIT)
            .build()
            .sign(pk)
        )
        result = txn.broadcast()
    except Exception as exc:  # noqa: BLE001
        raise BlockchainError(f"tron USDT TRC-20 broadcast failed: {exc}") from exc

    txid = ""
    if isinstance(result, dict):
        txid = str(result.get("txid") or result.get("txID") or "")
    if not txid:
        raise BlockchainError(f"tron USDT broadcast returned no txid: {result!r}")

    return BroadcastResult(
        asset="USDT",
        network=_TRON_NETWORK,
        tx_hash=txid,
        from_address=from_tron,
        to_address=to_tron,
        amount=float(amount_usdt),
        raw={"chain": "tron", "kind": "trc20", "contract": contract, "broadcast": result},
    )


async def poll_tron_receipt(
    *,
    api_base: str,
    tx_hash: str,
    min_confirmations: int = 1,
) -> ReceiptStatus:
    """Poll Tron tx confirmation via wallet/gettransactioninfobyid."""
    txid = (tx_hash or "").strip()
    if not txid:
        return ReceiptStatus(state="pending")

    try:
        client = _client_for_url(api_base)
        info = client.get_transaction_info(txid)
    except Exception as exc:  # noqa: BLE001
        logger.debug("tron receipt poll failed for %s: %s", txid[:16], exc)
        return ReceiptStatus(state="pending")

    if not isinstance(info, dict) or not info:
        return ReceiptStatus(state="pending")

    block_num = int(info.get("blockNumber") or 0)
    if block_num <= 0:
        return ReceiptStatus(state="pending")

    receipt_result = str(info.get("receipt", {}).get("result") or info.get("result") or "").upper()
    failed = receipt_result == "FAILED" or info.get("result") == "FAILED"
    if failed:
        return ReceiptStatus(
            state="failed",
            confirmations=0,
            block_height=block_num,
            raw={"info": info},
        )

    confirmations = 1
    try:
        latest = client.get_latest_block_number()
        if latest and block_num > 0:
            confirmations = max(1, int(latest) - block_num + 1)
    except Exception:  # noqa: BLE001
        confirmations = 1

    state = "mined" if confirmations >= max(1, min_confirmations) else "pending"
    return ReceiptStatus(
        state=state,
        confirmations=confirmations,
        block_height=block_num,
        raw={"info": info},
    )
