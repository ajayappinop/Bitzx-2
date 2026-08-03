"""QuickNode Ethereum (+ BSC) WebSocket listener — newHeads only.

WHY no ``eth_subscribe logs``
------------------------------
Subscribing to USDT Transfer logs globally (all-network) delivers every
Transfer event on Ethereum to this process.  The USDT contract (Tether)
processes 500-2 000 transfers per block; QuickNode charges credits for
every notification pushed via the subscription.  On a busy mainnet this
burns 3 000-10 000 credits *per block* — around 50 000+ credits in two
minutes with zero user activity.

Instead the deposit poller calls ``provider.scan_usdt_block(block_num,
usdt_rows)`` once per new block.  That is a single ``eth_getLogs`` call
filtered to **only our deposit addresses**, costing ~75 credits per block
regardless of global USDT activity.

Architecture
------------
* ``new_block_event`` (``asyncio.Event``) — set on any new block (ETH
  or BSC); the deposit poller ``await``s this instead of sleeping.
* ``_latest_block`` / ``_latest_bsc_block`` — most recent block numbers.
* No log buffer.  USDT detection is done via per-block ``eth_getLogs``
  in the deposit poller, not via WS subscription.

Public API
----------
``await start()``       — idempotent; call before the deposit poller.
``await stop()``        — cancel all WS tasks; call at shutdown.
``latest_block()``      — last known ETH block number (0 if unseen).
``latest_bsc_block()``  — last known BSC block number (0 if unseen).
``is_connected()``      — True while the ETH WS is live.
``is_bsc_connected()``  — True while the BSC WS is live.

WSS URL derivation
------------------
* ETH: ``QUICKNODE_ETH_WS_URL`` (explicit) or derived from ``QUICKNODE_ETH_URL``.
* BSC: ``QUICKNODE_BSC_WS_URL`` (explicit) or derived from ``QUICKNODE_BSC_URL``.

Graceful degradation
--------------------
Missing URL or import error → module stays silent, ``is_connected()``
returns False, deposit poller falls back to REST polling at 300 s.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

from services.rpc_endpoints import get_registry, mask_rpc_url

logger = logging.getLogger(__name__)

# ── Tunables ──────────────────────────────────────────────────────────────────

# Initial reconnect wait after a WS error.
RECONNECT_BACKOFF_SEC: float = 4.0
# Exponential backoff multiplier applied after each consecutive failure.
_BACKOFF_FACTOR: float = 2.0
# Maximum wait between reconnect attempts (5 minutes).
_MAX_BACKOFF_SEC: float = 300.0
# After this many consecutive connection failures the listener gives up entirely.
# SSL errors (endpoint disabled / revoked) are permanent — no point retrying forever.
_MAX_CONSECUTIVE_FAILURES: int = 5
_WS_RECV_TIMEOUT_SEC: float = 65.0   # slightly longer than QuickNode's 60 s idle cutoff

# Error strings that indicate a permanently disabled / revoked endpoint.
# These are not transient network blips — retrying endlessly wastes nothing but logs.
_PERMANENT_ERROR_FRAGMENTS = (
    "tlsv1 alert internal error",
    "ssl: tlsv1",
    "certificate verify failed",
    "401",
    "403",
    "forbidden",
    "unauthorized",
)

# ── Shared state ─────────────────────────────────────────────────────────────

# Fires on any new block (ETH or BSC) so the deposit poller can wake up.
new_block_event: asyncio.Event = asyncio.Event()

_latest_block: int = 0       # latest ETH block
_latest_bsc_block: int = 0   # latest BSC block
_connected: bool = False      # ETH WS live
_bsc_connected: bool = False  # BSC WS live

_listener_task: Optional[asyncio.Task] = None
_bsc_listener_task: Optional[asyncio.Task] = None
_started: bool = False


# ── Public read API ───────────────────────────────────────────────────────────

def is_connected() -> bool:
    """``True`` while the Ethereum WebSocket handshake is live."""
    return _connected


def is_bsc_connected() -> bool:
    """``True`` while the BSC WebSocket handshake is live."""
    return _bsc_connected


def latest_block() -> int:
    """Most recent Ethereum block number (0 before first newHead)."""
    return _latest_block


def latest_bsc_block() -> int:
    """Most recent BSC block number (0 before first newHead)."""
    return _latest_bsc_block


# ── Hex helper ────────────────────────────────────────────────────────────────

def _hex_to_int(val: Any) -> int:
    if val is None:
        return 0
    if isinstance(val, int):
        return val
    s = str(val).strip()
    if s.startswith("0x") or s.startswith("0X"):
        try:
            return int(s, 16)
        except ValueError:
            return 0
    try:
        return int(s)
    except ValueError:
        return 0


# ── WebSocket listener loop ───────────────────────────────────────────────────

def _is_permanent_error(exc: Exception) -> bool:
    """Return True when the error indicates the endpoint is permanently unavailable.

    SSL ``TLSV1_ALERT_INTERNAL_ERROR`` means the QuickNode endpoint has been
    disabled, suspended, or the token has been revoked in the dashboard.
    Retrying endlessly is pointless — give up after ``_MAX_CONSECUTIVE_FAILURES``.
    """
    msg = str(exc).lower()
    return any(frag in msg for frag in _PERMANENT_ERROR_FRAGMENTS)


async def _listener_loop(chain: str = "eth") -> None:
    """Subscribe to newHeads only.  No log subscription — see module docstring.

    Reconnect behaviour
    -------------------
    * Successful connection → resets failure counter.
    * Transient error (network blip) → exponential back-off, up to
      ``_MAX_BACKOFF_SEC`` (300 s).
    * Permanent error (SSL / 401 / 403 — endpoint disabled or revoked) →
      counted as a failure; after ``_MAX_CONSECUTIVE_FAILURES`` consecutive
      permanent errors the loop exits cleanly.  No more log spam.
    """
    global _connected, _latest_block, _bsc_connected, _latest_bsc_block  # noqa: PLW0603

    is_bsc = chain == "bsc"
    reg = get_registry()
    chain_label = "BSC" if is_bsc else "ETH"

    if not reg.ws_url(chain):
        logger.info(
            "eth_ws_listener[%s]: no WSS URL configured — "
            "listener disabled; %s deposits will use REST fallback",
            chain_label, chain_label,
        )
        return

    try:
        import websockets  # type: ignore[import-untyped]
    except ImportError:
        logger.error(
            "eth_ws_listener[%s]: 'websockets' not installed "
            "(pip install 'websockets>=12.0') — listener disabled",
            chain_label,
        )
        return

    consecutive_failures: int = 0
    backoff: float = RECONNECT_BACKOFF_SEC

    while True:
        url = reg.ws_url(chain)
        if not url:
            logger.info(
                "eth_ws_listener[%s]: endpoint disabled (admin or env) — listener stopped",
                chain_label,
            )
            return

        # ── Give up after too many consecutive failures ──────────────────────
        if consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
            logger.error(
                "eth_ws_listener[%s]: %d consecutive connection failures — "
                "giving up.  Check your QuickNode endpoint in the dashboard "
                "(endpoint may be suspended, credits exhausted, or URL revoked).  "
                "Set DEPOSIT_POLL_ENABLED=false to suppress this check entirely.",
                chain_label, consecutive_failures,
            )
            return

        try:
            logger.info(
                "eth_ws_listener[%s]: connecting WSS %s (attempt %d/%d)",
                chain_label,
                mask_rpc_url(url),
                consecutive_failures + 1,
                _MAX_CONSECUTIVE_FAILURES,
            )
            async with websockets.connect(
                url,
                ping_interval=20,
                ping_timeout=30,
                close_timeout=5,
            ) as ws:
                # Subscribe to newHeads ONLY.
                await ws.send(json.dumps({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "eth_subscribe",
                    "params": ["newHeads"],
                }))

                if is_bsc:
                    _bsc_connected = True
                else:
                    _connected = True

                # Successful connection — reset failure counter and backoff.
                consecutive_failures = 0
                backoff = RECONNECT_BACKOFF_SEC
                logger.info(
                    "eth_ws_listener[%s]: subscribed to newHeads "
                    "(USDT detection via per-block eth_getLogs — no global log subscription)",
                    chain_label,
                )

                while True:
                    try:
                        raw = await asyncio.wait_for(
                            ws.recv(), timeout=_WS_RECV_TIMEOUT_SEC,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "eth_ws_listener[%s]: no message in %.0fs — reconnecting",
                            chain_label, _WS_RECV_TIMEOUT_SEC,
                        )
                        break

                    try:
                        _handle_message(json.loads(raw), is_bsc=is_bsc)
                    except Exception:  # noqa: BLE001
                        pass  # Malformed frame — keep running.

        except asyncio.CancelledError:
            if is_bsc:
                _bsc_connected = False
            else:
                _connected = False
            logger.info("eth_ws_listener[%s]: task cancelled", chain_label)
            raise

        except Exception as exc:  # noqa: BLE001
            consecutive_failures += 1
            permanent = _is_permanent_error(exc)

            if permanent:
                remaining = _MAX_CONSECUTIVE_FAILURES - consecutive_failures
                if remaining > 0:
                    logger.warning(
                        "eth_ws_listener[%s]: endpoint rejected connection (%s) — "
                        "retrying %d more time(s) then giving up.  "
                        "Check QuickNode dashboard.",
                        chain_label, exc, remaining,
                    )
                # Don't wait long for permanent errors — fail fast.
                backoff = min(backoff, 10.0)
            else:
                logger.warning(
                    "eth_ws_listener[%s]: WS error (%s) — reconnecting in %.0fs "
                    "(failure %d/%d)",
                    chain_label, exc, backoff,
                    consecutive_failures, _MAX_CONSECUTIVE_FAILURES,
                )

        finally:
            if is_bsc:
                _bsc_connected = False
            else:
                _connected = False

        try:
            await asyncio.sleep(backoff)
        except asyncio.CancelledError:
            raise

        # Exponential backoff for the next attempt (capped at _MAX_BACKOFF_SEC).
        backoff = min(backoff * _BACKOFF_FACTOR, _MAX_BACKOFF_SEC)


def _handle_message(msg: Any, *, is_bsc: bool = False) -> None:
    """Handle a newHeads notification — update block counter and signal poller."""
    global _latest_block, _latest_bsc_block  # noqa: PLW0603

    if not isinstance(msg, dict):
        return

    # Subscription confirmation ({"id": N, "result": "0x..."}) — ignore.
    if "id" in msg and "result" in msg and "params" not in msg:
        return

    params = msg.get("params")
    if not isinstance(params, dict):
        return
    result = params.get("result")
    if not isinstance(result, dict):
        return

    # newHead — result contains block fields (number, hash, …)
    if "number" in result:
        block_num = _hex_to_int(result.get("number"))
        if block_num > 0:
            if is_bsc:
                _latest_bsc_block = block_num
            else:
                _latest_block = block_num
            try:
                from services.rpc_usage import record_ws_head

                record_ws_head("bsc" if is_bsc else "eth")
            except Exception:
                pass
            new_block_event.set()


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def start() -> None:
    """Start the newHeads WS listener(s) (idempotent).

    Must be called **before** ``deposit_poller.start()`` so that
    ``new_block_event`` is armed before the poller first waits on it.

    BSC listener starts automatically when ``QUICKNODE_BSC_URL`` or
    ``QUICKNODE_BSC_WS_URL`` is set in the environment.
    """
    global _listener_task, _bsc_listener_task, _started  # noqa: PLW0603
    if _started and _listener_task is not None and not _listener_task.done():
        return  # Already running.

    bsc_url_set = bool(get_registry().ws_url("bsc"))

    _listener_task = asyncio.create_task(
        _listener_loop(chain="eth"),
        name="ibo-eth-ws-listener",
    )

    if bsc_url_set:
        _bsc_listener_task = asyncio.create_task(
            _listener_loop(chain="bsc"),
            name="ibo-bsc-ws-listener",
        )
        logger.info("eth_ws_listener: started ETH + BSC newHeads listeners")
    else:
        logger.info(
            "eth_ws_listener: started ETH newHeads listener "
            "(set QUICKNODE_BSC_URL to also enable BSC)"
        )

    _started = True


async def stop() -> None:
    """Stop all WS listeners.  Call during FastAPI shutdown."""
    global _listener_task, _bsc_listener_task, _started  # noqa: PLW0603
    _started = False
    for task, label in (
        (_listener_task,     "ETH"),
        (_bsc_listener_task, "BSC"),
    ):
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:  # noqa: BLE001
                logger.exception("eth_ws_listener[%s]: error while stopping", label)
    _listener_task = None
    _bsc_listener_task = None
    logger.info("eth_ws_listener: stopped")
