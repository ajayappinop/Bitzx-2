"""Ledger reconciliation.

Sums every ``wallet_txns`` row per ``(uid, asset)`` and compares the result
to the current ``wallets`` document. Reports mismatches without mutating any
data.

The computation is::

    expected_available = sum(credit - debit + unlock - lock)   # for available
    expected_locked    = sum(lock - unlock)                    # for locked

``opening_balance`` rows use the ``balance_after`` snapshot as the starting
point and do not contribute via delta.

Usage:
    python -m scripts.reconcile_wallet_txns
    python -m scripts.reconcile_wallet_txns --tolerance 1e-8
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, Tuple

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reconcile_wallet_txns")


def _apply_row(row: dict, buckets: Dict[Tuple[str, str], Dict[str, float]]) -> None:
    uid = row.get("uid") or ""
    asset = row.get("asset") or ""
    key = (uid, asset)
    bucket = buckets[key]
    ttype = (row.get("type") or "").lower()
    direction = (row.get("direction") or "").lower()
    amount = float(row.get("amount") or 0.0)

    if ttype == "opening_balance":
        after = row.get("balance_after") or {}
        bucket["available"] = float(after.get("available") or 0.0)
        bucket["locked"] = float(after.get("locked") or 0.0)
        return

    if direction == "credit":
        bucket["available"] += amount
    elif direction == "debit":
        bucket["available"] -= amount
    elif direction == "lock":
        bucket["available"] -= amount
        bucket["locked"] += amount
    elif direction == "unlock":
        bucket["available"] += amount
        bucket["locked"] -= amount


async def run(tolerance: float) -> int:
    mongo_url = os.environ.get("MONGO_URL", "").strip()
    db_name = os.environ.get("DB_NAME", "ibo_live_db").strip()
    if not mongo_url:
        raise SystemExit("MONGO_URL not set in environment")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    buckets: Dict[Tuple[str, str], Dict[str, float]] = defaultdict(
        lambda: {"available": 0.0, "locked": 0.0}
    )

    # Replay every ledger row, oldest first so opening_balance sets the seed.
    cursor = db.wallet_txns.find({}, {"_id": 0}).sort("created_at", 1)
    async for row in cursor:
        _apply_row(row, buckets)

    mismatches = 0
    checked = 0

    wallet_cursor = db.wallets.find({}, {"_id": 0})
    async for wdoc in wallet_cursor:
        uid = wdoc.get("uid") or ""
        asset = wdoc.get("asset") or ""
        key = (uid, asset)
        checked += 1
        expected = buckets.get(key, {"available": 0.0, "locked": 0.0})
        actual_available = float(wdoc.get("available") or 0.0)
        actual_locked = float(wdoc.get("locked") or 0.0)
        d_avail = actual_available - expected["available"]
        d_locked = actual_locked - expected["locked"]
        if abs(d_avail) > tolerance or abs(d_locked) > tolerance:
            mismatches += 1
            logger.warning(
                "MISMATCH uid=%s asset=%s actual=(avail=%.8f, locked=%.8f) "
                "expected=(avail=%.8f, locked=%.8f) diff=(avail=%+.8f, locked=%+.8f)",
                uid, asset, actual_available, actual_locked,
                expected["available"], expected["locked"], d_avail, d_locked,
            )

    logger.info(
        "Reconciliation complete — wallets_checked=%d mismatches=%d tolerance=%.1e",
        checked, mismatches, tolerance,
    )
    client.close()
    return 0 if mismatches == 0 else 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tolerance",
        type=float,
        default=1e-6,
        help="Absolute tolerance for comparing ledger vs wallet (default 1e-6).",
    )
    args = parser.parse_args()
    rc = asyncio.run(run(tolerance=args.tolerance))
    sys.exit(rc)


if __name__ == "__main__":
    main()
