"""Diagnostic: full deposit lookback scan (read-only, no DB writes)."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
for line in Path(__file__).resolve().parents[1].joinpath(".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


async def main() -> None:
    from listings import registry
    from motor.motor_asyncio import AsyncIOMotorClient
    from services.blockchain_service import get_provider
    from workers.deposit_poller import _load_active_addresses

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "ibo_live_db")]
    await registry.refresh(db)
    provider = get_provider()
    rows = await _load_active_addresses(db, force=True)
    events = await provider.scan_deposits_lookback(addresses=rows)
    by: dict[str, int] = {}
    for ev in events:
        key = f"{ev.asset}/{ev.network}"
        by[key] = by.get(key, 0) + 1
    print("addresses", len(rows), "events", len(events))
    for key, count in sorted(by.items()):
        print(f"  {key}: {count}")
    nets = provider.list_supported_networks()
    live = [n for n in nets if n.get("deposit_enabled") and n.get("status") == "active"]
    print("live deposit rails", len(live))
    for n in live:
        print(f"  {n['asset']} | {n['network']}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
