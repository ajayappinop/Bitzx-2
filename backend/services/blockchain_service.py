"""Phase 3 — blockchain provider abstraction.

This module introduces a clean boundary between IBO business logic and the
concrete on-chain integration. ``server.py`` and the deposit poller only talk
to the abstract :class:`BlockchainProvider` interface, so swapping providers
later (QuickNode → Fireblocks, or adding networks) is a local change.

Currently implemented:

- :class:`QuickNodeProvider` — real implementation using QuickNode RPC for
  BTC (Bitcoin JSON-RPC) and ETH / ERC-20 USDT (Ethereum JSON-RPC).
- :class:`DisabledProvider` — safe no-op used when the platform is running
  without blockchain integration (all methods raise ``ProviderUnavailable``).

Security notes:

- The master BIP39 mnemonic is read from the ``BLOCKCHAIN_MASTER_MNEMONIC``
  environment variable at process start. It never leaves this module and is
  never written to the database.
- Only the derived **public** address + derivation metadata are persisted.
  Private keys are never generated eagerly — we only derive a private key
  when a withdrawal is being sent (Phase 5 responsibility), and even then
  the key is discarded immediately after signing.
- ``DisabledProvider`` keeps the rest of the backend working when the
  provider isn't configured, so accidental missing env vars don't break
  login / trading / admin flows.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from services.rpc_endpoints import (
    RpcError,
    get_registry,
    get_rpc_transport,
    mask_rpc_url,
    reload_registry as reload_rpc_registry,
)

logger = logging.getLogger(__name__)


# ── Outbound RPC throttling ──────────────────────────────────────────────────
# QuickNode's free / low-tier plans cap requests-per-second per endpoint.
# The deposit poller naturally fans out into a burst (``eth_getBlockByNumber``
# for every block in the lookback window + an ``eth_getLogs`` for USDT), which
# is enough to blow past the quota in <1 s on a modestly-sized user table.
#
# We defend against that with three layers, all tunable via env:
#
#   1. ``RPC_MAX_CONCURRENCY`` — a process-wide asyncio.Semaphore capping
#      in-flight requests so we never issue dozens of parallel calls.
#   2. ``RPC_MIN_INTERVAL_MS`` — a tiny pacing delay between calls on one
#      endpoint so bursts are spread over time instead of all hitting at once.
#   3. ``RPC_MAX_RETRIES`` — exponential back-off retry on 429, honouring
#      ``Retry-After`` when the server provides it.
#
# All three default to safe values that work on QuickNode's free Sepolia
# plan; ops can loosen them when running on a paid tier.
_RPC_MAX_CONCURRENCY = max(1, int(os.environ.get("RPC_MAX_CONCURRENCY", "2")))
_RPC_MIN_INTERVAL_MS = max(0, int(os.environ.get("RPC_MIN_INTERVAL_MS", "120")))
_RPC_MAX_RETRIES     = max(0, int(os.environ.get("RPC_MAX_RETRIES", "4")))
_RPC_BACKOFF_BASE_MS = max(100, int(os.environ.get("RPC_BACKOFF_BASE_MS", "500")))
_RPC_BACKOFF_CAP_MS  = max(1000, int(os.environ.get("RPC_BACKOFF_CAP_MS", "8000")))


# ── Supported asset/network combinations ─────────────────────────────────────
# Keep this table tight — every key here is one we can actually derive an
# address for and scan transactions on. The string values match the network
# labels already surfaced in the frontend (``ASSET_NETWORKS`` in WalletPage).
SUPPORTED_NETWORKS: Dict[str, List[str]] = {
    "BTC":  ["Bitcoin Network"],
    "ETH":  ["ERC-20 (Ethereum)", "BEP-20 (BNB Chain)"],
    "BNB":  ["BEP-20 (BNB Chain)"],
    "IBO":  ["BEP-20 (BNB Chain)"],
    "USDT": ["ERC-20 (Ethereum)", "BEP-20 (BNB Chain)", "TRC-20 (Tron)"],
    "TRX":  ["TRC-20 (Tron)"],
    "SOL":  ["Solana"],
}


# URL → chain label detection for QuickNode endpoints. The short labels
# line up with common ecosystem naming ("sepolia", "mainnet") so the UI
# can show them verbatim. Kept tiny on purpose — add more as we enable
# more networks.
_ETH_CHAIN_HINTS = (
    ("bsc-testnet", "bsc-testnet", True),
    ("binance-testnet", "bsc-testnet", True),
    ("bsc", "bsc", False),
    ("bnb", "bsc", False),
    ("binance", "bsc", False),
    ("sepolia", "sepolia",  True),
    ("goerli",  "goerli",   True),
    ("holesky", "holesky",  True),
    ("ropsten", "ropsten",  True),
    ("testnet", "testnet",  True),
    ("mainnet", "mainnet",  False),
)
_BTC_CHAIN_HINTS = (
    ("testnet", "testnet", True),
    ("signet",  "signet",  True),
    ("regtest", "regtest", True),
    ("mainnet", "mainnet", False),
)


def _detect_chain(url: Optional[str], hints: tuple, default_chain: str, default_testnet: bool) -> tuple[str, bool]:
    """Return ``(chain_label, is_testnet)`` inferred from an RPC URL."""
    if not url:
        return default_chain, default_testnet
    lo = url.lower()
    for needle, label, testnet in hints:
        if needle in lo:
            return label, testnet
    return default_chain, default_testnet


def deposit_scan_chain_enabled(chain_id: str, *, rpc_configured: bool = True) -> bool:
    """Whether the deposit poller should scan this chain.

    ETH + BSC are on by default when RPC URLs exist. BTC / Tron / Solana
    require explicit env opt-in (many QuickNode plans disable them).
    """
    if not rpc_configured:
        return False
    cid = (chain_id or "").strip().lower()
    if cid in ("eth", "bsc"):
        return True
    key = {
        "btc": "DEPOSIT_BTC_SCAN_ENABLED",
        "tron": "DEPOSIT_TRON_SCAN_ENABLED",
        "solana": "DEPOSIT_SOLANA_SCAN_ENABLED",
    }.get(cid)
    if not key:
        return False
    val = (os.getenv(key) or "").strip().lower()
    return val in ("1", "true", "yes", "on")


def normalise_network(asset: str, network: str) -> Optional[str]:
    """Return the canonical network label for ``asset`` or ``None`` if unsupported."""
    asset_u = asset.upper()
    try:
        from listings.registry import is_asset_network_supported

        if is_asset_network_supported(asset_u, network):
            return network
    except Exception:  # noqa: BLE001
        pass
    try:
        from listings.wallet_assets import BEP20_NETWORK, is_bep20_universal_asset

        if is_bep20_universal_asset(asset_u, network):
            return BEP20_NETWORK if network == BEP20_NETWORK else network
    except Exception:  # noqa: BLE001
        pass
    allowed = SUPPORTED_NETWORKS.get(asset_u)
    if not allowed:
        return None
    for net in allowed:
        if net == network:
            return net
    return None


def _evm_network_label(chain: str) -> str:
    """Canonical wallet network label for the detected EVM chain."""
    ch = (chain or "").lower()
    if "bsc" in ch or "bnb" in ch:
        return "BEP-20 (BNB Chain)"
    return "ERC-20 (Ethereum)"


# ── Errors ───────────────────────────────────────────────────────────────────
class BlockchainError(Exception):
    """Base class for blockchain-provider failures."""


class ProviderUnavailable(BlockchainError):
    """Raised by ``DisabledProvider`` or when config is missing."""


class UnsupportedAssetNetwork(BlockchainError):
    """Raised when (asset, network) isn't handled by this provider."""


# ── Value objects ────────────────────────────────────────────────────────────
@dataclass
class AddressResult:
    """Result of generating or looking up a deposit address.

    ``derivation_path`` is persisted alongside the address so withdrawals
    (Phase 5) can re-derive the exact private key from the master mnemonic
    without needing the index lookup.
    """

    uid: str
    asset: str
    network: str
    address: str
    derivation_path: str
    derivation_index: int
    provider: str = "quicknode"
    created_by: str = "system"


@dataclass
class IncomingTx:
    """A sighting of an on-chain transaction credited to one of our addresses.

    The poller writes one of these per new transaction it observes. Phase 4
    will fold these into ``deposit_requests`` and credit wallets once the
    configured ``deposit_min_confirmations`` threshold is met.
    """

    asset: str
    network: str
    address: str
    tx_hash: str
    amount: float
    confirmations: int
    block_height: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BroadcastResult:
    """Result of a withdrawal broadcast (Phase 6).

    Returned by :meth:`BlockchainProvider.send_transaction`. The executor
    persists ``tx_hash`` and ``broadcasted_at`` on the withdrawal request,
    then polls :meth:`get_transaction_receipt` until confirmations clear.
    """

    asset: str
    network: str
    tx_hash: str
    from_address: str
    to_address: str
    amount: float
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ReceiptStatus:
    """Result of a confirmation poll against a broadcasted tx (Phase 6).

    - ``state``: one of ``"pending"``, ``"mined"``, ``"failed"``.
      ``mined`` means the receipt has a non-zero ``status``; ``failed`` means
      the tx made it into a block but the EVM reverted it. ``pending`` means
      we haven't seen the tx yet (still in mempool or reorg'd out).
    - ``confirmations``: chain tip minus the inclusion block (0 when pending).
    - ``block_height``: the inclusion block when mined/failed.
    """

    state: str
    confirmations: int = 0
    block_height: Optional[int] = None
    gas_used: Optional[int] = None
    effective_gas_price: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


# ── Abstract interface ───────────────────────────────────────────────────────
class BlockchainProvider(ABC):
    """Contract every blockchain backend must satisfy."""

    name: str = "abstract"

    @abstractmethod
    async def generate_address(
        self, uid: str, asset: str, network: str, *, derivation_index: int,
    ) -> AddressResult:
        """Derive a fresh deposit address for ``uid`` at ``derivation_index``.

        The caller (``wallet_service``-adjacent code in ``server.py``) is
        responsible for allocating the sequential ``derivation_index`` via
        the ``hd_wallet_state`` counter and persisting the returned
        ``AddressResult`` to ``deposit_addresses``.
        """

    @abstractmethod
    async def get_transactions(
        self,
        *,
        addresses: List[Dict[str, Any]],
    ) -> List[IncomingTx]:
        """Return incoming transactions observed for the supplied addresses.

        ``addresses`` is a list of ``{"asset", "network", "address"}`` dicts
        (the rows from ``deposit_addresses``). Implementations must be
        idempotent — the poller deduplicates by ``(asset, network,
        tx_hash, address)`` before writing to the DB.
        """

    @abstractmethod
    async def send_transaction(
        self, asset: str, to: str, amount: float, *, network: Optional[str] = None,
    ) -> BroadcastResult:
        """Broadcast a withdrawal and return the tx hash + metadata.

        ``amount`` is in human units (1.0 ETH, 100.0 USDT). Implementations
        are responsible for converting to the on-chain base unit (wei / USDT
        6-decimal) and for sourcing the signer key from their own secure
        configuration — the caller never supplies a key.
        """

    async def get_transaction_receipt(
        self, asset: str, tx_hash: str, *, network: Optional[str] = None,
    ) -> ReceiptStatus:
        """Return the on-chain status of a previously broadcast tx.

        Default implementation returns ``pending`` so providers without
        receipt support don't block the executor — the withdrawal stays
        in ``broadcasted`` until admin marks it confirmed. Providers that
        can actually fetch receipts should override this.
        """
        return ReceiptStatus(state="pending")

    def treasury_address(self, asset: str) -> Optional[str]:
        """Return the configured treasury/hot-wallet address for ``asset``.

        Used by the admin panel to surface "fund this" addresses and by
        withdrawal validation to reject sends to the platform's own hot
        wallet. Default implementation returns ``None``.
        """
        return None

    def can_broadcast(self, asset: str, *, network: Optional[str] = None) -> bool:
        """Return ``True`` when this provider can actually sign+broadcast for ``asset``.

        Used by the withdrawal endpoint so we can reject unsupported
        assets up-front (BTC in Phase 6) instead of queueing them and
        failing later in the executor. When ``network`` is omitted, returns
        ``True`` if any supported network for the asset can broadcast.
        """
        return False

    def list_supported_networks(self) -> List[Dict[str, Any]]:
        """Return the (asset, network) pairs this provider can actually serve.

        Each entry exposes:

        - ``asset``   — canonical asset symbol (``"ETH"``, ``"USDT"``, …).
        - ``network`` — canonical network label used internally and stored
          on ``deposit_addresses`` rows (e.g. ``"ERC-20 (Ethereum)"``).
        - ``chain``   — short chain identifier (``"sepolia"``, ``"mainnet"``
          …) suitable for display in the UI.
        - ``label``   — human-friendly display string combining both.
        - ``testnet`` — ``True`` when the configured endpoint is a testnet.

        The default implementation returns ``[]`` so providers can opt-in.
        """
        return []


# ── Disabled provider (default) ──────────────────────────────────────────────
class DisabledProvider(BlockchainProvider):
    """Safe default when no blockchain integration is configured.

    Every method raises :class:`ProviderUnavailable`. The wallet endpoint
    catches this and falls back to the legacy "shared admin deposit
    address" flow so the platform keeps working.
    """

    name = "disabled"

    async def generate_address(self, uid, asset, network, *, derivation_index):  # noqa: D401
        raise ProviderUnavailable("Blockchain provider is not configured")

    async def get_transactions(self, *, addresses):  # noqa: D401
        return []

    async def send_transaction(self, asset, to, amount, *, network=None):  # noqa: D401
        raise ProviderUnavailable("Blockchain provider is not configured")

    async def get_transaction_receipt(self, asset, tx_hash, *, network=None):  # noqa: D401
        return ReceiptStatus(state="pending")

    def can_broadcast(self, asset, *, network=None):  # noqa: D401
        return False


# ── QuickNode implementation ─────────────────────────────────────────────────
# We import bip_utils / httpx lazily so a misconfigured deploy (missing deps
# or missing env vars) still boots — ``get_provider`` returns ``DisabledProvider``
# in that case and logs a clear warning.
def _load_bip_utils():  # pragma: no cover - trivial
    try:
        from bip_utils import (  # type: ignore
            Bip39SeedGenerator,
            Bip44,
            Bip44Coins,
            Bip44Changes,
            Bip84,
            Bip84Coins,
        )
    except Exception as exc:  # noqa: BLE001
        raise ProviderUnavailable(f"bip_utils is not installed: {exc}") from exc
    return {
        "Bip39SeedGenerator": Bip39SeedGenerator,
        "Bip44": Bip44,
        "Bip44Coins": Bip44Coins,
        "Bip44Changes": Bip44Changes,
        "Bip84": Bip84,
        "Bip84Coins": Bip84Coins,
    }


def _load_httpx():  # pragma: no cover - trivial
    try:
        import httpx  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise ProviderUnavailable(f"httpx is not installed: {exc}") from exc
    return httpx


def _load_eth_account():  # pragma: no cover - trivial
    """Import ``eth_account`` lazily so deploys without Phase 6 deps still boot.

    Only the withdrawal path actually needs this module; deposit-only
    deployments keep working without the extra dependency installed.
    """
    try:
        from eth_account import Account  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise ProviderUnavailable(
            f"eth-account is not installed (needed for withdrawals): {exc}"
        ) from exc
    return Account


_ETH_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_BTC_BECH32_RE = re.compile(r"^(bc1|tb1)[0-9ac-hj-np-z]{6,}$")
_BTC_LEGACY_RE = re.compile(r"^[13mn2][1-9A-HJ-NP-Za-km-z]{25,39}$")
_TRON_ADDR_RE = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")
_SOL_ADDR_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
_HEX_PRIVKEY_RE = re.compile(r"^(0x)?[0-9a-fA-F]{64}$")


def _eth_to_checksum(address: str) -> str:
    """Return the EIP-55 checksum form of ``address``.

    Accepts either a lowercase / mixed-case / already-checksummed input.
    Used before every broadcast so we never send to a garbled ``to`` field
    (most block explorers / wallets reject non-checksummed sends).
    """
    addr = (address or "").strip()
    if not _ETH_ADDR_RE.match(addr):
        raise BlockchainError(f"Not an Ethereum address: {address!r}")
    try:
        Account = _load_eth_account()
        # eth_account re-exports the eth_utils checksum helper for convenience.
        from eth_utils import to_checksum_address  # type: ignore
        return to_checksum_address(addr)
    except ProviderUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise BlockchainError(f"checksum failed for {address!r}: {exc}") from exc


def validate_address(asset: str, address: str, network: Optional[str] = None) -> str:
    """Return the canonical form of ``address`` for ``asset`` or raise.

    - Ethereum-family (ETH, USDT ERC-20): returns EIP-55 checksummed.
    - Bitcoin: returns the address unchanged after shape-check.

    Raises :class:`BlockchainError` when the address is not valid for the
    requested asset. Used at withdrawal-submit time so bad inputs never
    reach the signer.
    """
    ast = (asset or "").upper()
    addr = (address or "").strip()
    if not addr:
        raise BlockchainError("Address is empty")
    if ast in ("ETH", "USDT", "BNB", "IBO"):
        net = (network or "").strip()
        if net == "TRC-20 (Tron)":
            if _TRON_ADDR_RE.match(addr):
                return addr
            raise BlockchainError(f"Not a Tron address: {address!r}")
        return _eth_to_checksum(addr)
    if ast == "BTC":
        if _BTC_BECH32_RE.match(addr) or _BTC_LEGACY_RE.match(addr):
            return addr
        raise BlockchainError(f"Not a Bitcoin address: {address!r}")
    if ast == "TRX":
        if _TRON_ADDR_RE.match(addr):
            return addr
        raise BlockchainError(f"Not a Tron address: {address!r}")
    if ast == "SOL":
        if _SOL_ADDR_RE.match(addr):
            return addr
        raise BlockchainError(f"Not a Solana address: {address!r}")
    raise UnsupportedAssetNetwork(f"{asset} address validation is not implemented")


def _hex_to_int(hx: Optional[str]) -> int:
    if not hx:
        return 0
    try:
        return int(hx, 16)
    except (TypeError, ValueError):
        return 0


class QuickNodeProvider(BlockchainProvider):
    """Real provider backed by QuickNode RPC endpoints.

    Networks covered:

    - ``BTC / Bitcoin Network``         — BIP84 native-segwit (bc1…) addresses,
                                          deposits scanned via Bitcoin Core
                                          ``scantxoutset`` (descriptors).
    - ``ETH / ERC-20 (Ethereum)``       — BIP44 EVM addresses, deposits
                                          scanned via ``eth_getBlockByNumber``
                                          with ``includeTransactions=true``.
    - ``USDT / ERC-20 (Ethereum)``      — same EVM address; deposits scanned
                                          via ``eth_getLogs`` filtered by the
                                          USDT contract's ``Transfer`` topic.
    """

    name = "quicknode"

    # BIP44 account index — all users share account 0 with a per-user address
    # index. Keep the account fixed so existing paths remain stable forever.
    ACCOUNT_INDEX = 0

    def __init__(
        self,
        *,
        mnemonic: str,
        passphrase: str,
        btc_rpc_url: Optional[str],
        eth_rpc_url: Optional[str],
        usdt_contract: str,
        eth_lookback_blocks: int,
        treasury_eth_private_key: Optional[str] = None,
        treasury_cold_private_key: Optional[str] = None,
        bsc_rpc_url: Optional[str] = None,
        bsc_usdt_contract: Optional[str] = None,
        tron_rpc_url: Optional[str] = None,
        solana_rpc_url: Optional[str] = None,
        usdt_trc20_contract: Optional[str] = None,
        tron_lookback_blocks: int = 30,
        solana_sig_limit: int = 25,
    ) -> None:
        if not mnemonic:
            raise ProviderUnavailable("BLOCKCHAIN_MASTER_MNEMONIC is empty")

        libs = _load_bip_utils()
        seed_bytes = libs["Bip39SeedGenerator"](mnemonic).Generate(passphrase or "")

        self._seed_bytes = seed_bytes
        self._bip84 = libs["Bip84"]
        self._bip84_coins = libs["Bip84Coins"]
        self._bip44 = libs["Bip44"]
        self._bip44_coins = libs["Bip44Coins"]
        self._bip44_changes = libs["Bip44Changes"]

        self._btc_rpc_url = (btc_rpc_url or "").strip() or None
        self._eth_rpc_url = (eth_rpc_url or "").strip() or None
        self._usdt_contract = (usdt_contract or "").strip().lower()
        if self._usdt_contract and not _ETH_ADDR_RE.match(self._usdt_contract):
            raise ProviderUnavailable("Invalid USDT_ERC20_CONTRACT in environment")
        self._eth_lookback_blocks = max(1, int(eth_lookback_blocks or 20))
        try:
            self._bsc_lookback_blocks = max(
                self._eth_lookback_blocks,
                int(os.getenv("DEPOSIT_POLL_BSC_LOOKBACK_BLOCKS", "12000") or "12000"),
            )
        except ValueError:
            self._bsc_lookback_blocks = 12000
        try:
            self._startup_lookback_blocks = max(
                50,
                int(os.getenv("DEPOSIT_POLL_STARTUP_LOOKBACK_BLOCKS", "12000") or "12000"),
            )
        except ValueError:
            self._startup_lookback_blocks = 12000

        # BNB Chain / BSC — same JSON-RPC as Ethereum, different URL + USDT contract.
        # Optional: only active when QUICKNODE_BSC_URL is set.
        self._bsc_rpc_url = (bsc_rpc_url or "").strip() or None
        self._bsc_fallback_url = (
            (os.getenv("BSC_RPC_FALLBACK_URL") or "https://bsc-dataseed.binance.org/").strip() or None
        )
        self._bsc_usdt_contract = (bsc_usdt_contract or "").strip().lower() or None
        if self._bsc_usdt_contract and not _ETH_ADDR_RE.match(self._bsc_usdt_contract):
            logger.warning(
                "blockchain: invalid USDT_BEP20_CONTRACT in environment — BSC USDT scanning disabled",
            )
            self._bsc_usdt_contract = None

        self._ibo_contract = (os.getenv("IBO_CONTRACT_ADDRESS") or "").strip().lower() or None
        if self._ibo_contract and not _ETH_ADDR_RE.match(self._ibo_contract):
            logger.warning(
                "blockchain: invalid IBO_CONTRACT_ADDRESS — IBO withdrawals disabled",
            )
            self._ibo_contract = None
        try:
            self._ibo_decimals = int(os.getenv("IBO_TOKEN_DECIMALS", "18") or "18")
        except ValueError:
            self._ibo_decimals = 18

        self._tron_rpc_url = (tron_rpc_url or "").strip() or None
        self._solana_rpc_url = (solana_rpc_url or "").strip() or None
        self._usdt_trc20_contract = (usdt_trc20_contract or "").strip() or None
        if not self._usdt_trc20_contract and self._tron_rpc_url:
            from services.chain_scan_tron_solana import default_usdt_trc20_contract

            self._usdt_trc20_contract = default_usdt_trc20_contract()
        self._tron_lookback_blocks = max(1, int(tron_lookback_blocks or 30))
        self._solana_sig_limit = max(5, min(int(solana_sig_limit or 25), 100))

        # Phase 6 — treasury hot wallet. We require a SEPARATE private key
        # (not derived from the deposit mnemonic) so compromise of one does
        # not compromise the other. The key stays in process memory only;
        # it's never logged, persisted, or surfaced in API responses.
        # Treasury key problems must NEVER take down the deposit path. If the
        # key is absent, malformed, or ``eth-account`` is not installed, we
        # log a warning and leave ``_treasury_eth_addr`` unset. ``can_broadcast``
        # then returns False and ``send_transaction`` raises a clean error at
        # the moment a withdrawal is attempted — deposits keep working.
        self._treasury_eth_priv: Optional[bytes] = None
        self._treasury_eth_addr: Optional[str] = None
        self._treasury_tron_addr: Optional[str] = None
        self._treasury_cold_priv: Optional[bytes] = None
        self._treasury_cold_addr: Optional[str] = None

        def _load_signer_key(raw_key: str, label: str) -> Tuple[Optional[bytes], Optional[str]]:
            key = (raw_key or "").strip()
            if not key:
                return None, None
            if not _HEX_PRIVKEY_RE.match(key):
                logger.warning(
                    "blockchain: %s is not a 32-byte hex string — signer disabled",
                    label,
                )
                return None, None
            try:
                Account = _load_eth_account()
                acct = Account.from_key(key)
                priv = bytes.fromhex(key[2:] if key.startswith("0x") else key)
                return priv, acct.address
            except ProviderUnavailable as exc:
                logger.warning("blockchain: %s load skipped (%s)", label, exc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("blockchain: %s could not be loaded (%s)", label, exc)
            return None, None

        hot_priv, hot_addr = _load_signer_key(
            treasury_eth_private_key or "", "TREASURY_ETH_PRIVATE_KEY",
        )
        self._treasury_eth_priv = hot_priv
        self._treasury_eth_addr = hot_addr
        if hot_addr:
            try:
                from services.chain_withdraw_tron import evm_address_to_tron

                self._treasury_tron_addr = evm_address_to_tron(hot_addr)
            except Exception:  # noqa: BLE001
                self._treasury_tron_addr = None

        cold_priv, cold_addr = _load_signer_key(
            treasury_cold_private_key or os.getenv("TREASURY_COLD_PRIVATE_KEY", "").strip(),
            "TREASURY_COLD_PRIVATE_KEY",
        )
        self._treasury_cold_priv = cold_priv
        self._treasury_cold_addr = cold_addr

        # Track ETH last-scanned block in memory; a durable counter lives in
        # the ``hd_wallet_state`` collection managed by ``server.py`` so the
        # poller survives restarts without replaying the whole chain.
        self._http = None  # legacy; RPC uses services.rpc_endpoints.RpcTransport

    def refresh_rpc_urls_from_registry(self) -> None:
        """Re-read RPC URLs after admin enables/disables a chain."""
        reg = get_registry()
        self._btc_rpc_url = reg.http_url("btc")
        self._eth_rpc_url = reg.http_url("eth")
        self._bsc_rpc_url = reg.http_url("bsc")
        self._tron_rpc_url = reg.http_url("tron")
        self._solana_rpc_url = reg.http_url("solana")

    # ── public: abstract interface ───────────────────────────────────────
    async def generate_address(
        self, uid: str, asset: str, network: str, *, derivation_index: int,
    ) -> AddressResult:
        asset_u = (asset or "").upper()
        net = normalise_network(asset_u, network or "")
        if net is None:
            raise UnsupportedAssetNetwork(f"{asset}/{network} is not supported")
        if derivation_index < 0 or derivation_index > 2**31 - 1:
            raise BlockchainError(f"derivation_index out of range: {derivation_index}")

        if asset_u == "BTC":
            address, path = self._derive_btc(derivation_index)
        elif asset_u == "USDT" and net == "TRC-20 (Tron)":
            # TRC-20 needs a Tron (T…) address — not the EVM 0x address.
            address, path = self._derive_tron(derivation_index)
        elif asset_u in ("ETH", "USDT", "BNB"):
            # BNB on BSC uses the same EVM derivation path as ETH/USDT ERC-20/BEP-20.
            address, path = self._derive_eth(derivation_index)
        elif asset_u == "TRX":
            address, path = self._derive_tron(derivation_index)
        elif asset_u == "SOL":
            address, path = self._derive_solana(derivation_index)
        else:
            try:
                from listings.registry import asset_uses_evm_derivation
                from listings.wallet_assets import is_bep20_universal_asset

                if asset_uses_evm_derivation(asset_u) or is_bep20_universal_asset(
                    asset_u, net or "",
                ):
                    address, path = self._derive_eth(derivation_index)
                else:
                    raise UnsupportedAssetNetwork(f"{asset} is not supported by QuickNodeProvider")
            except UnsupportedAssetNetwork:
                raise
            except Exception as exc:
                raise UnsupportedAssetNetwork(f"{asset} is not supported by QuickNodeProvider") from exc

        return AddressResult(
            uid=uid,
            asset=asset_u,
            network=net,
            address=address,
            derivation_path=path,
            derivation_index=derivation_index,
            provider=self.name,
            created_by="system",
        )

    async def get_transactions(
        self, *, addresses: List[Dict[str, Any]],
    ) -> List[IncomingTx]:
        if not addresses:
            return []
        # Split by asset AND by network so ERC-20 and BEP-20 addresses go to
        # their respective RPC endpoints.
        btc_rows = [a for a in addresses if (a.get("asset") or "").upper() == "BTC"]

        _erc20_net = "ERC-20 (Ethereum)"
        _bep20_net = "BEP-20 (BNB Chain)"

        eth_erc20_rows  = [a for a in addresses
                           if (a.get("asset") or "").upper() == "ETH"
                           and (a.get("network") or "") != _bep20_net]
        _tron_net = "TRC-20 (Tron)"
        usdt_erc20_rows = [a for a in addresses
                           if (a.get("asset") or "").upper() == "USDT"
                           and (a.get("network") or "") not in (_bep20_net, _tron_net)]

        bnb_bep20_rows  = [a for a in addresses
                           if (a.get("asset") or "").upper() in ("BNB", "ETH")
                           and (a.get("network") or "") == _bep20_net]
        usdt_bep20_rows = [a for a in addresses
                           if (a.get("asset") or "").upper() == "USDT"
                           and (a.get("network") or "") == _bep20_net]
        trx_rows = [a for a in addresses if (a.get("asset") or "").upper() == "TRX"]
        usdt_trc_rows = [
            a for a in addresses
            if (a.get("asset") or "").upper() == "USDT"
            and (a.get("network") or "") == _tron_net
        ]
        sol_rows = [a for a in addresses if (a.get("asset") or "").upper() == "SOL"]

        results: List[IncomingTx] = []
        try:
            if btc_rows and deposit_scan_chain_enabled("btc", rpc_configured=bool(self._btc_rpc_url)):
                results.extend(await self._scan_btc(btc_rows))
        except BlockchainError as exc:
            logger.warning("QuickNodeProvider: BTC scan failed: %s", exc)
        except Exception:  # noqa: BLE001
            logger.exception("QuickNodeProvider: BTC scan failed")

        # ── Ethereum (ERC-20) ─────────────────────────────────────────────
        try:
            if eth_erc20_rows or usdt_erc20_rows:
                results.extend(
                    await self._scan_eth(
                        eth_erc20_rows, usdt_erc20_rows,
                        lookback_blocks=self._eth_lookback_blocks,
                    )
                )
        except BlockchainError as exc:
            logger.warning("QuickNodeProvider: ETH scan failed: %s", exc)
        except Exception:  # noqa: BLE001
            logger.exception("QuickNodeProvider: ETH scan failed")

        # ── BNB Chain / BSC (BEP-20) ─────────────────────────────────────
        if self._bsc_rpc_url and (bnb_bep20_rows or usdt_bep20_rows):
            try:
                results.extend(
                    await self._scan_bsc(
                        bnb_bep20_rows, usdt_bep20_rows,
                        lookback_blocks=self._bsc_lookback_blocks,
                    )
                )
            except BlockchainError as exc:
                logger.warning("QuickNodeProvider: BSC scan failed: %s", exc)
            except Exception:  # noqa: BLE001
                logger.exception("QuickNodeProvider: BSC scan failed")

        if (
            self._tron_rpc_url
            and (trx_rows or usdt_trc_rows)
            and deposit_scan_chain_enabled("tron", rpc_configured=True)
        ):
            try:
                results.extend(await self._scan_tron(trx_rows, usdt_trc_rows))
            except BlockchainError as exc:
                logger.warning("QuickNodeProvider: Tron scan failed: %s", exc)
            except Exception:  # noqa: BLE001
                logger.exception("QuickNodeProvider: Tron scan failed")

        if self._solana_rpc_url and sol_rows and deposit_scan_chain_enabled("solana", rpc_configured=True):
            try:
                results.extend(await self._scan_solana(sol_rows))
            except BlockchainError as exc:
                logger.warning("QuickNodeProvider: Solana scan failed: %s", exc)
            except Exception:  # noqa: BLE001
                logger.exception("QuickNodeProvider: Solana scan failed")

        # Listed tokens (IBO, etc.) — REST lookback; WS path uses per-block scan.
        try:
            from listings.registry import get_scan_groups

            _bep20_net = "BEP-20 (BNB Chain)"
            _erc20_net = "ERC-20 (Ethereum)"
            for grp in get_scan_groups():
                asset_sym = (grp.get("asset") or "").upper()
                net_label = grp.get("network_label") or ""
                chain = (grp.get("chain_id") or "").lower()
                dyn_rows = [
                    a for a in addresses
                    if (a.get("asset") or "").upper() == asset_sym
                    and (a.get("network") or "") == net_label
                ]
                if not dyn_rows or asset_sym in ("USDT", "ETH", "BNB"):
                    continue
                if chain == "eth" and self._eth_rpc_url:
                    results.extend(await self.scan_erc20_transfers_lookback(
                        dyn_rows,
                        contract=grp["contract"],
                        network_label=net_label,
                        decimals=int(grp.get("decimals") or 18),
                        rpc_url=self._eth_rpc_url,
                        lookback_blocks=self._eth_lookback_blocks,
                    ))
                elif chain == "bsc" and self._bsc_rpc_url:
                    results.extend(await self.scan_erc20_transfers_lookback(
                        dyn_rows,
                        contract=grp["contract"],
                        network_label=net_label,
                        decimals=int(grp.get("decimals") or 18),
                        rpc_url=self._bsc_rpc_url,
                        lookback_blocks=self._bsc_lookback_blocks,
                    ))
        except Exception:  # noqa: BLE001
            logger.exception("QuickNodeProvider: listed-token REST scan failed")

        return results

    async def scan_deposits_lookback(
        self, *, addresses: List[Dict[str, Any]], lookback_blocks: Optional[int] = None,
    ) -> List[IncomingTx]:
        """Deep lookback scan for startup / admin rescan (all live chains).

        Uses ``DEPOSIT_POLL_STARTUP_LOOKBACK_BLOCKS`` (default 12k) for EVM
        log-based assets. Native ETH block walks are capped separately to
        avoid thousands of ``eth_getBlockByNumber`` calls.
        """
        if not addresses:
            return []
        lb = max(50, int(lookback_blocks or self._startup_lookback_blocks))
        btc_rows = [a for a in addresses if (a.get("asset") or "").upper() == "BTC"]
        _erc20_net = "ERC-20 (Ethereum)"
        _bep20_net = "BEP-20 (BNB Chain)"
        _tron_net = "TRC-20 (Tron)"
        eth_erc20_rows = [
            a for a in addresses
            if (a.get("asset") or "").upper() == "ETH"
            and (a.get("network") or "") != _bep20_net
        ]
        usdt_erc20_rows = [
            a for a in addresses
            if (a.get("asset") or "").upper() == "USDT"
            and (a.get("network") or "") not in (_bep20_net, _tron_net)
        ]
        bnb_bep20_rows = [
            a for a in addresses
            if (a.get("asset") or "").upper() in ("BNB", "ETH")
            and (a.get("network") or "") == _bep20_net
        ]
        usdt_bep20_rows = [
            a for a in addresses
            if (a.get("asset") or "").upper() == "USDT"
            and (a.get("network") or "") == _bep20_net
        ]
        trx_rows = [a for a in addresses if (a.get("asset") or "").upper() == "TRX"]
        usdt_trc_rows = [
            a for a in addresses
            if (a.get("asset") or "").upper() == "USDT"
            and (a.get("network") or "") == _tron_net
        ]
        sol_rows = [a for a in addresses if (a.get("asset") or "").upper() == "SOL"]

        results: List[IncomingTx] = []
        try:
            if btc_rows and deposit_scan_chain_enabled("btc", rpc_configured=bool(self._btc_rpc_url)):
                results.extend(await self._scan_btc(btc_rows))
        except Exception:  # noqa: BLE001
            logger.exception("scan_deposits_lookback: BTC failed")
        try:
            if eth_erc20_rows or usdt_erc20_rows:
                results.extend(
                    await self._scan_eth(eth_erc20_rows, usdt_erc20_rows, lookback_blocks=lb),
                )
        except Exception:  # noqa: BLE001
            logger.exception("scan_deposits_lookback: ETH failed")
        try:
            if self._bsc_rpc_url and (bnb_bep20_rows or usdt_bep20_rows):
                results.extend(
                    await self._scan_bsc(
                        bnb_bep20_rows, usdt_bep20_rows, lookback_blocks=lb,
                    ),
                )
        except Exception:  # noqa: BLE001
            logger.exception("scan_deposits_lookback: BSC failed")
        try:
            from listings.registry import get_scan_groups

            for grp in get_scan_groups():
                asset_sym = (grp.get("asset") or "").upper()
                net_label = grp.get("network_label") or ""
                chain = (grp.get("chain_id") or "").lower()
                dyn_rows = [
                    a for a in addresses
                    if (a.get("asset") or "").upper() == asset_sym
                    and (a.get("network") or "") == net_label
                ]
                if not dyn_rows or asset_sym in ("USDT", "ETH", "BNB"):
                    continue
                if chain == "eth" and self._eth_rpc_url:
                    results.extend(await self.scan_erc20_transfers_lookback(
                        dyn_rows,
                        contract=grp["contract"],
                        network_label=net_label,
                        decimals=int(grp.get("decimals") or 18),
                        rpc_url=self._eth_rpc_url,
                        lookback_blocks=lb,
                    ))
                elif chain == "bsc" and self._bsc_rpc_url:
                    results.extend(await self.scan_erc20_transfers_lookback(
                        dyn_rows,
                        contract=grp["contract"],
                        network_label=net_label,
                        decimals=int(grp.get("decimals") or 18),
                        rpc_url=self._bsc_rpc_url,
                        lookback_blocks=lb,
                    ))
        except Exception:  # noqa: BLE001
            logger.exception("scan_deposits_lookback: listed tokens failed")
        try:
            if (
                self._tron_rpc_url
                and (trx_rows or usdt_trc_rows)
                and deposit_scan_chain_enabled("tron", rpc_configured=True)
            ):
                results.extend(await self._scan_tron(trx_rows, usdt_trc_rows))
        except Exception:  # noqa: BLE001
            logger.exception("scan_deposits_lookback: Tron failed")
        try:
            if (
                self._solana_rpc_url
                and sol_rows
                and deposit_scan_chain_enabled("solana", rpc_configured=True)
            ):
                results.extend(await self._scan_solana(sol_rows))
        except Exception:  # noqa: BLE001
            logger.exception("scan_deposits_lookback: Solana failed")
        return results

    async def send_transaction(
        self, asset: str, to: str, amount: float, *, network: Optional[str] = None,
    ) -> BroadcastResult:
        """Sign and broadcast a withdrawal on the requested network rail."""
        ast = (asset or "").upper()
        net = normalise_network(ast, network or "")
        if net is None:
            raise UnsupportedAssetNetwork(f"{asset}/{network} is not supported for withdrawal")

        if ast == "IBO":
            if net != "BEP-20 (BNB Chain)":
                raise UnsupportedAssetNetwork(f"IBO withdrawal only supported on BEP-20 (BNB Chain)")
            return await self._send_ibo_bep20(to, amount)

        if net == "BEP-20 (BNB Chain)":
            if ast == "BNB":
                return await self._send_bnb_bep20(to, amount)
            if ast == "USDT":
                return await self._send_bsc_erc20(
                    to, amount,
                    contract=self._bsc_usdt_contract or "",
                    decimals=18,
                    asset="USDT",
                    network=net,
                )
            raise UnsupportedAssetNetwork(f"{asset} on {net} is not supported for withdrawal")

        if net == "ERC-20 (Ethereum)":
            return await self._send_eth_chain_withdrawal(ast, to, amount, network=net)

        if net == "TRC-20 (Tron)":
            if ast == "TRX":
                return await self._send_trx_trc20(to, amount)
            if ast == "USDT":
                return await self._send_usdt_trc20(to, amount)
            raise UnsupportedAssetNetwork(f"{asset} on {net} is not supported for withdrawal")

        raise UnsupportedAssetNetwork(f"{asset}/{network} is not supported for withdrawal")

    async def _send_eth_chain_withdrawal(
        self, asset: str, to: str, amount: float, *, network: str,
    ) -> BroadcastResult:
        """Phase 6 — sign and broadcast a withdrawal on Ethereum / ERC-20.

        BTC is intentionally out of scope (see ``can_broadcast``). Behaviour:

        - ETH: builds an EIP-1559 tx paying ``amount`` wei from the treasury
          to ``to``. Gas limit is fixed at 21,000 (plain transfer).
        - USDT: builds an EIP-1559 tx calling ``transfer(to, amount*1e6)``
          on the USDT contract from the treasury. Gas limit is estimated
          via ``eth_estimateGas`` with a 20% safety buffer.

        On any broadcast failure we raise ``BlockchainError``. The caller
        (withdrawal executor) is responsible for atomically flipping the
        request back to a retryable state.
        """
        ast = (asset or "").upper()
        if ast not in ("ETH", "USDT"):
            raise UnsupportedAssetNetwork(
                f"{asset} broadcast is not supported on {network}",
            )
        if not self._eth_rpc_url:
            raise ProviderUnavailable("QUICKNODE_ETH_URL is not configured")
        if self._treasury_eth_priv is None or self._treasury_eth_addr is None:
            raise ProviderUnavailable(
                "TREASURY_ETH_PRIVATE_KEY is not configured — cannot broadcast withdrawals",
            )
        if ast == "USDT" and not self._usdt_contract:
            raise ProviderUnavailable("USDT_ERC20_CONTRACT is not configured")
        if amount is None or float(amount) <= 0:
            raise BlockchainError("amount must be > 0")

        to_checksum = _eth_to_checksum(to)
        # Never broadcast back to the treasury itself.
        if to_checksum.lower() == self._treasury_eth_addr.lower():
            raise BlockchainError("refusing to broadcast to the treasury address")

        Account = _load_eth_account()
        from_addr = self._treasury_eth_addr

        # Chain id + nonce + fee fields. ``pending`` nonce so multiple
        # withdrawals in a single tick don't collide on mempool-duplicates.
        chain_id = _hex_to_int(await self._rpc(self._eth_rpc_url, "eth_chainId", []))
        nonce    = _hex_to_int(await self._rpc(
            self._eth_rpc_url, "eth_getTransactionCount", [from_addr, "pending"],
        ))
        base_fee, prio_fee = await self._eth_fee_fields(self._eth_rpc_url)

        if ast == "ETH":
            value_wei = int(round(float(amount) * 1e18))
            data_hex = "0x"
            to_field = to_checksum
            gas_limit = 21_000
        else:  # USDT
            decimals = 6  # USDT ERC-20 is 6 decimals
            value_wei = 0
            amount_base = int(round(float(amount) * (10 ** decimals)))
            data_hex = self._erc20_transfer_data(to_checksum, amount_base)
            to_field = _eth_to_checksum(self._usdt_contract)
            # Estimate gas with a 20% buffer; fall back to 120k if the
            # node rejects the estimate (common on some testnets).
            try:
                est_hex = await self._rpc(
                    self._eth_rpc_url,
                    "eth_estimateGas",
                    [{
                        "from": from_addr,
                        "to": to_field,
                        "data": data_hex,
                    }],
                )
                estimated = _hex_to_int(est_hex) or 60_000
                gas_limit = int(estimated * 1.2)
            except BlockchainError:
                gas_limit = 120_000

        tx = {
            "chainId": chain_id,
            "nonce": nonce,
            "to": to_field,
            "value": value_wei,
            "gas": gas_limit,
            "maxFeePerGas": base_fee * 2 + prio_fee,
            "maxPriorityFeePerGas": prio_fee,
            "data": data_hex,
            "type": 2,
        }
        try:
            signed = Account.sign_transaction(tx, self._treasury_eth_priv)
        except Exception as exc:  # noqa: BLE001
            raise BlockchainError(f"tx signing failed: {exc}") from exc

        raw_hex = signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()
        if not raw_hex.startswith("0x"):
            raw_hex = "0x" + raw_hex
        tx_hash = await self._rpc(self._eth_rpc_url, "eth_sendRawTransaction", [raw_hex])
        if not isinstance(tx_hash, str) or not tx_hash.startswith("0x"):
            raise BlockchainError(f"eth_sendRawTransaction returned unexpected value: {tx_hash!r}")

        return BroadcastResult(
            asset=ast,
            network=network,
            tx_hash=tx_hash,
            from_address=from_addr,
            to_address=to_checksum,
            amount=float(amount),
            raw={
                "chain_id": chain_id,
                "nonce": nonce,
                "gas_limit": gas_limit,
                "base_fee_wei": base_fee,
                "priority_fee_wei": prio_fee,
            },
        )

    async def _send_bnb_bep20(self, to: str, amount: float) -> BroadcastResult:
        """Native BNB transfer on BSC from the treasury hot wallet."""
        if not self._bsc_rpc_url:
            raise ProviderUnavailable("QUICKNODE_BSC_URL is not configured")
        if self._treasury_eth_priv is None or self._treasury_eth_addr is None:
            raise ProviderUnavailable("Treasury signer is not configured for BNB withdrawal")
        if amount is None or float(amount) <= 0:
            raise BlockchainError("amount must be > 0")

        to_checksum = _eth_to_checksum(to)
        from_addr = self._treasury_eth_addr
        if to_checksum.lower() == from_addr.lower():
            raise BlockchainError("refusing to broadcast to the treasury address")

        Account = _load_eth_account()
        chain_id = _hex_to_int(await self._rpc_bsc("eth_chainId", []))
        nonce = _hex_to_int(await self._rpc_bsc(
            "eth_getTransactionCount", [from_addr, "pending"],
        ))
        base_fee, prio_fee = await self._eth_fee_fields(use_bsc=True)
        value_wei = int(round(float(amount) * 1e18))

        tx = {
            "chainId": chain_id,
            "nonce": nonce,
            "to": to_checksum,
            "value": value_wei,
            "gas": 21_000,
            "maxFeePerGas": base_fee * 2 + prio_fee,
            "maxPriorityFeePerGas": prio_fee,
            "data": "0x",
            "type": 2,
        }
        try:
            signed = Account.sign_transaction(tx, self._treasury_eth_priv)
        except Exception as exc:  # noqa: BLE001
            raise BlockchainError(f"tx signing failed: {exc}") from exc

        raw_hex = signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()
        if not raw_hex.startswith("0x"):
            raw_hex = "0x" + raw_hex
        try:
            tx_hash = await self._rpc_bsc("eth_sendRawTransaction", [raw_hex])
        except BlockchainError as exc:
            raise BlockchainError(f"broadcast rejected: {exc}") from exc
        if not isinstance(tx_hash, str) or not tx_hash.startswith("0x"):
            raise BlockchainError(f"unexpected sendRawTransaction response: {tx_hash!r}")

        return BroadcastResult(
            asset="BNB",
            network="BEP-20 (BNB Chain)",
            tx_hash=tx_hash,
            from_address=from_addr,
            to_address=to_checksum,
            amount=float(amount),
            raw={"chain": "bsc", "kind": "native"},
        )

    async def _send_bsc_erc20(
        self,
        to: str,
        amount: float,
        *,
        contract: str,
        decimals: int,
        asset: str,
        network: str,
    ) -> BroadcastResult:
        """BEP-20 token transfer on BSC (USDT, etc.) from treasury."""
        if not self._bsc_rpc_url:
            raise ProviderUnavailable("QUICKNODE_BSC_URL is not configured")
        if not contract:
            raise ProviderUnavailable(f"{asset} BEP-20 contract is not configured")
        if self._treasury_eth_priv is None or self._treasury_eth_addr is None:
            raise ProviderUnavailable("Treasury signer is not configured")
        if amount is None or float(amount) <= 0:
            raise BlockchainError("amount must be > 0")

        to_checksum = _eth_to_checksum(to)
        from_addr = self._treasury_eth_addr
        if to_checksum.lower() == from_addr.lower():
            raise BlockchainError("refusing to broadcast to the treasury address")

        Account = _load_eth_account()
        chain_id = _hex_to_int(await self._rpc_bsc("eth_chainId", []))
        nonce = _hex_to_int(await self._rpc_bsc(
            "eth_getTransactionCount", [from_addr, "pending"],
        ))
        base_fee, prio_fee = await self._eth_fee_fields(use_bsc=True)
        dec = max(0, int(decimals))
        amount_base = int(round(float(amount) * (10 ** dec)))
        data_hex = self._erc20_transfer_data(to_checksum, amount_base)
        to_field = _eth_to_checksum(contract)

        try:
            est_hex = await self._rpc_bsc(
                "eth_estimateGas",
                [{"from": from_addr, "to": to_field, "data": data_hex}],
            )
            estimated = _hex_to_int(est_hex) or 60_000
            gas_limit = int(estimated * 1.2)
        except BlockchainError:
            gas_limit = 120_000

        tx = {
            "chainId": chain_id,
            "nonce": nonce,
            "to": to_field,
            "value": 0,
            "gas": gas_limit,
            "maxFeePerGas": base_fee * 2 + prio_fee,
            "maxPriorityFeePerGas": prio_fee,
            "data": data_hex,
            "type": 2,
        }
        try:
            signed = Account.sign_transaction(tx, self._treasury_eth_priv)
        except Exception as exc:  # noqa: BLE001
            raise BlockchainError(f"tx signing failed: {exc}") from exc

        raw_hex = signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()
        if not raw_hex.startswith("0x"):
            raw_hex = "0x" + raw_hex
        try:
            tx_hash = await self._rpc_bsc("eth_sendRawTransaction", [raw_hex])
        except BlockchainError as exc:
            raise BlockchainError(f"broadcast rejected: {exc}") from exc
        if not isinstance(tx_hash, str) or not tx_hash.startswith("0x"):
            raise BlockchainError(f"unexpected sendRawTransaction response: {tx_hash!r}")

        return BroadcastResult(
            asset=asset.upper(),
            network=network,
            tx_hash=tx_hash,
            from_address=from_addr,
            to_address=to_checksum,
            amount=float(amount),
            raw={"chain": "bsc", "kind": "bep20", "contract": contract},
        )

    async def _send_trx_trc20(self, to: str, amount: float) -> BroadcastResult:
        from services.chain_withdraw_tron import broadcast_trx, tron_api_base_url

        api_base = tron_api_base_url(self._tron_rpc_url)
        if not api_base:
            raise ProviderUnavailable("QUICKNODE_TRON_URL is not configured")
        if self._treasury_eth_priv is None or not self._treasury_tron_addr:
            raise ProviderUnavailable("Treasury signer is not configured for Tron withdrawals")
        return await broadcast_trx(
            api_base=api_base,
            privkey_bytes=self._treasury_eth_priv,
            from_tron=self._treasury_tron_addr,
            to_tron=to,
            amount_trx=float(amount),
        )

    async def _send_usdt_trc20(self, to: str, amount: float) -> BroadcastResult:
        from services.chain_withdraw_tron import broadcast_usdt_trc20, tron_api_base_url

        api_base = tron_api_base_url(self._tron_rpc_url)
        if not api_base:
            raise ProviderUnavailable("QUICKNODE_TRON_URL is not configured")
        if self._treasury_eth_priv is None or not self._treasury_tron_addr:
            raise ProviderUnavailable("Treasury signer is not configured for Tron withdrawals")
        if not self._usdt_trc20_contract:
            raise ProviderUnavailable("USDT TRC-20 contract is not configured")
        return await broadcast_usdt_trc20(
            api_base=api_base,
            privkey_bytes=self._treasury_eth_priv,
            from_tron=self._treasury_tron_addr,
            to_tron=to,
            amount_usdt=float(amount),
            contract_address=self._usdt_trc20_contract,
            decimals=6,
        )

    async def send_ibo_signup_bonus(self, to: str, amount: float) -> BroadcastResult:
        """Send IBO from the cold treasury wallet (signup bonus). Falls back to hot if cold unset."""
        if self._treasury_cold_priv and self._treasury_cold_addr:
            return await self._send_ibo_bep20(
                to,
                amount,
                from_priv=self._treasury_cold_priv,
                from_addr=self._treasury_cold_addr,
                wallet_role="cold",
            )
        if self._treasury_eth_priv and self._treasury_eth_addr:
            logger.warning(
                "blockchain: TREASURY_COLD_PRIVATE_KEY not set — signup bonus sent from hot wallet",
            )
            return await self._send_ibo_bep20(
                to,
                amount,
                from_priv=self._treasury_eth_priv,
                from_addr=self._treasury_eth_addr,
                wallet_role="hot",
            )
        raise ProviderUnavailable(
            "TREASURY_COLD_PRIVATE_KEY (or hot fallback) is not configured for IBO signup bonus",
        )

    async def _send_ibo_bep20(
        self,
        to: str,
        amount: float,
        *,
        from_priv: Optional[bytes] = None,
        from_addr: Optional[str] = None,
        wallet_role: str = "hot",
    ) -> BroadcastResult:
        """Sign and broadcast a IBO BEP-20 transfer from the treasury hot wallet on BSC."""
        if not self._bsc_rpc_url:
            raise ProviderUnavailable("QUICKNODE_BSC_URL is not configured")
        if not self._ibo_contract:
            raise ProviderUnavailable("IBO_CONTRACT_ADDRESS is not configured")
        signer_priv = from_priv or self._treasury_eth_priv
        from_addr = from_addr or self._treasury_eth_addr
        if signer_priv is None or from_addr is None:
            raise ProviderUnavailable("Treasury signer is not configured for IBO transfer")
        if amount is None or float(amount) <= 0:
            raise BlockchainError("amount must be > 0")

        to_checksum = _eth_to_checksum(to)
        if to_checksum.lower() == from_addr.lower():
            raise BlockchainError("refusing to broadcast to the treasury address")

        Account = _load_eth_account()

        chain_id = _hex_to_int(await self._rpc_bsc("eth_chainId", []))
        nonce = _hex_to_int(await self._rpc_bsc(
            "eth_getTransactionCount", [from_addr, "pending"],
        ))
        base_fee, prio_fee = await self._eth_fee_fields(use_bsc=True)

        decimals = max(0, int(self._ibo_decimals))
        amount_base = int(round(float(amount) * (10 ** decimals)))
        data_hex = self._erc20_transfer_data(to_checksum, amount_base)
        to_field = _eth_to_checksum(self._ibo_contract)

        try:
            est_hex = await self._rpc_bsc(
                "eth_estimateGas",
                [{"from": from_addr, "to": to_field, "data": data_hex}],
            )
            estimated = _hex_to_int(est_hex) or 60_000
            gas_limit = int(estimated * 1.2)
        except BlockchainError:
            gas_limit = 120_000

        tx = {
            "chainId": chain_id,
            "nonce": nonce,
            "to": to_field,
            "value": 0,
            "gas": gas_limit,
            "maxFeePerGas": base_fee * 2 + prio_fee,
            "maxPriorityFeePerGas": prio_fee,
            "data": data_hex,
            "type": 2,
        }
        try:
            signed = Account.sign_transaction(tx, signer_priv)
        except Exception as exc:  # noqa: BLE001
            raise BlockchainError(f"tx signing failed: {exc}") from exc

        raw_hex = signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()
        if not raw_hex.startswith("0x"):
            raw_hex = "0x" + raw_hex

        try:
            tx_hash = await self._rpc_bsc("eth_sendRawTransaction", [raw_hex])
        except BlockchainError as exc:
            raise BlockchainError(f"broadcast rejected: {exc}") from exc
        if not isinstance(tx_hash, str) or not tx_hash.startswith("0x"):
            raise BlockchainError(f"unexpected sendRawTransaction response: {tx_hash!r}")

        return BroadcastResult(
            asset="IBO",
            network="BEP-20 (BNB Chain)",
            tx_hash=tx_hash,
            from_address=from_addr,
            to_address=to_checksum,
            amount=float(amount),
            raw={
                "chain": "bsc",
                "wallet_role": wallet_role,
                "contract": self._ibo_contract,
                "base_fee_wei": base_fee,
                "priority_fee_wei": prio_fee,
            },
        )

    async def get_transaction_receipt(
        self, asset: str, tx_hash: str, *, network: Optional[str] = None,
    ) -> ReceiptStatus:
        """Poll QuickNode for a receipt and translate to :class:`ReceiptStatus`."""
        ast = (asset or "").upper()
        net = normalise_network(ast, network or "") or (network or "").strip()

        if net == "TRC-20 (Tron)" or ast == "TRX":
            from services.chain_withdraw_tron import poll_tron_receipt, tron_api_base_url

            api_base = tron_api_base_url(self._tron_rpc_url)
            if not api_base:
                return ReceiptStatus(state="pending")
            return await poll_tron_receipt(api_base=api_base, tx_hash=tx_hash)

        rpc_url = None
        if net == "BEP-20 (BNB Chain)" or ast == "IBO":
            rpc_url = self._bsc_rpc_url
        elif net == "ERC-20 (Ethereum)" or ast in ("ETH", "USDT"):
            rpc_url = self._eth_rpc_url
        if not rpc_url:
            return ReceiptStatus(state="pending")
        if not (tx_hash or "").startswith("0x"):
            return ReceiptStatus(state="pending")

        receipt = await self._rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
        if not isinstance(receipt, dict):
            return ReceiptStatus(state="pending")

        block_num = _hex_to_int(receipt.get("blockNumber"))
        if block_num <= 0:
            return ReceiptStatus(state="pending")

        latest = _hex_to_int(await self._rpc(rpc_url, "eth_blockNumber", []))
        confirmations = max(0, latest - block_num + 1) if latest else 0
        status_raw = receipt.get("status")
        # Post-Byzantium receipts carry a 1/0 status. 1 = success.
        mined_ok = False
        if isinstance(status_raw, str):
            mined_ok = _hex_to_int(status_raw) == 1
        elif isinstance(status_raw, int):
            mined_ok = status_raw == 1
        state = "mined" if mined_ok else "failed"

        return ReceiptStatus(
            state=state,
            confirmations=int(confirmations),
            block_height=block_num,
            gas_used=_hex_to_int(receipt.get("gasUsed")) or None,
            effective_gas_price=_hex_to_int(receipt.get("effectiveGasPrice")) or None,
            raw={"receipt": receipt},
        )

    def _treasury_evm_ready(self) -> bool:
        return self._treasury_eth_priv is not None and self._treasury_eth_addr is not None

    def _treasury_tron_ready(self) -> bool:
        return self._treasury_evm_ready() and bool(self._treasury_tron_addr)

    def _can_broadcast_pair(self, asset: str, network: str) -> bool:
        ast = (asset or "").upper()
        net = normalise_network(ast, network or "") or (network or "").strip()
        if not net:
            return False
        if not self._treasury_evm_ready() and not self._treasury_tron_ready():
            return False
        if net == "BEP-20 (BNB Chain)":
            if not self._bsc_rpc_url or not self._treasury_evm_ready():
                return False
            if ast == "BNB":
                return True
            if ast == "USDT":
                return bool(self._bsc_usdt_contract)
            if ast == "IBO":
                return bool(self._ibo_contract)
            return False
        if net == "ERC-20 (Ethereum)":
            if not self._eth_rpc_url or not self._treasury_evm_ready():
                return False
            if ast == "ETH":
                return True
            if ast == "USDT":
                return bool(self._usdt_contract)
            return False
        if net == "TRC-20 (Tron)":
            if not self._tron_rpc_url or not self._treasury_tron_ready():
                return False
            if ast == "TRX":
                return True
            if ast == "USDT":
                return bool(self._usdt_trc20_contract)
            return False
        return False

    def treasury_address(self, asset: str) -> Optional[str]:
        ast = (asset or "").upper()
        if ast in ("ETH", "USDT", "IBO", "BNB"):
            return self._treasury_eth_addr
        return None

    def treasury_tron_address(self) -> Optional[str]:
        """Treasury hot wallet in Tron base58 (T…) — same key as EVM treasury."""
        return self._treasury_tron_addr

    def treasury_cold_address(self) -> Optional[str]:
        """On-chain cold treasury signer (IBO signup bonus source on BSC)."""
        return self._treasury_cold_addr

    def can_broadcast(self, asset: str, *, network: Optional[str] = None) -> bool:
        ast = (asset or "").upper()
        if network:
            net = normalise_network(ast, network) or network
            return self._can_broadcast_pair(ast, net or "")
        for net in SUPPORTED_NETWORKS.get(ast, []):
            if self._can_broadcast_pair(ast, net):
                return True
        return False

    def _eth_deposit_privkey_bytes(self, derivation_index: int) -> bytes:
        """Re-derive the secp256k1 private key for the ETH deposit HD slot ``derivation_index``."""
        if derivation_index < 0 or derivation_index > 2**31 - 1:
            raise BlockchainError(f"derivation_index out of range: {derivation_index}")
        libs = _load_bip_utils()
        ctx = libs["Bip44"].FromSeed(self._seed_bytes, libs["Bip44Coins"].ETHEREUM)
        acct = ctx.Purpose().Coin().Account(self.ACCOUNT_INDEX)
        chain = acct.Change(libs["Bip44Changes"].CHAIN_EXT)
        addr_ctx = chain.AddressIndex(derivation_index)
        return bytes(addr_ctx.PrivateKey().Raw())

    async def read_deposit_address_balance_human(
        self, *, asset: str, network: str, address: str,
    ) -> Optional[float]:
        """Return spendable on-chain balance in human units, or ``None`` if unsupported."""
        ast = (asset or "").strip().upper()
        addr = (address or "").strip()
        net = normalise_network(ast, network or "")
        if net is None or not addr:
            return None
        if ast == "ETH" and self._eth_rpc_url:
            try:
                chk = _eth_to_checksum(addr)
                hex_bal = await self._rpc(self._eth_rpc_url, "eth_getBalance", [chk, "latest"])
                wei = _hex_to_int(hex_bal)
                return float(wei) / 1e18
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "read_deposit_address_balance_human ETH failed for %s: %s",
                    addr[:10], exc,
                )
                return None
        if ast == "USDT":
            net_usdt = normalise_network("USDT", network or "")
            # ── USDT on BEP-20 (BSC) — only needs BSC RPC ────────────────
            if net_usdt == "BEP-20 (BNB Chain)":
                if self._bsc_rpc_url and self._bsc_usdt_contract:
                    return await self._read_erc20_balance_human(
                        rpc_url=self._bsc_rpc_url,
                        contract=self._bsc_usdt_contract,
                        holder_address=addr,
                        decimals=18,
                        use_bsc_fallback=True,
                    )
                return None
            # ── USDT on ERC-20 (Ethereum) — needs ETH RPC ─────────────────
            if net_usdt == "ERC-20 (Ethereum)":
                if not (self._eth_rpc_url and self._usdt_contract):
                    return None
                try:
                    holder = _eth_to_checksum(addr)[2:]
                    data = "0x70a08231" + "0" * 24 + holder.lower()
                    raw = await self._rpc(
                        self._eth_rpc_url,
                        "eth_call",
                        [{"to": self._usdt_contract, "data": data}, "latest"],
                    )
                    base = _hex_to_int(raw)
                    return float(base) / 1e6
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "read_deposit_address_balance_human USDT ERC-20 failed for %s: %s",
                        addr[:10], exc,
                    )
                    return None
            # Other USDT networks (TRC-20, etc.) — not yet supported
            return None
        if ast == "IBO" and self._bsc_rpc_url and self._ibo_contract:
            return await self._read_erc20_balance_human(
                rpc_url=self._bsc_rpc_url,
                contract=self._ibo_contract,
                holder_address=addr,
                decimals=self._ibo_decimals,
                use_bsc_fallback=True,
            )
        if ast == "BNB" and self._bsc_rpc_url:
            try:
                chk = _eth_to_checksum(addr)
                hex_bal = await self._rpc_bsc("eth_getBalance", [chk, "latest"])
                wei = _hex_to_int(hex_bal)
                return float(wei) / 1e18
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "read_deposit_address_balance_human BNB failed for %s: %s",
                    addr[:10], exc,
                )
                return None
        if ast == "BTC" and self._btc_rpc_url:
            try:
                result = await self._rpc(
                    self._btc_rpc_url,
                    "scantxoutset",
                    ["start", [f"addr({addr})"]],
                )
            except BlockchainError:
                return None
            except Exception:  # noqa: BLE001
                logger.exception("read_deposit_address_balance_human BTC scantxoutset failed")
                return None
            if not isinstance(result, dict):
                return None
            total = 0.0
            for utxo in result.get("unspents") or []:
                total += float(utxo.get("amount") or 0.0)
            return total
        return None

    async def _read_erc20_balance_human(
        self,
        *,
        rpc_url: str,
        contract: str,
        holder_address: str,
        decimals: int,
        use_bsc_fallback: bool = False,
    ) -> Optional[float]:
        try:
            holder = _eth_to_checksum(holder_address)[2:]
            data = "0x70a08231" + "0" * 24 + holder.lower()
            call = self._rpc_bsc if use_bsc_fallback else (
                lambda method, params: self._rpc(rpc_url, method, params)
            )
            raw = await call(
                "eth_call",
                [{"to": contract, "data": data}, "latest"],
            )
            base = _hex_to_int(raw)
            return float(base) / (10 ** max(0, int(decimals)))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "read_erc20_balance_human failed contract=%s holder=%s: %s",
                (contract or "")[:10],
                (holder_address or "")[:10],
                exc,
            )
            return None

    async def send_native_gas_to_address(
        self,
        *,
        to_address: str,
        amount_wei: int,
        chain: str,
    ) -> Dict[str, Any]:
        """Send native gas (BNB on BSC, ETH on Ethereum) FROM the hot treasury wallet
        TO a deposit address so it can pay for an ERC-20/BEP-20 sweep transaction.

        ``chain`` must be ``"bsc"`` or ``"eth"``.
        ``amount_wei`` is the exact wei/gwei amount to send (caller decides).

        Returns the same dict shape as other sweep methods:
        ``{"ok": True/False, "tx_hash": "0x...", "amount_wei": N, ...}``
        """
        chain = (chain or "").lower()
        if chain not in ("bsc", "eth"):
            return {"ok": False, "error": f"unsupported chain for gas funding: {chain}"}

        use_bsc = chain == "bsc"
        if use_bsc:
            if not self._bsc_rpc_url:
                return {"ok": False, "error": "QUICKNODE_BSC_URL not configured"}
        else:
            if not self._eth_rpc_url:
                return {"ok": False, "error": "QUICKNODE_ETH_URL not configured"}

        if self._treasury_eth_priv is None or self._treasury_eth_addr is None:
            return {"ok": False, "error": "TREASURY_ETH_PRIVATE_KEY not configured — cannot fund gas"}

        if amount_wei <= 0:
            return {"ok": False, "error": "amount_wei must be > 0"}

        to_chk = _eth_to_checksum(to_address)
        from_addr = self._treasury_eth_addr

        async def _rpc_call(method, params):
            if use_bsc:
                return await self._rpc_bsc(method, params)
            return await self._rpc(self._eth_rpc_url, method, params)

        Account = _load_eth_account()
        chain_id = _hex_to_int(await _rpc_call("eth_chainId", []))
        nonce = _hex_to_int(await _rpc_call("eth_getTransactionCount", [from_addr, "pending"]))
        base_fee, prio_fee = await self._eth_fee_fields(
            self._eth_rpc_url if not use_bsc else None, use_bsc=use_bsc,
        )
        max_fee_per_gas = base_fee * 2 + prio_fee
        gas_limit = 21_000  # plain native transfer

        # Safety: check hot wallet has enough native to cover amount + gas
        hot_bal_hex = await _rpc_call("eth_getBalance", [from_addr, "latest"])
        hot_bal_wei = _hex_to_int(hot_bal_hex)
        required_wei = amount_wei + max_fee_per_gas * gas_limit
        if hot_bal_wei < required_wei:
            native = "BNB" if use_bsc else "ETH"
            return {
                "ok": False,
                "error": "hot_wallet_insufficient_native",
                "native_symbol": native,
                "hot_balance_wei": int(hot_bal_wei),
                "required_wei": int(required_wei),
                "hot_balance_human": float(hot_bal_wei) / 1e18,
                "required_human": float(required_wei) / 1e18,
            }

        tx = {
            "chainId": chain_id,
            "nonce": nonce,
            "to": to_chk,
            "value": int(amount_wei),
            "gas": gas_limit,
            "maxFeePerGas": max_fee_per_gas,
            "maxPriorityFeePerGas": prio_fee,
            "data": "0x",
            "type": 2,
        }
        try:
            signed = Account.sign_transaction(tx, self._treasury_eth_priv)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"signing_failed: {exc}"}

        raw_hex = signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()
        if not raw_hex.startswith("0x"):
            raw_hex = "0x" + raw_hex
        try:
            tx_hash = await _rpc_call("eth_sendRawTransaction", [raw_hex])
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"broadcast_failed: {exc}"}

        if not isinstance(tx_hash, str) or not tx_hash.startswith("0x"):
            return {"ok": False, "error": f"unexpected_tx_hash: {tx_hash!r}"}

        native = "BNB" if use_bsc else "ETH"
        return {
            "ok": True,
            "tx_hash": tx_hash,
            "from": from_addr,
            "to": to_chk,
            "amount_wei": int(amount_wei),
            "amount_human": float(amount_wei) / 1e18,
            "native_symbol": native,
            "chain": chain,
        }

    async def sweep_erc20_deposit_to_treasury(
        self,
        *,
        derivation_index: int,
        deposit_address: str,
        to_address: str,
        asset: str,
        network: str,
        dry_run: bool,
        amount_base_override: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Sweep an ERC-20 / BEP-20 token from a deposit HD slot to ``to_address``.

        Uses the deposit master mnemonic (same derivation as ETH) to sign
        the token transfer from the user deposit address.

        The deposit address must hold enough native gas (ETH on Ethereum,
        BNB on BSC) to pay for the ERC-20 transfer.  When native is
        insufficient the function returns ``ok=False`` with
        ``error="insufficient_gas"`` rather than raising so the sweep runner
        can report it per-address without aborting the whole run.
        """
        ast = (asset or "").strip().upper()
        net = (network or "").strip()

        # ── resolve contract + rpc_url ────────────────────────────────────
        if ast == "IBO" and net == "BEP-20 (BNB Chain)":
            if not self._bsc_rpc_url:
                return {"ok": False, "dry_run": dry_run, "error": "QUICKNODE_BSC_URL not configured"}
            if not self._ibo_contract:
                return {"ok": False, "dry_run": dry_run, "error": "IBO_CONTRACT_ADDRESS not configured"}
            rpc_url = self._bsc_rpc_url
            contract = self._ibo_contract
            decimals = max(0, int(self._ibo_decimals))
            use_bsc = True
            native_symbol = "BNB"
        elif ast == "USDT" and net == "BEP-20 (BNB Chain)":
            if not self._bsc_rpc_url:
                return {"ok": False, "dry_run": dry_run, "error": "QUICKNODE_BSC_URL not configured"}
            if not self._bsc_usdt_contract:
                return {"ok": False, "dry_run": dry_run, "error": "USDT_BEP20_CONTRACT not configured"}
            rpc_url = self._bsc_rpc_url
            contract = self._bsc_usdt_contract
            decimals = 18  # BSC USDT is 18 decimals
            use_bsc = True
            native_symbol = "BNB"
        elif ast == "USDT" and net == "ERC-20 (Ethereum)":
            if not self._eth_rpc_url:
                return {"ok": False, "dry_run": dry_run, "error": "QUICKNODE_ETH_URL not configured"}
            if not self._usdt_contract:
                return {"ok": False, "dry_run": dry_run, "error": "USDT_ERC20_CONTRACT not configured"}
            rpc_url = self._eth_rpc_url
            contract = self._usdt_contract
            decimals = 6  # USDT ERC-20 is 6 decimals
            use_bsc = False
            native_symbol = "ETH"
        else:
            return {
                "ok": False,
                "dry_run": dry_run,
                "error": f"erc20_sweep_not_supported_for_{ast}_{net.replace(' ', '_')}",
            }

        # ── derive HD signing key (same EVM derivation for ETH + BSC) ────
        priv = self._eth_deposit_privkey_bytes(derivation_index)
        Account = _load_eth_account()
        acct = Account.from_key(priv)
        from_addr = _eth_to_checksum(acct.address)
        dep_chk = _eth_to_checksum(deposit_address)
        if from_addr.lower() != dep_chk.lower():
            return {
                "ok": False,
                "dry_run": dry_run,
                "error": f"deposit_address_mismatch: derived={from_addr} db={dep_chk}",
            }
        to_chk = _eth_to_checksum(to_address)
        contract_chk = _eth_to_checksum(contract)

        async def _rpc_call(method, params):
            if use_bsc:
                return await self._rpc_bsc(method, params)
            return await self._rpc(rpc_url, method, params)

        # ── read token balance ────────────────────────────────────────────
        try:
            holder = from_addr[2:]
            call_data = "0x70a08231" + "0" * 24 + holder.lower()
            raw_bal = await _rpc_call("eth_call", [{"to": contract_chk, "data": call_data}, "latest"])
            token_balance_base = _hex_to_int(raw_bal)
            token_balance_human = float(token_balance_base) / (10 ** decimals)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "dry_run": dry_run, "error": f"token_balance_read_failed: {exc}"}

        if token_balance_base <= 0:
            return {
                "ok": False,
                "dry_run": dry_run,
                "error": "token_balance_zero",
                "token_balance_human": 0.0,
            }

        # ── resolve sweep amount (full balance or caller-supplied override) ─
        if amount_base_override is not None:
            if amount_base_override <= 0:
                return {"ok": False, "dry_run": dry_run, "error": "amount_base_override must be > 0"}
            if amount_base_override > token_balance_base:
                return {
                    "ok": False,
                    "dry_run": dry_run,
                    "error": (
                        f"amount_base_override {amount_base_override} exceeds "
                        f"on-chain balance {token_balance_base}"
                    ),
                    "token_balance_human": token_balance_human,
                }
            sweep_amount_base = amount_base_override
        else:
            sweep_amount_base = token_balance_base

        sweep_amount_human = float(sweep_amount_base) / (10 ** decimals)

        # ── read native balance (for gas) ─────────────────────────────────
        try:
            hex_native = await _rpc_call("eth_getBalance", [from_addr, "latest"])
            native_wei = _hex_to_int(hex_native)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "dry_run": dry_run, "error": f"native_balance_read_failed: {exc}"}

        # ── estimate gas ──────────────────────────────────────────────────
        try:
            base_fee, prio_fee = await self._eth_fee_fields(rpc_url if not use_bsc else None, use_bsc=use_bsc)
            max_fee_per_gas = base_fee * 2 + prio_fee
            transfer_data = self._erc20_transfer_data(to_chk, sweep_amount_base)
            try:
                est_hex = await _rpc_call(
                    "eth_estimateGas",
                    [{"from": from_addr, "to": contract_chk, "data": transfer_data}],
                )
                gas_limit = int((_hex_to_int(est_hex) or 60_000) * 1.3)
            except Exception:  # noqa: BLE001
                gas_limit = 150_000  # safe default for ERC-20 transfer
            gas_cost_wei = max_fee_per_gas * gas_limit
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "dry_run": dry_run, "error": f"gas_estimate_failed: {exc}"}

        # Minimum native needed: gas_cost + small safety buffer (10%)
        min_native_wei = int(gas_cost_wei * 1.1)

        if native_wei < min_native_wei:
            needed_human = float(min_native_wei) / 1e18
            have_human = float(native_wei) / 1e18
            return {
                "ok": False,
                "dry_run": dry_run,
                "error": "insufficient_gas",
                "native_symbol": native_symbol,
                "native_have_wei": int(native_wei),
                "native_need_wei": int(min_native_wei),
                "native_have_human": have_human,
                "native_need_human": needed_human,
                "token_balance_human": token_balance_human,
                "asset": ast,
                "network": net,
                "deposit_address": from_addr,
            }

        # ── build transaction ─────────────────────────────────────────────
        chain_id = _hex_to_int(await _rpc_call("eth_chainId", []))
        nonce = _hex_to_int(await _rpc_call("eth_getTransactionCount", [from_addr, "pending"]))

        tx = {
            "chainId": chain_id,
            "nonce": nonce,
            "to": contract_chk,
            "value": 0,
            "gas": gas_limit,
            "maxFeePerGas": max_fee_per_gas,
            "maxPriorityFeePerGas": prio_fee,
            "data": transfer_data,
            "type": 2,
        }

        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "from": from_addr,
                "to": to_chk,
                "contract": contract_chk,
                "asset": ast,
                "network": net,
                "token_amount_base": sweep_amount_base,
                "token_balance_human": token_balance_human,
                "sweep_amount_human": sweep_amount_human,
                "gas_limit": gas_limit,
                "max_fee_per_gas": int(max_fee_per_gas),
                "native_symbol": native_symbol,
                "native_have_wei": int(native_wei),
            }

        # ── broadcast ────────────────────────────────────────────────────
        try:
            signed = Account.sign_transaction(tx, priv)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "dry_run": False, "error": f"signing_failed: {exc}"}

        raw_hex = signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()
        if not raw_hex.startswith("0x"):
            raw_hex = "0x" + raw_hex
        try:
            tx_hash = await _rpc_call("eth_sendRawTransaction", [raw_hex])
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "dry_run": False, "error": f"broadcast_failed: {exc}"}

        if not isinstance(tx_hash, str) or not tx_hash.startswith("0x"):
            return {"ok": False, "dry_run": False, "error": f"unexpected_tx_hash: {tx_hash!r}"}

        return {
            "ok": True,
            "dry_run": False,
            "tx_hash": tx_hash,
            "from": from_addr,
            "to": to_chk,
            "contract": contract_chk,
            "asset": ast,
            "network": net,
            "token_balance_human": token_balance_human,
            "sweep_amount_human": sweep_amount_human,
        }

    async def sweep_eth_native_deposit_to_treasury(
        self,
        *,
        derivation_index: int,
        deposit_address: str,
        to_address: str,
        dry_run: bool,
    ) -> Dict[str, Any]:
        """Sweep native ETH from a deposit HD slot to ``to_address`` (treasury hot).

        Uses the master deposit mnemonic — distinct from ``TREASURY_ETH_PRIVATE_KEY``.
        When ``dry_run`` is True, no transaction is broadcast.
        """
        if not self._eth_rpc_url:
            raise ProviderUnavailable("QUICKNODE_ETH_URL is not configured")
        net = normalise_network("ETH", "ERC-20 (Ethereum)")
        if net is None:
            raise UnsupportedAssetNetwork("ETH sweep unsupported for this network label")
        priv = self._eth_deposit_privkey_bytes(derivation_index)
        Account = _load_eth_account()
        acct = Account.from_key(priv)
        from_addr = _eth_to_checksum(acct.address)
        dep_chk = _eth_to_checksum(deposit_address)
        if from_addr.lower() != dep_chk.lower():
            raise BlockchainError(
                f"deposit address mismatch for index={derivation_index}: "
                f"derived={from_addr} db={dep_chk}",
            )
        to_chk = _eth_to_checksum(to_address)
        hex_bal = await self._rpc(self._eth_rpc_url, "eth_getBalance", [from_addr, "latest"])
        balance_wei = _hex_to_int(hex_bal)
        chain_id = _hex_to_int(await self._rpc(self._eth_rpc_url, "eth_chainId", []))
        nonce = _hex_to_int(
            await self._rpc(self._eth_rpc_url, "eth_getTransactionCount", [from_addr, "pending"]),
        )
        base_fee, prio_fee = await self._eth_fee_fields(self._eth_rpc_url)
        max_fee_per_gas = base_fee * 2 + prio_fee
        gas_limit = 21_000
        gas_reserve = int(max_fee_per_gas * gas_limit * 12 // 10)
        value_wei = int(balance_wei) - gas_reserve
        if value_wei <= 0:
            return {
                "ok": False,
                "dry_run": dry_run,
                "error": "insufficient_native_for_gas",
                "balance_wei": int(balance_wei),
                "gas_reserve_wei": gas_reserve,
            }
        tx = {
            "chainId": chain_id,
            "nonce": nonce,
            "to": to_chk,
            "value": int(value_wei),
            "gas": gas_limit,
            "maxFeePerGas": max_fee_per_gas,
            "maxPriorityFeePerGas": prio_fee,
            "data": "0x",
            "type": 2,
        }
        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "from": from_addr,
                "to": to_chk,
                "value_wei": int(value_wei),
                "gas_limit": gas_limit,
                "max_fee_per_gas": int(max_fee_per_gas),
            }
        signed = Account.sign_transaction(tx, priv)
        raw_hex = signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()
        if not raw_hex.startswith("0x"):
            raw_hex = "0x" + raw_hex
        tx_hash = await self._rpc(self._eth_rpc_url, "eth_sendRawTransaction", [raw_hex])
        if not isinstance(tx_hash, str) or not tx_hash.startswith("0x"):
            raise BlockchainError(f"eth_sendRawTransaction returned unexpected value: {tx_hash!r}")
        return {
            "ok": True,
            "dry_run": False,
            "tx_hash": tx_hash,
            "from": from_addr,
            "to": to_chk,
            "value_wei": int(value_wei),
        }

    async def close(self) -> None:
        if self._http is not None:
            try:
                await self._http.aclose()
            except Exception:  # noqa: BLE001
                logger.exception("QuickNodeProvider: failed to close http client")
            finally:
                self._http = None

    def list_supported_networks(self) -> List[Dict[str, Any]]:
        """One row per (asset, network) for wallet Asset + Network dropdowns.

        Driven by :mod:`services.rpc_endpoints` — every QuickNode URL you configure
        appears here with the right asset(s). ``chain_id`` matches the endpoint
        (btc, eth, bsc, tron, solana).
        """
        reg = get_registry()
        out: List[Dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()

        def _withdraw(asset: str, network: str) -> bool:
            return self._can_broadcast_pair(asset, network)

        def _add(row: Dict[str, Any]) -> None:
            key = (row["asset"], row["network"])
            if key in seen:
                return
            seen.add(key)
            out.append(row)

        def _row(
            *,
            asset: str,
            network: str,
            chain: str,
            label: str,
            testnet: bool,
            chain_id: str,
            endpoint_label: str,
            deposit_enabled: bool,
            withdraw_enabled: bool,
            status: str = "active",
        ) -> Dict[str, Any]:
            return {
                "asset": asset,
                "network": network,
                "chain": chain,
                "label": label,
                "testnet": testnet,
                "chain_id": chain_id,
                "endpoint_label": endpoint_label,
                "deposit_enabled": deposit_enabled,
                "withdraw_enabled": withdraw_enabled,
                "status": status,
                "rpc_configured": True,
            }

        def _active(scan: bool) -> bool:
            return bool(scan)

        def _status(scan: bool) -> str:
            return "active" if scan else "coming_soon"

        # ── 1. Bitcoin endpoint ───────────────────────────────────────────
        if self._btc_rpc_url:
            chain, testnet = _detect_chain(
                self._btc_rpc_url, _BTC_CHAIN_HINTS, "mainnet", False,
            )
            ep = reg.get("btc").label
            btc_scan = deposit_scan_chain_enabled("btc", rpc_configured=True)
            _add(_row(
                asset="BTC",
                network="Bitcoin Network",
                chain=chain,
                label=f"{ep} — Bitcoin",
                testnet=testnet,
                chain_id="btc",
                endpoint_label=ep,
                deposit_enabled=btc_scan,
                withdraw_enabled=False,
                status=_status(btc_scan),
            ))

        # ── 2. Ethereum endpoint (must not be a BSC-only URL) ─────────────
        if self._eth_rpc_url:
            chain, testnet = _detect_chain(
                self._eth_rpc_url, _ETH_CHAIN_HINTS, "mainnet", False,
            )
            if _evm_network_label(chain) == "ERC-20 (Ethereum)":
                ep = reg.get("eth").label
                pretty = "Ethereum" + (f" ({chain})" if testnet or chain != "mainnet" else "")
                _add(_row(
                    asset="ETH",
                    network="ERC-20 (Ethereum)",
                    chain=chain,
                    label=f"{ep} — {pretty}",
                    testnet=testnet,
                    chain_id="eth",
                    endpoint_label=ep,
                    deposit_enabled=True,
                    withdraw_enabled=_withdraw("ETH", "ERC-20 (Ethereum)"),
                ))
                if self._usdt_contract:
                    _add(_row(
                        asset="USDT",
                        network="ERC-20 (Ethereum)",
                        chain=chain,
                        label=f"{ep} — USDT (ERC-20)",
                        testnet=testnet,
                        chain_id="eth",
                        endpoint_label=ep,
                        deposit_enabled=True,
                        withdraw_enabled=_withdraw("USDT", "ERC-20 (Ethereum)"),
                    ))

        # ── 3. BNB Smart Chain endpoint ───────────────────────────────────
        if self._bsc_rpc_url:
            bsc_chain, bsc_testnet = _detect_chain(
                self._bsc_rpc_url, _ETH_CHAIN_HINTS, "bsc", False,
            )
            ep = reg.get("bsc").label
            bsc_suffix = f" ({bsc_chain})" if bsc_testnet else ""
            bsc_scan = deposit_scan_chain_enabled("bsc", rpc_configured=True)
            bsc_st = _status(bsc_scan)
            _add(_row(
                asset="BNB",
                network="BEP-20 (BNB Chain)",
                chain=bsc_chain,
                label=f"{ep} — BNB{bsc_suffix}",
                testnet=bsc_testnet,
                chain_id="bsc",
                endpoint_label=ep,
                deposit_enabled=bsc_scan,
                withdraw_enabled=_withdraw("BNB", "BEP-20 (BNB Chain)"),
                status=bsc_st,
            ))
            if self._bsc_usdt_contract:
                _add(_row(
                    asset="USDT",
                    network="BEP-20 (BNB Chain)",
                    chain=bsc_chain,
                    label=f"{ep} — USDT (BEP-20){bsc_suffix}",
                    testnet=bsc_testnet,
                    chain_id="bsc",
                    endpoint_label=ep,
                    deposit_enabled=bsc_scan,
                    withdraw_enabled=_withdraw("USDT", "BEP-20 (BNB Chain)"),
                    status=bsc_st,
                ))
            if self._ibo_contract:
                _add(_row(
                    asset="IBO",
                    network="BEP-20 (BNB Chain)",
                    chain=bsc_chain,
                    label=f"{ep} — IBO (BEP-20){bsc_suffix}",
                    testnet=bsc_testnet,
                    chain_id="bsc",
                    endpoint_label=ep,
                    deposit_enabled=bsc_scan,
                    withdraw_enabled=_withdraw("IBO", "BEP-20 (BNB Chain)"),
                    status=bsc_st,
                ))

        # ── 4. Tron endpoint ──────────────────────────────────────────────
        if reg.http_url("tron"):
            ep = reg.get("tron").label
            scan = _active(
                reg.get("tron").deposit_scan_enabled
                and deposit_scan_chain_enabled("tron", rpc_configured=True),
            )
            st = _status(scan)
            _add(_row(
                asset="TRX",
                network="TRC-20 (Tron)",
                chain="tron",
                label=f"{ep} — TRX" + ("" if scan else " (coming soon)"),
                testnet=False,
                chain_id="tron",
                endpoint_label=ep,
                deposit_enabled=scan,
                withdraw_enabled=_withdraw("TRX", "TRC-20 (Tron)"),
                status=st,
            ))
            _add(_row(
                asset="USDT",
                network="TRC-20 (Tron)",
                chain="tron",
                label=f"{ep} — USDT (TRC-20)" + ("" if scan else " (coming soon)"),
                testnet=False,
                chain_id="tron",
                endpoint_label=ep,
                deposit_enabled=scan,
                withdraw_enabled=_withdraw("USDT", "TRC-20 (Tron)"),
                status=st,
            ))

        # ── 5. Solana endpoint ────────────────────────────────────────────
        if reg.http_url("solana"):
            ep = reg.get("solana").label
            scan = _active(
                reg.get("solana").deposit_scan_enabled
                and deposit_scan_chain_enabled("solana", rpc_configured=True),
            )
            st = _status(scan)
            _add(_row(
                asset="SOL",
                network="Solana",
                chain="solana",
                label=f"{ep} — SOL" + ("" if scan else " (coming soon)"),
                testnet=False,
                chain_id="solana",
                endpoint_label=ep,
                deposit_enabled=scan,
                withdraw_enabled=False,
                status=st,
            ))

        return out

    # ── HD derivation ────────────────────────────────────────────────────
    def _derive_btc(self, index: int) -> tuple[str, str]:
        # BIP84 native segwit — modern wallets default. Path:
        # m / 84' / 0' / 0' / 0 / {index}
        ctx = self._bip84.FromSeed(self._seed_bytes, self._bip84_coins.BITCOIN)
        acct = ctx.Purpose().Coin().Account(self.ACCOUNT_INDEX)
        chain = acct.Change(self._bip44_changes.CHAIN_EXT)
        addr_ctx = chain.AddressIndex(index)
        address = addr_ctx.PublicKey().ToAddress()
        if not _BTC_BECH32_RE.match(address):
            # Unexpected — bip_utils should always return bech32 for BIP84.
            raise BlockchainError(f"Derived BTC address has unexpected format: {address}")
        path = f"m/84'/0'/{self.ACCOUNT_INDEX}'/0/{index}"
        return address, path

    def _derive_eth(self, index: int) -> tuple[str, str]:
        # BIP44 standard EVM path: m / 44' / 60' / 0' / 0 / {index}
        ctx = self._bip44.FromSeed(self._seed_bytes, self._bip44_coins.ETHEREUM)
        acct = ctx.Purpose().Coin().Account(self.ACCOUNT_INDEX)
        chain = acct.Change(self._bip44_changes.CHAIN_EXT)
        addr_ctx = chain.AddressIndex(index)
        address = addr_ctx.PublicKey().ToAddress()
        if not _ETH_ADDR_RE.match(address):
            raise BlockchainError(f"Derived ETH address has unexpected format: {address}")
        path = f"m/44'/60'/{self.ACCOUNT_INDEX}'/0/{index}"
        return address, path

    def _derive_tron(self, index: int) -> tuple[str, str]:
        ctx = self._bip44.FromSeed(self._seed_bytes, self._bip44_coins.TRON)
        acct = ctx.Purpose().Coin().Account(self.ACCOUNT_INDEX)
        chain = acct.Change(self._bip44_changes.CHAIN_EXT)
        addr_ctx = chain.AddressIndex(index)
        address = addr_ctx.PublicKey().ToAddress()
        if not _TRON_ADDR_RE.match(address):
            raise BlockchainError(f"Derived TRX address has unexpected format: {address}")
        path = f"m/44'/195'/{self.ACCOUNT_INDEX}'/0/{index}"
        return address, path

    def _derive_solana(self, index: int) -> tuple[str, str]:
        ctx = self._bip44.FromSeed(self._seed_bytes, self._bip44_coins.SOLANA)
        acct = ctx.Purpose().Coin().Account(self.ACCOUNT_INDEX)
        chain = acct.Change(self._bip44_changes.CHAIN_EXT)
        addr_ctx = chain.AddressIndex(index)
        address = addr_ctx.PublicKey().ToAddress()
        if not _SOL_ADDR_RE.match(address):
            raise BlockchainError(f"Derived SOL address has unexpected format: {address}")
        path = f"m/44'/501'/{self.ACCOUNT_INDEX}'/0/{index}"
        return address, path

    async def _tron_json_rpc(self, method: str, params: Optional[List[Any]] = None) -> Any:
        """Tron QuickNode: eth-compatible JSON-RPC only (not ``wallet/*``)."""
        if not self._tron_rpc_url:
            raise ProviderUnavailable("QUICKNODE_TRON_URL is not configured")
        try:
            return await get_rpc_transport(self._tron_rpc_url).json_rpc(
                method, params if params is not None else [],
            )
        except RpcError as exc:
            raise BlockchainError(str(exc)) from exc

    async def _scan_tron(
        self,
        trx_rows: List[Dict[str, Any]],
        usdt_trc_rows: List[Dict[str, Any]],
    ) -> List[IncomingTx]:
        from services.chain_scan_tron_solana import scan_tron_deposits

        return await scan_tron_deposits(
            json_rpc=self._tron_json_rpc,
            trx_rows=trx_rows,
            usdt_rows=usdt_trc_rows,
            usdt_contract=self._usdt_trc20_contract or "",
            lookback_blocks=self._tron_lookback_blocks,
        )

    async def _scan_solana(self, sol_rows: List[Dict[str, Any]]) -> List[IncomingTx]:
        from services.chain_scan_tron_solana import scan_solana_deposits

        async def _rpc(method: str, params: List[Any]) -> Any:
            if not self._solana_rpc_url:
                raise ProviderUnavailable("QUICKNODE_SOLANA_URL is not configured")
            try:
                return await get_rpc_transport(self._solana_rpc_url).json_rpc(method, params)
            except RpcError as exc:
                raise BlockchainError(str(exc)) from exc

        return await scan_solana_deposits(
            rpc=_rpc,
            sol_rows=sol_rows,
            sig_limit=self._solana_sig_limit,
        )

    # ── RPC plumbing ─────────────────────────────────────────────────────
    async def _eth_fee_fields(
        self, rpc_url: Optional[str] = None, *, use_bsc: bool = False,
    ) -> tuple[int, int]:
        """Return ``(base_fee_wei, priority_fee_wei)`` for the next block.

        Best-effort — if the endpoint doesn't expose ``eth_maxPriorityFeePerGas``
        we fall back to a sensible 2 gwei tip and derive base fee from the
        latest block header. Returned values are padded conservatively
        (``max_fee = base*2 + tip``) by the caller.
        """
        url = (rpc_url or self._eth_rpc_url or "").strip()
        if not url and not use_bsc:
            return 0, 2 * 10**9

        async def call(method: str, params: List[Any]) -> Any:
            if use_bsc:
                return await self._rpc_bsc(method, params)
            return await self._rpc(url, method, params)

        # base fee: pull from latest block
        base_fee = 0
        try:
            block = await call("eth_getBlockByNumber", ["latest", False])
            if isinstance(block, dict):
                base_fee = _hex_to_int(block.get("baseFeePerGas"))
        except BlockchainError:
            base_fee = 0

        # priority (tip): prefer eth_maxPriorityFeePerGas when available.
        prio_fee = 2 * 10**9  # 2 gwei default
        try:
            tip_hex = await call("eth_maxPriorityFeePerGas", [])
            tip = _hex_to_int(tip_hex)
            if tip > 0:
                prio_fee = tip
        except BlockchainError:
            pass

        # If the chain isn't EIP-1559 capable the base fee will be 0; gas_price
        # will still work because the executor sends a legacy-style
        # ``maxFeePerGas`` that most clients accept.
        if base_fee <= 0:
            try:
                gp_hex = await call("eth_gasPrice", [])
                base_fee = max(0, _hex_to_int(gp_hex) - prio_fee)
            except BlockchainError:
                base_fee = 0

        return int(base_fee), int(prio_fee)

    @staticmethod
    def _erc20_transfer_data(to_checksum: str, amount_base: int) -> str:
        """Encode ``transfer(address,uint256)`` calldata for an ERC-20 token.

        Hand-rolled rather than pulling in the full ``web3`` stack — the
        selector is stable and the layout is trivial for 2 params of
        fixed length.
        """
        if amount_base < 0:
            raise BlockchainError("amount_base must be >= 0")
        # selector = keccak256("transfer(address,uint256)")[:4]
        selector = "a9059cbb"
        addr_hex = to_checksum.lower().replace("0x", "").rjust(64, "0")
        amt_hex = format(int(amount_base), "x").rjust(64, "0")
        return "0x" + selector + addr_hex + amt_hex

    async def _rpc(self, url: str, method: str, params: List[Any]) -> Any:
        """JSON-RPC via :mod:`services.rpc_endpoints` (per-host throttle + retry)."""
        try:
            return await get_rpc_transport(url).json_rpc(method, params)
        except RpcError as exc:
            raise BlockchainError(str(exc)) from exc

    async def _rpc_bsc(self, method: str, params: List[Any]) -> Any:
        """BSC JSON-RPC with public fallback when QuickNode TLS/transport fails."""
        urls: List[str] = []
        seen: set[str] = set()
        for raw in (self._bsc_rpc_url, self._bsc_fallback_url):
            u = (raw or "").strip()
            if u and u not in seen:
                urls.append(u)
                seen.add(u)
        if not urls:
            raise ProviderUnavailable("BSC RPC is not configured")
        last_exc: Optional[Exception] = None
        for idx, url in enumerate(urls):
            try:
                return await self._rpc(url, method, params)
            except BlockchainError as exc:
                last_exc = exc
                if idx + 1 < len(urls):
                    logger.warning(
                        "BSC RPC %s failed on primary — trying fallback (%s)",
                        method,
                        exc,
                    )
                    continue
                raise
        if last_exc:
            raise last_exc
        raise ProviderUnavailable("BSC RPC is not configured")

    # ── BTC scan (Bitcoin Core via QuickNode) ────────────────────────────
    async def _scan_btc(self, rows: List[Dict[str, Any]]) -> List[IncomingTx]:
        if not self._btc_rpc_url or not rows:
            return []
        # We use scantxoutset which is slow but doesn't require an address
        # index. Consider migrating to Blockbook (qn_get* add-ons) for
        # production-grade polling in Phase 4/5.
        descriptors = [f"addr({r['address']})" for r in rows if r.get("address")]
        if not descriptors:
            return []
        try:
            result = await self._rpc(
                self._btc_rpc_url,
                "scantxoutset",
                ["start", descriptors],
            )
        except BlockchainError as exc:
            if "not supported" in str(exc).lower():
                logger.info(
                    "QuickNodeProvider: scantxoutset unavailable — using bb_getUTXOs",
                )
                return await self._scan_btc_blockbook(rows)
            logger.warning("QuickNodeProvider: scantxoutset failed: %s", exc)
            return []
        if not isinstance(result, dict):
            return await self._scan_btc_blockbook(rows)
        by_addr = {r["address"]: r for r in rows}
        out: List[IncomingTx] = []
        best_height = int(result.get("height") or 0)
        for utxo in result.get("unspents") or []:
            addr = (utxo.get("desc") or "").split("addr(")[-1].split(")")[0]
            if not addr or addr not in by_addr:
                continue
            tx_hash = utxo.get("txid") or ""
            amount = float(utxo.get("amount") or 0.0)
            height = int(utxo.get("height") or 0)
            confirmations = max(0, best_height - height + 1) if height else 0
            row = by_addr[addr]
            out.append(IncomingTx(
                asset="BTC",
                network=row.get("network") or "Bitcoin Network",
                address=addr,
                tx_hash=tx_hash,
                amount=amount,
                confirmations=confirmations,
                block_height=height or None,
                raw={"utxo": utxo},
            ))
        return out

    async def _scan_btc_blockbook(self, rows: List[Dict[str, Any]]) -> List[IncomingTx]:
        """QuickNode Blockbook add-on — ``bb_getUTXOs`` per deposit address."""
        if not self._btc_rpc_url or not rows:
            return []
        by_addr = {r["address"]: r for r in rows if r.get("address")}
        out: List[IncomingTx] = []
        seen: set[tuple[str, str, int]] = set()
        for addr, row in by_addr.items():
            try:
                utxos = await self._rpc(
                    self._btc_rpc_url,
                    "bb_getUTXOs",
                    [addr, {"confirmed": True}],
                )
            except BlockchainError as exc:
                logger.warning(
                    "QuickNodeProvider: bb_getUTXOs failed for %s: %s",
                    addr[:12], exc,
                )
                continue
            if not isinstance(utxos, list):
                continue
            for utxo in utxos:
                if not isinstance(utxo, dict):
                    continue
                txid = utxo.get("txid") or ""
                vout = int(utxo.get("vout") or 0)
                key = (addr, txid, vout)
                if key in seen:
                    continue
                seen.add(key)
                try:
                    sats = int(utxo.get("value") or 0)
                except (TypeError, ValueError):
                    continue
                if sats <= 0:
                    continue
                height = int(utxo.get("height") or 0) or None
                conf = int(utxo.get("confirmations") or 0) or 1
                out.append(IncomingTx(
                    asset="BTC",
                    network=row.get("network") or "Bitcoin Network",
                    address=addr,
                    tx_hash=txid,
                    amount=sats / 1e8,
                    confirmations=max(1, conf),
                    block_height=height,
                    raw={"utxo": utxo},
                ))
        return out

    async def _fetch_transfer_logs_chunked(
        self,
        rpc_url: str,
        *,
        contract: str,
        to_topics: List[str],
        from_block: int,
        latest: int,
        network_label: str,
    ) -> List[Any]:
        """``eth_getLogs`` in ≤10k-block chunks (QuickNode limit)."""
        try:
            max_span = max(100, int(os.getenv("DEPOSIT_POLL_LOGS_MAX_BLOCKS", "9999") or "9999"))
        except ValueError:
            max_span = 9999
        all_logs: List[Any] = []
        chunk_start = from_block
        while chunk_start <= latest:
            chunk_end = min(latest, chunk_start + max_span - 1)
            transfer_topic = (
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
            )
            try:
                logs = await self._rpc(
                    rpc_url,
                    "eth_getLogs",
                    [{
                        "fromBlock": hex(chunk_start),
                        "toBlock": hex(chunk_end),
                        "address": contract,
                        "topics": [transfer_topic, None, to_topics],
                    }],
                )
            except BlockchainError as exc:
                logger.warning(
                    "QuickNodeProvider: eth_getLogs failed (%s) blocks %d-%d: %s",
                    network_label, chunk_start, chunk_end, exc,
                )
                logs = None
            if isinstance(logs, list):
                all_logs.extend(logs)
            chunk_start = chunk_end + 1
        return all_logs

    def _eth_native_scan_blocks(self, lookback_blocks: int) -> int:
        """Cap per-block ETH walks — full lookback uses logs, not block iteration."""
        try:
            cap = max(20, int(os.getenv("DEPOSIT_POLL_ETH_NATIVE_MAX_BLOCKS", "500") or "500"))
        except ValueError:
            cap = 500
        return min(lookback_blocks, cap)

    # ── ETH / ERC-20 USDT scan ───────────────────────────────────────────
    async def _scan_eth(
        self,
        eth_rows: List[Dict[str, Any]],
        usdt_rows: List[Dict[str, Any]],
        *,
        lookback_blocks: Optional[int] = None,
    ) -> List[IncomingTx]:
        if not self._eth_rpc_url:
            return []
        latest_hex = await self._rpc(self._eth_rpc_url, "eth_blockNumber", [])
        latest = _hex_to_int(latest_hex)
        if latest <= 0:
            return []
        lb = max(1, int(lookback_blocks or self._eth_lookback_blocks))
        from_block = max(0, latest - lb + 1)
        native_from = max(0, latest - self._eth_native_scan_blocks(lb) + 1)
        out: List[IncomingTx] = []

        # Native ETH: fetch the block range and scan txs with ``to`` in
        # our address set. This is O(txs) which is fine for a small
        # lookback window; Phase 4 can swap to a smarter indexer.
        eth_addr_set = {
            (r.get("address") or "").lower(): r for r in eth_rows if r.get("address")
        }
        if eth_addr_set:
            for block_num in range(native_from, latest + 1):
                try:
                    block = await self._rpc(
                        self._eth_rpc_url,
                        "eth_getBlockByNumber",
                        [hex(block_num), True],
                    )
                except BlockchainError:
                    continue
                if not isinstance(block, dict):
                    continue
                for tx in block.get("transactions") or []:
                    to_addr = (tx.get("to") or "").lower()
                    if to_addr not in eth_addr_set:
                        continue
                    value = _hex_to_int(tx.get("value")) / 1e18
                    if value <= 0:
                        continue
                    row = eth_addr_set[to_addr]
                    confirmations = latest - block_num + 1
                    out.append(IncomingTx(
                        asset="ETH",
                        network=row.get("network") or "ERC-20 (Ethereum)",
                        address=tx.get("to"),
                        tx_hash=tx.get("hash") or "",
                        amount=float(value),
                        confirmations=int(confirmations),
                        block_height=block_num,
                        raw={"tx": tx},
                    ))

        # USDT: eth_getLogs filtered by Transfer(address,address,uint256).
        # Topic 0 is the event signature; topic 2 is the padded ``to``.
        usdt_addr_set = {
            (r.get("address") or "").lower(): r for r in usdt_rows if r.get("address")
        }
        if usdt_addr_set and self._usdt_contract:
            to_topics = [
                "0x" + addr.replace("0x", "").lower().rjust(64, "0")
                for addr in usdt_addr_set.keys()
            ]
            logs = await self._fetch_transfer_logs_chunked(
                self._eth_rpc_url,
                contract=self._usdt_contract,
                to_topics=to_topics,
                from_block=from_block,
                latest=latest,
                network_label="ERC-20 (Ethereum)",
            )
            for log in logs:
                topics = log.get("topics") or []
                if len(topics) < 3:
                    continue
                to_padded = (topics[2] or "").lower()
                to_addr = "0x" + to_padded[-40:]
                if to_addr not in usdt_addr_set:
                    continue
                raw_amount = _hex_to_int(log.get("data"))
                amount = raw_amount / 1e6
                if amount <= 0:
                    continue
                block_num = _hex_to_int(log.get("blockNumber"))
                confirmations = latest - block_num + 1 if block_num else 0
                row = usdt_addr_set[to_addr]
                out.append(IncomingTx(
                    asset=(row.get("asset") or "USDT").upper(),
                    network=row.get("network") or "ERC-20 (Ethereum)",
                    address=to_addr,
                    tx_hash=log.get("transactionHash") or "",
                    amount=float(amount),
                    confirmations=int(max(0, confirmations)),
                    block_height=block_num or None,
                    raw={"log": log},
                ))
        return out

    async def scan_eth_block(
        self,
        block_num: int,
        eth_rows: List[Dict[str, Any]],
    ) -> List[IncomingTx]:
        """Scan a single Ethereum block for native ETH deposits.

        Used by the WebSocket-driven deposit poller — the block number
        is already known from the ``newHead`` event, so this skips the
        ``eth_blockNumber`` RPC call and fetches only one block.

        Returns ``[]`` when the RPC call fails or no matching txs exist.
        """
        if not self._eth_rpc_url or not eth_rows:
            return []
        eth_addr_set = {
            (r.get("address") or "").lower(): r
            for r in eth_rows
            if r.get("address")
        }
        if not eth_addr_set:
            return []
        try:
            block = await self._rpc(
                self._eth_rpc_url,
                "eth_getBlockByNumber",
                [hex(block_num), True],
            )
        except BlockchainError as exc:
            logger.warning(
                "QuickNodeProvider.scan_eth_block: block %d fetch failed: %s",
                block_num, exc,
            )
            return []
        if not isinstance(block, dict):
            return []
        out: List[IncomingTx] = []
        for tx in block.get("transactions") or []:
            to_addr = (tx.get("to") or "").lower()
            if to_addr not in eth_addr_set:
                continue
            value = _hex_to_int(tx.get("value")) / 1e18
            if value <= 0:
                continue
            row = eth_addr_set[to_addr]
            out.append(IncomingTx(
                asset="ETH",
                network=row.get("network") or "ERC-20 (Ethereum)",
                address=tx.get("to"),
                tx_hash=tx.get("hash") or "",
                amount=float(value),
                confirmations=1,
                block_height=block_num,
                raw={"tx": tx},
            ))
        return out

    # ── BNB Chain / BSC scan ─────────────────────────────────────────────
    async def _scan_bsc(
        self,
        bnb_rows: List[Dict[str, Any]],
        usdt_rows: List[Dict[str, Any]],
        *,
        lookback_blocks: Optional[int] = None,
    ) -> List[IncomingTx]:
        """Scan BEP-20 deposits on BNB Chain.

        Identical JSON-RPC calls to ``_scan_eth`` but using
        ``_bsc_rpc_url`` and ``_bsc_usdt_contract``.  The network label
        on every returned ``IncomingTx`` is ``"BEP-20 (BNB Chain)"``.
        """
        if not self._bsc_rpc_url:
            return []
        rpc = self._bsc_rpc_url
        latest_hex = await self._rpc(rpc, "eth_blockNumber", [])
        latest = _hex_to_int(latest_hex)
        if latest <= 0:
            return []
        lb = max(1, int(lookback_blocks or self._bsc_lookback_blocks))
        from_block = max(0, latest - lb + 1)
        native_from = max(0, latest - self._eth_native_scan_blocks(lb) + 1)
        out: List[IncomingTx] = []

        bnb_addr_set = {
            (r.get("address") or "").lower(): r for r in bnb_rows if r.get("address")
        }
        if bnb_addr_set:
            for block_num in range(native_from, latest + 1):
                try:
                    block = await self._rpc(rpc, "eth_getBlockByNumber", [hex(block_num), True])
                except BlockchainError:
                    continue
                if not isinstance(block, dict):
                    continue
                for tx in block.get("transactions") or []:
                    to_addr = (tx.get("to") or "").lower()
                    if to_addr not in bnb_addr_set:
                        continue
                    value = _hex_to_int(tx.get("value")) / 1e18
                    if value <= 0:
                        continue
                    row = bnb_addr_set[to_addr]
                    confirmations = latest - block_num + 1
                    out.append(IncomingTx(
                        asset=(row.get("asset") or "BNB").upper(),
                        network="BEP-20 (BNB Chain)",
                        address=tx.get("to"),
                        tx_hash=tx.get("hash") or "",
                        amount=float(value),
                        confirmations=int(confirmations),
                        block_height=block_num,
                        raw={"tx": tx},
                    ))

        # BEP-20 USDT
        usdt_addr_set = {
            (r.get("address") or "").lower(): r for r in usdt_rows if r.get("address")
        }
        if usdt_addr_set and self._bsc_usdt_contract:
            to_topics = [
                "0x" + addr.replace("0x", "").lower().rjust(64, "0")
                for addr in usdt_addr_set.keys()
            ]
            logs = await self._fetch_transfer_logs_chunked(
                rpc,
                contract=self._bsc_usdt_contract,
                to_topics=to_topics,
                from_block=from_block,
                latest=latest,
                network_label="BEP-20 (BNB Chain)",
            )
            for log in logs:
                topics = log.get("topics") or []
                if len(topics) < 3:
                    continue
                to_addr = "0x" + (topics[2] or "").lower()[-40:]
                if to_addr not in usdt_addr_set:
                    continue
                raw_amount = _hex_to_int(log.get("data"))
                amount = raw_amount / 1e18   # BEP-20 USDT (BSC) has 18 decimals
                if amount <= 0:
                    continue
                block_num = _hex_to_int(log.get("blockNumber"))
                confirmations = latest - block_num + 1 if block_num else 0
                row = usdt_addr_set[to_addr]
                out.append(IncomingTx(
                    asset=(row.get("asset") or "USDT").upper(),
                    network="BEP-20 (BNB Chain)",
                    address=to_addr,
                    tx_hash=log.get("transactionHash") or "",
                    amount=float(amount),
                    confirmations=int(max(0, confirmations)),
                    block_height=block_num or None,
                    raw={"log": log},
                ))
        return out

    async def scan_usdt_block(
        self,
        block_num: int,
        usdt_rows: List[Dict[str, Any]],
        *,
        rpc_url: Optional[str] = None,
        usdt_contract: Optional[str] = None,
        network_label: str = "ERC-20 (Ethereum)",
        decimals: int = 6,
    ) -> List[IncomingTx]:
        """Scan a single block for USDT Transfer events to our deposit addresses.

        Uses ``eth_getLogs`` filtered to ``topics[2]`` (the ``to`` field of
        ERC-20 Transfer events) so QuickNode only delivers logs destined for
        addresses we actually care about.

        Cost: **one** ``eth_getLogs`` call (~75 QuickNode credits), regardless
        of how many total USDT transfers occurred on the network in that block.
        Compare to ``eth_subscribe logs`` (global subscription) which delivers
        every Transfer event and charges credits for each one — 500-2 000
        credits *per block* on mainnet Ethereum.

        Parameters
        ----------
        rpc_url:        Override the default ``_eth_rpc_url``.  Pass
                        ``self._bsc_rpc_url`` to scan BSC USDT.
        usdt_contract:  Override the default ``_usdt_contract``.
        network_label:  Stored on ``IncomingTx.network`` (e.g.
                        ``"BEP-20 (BNB Chain)"`` for BSC).
        decimals:       Token decimals (6 for USDT ERC-20, 18 for BEP-20 USDT).
        """
        url      = rpc_url      or self._eth_rpc_url
        contract = usdt_contract or self._usdt_contract
        if not url or not contract or not usdt_rows or block_num <= 0:
            return []

        usdt_addr_set = {
            (r.get("address") or "").lower(): r
            for r in usdt_rows if r.get("address")
        }
        if not usdt_addr_set:
            return []

        transfer_topic = (
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        )
        # Pad each address to a 32-byte topic (66 hex chars incl. "0x").
        to_topics = [
            "0x" + addr.replace("0x", "").lower().rjust(64, "0")
            for addr in usdt_addr_set.keys()
        ]

        try:
            logs = await self._rpc(
                url,
                "eth_getLogs",
                [{
                    "fromBlock": hex(block_num),
                    "toBlock":   hex(block_num),
                    "address":   contract,
                    "topics":    [transfer_topic, None, to_topics],
                }],
            )
        except BlockchainError as exc:
            logger.warning(
                "QuickNodeProvider.scan_usdt_block: eth_getLogs failed "
                "for block %d (%s): %s", block_num, network_label, exc,
            )
            return []

        if not isinstance(logs, list):
            return []

        out: List[IncomingTx] = []
        divisor = 10 ** decimals
        for log in logs:
            topics = log.get("topics") or []
            if len(topics) < 3:
                continue
            to_addr = "0x" + (topics[2] or "").lower()[-40:]
            if to_addr not in usdt_addr_set:
                continue
            raw_amount = _hex_to_int(log.get("data"))
            amount = raw_amount / divisor
            if amount <= 0:
                continue
            row = usdt_addr_set[to_addr]
            asset_sym = (row.get("asset") or "USDT").upper()
            out.append(IncomingTx(
                asset=asset_sym,
                network=row.get("network") or network_label,
                address=to_addr,
                tx_hash=log.get("transactionHash") or "",
                amount=float(amount),
                confirmations=1,
                block_height=block_num,
                raw={"log": log},
            ))
        return out

    async def scan_multi_token_range(
        self,
        from_block: int,
        to_block: int,
        *,
        rpc_url: str,
        token_configs: List[Dict[str, Any]],
    ) -> List[IncomingTx]:
        """Scan a block RANGE for multiple ERC-20/BEP-20 tokens in ONE ``eth_getLogs`` call.

        This is the primary credit-saving optimisation for BSC (and ETH).  Instead
        of calling ``scan_usdt_block`` once-per-block-per-token (e.g. 4 BSC blocks ×
        2 tokens = 8 calls × 75 credits = 600 credits), this issues a **single**
        ``eth_getLogs`` covering the entire range for ALL token contracts at once
        (~75 credits total).

        Parameters
        ----------
        from_block / to_block:
            Inclusive block range (QuickNode allows up to 10 000 blocks per call;
            larger ranges are automatically chunked by ``_fetch_transfer_logs_chunked``).
        rpc_url:
            Chain endpoint (``_eth_rpc_url`` or ``_bsc_rpc_url``).
        token_configs:
            List of dicts, each with keys:
                contract      – token contract address (str)
                asset         – symbol, e.g. "USDT" or "IBO"
                network_label – stored on IncomingTx.network
                decimals      – token decimal places
                rows          – deposit-address rows for this token
        """
        if not rpc_url or not token_configs or from_block <= 0 or to_block < from_block:
            return []

        # Build per-contract lookup and a unified deposit-address set.
        contract_info: Dict[str, Dict[str, Any]] = {}
        addr_to_row_by_contract: Dict[str, Dict[str, Dict[str, Any]]] = {}
        all_addr_set: Dict[str, bool] = {}

        for cfg in token_configs:
            raw_contract = (cfg.get("contract") or "").strip().lower()
            if not raw_contract:
                continue
            contract_info[raw_contract] = cfg
            addr_map: Dict[str, Dict[str, Any]] = {}
            for r in (cfg.get("rows") or []):
                addr = (r.get("address") or "").lower()
                if addr:
                    addr_map[addr] = r
                    all_addr_set[addr] = True
            addr_to_row_by_contract[raw_contract] = addr_map

        contracts = list(contract_info.keys())
        if not contracts or not all_addr_set:
            return []

        transfer_topic = (
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        )
        to_topics = [
            "0x" + addr.replace("0x", "").lower().rjust(64, "0")
            for addr in all_addr_set
        ]

        # Chunk the range to stay inside QuickNode's 10 000-block getLogs limit.
        try:
            max_span = max(100, int(os.getenv("DEPOSIT_POLL_LOGS_MAX_BLOCKS", "9999") or "9999"))
        except ValueError:
            max_span = 9999

        all_logs: List[Any] = []
        chunk_start = from_block
        while chunk_start <= to_block:
            chunk_end = min(to_block, chunk_start + max_span - 1)
            try:
                logs = await self._rpc(
                    rpc_url,
                    "eth_getLogs",
                    [{
                        "fromBlock": hex(chunk_start),
                        "toBlock":   hex(chunk_end),
                        "address":   contracts,   # OR-match across all token contracts
                        "topics":    [transfer_topic, None, to_topics],
                    }],
                )
                if isinstance(logs, list):
                    all_logs.extend(logs)
            except BlockchainError as exc:
                logger.warning(
                    "scan_multi_token_range: eth_getLogs failed blocks %d-%d: %s",
                    chunk_start, chunk_end, exc,
                )
            chunk_start = chunk_end + 1

        out: List[IncomingTx] = []
        for log in all_logs:
            # Identify which token contract emitted this log.
            log_contract = (log.get("address") or "").lower()
            cfg = contract_info.get(log_contract)
            if not cfg:
                continue
            topics = log.get("topics") or []
            if len(topics) < 3:
                continue
            to_addr = "0x" + (topics[2] or "").lower()[-40:]
            row = addr_to_row_by_contract.get(log_contract, {}).get(to_addr)
            if row is None:
                continue
            raw_amount = _hex_to_int(log.get("data"))
            decimals = int(cfg.get("decimals") or 18)
            amount = raw_amount / (10 ** decimals)
            if amount <= 0:
                continue
            block_num = _hex_to_int(log.get("blockNumber"))
            out.append(IncomingTx(
                asset=(cfg.get("asset") or "").upper(),
                network=row.get("network") or cfg.get("network_label", ""),
                address=to_addr,
                tx_hash=log.get("transactionHash") or "",
                amount=float(amount),
                confirmations=1,
                block_height=block_num or None,
                raw={"log": log},
            ))
        return out

    async def scan_erc20_transfers_lookback(
        self,
        token_rows: List[Dict[str, Any]],
        *,
        contract: str,
        network_label: str,
        decimals: int = 18,
        rpc_url: Optional[str] = None,
        lookback_blocks: Optional[int] = None,
    ) -> List[IncomingTx]:
        """Scan a block range for ERC-20/BEP-20 Transfer logs to our deposit addresses.

        Used for listed tokens (e.g. IBO) on REST fallback and catch-up scans.
        """
        url = rpc_url or self._eth_rpc_url
        if not url or not contract or not token_rows:
            return []
        latest_hex = await self._rpc(url, "eth_blockNumber", [])
        latest = _hex_to_int(latest_hex)
        if latest <= 0:
            return []
        lb = lookback_blocks if lookback_blocks is not None else self._eth_lookback_blocks
        from_block = max(0, latest - int(lb) + 1)

        addr_set = {
            (r.get("address") or "").lower(): r for r in token_rows if r.get("address")
        }
        if not addr_set:
            return []

        transfer_topic = (
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        )
        to_topics = [
            "0x" + addr.replace("0x", "").lower().rjust(64, "0")
            for addr in addr_set.keys()
        ]
        # QuickNode caps eth_getLogs to a 10_000-block window — scan in chunks.
        try:
            max_span = max(100, int(os.getenv("DEPOSIT_POLL_LOGS_MAX_BLOCKS", "9999") or "9999"))
        except ValueError:
            max_span = 9999

        all_logs: List[Any] = []
        chunk_start = from_block
        while chunk_start <= latest:
            chunk_end = min(latest, chunk_start + max_span - 1)
            try:
                logs = await self._rpc(
                    url,
                    "eth_getLogs",
                    [{
                        "fromBlock": hex(chunk_start),
                        "toBlock": hex(chunk_end),
                        "address": contract,
                        "topics": [transfer_topic, None, to_topics],
                    }],
                )
            except BlockchainError as exc:
                logger.warning(
                    "QuickNodeProvider.scan_erc20_transfers_lookback failed (%s) "
                    "blocks %d-%d: %s",
                    network_label, chunk_start, chunk_end, exc,
                )
                logs = None
            if isinstance(logs, list):
                all_logs.extend(logs)
            chunk_start = chunk_end + 1

        out: List[IncomingTx] = []
        divisor = 10 ** int(decimals)
        for log in all_logs:
            topics = log.get("topics") or []
            if len(topics) < 3:
                continue
            to_addr = "0x" + (topics[2] or "").lower()[-40:]
            if to_addr not in addr_set:
                continue
            raw_amount = _hex_to_int(log.get("data"))
            amount = raw_amount / divisor
            if amount <= 0:
                continue
            block_num = _hex_to_int(log.get("blockNumber"))
            confirmations = latest - block_num + 1 if block_num else 0
            row = addr_set[to_addr]
            asset_sym = (row.get("asset") or "").upper()
            if not asset_sym:
                continue
            out.append(IncomingTx(
                asset=asset_sym,
                network=row.get("network") or network_label,
                address=to_addr,
                tx_hash=log.get("transactionHash") or "",
                amount=float(amount),
                confirmations=int(max(0, confirmations)),
                block_height=block_num or None,
                raw={"log": log},
            ))
        return out

    async def scan_bsc_block(
        self,
        block_num: int,
        bnb_rows: List[Dict[str, Any]],
    ) -> List[IncomingTx]:
        """Scan a single BSC block for native BNB deposits (WS-driven path)."""
        if not self._bsc_rpc_url or not bnb_rows:
            return []
        bnb_addr_set = {
            (r.get("address") or "").lower(): r
            for r in bnb_rows if r.get("address")
        }
        if not bnb_addr_set:
            return []
        try:
            block = await self._rpc(
                self._bsc_rpc_url, "eth_getBlockByNumber", [hex(block_num), True],
            )
        except BlockchainError as exc:
            logger.warning("QuickNodeProvider.scan_bsc_block: block %d failed: %s", block_num, exc)
            return []
        if not isinstance(block, dict):
            return []
        out: List[IncomingTx] = []
        for tx in block.get("transactions") or []:
            to_addr = (tx.get("to") or "").lower()
            if to_addr not in bnb_addr_set:
                continue
            value = _hex_to_int(tx.get("value")) / 1e18
            if value <= 0:
                continue
            row = bnb_addr_set[to_addr]
            out.append(IncomingTx(
                asset=(row.get("asset") or "BNB").upper(),
                network="BEP-20 (BNB Chain)",
                address=tx.get("to"),
                tx_hash=tx.get("hash") or "",
                amount=float(value),
                confirmations=1,
                block_height=block_num,
                raw={"tx": tx},
            ))
        return out


# ── Factory ──────────────────────────────────────────────────────────────────
_provider_singleton: Optional[BlockchainProvider] = None


def get_provider() -> BlockchainProvider:
    """Return the shared provider, building it lazily on first call."""
    global _provider_singleton
    if _provider_singleton is not None:
        return _provider_singleton
    kind = (os.getenv("BLOCKCHAIN_PROVIDER") or "disabled").strip().lower()
    if kind in ("", "disabled", "none", "off"):
        _provider_singleton = DisabledProvider()
        logger.info("blockchain: provider disabled (set BLOCKCHAIN_PROVIDER=quicknode to enable)")
        return _provider_singleton
    if kind != "quicknode":
        logger.warning("blockchain: unknown BLOCKCHAIN_PROVIDER=%s — using disabled", kind)
        _provider_singleton = DisabledProvider()
        return _provider_singleton
    try:
        reg = get_registry()
        reg.log_startup_summary()
        _provider_singleton = QuickNodeProvider(
            mnemonic=os.getenv("BLOCKCHAIN_MASTER_MNEMONIC", "").strip(),
            passphrase=os.getenv("BLOCKCHAIN_MASTER_PASSPHRASE", "").strip(),
            btc_rpc_url=reg.http_url("btc") or "",
            eth_rpc_url=reg.http_url("eth") or "",
            usdt_contract=os.getenv("USDT_ERC20_CONTRACT", "").strip(),
            eth_lookback_blocks=int(os.getenv("DEPOSIT_POLL_ETH_LOOKBACK_BLOCKS", "20") or "20"),
            treasury_eth_private_key=os.getenv("TREASURY_ETH_PRIVATE_KEY", "").strip() or None,
            treasury_cold_private_key=os.getenv("TREASURY_COLD_PRIVATE_KEY", "").strip() or None,
            bsc_rpc_url=reg.http_url("bsc"),
            bsc_usdt_contract=os.getenv("USDT_BEP20_CONTRACT", "").strip() or None,
            tron_rpc_url=reg.http_url("tron"),
            solana_rpc_url=reg.http_url("solana"),
            usdt_trc20_contract=os.getenv("USDT_TRC20_CONTRACT", "").strip() or None,
            tron_lookback_blocks=int(os.getenv("DEPOSIT_POLL_TRON_LOOKBACK_BLOCKS", "30") or "30"),
            solana_sig_limit=int(os.getenv("DEPOSIT_POLL_SOLANA_SIG_LIMIT", "25") or "25"),
        )
        logger.info(
            "QuickNode provider enabled (btc=%s, eth=%s, bsc=%s, "
            "tron=%s, solana=%s, usdt_erc20=%s, usdt_bep20=%s, usdt_trc20=%s, treasury=%s, ibo=%s)",
            mask_rpc_url(_provider_singleton._btc_rpc_url),
            mask_rpc_url(_provider_singleton._eth_rpc_url),
            mask_rpc_url(_provider_singleton._bsc_rpc_url),
            mask_rpc_url(reg.http_url("tron")),
            mask_rpc_url(reg.http_url("solana")),
            "configured" if _provider_singleton._usdt_contract else "unset",
            "configured" if _provider_singleton._bsc_usdt_contract else "unset",
            "configured" if _provider_singleton._usdt_trc20_contract else "unset",
            "configured" if _provider_singleton._treasury_eth_addr else "absent",
            "configured" if getattr(_provider_singleton, "_ibo_contract", None) else "unset",
        )
    except ProviderUnavailable as exc:
        logger.warning("blockchain: provider init failed (%s) — falling back to disabled", exc)
        _provider_singleton = DisabledProvider()
    except Exception:  # noqa: BLE001
        logger.exception("blockchain: provider init crashed — falling back to disabled")
        _provider_singleton = DisabledProvider()
    return _provider_singleton


def reset_provider_for_tests() -> None:
    """Test helper — drop the cached singleton."""
    global _provider_singleton
    _provider_singleton = None
    reload_rpc_registry()
