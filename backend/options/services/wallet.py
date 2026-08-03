"""Options wallet snapshot and spot ↔ options USDT transfer."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List

from services import wallet_service
from services.db import get_client, supports_transactions
from services.errors import InsufficientFundsError

from ..constants import COL_WALLET_TXNS, MARGIN_ASSET
from ..db import db
from . import controls as controls_svc
from . import ledger as oledger

logger = logging.getLogger(__name__)


async def transfer_in(uid: str, amount: float, *, asset: str = MARGIN_ASSET) -> Dict[str, Any]:
    if amount is None or amount <= 0:
        raise ValueError("amount must be > 0")
    if await controls_svc.are_transfers_blocked():
        raise ValueError("options transfers are paused")
    ref = f"oxfer_{uuid.uuid4().hex[:14]}"

    async def _go(session):
        await wallet_service.debit(
            uid, asset, float(amount),
            txn_type="adjustment",
            ref_type="options_transfer",
            ref_id=ref,
            meta={"direction": "spot_to_options"},
            session=session,
        )
        await oledger.credit(
            uid, float(amount),
            asset=asset,
            txn_type="transfer_in",
            ref_type="options_transfer",
            ref_id=ref,
            meta={"direction": "spot_to_options"},
            session=session,
        )
        return {"ref": ref, "amount": float(amount)}

    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await _go(sess)
    return await _go(None)


async def transfer_out(uid: str, amount: float, *, asset: str = MARGIN_ASSET) -> Dict[str, Any]:
    if amount is None or amount <= 0:
        raise ValueError("amount must be > 0")
    if await controls_svc.are_transfers_blocked():
        raise ValueError("options transfers are paused")
    ref = f"oxfer_{uuid.uuid4().hex[:14]}"

    async def _go(session):
        await oledger.debit(
            uid, float(amount),
            asset=asset,
            txn_type="transfer_out",
            ref_type="options_transfer",
            ref_id=ref,
            meta={"direction": "options_to_spot"},
            session=session,
        )
        await wallet_service.credit(
            uid, asset, float(amount),
            txn_type="adjustment",
            ref_type="options_transfer",
            ref_id=ref,
            meta={"direction": "options_to_spot"},
            session=session,
        )
        return {"ref": ref, "amount": float(amount)}

    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await _go(sess)
    return await _go(None)


async def snapshot(uid: str) -> Dict[str, Any]:
    bal = await oledger.read_balance(uid, MARGIN_ASSET)
    av = float(bal["available"])
    lk = float(bal["locked"])
    return {
        "asset": MARGIN_ASSET,
        "available": round(av, 8),
        "locked": round(lk, 8),
        "wallet_balance": round(av + lk, 8),
    }


async def list_txns(uid: str, *, limit: int = 100, skip: int = 0) -> List[Dict[str, Any]]:
    cur = (
        db()[COL_WALLET_TXNS]
        .find({"uid": uid}, {"_id": 0})
        .sort("created_at", -1)
        .skip(max(0, int(skip)))
        .limit(max(1, min(int(limit), 500)))
    )
    return await cur.to_list(length=int(limit))
