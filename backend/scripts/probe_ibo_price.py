"""One-off: trace where live IBO/USDT price comes from in production DB."""
from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


async def main() -> int:
    uri = (os.getenv("MONGO_URL") or os.getenv("MONGODB_URI") or "").strip()
    if not uri:
        print("No MONGO_URL configured")
        return 1

    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=15000)
    db = client.get_default_database()

    ctrl = await db.platform_controls.find_one({"id": "global"}, {"_id": 0, "ibo_price_override": 1})
    mock = await db.ibo_market_state.find_one({"symbol": "IBOUSDT"}, {"_id": 0})
    pairs = await db.market_pairs.find(
        {"$or": [{"symbol": "IBOUSDT"}, {"base": "IBO"}]},
        {"_id": 0},
    ).to_list(10)

    print("=== platform_controls.ibo_price_override ===")
    print(ctrl)

    print("\n=== ibo_market_state (IBOUSDT mock engine) ===")
    if mock:
        print(
            {
                "price": mock.get("price"),
                "change24h": mock.get("change24h"),
                "updated_at": mock.get("updated_at"),
                "trend": mock.get("trend"),
            }
        )
    else:
        print("(no document)")

    print("\n=== market_pairs (IBO*) ===")
    for p in pairs:
        print(p)

    # Admin market catalog rows if stored separately
    for coll_name in ("market_catalog", "market_catalog_items", "listed_market_catalog"):
        if coll_name in await db.list_collection_names():
            doc = await db[coll_name].find_one({"symbol": "IBOUSDT"}, {"_id": 0})
            if doc:
                print(f"\n=== {coll_name} IBOUSDT ===")
                print({k: doc.get(k) for k in ("symbol", "price", "base", "stats_source", "source")})

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
