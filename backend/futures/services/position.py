"""Position book — long/short, leverage, entry, PnL, liquidation price.

Positions are stored one row per ``(uid, symbol)`` with ``status="open"``
or ``status="closed"``. Closing reduces signed quantity to 0; partially
reducing leaves the row open with the remainder.

This module owns:

* :func:`apply_fill`     — called by the matching engine for every fill leg
* :func:`mark_to_market` — called by the mark-price worker for live PnL
* :func:`force_close`    — called by the liquidation engine
* :func:`reduce_position`/:func:`close_position` — REST entrypoints
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument

from services import ibo_fee as ibo_fee_svc

from ..constants import (
    COL_POSITIONS,
    DEFAULT_MARGIN_MODE,
    LIQUIDATION_FEE_RATE,
    MAKER_FEE_RATE,
    TAKER_FEE_RATE,
)
from ..db import db
from . import controls as controls_svc
from . import ledger as fledger
from .ledger import safe_unlock as _safe_unlock
from . import risk

logger = logging.getLogger(__name__)


async def _fee_rate_for_role(role: str) -> float:
    ctrl = await controls_svc.read_controls()
    if role == "maker":
        return float(ctrl.get("futures_maker_fee_rate", MAKER_FEE_RATE))
    return float(ctrl.get("futures_taker_fee_rate", TAKER_FEE_RATE))


async def _liquidation_fee_rate() -> float:
    ctrl = await controls_svc.read_controls()
    return float(ctrl.get("futures_liquidation_fee_rate", LIQUIDATION_FEE_RATE))


async def _debit_fee(
    uid: str,
    usdt_fee: float,
    *,
    pos_id: Optional[str] = None,
    trade_id: str,
    meta: Optional[Dict[str, Any]] = None,
    ibo_price_usdt: Optional[float] = None,
) -> float:
    """Charge trading fee in IBO from the user's spot wallet. Returns IBO charged."""
    if float(usdt_fee or 0.0) <= 0:
        return 0.0
    m = dict(meta or {})
    if pos_id:
        m["position_id"] = pos_id
    m.setdefault("venue", "futures")
    try:
        return await ibo_fee_svc.charge_ibo_fee_from_usdt(
            uid,
            float(usdt_fee),
            ibo_price_usdt=ibo_price_usdt,
            trade_id=trade_id,
            ref_type="futures_trade",
            meta=m,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("IBO fee debit failed uid=%s trade=%s: %s", uid, trade_id, exc)
        return 0.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


# ── Lookups ───────────────────────────────────────────────────────────────

async def get_open(uid: str, symbol: str) -> Optional[Dict[str, Any]]:
    return await db()[COL_POSITIONS].find_one(
        {"uid": uid, "symbol": symbol, "status": "open"}, {"_id": 0}
    )


async def list_open(uid: str) -> List[Dict[str, Any]]:
    cur = db()[COL_POSITIONS].find(
        {"uid": uid, "status": "open"}, {"_id": 0}
    ).sort("opened_at", -1)
    return await cur.to_list(length=200)


async def list_history(uid: str, *, limit: int = 100) -> List[Dict[str, Any]]:
    cur = db()[COL_POSITIONS].find(
        {"uid": uid, "status": "closed"}, {"_id": 0}
    ).sort("closed_at", -1).limit(int(limit))
    return await cur.to_list(length=int(limit))


# ── Settings (pre-trade) ──────────────────────────────────────────────────

def _snap_allowed_leverage(leverage: int, symbol: str) -> int:
    """Map arbitrary UI leverage to backend ``ALLOWED_LEVERAGE`` tiers."""
    from ..constants import ALLOWED_LEVERAGE

    cap = max(1, min(int(leverage), risk.max_leverage(symbol)))
    allowed = [x for x in ALLOWED_LEVERAGE if x <= risk.max_leverage(symbol)]
    if not allowed:
        return 1
    return min(allowed, key=lambda x: abs(x - cap))


async def set_leverage(uid: str, symbol: str, leverage: int) -> Dict[str, Any]:
    """Persist the user's preferred leverage for ``symbol`` even when no
    position exists yet — the order engine reads this at place time."""
    leverage = _snap_allowed_leverage(leverage, symbol)
    pos = await db()[COL_POSITIONS].find_one_and_update(
        {"uid": uid, "symbol": symbol, "status": "open"},
        {"$set": {"leverage": leverage, "updated_at": _now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if pos is None:
        # No open position — keep the preference in a settings doc so the
        # next order picks it up. We re-use the positions collection with
        # status="settings" to avoid yet another collection.
        await db()[COL_POSITIONS].update_one(
            {"uid": uid, "symbol": symbol, "status": "settings"},
            {
                "$set": {
                    "uid": uid, "symbol": symbol, "status": "settings",
                    "leverage": leverage, "updated_at": _now_iso(),
                },
                "$setOnInsert": {"created_at": _now_iso()},
            },
            upsert=True,
        )
    return {"symbol": symbol, "leverage": leverage}


async def set_margin_mode(uid: str, symbol: str, mode: str) -> Dict[str, Any]:
    pos = await get_open(uid, symbol)
    if pos and abs(float(pos.get("qty") or 0)) > 1e-12:
        raise ValueError("close the open position before changing margin mode")
    await db()[COL_POSITIONS].update_one(
        {"uid": uid, "symbol": symbol, "status": "settings"},
        {
            "$set": {
                "uid": uid, "symbol": symbol, "status": "settings",
                "margin_mode": mode, "updated_at": _now_iso(),
            },
            "$setOnInsert": {"created_at": _now_iso()},
        },
        upsert=True,
    )
    return {"symbol": symbol, "margin_mode": mode}


async def get_settings(uid: str, symbol: str) -> Dict[str, Any]:
    """Return the user's pre-trade preferences for ``symbol``.

    Falls back to defaults when no settings or open position exist."""
    pos = await get_open(uid, symbol)
    if pos:
        return {
            "symbol": symbol,
            "leverage": int(pos.get("leverage") or 10),
            "margin_mode": str(pos.get("margin_mode") or DEFAULT_MARGIN_MODE),
        }
    setting = await db()[COL_POSITIONS].find_one(
        {"uid": uid, "symbol": symbol, "status": "settings"}, {"_id": 0}
    ) or {}
    return {
        "symbol": symbol,
        "leverage": int(setting.get("leverage") or 10),
        "margin_mode": str(setting.get("margin_mode") or DEFAULT_MARGIN_MODE),
    }


# ── Fill application (called by matching engine) ──────────────────────────

async def apply_fill(
    *,
    uid: str,
    symbol: str,
    side: str,                # "buy" or "sell"
    qty: float,                # always positive — engine sign-flips
    price: float,
    leverage: int,
    role: str,                 # "maker" or "taker"
    order_id: str,
    trade_id: str,
    reduce_only: bool = False,
    margin_mode: str = DEFAULT_MARGIN_MODE,
    locked_margin: float = 0.0,  # init_margin already locked for this fill
) -> Dict[str, Any]:
    """Apply one fill leg to ``uid``'s position.

    Handles four cases:
      1. Open new position
      2. Increase same-direction position (weighted-average entry)
      3. Reduce or fully close opposite-direction position (realized PnL)
      4. Flip direction (close + reopen on remainder)
    """
    qty = abs(float(qty))
    if qty <= 0:
        return {"realized_pnl": 0.0, "fee": 0.0}
    sign = +1 if side == "buy" else -1
    delta = sign * qty
    fee_rate = await _fee_rate_for_role(role)
    usdt_fee = _round(qty * float(price) * fee_rate)
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()

    pos = await get_open(uid, symbol)
    realized = 0.0
    notional_after_lev = qty * float(price)
    imr = risk.initial_margin_rate(symbol, notional_after_lev, leverage)

    if pos is None:
        if reduce_only:
            return {"realized_pnl": 0.0, "fee": 0.0, "skipped": "no_position_for_reduce_only"}
        # New position — open it.
        new_qty   = delta
        new_entry = float(price)
        new_side  = "long" if delta > 0 else "short"
        # Use the pre-locked margin amount when provided (passed from the
        # matching engine via `locked_margin`).  This ensures isolated_margin
        # exactly matches what was locked in fledger.lock(), so that the
        # full lock is released when the position is closed — preventing tiny
        # residuals from accumulating when the synthetic fill price differs
        # slightly from the reference price used at order-placement time.
        calc_iso = _round(abs(new_qty) * new_entry * imr)
        iso_margin = _round(locked_margin) if locked_margin > 0 else calc_iso
        position_doc = {
            "id": f"pos_{uuid.uuid4().hex[:18]}",
            "uid": uid,
            "symbol": symbol,
            "side": new_side,
            "qty": _round(new_qty),
            "entry_price": _round(new_entry),
            "leverage": int(leverage),
            "margin_mode": margin_mode,
            "isolated_margin": iso_margin,
            "unrealized_pnl": 0.0,
            "realized_pnl": 0.0,
            "liquidation_price": risk.liquidation_price(
                side=new_side, entry_price=new_entry,
                leverage=leverage, symbol=symbol,
                notional_hint=abs(new_qty) * new_entry,
            ),
            "status": "open",
            "opened_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        await db()[COL_POSITIONS].insert_one(position_doc)
        # The order-level lock placed by place_order already reserves this
        # margin — do NOT lock again here or we double-deplete available and
        # risk InsufficientFundsError for tight-margin users, leaving the
        # position in the DB while returning HTTP 400 to the frontend.
        fee_ibo = await _debit_fee(
            uid, usdt_fee, pos_id=position_doc["id"], trade_id=trade_id,
            ibo_price_usdt=ibo_px,
            meta={"symbol": symbol, "role": role, "side": side, "qty": qty, "price": price},
        )
        return {
            "realized_pnl": 0.0,
            "fee": fee_ibo,
            "fee_asset": ibo_fee_svc.FEE_ASSET,
            "fee_usdt": usdt_fee,
            "position_id": position_doc["id"],
        }

    # We have an existing position.
    cur_qty   = float(pos.get("qty") or 0.0)
    cur_entry = float(pos.get("entry_price") or 0.0)
    cur_side  = "long" if cur_qty > 0 else "short"
    new_qty   = cur_qty + delta

    # Same-direction: increase. Weighted-average entry.
    if cur_qty * delta > 0:
        if reduce_only:
            return {"realized_pnl": 0.0, "fee": 0.0, "skipped": "reduce_only_increase_blocked"}
        merged_entry = ((abs(cur_qty) * cur_entry) + (qty * float(price))) / (abs(cur_qty) + qty)
        merged_qty   = new_qty
        merged_notional = abs(merged_qty) * merged_entry
        merged_imr   = risk.initial_margin_rate(symbol, merged_notional, leverage)
        merged_iso_margin = _round(merged_notional * merged_imr)
        delta_margin = max(0.0, merged_iso_margin - float(pos.get("isolated_margin") or 0.0))
        await db()[COL_POSITIONS].update_one(
            {"id": pos["id"]},
            {"$set": {
                "qty": _round(merged_qty),
                "entry_price": _round(merged_entry),
                "leverage": int(leverage),
                "isolated_margin": merged_iso_margin,
                "liquidation_price": risk.liquidation_price(
                    side=cur_side, entry_price=merged_entry,
                    leverage=leverage, symbol=symbol,
                    notional_hint=merged_notional,
                ),
                "updated_at": _now_iso(),
            }},
        )
        # delta_margin is covered by the new order's init_margin lock — no
        # extra lock needed here (same reason as the open-position path above).
        fee_ibo = await _debit_fee(
            uid, usdt_fee, pos_id=pos["id"], trade_id=trade_id, ibo_price_usdt=ibo_px,
            meta={"symbol": symbol, "role": role, "side": side, "qty": qty, "price": price},
        )
        return {
            "realized_pnl": 0.0,
            "fee": fee_ibo,
            "fee_asset": ibo_fee_svc.FEE_ASSET,
            "fee_usdt": usdt_fee,
            "position_id": pos["id"],
        }

    # Opposite direction: reduce / close / flip.
    close_qty = min(abs(cur_qty), qty)
    realized = _round((float(price) - cur_entry) * (close_qty if cur_side == "long" else -close_qty))

    # ── Unlock margin FIRST so the released funds are available for loss
    # settlement and fee payment.  This prevents InsufficientFundsError for
    # users whose entire balance is in the locked bucket.
    # safe_unlock caps at the actual locked amount, guarding against tiny
    # floating-point differences between isolated_margin and the wallet lock.
    pos_iso = float(pos.get("isolated_margin") or 0.0)
    portion = close_qty / abs(cur_qty) if abs(cur_qty) > 0 else 1.0
    release = _round(pos_iso * portion)
    if release > 0:
        await _safe_unlock(
            uid, release,
            ref_type="position", ref_id=pos["id"],
            meta={"phase": "reduce", "symbol": symbol, "portion": portion,
                  "margin_mode": margin_mode},
        )

    # Settle realized PnL & fee (now that margin has been returned to available).
    if realized > 0:
        await fledger.credit(
            uid, realized, txn_type="realized_pnl",
            ref_type="trade", ref_id=trade_id,
            meta={"symbol": symbol, "qty": close_qty, "side": cur_side},
        )
    elif realized < 0:
        # Cap loss at released margin to guard against a position that was not
        # liquidated in time (over-leveraged past the buffer).
        capped_loss = min(abs(realized), release) if release > 0 else abs(realized)
        try:
            await fledger.debit(
                uid, capped_loss, txn_type="realized_pnl",
                ref_type="trade", ref_id=trade_id,
                meta={"symbol": symbol, "qty": close_qty, "side": cur_side},
            )
        except Exception as exc:
            logger.warning("realized loss debit failed uid=%s loss=%.6f: %s", uid, capped_loss, exc)

    fee_ibo = await _debit_fee(
        uid, usdt_fee, pos_id=pos["id"], trade_id=trade_id, ibo_price_usdt=ibo_px,
        meta={"symbol": symbol, "role": role, "side": side, "qty": qty, "price": price},
    )

    if abs(new_qty) <= 1e-12:
        # Fully closed.
        await db()[COL_POSITIONS].update_one(
            {"id": pos["id"]},
            {"$set": {
                "status": "closed",
                "qty": 0.0,
                "isolated_margin": 0.0,
                "realized_pnl": _round(float(pos.get("realized_pnl") or 0.0) + realized),
                "closed_at": _now_iso(),
                "updated_at": _now_iso(),
            }},
        )
        return {
            "realized_pnl": realized,
            "fee": fee_ibo,
            "fee_asset": ibo_fee_svc.FEE_ASSET,
            "fee_usdt": usdt_fee,
            "position_id": pos["id"],
        }

    # Reduced but not fully closed.
    if cur_qty * new_qty > 0:
        # Same side, smaller size — keep entry, reduce qty + isolated margin.
        await db()[COL_POSITIONS].update_one(
            {"id": pos["id"]},
            {"$set": {
                "qty": _round(new_qty),
                "isolated_margin": _round(pos_iso - release),
                "realized_pnl": _round(float(pos.get("realized_pnl") or 0.0) + realized),
                "liquidation_price": risk.liquidation_price(
                    side=cur_side, entry_price=cur_entry,
                    leverage=int(pos.get("leverage") or leverage),
                    symbol=symbol,
                    notional_hint=abs(new_qty) * cur_entry,
                ),
                "updated_at": _now_iso(),
            }},
        )
        return {
            "realized_pnl": realized,
            "fee": fee_ibo,
            "fee_asset": ibo_fee_svc.FEE_ASSET,
            "fee_usdt": usdt_fee,
            "position_id": pos["id"],
        }

    # Flipped direction. Close old, open new on the remainder.
    if reduce_only:
        # Reduce-only doesn't open a new opposite position — cap close.
        await db()[COL_POSITIONS].update_one(
            {"id": pos["id"]},
            {"$set": {
                "status": "closed", "qty": 0.0, "isolated_margin": 0.0,
                "realized_pnl": _round(float(pos.get("realized_pnl") or 0.0) + realized),
                "closed_at": _now_iso(), "updated_at": _now_iso(),
            }},
        )
        return {
            "realized_pnl": realized,
            "fee": fee_ibo,
            "fee_asset": ibo_fee_svc.FEE_ASSET,
            "fee_usdt": usdt_fee,
            "skipped": "reduce_only_flip_blocked",
        }

    new_side = "long" if delta > 0 else "short"
    remainder_qty = abs(new_qty)
    remainder_notional = remainder_qty * float(price)
    remainder_imr = risk.initial_margin_rate(symbol, remainder_notional, leverage)
    remainder_margin = _round(remainder_notional * remainder_imr)

    await db()[COL_POSITIONS].update_one(
        {"id": pos["id"]},
        {"$set": {
            "side": new_side,
            "qty": _round(new_qty),
            "entry_price": _round(price),
            "leverage": int(leverage),
            "isolated_margin": remainder_margin,
            "realized_pnl": _round(float(pos.get("realized_pnl") or 0.0) + realized),
            "liquidation_price": risk.liquidation_price(
                side=new_side, entry_price=float(price),
                leverage=leverage, symbol=symbol,
                notional_hint=remainder_notional,
            ),
            "updated_at": _now_iso(),
        }},
    )
    # remainder_margin is covered by the original order's init_margin lock —
    # same reason as the open/increase paths: do NOT lock again here.
    return {
        "realized_pnl": realized,
        "fee": fee_ibo,
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "fee_usdt": usdt_fee,
        "position_id": pos["id"],
    }


# ── Mark-to-market (worker) ───────────────────────────────────────────────

async def mark_to_market(symbol: str, mark_price: float) -> int:
    """Refresh ``unrealized_pnl`` for every open position in ``symbol``.

    ``liquidation_price`` for isolated-margin positions is derived from the
    fixed ``entry_price`` and ``leverage`` only — it does NOT change with the
    mark price.  We therefore leave it unchanged here to avoid redundant writes.
    Returns the number of rows updated.
    """
    if mark_price is None or mark_price <= 0:
        return 0
    cur = db()[COL_POSITIONS].find(
        {"symbol": symbol, "status": "open"},
        {"_id": 0, "id": 1, "qty": 1, "entry_price": 1, "side": 1, "leverage": 1},
    )
    n = 0
    async for p in cur:
        upnl = risk.unrealized_pnl(
            float(p.get("qty") or 0.0),
            float(p.get("entry_price") or 0.0),
            float(mark_price),
        )
        await db()[COL_POSITIONS].update_one(
            {"id": p["id"]},
            {"$set": {
                "unrealized_pnl": upnl,
                "mark_price": float(mark_price),
                "updated_at": _now_iso(),
            }},
        )
        n += 1
    return n


# ── Force close (liquidation engine) ──────────────────────────────────────

async def force_close(pos: Dict[str, Any], mark_price: float, *, reason: str = "liquidation") -> Dict[str, Any]:
    """Close ``pos`` at ``mark_price`` and burn the remaining margin.

    Realized PnL is computed at the mark price; any surplus margin is
    returned to the user, deficits are absorbed by the insurance pot
    (we just stop unlocking once it goes negative)."""
    qty = float(pos.get("qty") or 0.0)
    entry = float(pos.get("entry_price") or 0.0)
    side = pos.get("side") or ("long" if qty > 0 else "short")
    realized = _round((float(mark_price) - entry) * (abs(qty) if side == "long" else -abs(qty)))
    iso = float(pos.get("isolated_margin") or 0.0)
    liq_rate = await _liquidation_fee_rate()
    usdt_liq_fee = _round(abs(qty) * float(mark_price) * liq_rate)
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()
    pos_id = pos["id"]
    uid = pos["uid"]

    # Settle realized PnL against the locked isolated margin first, then
    # refund any remainder to ``available``.
    if iso > 0:
        # Convert locked → available, applying realized PnL.
        await _safe_unlock(
            uid, iso,
            ref_type="position", ref_id=pos_id,
            meta={"phase": "liquidation_unlock", "symbol": pos["symbol"]},
        )
    if realized < 0:
        await fledger.debit(
            uid, min(abs(realized), iso) if iso > 0 else abs(realized),
            txn_type="liquidation",
            ref_type="position", ref_id=pos_id,
            meta={"phase": "liquidation_pnl", "symbol": pos["symbol"], "mark_price": mark_price},
        )
    elif realized > 0:
        await fledger.credit(
            uid, realized, txn_type="realized_pnl",
            ref_type="position", ref_id=pos_id,
            meta={"phase": "liquidation_pnl", "symbol": pos["symbol"], "mark_price": mark_price},
        )
    fee_ibo = 0.0
    if usdt_liq_fee > 0:
        fee_ibo = await _debit_fee(
            uid,
            usdt_liq_fee,
            pos_id=pos_id,
            trade_id=pos_id,
            ibo_price_usdt=ibo_px,
            meta={"phase": "liquidation_fee", "symbol": pos.get("symbol")},
        )

    await db()[COL_POSITIONS].update_one(
        {"id": pos_id},
        {"$set": {
            "status": "closed",
            "qty": 0.0,
            "isolated_margin": 0.0,
            "realized_pnl": _round(float(pos.get("realized_pnl") or 0.0) + realized),
            "closed_at": _now_iso(),
            "closed_reason": reason,
            "closed_price": float(mark_price),
            "updated_at": _now_iso(),
        }},
    )
    return {
        "position_id": pos_id,
        "realized_pnl": realized,
        "fee": fee_ibo,
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "fee_usdt": usdt_liq_fee,
        "reason": reason,
    }
