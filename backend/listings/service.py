"""Business logic for token listing requests and listed tokens."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, UploadFile

from listings.constants import (
    CHAIN_ID_BY_NETWORK,
    COL_REQUESTS,
    COL_TOKENS,
    LOGO_MIME_EXT,
    MAX_LOGO_BYTES,
    STATUS_APPROVED,
    STATUS_DRAFT,
    STATUS_PENDING,
    STATUS_REJECTED,
    STATUS_SUSPENDED,
)
from listings import registry
from listings.secure_store import decrypt_contract, encrypt_contract
from listings.validators import normalize_symbol, validate_contract_address, validate_listing_payload

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _default_networks(
    *,
    network: str,
    contract: str,
    deposit_enabled: bool,
    withdraw_enabled: bool,
    decimals: int = 18,
) -> List[Dict[str, Any]]:
    chain_id = CHAIN_ID_BY_NETWORK.get(network, "")
    enc, is_enc = encrypt_contract(contract)
    return [{
        "network": network,
        "chain_id": chain_id,
        "rpc_chain_key": chain_id,
        "contract_address": contract if not is_enc else "",
        "contract_address_enc": enc,
        "contract_encrypted": is_enc,
        "decimals": decimals,
        "deposit_enabled": deposit_enabled,
        "withdraw_enabled": withdraw_enabled,
        "deposit_scan_enabled": chain_id in ("eth", "bsc"),
    }]


def _public_token(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in doc.items() if k not in ("contract_address_enc",)}
    nets = []
    for n in doc.get("networks") or []:
        nn = {**n}
        if nn.get("contract_encrypted"):
            nn["contract_address"] = decrypt_contract(
                nn.get("contract_address_enc") or "",
                encrypted=True,
            )[:10] + "…"  # masked in public list
        nets.append(nn)
    out["networks"] = nets
    return out


def _admin_token(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(doc)
    for n in out.get("networks") or []:
        if n.get("contract_encrypted"):
            n["contract_address"] = decrypt_contract(
                n.get("contract_address_enc") or "",
                encrypted=True,
            )
    return out


async def _duplicate_check(
    db,
    *,
    token_symbol: str,
    contract_address: str,
    network: str,
    exclude_token_id: Optional[str] = None,
    exclude_request_id: Optional[str] = None,
) -> None:
    sym = token_symbol.upper()
    contract = contract_address.lower() if str(contract_address).startswith("0x") else contract_address
    tok_filt: Dict[str, Any] = {
        "$or": [
            {"token_symbol": sym},
            {"contract_address": contract, "blockchain_network": network},
        ],
    }
    existing = await db[COL_TOKENS].find_one(tok_filt, {"_id": 0, "id": 1})
    if existing and existing.get("id") != exclude_token_id:
        raise HTTPException(status_code=409, detail="Token symbol or contract already listed")

    pending = await db[COL_REQUESTS].find_one({
        "status": STATUS_PENDING,
        "$or": [
            {"token_symbol": sym},
            {"contract_address": contract, "blockchain_network": network},
        ],
    }, {"_id": 0, "id": 1})
    if pending and exclude_request_id and pending.get("id") == exclude_request_id:
        pending = None
    if pending:
        raise HTTPException(status_code=409, detail="A pending listing request already exists for this token")


async def save_logo_upload(upload_dir, file: UploadFile) -> str:
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Logo file is required")
    ct = (file.content_type or "").split(";")[0].strip().lower()
    ext = LOGO_MIME_EXT.get(ct)
    if not ext:
        raise HTTPException(status_code=400, detail="Logo must be JPEG, PNG, or WebP")
    data = await file.read()
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="Logo must be under 2 MB")
    upload_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    path = upload_dir / name
    path.write_bytes(data)
    return f"/uploads/listings/{name}"


async def create_listing_request(
    db,
    *,
    payload: dict,
    logo_url: Optional[str],
    submitter_uid: Optional[str],
) -> Dict[str, Any]:
    await _duplicate_check(
        db,
        token_symbol=payload["token_symbol"],
        contract_address=payload["contract_address"],
        network=payload["blockchain_network"],
    )
    rid = _new_id("lr")
    now = _now()
    doc = {
        "id": rid,
        "status": STATUS_PENDING,
        **payload,
        "logo_url": logo_url,
        "submitter_uid": submitter_uid,
        "admin_notes": None,
        "reviewed_by_aid": None,
        "reviewed_at": None,
        "listed_token_id": None,
        "created_at": now,
        "updated_at": now,
    }
    await db[COL_REQUESTS].insert_one(doc)
    return {"id": rid, "status": STATUS_PENDING}


async def list_requests(
    db,
    *,
    status: Optional[str] = None,
    exclude_status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> Dict[str, Any]:
    filt: Dict[str, Any] = {}
    if status:
        filt["status"] = status
    elif exclude_status:
        filt["status"] = {"$ne": exclude_status}
    total = await db[COL_REQUESTS].count_documents(filt)
    rows = await db[COL_REQUESTS].find(filt, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": rows, "total": total}


async def list_tokens(
    db,
    *,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> Dict[str, Any]:
    filt: Dict[str, Any] = {}
    if status:
        filt["status"] = status
    total = await db[COL_TOKENS].count_documents(filt)
    rows = await db[COL_TOKENS].find(filt, {"_id": 0}).sort("token_symbol", 1).skip(skip).limit(limit).to_list(limit)
    return {"items": [_admin_token(r) for r in rows], "total": total}


async def listing_stats(db) -> Dict[str, int]:
    """Aggregate counts for admin dashboard KPIs."""
    return {
        "requests_pending": await db[COL_REQUESTS].count_documents({"status": STATUS_PENDING}),
        "requests_approved": await db[COL_REQUESTS].count_documents({"status": STATUS_APPROVED}),
        "requests_rejected": await db[COL_REQUESTS].count_documents({"status": STATUS_REJECTED}),
        "requests_total": await db[COL_REQUESTS].count_documents({}),
        "tokens_approved": await db[COL_TOKENS].count_documents({"status": STATUS_APPROVED}),
        "tokens_suspended": await db[COL_TOKENS].count_documents({"status": STATUS_SUSPENDED}),
        "tokens_total": await db[COL_TOKENS].count_documents({}),
    }


async def get_token(db, token_id: str) -> Dict[str, Any]:
    row = await db[COL_TOKENS].find_one({"id": token_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Token not found")
    return _admin_token(row)


async def _upsert_listed_token(db, doc: Dict[str, Any]) -> Dict[str, Any]:
    tid = doc.get("id") or _new_id("tok")
    doc["id"] = tid
    doc["updated_at"] = _now()
    if doc.get("status") == STATUS_APPROVED and not doc.get("approved_at"):
        doc["approved_at"] = _now()
    quote = (doc.get("quote_asset") or "USDT").upper()
    doc["spot_symbol"] = f"{doc['token_symbol']}{quote}"
    await db[COL_TOKENS].update_one({"id": tid}, {"$set": doc}, upsert=True)
    await registry.refresh(db)
    saved = await db[COL_TOKENS].find_one({"id": tid}, {"_id": 0})
    return _admin_token(saved or doc)


async def admin_create_token(db, body: dict, *, aid: Optional[str]) -> Dict[str, Any]:
    sym = normalize_symbol(body["token_symbol"])
    net = body["blockchain_network"]
    contract = validate_contract_address(net, body["contract_address"])
    await _duplicate_check(db, token_symbol=sym, contract_address=contract, network=net)

    networks = body.get("networks")
    if not networks:
        networks = _default_networks(
            network=net,
            contract=contract,
            deposit_enabled=bool(body.get("deposit_enabled")),
            withdraw_enabled=bool(body.get("withdraw_enabled")),
            decimals=int(body.get("decimals") or 18),
        )
    else:
        networks = _normalize_networks_in(networks)

    now = _now()
    doc = {
        "id": _new_id("tok"),
        "status": body.get("status") or STATUS_APPROVED,
        "is_platform_default": bool(body.get("is_platform_default")),
        "project_name": body.get("project_name", ""),
        "token_name": body.get("token_name", sym),
        "token_symbol": sym,
        "blockchain_network": net,
        "contract_address": contract,
        "dex_swap_link": body.get("dex_swap_link"),
        "official_website": body.get("official_website"),
        "twitter_link": body.get("twitter_link"),
        "telegram_link": body.get("telegram_link"),
        "contact_email": body.get("contact_email"),
        "description": body.get("description") or "",
        "logo_url": body.get("logo_url"),
        "quote_asset": (body.get("quote_asset") or "USDT").upper(),
        "deposit_enabled": bool(body.get("deposit_enabled")),
        "withdraw_enabled": bool(body.get("withdraw_enabled")),
        "trading_enabled": bool(body.get("trading_enabled")),
        "market_visible": body.get("market_visible", True) is not False,
        "featured_landing": bool(body.get("featured_landing")),
        "market_sort_order": int(body.get("market_sort_order") or 500),
        "market_tagline": (body.get("market_tagline") or "").strip(),
        "market_category": (body.get("market_category") or "listed").lower(),
        "networks": networks,
        "request_id": None,
        "created_by_aid": aid,
        "approved_by_aid": aid if body.get("status") == STATUS_APPROVED else None,
        "created_at": now,
        "updated_at": now,
        "approved_at": now if body.get("status") == STATUS_APPROVED else None,
    }
    return await _upsert_listed_token(db, doc)


def _normalize_networks_in(raw: List[dict]) -> List[Dict[str, Any]]:
    out = []
    for n in raw:
        net = (n.get("network") or "").strip()
        contract = n.get("contract_address") or ""
        if contract:
            contract = validate_contract_address(net, contract)
        enc, is_enc = encrypt_contract(contract) if contract else ("", False)
        out.append({
            "network": net,
            "chain_id": n.get("chain_id") or CHAIN_ID_BY_NETWORK.get(net, ""),
            "rpc_chain_key": n.get("rpc_chain_key") or CHAIN_ID_BY_NETWORK.get(net, ""),
            "contract_address": contract if not is_enc else "",
            "contract_address_enc": enc,
            "contract_encrypted": is_enc,
            "decimals": int(n.get("decimals") or 18),
            "deposit_enabled": bool(n.get("deposit_enabled")),
            "withdraw_enabled": bool(n.get("withdraw_enabled")),
            "deposit_scan_enabled": bool(n.get("deposit_scan_enabled", True)),
        })
    return out


async def admin_patch_token(db, token_id: str, patch: dict, *, aid: Optional[str]) -> Dict[str, Any]:
    row = await db[COL_TOKENS].find_one({"id": token_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Token not found")
    updates = {k: v for k, v in patch.items() if v is not None and k != "networks"}
    if "token_symbol" in updates:
        updates["token_symbol"] = normalize_symbol(updates["token_symbol"])
    if patch.get("networks") is not None:
        updates["networks"] = _normalize_networks_in(patch["networks"])
    if patch.get("contract_address") and patch.get("blockchain_network"):
        updates["contract_address"] = validate_contract_address(
            patch["blockchain_network"], patch["contract_address"],
        )
    updates["updated_at"] = _now()
    if updates.get("status") == STATUS_APPROVED:
        updates["approved_by_aid"] = aid
        updates["approved_at"] = _now()
    merged = {**row, **updates}
    quote = (merged.get("quote_asset") or "USDT").upper()
    merged["spot_symbol"] = f"{merged['token_symbol']}{quote}"
    await db[COL_TOKENS].update_one({"id": token_id}, {"$set": merged})
    await _sync_market_pair(db, merged)
    await registry.refresh(db)
    return _admin_token(await db[COL_TOKENS].find_one({"id": token_id}, {"_id": 0}))


async def _sync_market_pair(db, tok: Dict[str, Any]) -> None:
    """Keep market_pairs collection aligned with listing trading flag."""
    sym = tok.get("spot_symbol") or f"{tok['token_symbol']}{tok.get('quote_asset', 'USDT')}"
    if tok.get("status") != STATUS_APPROVED or not tok.get("trading_enabled"):
        await db.market_pairs.update_one(
            {"symbol": sym},
            {"$set": {"is_active": False, "updated_at": _now()}},
        )
        return
    now = _now()
    await db.market_pairs.update_one(
        {"symbol": sym},
        {
            "$set": {
                "symbol": sym,
                "base_asset": tok["token_symbol"],
                "quote_asset": (tok.get("quote_asset") or "USDT").upper(),
                "is_active": True,
                "listed_token_id": tok.get("id"),
                "source": "listed",
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )


async def review_request(
    db,
    request_id: str,
    *,
    status: str,
    admin_notes: Optional[str],
    aid: Optional[str],
    deposit_enabled: Optional[bool] = None,
    withdraw_enabled: Optional[bool] = None,
    trading_enabled: Optional[bool] = None,
    networks: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    req = await db[COL_REQUESTS].find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Listing request not found")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(status_code=400, detail="Request is not pending")

    now = _now()
    if status == STATUS_REJECTED:
        await db[COL_REQUESTS].update_one(
            {"id": request_id},
            {"$set": {
                "status": STATUS_REJECTED,
                "admin_notes": admin_notes,
                "reviewed_by_aid": aid,
                "reviewed_at": now,
                "updated_at": now,
            }},
        )
        return {"ok": True, "status": STATUS_REJECTED}

    if status != STATUS_APPROVED:
        raise HTTPException(status_code=400, detail="Invalid review status")

    await _duplicate_check(
        db,
        token_symbol=req["token_symbol"],
        contract_address=req["contract_address"],
        network=req["blockchain_network"],
        exclude_request_id=request_id,
    )

    sym = req["token_symbol"]
    net = req["blockchain_network"]
    contract = req["contract_address"]
    nets = networks or _default_networks(
        network=net,
        contract=contract,
        deposit_enabled=deposit_enabled if deposit_enabled is not None else False,
        withdraw_enabled=withdraw_enabled if withdraw_enabled is not None else False,
    )

    tok_doc = {
        "id": _new_id("tok"),
        "status": STATUS_APPROVED,
        "is_platform_default": False,
        "project_name": req["project_name"],
        "token_name": req["token_name"],
        "token_symbol": sym,
        "blockchain_network": net,
        "contract_address": contract,
        "dex_swap_link": req.get("dex_swap_link"),
        "official_website": req.get("official_website"),
        "twitter_link": req.get("twitter_link"),
        "telegram_link": req.get("telegram_link"),
        "contact_email": req.get("contact_email"),
        "description": req.get("description"),
        "logo_url": req.get("logo_url"),
        "quote_asset": "USDT",
        "deposit_enabled": bool(deposit_enabled),
        "withdraw_enabled": bool(withdraw_enabled),
        "trading_enabled": bool(trading_enabled),
        "networks": nets,
        "request_id": request_id,
        "created_by_aid": None,
        "approved_by_aid": aid,
        "created_at": now,
        "updated_at": now,
        "approved_at": now,
    }
    tok = await _upsert_listed_token(db, tok_doc)
    await _sync_market_pair(db, tok)

    await db[COL_REQUESTS].update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_APPROVED,
            "admin_notes": admin_notes,
            "reviewed_by_aid": aid,
            "reviewed_at": now,
            "updated_at": now,
            "listed_token_id": tok["id"],
        }},
    )
    return {"ok": True, "status": STATUS_APPROVED, "token": tok}


async def seed_platform_default_ibo(db, upload_root) -> None:
    """Create/update IBO from environment keys (values filled by operator)."""
    import os

    sym = (os.getenv("IBO_TOKEN_SYMBOL") or "IBO").strip().upper()
    net = (os.getenv("IBO_BLOCKCHAIN_NETWORK") or "BEP-20 (BNB Chain)").strip()
    contract = (os.getenv("IBO_CONTRACT_ADDRESS") or "").strip()
    if not contract:
        logger.info("listings: IBO_CONTRACT_ADDRESS unset — skip IBO seed")
        return

    try:
        contract = validate_contract_address(net, contract)
    except HTTPException:
        logger.warning("listings: invalid IBO_CONTRACT_ADDRESS — skip seed")
        return
    existing = await db[COL_TOKENS].find_one(
        {"is_platform_default": True},
        {"_id": 0},
    )
    logo = (os.getenv("IBO_LOGO_URL") or "").strip() or (existing or {}).get("logo_url")
    if logo and ("emergentagent.com" in str(logo) or "emergent.sh" in str(logo)):
        logo = None
    dep = os.getenv("IBO_DEPOSIT_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    wdr = os.getenv("IBO_WITHDRAW_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    trd = os.getenv("IBO_TRADING_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    decimals = int(os.getenv("IBO_TOKEN_DECIMALS", "18") or "18")

    doc = {
        "id": (existing or {}).get("id") or _new_id("tok"),
        "status": STATUS_APPROVED,
        "is_platform_default": True,
        "project_name": os.getenv("IBO_PROJECT_NAME", "Ibo"),
        "token_name": os.getenv("IBO_TOKEN_NAME", "Ibo Token"),
        "token_symbol": sym,
        "blockchain_network": net,
        "contract_address": contract,
        "dex_swap_link": os.getenv("IBO_DEX_SWAP_LINK", "").strip() or None,
        "official_website": os.getenv("IBO_OFFICIAL_WEBSITE", "").strip() or None,
        "twitter_link": os.getenv("IBO_TWITTER", "").strip() or None,
        "telegram_link": os.getenv("IBO_TELEGRAM", "").strip() or None,
        "contact_email": os.getenv("IBO_CONTACT_EMAIL", "").strip() or None,
        "description": os.getenv("IBO_DESCRIPTION", "Platform native token."),
        "logo_url": logo,
        "quote_asset": "USDT",
        "deposit_enabled": dep,
        "withdraw_enabled": wdr,
        "trading_enabled": trd,
        "networks": _default_networks(
            network=net,
            contract=contract,
            deposit_enabled=dep,
            withdraw_enabled=wdr,
            decimals=decimals,
        ),
        "request_id": None,
        "updated_at": _now(),
    }
    if not existing:
        doc["created_at"] = _now()
        doc["approved_at"] = _now()
    tok = await _upsert_listed_token(db, doc)
    await _sync_market_pair(db, tok)
    logger.info("listings: platform default token %s seeded (id=%s)", sym, tok["id"])


async def admin_patch_market_catalog_tokens(db, items: List[dict], *, aid: Optional[str]) -> int:
    """Batch-update market display fields on listed tokens."""
    n = 0
    for item in items or []:
        tid = item.get("id")
        if not tid:
            continue
        body = {
            k: v
            for k, v in item.items()
            if k != "id"
            and v is not None
            and k
            in (
                "market_visible",
                "featured_landing",
                "market_sort_order",
                "market_tagline",
                "market_category",
                "project_name",
                "token_name",
                "description",
                "logo_url",
            )
        }
        if not body:
            continue
        await admin_patch_token(db, tid, body, aid=aid)
        n += 1
    return n
