"""One-shot ledger backfill.

For every ``(uid, asset)`` pair that already has a wallet row but no
``wallet_txns`` entries, emit a single ``opening_balance`` row capturing the
current ``available`` / ``locked`` snapshot. This makes the ledger balance
for pre-existing users so every subsequent mutation has a correct
``balance_before`` / ``balance_after``.

The script is idempotent — running it multiple times only inserts rows for
wallets that still lack any ledger history.

Usage:
    python -m scripts.backfill_wallet_txns            # dry run
    python -m scripts.backfill_wallet_txns --apply    # write rows
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

# Allow running as ``python backend/scripts/backfill_wallet_txns.py``
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_wallet_txns")


async def run(apply_changes: bool) -> None:
    mongo_url = os.environ.get("MONGO_URL", "").strip()
    db_name = os.environ.get("DB_NAME", "ibo_live_db").strip()
    if not mongo_url:
        raise SystemExit("MONGO_URL not set in environment")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    now = datetime.now(timezone.utc).isoformat()
    scanned = 0
    inserted = 0

    wallet_cursor = db.wallets.find({}, {"_id": 0})
    async for wdoc in wallet_cursor:
        scanned += 1
        uid = wdoc.get("uid")
        asset = wdoc.get("asset")
        if not uid or not asset:
            continue
        available = float(wdoc.get("available") or 0.0)
        locked = float(wdoc.get("locked") or 0.0)

        has_history = await db.wallet_txns.find_one(
            {"uid": uid, "asset": asset},
            {"_id": 1},
        )
        if has_history:
            continue

        amount = round(available + locked, 8)
        row: Dict[str, Any] = {
            "id": f"tx_{uuid.uuid4().hex[:20]}",
            "uid": uid,
            "asset": asset,
            "type": "opening_balance",
            "direction": "credit",
            "amount": amount,
            "balance_before": {"available": 0.0, "locked": 0.0},
            "balance_after": {
                "available": round(available, 8),
                "locked": round(locked, 8),
            },
            "ref_type": "backfill",
            "ref_id": f"backfill_{uid}_{asset}",
            "meta": {"source": "scripts.backfill_wallet_txns"},
            "status": "completed",
            "created_at": wdoc.get("created_at") or now,
        }
        if apply_changes:
            await db.wallet_txns.insert_one(row)
        inserted += 1
        logger.info(
            "%s opening_balance uid=%s asset=%s available=%.8f locked=%.8f",
            "INSERT" if apply_changes else "DRY-RUN",
            uid,
            asset,
            available,
            locked,
        )

    logger.info(
        "Backfill complete (scanned=%d, %s=%d)",
        scanned,
        "inserted" if apply_changes else "would_insert",
        inserted,
    )
    client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually insert rows (default is dry-run).",
    )
    args = parser.parse_args()
    asyncio.run(run(apply_changes=args.apply))


if __name__ == "__main__":
    main()
