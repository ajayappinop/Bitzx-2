"""One-shot diagnostic for the withdrawal pipeline.

Prints:
  * provider + treasury status (can the worker even broadcast?)
  * worker feature flags (env + platform_controls)
  * outstanding ``withdrawal_requests`` grouped by status
  * the most recent 5 rows per non-terminal bucket with relevant fields

Run from the backend venv:

    .\\venv\\Scripts\\python.exe scripts\\diag_withdrawals.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # type: ignore

load_dotenv(ROOT / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore

from services import blockchain_service  # noqa: E402


def _mask(s: str, keep: int = 6) -> str:
    s = s or ""
    if len(s) <= keep * 2:
        return s
    return f"{s[:keep]}...{s[-keep:]}"


async def main() -> None:
    mongo_url = os.getenv("MONGO_URL") or ""
    db_name = os.getenv("DB_NAME") or ""
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME missing from .env")
        return

    print("=== provider status ===")
    prov = blockchain_service.get_provider()
    print(f"  class   : {prov.__class__.__name__}")
    nets = []
    try:
        nets = prov.list_supported_networks()
    except Exception as exc:  # noqa: BLE001
        print(f"  networks: ERR {exc}")
    print(f"  networks: {[n.get('asset') + '/' + (n.get('chain') or '?') for n in nets]}")
    for a in ("ETH", "USDT", "BTC"):
        can = False
        try:
            can = bool(prov.can_broadcast(a))
        except Exception:  # noqa: BLE001
            pass
        tr = None
        try:
            tr = prov.treasury_address(a)
        except Exception:  # noqa: BLE001
            pass
        print(f"  {a:<5}: can_broadcast={can}  treasury={tr}")

    print()
    print("=== env flags ===")
    for k in (
        "BLOCKCHAIN_PROVIDER", "WITHDRAWAL_EXEC_ENABLED",
        "WITHDRAWAL_EXEC_INTERVAL_SEC",
        "QUICKNODE_ETH_URL", "USDT_ERC20_CONTRACT",
    ):
        v = os.getenv(k) or ""
        if k == "QUICKNODE_ETH_URL":
            v = _mask(v, 12)
        print(f"  {k:<32} = {v!r}")
    has_key = bool((os.getenv("TREASURY_ETH_PRIVATE_KEY") or "").strip())
    print(f"  TREASURY_ETH_PRIVATE_KEY set    = {has_key}")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    ctl = await db.platform_controls.find_one({"id": "global"}, {"_id": 0}) or {}
    print()
    print("=== platform_controls (relevant) ===")
    for k in (
        "withdrawal_auto_execute_enabled",
        "withdrawal_auto_approve_limit_usdt",
        "two_factor_required_for_withdrawal",
        "deposit_min_confirmations",
        "deposit_min_confirmations_by_asset",
        "wallet_enabled",
    ):
        print(f"  {k:<42} = {ctl.get(k)!r}")

    print()
    print("=== withdrawal_requests counts by status ===")
    agg = await db.withdrawal_requests.aggregate([
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
        {"$sort":  {"n": -1}},
    ]).to_list(length=100)
    if not agg:
        print("  (no withdrawal rows yet)")
    else:
        for row in agg:
            print(f"  {str(row.get('_id') or 'null'):<20} n={row.get('n')}")

    for status in ("pending_approval", "approved", "broadcasting", "broadcasted",
                   "confirming", "failed", "confirmed"):
        rows = await db.withdrawal_requests.find(
            {"status": status}, {"_id": 0, "broadcast_raw": 0, "raw": 0},
        ).sort("created_at", -1).limit(5).to_list(length=5)
        if not rows:
            continue
        print()
        print(f"=== latest {status} (up to 5) ===")
        for r in rows:
            print(
                f"  id={r.get('id')}  uid={r.get('uid')}  "
                f"asset={r.get('asset')}  amount={r.get('amount')}  "
                f"fee={r.get('fee_amount')}  total={r.get('total_charge')}  "
                f"addr={_mask(r.get('address') or '', 8)}  "
                f"tx={_mask(r.get('tx_hash') or '', 8)}  "
                f"confs={r.get('confirmations')}/{r.get('threshold')}  "
                f"attempts={r.get('broadcast_attempts')}  "
                f"err={r.get('last_broadcast_error')!r}"
            )

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
