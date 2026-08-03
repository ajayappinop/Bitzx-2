"""
Admin Treasury Transfer API
Route prefix: /api/admin/treasury/transfers
Permission:  view_treasury  (read)   / manage_treasury (write)
Collection:  admin_transfers
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, ConfigDict

router = APIRouter(prefix="/api")

# ── collection name ──────────────────────────────────────────────────────────
COLL = "admin_transfers"

SUPPORTED_ASSETS = [
    "USDT", "BTC", "ETH", "BNB", "IBO", "USDC", "TRX", "MATIC", "SOL", "XRP",
    "ADA", "DOT", "AVAX", "LINK", "LTC", "BCH", "DOGE", "SHIB",
]

SUPPORTED_NETWORKS = [
    "BEP-20 (BSC)", "ERC-20 (Ethereum)", "TRC-20 (Tron)",
    "Bitcoin (BTC)", "Solana", "Polygon", "Avalanche C-Chain",
]

# Mirrors the HTTPBearer instance in server.py (auto_error=False so we can
# return a clean 401 from _dep_auth rather than an OpenAPI 403).
_bearer = HTTPBearer(auto_error=False)


# ── helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return f"atx_{uuid.uuid4().hex[:20]}"


# ── Pydantic models ──────────────────────────────────────────────────────────

class AdminTransferCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    asset: str = Field(..., min_length=1, max_length=16, description="Asset symbol e.g. USDT")
    network: str = Field(..., min_length=2, max_length=120, description="Network e.g. BEP-20 (BSC)")
    from_address: Optional[str] = Field(None, max_length=200, description="Source treasury address (optional label)")
    to_address: str = Field(..., min_length=6, max_length=200, description="Destination wallet address")
    amount: float = Field(..., gt=0, description="Amount to transfer")
    note: Optional[str] = Field(None, max_length=500, description="Internal note / memo")
    status: str = Field("pending", description="Initial status")


class AdminTransferPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: Optional[str] = Field(None, description="pending | completed | failed | cancelled")
    tx_hash: Optional[str] = Field(None, max_length=200, description="On-chain tx hash once broadcast")
    note: Optional[str] = Field(None, max_length=500)


# ── dependency stubs (resolved at app startup via _register_deps) ─────────────
_db_getter = None
_auth_dep = None
_require_permission = None
_get_blockchain_provider = None  # Optional: callable() -> BlockchainProvider


def _register_deps(*, db_getter, auth_dep, require_permission, get_blockchain_provider=None):
    """Called from server.py after the DB / auth helpers are ready."""
    global _db_getter, _auth_dep, _require_permission, _get_blockchain_provider
    _db_getter = db_getter
    _auth_dep = auth_dep
    _require_permission = require_permission
    _get_blockchain_provider = get_blockchain_provider


def _get_db():
    if _db_getter is None:
        raise RuntimeError("treasury_transfer_api not initialised")
    return _db_getter()


def _perm(auth, permission: str):
    if _require_permission is None:
        raise RuntimeError("treasury_transfer_api not initialised")
    _require_permission(auth, permission)


async def _dep_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    """Proxy that mirrors server.py's resolve_admin_auth signature exactly.

    FastAPI injects both the Bearer token and the X-Admin-Key header, then
    delegates to the stored _auth_dep (= resolve_admin_auth) which has all
    the JWT validation and DB lookup logic. This avoids a circular import
    while keeping the same auth path as every other admin endpoint.
    """
    if _auth_dep is None:
        raise HTTPException(status_code=503, detail="treasury_transfer_api not initialised")
    return await _auth_dep(credentials, x_admin_key)


# ── list + stats helpers ──────────────────────────────────────────────────────

async def _list_transfers(
    db,
    *,
    asset: Optional[str] = None,
    network: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = 0,
    limit: int = 25,
):
    q: Dict[str, Any] = {}
    if asset:
        q["asset"] = asset.upper().strip()
    if network:
        q["network"] = {"$regex": network.strip(), "$options": "i"}
    if status:
        q["status"] = status.strip().lower()
    if search:
        s = search.strip()
        q["$or"] = [
            {"to_address": {"$regex": s, "$options": "i"}},
            {"from_address": {"$regex": s, "$options": "i"}},
            {"tx_hash": {"$regex": s, "$options": "i"}},
            {"note": {"$regex": s, "$options": "i"}},
            {"admin_email": {"$regex": s, "$options": "i"}},
        ]
    if date_from:
        q.setdefault("created_at", {})["$gte"] = date_from
    if date_to:
        q.setdefault("created_at", {})["$lte"] = date_to

    total = await db[COLL].count_documents(q)
    cursor = db[COLL].find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    return items, total


async def _build_stats(db) -> Dict[str, Any]:
    pipeline = [
        {"$group": {
            "_id": {"asset": "$asset", "status": "$status"},
            "count": {"$sum": 1},
            "total_amount": {"$sum": "$amount"},
        }},
    ]
    rows = await db[COLL].aggregate(pipeline).to_list(length=500)

    by_asset: Dict[str, Dict[str, Any]] = {}
    grand_count = 0
    grand_amount = 0.0
    completed_count = 0
    completed_amount = 0.0
    pending_count = 0

    for row in rows:
        asset = row["_id"]["asset"]
        status = row["_id"]["status"]
        count = row["count"]
        amount = row["total_amount"]
        grand_count += count
        grand_amount += amount
        if status == "completed":
            completed_count += count
            completed_amount += amount
        if status == "pending":
            pending_count += count
        if asset not in by_asset:
            by_asset[asset] = {"asset": asset, "total_count": 0, "total_amount": 0.0, "completed_amount": 0.0}
        by_asset[asset]["total_count"] += count
        by_asset[asset]["total_amount"] += amount
        if status == "completed":
            by_asset[asset]["completed_amount"] += amount

    sorted_by_asset = sorted(by_asset.values(), key=lambda x: x["total_amount"], reverse=True)

    recent_cursor = db[COLL].find({}, {"_id": 0}).sort("created_at", -1).limit(5)
    recent = await recent_cursor.to_list(length=5)

    return {
        "grand_count": grand_count,
        "grand_amount": round(grand_amount, 8),
        "completed_count": completed_count,
        "completed_amount": round(completed_amount, 8),
        "pending_count": pending_count,
        "by_asset": sorted_by_asset,
        "recent": recent,
    }


# ── routes ────────────────────────────────────────────────────────────────────

@router.post("/admin/treasury/transfers")
async def create_admin_transfer(
    body: AdminTransferCreate,
    auth=Depends(_dep_auth),
):
    """Create a new admin treasury transfer record."""
    db = _get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _perm(auth, "manage_treasury")

    # Normalise status
    allowed_statuses = {"pending", "completed", "failed", "cancelled"}
    status = body.status.strip().lower() if body.status else "pending"
    if status not in allowed_statuses:
        status = "pending"

    admin_row = auth.admin or {}
    doc = {
        "id": _new_id(),
        "asset": body.asset.upper().strip(),
        "network": body.network.strip(),
        "from_address": (body.from_address or "").strip() or None,
        "to_address": body.to_address.strip(),
        "amount": round(float(body.amount), 8),
        "note": (body.note or "").strip() or None,
        "status": status,
        "tx_hash": None,
        "admin_aid": str(admin_row.get("aid") or admin_row.get("id") or ""),
        "admin_email": str(admin_row.get("email") or ""),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db[COLL].insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/admin/treasury/transfers")
async def list_admin_transfers(
    auth=Depends(_dep_auth),
    asset: Optional[str] = Query(None),
    network: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
):
    """List admin treasury transfers with pagination and filters."""
    db = _get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _perm(auth, "view_treasury")
    items, total = await _list_transfers(
        db,
        asset=asset,
        network=network,
        status=status,
        search=search,
        date_from=date_from,
        date_to=date_to,
        skip=skip,
        limit=limit,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.get("/admin/treasury/transfers/stats")
async def admin_transfers_stats(
    auth=Depends(_dep_auth),
):
    """Aggregate stats: counts, totals, by-asset breakdown, recent."""
    db = _get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _perm(auth, "view_treasury")
    return await _build_stats(db)


async def _verify_tx_on_chain(asset: str, tx_hash: str) -> Dict[str, Any]:
    """
    Call blockchain_service.get_transaction_receipt for EVM chains (IBO/BSC,
    ETH, USDT).  Returns a dict with:
        verified      bool  – whether a receipt was found
        chain_status  str   – "mined" | "failed" | "pending" | "unsupported"
        confirmations int
        block_height  int | None
        error         str | None  – if RPC call threw
    """
    result: Dict[str, Any] = {
        "verified": False,
        "chain_status": "pending",
        "confirmations": 0,
        "block_height": None,
        "error": None,
    }
    if not _get_blockchain_provider:
        result["error"] = "Blockchain provider not configured"
        return result
    if not tx_hash or not tx_hash.strip():
        result["error"] = "No tx hash provided"
        return result

    tx = tx_hash.strip()
    # Only EVM hashes are supported (0x-prefixed 66-char hex)
    if not tx.startswith("0x") or len(tx) != 66:
        result["chain_status"] = "unsupported"
        result["error"] = "Non-EVM tx hash — manual verification required (BTC/SOL/TRX not auto-verified)"
        return result

    try:
        provider = _get_blockchain_provider()
        receipt = await provider.get_transaction_receipt(asset, tx)
        result["verified"] = True
        result["chain_status"] = receipt.state  # "mined" | "failed" | "pending"
        result["confirmations"] = int(receipt.confirmations or 0)
        result["block_height"] = receipt.block_height
    except Exception as exc:
        result["error"] = f"RPC error: {exc}"
    return result


@router.patch("/admin/treasury/transfers/{transfer_id}")
async def patch_admin_transfer(
    transfer_id: str,
    body: AdminTransferPatch,
    auth=Depends(_dep_auth),
):
    """Update status, tx_hash, or note on an existing transfer.

    When a tx_hash is supplied and the admin has not explicitly set status,
    the endpoint will attempt an on-chain RPC verification and auto-derive the
    status from the receipt:
      - receipt.state == "mined"   → status = "completed"
      - receipt.state == "failed"  → status = "failed"
      - receipt.state == "pending" → status unchanged (stays "pending")

    The RPC result is stored in ``rpc_verification`` for audit purposes.
    If the admin explicitly passes status in the request body, that always
    takes precedence over the auto-derived value.
    """
    db = _get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _perm(auth, "manage_treasury")

    existing = await db[COLL].find_one({"id": transfer_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Transfer not found")

    updates: Dict[str, Any] = {"updated_at": _now_iso()}
    allowed_statuses = {"pending", "completed", "failed", "cancelled"}

    incoming_tx = body.tx_hash.strip() if (body.tx_hash is not None) else None

    # ----- RPC verification ------------------------------------------------
    # Only triggered when the admin explicitly provides a tx hash in this
    # request — not on note/status-only updates that leave tx_hash untouched.
    rpc_result: Optional[Dict[str, Any]] = None
    auto_status: Optional[str] = None

    if incoming_tx and incoming_tx.startswith("0x"):
        asset = existing.get("asset", "USDT")
        rpc_result = await _verify_tx_on_chain(asset, incoming_tx)
        if rpc_result.get("verified"):
            chain_state = rpc_result.get("chain_status", "pending")
            if chain_state == "mined":
                auto_status = "completed"
            elif chain_state == "failed":
                auto_status = "failed"
            # "pending" → keep existing status, don't change

    # ----- Apply updates ---------------------------------------------------
    # Admin-supplied status always wins over auto-derived
    if body.status is not None:
        s = body.status.strip().lower()
        if s not in allowed_statuses:
            raise HTTPException(status_code=422, detail=f"status must be one of {allowed_statuses}")
        updates["status"] = s
    elif auto_status:
        updates["status"] = auto_status

    if incoming_tx is not None:
        updates["tx_hash"] = incoming_tx or None

    if body.note is not None:
        updates["note"] = body.note.strip() or None

    if rpc_result:
        updates["rpc_verification"] = {
            **rpc_result,
            "checked_at": _now_iso(),
            "tx_hash": incoming_tx,
        }

    await db[COLL].update_one({"id": transfer_id}, {"$set": updates})
    doc = await db[COLL].find_one({"id": transfer_id}, {"_id": 0})
    return doc


@router.get("/admin/treasury/transfers/known-addresses")
async def admin_transfers_known_addresses(
    auth=Depends(_dep_auth),
):
    """Return the known treasury/omnibus addresses for quick-select in the transfer form."""
    db = _get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _perm(auth, "view_treasury")

    addresses = []
    try:
        cursor = db["treasury_wallets"].find(
            {"enabled": {"$ne": False}},
            {"_id": 0, "address": 1, "label": 1, "asset": 1, "network": 1, "role": 1},
        ).limit(200)
        rows = await cursor.to_list(length=200)
        for r in rows:
            if r.get("address"):
                addresses.append({
                    "address": r["address"],
                    "label": r.get("label") or f"{r.get('role', 'wallet').capitalize()} ({r.get('network', '')})",
                    "asset": r.get("asset", ""),
                    "network": r.get("network", ""),
                    "role": r.get("role", ""),
                })
    except Exception:
        pass

    return {"addresses": addresses, "supported_assets": SUPPORTED_ASSETS, "supported_networks": SUPPORTED_NETWORKS}
