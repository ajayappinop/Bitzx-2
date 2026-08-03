"""Revert incorrect platform_retained withdrawal wd_dfc97251be6c41dc98ec on ibo_live_db."""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone

from pymongo import ReturnDocument
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

WD_ID = "wd_dfc97251be6c41dc98ec"
DB_NAME = "ibo_live_db"
TREASURY_UID = "__TREASURY__"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def main() -> None:
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
    db = client[DB_NAME]

    wd = await db.withdrawal_requests.find_one({"id": WD_ID}, {"_id": 0})
    if not wd:
        print("withdrawal not found")
        return
    print("withdrawal:", {
        "id": wd.get("id"),
        "uid": wd.get("uid"),
        "asset": wd.get("asset"),
        "amount": wd.get("amount"),
        "status": wd.get("status"),
        "settlement_type": wd.get("settlement_type"),
        "fee_amount": wd.get("fee_amount"),
        "ibo_gas_fee": wd.get("ibo_gas_fee"),
    })

    uid = wd["uid"]
    asset = (wd.get("asset") or "USDT").upper()
    amount = float(wd.get("amount") or 0.0)
    fee_amount = float(wd.get("fee_amount") or 0.0)
    ibo_gas = float(wd.get("ibo_gas_fee") or 0.0)
    addr = wd.get("address") or ""

    owners = await db.deposit_addresses.find(
        {"address": {"$regex": f"^{addr}$", "$options": "i"}},
        {"_id": 0, "uid": 1, "asset": 1, "network": 1},
    ).to_list(20)
    print("destination owners:", owners)

    user_w = await db.wallets.find_one({"uid": uid, "asset": asset}, {"_id": 0})
    treas_w = await db.wallets.find_one({"uid": TREASURY_UID, "asset": asset}, {"_id": 0})
    print("before user", user_w)
    print("before treasury", treas_w)

    if wd.get("status") != "confirmed" or wd.get("settlement_type") != "platform_retained":
        print("unexpected status — abort")
        return

    now = _now()

    # 1) Credit amount back to user available
    if amount > 0:
        before = await db.wallets.find_one({"uid": uid, "asset": asset}) or {
            "available": 0.0, "locked": 0.0,
        }
        updated = await db.wallets.find_one_and_update(
            {"uid": uid, "asset": asset},
            {
                "$inc": {"available": amount},
                "$set": {"updated_at": now},
                "$setOnInsert": {"uid": uid, "asset": asset, "locked": 0.0, "created_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        await db.wallet_txns.insert_one({
            "id": f"tx_{uuid.uuid4().hex[:20]}",
            "uid": uid,
            "asset": asset,
            "type": "adjustment",
            "direction": "credit",
            "amount": amount,
            "balance_before": {
                "available": float(before.get("available") or 0),
                "locked": float(before.get("locked") or 0),
            },
            "balance_after": {
                "available": float((updated or {}).get("available") or 0),
                "locked": float((updated or {}).get("locked") or 0),
            },
            "ref_type": "withdrawal_revert",
            "ref_id": WD_ID,
            "meta": {
                "phase": "revert_platform_retained",
                "reason": "Incorrect treasury-retain settlement; refunded to user",
            },
            "created_at": now,
        })
        print(f"credited {amount} {asset} back to {uid}")

    # 2) Refund IBO fees if any were taken
    fee_ibo = 0.0
    if (wd.get("fee_asset") or "").upper() == "IBO":
        fee_ibo += fee_amount
    fee_ibo += ibo_gas
    if fee_ibo > 0:
        before_b = await db.wallets.find_one({"uid": uid, "asset": "IBO"}) or {
            "available": 0.0, "locked": 0.0,
        }
        updated_b = await db.wallets.find_one_and_update(
            {"uid": uid, "asset": "IBO"},
            {
                "$inc": {"available": fee_ibo},
                "$set": {"updated_at": now},
                "$setOnInsert": {"uid": uid, "asset": "IBO", "locked": 0.0, "created_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        await db.wallet_txns.insert_one({
            "id": f"tx_{uuid.uuid4().hex[:20]}",
            "uid": uid,
            "asset": "IBO",
            "type": "adjustment",
            "direction": "credit",
            "amount": fee_ibo,
            "balance_before": {
                "available": float(before_b.get("available") or 0),
                "locked": float(before_b.get("locked") or 0),
            },
            "balance_after": {
                "available": float((updated_b or {}).get("available") or 0),
                "locked": float((updated_b or {}).get("locked") or 0),
            },
            "ref_type": "withdrawal_revert",
            "ref_id": WD_ID,
            "meta": {"phase": "revert_platform_retained_fees"},
            "created_at": now,
        })
        print(f"credited {fee_ibo} IBO fees back to {uid}")

    # 3) Reverse treasury retained credit
    treas_txn = await db.wallet_txns.find_one(
        {"uid": TREASURY_UID, "type": "withdrawal_retained", "ref_id": WD_ID},
        {"_id": 0},
    )
    if treas_txn:
        before_t = await db.wallets.find_one({"uid": TREASURY_UID, "asset": asset}) or {
            "available": 0.0, "locked": 0.0,
        }
        updated_t = await db.wallets.find_one_and_update(
            {"uid": TREASURY_UID, "asset": asset},
            {"$inc": {"available": -amount}, "$set": {"updated_at": now}},
            return_document=ReturnDocument.AFTER,
        )
        await db.wallet_txns.insert_one({
            "id": f"tx_{uuid.uuid4().hex[:20]}",
            "uid": TREASURY_UID,
            "asset": asset,
            "type": "withdrawal_retained_revert",
            "direction": "debit",
            "amount": amount,
            "balance_before": {
                "available": float(before_t.get("available") or 0),
                "locked": float(before_t.get("locked") or 0),
            },
            "balance_after": {
                "available": float((updated_t or {}).get("available") or 0),
                "locked": float((updated_t or {}).get("locked") or 0),
            },
            "ref_type": "withdrawal_revert",
            "ref_id": WD_ID,
            "meta": {"phase": "revert_platform_retained_treasury"},
            "created_at": now,
        })
        print(f"debited {amount} {asset} from treasury")
    else:
        print("no treasury retained txn found — skipped treasury reverse")

    # 4) Mark original withdraw ledger rows as reversed (keep audit trail)
    await db.wallet_txns.update_many(
        {"ref_id": WD_ID, "uid": uid, "type": {"$in": ["withdraw", "fee"]}},
        {"$set": {"meta.reversed": True, "meta.reversed_at": now}},
    )

    # 5) Mark withdrawal request reversed
    await db.withdrawal_requests.update_one(
        {"id": WD_ID},
        {"$set": {
            "status": "failed",
            "failure_reason": "Reverted: incorrect platform_retained settlement. Funds refunded to user.",
            "settlement_type": "platform_retained_reverted",
            "reversed_at": now,
            "updated_at": now,
        }},
    )

    after_u = await db.wallets.find_one({"uid": uid, "asset": asset}, {"_id": 0})
    after_t = await db.wallets.find_one({"uid": TREASURY_UID, "asset": asset}, {"_id": 0})
    after_wd = await db.withdrawal_requests.find_one({"id": WD_ID}, {"_id": 0, "status": 1, "failure_reason": 1, "settlement_type": 1})
    print("after user", after_u)
    print("after treasury", after_t)
    print("after wd", after_wd)
    print("DONE")


if __name__ == "__main__":
    asyncio.run(main())
