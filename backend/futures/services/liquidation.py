"""Liquidation engine.

The mark-price worker tells us when prices change; this module is what
the *liquidation worker* runs on every tick:

1. Fetch all open positions for ``symbol``.
2. Recompute equity + maintenance margin at the latest mark price.
3. If equity ≤ maintenance margin, force-close the position via
   :func:`futures.services.position.force_close`.
4. Insert a row in ``futures_liquidations`` for audit / reporting.

Designed to be cheap to call: O(N open positions) with a single Mongo
scan per symbol per tick.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List

from ..constants import COL_LIQUIDATIONS, COL_POSITIONS
from ..db import db
from . import position as position_svc
from . import risk

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def scan_symbol(symbol: str, mark_price: float) -> List[dict]:
    """Liquidate any positions on ``symbol`` underwater at ``mark_price``."""
    if mark_price is None or mark_price <= 0:
        return []
    cur = db()[COL_POSITIONS].find(
        {"symbol": symbol, "status": "open"}, {"_id": 0}
    )
    closed: List[dict] = []
    async for pos in cur:
        qty = float(pos.get("qty") or 0.0)
        if abs(qty) < 1e-12:
            continue
        side = pos.get("side") or ("long" if qty > 0 else "short")
        notional = abs(qty) * float(mark_price)
        upnl = risk.unrealized_pnl(qty, float(pos.get("entry_price") or 0.0), float(mark_price))
        equity = float(pos.get("isolated_margin") or 0.0) + upnl
        mm = risk.maintenance_margin(notional, risk.maintenance_margin_rate(symbol, notional))
        if equity <= mm:
            res = await position_svc.force_close(pos, mark_price, reason="liquidation")
            await db()[COL_LIQUIDATIONS].insert_one({
                "id": f"liq_{uuid.uuid4().hex[:18]}",
                "uid": pos["uid"],
                "symbol": symbol,
                "position_id": pos["id"],
                "side": side,
                "qty": abs(qty),
                "entry_price": float(pos.get("entry_price") or 0.0),
                "mark_price": float(mark_price),
                "realized_pnl": res["realized_pnl"],
                "fee": res["fee"],
                "isolated_margin": float(pos.get("isolated_margin") or 0.0),
                "created_at": _now_iso(),
            })
            closed.append({"position_id": pos["id"], **res})
    if closed:
        logger.warning("liquidated %d positions on %s @ %s", len(closed), symbol, mark_price)
    return closed
