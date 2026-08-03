"""European cash settlement (USDT intrinsic) at expiry — Phase 2."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from services.db import get_client, supports_transactions

from ..constants import COL_CONTRACTS, COL_ORDERS, COL_POSITIONS, COL_SETTLEMENT_EVENTS, MARGIN_ASSET
from ..db import db
from . import contracts as contracts_svc
from . import ledger as oledger
from . import orders as orders_svc

logger = logging.getLogger(__name__)

_BINANCE_PRICE = "https://api.binance.com/api/v3/ticker/price"
_BINANCE_TESTNET_PRICE = "https://testnet.binance.vision/api/v3/ticker/price"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


def parse_contract_expiry(expiry: str) -> datetime:
    raw = (expiry or "").strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def intrinsic_usdt_per_contract(*, option_type: str, index_s: float, strike: float) -> float:
    opt = (option_type or "").lower()
    s, k = float(index_s), float(strike)
    if opt == "call":
        return max(0.0, s - k)
    if opt == "put":
        return max(0.0, k - s)
    raise ValueError("option_type must be call or put")


def _settlement_spot_from_env(sym: str) -> Optional[float]:
    """Optional ``OPTIONS_SETTLEMENT_SPOT_JSON='{"BTCUSDT":97000}'`` when Binance is unreachable."""
    raw = (os.environ.get("OPTIONS_SETTLEMENT_SPOT_JSON") or "").strip()
    if not raw:
        return None
    try:
        m = json.loads(raw)
        if isinstance(m, dict) and sym in m:
            return float(m[sym])
    except (TypeError, ValueError, json.JSONDecodeError):
        logger.warning("OPTIONS_SETTLEMENT_SPOT_JSON invalid or missing symbol %s", sym)
    return None


async def fetch_settlement_index_binance(underlying_symbol: str) -> float:
    """Settlement index: env JSON override, then Binance mainnet, then Binance testnet."""
    sym = (underlying_symbol or "").strip().upper()
    if not sym.endswith("USDT"):
        raise ValueError("underlying must be *USDT for Binance index in v1")
    env_px = _settlement_spot_from_env(sym)
    if env_px is not None and env_px > 0:
        return float(env_px)

    last_err: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=15.0) as client:
        for label, url in (("mainnet", _BINANCE_PRICE), ("testnet", _BINANCE_TESTNET_PRICE)):
            try:
                r = await client.get(url, params={"symbol": sym})
                if r.status_code != 200:
                    raise ValueError(f"{label} HTTP {r.status_code}")
                data = r.json()
                px = float(data["price"])
                if px > 0:
                    if label == "testnet":
                        logger.warning("options settlement index for %s from %s (mainnet failed)", sym, label)
                    return px
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                logger.debug("options settlement %s index failed for %s: %s", label, sym, exc)
                continue
    raise ValueError(
        f"could not fetch settlement index for {sym}: {last_err}. "
        "Set OPTIONS_SETTLEMENT_SPOT_JSON or pass settlement_index in the admin settle request."
    ) from last_err


async def _list_open_positions(contract_id: str) -> List[Dict[str, Any]]:
    cur = db()[COL_POSITIONS].find({"contract_id": contract_id, "status": "open"}, {"_id": 0})
    return await cur.to_list(length=5000)


async def _settle_leg(
    *,
    contract: Dict[str, Any],
    pos: Dict[str, Any],
    index_s: float,
    intrinsic: float,
    payout: float,
    session: Any,
) -> Dict[str, Any]:
    uid = str(pos.get("uid") or "")
    pos_id = str(pos.get("id") or "")
    cid = str(contract.get("id") or "")
    leg_id = f"opts_leg_{cid}_{pos_id}"
    intrinsic_r = _round(intrinsic)
    payout_r = _round(payout)

    await db()[COL_SETTLEMENT_EVENTS].insert_one(
        {
            "id": leg_id,
            "contract_id": cid,
            "position_id": pos_id,
            "uid": uid,
            "settlement_index": _round(index_s),
            "intrinsic_per_contract": intrinsic_r,
            "payout": payout_r,
            "status": "completed",
            "created_at": _now_iso(),
        },
        session=session,
    )

    if payout_r > 1e-10:
        await oledger.credit(
            uid,
            payout_r,
            asset=MARGIN_ASSET,
            txn_type="settlement_pay",
            ref_type="settlement",
            ref_id=leg_id,
            meta={
                "contract_id": cid,
                "position_id": pos_id,
                "option_type": contract.get("option_type"),
                "strike": contract.get("strike"),
            },
            session=session,
        )

    await db()[COL_POSITIONS].update_one(
        {"id": pos_id, "status": "open"},
        {
            "$set": {
                "status": "settled",
                "qty": 0.0,
                "settlement_index": _round(index_s),
                "settlement_intrinsic": intrinsic_r,
                "settlement_payout": payout_r,
                "settled_at": _now_iso(),
                "updated_at": _now_iso(),
            }
        },
        session=session,
    )
    return {"position_id": pos_id, "uid": uid, "payout": payout_r, "intrinsic": intrinsic_r}


async def settle_contract(
    contract_id: str,
    *,
    dry_run: bool = False,
    force: bool = False,
    settlement_index_override: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Cash-settle all open longs for ``contract_id`` at intrinsic (S, K, call|put).

    Cancels open orders on the contract, credits options wallets, closes positions,
    and marks the contract ``settled`` unless ``dry_run``.
    """
    c = await contracts_svc.get(contract_id)
    if not c:
        raise ValueError("contract not found")

    if c.get("settled_at") or c.get("status") == "settled":
        return {
            "ok": True,
            "idempotent": True,
            "contract_id": contract_id,
            "settled_at": c.get("settled_at"),
            "settlement_index": c.get("settlement_index"),
        }

    exp = parse_contract_expiry(str(c.get("expiry") or ""))
    now = datetime.now(timezone.utc)
    # Dry-run is a read-only preview: allow before expiry. Live settlement still requires expiry or force.
    if not dry_run and not force and now < exp:
        raise ValueError("contract has not reached expiry — pass force=true for manual settlement")

    usym = str(c.get("underlying_symbol") or "")
    strike = float(c.get("strike") or 0.0)
    opt = str(c.get("option_type") or "").lower()
    if strike <= 0:
        raise ValueError("invalid strike on contract")

    if settlement_index_override is not None:
        index_s = float(settlement_index_override)
        if index_s <= 0:
            raise ValueError("settlement_index override must be > 0")
        index_source = "override"
    else:
        try:
            index_s = await fetch_settlement_index_binance(usym)
            index_source = "binance_last"
        except Exception as exc:  # noqa: BLE001
            raise ValueError(
                f"could not fetch settlement index for {usym}: {exc}. "
                "Pass settlement_index in the request body to override."
            ) from exc

    intrinsic = intrinsic_usdt_per_contract(option_type=opt, index_s=index_s, strike=strike)
    positions = await _list_open_positions(contract_id)
    preview_legs: List[Dict[str, Any]] = []
    total_payout = 0.0
    for pos in positions:
        qty = float(pos.get("qty") or 0.0)
        pay = _round(intrinsic * qty)
        total_payout += pay
        preview_legs.append(
            {
                "position_id": pos.get("id"),
                "uid": pos.get("uid"),
                "qty": qty,
                "payout_usdt": pay,
            }
        )

    open_orders = await db()[COL_ORDERS].count_documents(
        {"contract_id": contract_id, "status": {"$in": ["open", "partially_filled"]}}
    )

    summary: Dict[str, Any] = {
        "contract_id": contract_id,
        "dry_run": dry_run,
        "underlying_symbol": usym,
        "settlement_index": _round(index_s),
        "index_source": index_source,
        "intrinsic_per_contract_usdt": _round(intrinsic),
        "open_positions": len(positions),
        "open_orders": int(open_orders),
        "total_payout_usdt": _round(total_payout),
        "legs": preview_legs,
    }

    if dry_run:
        summary["ok"] = True
        return summary

    if not supports_transactions() and len(positions) > 1:
        logger.warning(
            "options settlement: Mongo transactions unavailable — settling %s legs sequentially (risk if process crashes mid-way)",
            len(positions),
        )

    cancel_info = await orders_svc.cancel_all_open_for_contract(contract_id)
    summary["cancelled_orders"] = cancel_info.get("cancelled_orders", 0)

    claimed = await db()[COL_CONTRACTS].find_one_and_update(
        {
            "id": contract_id,
            "settled_at": {"$exists": False},
            "status": {"$nin": ["settled"]},
        },
        {
            "$set": {
                "status": "settling",
                "trading_enabled": False,
                "updated_at": _now_iso(),
            }
        },
    )
    if not claimed:
        c2 = await contracts_svc.get(contract_id)
        if c2 and (c2.get("settled_at") or c2.get("status") == "settled"):
            return {
                "ok": True,
                "idempotent": True,
                "contract_id": contract_id,
                "settled_at": c2.get("settled_at"),
                "settlement_index": c2.get("settlement_index"),
            }
        raise RuntimeError("could not claim contract for settlement (concurrent settle?)")

    positions2 = await _list_open_positions(contract_id)
    settled_legs: List[Dict[str, Any]] = []

    async def _run_all(session: Any) -> None:
        for pos in positions2:
            qty = float(pos.get("qty") or 0.0)
            if qty <= 1e-12:
                continue
            pay = _round(intrinsic * qty)
            leg = await _settle_leg(
                contract=c,
                pos=pos,
                index_s=index_s,
                intrinsic=intrinsic,
                payout=pay,
                session=session,
            )
            settled_legs.append(leg)

    try:
        if supports_transactions():
            async with await get_client().start_session() as sess:
                async with sess.start_transaction():
                    await _run_all(sess)
        else:
            await _run_all(None)
    except Exception as exc:
        await db()[COL_CONTRACTS].update_one(
            {"id": contract_id, "status": "settling"},
            {
                "$set": {
                    "status": "halted",
                    "trading_enabled": False,
                    "settlement_last_error": str(exc)[:500],
                    "updated_at": _now_iso(),
                }
            },
        )
        raise

    now_iso = _now_iso()
    await db()[COL_CONTRACTS].update_one(
        {"id": contract_id},
        {
            "$set": {
                "status": "settled",
                "listed": False,
                "trading_enabled": False,
                "settlement_index": _round(index_s),
                "settled_at": now_iso,
                "updated_at": now_iso,
            }
        },
    )

    summary["ok"] = True
    summary["settled_at"] = now_iso
    summary["settled_legs"] = settled_legs
    return summary
