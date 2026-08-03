"""Tron + Solana deposit scanners for QuickNode JSON-RPC.

Tron on QuickNode exposes **Ethereum-compatible** JSON-RPC (``eth_blockNumber``,
``eth_getBlockByNumber``, ``eth_getLogs``) — not ``wallet/*`` over ``/jsonrpc``.
Solana uses standard JSON-RPC array params.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Awaitable, Dict, List, Optional, Set

def _incoming_tx(**kwargs: Any) -> Any:
    from services.blockchain_service import IncomingTx

    return IncomingTx(**kwargs)

logger = logging.getLogger(__name__)

_TRON_NETWORK = "TRC-20 (Tron)"
_SOL_NETWORK = "Solana"
_TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
_TRC20_SELECTOR = "a9059cbb"
_DEFAULT_USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"


def default_usdt_trc20_contract() -> str:
    return _DEFAULT_USDT_TRC20


_B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58decode_check(addr: str) -> Optional[bytes]:
    """Decode a base58check string (Tron / Bitcoin-style)."""
    try:
        import hashlib

        num = 0
        for ch in addr:
            num = num * 58 + _B58_ALPHABET.index(ch)
        combined = num.to_bytes((num.bit_length() + 7) // 8, "big") or b"\x00"
        pad = len(addr) - len(addr.lstrip(_B58_ALPHABET[0]))
        combined = b"\x00" * pad + combined
        if len(combined) < 5:
            return None
        payload, checksum = combined[:-4], combined[-4:]
        check = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
        if checksum != check:
            return None
        return payload
    except (ValueError, IndexError):
        return None


def _tron_address_to_hex41(addr: str) -> Optional[str]:
    raw = _b58decode_check((addr or "").strip())
    if not raw or len(raw) != 21 or raw[0] != 0x41:
        return None
    return raw.hex()


def _tron_hex_to_base58(hex41: str) -> Optional[str]:
    """Convert Tron 21-byte hex (41 + 20) to base58 address."""
    try:
        import hashlib

        h = (hex41 or "").replace("0x", "").lower()
        if len(h) == 40:
            h = "41" + h
        if len(h) != 42 or not h.startswith("41"):
            return None
        payload = bytes.fromhex(h)
        check = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
        combined = payload + check
        num = int.from_bytes(combined, "big")
        encoded = ""
        while num > 0:
            num, rem = divmod(num, 58)
            encoded = _B58_ALPHABET[rem] + encoded
        pad = sum(1 for b in payload if b == 0)
        return (_B58_ALPHABET[0] * pad) + encoded
    except (ValueError, IndexError):
        return None


def _hex_to_int(val: Any) -> int:
    if val is None:
        return 0
    if isinstance(val, int):
        return val
    s = str(val).strip()
    if s.startswith(("0x", "0X")):
        try:
            return int(s, 16)
        except ValueError:
            return 0
    try:
        return int(s)
    except ValueError:
        return 0


def _tron_match_keys(base58_addr: str) -> Set[str]:
    """Lookup keys for matching ``to`` fields from Tron eth-compatible RPC."""
    keys: Set[str] = {(base58_addr or "").strip()}
    h41 = _tron_address_to_hex41(base58_addr)
    if h41:
        keys.add(h41.lower())
        keys.add("0x" + h41[-40:].lower())
        keys.add("41" + h41[-40:].lower())
    return {k for k in keys if k}


def _decode_trc20_recipient(data_hex: str) -> Optional[str]:
    """Return base58 ``to`` from TRC-20 ``transfer`` calldata, if decodable."""
    data = (data_hex or "").replace("0x", "").lower()
    if len(data) < 136 or not data.startswith(_TRC20_SELECTOR):
        return None
    addr20 = data[32:72][-40:]
    return _tron_hex_to_base58("41" + addr20)


async def scan_tron_deposits(
    *,
    json_rpc: Callable[[str, List[Any]], Awaitable[Any]],
    trx_rows: List[Dict[str, Any]],
    usdt_rows: List[Dict[str, Any]],
    usdt_contract: str,
    lookback_blocks: int,
) -> List[Any]:
    """Scan recent Tron blocks via QuickNode eth-compatible JSON-RPC."""
    if not trx_rows and not usdt_rows:
        return []

    trx_by_addr: Dict[str, Dict[str, Any]] = {
        (r.get("address") or ""): r for r in trx_rows if r.get("address")
    }
    usdt_by_addr: Dict[str, Dict[str, Any]] = {
        (r.get("address") or ""): r for r in usdt_rows if r.get("address")
    }
    trx_lookup: Dict[str, Dict[str, Any]] = {}
    for addr, row in trx_by_addr.items():
        for key in _tron_match_keys(addr):
            trx_lookup[key] = row
    usdt_lookup: Dict[str, Dict[str, Any]] = {}
    usdt_hex20: Dict[str, str] = {}
    for addr, row in usdt_by_addr.items():
        for key in _tron_match_keys(addr):
            usdt_lookup[key] = row
        h41 = _tron_address_to_hex41(addr)
        if h41:
            usdt_hex20[h41[-40:]] = addr
    if not trx_lookup and not usdt_lookup:
        return []

    usdt_contract = (usdt_contract or _DEFAULT_USDT_TRC20).strip()
    out: List[Any] = []

    try:
        latest = _hex_to_int(await json_rpc("eth_blockNumber", []))
    except Exception as exc:  # noqa: BLE001
        logger.warning("tron scan: eth_blockNumber failed: %s", exc)
        return []
    if latest <= 0:
        return []

    from_num = max(0, latest - max(1, lookback_blocks) + 1)

    for block_num in range(from_num, latest + 1):
        try:
            block = await json_rpc(
                "eth_getBlockByNumber",
                [hex(block_num), True],
            )
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(block, dict):
            continue
        confirmations = max(1, latest - block_num + 1)

        for tx in block.get("transactions") or []:
            if not isinstance(tx, dict):
                continue
            to_raw = (tx.get("to") or "").strip().lower()
            if not to_raw:
                continue
            row = trx_lookup.get(to_raw)
            if row:
                sun = _hex_to_int(tx.get("value"))
                if sun > 0:
                    to_b58 = row.get("address") or to_raw
                    out.append(_incoming_tx(
                        asset="TRX",
                        network=row.get("network") or _TRON_NETWORK,
                        address=to_b58,
                        tx_hash=tx.get("hash") or "",
                        amount=sun / 1e6,
                        confirmations=confirmations,
                        block_height=block_num,
                        raw={"tx": tx},
                    ))

    if usdt_lookup and usdt_contract:
        contract_h41 = _tron_address_to_hex41(usdt_contract)
        if contract_h41:
            contract_field = "0x" + contract_h41[-40:]
            to_topics = [
                "0x" + k[-40:].rjust(64, "0")
                for k in usdt_hex20
            ]
            if to_topics:
                try:
                    logs = await json_rpc(
                        "eth_getLogs",
                        [{
                            "fromBlock": hex(from_num),
                            "toBlock": hex(latest),
                            "address": contract_field,
                            "topics": ["0x" + _TRANSFER_TOPIC, None, to_topics],
                        }],
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("tron scan: eth_getLogs failed: %s", exc)
                    logs = None
                if isinstance(logs, list):
                    for log in logs:
                        topics = log.get("topics") or []
                        if len(topics) < 3:
                            continue
                        to_topic = (topics[2] or "").replace("0x", "").lower()
                        to_b58 = usdt_hex20.get(to_topic[-40:])
                        if not to_b58:
                            continue
                        raw_amount = _hex_to_int(log.get("data"))
                        if raw_amount <= 0:
                            continue
                        block_num = _hex_to_int(log.get("blockNumber"))
                        conf = latest - block_num + 1 if block_num else 1
                        row = usdt_by_addr[to_b58]
                        out.append(_incoming_tx(
                            asset="USDT",
                            network=row.get("network") or _TRON_NETWORK,
                            address=to_b58,
                            tx_hash=log.get("transactionHash") or "",
                            amount=raw_amount / 1e6,
                            confirmations=max(1, conf),
                            block_height=block_num or None,
                            raw={"log": log},
                        ))

    return out


def _trc20_amount_from_data(data_hex: str) -> Optional[int]:
    data = (data_hex or "").replace("0x", "").lower()
    if len(data) < 136 or not data.startswith(_TRC20_SELECTOR):
        return None
    try:
        return int(data[72:136], 16)
    except ValueError:
        return None


async def _trc20_recipient_from_logs(
    rpc: Callable[[str, Any], Awaitable[Any]],
    tx_id: str,
    usdt_by_addr: Dict[str, Dict[str, Any]],
    usdt_hex20: Dict[str, str],
) -> Optional[str]:
    if not tx_id:
        return None
    try:
        info = await rpc("wallet/gettransactioninfobyid", {"value": tx_id, "visible": True})
    except Exception:  # noqa: BLE001
        return None
    return _parse_trc20_transfer_log(info, usdt_by_addr, usdt_hex20)


async def _trc20_amount_from_logs(
    rpc: Callable[[str, Any], Awaitable[Any]],
    tx_id: str,
    to_b58: str,
    usdt_by_addr: Dict[str, Dict[str, Any]],
) -> Optional[int]:
    if not tx_id:
        return None
    try:
        info = await rpc("wallet/gettransactioninfobyid", {"value": tx_id, "visible": True})
    except Exception:  # noqa: BLE001
        return None
    for log in (info or {}).get("log") or []:
        if not isinstance(log, dict):
            continue
        topics = log.get("topics") or []
        if len(topics) < 3:
            continue
        t0 = (topics[0] or "").replace("0x", "").lower()
        if t0 != _TRANSFER_TOPIC:
            continue
        to_topic = (topics[2] or "").replace("0x", "").lower()
        to_b58_log = _tron_hex_to_base58("41" + to_topic[-40:])
        if to_b58_log != to_b58:
            continue
        data = (log.get("data") or "").replace("0x", "")
        if len(data) >= 64:
            try:
                return int(data[:64], 16)
            except ValueError:
                pass
    return None


def _parse_trc20_transfer_log(
    info: Any,
    usdt_by_addr: Dict[str, Dict[str, Any]],
    usdt_hex20: Dict[str, str],
) -> Optional[str]:
    if not isinstance(info, dict):
        return None
    for log in info.get("log") or []:
        if not isinstance(log, dict):
            continue
        topics = log.get("topics") or []
        if len(topics) < 3:
            continue
        t0 = (topics[0] or "").replace("0x", "").lower()
        if t0 != _TRANSFER_TOPIC:
            continue
        to_topic = (topics[2] or "").replace("0x", "").lower()
        hit = usdt_hex20.get(to_topic[-40:])
        if hit:
            return hit
        to_b58 = _tron_hex_to_base58("41" + to_topic[-40:])
        if to_b58 and to_b58 in usdt_by_addr:
            return to_b58
    return None


async def scan_solana_deposits(
    *,
    rpc: Callable[[str, List[Any]], Awaitable[Any]],
    sol_rows: List[Dict[str, Any]],
    sig_limit: int,
) -> List[Any]:
    """Poll ``getSignaturesForAddress`` + ``getTransaction`` for SOL deposits."""
    if not sol_rows:
        return []
    out: List[Any] = []
    limit = max(5, min(int(sig_limit or 25), 100))
    seen: Set[str] = set()

    for row in sol_rows:
        addr = (row.get("address") or "").strip()
        if not addr:
            continue
        try:
            sigs = await rpc(
                "getSignaturesForAddress",
                [addr, {"limit": limit, "commitment": "confirmed"}],
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("solana scan: getSignaturesForAddress %s failed: %s", addr[:8], exc)
            continue
        if not isinstance(sigs, list):
            continue

        for entry in sigs:
            if not isinstance(entry, dict):
                continue
            if entry.get("err") is not None:
                continue
            sig = entry.get("signature") or ""
            if not sig or sig in seen:
                continue
            seen.add(sig)
            try:
                tx = await rpc(
                    "getTransaction",
                    [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}],
                )
            except Exception:  # noqa: BLE001
                continue
            if not tx:
                continue
            amount = _sol_incoming_lamports(tx, addr)
            if amount is None or amount <= 0:
                continue
            slot = tx.get("slot")
            conf = entry.get("confirmationStatus")
            conf_num = 1 if conf in ("confirmed", "finalized") else 0
            out.append(_incoming_tx(
                asset="SOL",
                network=row.get("network") or _SOL_NETWORK,
                address=addr,
                tx_hash=sig,
                amount=amount / 1e9,
                confirmations=max(1, conf_num),
                block_height=int(slot) if slot is not None else None,
                raw={"signature": sig},
            ))

    return out


def _sol_incoming_lamports(tx: Dict[str, Any], target: str) -> Optional[int]:
    """Return lamports received by ``target`` in this transaction, if any."""
    meta = tx.get("meta")
    if not isinstance(meta, dict) or meta.get("err") is not None:
        return None

    msg = (tx.get("transaction") or {}).get("message") or {}
    keys_raw = msg.get("accountKeys") or []
    keys: List[str] = []
    for k in keys_raw:
        if isinstance(k, str):
            keys.append(k)
        elif isinstance(k, dict) and k.get("pubkey"):
            keys.append(str(k["pubkey"]))

    try:
        idx = keys.index(target)
    except ValueError:
        return None

    pre = meta.get("preBalances") or []
    post = meta.get("postBalances") or []
    if idx >= len(pre) or idx >= len(post):
        return None
    delta = int(post[idx]) - int(pre[idx])
    return delta if delta > 0 else None
