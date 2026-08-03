"""One-off: verify + credit a missed USDT BEP-20 deposit for a known user.

Usage (from backend/):
  python -m scripts.credit_missed_usdt_deposit
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("credit_missed_usdt_deposit")

UID = "u_c655bf803fe84b85"
TX_HASH = "0x074dd71b63adc556632a8d6bbc682623a6f786819afd671a8b19e8bc9d3ea87e"
TO_ADDRESS = "0x189dbd4a185df64fc8436c270c64267b1dcf7e4f"  # lowercased
ASSET = "USDT"
NETWORK = "BEP-20 (BNB Chain)"
AMOUNT = 10.0
BLOCK_HEIGHT = 109315850
CONFIRMATIONS = 100  # well above any threshold


async def main() -> int:
    mongo_url = (os.environ.get("MONGO_URL") or "").strip()
    # This user lives in ibo_live_db (env DB_NAME may point at prod).
    db_name = (os.environ.get("CREDIT_DB_NAME") or "ibo_live_db").strip()
    if not mongo_url:
        raise SystemExit("MONGO_URL not set")

    logger.info("Using database: %s", db_name)

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Wire services.db so wallet_service / treasury_service work.
    from services import db as db_svc
    from services import treasury_service, wallet_service

    supports_tx = await db_svc.detect_transaction_support(client)
    db_svc.set_client(client, db, supports_transactions=supports_tx)

    user = await db.users.find_one({"uid": UID}, {"_id": 0, "email": 1, "uid": 1, "kyc_status": 1, "is_active": 1})
    if not user:
        logger.error("User not found: %s", UID)
        return 1
    logger.info(
        "User ok uid=%s email=%s kyc=%s active=%s",
        user.get("uid"), user.get("email"), user.get("kyc_status"), user.get("is_active", True),
    )

    # Match deposit address owned by this user (any asset on BEP-20 / universal address).
    addr_rows = await db.deposit_addresses.find(
        {
            "uid": UID,
            "address": {"$regex": f"^{TO_ADDRESS}$", "$options": "i"},
        },
        {"_id": 0},
    ).to_list(50)
    if not addr_rows:
        # Also try without uid filter — maybe address is universal / shared
        any_rows = await db.deposit_addresses.find(
            {"address": {"$regex": f"^{TO_ADDRESS}$", "$options": "i"}},
            {"_id": 0},
        ).to_list(50)
        logger.error(
            "No deposit_addresses for uid=%s address=%s. Other owners: %s",
            UID, TO_ADDRESS,
            [(r.get("uid"), r.get("asset"), r.get("network")) for r in any_rows],
        )
        return 1

    logger.info(
        "Address owned by user: %s",
        [(r.get("asset"), r.get("network"), r.get("address"), r.get("enabled")) for r in addr_rows],
    )

    existing = await db.deposit_events.find_one(
        {"tx_hash": {"$regex": f"^{TX_HASH}$", "$options": "i"}},
        {"_id": 0},
    )
    if existing:
        logger.info(
            "Existing deposit_events row id=%s status=%s uid=%s asset=%s amount=%s",
            existing.get("id"), existing.get("status"), existing.get("uid"),
            existing.get("asset"), existing.get("amount"),
        )
        event_id = existing.get("id")
        status = (existing.get("status") or "").lower()
        if status == "credited":
            logger.info("Already credited — nothing to do.")
            # Still print wallet balance
            bal = await db.wallets.find_one({"uid": UID, "asset": ASSET}, {"_id": 0})
            logger.info("Wallet USDT: %s", bal)
            return 0
        if (existing.get("uid") or "") != UID:
            await db.deposit_events.update_one(
                {"id": event_id},
                {"$set": {"uid": UID, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            logger.info("Backfilled uid on deposit_events row")
        if (existing.get("asset") or "").upper() != ASSET:
            await db.deposit_events.update_one(
                {"id": event_id},
                {"$set": {"asset": ASSET, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
    else:
        now = datetime.now(timezone.utc).isoformat()
        event_id = f"dev_{uuid.uuid4().hex[:16]}"
        doc = {
            "id": event_id,
            "uid": UID,
            "asset": ASSET,
            "network": NETWORK,
            "address": TO_ADDRESS,
            "tx_hash": TX_HASH,
            "amount": AMOUNT,
            "confirmations": CONFIRMATIONS,
            "block_height": BLOCK_HEIGHT,
            "status": "pending",
            "source": "manual_missed_deposit",
            "created_at": now,
            "first_seen_at": now,
            "updated_at": now,
            "last_seen_at": now,
            "raw": {
                "manual": True,
                "reason": "missed_by_poller",
                "bscscan": f"https://bscscan.com/tx/{TX_HASH}",
                "verified_amount_usdt": AMOUNT,
                "verified_to": TO_ADDRESS,
                "verified_block": BLOCK_HEIGHT,
            },
        }
        await db.deposit_events.insert_one(doc)
        logger.info("Created deposit_events row id=%s", event_id)

    # Re-read event
    event = await db.deposit_events.find_one({"id": event_id}, {"_id": 0})
    status = (event.get("status") or "").lower()
    if status in ("credited", "crediting"):
        logger.info("Event already %s — skip credit", status)
        return 0

    # Atomic reserve → credit → release (same as admin credit / deposit_crediter)
    reserved = await db.deposit_events.find_one_and_update(
        {"id": event_id, "status": {"$in": ["pending", "confirming", "pending_kyc", "below_min"]}},
        {"$set": {
            "status": "crediting",
            "crediting_started_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if reserved is None:
        logger.error("Could not reserve event (status race)")
        return 1

    prev_status = (reserved.get("status") or "pending").lower()
    try:
        txn = await wallet_service.credit(
            UID, ASSET, AMOUNT,
            txn_type="deposit",
            ref_type="deposit_event",
            ref_id=event_id,
            meta={
                "tx_hash": TX_HASH,
                "network": NETWORK,
                "address": TO_ADDRESS,
                "confirmations": CONFIRMATIONS,
                "block_height": BLOCK_HEIGHT,
                "admin_override": True,
                "source": "manual_missed_deposit",
                "note": "Manual credit for missed USDT BEP-20 deposit verified on BscScan",
            },
        )
    except Exception:
        logger.exception("wallet credit failed")
        await db.deposit_events.update_one(
            {"id": event_id, "status": "crediting"},
            {"$set": {"status": prev_status, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return 1

    try:
        await treasury_service.record_custody_deposit(
            ASSET,
            AMOUNT,
            ref_type="deposit_event",
            ref_id=event_id,
            meta={"uid": UID, "tx_hash": TX_HASH, "admin_override": True, "source": "manual_missed_deposit"},
        )
    except Exception:
        logger.exception("treasury custody mirror failed (wallet already credited)")

    now = datetime.now(timezone.utc).isoformat()
    await db.deposit_events.update_one(
        {"id": event_id, "status": "crediting"},
        {"$set": {
            "status": "credited",
            "credited_at": now,
            "credited_amount": AMOUNT,
            "credited_block_height": BLOCK_HEIGHT,
            "wallet_txn_id": txn.get("id") if isinstance(txn, dict) else None,
            "admin_override": True,
            "updated_at": now,
            "confirmations": CONFIRMATIONS,
            "amount": AMOUNT,
            "uid": UID,
            "asset": ASSET,
            "network": NETWORK,
            "address": TO_ADDRESS,
            "tx_hash": TX_HASH,
        }},
    )

    # Audit trail (no admin JWT — script operator)
    await db.admin_audit_logs.insert_one({
        "id": f"aud_{uuid.uuid4().hex[:16]}",
        "admin_aid": None,
        "admin_email": "script:credit_missed_usdt_deposit",
        "source": "script",
        "action": "deposit_event_manual_credit",
        "target_type": "deposit_events",
        "target_id": event_id,
        "extra": {
            "uid": UID,
            "asset": ASSET,
            "amount": AMOUNT,
            "tx_hash": TX_HASH,
            "network": NETWORK,
            "address": TO_ADDRESS,
            "note": "Missed USDT deposit verified on BscScan and credited",
        },
        "created_at": now,
    })

    bal = await db.wallets.find_one({"uid": UID, "asset": ASSET}, {"_id": 0})
    logger.info(
        "SUCCESS credited %s %s to %s | event=%s | wallet_txn=%s | wallet=%s",
        AMOUNT, ASSET, UID, event_id,
        txn.get("id") if isinstance(txn, dict) else None,
        bal,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
