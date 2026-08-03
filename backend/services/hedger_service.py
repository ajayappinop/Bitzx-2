"""Phase 8d — Binance (testnet) spot hedger.

Why this exists
---------------

Treasury carries unhedged price risk whenever a SYSTEM fill leaves the
platform long / short some asset (see :mod:`services.treasury_service`).
This module adds a **price-risk hedge** by placing offsetting SPOT orders
on Binance: if treasury is short 5 ETH we buy 5 ETH on Binance, so the
platform is price-neutral even though it still owes the user.

Scope boundaries (important)
----------------------------

* **Price risk only.** The hedger does NOT move custody. When a user
  withdraws, on-chain funds still leave our treasury wallet — the Binance
  position just ensures we haven't lost (or gained) value on the spread
  between the SYSTEM fill and the user's eventual withdrawal. Bridging
  Binance-held inventory back to on-chain treasury addresses is an ops
  task outside this worker's mandate.
* **Testnet-first.** Default base URL is ``https://testnet.binance.vision``.
  Set ``BINANCE_TESTNET=false`` to point at production, but the admin
  panel still requires ``hedger_dry_run=false`` *and* a non-OFF per-symbol
  mode before any order is actually placed.
* **Spot only.** No futures / no margin. Hedge BUY consumes USDT, hedge
  SELL consumes base. The admin must fund the Binance account manually.

State model
-----------

Two new Mongo collections:

- ``hedger_state`` — one row per symbol, tracks ``net_hedged_qty``
  (signed: positive = cumulative BUY hedges, negative = cumulative
  SELL hedges), ``last_hedge_at``, and the most recent suggestion.
  Effective unhedged exposure = ``treasury_pos + net_hedged_qty``.
- ``hedge_trades`` — one row per hedge attempt. Never deleted. Stores
  Binance's raw response + any error body so ops can replay failures.

Per-symbol config lives in ``platform_controls.hedger_by_symbol`` so the
admin UI can edit it live. Global knobs (``hedger_enabled``,
``hedger_dry_run``, ``hedger_price_sanity_bps``) sit alongside.

Safety rails
------------

1. **Kill switch.** ``platform_controls.hedger_enabled=False`` (default
   False) stops every mode. No orders placed, no suggestions stored.
2. **Dry run.** ``platform_controls.hedger_dry_run=True`` (default True)
   logs every hedge as ``status="dry_run"`` with no HTTP call.
3. **Per-symbol mode.** ``off`` / ``manual`` / ``auto``. Default ``off``.
   Only ``auto`` lets the worker place orders; ``manual`` surfaces
   suggestions that ops execute explicitly via the admin endpoint.
4. **Max hedge size** per execution. Clamp the target qty so a bad
   treasury signal can't nuke the Binance balance in one shot.
5. **Cooldown.** Minimum seconds between successive hedges on the same
   symbol — defends against flapping.
6. **Rebalance threshold.** Ignore exposures smaller than this. Avoids
   death-by-a-thousand-small-orders.
7. **Price sanity.** Refuse to hedge when |treasury mark - Binance mark|
   exceeds ``hedger_price_sanity_bps`` (default 50 bps = 0.5%). Protects
   against stale feeds / arbitrage bots manipulating the Binance quote.
8. **LOT_SIZE / MIN_NOTIONAL.** Quantity is rounded down to Binance's
   ``stepSize`` and rejected below ``minNotional``. Eliminates the whole
   class of ``-1013 Filter failure`` errors before sending.
9. **Retry.** Transient HTTP / 5xx Binance errors retry up to
   ``HEDGER_MAX_RETRIES`` with capped exponential backoff. 4xx and
   signed-error bodies are not retried (always a config or logic bug).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import math
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple
from urllib.parse import urlencode

from . import alert_service
from .db import get_db

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Constants + helpers
# ─────────────────────────────────────────────────────────────────────────────

HEDGE_TRADES = "hedge_trades"
HEDGER_STATE = "hedger_state"
HEDGER_BASELINES = "hedger_baselines"

Mode = Literal["off", "manual", "auto"]
ModeValue: Tuple[str, ...] = ("off", "manual", "auto")

# Default per-symbol config. Merged with platform_controls overrides so an
# unknown symbol still has sensible thresholds.
DEFAULT_SYMBOL_CONFIG: Dict[str, Any] = {
    "mode":                 "off",
    "rebalance_threshold":  1.0,    # in base units
    "max_hedge_size":       1.0,    # in base units, per single hedge
    "cooldown_sec":         30.0,
}

# Testnet is authoritative by default — ops must explicitly opt out.
_TESTNET_BASE_URL = "https://testnet.binance.vision"
_MAINNET_BASE_URL = "https://api.binance.com"

_RECV_WINDOW_MS = 5000    # Binance server-clock skew tolerance
_HTTP_TIMEOUT_S = 10.0

_MAX_RETRIES_DEFAULT = 3
_BACKOFF_BASE_MS = 300.0
_BACKOFF_CAP_MS  = 4_000.0

# Symbols the hedger should never touch even if admin flips them ON. IBO is
# not listed on Binance so hedging is impossible; other bases may be added
# later if they're not on Binance Spot.
UNHEDGEABLE_BASES: frozenset[str] = frozenset({"IBO"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round8(v: float) -> float:
    return round(float(v), 8)


def _env_bool(key: str, default: bool = False) -> bool:
    raw = (os.getenv(key) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key) or default)
    except (TypeError, ValueError):
        return default


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key) or default)
    except (TypeError, ValueError):
        return default


# ─────────────────────────────────────────────────────────────────────────────
# Exceptions
# ─────────────────────────────────────────────────────────────────────────────

class HedgerError(Exception):
    """Base for hedger errors surfaced to callers."""


class HedgerConfigError(HedgerError):
    """Missing API key, malformed config, etc."""


class HedgerSafetyError(HedgerError):
    """A safety rail triggered — cooldown, sanity check, LOT_SIZE, etc."""


class BinanceAPIError(HedgerError):
    """Binance returned a logical error (signed body with ``code`` field)."""

    def __init__(self, code: int, msg: str, *, http_status: Optional[int] = None):
        super().__init__(f"binance[{code}] {msg}")
        self.code = int(code)
        self.msg = str(msg)
        self.http_status = http_status


# ─────────────────────────────────────────────────────────────────────────────
# httpx lazy loader (same pattern as blockchain_service to avoid hard dep)
# ─────────────────────────────────────────────────────────────────────────────

def _load_httpx():  # noqa: ANN201
    try:
        import httpx  # type: ignore
    except ImportError as exc:  # pragma: no cover — install check
        raise HedgerConfigError(
            "httpx is required for the hedger. Install it: pip install httpx>=0.27",
        ) from exc
    return httpx


# ─────────────────────────────────────────────────────────────────────────────
# Binance client
# ─────────────────────────────────────────────────────────────────────────────

class BinanceClient:
    """Tiny Binance Spot REST client focused on the hedger's needs.

    Scope:

    - ``ticker_price(symbol)`` — public, unsigned.
    - ``exchange_info()`` — public, unsigned, cached for 10 min.
    - ``account()`` — signed.
    - ``new_order(symbol, side, qty)`` — signed, MARKET only.

    Why not ``python-binance``? Pulling another dep + keeping it in sync
    isn't worth it for 4 endpoints. The signing below is identical to
    what that library does.
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        testnet: Optional[bool] = None,
    ):
        self._api_key = (api_key or os.getenv("BINANCE_API_KEY") or "").strip()
        self._api_secret = (api_secret or os.getenv("BINANCE_API_SECRET") or "").strip()
        tn = testnet
        if tn is None:
            tn = _env_bool("BINANCE_TESTNET", True)
        self._testnet = bool(tn)
        self._base = _TESTNET_BASE_URL if self._testnet else _MAINNET_BASE_URL
        self._client = None  # httpx.AsyncClient — lazily created
        self._exchange_info_cache: Optional[Dict[str, Any]] = None
        self._exchange_info_expiry: float = 0.0
        # Protect the AsyncClient creation under concurrent startup.
        self._init_lock = asyncio.Lock()

    @property
    def testnet(self) -> bool:
        return self._testnet

    @property
    def base_url(self) -> str:
        return self._base

    @property
    def has_credentials(self) -> bool:
        return bool(self._api_key and self._api_secret)

    async def _http(self):  # noqa: ANN201
        """Return (or lazily build) the shared ``httpx.AsyncClient``."""
        if self._client is not None:
            return self._client
        async with self._init_lock:
            if self._client is None:
                httpx = _load_httpx()
                self._client = httpx.AsyncClient(
                    base_url=self._base,
                    timeout=_HTTP_TIMEOUT_S,
                    headers={"X-MBX-APIKEY": self._api_key} if self._api_key else {},
                )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._client = None

    # ── signing ────────────────────────────────────────────────────────────
    def _sign(self, params: Dict[str, Any]) -> str:
        query = urlencode(params, doseq=True)
        mac = hmac.new(
            self._api_secret.encode("utf-8"),
            query.encode("utf-8"),
            hashlib.sha256,
        )
        return mac.hexdigest()

    # ── generic request ───────────────────────────────────────────────────
    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        signed: bool = False,
    ) -> Any:
        params = dict(params or {})
        if signed:
            if not self.has_credentials:
                raise HedgerConfigError(
                    "BINANCE_API_KEY / BINANCE_API_SECRET are required for signed endpoints.",
                )
            params["timestamp"] = int(time.time() * 1000)
            params["recvWindow"] = _RECV_WINDOW_MS
            params["signature"] = self._sign(params)

        http = await self._http()
        httpx = _load_httpx()
        attempts = _env_int("HEDGER_MAX_RETRIES", _MAX_RETRIES_DEFAULT)
        last_exc: Optional[Exception] = None

        for attempt in range(attempts + 1):
            try:
                if method == "GET":
                    resp = await http.get(path, params=params)
                elif method == "POST":
                    # Binance expects POST params in query-string (not body)
                    # for signed endpoints — that's how the signature was
                    # computed above.
                    resp = await http.post(path, params=params)
                else:  # pragma: no cover — only GET/POST used today
                    raise HedgerError(f"unsupported HTTP method: {method}")
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_exc = exc
                if attempt >= attempts:
                    break
                await asyncio.sleep(self._backoff_sec(attempt))
                continue

            # 4xx with a Binance ``code`` field — business error, don't retry.
            if 400 <= resp.status_code < 500:
                try:
                    body = resp.json()
                except Exception:  # noqa: BLE001
                    body = {"msg": resp.text[:200]}
                raise BinanceAPIError(
                    code=int(body.get("code") or resp.status_code),
                    msg=str(body.get("msg") or resp.text[:200]),
                    http_status=resp.status_code,
                )

            if resp.status_code >= 500:
                # Transient — back off and retry.
                last_exc = HedgerError(
                    f"binance 5xx ({resp.status_code}): {resp.text[:200]}",
                )
                if attempt >= attempts:
                    break
                await asyncio.sleep(self._backoff_sec(attempt))
                continue

            try:
                return resp.json()
            except Exception as exc:  # noqa: BLE001
                raise HedgerError(f"binance malformed response: {exc}") from exc

        raise HedgerError(f"binance request failed after retries: {last_exc}")

    @staticmethod
    def _backoff_sec(attempt: int) -> float:
        base_ms = _env_float("HEDGER_BACKOFF_BASE_MS", _BACKOFF_BASE_MS)
        cap_ms = _env_float("HEDGER_BACKOFF_CAP_MS", _BACKOFF_CAP_MS)
        raw_ms = min(cap_ms, base_ms * (2 ** attempt))
        jitter_ms = random.uniform(0, raw_ms / 2.0)
        return (raw_ms - jitter_ms) / 1000.0

    # ── public endpoints ──────────────────────────────────────────────────
    async def ticker_price(self, symbol: str) -> float:
        """Return the current Binance spot price for *symbol*.

        Checks the shared WS feed cache first (zero REST when fresh);
        falls back to a signed REST call when the cache is absent or stale.
        """
        sym = symbol.upper()

        # WS feed cache — check before making any REST call.
        try:
            from services import binance_spot_feed  # type: ignore[import]
            ws_price, ws_age = binance_spot_feed.get_price(sym)
            if ws_price is not None and ws_age <= binance_spot_feed.STALE_AFTER_SEC:
                return ws_price
        except Exception:  # noqa: BLE001
            pass  # Feed not yet started — fall through to REST.

        data = await self._request(
            "GET", "/api/v3/ticker/price",
            params={"symbol": sym},
        )
        try:
            return float(data.get("price"))
        except (TypeError, ValueError) as exc:
            raise HedgerError(f"invalid price payload: {data}") from exc

    async def exchange_info(self, *, ttl_sec: float = 600.0) -> Dict[str, Any]:
        now = time.time()
        if self._exchange_info_cache and self._exchange_info_expiry > now:
            return self._exchange_info_cache
        data = await self._request("GET", "/api/v3/exchangeInfo")
        self._exchange_info_cache = data
        self._exchange_info_expiry = now + ttl_sec
        return data

    async def symbol_filters(self, symbol: str) -> Dict[str, Any]:
        """Return ``{step_size, min_qty, min_notional}`` for ``symbol``.

        Parsed from ``exchangeInfo`` and cached with it. Returns defaults
        if the symbol isn't listed so callers can fall back cleanly.
        """
        info = await self.exchange_info()
        sym = symbol.upper()
        for s in info.get("symbols") or []:
            if s.get("symbol") != sym:
                continue
            step_size = 0.0
            min_qty = 0.0
            min_notional = 0.0
            for f in s.get("filters") or []:
                ft = f.get("filterType")
                if ft == "LOT_SIZE":
                    step_size = float(f.get("stepSize") or 0.0)
                    min_qty = float(f.get("minQty") or 0.0)
                elif ft in ("MIN_NOTIONAL", "NOTIONAL"):
                    # Binance renamed MIN_NOTIONAL → NOTIONAL on some pairs
                    # (both shapes seen in the wild).
                    min_notional = float(
                        f.get("minNotional") or f.get("notional") or 0.0,
                    )
            return {
                "step_size": step_size,
                "min_qty":   min_qty,
                "min_notional": min_notional,
                "status":    s.get("status", "UNKNOWN"),
            }
        return {
            "step_size": 0.0, "min_qty": 0.0, "min_notional": 0.0,
            "status": "NOT_LISTED",
        }

    # ── signed endpoints ─────────────────────────────────────────────────
    async def account(self) -> Dict[str, Any]:
        return await self._request("GET", "/api/v3/account", signed=True)

    async def new_market_order(
        self,
        symbol: str,
        side: Literal["BUY", "SELL"],
        quantity: float,
        client_order_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Place a MARKET order. Returns the full Binance response dict.

        We use ``quantity`` (base units) for both sides. Binance also
        supports ``quoteOrderQty`` for buys-by-quote, but sizing our
        hedges in base units keeps the math consistent with the treasury.
        """
        params: Dict[str, Any] = {
            "symbol":   symbol.upper(),
            "side":     side.upper(),
            "type":     "MARKET",
            "quantity": _format_qty(quantity),
        }
        if client_order_id:
            params["newClientOrderId"] = str(client_order_id).strip()[:36]
        return await self._request("POST", "/api/v3/order",
                                    params=params, signed=True)


# ─────────────────────────────────────────────────────────────────────────────
# Qty / filter helpers
# ─────────────────────────────────────────────────────────────────────────────

def _format_qty(q: float) -> str:
    """Binance rejects scientific notation; render a plain decimal."""
    s = f"{q:.8f}".rstrip("0").rstrip(".")
    return s if s else "0"


def round_to_step(qty: float, step_size: float) -> float:
    """Round ``qty`` DOWN to the nearest multiple of ``step_size``.

    Mirrors Binance's ``LOT_SIZE`` filter exactly. ``step_size=0`` means
    the symbol has no LOT_SIZE constraint (rare for spot pairs).
    """
    if qty <= 0 or step_size <= 0:
        return max(0.0, float(qty))
    # Avoid float accumulation by working in steps of step_size.
    n_steps = math.floor(qty / step_size)
    return round(n_steps * step_size, 12)


# ─────────────────────────────────────────────────────────────────────────────
# Config resolution (merges defaults + platform_controls overrides)
# ─────────────────────────────────────────────────────────────────────────────

def resolve_symbol_config(controls: Dict[str, Any], symbol: str) -> Dict[str, Any]:
    """Effective hedger config for a symbol.

    Precedence: per-symbol override > ``hedger_default_mode`` > hard-coded
    :data:`DEFAULT_SYMBOL_CONFIG`. Invalid values fall back to defaults
    (never raises).
    """
    sym = (symbol or "").upper()
    cfg = dict(DEFAULT_SYMBOL_CONFIG)
    default_mode = str(controls.get("hedger_default_mode") or cfg["mode"]).lower()
    if default_mode in ModeValue:
        cfg["mode"] = default_mode
    overrides = controls.get("hedger_by_symbol") or {}
    sym_cfg = overrides.get(sym) if isinstance(overrides, dict) else None
    if isinstance(sym_cfg, dict):
        mode = str(sym_cfg.get("mode") or "").lower()
        if mode in ModeValue:
            cfg["mode"] = mode
        for key in ("rebalance_threshold", "max_hedge_size", "cooldown_sec"):
            raw = sym_cfg.get(key)
            if raw is None:
                continue
            try:
                fv = float(raw)
            except (TypeError, ValueError):
                continue
            if fv < 0:
                continue
            cfg[key] = fv
    return cfg


# ─────────────────────────────────────────────────────────────────────────────
# State helpers
# ─────────────────────────────────────────────────────────────────────────────

async def get_state(symbol: str) -> Dict[str, Any]:
    """Runtime state row for ``symbol``. Upserts a zeroed row on first read."""
    db = get_db()
    if db is None:
        return _empty_state(symbol)
    sym = symbol.upper()
    doc = await db[HEDGER_STATE].find_one({"id": sym}, {"_id": 0})
    if doc:
        return doc
    doc = _empty_state(sym)
    try:
        await db[HEDGER_STATE].insert_one(dict(doc))
    except Exception:  # noqa: BLE001 — race on first insert
        existing = await db[HEDGER_STATE].find_one({"id": sym}, {"_id": 0})
        if existing:
            return existing
    return doc


def _empty_state(symbol: str) -> Dict[str, Any]:
    return {
        "id":                 symbol.upper(),
        "net_hedged_qty":     0.0,
        "last_hedge_at":      None,
        "last_evaluated_at":  None,
        "last_suggestion":    None,
        "created_at":         _now_iso(),
        "updated_at":         _now_iso(),
    }


async def list_state() -> List[Dict[str, Any]]:
    db = get_db()
    if db is None:
        return []
    cur = db[HEDGER_STATE].find({}, {"_id": 0})
    return await cur.to_list(length=500)


async def list_trades(
    limit: int = 100, symbol: Optional[str] = None,
) -> List[Dict[str, Any]]:
    db = get_db()
    if db is None:
        return []
    filt: Dict[str, Any] = {}
    if symbol:
        filt["symbol"] = symbol.upper()
    cur = (
        db[HEDGE_TRADES].find(filt, {"_id": 0})
        .sort("created_at", -1)
        .limit(int(limit))
    )
    return await cur.to_list(length=int(limit))


# ─────────────────────────────────────────────────────────────────────────────
# Suggestion engine
# ─────────────────────────────────────────────────────────────────────────────

def suggest_hedge(
    *,
    symbol: str,
    treasury_pos_base: float,
    net_hedged_qty: float,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """Compute the ideal hedge action for ``symbol``.

    Returns a dict shaped like::

        {
          "symbol":               "ETHUSDT",
          "exposure":             -5.0,        # treasury + net_hedged
          "target_qty":           5.0,         # clamped absolute qty
          "side":                 "buy"|"sell"|None,
          "reason":               "rebalance"|"within_threshold"|"unhedgeable",
          "threshold":            1.0,
          "max_hedge_size":       5.0,
        }

    ``side is None`` means "do nothing". Pure math — never touches the DB
    or makes HTTP calls, so it's trivially unit-testable.
    """
    sym = symbol.upper()
    base = _base_from_symbol(sym)
    threshold = float(config.get("rebalance_threshold") or 0.0)
    max_size = float(config.get("max_hedge_size") or 0.0)
    exposure = float(treasury_pos_base) + float(net_hedged_qty)

    if base in UNHEDGEABLE_BASES:
        return {
            "symbol": sym, "exposure": _round8(exposure),
            "target_qty": 0.0, "side": None, "reason": "unhedgeable",
            "threshold": threshold, "max_hedge_size": max_size,
        }

    if abs(exposure) < max(threshold, 1e-12):
        return {
            "symbol": sym, "exposure": _round8(exposure),
            "target_qty": 0.0, "side": None, "reason": "within_threshold",
            "threshold": threshold, "max_hedge_size": max_size,
        }

    # Need to move exposure toward zero. If exposure is negative (treasury
    # net short), we need to BUY to offset. Positive exposure → SELL.
    side: Literal["buy", "sell"] = "buy" if exposure < 0 else "sell"
    raw_qty = abs(exposure)
    target_qty = min(raw_qty, max_size) if max_size > 0 else raw_qty

    return {
        "symbol": sym,
        "exposure": _round8(exposure),
        "target_qty": _round8(target_qty),
        "side": side,
        "reason": "rebalance",
        "threshold": threshold,
        "max_hedge_size": max_size,
    }


def _base_from_symbol(symbol: str) -> str:
    """Extract the base asset from a ``*USDT`` symbol (our only quote)."""
    sym = symbol.upper()
    if sym.endswith("USDT"):
        return sym[:-4]
    return sym


# ─────────────────────────────────────────────────────────────────────────────
# Cooldown
# ─────────────────────────────────────────────────────────────────────────────

def _cooldown_remaining_sec(state: Dict[str, Any], cooldown_sec: float) -> float:
    """Seconds left on the cooldown for this symbol. 0 means ready."""
    if cooldown_sec <= 0:
        return 0.0
    last = state.get("last_hedge_at")
    if not last:
        return 0.0
    try:
        last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return 0.0
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
    return max(0.0, float(cooldown_sec) - elapsed)


# ─────────────────────────────────────────────────────────────────────────────
# Execution
# ─────────────────────────────────────────────────────────────────────────────

async def execute_hedge(
    *,
    symbol: str,
    side: Literal["buy", "sell"],
    qty: float,
    reason: str,
    initiator: Literal["admin", "worker"],
    controls: Dict[str, Any],
    client: BinanceClient,
    treasury_mark: Optional[float],
    admin_email: Optional[str] = None,
    mode: Mode,
    client_order_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Place a hedge (or dry-run log one) and persist the result.

    Validates every safety rail before calling Binance. Every attempt —
    successful or not — writes a ``hedge_trades`` row so ops can audit
    the full history from the admin panel.

    Returns the inserted ``hedge_trades`` doc.
    """
    sym = symbol.upper()
    base = _base_from_symbol(sym)
    if base in UNHEDGEABLE_BASES:
        raise HedgerSafetyError(f"{base} is not hedgeable (no Binance market)")

    if side not in ("buy", "sell"):
        raise HedgerSafetyError(f"invalid side: {side}")
    qty = float(qty)
    if qty <= 0 or not math.isfinite(qty):
        raise HedgerSafetyError(f"invalid qty: {qty}")

    cfg = resolve_symbol_config(controls, sym)
    state = await get_state(sym)

    # ── safety rails ──────────────────────────────────────────────────────
    # Cooldown applies to manual executions too — prevents double-submit
    # and guards against UI bugs.
    cooldown_left = _cooldown_remaining_sec(state, float(cfg["cooldown_sec"]))
    if cooldown_left > 0:
        raise HedgerSafetyError(
            f"cooldown active — {cooldown_left:.1f}s remaining",
        )

    # Clamp to max_hedge_size.
    max_size = float(cfg.get("max_hedge_size") or 0.0)
    if max_size > 0 and qty > max_size:
        qty = max_size

    # Apply Binance LOT_SIZE / MIN_NOTIONAL.
    filters = await client.symbol_filters(sym)
    if filters.get("status") == "NOT_LISTED":
        raise HedgerSafetyError(f"{sym} is not listed on Binance ({client.base_url})")
    step = float(filters.get("step_size") or 0.0)
    qty = round_to_step(qty, step) if step > 0 else qty
    if qty < float(filters.get("min_qty") or 0.0):
        raise HedgerSafetyError(
            f"qty below Binance minQty ({filters.get('min_qty')})",
        )

    # Price sanity.
    try:
        binance_price = await client.ticker_price(sym)
    except Exception as exc:  # noqa: BLE001
        raise HedgerError(f"could not fetch Binance price for sanity check: {exc}") from exc
    if treasury_mark and treasury_mark > 0 and binance_price > 0:
        sanity_bps = float(controls.get("hedger_price_sanity_bps") or 50.0)
        drift_bps = abs(binance_price - treasury_mark) / binance_price * 10_000.0
        if drift_bps > sanity_bps:
            raise HedgerSafetyError(
                f"price drift {drift_bps:.1f} bps vs treasury mark — "
                f"exceeds sanity cap of {sanity_bps:.1f} bps",
            )

    notional = qty * binance_price
    if notional < float(filters.get("min_notional") or 0.0):
        raise HedgerSafetyError(
            f"notional ${notional:.2f} below Binance minNotional "
            f"${filters.get('min_notional')}",
        )

    dry_run = bool(controls.get("hedger_dry_run"))
    attempt_id = f"hdg_{uuid.uuid4().hex[:16]}"
    db = get_db()
    now = _now_iso()

    # ── insert 'submitted' (or 'dry_run') row ─────────────────────────────
    trade_doc: Dict[str, Any] = {
        "id":                  attempt_id,
        "symbol":              sym,
        "side":                side,
        "requested_qty":       _round8(qty),
        "executed_qty":        0.0,
        "treasury_mark":       _round8(treasury_mark or 0.0),
        "binance_price":       _round8(binance_price),
        "notional_usdt":       _round8(notional),
        "binance_order_id":    None,
        "binance_client_id":   (str(client_order_id).strip()[:36] if client_order_id else None),
        "status":              "dry_run" if dry_run else "submitted",
        "reason":              reason,
        "mode":                mode,
        "initiator":           initiator,
        "initiator_email":     admin_email,
        "testnet":             client.testnet,
        "dry_run":             dry_run,
        "filters":             filters,
        "error":               None,
        "response":            None,
        "created_at":          now,
        "updated_at":          now,
    }
    if db is not None:
        await db[HEDGE_TRADES].insert_one(dict(trade_doc))

    if dry_run:
        logger.info(
            "hedger: DRY-RUN %s %s %s @ %.6f (reason=%s)",
            side, qty, sym, binance_price, reason,
        )
        await _bump_state_after_hedge(
            sym, qty=qty, side=side, now=now,
        )
        return trade_doc

    # ── send the order ────────────────────────────────────────────────────
    try:
        resp = await client.new_market_order(sym, side.upper(), qty, client_order_id=client_order_id)
    except BinanceAPIError as exc:
        err = f"[{exc.code}] {exc.msg}"
        await _mark_trade(attempt_id, status="failed",
                          error=err, response=None)
        trade_doc.update(status="failed", error=err)
        await _alert_hedge_failure(
            symbol=sym, side=side, qty=qty, err=err, trade_id=attempt_id,
            initiator=initiator, controls=controls,
        )
        return trade_doc
    except HedgerError as exc:
        err = str(exc)
        await _mark_trade(attempt_id, status="failed",
                          error=err, response=None)
        trade_doc.update(status="failed", error=err)
        await _alert_hedge_failure(
            symbol=sym, side=side, qty=qty, err=err, trade_id=attempt_id,
            initiator=initiator, controls=controls,
        )
        return trade_doc

    # Parse fills (MARKET orders return ``fills`` with per-lot prices).
    executed_qty = float(resp.get("executedQty") or 0.0)
    fills = resp.get("fills") or []
    if fills:
        avg_px = sum(float(f.get("price") or 0.0) * float(f.get("qty") or 0.0)
                     for f in fills) / max(executed_qty, 1e-12)
    else:
        avg_px = binance_price
    status = "filled" if (resp.get("status") == "FILLED") else str(resp.get("status") or "submitted").lower()

    await _mark_trade(
        attempt_id,
        status=status,
        executed_qty=executed_qty,
        binance_order_id=str(resp.get("orderId") or ""),
        binance_client_id=str(resp.get("clientOrderId") or ""),
        avg_price=avg_px,
        response=resp,
    )
    if executed_qty > 0:
        await _bump_state_after_hedge(sym, qty=executed_qty, side=side, now=now)
    trade_doc.update(
        status=status,
        executed_qty=_round8(executed_qty),
        binance_order_id=str(resp.get("orderId") or ""),
        binance_client_id=str(resp.get("clientOrderId") or ""),
        response=resp,
    )
    logger.info(
        "hedger: %s %s %s executed=%.8f @ avg %.6f (order=%s status=%s)",
        side, qty, sym, executed_qty, avg_px,
        resp.get("orderId"), status,
    )
    return trade_doc


async def _alert_hedge_failure(
    *,
    symbol: str,
    side: str,
    qty: float,
    err: str,
    trade_id: str,
    initiator: str,
    controls: Dict[str, Any],
) -> None:
    """Raise a critical alert when a hedge execution fails after the
    hedge_trades row was written. Dedupes by symbol so repeated
    failures on the same pair fold into one row instead of spamming."""
    try:
        webhook_url = str(controls.get("alert_webhook_url") or "").strip() or None
        webhook_min_sev = str(
            controls.get("alert_webhook_min_severity") or ""
        ).strip().lower() or None
        await alert_service.raise_alert(
            type="hedger.execute.failed",
            severity="critical",
            source="hedger",
            title=f"Hedge execution failed — {symbol}",
            message=(
                f"Binance {side.upper()} {qty} {symbol} failed "
                f"({initiator}): {err}"
            ),
            meta={
                "symbol":    symbol,
                "side":      side,
                "qty":       qty,
                "initiator": initiator,
                "trade_id":  trade_id,
                "error":     err,
            },
            dedupe_key=f"hedger.execute.failed:{symbol}",
            webhook_url=webhook_url,
            webhook_min_severity=webhook_min_sev,
        )
    except Exception:  # noqa: BLE001
        # Never let a failing alert path cascade into the caller. The
        # hedge_trades row already captures the failure permanently.
        logger.exception("alerts: hedge-failure raise failed symbol=%s", symbol)


async def _mark_trade(
    trade_id: str,
    *,
    status: str,
    executed_qty: float = 0.0,
    binance_order_id: Optional[str] = None,
    binance_client_id: Optional[str] = None,
    avg_price: Optional[float] = None,
    response: Any = None,
    error: Optional[str] = None,
) -> None:
    db = get_db()
    if db is None:
        return
    patch: Dict[str, Any] = {
        "status":      status,
        "updated_at":  _now_iso(),
    }
    if executed_qty:
        patch["executed_qty"] = _round8(executed_qty)
    if binance_order_id is not None:
        patch["binance_order_id"] = binance_order_id
    if binance_client_id is not None:
        patch["binance_client_id"] = binance_client_id
    if avg_price is not None:
        patch["avg_price"] = _round8(avg_price)
    if response is not None:
        patch["response"] = response
    if error is not None:
        patch["error"] = error
    await db[HEDGE_TRADES].update_one({"id": trade_id}, {"$set": patch})


async def _bump_state_after_hedge(
    symbol: str,
    *,
    qty: float,
    side: Literal["buy", "sell"],
    now: str,
) -> None:
    """Update ``hedger_state`` after a successful hedge (or dry-run)."""
    db = get_db()
    if db is None:
        return
    sym = symbol.upper()
    delta = float(qty) if side == "buy" else -float(qty)
    await db[HEDGER_STATE].update_one(
        {"id": sym},
        {
            "$inc": {"net_hedged_qty": delta},
            "$set": {
                "last_hedge_at": now,
                "updated_at":    now,
            },
            "$setOnInsert": {
                "id":                sym,
                "last_evaluated_at": None,
                "last_suggestion":   None,
                "created_at":        now,
            },
        },
        upsert=True,
    )


async def record_evaluation(
    symbol: str,
    *,
    suggestion: Dict[str, Any],
) -> None:
    """Attach the most recent suggestion to the symbol's state row.

    Called by the worker on every tick so the admin dashboard can show a
    live "what would the hedger do right now?" value without re-computing
    in the UI.
    """
    db = get_db()
    if db is None:
        return
    now = _now_iso()
    await db[HEDGER_STATE].update_one(
        {"id": symbol.upper()},
        {
            "$set": {
                "last_evaluated_at": now,
                "last_suggestion":   suggestion,
                "updated_at":        now,
            },
            "$setOnInsert": {
                "id":             symbol.upper(),
                "net_hedged_qty": 0.0,
                "last_hedge_at":  None,
                "created_at":     now,
            },
        },
        upsert=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Singleton client (lazy)
# ─────────────────────────────────────────────────────────────────────────────

_client_singleton: Optional[BinanceClient] = None
_client_lock = asyncio.Lock()


async def get_client() -> BinanceClient:
    global _client_singleton  # noqa: PLW0603
    if _client_singleton is not None:
        return _client_singleton
    async with _client_lock:
        if _client_singleton is None:
            _client_singleton = BinanceClient()
    return _client_singleton


async def shutdown_client() -> None:
    global _client_singleton  # noqa: PLW0603
    if _client_singleton is not None:
        await _client_singleton.close()
        _client_singleton = None


# ─────────────────────────────────────────────────────────────────────────────
# Phase 9a — Reconciliation
# ─────────────────────────────────────────────────────────────────────────────
#
# Compare the Binance account's *actual* holdings against what the hedger
# *thinks* it holds. Drift is expected in real ops (seed capital, manual
# interventions, partial-fill stragglers), so the formula subtracts a
# baseline that admin snapshots explicitly:
#
#     expected = baseline + sum(net_hedged_qty over symbols with base=asset)
#     drift    = binance_balance - expected
#
# Baseline default is 0 — admin must call the snapshot endpoint after they
# fund Binance with seed capital. This is intentional so ops has to think
# about it; an auto-snapshot would mask a real drift event as "just the
# initial balance".


async def get_binance_balances(
    client: "BinanceClient", *, include_zero: bool = False,
) -> Dict[str, Dict[str, float]]:
    """Fetch Binance spot balances, keyed by uppercase asset.

    Returns ``{asset: {free, locked, total}}``. Filters out zero balances
    by default so the admin table only shows assets that actually matter.
    """
    acct = await client.account()
    out: Dict[str, Dict[str, float]] = {}
    for row in (acct.get("balances") or []):
        asset = str(row.get("asset") or "").upper()
        if not asset:
            continue
        try:
            free = float(row.get("free") or 0.0)
            locked = float(row.get("locked") or 0.0)
        except (TypeError, ValueError):
            continue
        total = free + locked
        if not include_zero and total <= 0:
            continue
        out[asset] = {
            "free":   round(free, 8),
            "locked": round(locked, 8),
            "total":  round(total, 8),
        }
    return out


async def get_baseline(asset: str) -> Dict[str, Any]:
    """Return the seed-capital baseline for ``asset``. Defaults to zero."""
    db = get_db()
    if db is None:
        return {"id": asset.upper(), "qty": 0.0, "snapshot_at": None,
                "snapshot_by": None, "note": None}
    doc = await db[HEDGER_BASELINES].find_one(
        {"id": asset.upper()}, {"_id": 0},
    )
    if not doc:
        return {"id": asset.upper(), "qty": 0.0, "snapshot_at": None,
                "snapshot_by": None, "note": None}
    return doc


async def list_baselines() -> List[Dict[str, Any]]:
    db = get_db()
    if db is None:
        return []
    cur = db[HEDGER_BASELINES].find({}, {"_id": 0})
    return await cur.to_list(length=500)


async def snapshot_baselines(
    balances: Dict[str, Dict[str, float]],
    *,
    snapshot_by: Optional[str],
    note: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Overwrite ``hedger_baselines`` with the current Binance totals.

    Called by the admin "Snapshot baseline" action after funding the
    Binance account with seed capital. We store ONE row per asset —
    previous baselines for the same asset are replaced atomically.

    Idempotent: calling twice with the same input produces the same
    final state.
    """
    db = get_db()
    if db is None:
        return []
    now = _now_iso()
    rows: List[Dict[str, Any]] = []
    for asset, bal in balances.items():
        qty = float(bal.get("total") or 0.0)
        doc = {
            "id":           asset.upper(),
            "qty":          round(qty, 8),
            "snapshot_at":  now,
            "snapshot_by":  snapshot_by,
            "note":         (note or "").strip() or None,
        }
        await db[HEDGER_BASELINES].update_one(
            {"id": asset.upper()},
            {"$set": doc},
            upsert=True,
        )
        rows.append(doc)
    return rows


async def aggregate_internal_hedged_by_asset() -> Dict[str, float]:
    """Sum ``net_hedged_qty`` across every ``hedger_state`` row, grouped
    by the base asset extracted from each symbol.

    Example: ``{"ETH": 5.0, "BTC": -0.2}``.
    """
    db = get_db()
    if db is None:
        return {}
    out: Dict[str, float] = {}
    async for doc in db[HEDGER_STATE].find({}, {"_id": 0}):
        sym = str(doc.get("id") or "").upper()
        if not sym:
            continue
        base = _base_from_symbol(sym)
        if not base:
            continue
        out[base] = out.get(base, 0.0) + float(doc.get("net_hedged_qty") or 0.0)
    return out


def _classify_drift(
    *,
    drift_qty: float,
    drift_usd: float,
    expected_qty: float,
    warn_pct: float,
    warn_usd: float,
    critical_pct: float,
    critical_usd: float,
) -> Tuple[str, float]:
    """Return ``(severity, drift_pct)`` for a drift reading.

    ``drift_pct`` is expressed as a **percentage** (so 1.0 means 1%),
    not a fraction, to match the admin-configurable thresholds.

    Severity uses the conservative rule from the user's spec: the
    threshold trips only when BOTH the percentage AND the absolute USD
    amount cross the limit. Keeps tiny balances from generating alert
    noise.
    """
    denom = max(abs(expected_qty), 1e-12)
    drift_pct = (abs(drift_qty) / denom) * 100.0 if denom > 1e-12 else 0.0
    abs_usd = abs(drift_usd)
    if drift_pct > critical_pct and abs_usd > critical_usd:
        return "critical", round(drift_pct, 4)
    if drift_pct > warn_pct and abs_usd > warn_usd:
        return "warn", round(drift_pct, 4)
    return "ok", round(drift_pct, 4)


async def reconcile(
    *,
    client: "BinanceClient",
    price_lookup: Callable[[str], float],
    supported_bases: List[str],
    controls: Dict[str, Any],
) -> Dict[str, Any]:
    """Build the reconciliation snapshot for the admin dashboard.

    ``supported_bases`` is the set of base assets the platform tracks
    (treasury wallets). We walk that set PLUS any asset Binance reports
    a non-zero balance for that we don't know about — the UI will flag
    "unknown asset on Binance" (likely dust or manual ops funding) so
    ops doesn't miss it.

    ``price_lookup(asset)`` must return a USDT mark price; USDT itself
    is hardcoded to 1.0. Returns a dict safe to JSON-serialise directly
    to the admin endpoint.
    """
    # Pull thresholds once — defaults match the user-confirmed spec.
    warn_pct = float(controls.get("hedger_reconcile_warn_pct") or 1.0)
    warn_usd = float(controls.get("hedger_reconcile_warn_usd") or 100.0)
    crit_pct = float(controls.get("hedger_reconcile_critical_pct") or 5.0)
    crit_usd = float(controls.get("hedger_reconcile_critical_usd") or 250.0)

    # Fetch Binance balances + our internal state. Failure on the Binance
    # side should surface as a rendered error, not a 500 — ops still
    # needs to see baselines and internal state while investigating.
    error: Optional[str] = None
    balances: Dict[str, Dict[str, float]] = {}
    try:
        balances = await get_binance_balances(client, include_zero=False)
    except (BinanceAPIError, HedgerError, HedgerConfigError) as exc:
        error = str(exc)
    except Exception as exc:  # noqa: BLE001
        error = f"unexpected: {exc}"

    internal_hedged = await aggregate_internal_hedged_by_asset()
    baseline_rows = await list_baselines()
    baselines: Dict[str, Dict[str, Any]] = {
        (r.get("id") or "").upper(): r for r in baseline_rows
    }

    # Canonical asset list = supported + anything Binance shows.
    bases = {b.upper() for b in (supported_bases or [])}
    bases.update(balances.keys())
    bases.discard("")
    bases.discard("IBO")  # never on Binance — noise otherwise

    # USDT is always interesting for the admin even if no supported
    # symbol resolves to it. It's the quote currency for every hedge.
    bases.add("USDT")

    rows: List[Dict[str, Any]] = []
    totals = {"binance_usd": 0.0, "expected_usd": 0.0, "drift_usd": 0.0}
    any_warn = False
    any_crit = False

    for asset in sorted(bases):
        bal = balances.get(asset, {"free": 0.0, "locked": 0.0, "total": 0.0})
        baseline = baselines.get(asset) or {}
        baseline_qty = float(baseline.get("qty") or 0.0)
        hedged_qty = float(internal_hedged.get(asset, 0.0))
        expected_qty = baseline_qty + hedged_qty
        binance_qty = float(bal.get("total") or 0.0)
        drift_qty = binance_qty - expected_qty

        if asset == "USDT":
            mark = 1.0
        else:
            try:
                mark = float(price_lookup(asset) or 0.0)
            except Exception:  # noqa: BLE001
                mark = 0.0
        drift_usd = drift_qty * mark
        binance_usd = binance_qty * mark
        expected_usd = expected_qty * mark

        severity, drift_pct = _classify_drift(
            drift_qty=drift_qty,
            drift_usd=drift_usd,
            expected_qty=expected_qty,
            warn_pct=warn_pct, warn_usd=warn_usd,
            critical_pct=crit_pct, critical_usd=crit_usd,
        )
        # USDT drift is informational — no hedger_state to "accept" it
        # into (USDT is the quote). Downgrade so ops don't panic.
        if asset == "USDT" and severity == "critical":
            severity = "warn"
        if severity == "warn":
            any_warn = True
        elif severity == "critical":
            any_crit = True

        rows.append({
            "asset":           asset,
            "binance_free":    round(float(bal.get("free") or 0.0), 8),
            "binance_locked":  round(float(bal.get("locked") or 0.0), 8),
            "binance_total":   round(binance_qty, 8),
            "baseline_qty":    round(baseline_qty, 8),
            "internal_hedged": round(hedged_qty, 8),
            "expected_qty":    round(expected_qty, 8),
            "drift_qty":       round(drift_qty, 8),
            "drift_pct":       drift_pct,
            "mark_usdt":       round(mark, 8),
            "binance_usd":     round(binance_usd, 2),
            "expected_usd":    round(expected_usd, 2),
            "drift_usd":       round(drift_usd, 2),
            "severity":        severity,
            "baseline_snapshot_at": baseline.get("snapshot_at"),
            "baseline_snapshot_by": baseline.get("snapshot_by"),
            "baseline_note":   baseline.get("note"),
            "is_quote":        asset == "USDT",
            # ``acceptable`` = "this asset can have its internal state
            # snapped to match Binance via accept_drift()". USDT can't
            # (no per-symbol hedger_state). Unknown assets can't either.
            "acceptable":      asset != "USDT" and asset in (b.upper() for b in (supported_bases or [])),
        })
        totals["binance_usd"]  += binance_usd
        totals["expected_usd"] += expected_usd
        totals["drift_usd"]    += drift_usd

    totals = {k: round(v, 2) for k, v in totals.items()}

    # ── Phase 9c — drive the alert pipeline from the reconcile result ────
    #
    # Dedupe by asset only (not severity): a single open alert per asset
    # is always "the latest picture". Warn→critical transitions bump
    # severity in place; critical→ok auto-resolves via the bulk sweep
    # below. We deliberately skip Binance-fetch failures here (``error``
    # is truthy) — the UI already surfaces that banner, and firing an
    # alert on every polling tick while Binance is down would spam ops.
    if not error:
        webhook_url = str(controls.get("alert_webhook_url") or "").strip() or None
        webhook_min_sev = str(
            controls.get("alert_webhook_min_severity") or ""
        ).strip().lower() or None
        healthy_keys: List[str] = []
        for r in rows:
            sev = r.get("severity")
            asset = r.get("asset")
            key = f"hedger.reconcile:{asset}"
            if sev in ("warn", "critical"):
                try:
                    await alert_service.raise_alert(
                        type=f"hedger.reconcile.{sev}",
                        severity=sev,
                        source="hedger",
                        title=f"{asset} reconciliation {sev}",
                        message=(
                            f"Binance balance {r['binance_total']} vs expected "
                            f"{r['expected_qty']} ({r['drift_qty']} drift, "
                            f"{r['drift_pct']}% / ${r['drift_usd']})."
                        ),
                        meta={
                            "asset":          asset,
                            "binance_total":  r["binance_total"],
                            "expected_qty":   r["expected_qty"],
                            "drift_qty":      r["drift_qty"],
                            "drift_pct":      r["drift_pct"],
                            "drift_usd":      r["drift_usd"],
                            "severity":       sev,
                            "thresholds": {
                                "warn_pct":     warn_pct,
                                "warn_usd":     warn_usd,
                                "critical_pct": crit_pct,
                                "critical_usd": crit_usd,
                            },
                        },
                        dedupe_key=key,
                        webhook_url=webhook_url,
                        webhook_min_severity=webhook_min_sev,
                    )
                except Exception:  # noqa: BLE001
                    # Alert delivery is best-effort — never break the
                    # reconcile response because a DB/webhook hiccup.
                    logger.exception("alerts: reconcile raise failed asset=%s", asset)
            else:
                healthy_keys.append(key)
        if healthy_keys:
            try:
                await alert_service.auto_resolve_by_dedupe(
                    healthy_keys,
                    note="auto-resolved (drift back within warn threshold)",
                )
            except Exception:  # noqa: BLE001
                logger.exception("alerts: reconcile auto-resolve failed")

    return {
        "error":       error,
        "rows":        rows,
        "totals":      totals,
        "any_warn":    any_warn,
        "any_critical": any_crit,
        "thresholds":  {
            "warn_pct":     warn_pct,
            "warn_usd":     warn_usd,
            "critical_pct": crit_pct,
            "critical_usd": crit_usd,
        },
    }


async def accept_drift(
    asset: str,
    *,
    client: "BinanceClient",
    admin_email: Optional[str],
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Snap the hedger's internal ``net_hedged_qty`` to match observed
    Binance balance for ``asset``.

    Semantics: after this call, ``expected_qty`` for the asset equals
    ``binance_total`` (drift ≈ 0). We do that by rewriting the
    ``net_hedged_qty`` on the single ``hedger_state`` row that maps to
    this asset — the base-quote mapping for our symbols is 1:1 against
    USDT.

    Use case: ops sold 0.5 ETH manually on Binance to clear a position;
    clicking Accept updates our state to match instead of the worker
    re-hedging the "missing" 0.5 ETH.

    Raises :class:`HedgerSafetyError` when:
    - The asset has no hedger_state row (not a tradable base).
    - USDT is passed (informational only — no state to snap).
    - More than one symbol maps to the base (ambiguous). Not possible
      today but guarded in case we add non-USDT quotes.
    """
    asset_u = asset.upper()
    if asset_u == "USDT":
        raise HedgerSafetyError(
            "USDT drift is informational — cannot be accepted into hedger state.",
        )
    if asset_u in UNHEDGEABLE_BASES:
        raise HedgerSafetyError(f"{asset_u} is not hedgeable.")

    db = get_db()
    if db is None:
        raise HedgerError("database unavailable")

    # Find the symbol(s) that represent this base.
    matching_symbols: List[str] = []
    async for doc in db[HEDGER_STATE].find({}, {"_id": 0, "id": 1}):
        sym = str(doc.get("id") or "").upper()
        if _base_from_symbol(sym) == asset_u:
            matching_symbols.append(sym)
    if not matching_symbols:
        raise HedgerSafetyError(
            f"No hedger_state row for {asset_u} — run the worker at least "
            f"once before accepting drift.",
        )
    if len(matching_symbols) > 1:
        raise HedgerSafetyError(
            f"{asset_u} maps to multiple symbols {matching_symbols} — "
            f"ambiguous accept target.",
        )
    symbol = matching_symbols[0]

    # Re-read drift at mutation time (TOCTOU guard). Balances can move
    # between the reconcile GET and the admin's click — we must use the
    # live number so repeated clicks are idempotent.
    balances = await get_binance_balances(client, include_zero=True)
    binance_qty = float((balances.get(asset_u) or {}).get("total") or 0.0)
    baseline = await get_baseline(asset_u)
    baseline_qty = float(baseline.get("qty") or 0.0)

    # New ``net_hedged_qty`` must satisfy:
    #   binance_qty == baseline_qty + new_net_hedged_qty
    new_net_hedged_qty = round(binance_qty - baseline_qty, 8)

    before = await db[HEDGER_STATE].find_one(
        {"id": symbol}, {"_id": 0, "net_hedged_qty": 1},
    ) or {}
    prev_val = float(before.get("net_hedged_qty") or 0.0)

    now = _now_iso()
    await db[HEDGER_STATE].update_one(
        {"id": symbol},
        {
            "$set": {
                "net_hedged_qty": new_net_hedged_qty,
                "updated_at":     now,
                "last_reconcile_at": now,
                "last_reconcile_by": admin_email,
                "last_reconcile_note": (note or None),
            },
            "$setOnInsert": {
                "id":                symbol,
                "last_hedge_at":     None,
                "last_evaluated_at": None,
                "last_suggestion":   None,
                "created_at":        now,
            },
        },
        upsert=True,
    )
    logger.info(
        "hedger: accept_drift %s (%s) — net_hedged %.8f → %.8f by %s",
        asset_u, symbol, prev_val, new_net_hedged_qty, admin_email or "unknown",
    )
    return {
        "asset":                asset_u,
        "symbol":               symbol,
        "previous_net_hedged":  round(prev_val, 8),
        "new_net_hedged":       new_net_hedged_qty,
        "binance_qty":          round(binance_qty, 8),
        "baseline_qty":         round(baseline_qty, 8),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Phase 9b — PnL tracking (Level A: no lot accounting)
# ─────────────────────────────────────────────────────────────────────────────
#
# Two realised PnL components, both readable straight from existing
# collections — nothing new to persist:
#
#   * **Spread revenue** — every SYSTEM fill in ``trades`` carries
#     ``mark_price`` + ``price`` (the user-side skewed price) + ``amount``.
#     Revenue = |price - mark_price| * amount. Always non-negative by
#     construction (spread is applied AGAINST the user).
#
#   * **Hedge cost** — every row in ``hedge_trades`` stores ``avg_price``
#     (actual Binance fill), ``treasury_mark`` (mark we anchored the
#     spread to), ``executed_qty`` + ``side``. Cost is the P&L drag of
#     executing away from the mark we booked:
#         BUY:  cost = (avg_price - treasury_mark) * executed_qty
#         SELL: cost = (treasury_mark - avg_price) * executed_qty
#     Cost can be NEGATIVE (hedge filled in our favour vs mark) — the UI
#     copy calls the column "Hedge cost (vs mark)" to make that explicit.
#
# Realised PnL = spread_revenue - hedge_cost.
#
# Unrealised exposure is reported separately (never folded into realised)
# per the 9b design note: ``open_position_base * current_mark_usdt``.

_WINDOW_CHOICES: Tuple[str, ...] = ("24h", "7d", "30d", "all")


def _parse_window(window: Optional[str]) -> Tuple[Optional[datetime], str]:
    """Normalise ``window`` to ``(since_dt, canonical_label)``.

    Returns ``since=None`` for ``"all"`` so the caller can skip the
    ``created_at`` filter entirely — avoids a needless index seek.
    """
    w = (window or "").strip().lower()
    if w not in _WINDOW_CHOICES:
        w = "7d"
    now = datetime.now(timezone.utc)
    if w == "24h":
        return now - timedelta(hours=24), w
    if w == "7d":
        return now - timedelta(days=7), w
    if w == "30d":
        return now - timedelta(days=30), w
    return None, "all"


def _bucket_granularity(window: str) -> str:
    """Time-series bucket shape:

    - ``24h`` → hourly buckets (24 rows max)
    - anything else → daily buckets
    """
    return "hour" if window == "24h" else "day"


async def _aggregate_spread_by_symbol(
    *,
    since_iso: Optional[str],
) -> Dict[str, Dict[str, float]]:
    """Per-symbol spread revenue + SYSTEM fill count.

    Pipeline pulls from ``trades`` where ``system_fill=true``. We use
    ``$ifNull`` on ``mark_price`` so pre-Phase-8 trades (which don't
    carry a mark) cleanly contribute zero instead of blowing up the
    ``$subtract``.
    """
    db = get_db()
    if db is None:
        return {}
    match: Dict[str, Any] = {"system_fill": True}
    if since_iso:
        match["created_at"] = {"$gte": since_iso}
    pipeline = [
        {"$match": match},
        {"$project": {
            "symbol": 1,
            "revenue": {
                "$multiply": [
                    {"$abs": {"$subtract": [
                        {"$ifNull": ["$price", 0]},
                        {"$ifNull": ["$mark_price", "$price"]},
                    ]}},
                    {"$ifNull": ["$amount", 0]},
                ],
            },
        }},
        {"$group": {
            "_id": "$symbol",
            "spread_revenue": {"$sum": "$revenue"},
            "fill_count":     {"$sum": 1},
        }},
    ]
    out: Dict[str, Dict[str, float]] = {}
    async for row in db["trades"].aggregate(pipeline):
        sym = str(row.get("_id") or "").upper()
        if not sym:
            continue
        out[sym] = {
            "spread_revenue": float(row.get("spread_revenue") or 0.0),
            "fill_count":     int(row.get("fill_count") or 0),
        }
    return out


async def _aggregate_hedge_cost_by_symbol(
    *,
    since_iso: Optional[str],
) -> Dict[str, Dict[str, float]]:
    """Per-symbol hedge cost + hedge execution count.

    Excludes ``dry_run`` and ``rejected`` rows — they never hit Binance
    so they can't contribute cost. Rows with ``executed_qty == 0``
    (failed before fill) are also excluded for the same reason.

    Cost formula mirrors the comment at the top of this section:

        side_mult = +1 for buy, -1 for sell
        cost_usdt = side_mult * (avg_price - treasury_mark) * executed_qty
    """
    db = get_db()
    if db is None:
        return {}
    match: Dict[str, Any] = {
        "dry_run": {"$ne": True},
        "status":  {"$nin": ["dry_run", "rejected"]},
        "executed_qty": {"$gt": 0},
    }
    if since_iso:
        match["created_at"] = {"$gte": since_iso}
    pipeline = [
        {"$match": match},
        {"$project": {
            "symbol": 1,
            "side":   1,
            "cost": {
                "$multiply": [
                    {"$cond": [{"$eq": ["$side", "buy"]}, 1, -1]},
                    {"$subtract": [
                        {"$ifNull": [
                            "$avg_price",
                            {"$ifNull": ["$binance_price", 0]},
                        ]},
                        {"$ifNull": ["$treasury_mark", 0]},
                    ]},
                    {"$ifNull": ["$executed_qty", 0]},
                ],
            },
        }},
        {"$group": {
            "_id": "$symbol",
            "hedge_cost":   {"$sum": "$cost"},
            "hedge_count":  {"$sum": 1},
        }},
    ]
    out: Dict[str, Dict[str, float]] = {}
    async for row in db[HEDGE_TRADES].aggregate(pipeline):
        sym = str(row.get("_id") or "").upper()
        if not sym:
            continue
        out[sym] = {
            "hedge_cost":  float(row.get("hedge_cost") or 0.0),
            "hedge_count": int(row.get("hedge_count") or 0),
        }
    return out


def _bucket_key_expr(granularity: str) -> Dict[str, Any]:
    """Mongo aggregate expression extracting a bucket key from ISO string.

    We store ``created_at`` as ISO-8601 strings (see wallet_service /
    server.py everywhere), so the cheapest group key is a byte-range
    prefix of that string:

        day  →  "2026-04-20"     (first 10 chars)
        hour →  "2026-04-20T14"  (first 13 chars)
    """
    if granularity == "hour":
        return {"$substr": ["$created_at", 0, 13]}
    return {"$substr": ["$created_at", 0, 10]}


async def _aggregate_spread_timeseries(
    *,
    since_iso: Optional[str],
    granularity: str,
) -> Dict[str, float]:
    db = get_db()
    if db is None:
        return {}
    match: Dict[str, Any] = {"system_fill": True}
    if since_iso:
        match["created_at"] = {"$gte": since_iso}
    pipeline = [
        {"$match": match},
        {"$project": {
            "bucket": _bucket_key_expr(granularity),
            "revenue": {
                "$multiply": [
                    {"$abs": {"$subtract": [
                        {"$ifNull": ["$price", 0]},
                        {"$ifNull": ["$mark_price", "$price"]},
                    ]}},
                    {"$ifNull": ["$amount", 0]},
                ],
            },
        }},
        {"$group": {"_id": "$bucket", "v": {"$sum": "$revenue"}}},
    ]
    out: Dict[str, float] = {}
    async for r in db["trades"].aggregate(pipeline):
        key = str(r.get("_id") or "")
        if key:
            out[key] = float(r.get("v") or 0.0)
    return out


async def _aggregate_hedge_cost_timeseries(
    *,
    since_iso: Optional[str],
    granularity: str,
) -> Dict[str, float]:
    db = get_db()
    if db is None:
        return {}
    match: Dict[str, Any] = {
        "dry_run": {"$ne": True},
        "status":  {"$nin": ["dry_run", "rejected"]},
        "executed_qty": {"$gt": 0},
    }
    if since_iso:
        match["created_at"] = {"$gte": since_iso}
    pipeline = [
        {"$match": match},
        {"$project": {
            "bucket": _bucket_key_expr(granularity),
            "cost": {
                "$multiply": [
                    {"$cond": [{"$eq": ["$side", "buy"]}, 1, -1]},
                    {"$subtract": [
                        {"$ifNull": [
                            "$avg_price",
                            {"$ifNull": ["$binance_price", 0]},
                        ]},
                        {"$ifNull": ["$treasury_mark", 0]},
                    ]},
                    {"$ifNull": ["$executed_qty", 0]},
                ],
            },
        }},
        {"$group": {"_id": "$bucket", "v": {"$sum": "$cost"}}},
    ]
    out: Dict[str, float] = {}
    async for r in db[HEDGE_TRADES].aggregate(pipeline):
        key = str(r.get("_id") or "")
        if key:
            out[key] = float(r.get("v") or 0.0)
    return out


def _enumerate_buckets(
    since: Optional[datetime],
    granularity: str,
) -> List[str]:
    """Produce every bucket label between ``since`` and now (inclusive).

    This is what makes the UI chart "dense" — buckets with no activity
    show as zero-height bars instead of being silently omitted and
    squashing the X axis.

    For ``"all"`` (since=None) we fall back to "whatever the data had"
    and let the caller union the keys from the aggregate results.
    """
    if since is None:
        return []
    now = datetime.now(timezone.utc)
    out: List[str] = []
    cursor = since
    if granularity == "hour":
        cursor = cursor.replace(minute=0, second=0, microsecond=0)
        step = timedelta(hours=1)
        while cursor <= now:
            out.append(cursor.strftime("%Y-%m-%dT%H"))
            cursor += step
    else:
        cursor = cursor.replace(hour=0, minute=0, second=0, microsecond=0)
        step = timedelta(days=1)
        while cursor <= now:
            out.append(cursor.strftime("%Y-%m-%d"))
            cursor += step
    return out


async def compute_pnl(
    *,
    window: str,
    hedgeable_symbols: List[str],
    price_lookup: Callable[[str], float],
    get_position_fn: Callable[[str], Any],
    treasury_started_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the full Phase 9b PnL payload.

    ``hedgeable_symbols`` seeds the per-symbol table so freshly-deployed
    symbols appear with zeroes instead of being missing; the aggregates
    union on top.

    ``get_position_fn(base_asset) -> float`` is async (treasury_service
    returns signed base position). ``price_lookup`` is sync (wraps the
    existing ``_cached_price_usdt``). These are injected so the service
    module stays free of a circular import on ``treasury_service``.
    """
    since_dt, canonical_window = _parse_window(window)
    since_iso = since_dt.isoformat() if since_dt else None
    granularity = _bucket_granularity(canonical_window)

    spread_by_sym = await _aggregate_spread_by_symbol(since_iso=since_iso)
    cost_by_sym   = await _aggregate_hedge_cost_by_symbol(since_iso=since_iso)

    spread_series = await _aggregate_spread_timeseries(
        since_iso=since_iso, granularity=granularity,
    )
    cost_series = await _aggregate_hedge_cost_timeseries(
        since_iso=since_iso, granularity=granularity,
    )

    # Per-symbol rollup. Seed with supported symbols so the UI shows a
    # zero row for pairs that haven't traded yet in this window.
    symbols_union = {s.upper() for s in (hedgeable_symbols or [])}
    symbols_union.update(spread_by_sym.keys())
    symbols_union.update(cost_by_sym.keys())

    rows: List[Dict[str, Any]] = []
    total_spread = 0.0
    total_cost = 0.0
    total_exposure_usd = 0.0
    total_fills = 0
    total_hedges = 0

    for sym in sorted(symbols_union):
        base = _base_from_symbol(sym)
        spread = float((spread_by_sym.get(sym) or {}).get("spread_revenue") or 0.0)
        fills  = int((spread_by_sym.get(sym) or {}).get("fill_count") or 0)
        cost   = float((cost_by_sym.get(sym) or {}).get("hedge_cost") or 0.0)
        hedges = int((cost_by_sym.get(sym) or {}).get("hedge_count") or 0)

        # Unrealised exposure is "right-now", not windowed — mark × signed
        # base position (can be negative = short).
        try:
            pos = await get_position_fn(base)
            pos = float(pos or 0.0)
        except Exception:  # noqa: BLE001
            pos = 0.0
        try:
            mark = float(price_lookup(base) or 0.0)
        except Exception:  # noqa: BLE001
            mark = 0.0
        exposure_usd = pos * mark

        rows.append({
            "symbol":               sym,
            "base_asset":           base,
            "spread_revenue_usdt":  round(spread, 4),
            "hedge_cost_usdt":      round(cost, 4),
            "net_realized_usdt":    round(spread - cost, 4),
            "open_exposure_base":   round(pos, 8),
            "open_exposure_usdt":   round(exposure_usd, 4),
            "mark_usdt":            round(mark, 8),
            "fill_count":           fills,
            "hedge_count":          hedges,
        })
        total_spread       += spread
        total_cost         += cost
        total_exposure_usd += exposure_usd
        total_fills        += fills
        total_hedges       += hedges

    # Stitch the time series. Start from the dense bucket enumeration so
    # the chart keeps a steady cadence; when window="all" we fall back to
    # whatever buckets actually have data (sorted).
    if since_dt is not None:
        bucket_labels = _enumerate_buckets(since_dt, granularity)
    else:
        bucket_labels = sorted(
            set(spread_series.keys()) | set(cost_series.keys())
        )

    timeseries: List[Dict[str, float]] = []
    for label in bucket_labels:
        sp = float(spread_series.get(label, 0.0))
        cs = float(cost_series.get(label, 0.0))
        timeseries.append({
            "bucket":  label,
            "spread":  round(sp, 4),
            "cost":    round(cs, 4),
            "net":     round(sp - cs, 4),
        })

    return {
        "window":      canonical_window,
        "granularity": granularity,
        "since":       since_iso,
        "until":       datetime.now(timezone.utc).isoformat(),
        "started_at":  treasury_started_at,
        "totals": {
            "spread_revenue_usdt": round(total_spread, 4),
            "hedge_cost_usdt":     round(total_cost, 4),
            "net_realized_usdt":   round(total_spread - total_cost, 4),
            "open_exposure_usdt":  round(total_exposure_usd, 4),
            "fill_count":          total_fills,
            "hedge_count":         total_hedges,
        },
        "symbols":     rows,
        "timeseries":  timeseries,
    }
