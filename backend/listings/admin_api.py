"""Admin token listing management API."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile

from listings import service
from listings import platform_token as platform_token_svc
from listings.models import (
    AdminTokenCreateIn,
    AdminTokenPatchIn,
    MarketCatalogBulkPatchIn,
    RequestReviewIn,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/listings", tags=["admin-listings"])

_deps: dict = {}
_upload_dir: Optional[Path] = None

from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_http_bearer = HTTPBearer(auto_error=False)


def register_listings_admin(
    *,
    db,
    upload_dir: Path,
    resolve_admin_auth,
    require_admin_permission,
    log_admin_audit,
    get_platform_controls=None,
    get_markets_snapshot=None,
    get_provider_networks=None,
):
    global _upload_dir
    _upload_dir = upload_dir
    _deps.update({
        "db": db,
        "resolve_admin": resolve_admin_auth,
        "require_perm": require_admin_permission,
        "log_audit": log_admin_audit,
        "get_controls": get_platform_controls,
        "get_markets": get_markets_snapshot,
        "get_provider_networks": get_provider_networks,
    })


async def _require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_http_bearer),
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    fn = _deps.get("resolve_admin")
    if fn is None:
        raise HTTPException(status_code=503, detail="Admin auth not configured")
    return await fn(credentials=credentials, x_admin_key=x_admin_key)


def _aid(auth) -> Optional[str]:
    return (auth.admin or {}).get("aid") if auth and auth.admin else None


@router.get("/bsc-directory")
async def admin_bsc_directory(
    auth=Depends(_require_admin),
    q: Optional[str] = None,
    skip: int = 0,
    limit: int = 48,
    deposit_only: bool = False,
    listed_only: bool = False,
    web3_only: bool = False,
):
    """Full BSC deposit catalog for admin (same data as wallet deposit picker)."""
    _deps["require_perm"](auth, "view_listings")
    provider_rows: list = []
    get_nets = _deps.get("get_provider_networks")
    if get_nets:
        try:
            provider_rows = await get_nets()
        except Exception:  # noqa: BLE001
            logger.exception("admin bsc-directory: provider networks failed")
    from listings.bsc_directory import build_bsc_directory_display

    return build_bsc_directory_display(
        provider_rows,
        q=q,
        skip=skip,
        limit=min(200, max(1, limit)),
        deposit_only=deposit_only,
        listed_only=listed_only,
        web3_only=web3_only,
    )


@router.get("/market-catalog")
async def admin_market_catalog(auth=Depends(_require_admin)):
    """Live trading snapshot merged with admin market display metadata."""
    _deps["require_perm"](auth, "view_listings")
    get_markets = _deps.get("get_markets")
    get_controls = _deps.get("get_controls")
    if not get_markets:
        raise HTTPException(status_code=503, detail="Market snapshot not configured")
    controls = await get_controls() if get_controls else {}
    rows = await get_markets()
    from listings.market_catalog import build_public_market_catalog

    catalog = build_public_market_catalog(rows, controls=controls, featured_limit=12)
    catalog["platform_overrides"] = (controls or {}).get("market_display") or {}
    catalog["trading_pairs_total"] = len(rows or [])
    try:
        from listings.deposit_catalog import build_deposit_catalog

        get_nets = _deps.get("get_provider_networks")
        provider_rows = []
        if get_nets:
            try:
                provider_rows = await get_nets()
            except Exception:
                logger.exception("admin market-catalog: provider networks failed")
        dc = build_deposit_catalog(
            provider_rows,
            chain="bsc",
            deposit_only=False,
            include_all_listed=True,
            include_web3_directory=True,
            skip=0,
            limit=1,
        )
        catalog["bsc_directory_total"] = int(dc.get("total") or 0)
    except Exception:
        logger.exception("admin market-catalog: bsc directory total failed")
    return catalog


@router.patch("/market-catalog")
async def admin_patch_market_catalog(
    body: MarketCatalogBulkPatchIn,
    auth=Depends(_require_admin),
):
    """Update listed-token and platform-pair market display settings."""
    _deps["require_perm"](auth, "manage_listings")
    _require_db()
    from datetime import datetime, timezone

    token_items = body.tokens or []
    n = await service.admin_patch_market_catalog_tokens(
        _deps["db"], token_items, aid=_aid(auth),
    )

    if body.platform_symbols:
        get_controls = _deps.get("get_controls")
        controls = await get_controls() if get_controls else {}
        existing = dict((controls or {}).get("market_display") or {})
        for sym, row in body.platform_symbols.items():
            data = row.model_dump(exclude_none=True)
            key = str(sym).upper()
            prev = dict(existing.get(key) or {})
            prev.update(data)
            existing[key] = prev
        now = datetime.now(timezone.utc).isoformat()
        await _deps["db"].platform_controls.update_one(
            {"id": "global"},
            {"$set": {"market_display": existing, "updated_at": now}},
            upsert=True,
        )

    await _deps["log_audit"](
        auth,
        "market_catalog_patch",
        "market_catalog",
        "global",
        {"tokens": n, "platform": len(body.platform_symbols or {})},
    )
    return {"ok": True, "updated_tokens": n, "platform_symbols": len(body.platform_symbols or {})}


@router.get("/stats")
async def admin_listing_stats(auth=Depends(_require_admin)):
    _deps["require_perm"](auth, "view_listings")
    if _deps.get("db") is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return await service.listing_stats(_deps["db"])


@router.get("/platform-token")
async def admin_platform_token_overview(auth=Depends(_require_admin)):
    """IBO / platform default token — config, on-chain, explorer, deposit rails."""
    _deps["require_perm"](auth, "view_listings")
    return await platform_token_svc.get_platform_token_overview(_deps["db"])


@router.post("/platform-token/reseed")
async def admin_platform_token_reseed(auth=Depends(_require_admin)):
    """Re-apply IBO_* env keys to listed_tokens and refresh registry."""
    _deps["require_perm"](auth, "manage_listings")
    result = await platform_token_svc.reseed_platform_token(_deps["db"], _upload_dir)
    await _deps["log_audit"](auth, "listing_ibo_reseed", "listed_token", "platform_default", {})
    return result


def _require_db():
    if _deps.get("db") is None:
        raise HTTPException(status_code=503, detail="Database unavailable")


@router.get("/requests")
async def admin_list_requests(
    status: Optional[str] = Query(None),
    exclude_status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    auth=Depends(_require_admin),
):
    _deps["require_perm"](auth, "view_listings")
    _require_db()
    return await service.list_requests(
        _deps["db"],
        status=status,
        exclude_status=exclude_status,
        skip=skip,
        limit=limit,
    )


@router.get("/tokens")
async def admin_list_tokens(
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    auth=Depends(_require_admin),
):
    _deps["require_perm"](auth, "view_listings")
    _require_db()
    return await service.list_tokens(_deps["db"], status=status, skip=skip, limit=limit)


@router.get("/tokens/{token_id}")
async def admin_get_token(token_id: str, auth=Depends(_require_admin)):
    _deps["require_perm"](auth, "view_listings")
    _require_db()
    return await service.get_token(_deps["db"], token_id)


@router.post("/tokens")
async def admin_create_token(body: AdminTokenCreateIn, auth=Depends(_require_admin)):
    _deps["require_perm"](auth, "manage_listings")
    _require_db()
    tok = await service.admin_create_token(_deps["db"], body.model_dump(), aid=_aid(auth))
    await _deps["log_audit"](auth, "listing_token_create", "listed_token", tok["id"], {"symbol": tok.get("token_symbol")})
    return {"ok": True, "token": tok}


@router.post("/tokens/direct")
async def admin_create_token_multipart(
    auth=Depends(_require_admin),
    project_name: str = Form(...),
    token_name: str = Form(...),
    token_symbol: str = Form(...),
    blockchain_network: str = Form(...),
    contract_address: str = Form(...),
    dex_swap_link: Optional[str] = Form(None),
    official_website: Optional[str] = Form(None),
    twitter_link: Optional[str] = Form(None),
    telegram_link: Optional[str] = Form(None),
    contact_email: Optional[str] = Form(None),
    description: Optional[str] = Form(""),
    quote_asset: str = Form("USDT"),
    deposit_enabled: bool = Form(False),
    withdraw_enabled: bool = Form(False),
    trading_enabled: bool = Form(False),
    is_platform_default: bool = Form(False),
    logo: Optional[UploadFile] = File(None),
):
    _deps["require_perm"](auth, "manage_listings")
    _require_db()
    from listings.validators import validate_listing_payload

    payload = validate_listing_payload(
        project_name=project_name,
        token_name=token_name,
        token_symbol=token_symbol,
        blockchain_network=blockchain_network,
        contract_address=contract_address,
        dex_swap_link=dex_swap_link or official_website or "https://example.com",
        official_website=official_website or dex_swap_link or "https://example.com",
        twitter_link=twitter_link,
        telegram_link=telegram_link,
        contact_email=contact_email or "admin@ibo.local",
        description=description or "Admin-created listing.",
    )
    logo_url = None
    if logo and logo.filename and _upload_dir:
        logo_url = await service.save_logo_upload(_upload_dir, logo)
    body = {**payload, "quote_asset": quote_asset, "deposit_enabled": deposit_enabled,
            "withdraw_enabled": withdraw_enabled, "trading_enabled": trading_enabled,
            "is_platform_default": is_platform_default, "logo_url": logo_url, "status": "approved"}
    tok = await service.admin_create_token(_deps["db"], body, aid=_aid(auth))
    await service._sync_market_pair(_deps["db"], tok)
    await _deps["log_audit"](auth, "listing_token_create_direct", "listed_token", tok["id"], {"symbol": tok.get("token_symbol")})
    return {"ok": True, "token": tok}


@router.patch("/tokens/{token_id}")
async def admin_patch_token(
    token_id: str,
    body: AdminTokenPatchIn,
    auth=Depends(_require_admin),
):
    _deps["require_perm"](auth, "manage_listings")
    _require_db()
    tok = await service.admin_patch_token(_deps["db"], token_id, body.model_dump(exclude_none=True), aid=_aid(auth))
    await _deps["log_audit"](auth, "listing_token_patch", "listed_token", token_id, {"keys": list(body.model_dump(exclude_none=True).keys())})
    return {"ok": True, "token": tok}


def _form_bool(v: Optional[str]) -> Optional[bool]:
    if v is None or str(v).strip() == "":
        return None
    return str(v).strip().lower() in ("1", "true", "yes", "on")


@router.patch("/tokens/{token_id}/direct")
async def admin_patch_token_multipart(
    token_id: str,
    auth=Depends(_require_admin),
    project_name: Optional[str] = Form(None),
    token_name: Optional[str] = Form(None),
    token_symbol: Optional[str] = Form(None),
    blockchain_network: Optional[str] = Form(None),
    contract_address: Optional[str] = Form(None),
    dex_swap_link: Optional[str] = Form(None),
    official_website: Optional[str] = Form(None),
    twitter_link: Optional[str] = Form(None),
    telegram_link: Optional[str] = Form(None),
    contact_email: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    quote_asset: Optional[str] = Form(None),
    status: Optional[str] = Form(None),
    admin_notes: Optional[str] = Form(None),
    deposit_enabled: Optional[str] = Form(None),
    withdraw_enabled: Optional[str] = Form(None),
    trading_enabled: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
):
    """Multipart token update — supports logo file upload on edit (same storage as create)."""
    _deps["require_perm"](auth, "manage_listings")
    _require_db()
    patch: dict = {}
    for key, val in (
        ("project_name", project_name),
        ("token_name", token_name),
        ("token_symbol", token_symbol),
        ("blockchain_network", blockchain_network),
        ("contract_address", contract_address),
        ("dex_swap_link", dex_swap_link),
        ("official_website", official_website),
        ("twitter_link", twitter_link),
        ("telegram_link", telegram_link),
        ("contact_email", contact_email),
        ("description", description),
        ("quote_asset", quote_asset),
        ("status", status),
        ("admin_notes", admin_notes),
    ):
        if val is not None and str(val).strip() != "":
            patch[key] = str(val).strip()
    for key, val in (
        ("deposit_enabled", _form_bool(deposit_enabled)),
        ("withdraw_enabled", _form_bool(withdraw_enabled)),
        ("trading_enabled", _form_bool(trading_enabled)),
    ):
        if val is not None:
            patch[key] = val
    if logo and logo.filename and _upload_dir:
        patch["logo_url"] = await service.save_logo_upload(_upload_dir, logo)
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    tok = await service.admin_patch_token(_deps["db"], token_id, patch, aid=_aid(auth))
    await _deps["log_audit"](
        auth,
        "listing_token_patch_direct",
        "listed_token",
        token_id,
        {"keys": list(patch.keys())},
    )
    return {"ok": True, "token": tok}


@router.post("/requests/{request_id}/review")
async def admin_review_request(
    request_id: str,
    body: RequestReviewIn,
    auth=Depends(_require_admin),
):
    _deps["require_perm"](auth, "manage_listings")
    _require_db()
    result = await service.review_request(
        _deps["db"],
        request_id,
        status=body.status,
        admin_notes=body.admin_notes,
        aid=_aid(auth),
        deposit_enabled=body.deposit_enabled,
        withdraw_enabled=body.withdraw_enabled,
        trading_enabled=body.trading_enabled,
        networks=[n.model_dump() for n in body.networks] if body.networks else None,
    )
    await _deps["log_audit"](auth, "listing_request_review", "token_listing_request", request_id, {"status": body.status})
    return result
