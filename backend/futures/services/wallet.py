"""Futures wallet snapshot + spot ↔ futures transfer.

The futures wallet is a *separate* set of rows from the spot ``wallets``
collection. Transfers are atomic: spot debit + futures credit happen in a
single Mongo transaction (when supported) or as a strict order-of-ops
otherwise.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, Iterable, List

from services import wallet_service
from services.db import get_client, supports_transactions
from services.errors import InsufficientFundsError

from ..constants import COL_POSITIONS, MARGIN_ASSET
from ..db import db
from . import controls as controls_svc
from . import ledger as fledger

logger = logging.getLogger(__name__)


async def transfer_in(uid: str, amount: float, *, asset: str = MARGIN_ASSET) -> Dict[str, Any]:
    """Spot → futures. Debits spot ``available`` and credits futures
    ``available``. Atomic when the cluster supports transactions."""
    if amount is None or amount <= 0:
        raise ValueError("amount must be > 0")
    if await controls_svc.are_transfers_paused():
        raise ValueError("futures transfers are paused by the platform")
    ref = f"xfer_{uuid.uuid4().hex[:16]}"

    async def _go(session):
        await wallet_service.debit(
            uid, asset, float(amount),
            txn_type="adjustment",
            ref_type="futures_transfer",
            ref_id=ref,
            meta={"direction": "spot_to_futures"},
            session=session,
        )
        await fledger.credit(
            uid, float(amount),
            asset=asset,
            txn_type="transfer_in",
            ref_type="futures_transfer",
            ref_id=ref,
            meta={"direction": "spot_to_futures"},
            session=session,
        )
        return {"ref": ref, "amount": float(amount)}

    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await _go(sess)
    return await _go(None)


async def transfer_out(uid: str, amount: float, *, asset: str = MARGIN_ASSET) -> Dict[str, Any]:
    """Futures → spot. Only ``available`` futures balance is transferable
    (locked margin must be released first by closing positions/orders)."""
    if amount is None or amount <= 0:
        raise ValueError("amount must be > 0")
    if await controls_svc.are_transfers_paused():
        raise ValueError("futures transfers are paused by the platform")
    ref = f"xfer_{uuid.uuid4().hex[:16]}"

    async def _go(session):
        await fledger.debit(
            uid, float(amount),
            asset=asset,
            txn_type="transfer_out",
            ref_type="futures_transfer",
            ref_id=ref,
            meta={"direction": "futures_to_spot"},
            session=session,
        )
        await wallet_service.credit(
            uid, asset, float(amount),
            txn_type="adjustment",
            ref_type="futures_transfer",
            ref_id=ref,
            meta={"direction": "futures_to_spot"},
            session=session,
        )
        return {"ref": ref, "amount": float(amount)}

    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await _go(sess)
    return await _go(None)


# ── Snapshot for UI / WS ──────────────────────────────────────────────────

async def snapshot(uid: str) -> Dict[str, Any]:
    """Return the trader-facing wallet snapshot.

    Combines:
      * available + locked from the futures wallet row,
      * sum of unrealized PnL across open positions (using their
        ``unrealized_pnl`` field — the position service refreshes this on
        every mark price tick),
      * derived ``margin_balance`` / ``free_margin``.
    """
    bal = await fledger.read_balance(uid, MARGIN_ASSET)
    available = float(bal["available"])
    locked    = float(bal["locked"])

    # Aggregate unrealized PnL across open positions.
    cur = db()[COL_POSITIONS].find(
        {"uid": uid, "status": "open"},
        {"_id": 0, "unrealized_pnl": 1, "isolated_margin": 1},
    )
    unrealized = 0.0
    isolated   = 0.0
    async for p in cur:
        unrealized += float(p.get("unrealized_pnl") or 0.0)
        isolated   += float(p.get("isolated_margin") or 0.0)

    wallet_balance = available + locked
    margin_balance = wallet_balance + unrealized
    free_margin    = max(0.0, margin_balance - locked)

    return {
        "asset": MARGIN_ASSET,
        "available": round(available, 8),
        "locked":    round(locked, 8),
        "wallet_balance": round(wallet_balance, 8),
        "unrealized_pnl": round(unrealized, 8),
        "margin_balance": round(margin_balance, 8),
        "used_margin":    round(locked, 8),
        "free_margin":    round(free_margin, 8),
    }


async def list_txns(uid: str, *, limit: int = 100, skip: int = 0) -> List[Dict[str, Any]]:
    cur = (
        db()["futures_wallet_txns"]
        .find({"uid": uid}, {"_id": 0})
        .sort("created_at", -1)
        .skip(max(0, int(skip)))
        .limit(max(1, min(int(limit), 500)))
    )
    return await cur.to_list(limit)
