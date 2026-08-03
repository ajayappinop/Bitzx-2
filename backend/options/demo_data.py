"""
Demo / preview option chains anchored to live Binance spot (read-only math).

- ``GET /api/options/demo-chain`` returns synthetic rows for UI when the book is empty.
- ``OPTIONS_DEMO_DATA=1`` at startup seeds the same geometry into Mongo (tradable).
- Strike ladder: ``OPTIONS_DEMO_STRIKES_EACH_SIDE`` (default **5**) → ATM ± 5 steps (**11** strikes per expiry),
  not only three strikes.
- Admin can (re)seed anytime: ``POST /api/admin/options/seed-demo-data`` with body ``{"symbols":["BTCUSDT"]}`` (force).
- If **api.binance.com** is blocked, set ``OPTIONS_DEMO_SPOT_JSON='{"BTCUSDT":98000,"ETHUSDT":3500}'`` or
  ``OPTIONS_DEMO_SPOT_BTCUSDT=98000`` (per-symbol) in the backend ``.env``. Mainnet is tried first, then **testnet.binance.vision**.
"""

from __future__ import annotations

import json
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

from .constants import COL_CONTRACTS, COL_UNDERLYINGS
from .db import db
from .services import contracts as contracts_svc
from .services.contracts import _contract_id
from .services import underlyings as und_svc

logger = logging.getLogger(__name__)

_BINANCE_PRICE = "https://api.binance.com/api/v3/ticker/price"
_BINANCE_TESTNET_PRICE = "https://testnet.binance.vision/api/v3/ticker/price"


async def fetch_binance_spot(symbol: str) -> float:
    sym = (symbol or "").strip().upper()
    if not sym.endswith("USDT"):
        raise ValueError("symbol must be *USDT")
    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.get(_BINANCE_PRICE, params={"symbol": sym})
        if r.status_code != 200:
            raise ValueError(f"binance HTTP {r.status_code}")
        return float((r.json() or {}).get("price") or 0)


async def _fetch_binance_testnet_spot(symbol: str) -> float:
    sym = (symbol or "").strip().upper()
    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.get(_BINANCE_TESTNET_PRICE, params={"symbol": sym})
        if r.status_code != 200:
            raise ValueError(f"binance testnet HTTP {r.status_code}")
        return float((r.json() or {}).get("price") or 0)


def _spot_from_env(usym: str) -> Optional[float]:
    """Optional fixed prices when outbound Binance is blocked (office firewall, air-gapped dev)."""
    raw_json = (os.environ.get("OPTIONS_DEMO_SPOT_JSON") or "").strip()
    if raw_json:
        try:
            m = json.loads(raw_json)
            v = m.get(usym) or m.get(usym.upper())
            if v is not None and str(v).strip() != "":
                x = float(v)
                if x > 0:
                    return x
        except (ValueError, TypeError, json.JSONDecodeError):
            logger.debug("OPTIONS_DEMO_SPOT_JSON parse failed", exc_info=False)
    base = usym.replace("USDT", "")
    for key in (f"OPTIONS_DEMO_SPOT_{usym}", f"OPTIONS_DEMO_SPOT_{base}"):
        raw = (os.environ.get(key) or "").strip()
        if raw:
            try:
                x = float(raw)
                if x > 0:
                    return x
            except ValueError:
                continue
    return None


async def resolve_demo_spot(usym: str) -> float:
    """Spot for demo chain / seed: env first, then Binance mainnet, then Binance testnet."""
    sym = (usym or "").strip().upper()
    if not sym.endswith("USDT"):
        raise ValueError("symbol must be *USDT")
    s = _spot_from_env(sym)
    if s is not None:
        logger.info("options demo spot for %s from env: %s", sym, s)
        return s
    try:
        return await fetch_binance_spot(sym)
    except Exception as exc_main:  # noqa: BLE001
        logger.warning("binance mainnet spot failed for %s: %s — trying testnet", sym, exc_main)
        try:
            return await _fetch_binance_testnet_spot(sym)
        except Exception as exc_test:  # noqa: BLE001
            raise ValueError(
                f"could not get spot for {sym}: mainnet ({exc_main}); testnet ({exc_test}). "
                "When Binance is blocked, set OPTIONS_DEMO_SPOT_JSON, e.g. "
                '\'{\"BTCUSDT\":98000,\"ETHUSDT\":3500}\' or OPTIONS_DEMO_SPOT_BTCUSDT=98000 in backend .env.'
            ) from exc_test


def _strike_step(symbol: str, spot: float) -> float:
    base = symbol.replace("USDT", "").upper()
    table = {
        "BTC": 500.0,
        "ETH": 25.0,
        "BNB": 1.0,
        "SOL": 0.05,
        "XRP": 0.001,
        "IBO": 0.0001,
    }
    if base in table:
        return table[base]
    if not spot or spot <= 0:
        return 1.0
    mag = 10 ** math.floor(math.log10(spot))
    return max(mag / 200.0, 0.0001)


def _expiries() -> List[str]:
    """Two monthly-ish anchors at 16:00 UTC (same style as admin examples)."""
    out: List[str] = []
    for days in (21, 56):
        dt = datetime.now(timezone.utc) + timedelta(days=days)
        dt = dt.replace(hour=16, minute=0, second=0, microsecond=0)
        out.append(dt.isoformat().replace("+00:00", "Z"))
    return out


def _strike_ladder(spot: float, step: float) -> List[float]:
    """Symmetric strikes around ATM (same step grid used when admin lists contracts).

    Width is ``OPTIONS_DEMO_STRIKES_EACH_SIDE`` (default **5**) → **11** strikes from
    ``atm - 5*step`` … ``atm + 5*step``. Capped so inserts stay bounded (max 31 strikes).
    """
    if step <= 0:
        step = 1.0
    atm = round(spot / step) * step
    raw = (os.environ.get("OPTIONS_DEMO_STRIKES_EACH_SIDE") or "5").strip()
    try:
        n_each = int(raw)
    except ValueError:
        n_each = 5
    n_each = max(1, min(n_each, 15))

    out: List[float] = []
    floor_px = max(step * 0.01, 1e-12)
    for k in range(-n_each, n_each + 1):
        s = atm + k * step
        if s >= floor_px:
            out.append(round(float(s), 8))
    return sorted(set(out))


def _norm_symbol(sym: str) -> str:
    return und_svc._norm_symbol(sym)


def build_demo_contract_dicts(underlying_symbol: str, spot: float) -> List[Dict[str, Any]]:
    """Rows shaped like ``options_contracts`` docs + ``demo_contract`` flag (not persisted)."""
    usym = _norm_symbol(underlying_symbol)
    step = _strike_step(usym, spot)
    strikes = _strike_ladder(spot, step)
    expiries = _expiries()
    rows: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for expiry in expiries:
        for strike in strikes:
            for opt in ("call", "put"):
                cid = _contract_id(usym, expiry, strike, opt)
                rows.append(
                    {
                        "id": cid,
                        "underlying_symbol": usym,
                        "expiry": expiry,
                        "strike": float(strike),
                        "option_type": opt,
                        "tick_size": 0.01,
                        "lot_size": 1.0,
                        "min_qty": 1.0,
                        "max_qty": 1_000_000.0,
                        "listed": True,
                        "trading_enabled": True,
                        "status": "listed",
                        "created_at": now,
                        "updated_at": now,
                        "demo_contract": True,
                        "demo_index_price": round(float(spot), 8),
                    }
                )
    return rows


async def demo_chain_payload(underlying_symbol: str) -> Dict[str, Any]:
    usym = _norm_symbol(underlying_symbol)
    spot = await resolve_demo_spot(usym)
    if spot <= 0:
        raise ValueError("invalid spot")
    contracts = build_demo_contract_dicts(usym, spot)
    payload = {
        "underlying_symbol": usym,
        "demo": True,
        "index_price": round(spot, 8),
        "contracts": contracts,
    }
    try:
        from . import binance_reference as binance_ref
        from datetime import datetime, timezone

        try:
            await binance_ref.enrich_chain_rows(contracts, underlying_symbol=usym, index_px=spot)
        except Exception as exc:  # noqa: BLE001
            logger.debug("demo chain binance enrich failed: %s", exc)
        # Always ensure mark/last/volume so markets UI matches Delta-style contract rows.
        now_dt = datetime.now(timezone.utc)
        for row in contracts:
            syn = binance_ref._synthetic_quote(row, float(spot), now_dt)
            if syn:
                binance_ref._apply_market_to_row(row, syn, index_px=spot, now_dt=now_dt)
    except Exception as exc:  # noqa: BLE001
        logger.debug("demo chain synthetic enrich failed: %s", exc)
    return payload


def _env_demo_enabled() -> bool:
    return (os.environ.get("OPTIONS_DEMO_DATA") or "").strip().lower() in ("1", "true", "yes", "on")


def _demo_symbols() -> List[str]:
    raw = (os.environ.get("OPTIONS_DEMO_SYMBOLS") or "BTCUSDT,ETHUSDT").strip()
    parts = [p.strip().upper() for p in raw.split(",") if p.strip()]
    return parts or ["BTCUSDT", "ETHUSDT"]


async def seed_demo_options_into_db(*, symbols: Optional[List[str]] = None, force: bool = False) -> Dict[str, Any]:
    """Idempotent inserts from live Binance spot. If ``force`` is False, only runs when ``OPTIONS_DEMO_DATA`` is set."""
    if not force and not _env_demo_enabled():
        return {"skipped": True, "reason": "set OPTIONS_DEMO_DATA=1 or call admin POST /api/admin/options/seed-demo-data"}

    sym_list = [s.strip().upper() for s in (symbols or _demo_symbols()) if s.strip()]
    if not sym_list:
        sym_list = _demo_symbols()

    created_u = 0
    created_c = 0
    skipped_underlyings_existing = 0
    skipped_contracts_existing = 0
    skipped_symbols: List[str] = []
    errors: List[str] = []
    contract_other_failures: List[str] = []

    normalized_ok: List[str] = []

    for sym in sym_list:
        try:
            usym = _norm_symbol(sym)
        except ValueError:
            skipped_symbols.append(sym)
            continue
        try:
            spot = await resolve_demo_spot(usym)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{usym}: cannot resolve spot — {exc}")
            logger.warning("options demo seed: no price for %s (%s)", usym, exc)
            continue

        normalized_ok.append(usym)

        u = await und_svc.get_by_symbol(usym)
        if u:
            skipped_underlyings_existing += 1
        else:
            try:
                await und_svc.create({"symbol": usym, "listed": True})
                created_u += 1
            except ValueError as exc:
                msg = str(exc).lower()
                if "already" in msg:
                    skipped_underlyings_existing += 1
                else:
                    errors.append(f"{usym} underlying: {exc}")
                    logger.warning("options demo underlying create %s: %s", usym, exc)

        u2 = await und_svc.get_by_symbol(usym)
        if not u2:
            errors.append(f"{usym}: underlying still missing after create — skipping contracts for this symbol")
            continue

        for row in build_demo_contract_dicts(usym, spot):
            body = {
                "underlying_symbol": usym,
                "expiry": row["expiry"],
                "strike": row["strike"],
                "option_type": row["option_type"],
                "tick_size": row["tick_size"],
                "lot_size": row["lot_size"],
                "min_qty": row["min_qty"],
                "max_qty": row["max_qty"],
                "listed": True,
                "trading_enabled": True,
            }
            try:
                await contracts_svc.create(body)
                created_c += 1
            except ValueError as exc:
                msg = str(exc).lower()
                if "already exists" in msg or "already" in msg:
                    skipped_contracts_existing += 1
                else:
                    cid = _contract_id(usym, body["expiry"], float(body["strike"]), body["option_type"])
                    contract_other_failures.append(f"{cid}: {exc}")
                    logger.warning("options demo contract %s: %s", cid, exc)

    totals: Dict[str, int] = {"underlyings": 0, "contracts": 0}
    if normalized_ok:
        totals["underlyings"] = int(await db()[COL_UNDERLYINGS].count_documents({"symbol": {"$in": normalized_ok}}))
        totals["contracts"] = int(await db()[COL_CONTRACTS].count_documents({"underlying_symbol": {"$in": normalized_ok}}))

    if errors and created_u == 0 and created_c == 0:
        summary = "No new rows — " + "; ".join(errors[:6])
        if skipped_contracts_existing or skipped_underlyings_existing:
            summary += (
                f" (also skipped {skipped_contracts_existing} existing contract id(s), "
                f"{skipped_underlyings_existing} existing underlying row(s).)"
            )
    elif created_u == 0 and created_c == 0:
        if skipped_contracts_existing > 0 or skipped_underlyings_existing > 0:
            summary = (
                "Nothing new was inserted — this seed is idempotent: your DB already has these demo underlyings/contracts. "
                f"Skipped {skipped_contracts_existing} contract id(s) that already exist and "
                f"{skipped_underlyings_existing} underlying row(s) that were already present. "
                f"Current totals for the priced symbol(s): {totals['underlyings']} underlyings, {totals['contracts']} contracts."
            )
        else:
            summary = "No rows were inserted — no symbols received a Binance price (check network / symbol list)."
    else:
        summary = (
            f"Inserted {created_u} new underlying(s) and {created_c} new contract(s). "
            f"Totals for these symbols: {totals['underlyings']} underlyings, {totals['contracts']} contracts."
        )
        if skipped_contracts_existing or skipped_underlyings_existing:
            summary += (
                f" (Skipped {skipped_contracts_existing} duplicate contract(s), "
                f"{skipped_underlyings_existing} already-listed underlying(s).)"
            )
        if contract_other_failures:
            summary += " Some contract inserts failed — see contract_other_failures in the API response."

    out = {
        "ok": True,
        "created_underlyings": created_u,
        "created_contracts": created_c,
        "skipped_underlyings_existing": skipped_underlyings_existing,
        "skipped_contracts_existing": skipped_contracts_existing,
        "symbols": sym_list,
        "symbols_priced_ok": normalized_ok,
        "skipped_symbols": skipped_symbols,
        "errors": errors,
        "contract_other_failures": contract_other_failures,
        "totals_for_symbols": totals,
        "summary": summary,
    }
    logger.info(
        "options demo seed: +%s underlyings, +%s contracts, skipped_dup_contracts=%s (force=%s)",
        created_u,
        created_c,
        skipped_contracts_existing,
        force,
    )
    return out


async def seed_demo_options_if_needed() -> None:
    """Startup hook when ``OPTIONS_DEMO_DATA`` is enabled."""
    await seed_demo_options_into_db(force=False)
