"""House/system liquidity for options — wallet bootstrap for synthetic fills."""

from __future__ import annotations

import logging
import os

from ..constants import MARGIN_ASSET, SYSTEM_LIQUIDITY_UID
from . import ledger as oledger
from . import wallet as wallet_svc

logger = logging.getLogger(__name__)


async def ensure_system_wallet() -> None:
    """Ensure the SYSTEM options wallet exists with a USDT float for synthetic counterparty fills."""
    float_usdt = float(os.getenv("OPTIONS_SYSTEM_USDT_FLOAT", "5000000"))
    snap = await wallet_svc.snapshot(SYSTEM_LIQUIDITY_UID)
    avail = float(snap.get("available") or 0.0)
    if avail >= float_usdt * 0.25:
        return
    top_up = max(0.0, float_usdt - avail)
    if top_up <= 0:
        return
    await oledger.credit(
        SYSTEM_LIQUIDITY_UID,
        top_up,
        asset=MARGIN_ASSET,
        txn_type="adjustment",
        ref_type="system_float",
        ref_id="bootstrap",
        meta={"reason": "options_synthetic_liquidity_float"},
    )
    logger.info("options SYSTEM wallet topped up by %.2f USDT (target float %.0f)", top_up, float_usdt)
