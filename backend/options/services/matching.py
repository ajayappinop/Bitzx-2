"""Premium-based order matching for options (limit orders, same contract)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo import ReturnDocument

from services import ibo_fee as ibo_fee_svc
from services.db import get_client, supports_transactions
from services.errors import InsufficientFundsError

from ..constants import COL_ORDERS, COL_TRADES, SYSTEM_LIQUIDITY_UID
from ..db import db
from ..fee_sink import get_fee_sink_uid
from . import controls as controls_svc
from . import ledger as oledger
from . import positions as pos_svc

_SYNTHETIC_SLIP = 0.0005  # 5 bps — same as futures synthetic fills

logger = logging.getLogger(__name__)

# Sharded locks: different contracts match concurrently; same shard serializes fewer contracts than one global lock.
MATCH_LOCK_SHARD_COUNT = 64
_match_shards: Tuple[asyncio.Lock, ...] = tuple(asyncio.Lock() for _ in range(MATCH_LOCK_SHARD_COUNT))


def _contract_match_lock(contract_id: str) -> asyncio.Lock:
    return _match_shards[hash(str(contract_id)) % MATCH_LOCK_SHARD_COUNT]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _round(v: float, dp: int = 8) -> float:
    return round(float(v), dp)


async def _opposite_makers(contract_id: str, side: str, *, limit_price: Optional[float]) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {
        "contract_id": contract_id,
        "status": {"$in": ["open", "partially_filled"]},
        "side": "sell" if side == "buy" else "buy",
    }
    if limit_price is not None:
        if side == "buy":
            q["price"] = {"$lte": float(limit_price)}
        else:
            q["price"] = {"$gte": float(limit_price)}
    sort = [("price", 1 if side == "buy" else -1), ("created_at", 1)]
    cur = db()[COL_ORDERS].find(q, {"_id": 0}).sort(sort).limit(50)
    return await cur.to_list(length=50)


async def _claim_maker(maker_id: str, fill_amount: float, *, session: Any = None) -> Optional[Dict[str, Any]]:
    return await db()[COL_ORDERS].find_one_and_update(
        {
            "id": maker_id,
            "status": {"$in": ["open", "partially_filled"]},
            "remaining": {"$gte": fill_amount - 1e-12},
        },
        {"$inc": {"remaining": -fill_amount, "filled": fill_amount}},
        return_document=ReturnDocument.AFTER,
        session=session,
    )


async def _finalize_order(order_id: str, *, session: Any = None) -> Optional[Dict[str, Any]]:
    o = await db()[COL_ORDERS].find_one({"id": order_id}, {"_id": 0}, session=session)
    if not o:
        return None
    remaining = float(o.get("remaining") or 0.0)
    qty = float(o.get("quantity") or 0.0)
    if remaining <= 1e-12:
        status = "filled"
    elif remaining < qty:
        status = "partially_filled"
    else:
        status = o.get("status") or "open"
    if status != o.get("status"):
        await db()[COL_ORDERS].update_one(
            {"id": order_id},
            {"$set": {"status": status, "updated_at": _now_iso()}},
            session=session,
        )
        o["status"] = status
    return o


async def _record_trade(
    *,
    taker: Dict[str, Any],
    maker: Optional[Dict[str, Any]],
    price: float,
    qty: float,
    taker_fee: float,
    maker_fee: float,
    fee_rates: Dict[str, float],
    is_synthetic: bool = False,
    session: Any = None,
) -> Dict[str, Any]:
    trade = {
        "id": f"opttr_{uuid.uuid4().hex[:16]}",
        "contract_id": taker["contract_id"],
        "price": _round(price),
        "qty": _round(qty),
        "side": taker["side"],
        "taker_uid": taker["uid"],
        "taker_order_id": taker["id"],
        "maker_uid": (maker or {}).get("uid") or SYSTEM_LIQUIDITY_UID,
        "maker_order_id": (maker or {}).get("id"),
        "synthetic": bool(is_synthetic),
        "fee_rates": {"maker": float(fee_rates.get("maker", 0.0)), "taker": float(fee_rates.get("taker", 0.0))},
        "taker_fee": _round(taker_fee),
        "maker_fee": _round(maker_fee),
        "created_at": _now_iso(),
    }
    await db()[COL_TRADES].insert_one(trade, session=session)
    return trade


async def _resolve_mark_price(contract_id: str) -> float:
    from . import ticker as ticker_svc

    tick = await ticker_svc.get_ticker(contract_id, use_cache=True)
    mp = float((tick or {}).get("mark_price") or (tick or {}).get("last_price") or 0.0)
    if mp > 0:
        return mp
    tick = await ticker_svc.get_ticker(contract_id, use_cache=False)
    return float((tick or {}).get("mark_price") or (tick or {}).get("last_price") or 0.0)


async def _apply_position_updates(
    *,
    buyer_uid: str,
    seller_uid: str,
    contract_id: str,
    fill_amt: float,
    fill_price: float,
    session: Any,
) -> None:
    if buyer_uid != SYSTEM_LIQUIDITY_UID:
        await pos_svc.apply_buy_open(buyer_uid, contract_id, fill_amt, fill_price, session=session)
    if seller_uid != SYSTEM_LIQUIDITY_UID:
        await pos_svc.apply_sell_close(seller_uid, contract_id, fill_amt, session=session)


async def _settle_leg(
    *,
    buyer_uid: str,
    seller_uid: str,
    contract_id: str,
    fill_price: float,
    fill_qty: float,
    buyer_limit: float,
    trade_id: str,
    session: Any = None,
) -> None:
    """Buyer pays premium; seller receives credit; excess buyer reservation released."""
    pay = _round(fill_price * fill_qty)
    excess = _round(max(0.0, (buyer_limit - fill_price) * fill_qty))
    if pay > 0:
        if buyer_uid == SYSTEM_LIQUIDITY_UID:
            await oledger.debit(
                buyer_uid,
                pay,
                txn_type="premium_pay",
                ref_type="trade",
                ref_id=trade_id,
                meta={"contract_id": contract_id, "qty": fill_qty, "synthetic": True},
                session=session,
            )
        else:
            await oledger.debit_locked(
                buyer_uid,
                pay,
                txn_type="premium_pay",
                ref_type="trade",
                ref_id=trade_id,
                meta={"contract_id": contract_id, "qty": fill_qty},
                session=session,
            )
    if excess > 0 and buyer_uid != SYSTEM_LIQUIDITY_UID:
        await oledger.unlock(
            buyer_uid,
            excess,
            ref_type="trade",
            ref_id=trade_id,
            meta={"contract_id": contract_id, "phase": "buy_excess_unlock"},
            session=session,
        )
    if pay > 0:
        await oledger.credit(
            seller_uid,
            pay,
            txn_type="premium_recv",
            ref_type="trade",
            ref_id=trade_id,
            meta={"contract_id": contract_id, "qty": fill_qty},
            session=session,
        )


async def _charge_trade_fee(
    uid: str,
    usdt_fee: float,
    *,
    trade_id: str,
    role: str,
    contract_id: str,
    ibo_price_usdt: Optional[float] = None,
    session: Any = None,  # noqa: ARG001 — spot IBO ledger is separate from options session
) -> float:
    """Debit user fee in IBO from spot wallet; return IBO charged (0 if none)."""
    if float(usdt_fee or 0.0) <= 1e-12:
        return 0.0
    meta: Dict[str, Any] = {
        "role": role,
        "contract_id": contract_id,
        "venue": "options",
        "usdt_fee": float(usdt_fee),
    }
    return await ibo_fee_svc.charge_ibo_fee_from_usdt(
        uid,
        float(usdt_fee),
        ibo_price_usdt=ibo_price_usdt,
        trade_id=trade_id,
        ref_type="options_trade",
        meta=meta,
        session=session,
    )


async def _credit_fee_sink(
    fee_ibo: float,
    *,
    trade_id: str,
    leg: str,
    contract_id: str,
    session: Any = None,
) -> None:
    if fee_ibo <= 1e-12:
        return
    sink = get_fee_sink_uid()
    if not sink:
        return
    try:
        await ibo_fee_svc.credit_ibo_fee_sink(
            sink,
            float(fee_ibo),
            trade_id=trade_id,
            leg=leg,
            meta={"contract_id": contract_id, "venue": "options", "sink_uid": sink},
            session=session,
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "options fee sink IBO credit failed trade=%s leg=%s sink=%s amount=%s",
            trade_id,
            leg,
            sink,
            fee_ibo,
        )


async def _rebate_maker_from_sink(
    maker_uid: str,
    rebate_usdt: float,
    *,
    trade_id: str,
    contract_id: str,
    ibo_price_usdt: Optional[float] = None,
    session: Any = None,
) -> None:
    """Credit maker rebate in IBO from spot fee sink (debit sink IBO — no silent mint)."""
    if rebate_usdt <= 1e-12:
        return
    sink = get_fee_sink_uid()
    if not sink:
        raise ValueError(
            "maker rebate requires a non-empty OPTIONS_FEE_SINK_UID so rebates are funded from the fee sink wallet"
        )
    await ibo_fee_svc.rebate_ibo_from_usdt_sink(
        maker_uid,
        float(rebate_usdt),
        sink,
        ibo_price_usdt=ibo_price_usdt,
        trade_id=trade_id,
        ref_type="trade_rebate",
        meta={"contract_id": contract_id, "venue": "options"},
        session=session,
    )


async def _apply_taker_fee_and_sink(
    taker_uid: str,
    taker_fee_usdt: float,
    *,
    trade_id: str,
    contract_id: str,
    ibo_price_usdt: Optional[float] = None,
    session: Any = None,
) -> None:
    if taker_fee_usdt <= 1e-12:
        return
    charged_ibo = await _charge_trade_fee(
        taker_uid,
        taker_fee_usdt,
        trade_id=trade_id,
        role="taker",
        contract_id=contract_id,
        ibo_price_usdt=ibo_price_usdt,
        session=session,
    )
    await _credit_fee_sink(
        charged_ibo,
        trade_id=trade_id,
        leg="taker",
        contract_id=contract_id,
        session=session,
    )


async def _apply_maker_fee_or_rebate(
    maker_uid: str,
    maker_fee_usdt: float,
    *,
    trade_id: str,
    contract_id: str,
    ibo_price_usdt: Optional[float] = None,
    session: Any = None,
) -> None:
    """Positive fee: charge maker in IBO + credit sink. Negative: IBO rebate from spot fee sink."""
    if maker_fee_usdt > 1e-12:
        charged_ibo = await _charge_trade_fee(
            maker_uid,
            maker_fee_usdt,
            trade_id=trade_id,
            role="maker",
            contract_id=contract_id,
            ibo_price_usdt=ibo_price_usdt,
            session=session,
        )
        await _credit_fee_sink(
            charged_ibo,
            trade_id=trade_id,
            leg="maker",
            contract_id=contract_id,
            session=session,
        )
    elif maker_fee_usdt < -1e-12:
        await _rebate_maker_from_sink(
            maker_uid,
            abs(float(maker_fee_usdt)),
            trade_id=trade_id,
            contract_id=contract_id,
            ibo_price_usdt=ibo_price_usdt,
            session=session,
        )


async def _execute_single_fill(
    *,
    taker: Dict[str, Any],
    maker: Dict[str, Any],
    side: str,
    contract_id: str,
    fill_amt: float,
    fill_price: float,
    taker_rate: float,
    maker_rate: float,
    session: Any,
) -> Optional[Dict[str, Any]]:
    """One match attempt inside an optional Mongo transaction. Returns trade doc or None if claim lost."""
    updated_maker = await _claim_maker(maker["id"], fill_amt, session=session)
    if updated_maker is None:
        return None

    pay = _round(fill_price * fill_amt)
    taker_fee_usdt = _round(pay * float(taker_rate))
    maker_fee_usdt = _round(pay * float(maker_rate))
    fee_rates_map = {"taker": float(taker_rate), "maker": float(maker_rate)}
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()

    trade = await _record_trade(
        taker=taker,
        maker=updated_maker,
        price=fill_price,
        qty=fill_amt,
        taker_fee=ibo_fee_svc.usdt_notional_to_ibo_fee(taker_fee_usdt, ibo_px),
        maker_fee=ibo_fee_svc.usdt_notional_to_ibo_fee(max(maker_fee_usdt, 0.0), ibo_px),
        fee_rates=fee_rates_map,
        session=session,
    )

    if side == "buy":
        buyer_uid, seller_uid = taker["uid"], updated_maker["uid"]
        buyer_limit = float(taker.get("price") or 0.0)
    else:
        buyer_uid, seller_uid = updated_maker["uid"], taker["uid"]
        buyer_limit = float(updated_maker.get("price") or 0.0)

    await _settle_leg(
        buyer_uid=buyer_uid,
        seller_uid=seller_uid,
        contract_id=contract_id,
        fill_price=fill_price,
        fill_qty=fill_amt,
        buyer_limit=buyer_limit,
        trade_id=trade["id"],
        session=session,
    )

    await _apply_taker_fee_and_sink(
        str(taker["uid"]),
        taker_fee_usdt,
        trade_id=trade["id"],
        contract_id=contract_id,
        ibo_price_usdt=ibo_px,
        session=session,
    )
    if str(updated_maker.get("uid") or "") != SYSTEM_LIQUIDITY_UID:
        await _apply_maker_fee_or_rebate(
            str(updated_maker["uid"]),
            maker_fee_usdt,
            trade_id=trade["id"],
            contract_id=contract_id,
            ibo_price_usdt=ibo_px,
            session=session,
        )

    await _apply_position_updates(
        buyer_uid=buyer_uid,
        seller_uid=seller_uid,
        contract_id=contract_id,
        fill_amt=fill_amt,
        fill_price=fill_price,
        session=session,
    )

    await _finalize_order(updated_maker["id"], session=session)
    await db()[COL_ORDERS].update_one(
        {"id": taker["id"]},
        {"$inc": {"remaining": -fill_amt, "filled": fill_amt}, "$set": {"updated_at": _now_iso()}},
        session=session,
    )
    return trade


async def _run_fill_transactional(
    *,
    taker: Dict[str, Any],
    maker: Dict[str, Any],
    side: str,
    contract_id: str,
    fill_amt: float,
    fill_price: float,
    taker_rate: float,
    maker_rate: float,
) -> Optional[Dict[str, Any]]:
    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await _execute_single_fill(
                    taker=taker,
                    maker=maker,
                    side=side,
                    contract_id=contract_id,
                    fill_amt=fill_amt,
                    fill_price=fill_price,
                    taker_rate=taker_rate,
                    maker_rate=maker_rate,
                    session=sess,
                )
    return await _execute_single_fill(
        taker=taker,
        maker=maker,
        side=side,
        contract_id=contract_id,
        fill_amt=fill_amt,
        fill_price=fill_price,
        taker_rate=taker_rate,
        maker_rate=maker_rate,
        session=None,
    )


async def _execute_synthetic_fill(
    *,
    taker: Dict[str, Any],
    side: str,
    contract_id: str,
    fill_amt: float,
    fill_price: float,
    taker_rate: float,
    session: Any,
) -> Dict[str, Any]:
    pay = _round(fill_price * fill_amt)
    taker_fee_usdt = _round(pay * float(taker_rate))
    fee_rates_map = {"taker": float(taker_rate), "maker": 0.0}
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price()

    trade = await _record_trade(
        taker=taker,
        maker=None,
        price=fill_price,
        qty=fill_amt,
        taker_fee=ibo_fee_svc.usdt_notional_to_ibo_fee(taker_fee_usdt, ibo_px),
        maker_fee=0.0,
        fee_rates=fee_rates_map,
        is_synthetic=True,
        session=session,
    )

    if side == "buy":
        buyer_uid, seller_uid = taker["uid"], SYSTEM_LIQUIDITY_UID
        buyer_limit = float(taker.get("price") or 0.0)
    else:
        buyer_uid, seller_uid = SYSTEM_LIQUIDITY_UID, taker["uid"]
        buyer_limit = fill_price

    await _settle_leg(
        buyer_uid=buyer_uid,
        seller_uid=seller_uid,
        contract_id=contract_id,
        fill_price=fill_price,
        fill_qty=fill_amt,
        buyer_limit=buyer_limit,
        trade_id=trade["id"],
        session=session,
    )

    await _apply_taker_fee_and_sink(
        str(taker["uid"]),
        taker_fee_usdt,
        trade_id=trade["id"],
        contract_id=contract_id,
        ibo_price_usdt=ibo_px,
        session=session,
    )

    await _apply_position_updates(
        buyer_uid=buyer_uid,
        seller_uid=seller_uid,
        contract_id=contract_id,
        fill_amt=fill_amt,
        fill_price=fill_price,
        session=session,
    )

    await db()[COL_ORDERS].update_one(
        {"id": taker["id"]},
        {"$inc": {"remaining": -fill_amt, "filled": fill_amt}, "$set": {"updated_at": _now_iso()}},
        session=session,
    )
    return trade


async def _run_synthetic_transactional(
    *,
    taker: Dict[str, Any],
    side: str,
    contract_id: str,
    fill_amt: float,
    fill_price: float,
    taker_rate: float,
) -> Dict[str, Any]:
    if supports_transactions():
        async with await get_client().start_session() as sess:
            async with sess.start_transaction():
                return await _execute_synthetic_fill(
                    taker=taker,
                    side=side,
                    contract_id=contract_id,
                    fill_amt=fill_amt,
                    fill_price=fill_price,
                    taker_rate=taker_rate,
                    session=sess,
                )
    return await _execute_synthetic_fill(
        taker=taker,
        side=side,
        contract_id=contract_id,
        fill_amt=fill_amt,
        fill_price=fill_price,
        taker_rate=taker_rate,
        session=None,
    )


async def run_matching(taker_id: str) -> Dict[str, Any]:
    taker_row = await db()[COL_ORDERS].find_one({"id": taker_id}, {"_id": 0})
    if not taker_row:
        return {"fills": [], "remaining": 0.0, "status": "missing"}
    cid = str(taker_row.get("contract_id") or "")
    if not cid:
        return {"fills": [], "remaining": 0.0, "status": "bad_contract"}

    async with _contract_match_lock(cid):
        taker = await db()[COL_ORDERS].find_one({"id": taker_id}, {"_id": 0})
        if not taker:
            return {"fills": [], "remaining": 0.0, "status": "missing"}
        if taker["status"] not in ("open", "partially_filled"):
            return {"fills": [], "remaining": 0.0, "status": taker["status"]}

        contract_id = taker["contract_id"]
        side = taker["side"]
        limit_price = float(taker.get("price") or 0.0)
        remaining = float(taker.get("remaining") or 0.0)
        fills: List[Dict[str, Any]] = []
        taker_rate, maker_rate = await controls_svc.effective_fee_rates()

        if taker.get("post_only"):
            final = await _finalize_order(taker["id"])
            return {
                "fills": [],
                "remaining": float((final or {}).get("remaining") or remaining),
                "status": (final or {}).get("status") or taker["status"],
            }

        is_market = str(taker.get("type") or "limit").lower() == "market"
        taker_uid = str(taker.get("uid") or "")
        makers = await _opposite_makers(
            contract_id,
            side,
            limit_price=None if is_market else limit_price,
        )
        for maker in makers:
            if remaining <= 1e-12:
                break
            maker_uid = str(maker.get("uid") or "")
            if maker_uid and taker_uid and maker_uid == taker_uid:
                continue
            avail = float(maker.get("remaining") or 0.0)
            if avail <= 0:
                continue
            fill_amt = _round(min(avail, remaining))
            fill_price = float(maker.get("price") or 0.0)
            if fill_amt <= 0 or fill_price <= 0:
                continue

            trade = await _run_fill_transactional(
                taker=taker,
                maker=maker,
                side=side,
                contract_id=contract_id,
                fill_amt=fill_amt,
                fill_price=fill_price,
                taker_rate=taker_rate,
                maker_rate=maker_rate,
            )
            if trade is None:
                continue

            taker["remaining"] = (float(taker.get("remaining") or 0.0)) - fill_amt
            taker["filled"] = (float(taker.get("filled") or 0.0)) + fill_amt
            remaining -= fill_amt
            fills.append(trade)

        if remaining > 1e-12 and await controls_svc.synthetic_fills_enabled():
            mark_px = await _resolve_mark_price(contract_id)
            is_crossing_limit = (
                not is_market
                and limit_price > 0
                and mark_px > 0
                and (
                    (side == "buy" and limit_price >= mark_px)
                    or (side == "sell" and limit_price <= mark_px)
                )
            )
            if (is_market or is_crossing_limit) and mark_px > 0:
                synth_px = mark_px * (1 + _SYNTHETIC_SLIP) if side == "buy" else mark_px * (1 - _SYNTHETIC_SLIP)
                if not is_market:
                    if side == "buy":
                        synth_px = min(synth_px, limit_price)
                    else:
                        synth_px = max(synth_px, limit_price)
                synth_px = _round(synth_px)
                if synth_px > 0:
                    try:
                        trade = await _run_synthetic_transactional(
                            taker=taker,
                            side=side,
                            contract_id=contract_id,
                            fill_amt=remaining,
                            fill_price=synth_px,
                            taker_rate=taker_rate,
                        )
                        taker["remaining"] = 0.0
                        taker["filled"] = (float(taker.get("filled") or 0.0)) + remaining
                        remaining = 0.0
                        fills.append(trade)
                    except InsufficientFundsError:
                        logger.warning(
                            "options synthetic fill skipped (SYSTEM float) contract=%s side=%s qty=%s",
                            contract_id,
                            side,
                            remaining,
                        )
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "options synthetic fill failed contract=%s order=%s",
                            contract_id,
                            taker_id,
                        )

        final = await _finalize_order(taker["id"])
        if fills:
            logger.info("options match completed contract=%s fills=%s", contract_id, len(fills))
        return {
            "fills": fills,
            "remaining": float((final or {}).get("remaining") or remaining),
            "status": (final or {}).get("status") or taker["status"],
        }
