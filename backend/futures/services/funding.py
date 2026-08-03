"""Funding rate engine.

Funding is the periodic cash flow exchanged between longs and shorts to
keep the perpetual price tethered to the spot index. We use the standard
formula:

    rate = clamp(premium_avg + interest_rate, -CAP, +CAP)
    payment(uid, symbol) = rate × position_notional × dt_fraction

Settled every :data:`FUNDING_INTERVAL_SEC` seconds. Premium samples are
collected by the worker between settlements; this module exposes:

* :func:`compute_rate`     — produce the rate for a settlement window
* :func:`settle_symbol`    — apply funding to every open position
* :func:`record_premium`   — used by the worker to push samples
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from statistics import mean
from typing import Any, Dict, List

from ..constants import (
    COL_FUNDING_PAYS,
    COL_FUNDING_RATES,
    COL_POSITIONS,
    FUNDING_CAP,
    FUNDING_INTERVAL_SEC,
)
from ..db import db
from . import ledger as fledger

logger = logging.getLogger(__name__)

_INTEREST_RATE_PER_PERIOD = 0.0001 / 3.0  # 1bp/day, three settlements per day

_premium_samples: Dict[str, List[float]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_premium(symbol: str, mark_price: float, index_price: float) -> None:
    """Push one premium sample. Premium = (mark - index) / index."""
    if not mark_price or not index_price or index_price <= 0:
        return
    p = (float(mark_price) - float(index_price)) / float(index_price)
    _premium_samples.setdefault(symbol, []).append(p)


def compute_rate(symbol: str) -> float:
    samples = _premium_samples.get(symbol) or []
    premium_avg = mean(samples) if samples else 0.0
    rate = premium_avg + _INTEREST_RATE_PER_PERIOD
    rate = max(-FUNDING_CAP, min(FUNDING_CAP, rate))
    return float(rate)


async def settle_symbol(symbol: str, mark_price: float) -> Dict[str, Any]:
    """Apply funding to every open position on ``symbol``.

    Longs pay shorts when ``rate>0`` (perp trades above index) and vice
    versa. Returns a settlement summary.
    """
    rate = compute_rate(symbol)
    _premium_samples[symbol] = []  # reset for next interval

    rate_doc = {
        "id": f"fr_{uuid.uuid4().hex[:18]}",
        "symbol": symbol,
        "rate": rate,
        "mark_price": float(mark_price or 0.0),
        "interval_sec": FUNDING_INTERVAL_SEC,
        "settled_at": _now_iso(),
    }
    await db()[COL_FUNDING_RATES].insert_one(rate_doc)

    if rate == 0 or not mark_price:
        return {"rate": rate, "settled": 0}

    cur = db()[COL_POSITIONS].find(
        {"symbol": symbol, "status": "open"}, {"_id": 0}
    )
    settled = 0
    async for pos in cur:
        qty = float(pos.get("qty") or 0.0)
        if abs(qty) < 1e-12:
            continue
        notional = abs(qty) * float(mark_price)
        # Longs (qty>0) pay when rate>0; shorts receive. Sign of payment
        # to user = -sign(qty) × rate × notional.
        amount = (-1 if qty > 0 else +1) * rate * notional
        if abs(amount) < 1e-9:
            continue
        try:
            if amount > 0:
                await fledger.credit(
                    pos["uid"], amount, txn_type="funding",
                    ref_type="funding_rate", ref_id=rate_doc["id"],
                    meta={"symbol": symbol, "rate": rate, "qty": qty, "mark": mark_price},
                )
            else:
                await fledger.debit(
                    pos["uid"], abs(amount), txn_type="funding",
                    ref_type="funding_rate", ref_id=rate_doc["id"],
                    meta={"symbol": symbol, "rate": rate, "qty": qty, "mark": mark_price},
                )
            await db()[COL_FUNDING_PAYS].insert_one({
                "id": f"fp_{uuid.uuid4().hex[:18]}",
                "uid": pos["uid"],
                "symbol": symbol,
                "position_id": pos["id"],
                "rate": rate,
                "amount": float(amount),
                "qty": qty,
                "mark_price": float(mark_price),
                "settled_at": _now_iso(),
            })
            settled += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("funding settle failed for uid=%s: %s", pos.get("uid"), exc)
    return {"rate": rate, "settled": settled}
