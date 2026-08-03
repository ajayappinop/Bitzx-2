"""Find and optionally revert platform_retained withdrawals."""
from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()


async def scan(db_name: str) -> None:
    client = AsyncIOMotorClient(os.getenv("MONGO_URL"))
    db = client[db_name]
    print("====", db_name, "====")
    q = {
        "$or": [
            {"settlement_type": {"$exists": True}},
            {"skip_broadcast": True},
            {"platform_destination": {"$exists": True}},
        ]
    }
    rows = await db.withdrawal_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(30)
    print("special withdrawals", len(rows))
    for r in rows[:15]:
        print(
            r.get("id"),
            r.get("uid"),
            r.get("asset"),
            r.get("amount"),
            r.get("status"),
            r.get("settlement_type"),
            r.get("created_at"),
            (r.get("address") or "")[:16],
        )

    recent = await db.withdrawal_requests.find(
        {},
        {
            "_id": 0,
            "id": 1,
            "uid": 1,
            "asset": 1,
            "amount": 1,
            "status": 1,
            "address": 1,
            "settlement_type": 1,
            "created_at": 1,
            "ibo_gas_fee": 1,
            "fee_amount": 1,
            "tx_hash": 1,
        },
    ).sort("created_at", -1).to_list(10)
    print("recent any:")
    for r in recent:
        print(r)

    m = await db.wallet_txns.find(
        {"meta.settlement": "platform_retained"},
        {"_id": 0, "id": 1, "uid": 1, "asset": 1, "amount": 1, "type": 1, "ref_id": 1, "created_at": 1, "direction": 1},
    ).sort("created_at", -1).to_list(30)
    print("meta platform_retained txns", len(m))
    for x in m[:15]:
        print(x)

    t = await db.wallet_txns.find(
        {"type": "withdrawal_retained"},
        {"_id": 0, "id": 1, "uid": 1, "asset": 1, "amount": 1, "ref_id": 1, "created_at": 1, "direction": 1},
    ).sort("created_at", -1).to_list(20)
    print("type withdrawal_retained", len(t))
    for x in t[:10]:
        print(x)


async def main() -> None:
    for name in ("ibo_prod_db", "ibo_live_db", "ibo_db"):
        try:
            await scan(name)
        except Exception as exc:  # noqa: BLE001
            print(name, "ERR", exc)


if __name__ == "__main__":
    asyncio.run(main())
