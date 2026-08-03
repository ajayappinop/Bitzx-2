"""IBO mock market data engine.

Architecture
------------
* Two async loops share a single asyncio.Lock over `_states`:
  - _run_fast_loop  – fires every 1 s: micro-jitters price only.
  - _run_slow_loop  – fires every 5 s: updates candles, orderbook, 24h stats.

* Orderbook carry-forward: quantities are *evolved* each slow tick (±12 % jitter
  on each existing level) instead of being regenerated from scratch.  This
  produces a realistic depth chart that changes gradually rather than flickering.

* Price walk: IBOUSDT mean-reverts around the deposit-driven platform anchor
  (±2.5% band, 1 Hz micro-ticks). BTC/IBO & ETH/IBO mirror Binance BTC/ETH
  USDT klines ÷ platform IBO (real candle bodies, no synthetic drift).

Toggle via env flag: IBO_MOCK_MARKET=true  (read by server.py on startup).
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

import requests

from ibo.constants import IBO_QUOTED_PAIRS
from services import binance_spot_feed
from services.db import get_db

logger = logging.getLogger(__name__)

# Pre-warm at startup; additional *IBO symbols lazy-init on first API/WS hit.
SUPPORTED_SYMBOLS: List[str] = ["IBOUSDT", *IBO_QUOTED_PAIRS]

def is_supported(sym: str) -> bool:
    if sym == "IBOUSDT":
        return True
    return sym.endswith("IBO") and len(sym) > 3 and sym != "IBOIBO"

SUPPORTED_INTERVALS = ("1m", "5m", "15m", "1h", "4h", "1d")
INTERVAL_SECONDS: Dict[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}

# BTC/IBO & ETH/IBO — chart mirrors Binance BTCUSDT/ETHUSDT ÷ platform IBO (no synthetic walk).
_MAJOR_CROSS_BASES = frozenset({"BTC", "ETH"})
_MAJOR_CROSS_SYMBOLS = frozenset({"BTCIBO", "ETHIBO"})
_BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"

BASE_USDT_FALLBACK: Dict[str, float] = {
    "BTC": 84500.0,
    "ETH": 3200.0,
    "SOL": 145.0,
    "BNB": 630.0,
    "XRP": 2.30,
    "DOGE": 0.22,
    "ADA": 0.75,
    "POL": 0.50,
    "AVAX": 35.0,
    "DOT": 7.0,
    "LINK": 18.0,
    "LTC": 105.0,
    "PEPE": 0.000014,
    "SHIB": 0.000025,
}

# Per-base step volatility for seeded walks (higher = more jagged mini charts).
_BASE_WALK_VOL: Dict[str, float] = {
    "IBO": 0.0025,
    "BTC": 0.0018,
    "ETH": 0.0022,
    "BNB": 0.0020,
    "SOL": 0.0028,
    "XRP": 0.0030,
    "DOGE": 0.0042,
    "ADA": 0.0032,
    "POL": 0.0034,
    "AVAX": 0.0036,
    "DOT": 0.0030,
    "LINK": 0.0030,
    "LTC": 0.0026,
    "PEPE": 0.0065,
    "SHIB": 0.0060,
}


def _seed_rng(symbol: str, *parts: str) -> random.Random:
    """Deterministic RNG per symbol so ETHIBO and DOGEIBO never share the same walk."""
    key = "-".join((symbol.upper(), *parts))
    return random.Random(key)


def _walk_volatility(symbol: str) -> float:
    if symbol == "IBOUSDT":
        return _BASE_WALK_VOL["IBO"]
    return _BASE_WALK_VOL.get(_pair_base(symbol), 0.0028)

MAX_CANDLES_PER_INTERVAL = 500
MAX_TRADES = 50
OB_LEVELS = 20          # depth levels kept in memory and sent over WS


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ms(dt: Optional[datetime] = None) -> int:
    return int((dt or _utc_now()).timestamp() * 1000)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _trend_bias(now: datetime, volatility: float, trend: str) -> float:
    hour = now.hour
    if 5 <= hour < 11:
        return volatility * random.uniform(0.08, 0.24)   # morning drift
    if 11 <= hour < 16:
        return volatility * random.uniform(-0.03, 0.03)  # sideways midday
    if trend == "up":
        return volatility * random.uniform(0.05, 0.16)
    if trend == "down":
        return -volatility * random.uniform(0.05, 0.16)
    return volatility * random.uniform(-0.08, 0.08)


def _pair_base(symbol: str) -> str:
    if symbol.endswith("IBO"):
        base = symbol[:-3]
        if base:
            return base
    return "IBO"


def _base_usdt_price(base: str) -> float:
    if base == "IBO":
        from ibo.pricing import platform_ibo_usdt_price

        return platform_ibo_usdt_price()
    live, age = binance_spot_feed.get_price(f"{base}USDT")
    if live and age <= 120:
        return float(live)
    return float(BASE_USDT_FALLBACK.get(base, 1.0))


def _derive_pair_price(symbol: str, ibo_usdt_price: float) -> float:
    if symbol == "IBOUSDT":
        return float(ibo_usdt_price)
    base = _pair_base(symbol)
    return _base_usdt_price(base) / max(float(ibo_usdt_price), 1e-9)


def _derive_cross_pair_price(symbol: str, *, slow: bool = False) -> float:
    """IBO-quoted pair price — tracks live base/USDT; IBO uses stable platform anchor."""
    base = _pair_base(symbol)
    anchor = _platform_ibo_anchor()
    base_usdt = _base_usdt_price(base)
    px = base_usdt / max(anchor, 1e-9)
    if base in _MAJOR_CROSS_BASES:
        return px
    vol = _walk_volatility(symbol)
    shock = random.gauss(0, vol * (0.40 if slow else 0.14))
    return max(px * (1.0 + shock), 1e-12)


def _fetch_binance_klines_sync(base: str, interval: str, limit: int) -> List[List[Any]]:
    """Pull OHLCV from Binance for seeding BTC/IBO and ETH/IBO charts."""
    sym = f"{(base or '').upper()}USDT"
    iv = (interval or "1h").lower()
    if iv not in INTERVAL_SECONDS:
        return []
    try:
        r = requests.get(
            _BINANCE_KLINES_URL,
            params={"symbol": sym, "interval": iv, "limit": min(int(limit), 500)},
            timeout=12,
        )
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001
        logger.warning("ibo_mock_market: Binance klines fetch failed for %s %s", sym, iv)
        return []


def _base_binance_pct_24h(base: str) -> float:
    """Real Binance 24h % for the underlying USDT pair (matches majors list)."""
    from listings.market_data import fetch_binance_24hr_map

    sym = f"{(base or '').upper()}USDT"
    if not sym or sym == "USDT":
        return 0.0
    t = fetch_binance_24hr_map([sym]).get(sym) or {}
    try:
        return float(t.get("priceChangePercent") or 0)
    except (TypeError, ValueError):
        return 0.0


def _stored_candles_stale(symbol: str, rows: List[Dict[str, Any]], target_price: float) -> bool:
    """Detect Mongo seed from wrong IBO era (~$1.53) or chart cliffs."""
    if not rows or target_price <= 0:
        return False
    closes = [float(r.get("close") or 0) for r in rows]
    closes = [c for c in closes if c > 0]
    if not closes:
        return True
    last = closes[-1]
    if abs(last - target_price) / target_price > 0.08:
        return True
    median = sorted(closes)[len(closes) // 2]
    if abs(median - target_price) / target_price > 0.18:
        return True
    if symbol != "IBOUSDT":
        base = _pair_base(symbol)
        base_usdt = _base_usdt_price(base)
        anchor = _platform_ibo_anchor()
        if base_usdt > 0 and anchor > 0:
            for c in (last, median):
                implied_ibo = base_usdt / c
                if abs(implied_ibo - anchor) / anchor > 0.12:
                    return True
        first = closes[0]
        if first > target_price * 1.06 and (first - target_price) / target_price > 0.08:
            return True
    return False


def _platform_ibo_anchor() -> float:
    from ibo.pricing import platform_ibo_usdt_price

    return platform_ibo_usdt_price()


# Live display band around deposit-driven platform anchor (±2.5% — visible tick, no fake pump).
_LIVE_BAND_PCT = 0.025


def _ibo_price_bounds(anchor: Optional[float] = None) -> Tuple[float, float]:
    px = float(anchor if anchor is not None else _platform_ibo_anchor())
    return px * (1.0 - _LIVE_BAND_PCT), px * (1.0 + _LIVE_BAND_PCT)


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class CandleAgg:
    open: float
    high: float
    low: float
    close: float
    volume: float
    start_ms: int


@dataclass
class SymbolState:
    symbol: str
    price: float
    change24h: float = 0.0
    volume24h: float = 0.0
    marketCap: float = 0.0
    trend: str = "neutral"
    volatility: float = 0.002
    last_price_flash: int = 0
    # orderbook: bids/asks as [[price_str, qty_str], ...], OB_LEVELS deep
    orderbook: Dict[str, List] = field(
        default_factory=lambda: {"bids": [], "asks": []}
    )
    trades: Deque[Dict[str, Any]] = field(default_factory=lambda: deque(maxlen=MAX_TRADES))
    candles: Dict[str, Deque[Dict[str, Any]]] = field(
        default_factory=lambda: {iv: deque(maxlen=MAX_CANDLES_PER_INTERVAL) for iv in SUPPORTED_INTERVALS}
    )
    open_candles: Dict[str, CandleAgg] = field(default_factory=dict)
    last_volume_spike_ts: float = 0.0
    last_base_usdt: float = 0.0
    pump_until_ts: float = 0.0
    correction_until_ts: float = 0.0
    pump_strength: float = 0.0


# ── Engine ────────────────────────────────────────────────────────────────────

class IBOMockMarketEngine:
    def __init__(self) -> None:
        self._states: Dict[str, SymbolState] = {}
        self._last_candle_event: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self._fast_task: Optional[asyncio.Task] = None
        self._slow_task: Optional[asyncio.Task] = None
        self._ready = False

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._fast_task and not self._fast_task.done():
            return
        await self._bootstrap()
        self._fast_task = asyncio.create_task(self._run_fast_loop(), name="ibo-market-fast")
        self._slow_task = asyncio.create_task(self._run_slow_loop(), name="ibo-market-slow")
        logger.info("ibo_mock_market: engine started (fast 1s + slow 5s loops)")

    async def stop(self) -> None:
        for task in (self._fast_task, self._slow_task):
            if task and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        self._fast_task = self._slow_task = None
        logger.info("ibo_mock_market: engine stopped")

    # ── Bootstrap ────────────────────────────────────────────────────────────

    async def _bootstrap(self) -> None:
        db = get_db()
        await db.ibo_market_state.create_index("symbol", unique=True)
        await db.ibo_candles.create_index([("symbol", 1), ("interval", 1), ("timestamp", -1)])
        await db.ibo_candles.create_index(
            [("symbol", 1), ("interval", 1), ("timestamp", 1)],
            unique=True,
            name="uniq_ibo_symbol_interval_ts",
        )

        await db.ibo_market_state.update_one(
            {"symbol": "IBOUSDT"},
            {
                "$setOnInsert": {
                    "symbol": "IBOUSDT",
                    "price": _platform_ibo_anchor(),
                    "change24h": 0.0,
                    "volume24h": 0.0,
                    "marketCap": 0.0,
                    "trend": "neutral",
                    "volatility": 0.002,
                    "updated_at": _ms(),
                }
            },
            upsert=True,
        )
        doc = await db.ibo_market_state.find_one({"symbol": "IBOUSDT"}, {"_id": 0})
        anchor = _platform_ibo_anchor()
        stored = float((doc or {}).get("price") or anchor)
        if abs(stored - anchor) > max(anchor * 0.001, 1e-8):
            logger.info(
                "ibo_mock_market: syncing IBOUSDT price %.4f → platform anchor %.4f",
                stored, anchor,
            )
            stored = anchor
            await db.ibo_market_state.update_one(
                {"symbol": "IBOUSDT"},
                {"$set": {"price": anchor, "change24h": 0.0, "updated_at": _ms()}},
            )
        ibo_price = anchor * (1.0 + random.uniform(-0.003, 0.003))
        trend = str((doc or {}).get("trend") or "neutral")
        volatility = float((doc or {}).get("volatility") or 0.002)

        for sym in SUPPORTED_SYMBOLS:
            await self._init_symbol_locked(sym, ibo_price, trend, volatility)
        await self._purge_legacy_ibo_era_candles()
        await self._bootstrap_major_cross_charts()
        self._ready = True

    async def _bootstrap_major_cross_charts(self) -> None:
        """BTC/IBO & ETH/IBO always mirror Binance — wipe synthetic history on start."""
        db = get_db()
        for sym in _MAJOR_CROSS_SYMBOLS:
            st = self._states.get(sym)
            if not st:
                continue
            st.price = _derive_cross_pair_price(sym)
            st.last_base_usdt = _base_usdt_price(_pair_base(sym))
            st.change24h = _base_binance_pct_24h(_pair_base(sym))
            for iv in SUPPORTED_INTERVALS:
                await db.ibo_candles.delete_many({"symbol": sym, "interval": iv})
                st.candles[iv].clear()
                st.open_candles.pop(iv, None)
            await self._ensure_seed_candles(sym)
            logger.info("ibo_mock_market: seeded %s from Binance %sUSDT klines", sym, _pair_base(sym))

    async def _purge_legacy_ibo_era_candles(self) -> None:
        """One-shot cleanup: candles seeded when IBO mock used ~$1.50 instead of ~$0.45."""
        db = get_db()
        anchor = _platform_ibo_anchor()
        for sym in SUPPORTED_SYMBOLS:
            if sym == "IBOUSDT":
                continue
            base = _pair_base(sym)
            base_usdt = _base_usdt_price(base)
            if base_usdt <= 0 or anchor <= 0:
                continue
            for iv in SUPPORTED_INTERVALS:
                last = await db.ibo_candles.find_one(
                    {"symbol": sym, "interval": iv},
                    sort=[("timestamp", -1)],
                )
                if not last:
                    continue
                close = float(last.get("close") or 0)
                if close <= 0:
                    continue
                implied_ibo = base_usdt / close
                if abs(implied_ibo - anchor) / anchor > 0.12:
                    await db.ibo_candles.delete_many({"symbol": sym, "interval": iv})
                    st = self._states.get(sym)
                    if st:
                        st.candles[iv].clear()
                        st.open_candles.pop(iv, None)
                    logger.info(
                        "ibo_mock_market: purged legacy %s %s candles "
                        "(implied IBO $%.4f vs anchor $%.4f)",
                        sym, iv, implied_ibo, anchor,
                    )
                    await self._ensure_seed_candles(sym)

    async def _init_symbol_locked(
        self, sym: str, ibo_price: float, trend: str, volatility: float
    ) -> None:
        if sym in self._states:
            return
        if sym == "IBOUSDT":
            px = ibo_price
        else:
            px = _derive_cross_pair_price(sym, slow=False)
        st = SymbolState(
            symbol=sym,
            price=px,
            trend=trend if sym == "IBOUSDT" else "neutral",
            volatility=volatility if sym == "IBOUSDT" else 0.0022,
        )
        if sym != "IBOUSDT":
            st.change24h = _base_binance_pct_24h(_pair_base(sym))
        self._states[sym] = st
        await self._hydrate_candles(sym)
        await self._ensure_seed_candles(sym)
        self._rebuild_orderbook_locked(st, smooth=False)
        self._gen_trades_locked(st, random.randint(8, 14))
        if sym not in SUPPORTED_SYMBOLS:
            SUPPORTED_SYMBOLS.append(sym)

    # ── Candle persistence / seeding ─────────────────────────────────────────

    async def _hydrate_candles(self, symbol: str) -> None:
        """Load candles from MongoDB into memory.

        Self-healing: if the stored history ends far from the current live price
        (> 15 % deviation — happens with old randomly-seeded data), drop those
        candles so _ensure_seed_candles will regenerate them anchored to the
        current price.  This makes the chart look correct on every start without
        requiring a manual DB drop.
        """
        db = get_db()
        st = self._states[symbol]
        for iv in SUPPORTED_INTERVALS:
            rows = await db.ibo_candles.find(
                {"symbol": symbol, "interval": iv},
                {"_id": 0},
            ).sort("timestamp", -1).limit(MAX_CANDLES_PER_INTERVAL).to_list(
                length=MAX_CANDLES_PER_INTERVAL
            )
            rows.reverse()

            # Stale-seed guard: wrong IBO era, median drift, or chart cliffs.
            if rows and st.price > 0 and _stored_candles_stale(symbol, rows, st.price):
                last_close = float(rows[-1].get("close") or 0)
                logger.info(
                    "ibo_mock_market: %s %s candles stale (last %.8f vs live %.8f) — regenerating",
                    symbol, iv, last_close, st.price,
                )
                await db.ibo_candles.delete_many({"symbol": symbol, "interval": iv})
                rows = []

            for r in rows:
                st.candles[iv].append({
                    "time": int(r["timestamp"] // 1000),
                    "open":   float(r["open"]),
                    "high":   float(r["high"]),
                    "low":    float(r["low"]),
                    "close":  float(r["close"]),
                    "volume": float(r["volume"]),
                })
            if rows:
                last = rows[-1]
                sec = INTERVAL_SECONDS[iv]
                start_ms = int(last["timestamp"])
                if _ms() < start_ms + sec * 1000:
                    st.open_candles[iv] = CandleAgg(
                        open=float(last["open"]),
                        high=float(last["high"]),
                        low=float(last["low"]),
                        close=float(last["close"]),
                        volume=float(last["volume"]),
                        start_ms=start_ms,
                    )

    async def _ensure_seed_candles(self, symbol: str) -> None:
        """Generate 200 synthetic seed candles if none are stored yet.

        The walk is normalised so its last close equals the current live price.
        This guarantees that on every fresh start (empty DB) the chart's right
        edge is exactly at the real-time price — no ratio scaling is needed.
        """
        st = self._states[symbol]
        db = get_db()
        now_ms = _ms()
        target_price = st.price   # current live price — walk must end here
        writes: List[Dict[str, Any]] = []

        for iv in SUPPORTED_INTERVALS:
            if st.candles[iv]:
                continue
            sec = INTERVAL_SECONDS[iv]
            t0 = now_ms - (200 * sec * 1000)

            if symbol != "IBOUSDT":
                base = _pair_base(symbol)
                if base in _MAJOR_CROSS_BASES and self._seed_major_cross_from_binance_locked(
                    symbol, iv, target_price, writes,
                ):
                    continue
                self._seed_cross_pair_candles_locked(
                    symbol, iv, target_price, t0, sec, writes,
                )
                continue

            # IBOUSDT — small random walk anchored to live price.
            raw_closes: List[float] = [1.0]
            for _ in range(199):
                raw_closes.append(max(1e-8, raw_closes[-1] * (1 + random.gauss(0, 0.003))))

            # Step 2: scale the entire walk so the last close equals target_price.
            # This preserves the realistic shape/volatility while anchoring the
            # endpoint — meaning ticker.price == last_candle.close on first load.
            scale = target_price / raw_closes[-1]
            closes = [c * scale for c in raw_closes]

            prev_close = closes[0]
            for i in range(200):
                t = t0 + i * sec * 1000
                o = prev_close
                c = closes[i]
                h = max(o, c) * (1 + abs(random.gauss(0, 0.001)))
                l = min(o, c) * (1 - abs(random.gauss(0, 0.001)))
                v = random.uniform(12_000, 90_000)
                candle = {"time": t // 1000, "open": o, "high": h, "low": l, "close": c, "volume": v}
                st.candles[iv].append(candle)
                writes.append({"symbol": symbol, "interval": iv, "open": o, "high": h,
                                "low": l, "close": c, "volume": v, "timestamp": int(t)})
                prev_close = c

            # Open the first live candle right at target_price.
            st.open_candles[iv] = CandleAgg(
                open=target_price, high=target_price, low=target_price,
                close=target_price, volume=0.0,
                start_ms=(now_ms // (sec * 1000)) * sec * 1000,
            )
        if writes:
            try:
                await db.ibo_candles.insert_many(writes, ordered=False)
            except Exception:  # noqa: BLE001
                pass  # duplicate-key errors on concurrent boot are harmless

    def _seed_cross_pair_candles_locked(
        self,
        symbol: str,
        iv: str,
        target_price: float,
        t0: int,
        sec: int,
        writes: List[Dict[str, Any]],
    ) -> None:
        """Seed cross-IBO history from Binance 24h % — no fake cliff drops."""
        st = self._states[symbol]
        base = _pair_base(symbol)
        ch_pct = _base_binance_pct_24h(base)
        if abs(ch_pct) > 1e-9:
            open_price = target_price / (1.0 + ch_pct / 100.0)
        else:
            open_price = target_price * random.uniform(0.999, 1.001)

        prev_close = open_price
        for i in range(200):
            t = t0 + i * sec * 1000
            frac = i / 199.0
            mid = open_price + (target_price - open_price) * frac
            c = max(mid * (1.0 + random.gauss(0, 0.0002)), 1e-12)
            o = prev_close
            h = max(o, c) * (1.0 + abs(random.gauss(0, 0.0003)))
            l = min(o, c) * (1.0 - abs(random.gauss(0, 0.0003)))
            v = random.uniform(12_000, 90_000)
            candle = {
                "time": t // 1000,
                "open": o, "high": h, "low": l, "close": c, "volume": v,
            }
            st.candles[iv].append(candle)
            writes.append({
                "symbol": symbol, "interval": iv,
                "open": o, "high": h, "low": l, "close": c, "volume": v,
                "timestamp": int(t),
            })
            prev_close = c

        if st.candles[iv]:
            last = st.candles[iv][-1]
            last["close"] = target_price
            last["high"] = max(float(last["high"]), target_price)
            last["low"] = min(float(last["low"]), target_price)

        now_ms = _ms()
        st.open_candles[iv] = CandleAgg(
            open=target_price, high=target_price, low=target_price,
            close=target_price, volume=0.0,
            start_ms=(now_ms // (sec * 1000)) * sec * 1000,
        )

    def _seed_major_cross_from_binance_locked(
        self,
        symbol: str,
        iv: str,
        target_price: float,
        writes: List[Dict[str, Any]],
    ) -> bool:
        """Real Binance OHLCV scaled to IBO quote — same shape as BTC/ETH USDT charts."""
        base = _pair_base(symbol)
        st = self._states[symbol]
        raw = _fetch_binance_klines_sync(base, iv, 200)
        if not raw:
            return False

        anchor = _platform_ibo_anchor()
        inv_ibo = 1.0 / max(anchor, 1e-9)
        candles: List[Dict[str, Any]] = []
        for row in raw:
            if not isinstance(row, (list, tuple)) or len(row) < 6:
                continue
            o = float(row[1]) * inv_ibo
            h = float(row[2]) * inv_ibo
            l = float(row[3]) * inv_ibo
            c = float(row[4]) * inv_ibo
            v = float(row[5])
            candles.append({
                "time": int(row[0]) // 1000,
                "open": o, "high": h, "low": l, "close": c, "volume": v,
            })

        if not candles:
            return False

        last_c = float(candles[-1]["close"])
        if last_c > 0 and target_price > 0:
            ratio = target_price / last_c
            if abs(ratio - 1.0) > 0.0005:
                for cndl in candles:
                    for k in ("open", "high", "low", "close"):
                        cndl[k] = float(cndl[k]) * ratio

        for cndl in candles:
            st.candles[iv].append(cndl)
            writes.append({
                "symbol": symbol,
                "interval": iv,
                "open": cndl["open"],
                "high": cndl["high"],
                "low": cndl["low"],
                "close": cndl["close"],
                "volume": cndl["volume"],
                "timestamp": int(cndl["time"]) * 1000,
            })

        last = candles[-1]
        sec = INTERVAL_SECONDS[iv]
        now_ms = _ms()
        st.open_candles[iv] = CandleAgg(
            open=float(last["open"]),
            high=max(float(last["high"]), target_price),
            low=min(float(last["low"]), target_price),
            close=target_price,
            volume=float(last.get("volume") or 0.0),
            start_ms=(now_ms // (sec * 1000)) * sec * 1000,
        )
        return True

    # ── Tick loops ───────────────────────────────────────────────────────────

    async def _run_fast_loop(self) -> None:
        """1-second loop: micro-jitters price only for a smoother live feed."""
        while True:
            await asyncio.sleep(1.0)
            try:
                await self._micro_tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("ibo_mock_market: fast tick failed")

    async def _run_slow_loop(self) -> None:
        """5-second loop: updates candles, orderbook, 24h stats, persists."""
        while True:
            await asyncio.sleep(5.0)
            try:
                await self._slow_tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("ibo_mock_market: slow tick failed")

    def _live_tick_ibousdt_locked(self, ibo: SymbolState, *, slow: bool = False) -> None:
        """Mean-reverting walk around platform anchor — live ticker without fake drift."""
        anchor = _platform_ibo_anchor()
        lo, hi = _ibo_price_bounds(anchor)

        if ibo.price <= 0 or abs(ibo.price - anchor) / max(anchor, 1e-12) > 0.06:
            ibo.price = anchor * (1.0 + random.uniform(-0.004, 0.004))

        pull = (anchor - ibo.price) / max(anchor, 1e-12)
        vol = max(float(ibo.volatility or 0.002), 0.001)
        shock = random.gauss(0, vol * (1.6 if slow else 0.65))
        step = pull * (0.22 if slow else 0.10) + shock
        ibo.price = _clamp(ibo.price * (1.0 + step), lo, hi)
        ibo.marketCap = ibo.price * 1_000_000_000.0

    def _live_tick_cross_pairs_locked(self, *, slow: bool = False) -> None:
        """Refresh IBO-quoted pairs from live base/USDT ÷ stable platform IBO."""
        for sym, st in self._states.items():
            if sym == "IBOUSDT":
                continue
            base = _pair_base(sym)
            base_usdt = _base_usdt_price(base)
            if base in _MAJOR_CROSS_BASES:
                if (
                    not slow
                    and st.last_base_usdt > 0
                    and abs(base_usdt - st.last_base_usdt) / st.last_base_usdt < 1e-6
                ):
                    continue
                st.last_base_usdt = base_usdt
                st.price = base_usdt / max(_platform_ibo_anchor(), 1e-9)
                self._sync_open_candles_to_price_locked(st)
            else:
                st.price = _derive_cross_pair_price(sym, slow=slow)
            st.marketCap = st.price * random.uniform(8e7, 4e8)

    def _sync_open_candles_to_price_locked(self, st: SymbolState) -> None:
        """Keep live open bars aligned with Binance-derived price (BTC/ETH IBO)."""
        px = st.price
        if px <= 0:
            return
        for agg in st.open_candles.values():
            agg.close = px
            agg.high = max(agg.high, px)
            agg.low = min(agg.low, px)

    async def _micro_tick(self) -> None:
        """1 Hz — live price + orderbook levels track the ticker."""
        if not self._ready:
            return
        async with self._lock:
            ibo = self._states.get("IBOUSDT")
            if not ibo:
                return
            self._live_tick_ibousdt_locked(ibo, slow=False)
            self._live_tick_cross_pairs_locked(slow=False)
            for st in self._states.values():
                self._align_orderbook_prices_locked(st)

    async def _slow_tick(self) -> None:
        """Full update: 24h stats, candles, smooth orderbook, recent trades."""
        if not self._ready:
            return
        now = _utc_now()
        now_ms = _ms(now)
        async with self._lock:
            ibo = self._states["IBOUSDT"]
            self._live_tick_ibousdt_locked(ibo, slow=True)
            self._live_tick_cross_pairs_locked(slow=True)
            ibo.change24h = self._calc_24h_change_locked(ibo)
            ibo.volume24h = max(0.0, ibo.volume24h * 0.992 + random.uniform(15_000, 42_000))
            ibo.last_price_flash = now_ms

            for sym, st in self._states.items():
                if sym == "IBOUSDT":
                    continue
                st.change24h = _base_binance_pct_24h(_pair_base(sym))
                st.volume24h = max(0.0, st.volume24h * 0.994 + random.uniform(2_500, 15_000))
                st.last_price_flash = now_ms

            for _sym, st in self._states.items():
                self._update_candles_locked(st, now_ms)
                self._rebuild_orderbook_locked(st, smooth=True)
                self._gen_trades_locked(st, random.randint(1, 3))

        await self._persist_state()

    # ── Market helpers (called under lock) ───────────────────────────────────

    def _calc_24h_change_locked(self, st: SymbolState) -> float:
        c1d = st.candles.get("1d")
        if not c1d:
            return 0.0
        open_24h = float(c1d[0]["open"])
        return ((st.price - open_24h) / open_24h) * 100.0 if open_24h > 0 else 0.0

    def _update_candles_locked(self, st: SymbolState, now_ms: int) -> None:
        for iv, sec in INTERVAL_SECONDS.items():
            bucket_ms = sec * 1000
            start_ms = (now_ms // bucket_ms) * bucket_ms
            agg = st.open_candles.get(iv)
            if agg is None:
                agg = CandleAgg(open=st.price, high=st.price, low=st.price,
                                close=st.price, volume=0.0, start_ms=start_ms)
                st.open_candles[iv] = agg

            if start_ms > agg.start_ms:
                # Finalize closed candle.
                finalized = {
                    "time": agg.start_ms // 1000,
                    "open": agg.open, "high": agg.high,
                    "low": agg.low,   "close": agg.close,
                    "volume": agg.volume,
                }
                st.candles[iv].append(finalized)
                self._last_candle_event[(st.symbol, iv)] = finalized
                agg = CandleAgg(open=st.price, high=st.price, low=st.price,
                                close=st.price, volume=0.0, start_ms=start_ms)
                st.open_candles[iv] = agg

            # Keep open candle always current — this runs under lock so st.price
            # is the same value the fast micro-tick last wrote.
            agg.close = st.price
            agg.high  = max(agg.high, st.price)
            agg.low   = min(agg.low,  st.price)
            spike = random.uniform(3.2, 6.4) if (
                (time.time() - st.last_volume_spike_ts) > 1800
                and random.random() < 0.08
            ) else 1.0
            if spike > 1.0:
                st.last_volume_spike_ts = time.time()
            agg.volume += random.uniform(80.0, 650.0) * spike

    def _align_orderbook_prices_locked(self, st: SymbolState) -> None:
        """Re-center bid/ask levels on live price; keep quantities (1 Hz book track)."""
        px = st.price
        prev_b_qty = [float(r[1]) for r in st.orderbook.get("bids", [])]
        prev_a_qty = [float(r[1]) for r in st.orderbook.get("asks", [])]

        bids: List = []
        asks: List = []
        for i in range(OB_LEVELS):
            bid_px = px * (1.0 - (i + 1) * 0.0005)
            ask_px = px * (1.0 + (i + 1) * 0.0005)

            if i < len(prev_b_qty) and prev_b_qty[i] > 0:
                bq = prev_b_qty[i]
            else:
                bq = random.uniform(100.0, 3_000.0)

            if i < len(prev_a_qty) and prev_a_qty[i] > 0:
                aq = prev_a_qty[i]
            else:
                aq = random.uniform(100.0, 3_000.0)

            bids.append([f"{bid_px:.8f}", f"{bq:.4f}"])
            asks.append([f"{ask_px:.8f}", f"{aq:.4f}"])

        bids.sort(key=lambda x: float(x[0]), reverse=True)
        asks.sort(key=lambda x: float(x[0]))
        st.orderbook = {"bids": bids, "asks": asks}

    def _rebuild_orderbook_locked(self, st: SymbolState, *, smooth: bool) -> None:
        """Rebuild depth book around current price.

        smooth=True  →  carry forward existing quantities with ±12 % jitter
                        (makes the book feel alive without flickering wildly).
        smooth=False →  fresh random quantities (used on first init).
        """
        px = st.price
        prev_b_qty = [float(r[1]) for r in st.orderbook.get("bids", [])]
        prev_a_qty = [float(r[1]) for r in st.orderbook.get("asks", [])]

        bids: List = []
        asks: List = []
        for i in range(OB_LEVELS):
            bid_px = px * (1.0 - (i + 1) * 0.0005)
            ask_px = px * (1.0 + (i + 1) * 0.0005)

            if smooth and i < len(prev_b_qty) and prev_b_qty[i] > 0:
                bq = _clamp(prev_b_qty[i] * random.uniform(0.88, 1.12), 10.0, 10_000.0)
            else:
                bq = random.uniform(100.0, 3_000.0)

            if smooth and i < len(prev_a_qty) and prev_a_qty[i] > 0:
                aq = _clamp(prev_a_qty[i] * random.uniform(0.88, 1.12), 10.0, 10_000.0)
            else:
                aq = random.uniform(100.0, 3_000.0)

            bids.append([f"{bid_px:.8f}", f"{bq:.4f}"])
            asks.append([f"{ask_px:.8f}", f"{aq:.4f}"])

        bids.sort(key=lambda x: float(x[0]), reverse=True)
        asks.sort(key=lambda x: float(x[0]))
        st.orderbook = {"bids": bids, "asks": asks}

    def _gen_trades_locked(self, st: SymbolState, count: int) -> None:
        if not st.orderbook["bids"] or not st.orderbook["asks"]:
            return
        best_bid = float(st.orderbook["bids"][0][0])
        best_ask = float(st.orderbook["asks"][0][0])
        lo, hi = min(best_bid, best_ask), max(best_bid, best_ask)
        for _ in range(count):
            side = "buy" if random.random() > 0.5 else "sell"
            px = random.uniform(lo, hi)
            qty = random.uniform(50.0, 2_000.0)
            st.trades.appendleft({
                "side": side,
                "price": round(px, 8),
                "qty": round(qty, 4),
                "timestamp": _ms(),
            })

    # ── State persistence ────────────────────────────────────────────────────

    async def _persist_state(self) -> None:
        db = get_db()
        ibo = self._states.get("IBOUSDT")
        if ibo:
            await db.ibo_market_state.update_one(
                {"symbol": "IBOUSDT"},
                {"$set": {
                    "price": ibo.price, "change24h": ibo.change24h,
                    "volume24h": ibo.volume24h, "marketCap": ibo.marketCap,
                    "trend": ibo.trend, "volatility": ibo.volatility,
                    "updated_at": _ms(),
                }},
                upsert=True,
            )

        upserts = list(self._last_candle_event.items())
        self._last_candle_event.clear()
        for (symbol, interval), candle in upserts:
            ts_ms = int(candle["time"] * 1000)
            try:
                await db.ibo_candles.update_one(
                    {"symbol": symbol, "interval": interval, "timestamp": ts_ms},
                    {"$set": {"open": float(candle["open"]), "high": float(candle["high"]),
                              "low": float(candle["low"]),  "close": float(candle["close"]),
                              "volume": float(candle["volume"])},
                     "$setOnInsert": {"symbol": symbol, "interval": interval, "timestamp": ts_ms}},
                    upsert=True,
                )
            except Exception:  # noqa: BLE001
                pass

        # Prune excess candles (keep only last MAX_CANDLES_PER_INTERVAL per series).
        for (symbol, interval), _ in upserts:
            old = await db.ibo_candles.find(
                {"symbol": symbol, "interval": interval}, {"_id": 1}
            ).sort("timestamp", -1).skip(MAX_CANDLES_PER_INTERVAL).to_list(length=1000)
            if old:
                await db.ibo_candles.delete_many({"_id": {"$in": [r["_id"] for r in old]}})

    # ── Public read API (called by HTTP/WS handlers) ─────────────────────────

    async def _ensure_symbol_state(self, sym: str) -> SymbolState:
        if sym not in self._states:
            if "IBOUSDT" not in self._states:
                raise RuntimeError("IBO mock market engine is not ready")
            ibo = self._states["IBOUSDT"]
            await self._init_symbol_locked(sym, ibo.price, "neutral", 0.0022)
        return self._states[sym]

    async def ticker(self, symbol: str) -> Dict[str, Any]:
        sym = symbol.upper()
        if not is_supported(sym):
            raise KeyError(sym)
        async with self._lock:
            st = await self._ensure_symbol_state(sym)
            if sym == "IBOUSDT":
                self._live_tick_ibousdt_locked(st, slow=False)
            else:
                base = _pair_base(sym)
                base_usdt = _base_usdt_price(base)
                if base in _MAJOR_CROSS_BASES:
                    st.last_base_usdt = base_usdt
                    st.price = base_usdt / max(_platform_ibo_anchor(), 1e-9)
                    self._sync_open_candles_to_price_locked(st)
                else:
                    st.price = _derive_cross_pair_price(sym, slow=False)
                self._align_orderbook_prices_locked(st)
            return {
                "symbol": sym,
                "price": round(st.price, 8),
                "change24h": round(st.change24h, 4),
                "volume24h": round(st.volume24h, 4),
                "marketCap": round(st.marketCap, 2),
                "trend": st.trend,
                "volatility": st.volatility,
                "updatedAt": _ms(),
            }

    async def ticker_all(self) -> List[Dict[str, Any]]:
        return [await self.ticker(s) for s in SUPPORTED_SYMBOLS]

    async def candles(self, symbol: str, interval: str, limit: int) -> List[Dict[str, Any]]:
        sym = symbol.upper()
        iv = interval.lower()
        if not is_supported(sym):
            raise KeyError(sym)
        if iv not in INTERVAL_SECONDS:
            raise ValueError(iv)
        n = int(_clamp(limit, 1, 500))
        async with self._lock:
            st = await self._ensure_symbol_state(sym)
            rows = list(st.candles[iv])[-n:]
            open_c = st.open_candles.get(iv)
            if open_c:
                # Always use st.price as close — the micro-tick updates price
                # every 1 s, but the open candle's close field is only refreshed
                # every 5 s (slow tick).  Using st.price here guarantees that
                # ticker.price == last_candle.close on every REST load, so the
                # frontend never needs to apply a ratio offset.
                live = st.price
                rows = rows + [{
                    "time":   open_c.start_ms // 1000,
                    "open":   open_c.open,
                    "high":   max(open_c.high, live),
                    "low":    min(open_c.low,  live),
                    "close":  live,
                    "volume": open_c.volume,
                }]
            return rows[-n:]

    async def orderbook(self, symbol: str) -> Dict[str, Any]:
        sym = symbol.upper()
        if not is_supported(sym):
            raise KeyError(sym)
        async with self._lock:
            st = await self._ensure_symbol_state(sym)
            self._align_orderbook_prices_locked(st)
            ob = st.orderbook
            return {
                "symbol": sym,
                "bids": ob["bids"][:OB_LEVELS],
                "asks": ob["asks"][:OB_LEVELS],
                "updatedAt": _ms(),
            }

    async def trades(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        sym = symbol.upper()
        if not is_supported(sym):
            raise KeyError(sym)
        n = int(_clamp(limit, 1, 50))
        async with self._lock:
            st = await self._ensure_symbol_state(sym)
            return list(st.trades)[:n]


# ── Singleton ─────────────────────────────────────────────────────────────────
engine = IBOMockMarketEngine()


# ── Format helpers for generic trading endpoints ──────────────────────────────

def _fmt(v: float, places: int = 8) -> str:
    s = f"{v:.{places}f}"
    return s.rstrip("0").rstrip(".") or "0"


async def to_exchange_ticker(sym: str) -> Dict[str, Any]:
    sym = sym.upper()
    tk = await engine.ticker(sym)
    px = float(tk["price"])
    ch_pct = float(tk.get("change24h") or 0)
    vol = float(tk.get("volume24h") or 0)
    open_px = px / (1.0 + ch_pct / 100.0) if abs(ch_pct) > 1e-9 else px
    ch_abs = px - open_px
    band = max(0.005, abs(ch_pct) / 100.0)
    spread = px * 0.0002
    return {
        "symbol": sym,
        "price": _fmt(px),
        "priceChange": _fmt(ch_abs),
        "priceChangePercent": f"{ch_pct:.2f}",
        "highPrice": _fmt(px * (1.0 + band)),
        "lowPrice":  _fmt(px * (1.0 - band)),
        "volume": _fmt(vol, 2),
        "quoteVolume": _fmt(vol * px, 2),
        "openPrice": _fmt(open_px),
        "weightedAvgPrice": _fmt(px),
        "bidPrice": _fmt(px - spread),
        "askPrice": _fmt(px + spread),
        "prevClosePrice": _fmt(open_px),
        "count": str(random.randint(8_000, 18_000)),
    }


async def to_exchange_klines(sym: str, interval: str, limit: int) -> List[Dict[str, Any]]:
    return await engine.candles(sym.upper(), interval.lower(), limit)


async def to_exchange_orderbook(sym: str, limit: int) -> Dict[str, Any]:
    ob = await engine.orderbook(sym.upper())
    n = int(_clamp(limit, 5, OB_LEVELS))
    return {"bids": ob["bids"][:n], "asks": ob["asks"][:n]}


async def to_exchange_trades(sym: str, limit: int) -> List[Dict[str, Any]]:
    rows = await engine.trades(sym.upper(), limit)
    out: List[Dict[str, Any]] = []
    for i, t in enumerate(rows):
        buy = str(t.get("side", "")).lower() == "buy"
        px = float(t["price"])
        qty = float(t["qty"])
        ts = int(t.get("timestamp") or 0)
        out.append({
            "id": limit - i,
            "price": _fmt(px),
            "qty": _fmt(qty, 4),
            "quoteQty": _fmt(px * qty, 4),
            "time": ts,
            "isBuyerMaker": not buy,
        })
    return out
