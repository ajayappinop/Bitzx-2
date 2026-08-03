#!/usr/bin/env python3
"""Seed or refresh the bootstrap admin user in MongoDB.

Reads from backend/.env (or environment):
  MONGO_URL, DB_NAME
  ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD

Usage (from repo root or backend/):
  python scripts/seed_admin.py
  python scripts/seed_admin.py --force   # reset password if admin already exists
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


async def main(force: bool) -> int:
    mongo_url = os.environ.get("MONGO_URL", "").strip()
    db_name = os.environ.get("DB_NAME", "ibo_live_db").strip()
    email = os.environ.get("ADMIN_BOOTSTRAP_EMAIL", "").strip().lower()
    password = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "")

    if not mongo_url:
        print("ERROR: MONGO_URL is not set in .env", file=sys.stderr)
        return 1
    if not email or not password:
        print(
            "ERROR: Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD in backend/.env",
            file=sys.stderr,
        )
        return 1
    if len(password) < 8:
        print("ERROR: ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters", file=sys.stderr)
        return 1

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    coll = db.admin_users

    existing = await coll.find_one({"email": email})
    now = datetime.now(timezone.utc).isoformat()
    pw_hash = hash_password(password)

    if existing and not force:
        print(f"Admin already exists: {email} (aid={existing.get('aid')})")
        print("Use --force to update the password hash.")
        client.close()
        return 0

    if existing:
        await coll.update_one(
            {"email": email},
            {
                "$set": {
                    "password_hash": pw_hash,
                    "role": "superadmin",
                    "permissions": ["*"],
                    "is_active": True,
                    "name": existing.get("name") or "Bootstrap Admin",
                    "updated_at": now,
                }
            },
        )
        print(f"Updated admin password: {email} (aid={existing.get('aid')})")
    else:
        aid = f"adm_{uuid.uuid4().hex[:12]}"
        doc = {
            "aid": aid,
            "email": email,
            "name": "Bootstrap Admin",
            "password_hash": pw_hash,
            "role": "superadmin",
            "permissions": ["*"],
            "is_active": True,
            "created_at": now,
            "last_login": None,
        }
        await coll.insert_one(doc)
        print(f"Created bootstrap admin: {email} (aid={aid})")

    await coll.create_index("email", unique=True)
    await coll.create_index("aid", unique=True)
    client.close()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed bootstrap admin in MongoDB")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Update password if admin email already exists",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.force)))
