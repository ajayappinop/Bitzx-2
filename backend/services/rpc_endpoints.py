"""QuickNode / JSON-RPC endpoint registry — secure, per-chain, throttled.

All chain RPC URLs are loaded once from environment variables. Logs never
include auth tokens (masked as ``***``). Each distinct endpoint host gets its
own :class:`RpcTransport` (semaphore + pacing) so ETH, BSC, BTC, Tron, and
Solana can run in parallel without one chain starving another.

Env vars (HTTP required to enable; WS optional — derived from HTTP if blank):

  QUICKNODE_BTC_URL
  QUICKNODE_ETH_URL / QUICKNODE_ETH_WS_URL
  QUICKNODE_BSC_URL / QUICKNODE_BSC_WS_URL
  QUICKNODE_TRON_URL
  QUICKNODE_SOLANA_URL / QUICKNODE_SOLANA_WS_URL

Tron and Solana use the same registry; deposit scanning runs when URLs are set.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_RPC_MAX_CONCURRENCY = max(1, int(os.environ.get("RPC_MAX_CONCURRENCY", "2")))
_RPC_MIN_INTERVAL_MS = max(0, int(os.environ.get("RPC_MIN_INTERVAL_MS", "120")))
_RPC_MAX_RETRIES = max(0, int(os.environ.get("RPC_MAX_RETRIES", "4")))
_RPC_BACKOFF_BASE_MS = max(100, int(os.environ.get("RPC_BACKOFF_BASE_MS", "500")))
_RPC_BACKOFF_CAP_MS = max(1000, int(os.environ.get("RPC_BACKOFF_CAP_MS", "8000")))

# quiknode.pro/<token>/… or tron …/jsonrpc
_TOKEN_PATH_RE = re.compile(
    r"(https?://[^/]+\.quiknode\.pro/)[^/\s]+",
    re.IGNORECASE,
)


class RpcError(Exception):
    """Outbound JSON-RPC failure (rate limit, HTTP error, malformed body)."""


@dataclass(frozen=True)
class ChainEndpoint:
    """One logical chain's QuickNode configuration."""

    chain_id: str
    label: str
    http_url: Optional[str]
    ws_url: Optional[str]
    deposit_scan_enabled: bool


def normalize_http_url(url: Optional[str]) -> Optional[str]:
    u = (url or "").strip()
    return u.rstrip("/") if u else None


def derive_wss_url(http_url: Optional[str], explicit_ws: Optional[str]) -> Optional[str]:
    ws = (explicit_ws or "").strip()
    if ws:
        return ws.rstrip("/")
    http = (http_url or "").strip()
    if not http:
        return None
    if http.startswith("https://"):
        return "wss://" + http[len("https://") :].rstrip("/")
    if http.startswith("http://"):
        return "ws://" + http[len("http://") :].rstrip("/")
    return http


def mask_rpc_url(url: Optional[str]) -> str:
    """Redact path tokens for logs and admin responses."""
    if not url:
        return "<unset>"
    return _TOKEN_PATH_RE.sub(r"\1***", url)


def endpoint_key(url: str) -> str:
    """Stable key for transport pooling (one pool per QuickNode hostname)."""
    parsed = urlparse(url.strip())
    return (parsed.netloc or url).lower()


class RpcEndpointRegistry:
    """Loads and serves chain endpoint configuration from the environment."""

    _CHAIN_ENV: tuple[tuple[str, str, str, Optional[str], bool], ...] = (
        ("btc", "Bitcoin Mainnet", "QUICKNODE_BTC_URL", None, True),
        ("eth", "Ethereum Mainnet", "QUICKNODE_ETH_URL", "QUICKNODE_ETH_WS_URL", True),
        ("bsc", "BNB Smart Chain", "QUICKNODE_BSC_URL", "QUICKNODE_BSC_WS_URL", True),
        ("tron", "Tron Mainnet", "QUICKNODE_TRON_URL", None, True),
        ("solana", "Solana Mainnet", "QUICKNODE_SOLANA_URL", "QUICKNODE_SOLANA_WS_URL", True),
    )

    def __init__(self) -> None:
        self._chains: Dict[str, ChainEndpoint] = {}
        self._admin_enabled: Dict[str, bool] = {cid: True for cid, *_ in self._CHAIN_ENV}
        for chain_id, label, http_env, ws_env, scan in self._CHAIN_ENV:
            http_raw = os.getenv(http_env, "")
            ws_raw = os.getenv(ws_env, "") if ws_env else ""
            http = normalize_http_url(http_raw)
            ws = derive_wss_url(http, ws_raw) if http else None
            self._chains[chain_id] = ChainEndpoint(
                chain_id=chain_id,
                label=label,
                http_url=http,
                ws_url=ws,
                deposit_scan_enabled=scan and bool(http),
            )

    def set_admin_chain_settings(self, settings: Optional[Dict[str, Any]] = None) -> None:
        """Apply admin panel on/off toggles (see blockchain_chain_controls)."""
        from services.blockchain_chain_controls import normalize_blockchain_chain_settings

        self._admin_enabled = normalize_blockchain_chain_settings(settings)

    def is_admin_enabled(self, chain_id: str) -> bool:
        cid = (chain_id or "").strip().lower()
        return self._admin_enabled.get(cid, True)

    def _effective(self, base: ChainEndpoint) -> ChainEndpoint:
        if not self.is_admin_enabled(base.chain_id):
            return ChainEndpoint(
                chain_id=base.chain_id,
                label=base.label,
                http_url=None,
                ws_url=None,
                deposit_scan_enabled=False,
            )
        return base

    def get(self, chain_id: str) -> ChainEndpoint:
        cid = (chain_id or "").strip().lower()
        ep = self._chains.get(cid)
        if ep is None:
            raise KeyError(f"Unknown chain_id: {chain_id}")
        return self._effective(ep)

    def get_env(self, chain_id: str) -> ChainEndpoint:
        """Raw env configuration (ignores admin disable)."""
        cid = (chain_id or "").strip().lower()
        ep = self._chains.get(cid)
        if ep is None:
            raise KeyError(f"Unknown chain_id: {chain_id}")
        return ep

    def http_url(self, chain_id: str) -> Optional[str]:
        return self.get(chain_id).http_url

    def ws_url(self, chain_id: str) -> Optional[str]:
        return self.get(chain_id).ws_url

    def all_chains(self) -> List[ChainEndpoint]:
        return [self._effective(c) for c in self._chains.values()]

    def all_chains_env(self) -> List[ChainEndpoint]:
        return list(self._chains.values())

    def configured_chain_ids(self) -> List[str]:
        return [c.chain_id for c in self._chains.values() if c.http_url]

    def log_startup_summary(self) -> None:
        parts = []
        for c in self._chains.values():
            if not c.http_url:
                continue
            scan = "scan" if c.deposit_scan_enabled else "url-only"
            parts.append(f"{c.chain_id}({scan}, http={mask_rpc_url(c.http_url)})")
        if parts:
            logger.info("RPC endpoints configured: %s", ", ".join(parts))
        else:
            logger.info("RPC endpoints: none configured (set QUICKNODE_*_URL in .env)")


_registry: Optional[RpcEndpointRegistry] = None


def get_registry() -> RpcEndpointRegistry:
    global _registry
    if _registry is None:
        _registry = RpcEndpointRegistry()
    return _registry


def reload_registry() -> None:
    """Drop cached registry and transports (tests / hot reload)."""
    global _registry
    _registry = None
    RpcTransport.clear_pool()


# ── Per-endpoint JSON-RPC transport ───────────────────────────────────────────

_shared_http: Any = None


async def _shared_http_client() -> Any:
    global _shared_http
    if _shared_http is None:
        from services.blockchain_service import _load_httpx  # local import avoids cycle at import time

        httpx = _load_httpx()
        _shared_http = httpx.AsyncClient(timeout=30.0)
    return _shared_http


class RpcTransport:
    """Throttled JSON-RPC client bound to one QuickNode hostname."""

    _pool: Dict[str, RpcTransport] = {}

    def __init__(self, url: str) -> None:
        self.url = url.strip()
        self._key = endpoint_key(self.url)
        self._sem = asyncio.Semaphore(_RPC_MAX_CONCURRENCY)
        self._lock = asyncio.Lock()
        self._last_call_mono: float = 0.0

    @classmethod
    def for_url(cls, url: str) -> RpcTransport:
        if not (url or "").strip():
            raise RpcError("RPC URL is empty")
        key = endpoint_key(url)
        inst = cls._pool.get(key)
        if inst is None:
            inst = cls(url)
            cls._pool[key] = inst
        return inst

    @classmethod
    def clear_pool(cls) -> None:
        cls._pool.clear()

    async def _pace(self) -> None:
        if _RPC_MIN_INTERVAL_MS <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            min_gap = _RPC_MIN_INTERVAL_MS / 1000.0
            wait = (self._last_call_mono + min_gap) - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call_mono = time.monotonic()

    @staticmethod
    def _backoff_sec(attempt: int, *, retry_after_hdr: Optional[str]) -> float:
        if retry_after_hdr:
            try:
                val = float(retry_after_hdr)
                if val > 0:
                    return min(val, _RPC_BACKOFF_CAP_MS / 1000.0)
            except ValueError:
                pass
        base_ms = min(_RPC_BACKOFF_BASE_MS * (2**attempt), _RPC_BACKOFF_CAP_MS)
        return random.uniform(0, base_ms / 1000.0)

    async def json_rpc(self, method: str, params: Any = None) -> Any:
        from services.blockchain_service import _load_httpx
        from services.rpc_usage import record_rpc

        record_rpc(self.url, method)

        client = await _shared_http_client()
        httpx = _load_httpx()
        if params is None:
            params = []
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}

        attempt = 0
        last_exc: Optional[Exception] = None
        while attempt <= _RPC_MAX_RETRIES:
            await self._pace()
            try:
                async with self._sem:
                    resp = await client.post(self.url, json=payload)
            except httpx.TransportError as exc:
                last_exc = exc
                if attempt >= _RPC_MAX_RETRIES:
                    break
                await asyncio.sleep(self._backoff_sec(attempt, retry_after_hdr=None))
                attempt += 1
                continue

            if resp.status_code == 429:
                if attempt >= _RPC_MAX_RETRIES:
                    last_exc = RpcError(
                        f"RPC {method} rate-limited (HTTP 429) on {mask_rpc_url(self.url)}",
                    )
                    break
                sleep_sec = self._backoff_sec(
                    attempt, retry_after_hdr=resp.headers.get("Retry-After"),
                )
                logger.warning(
                    "RPC %s @ %s: 429 (attempt %d/%d) — sleep %.2fs",
                    method,
                    mask_rpc_url(self.url),
                    attempt + 1,
                    _RPC_MAX_RETRIES + 1,
                    sleep_sec,
                )
                await asyncio.sleep(sleep_sec)
                attempt += 1
                continue

            if resp.status_code >= 400:
                raise RpcError(
                    f"RPC {method} HTTP {resp.status_code} @ {mask_rpc_url(self.url)}: "
                    f"{resp.text[:200]}",
                )

            try:
                data = resp.json()
            except Exception as exc:
                raise RpcError(f"RPC {method} malformed JSON: {exc}") from exc

            if isinstance(data, dict) and data.get("error"):
                err = data["error"]
                if isinstance(err, dict):
                    code = err.get("code")
                    msg = str(err.get("message") or "").lower()
                    if code in (-32005, 429) or "rate limit" in msg or "too many" in msg:
                        if attempt >= _RPC_MAX_RETRIES:
                            raise RpcError(f"RPC {method} rate-limited: {err}")
                        await asyncio.sleep(self._backoff_sec(attempt, retry_after_hdr=None))
                        attempt += 1
                        continue
                raise RpcError(f"RPC {method} error: {err}")
            return (data or {}).get("result")

        raise RpcError(f"RPC {method} failed after retries: {last_exc}") from last_exc


def get_rpc_transport(url: str) -> RpcTransport:
    return RpcTransport.for_url(url)
