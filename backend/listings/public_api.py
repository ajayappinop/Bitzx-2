"""Public listing submission and catalog endpoints."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from listings import service
from listings.constants import LISTING_SUBMIT_LIMIT_PER_EMAIL_DAY, LISTING_SUBMIT_LIMIT_PER_IP_HOUR
from listings.models import ListingSubmitOut
from listings.validators import validate_listing_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/listings", tags=["listings"])

_deps: dict = {}


def register_listings_public(
    *,
    db,
    upload_dir: Path,
    rate_limit_check=None,
    get_platform_controls=None,
    get_markets_snapshot=None,
    get_provider_networks=None,
):
    _deps.update({
        "db": db,
        "upload_dir": upload_dir,
        "rate_limit": rate_limit_check,
        "get_controls": get_platform_controls,
        "get_markets": get_markets_snapshot,
        "get_provider_networks": get_provider_networks,
    })


async def _submit_rate_limit(request: Request, email: str) -> None:
    if not _deps.get("db") or not _deps.get("rate_limit"):
        return
    from services import rate_limit_service

    ip = rate_limit_service.client_ip_from_request(request)
    await _deps["rate_limit"](
        _deps["db"],
        scope="listings.submit",
        key=f"ip:{ip}",
        limit=LISTING_SUBMIT_LIMIT_PER_IP_HOUR,
        window_sec=3600,
    )
    em = (email or "").strip().lower()
    if em:
        await _deps["rate_limit"](
            _deps["db"],
            scope="listings.submit.email",
            key=f"email:{em}",
            limit=LISTING_SUBMIT_LIMIT_PER_EMAIL_DAY,
            window_sec=86400,
        )


@router.get("/network-options")
async def listing_network_options():
    """Networks available for new listing applications (informational)."""
    from listings.constants import KNOWN_NETWORKS

    return {"networks": list(KNOWN_NETWORKS)}


@router.get("/pairs")
async def public_trade_pairs():
    """Spot pair catalog for exchange UI (approved + trading_enabled)."""
    from listings.registry import get_market_pair_defs, get_symbol_map

    items = []
    for p in get_market_pair_defs():
        items.append({
            "symbol": p["symbol"],
            "base": p["base"],
            "quote": p["quote"],
            "source": p.get("source", "listed"),
        })
    return {"items": items, "symbol_map": get_symbol_map()}


@router.get("/bsc-directory")
async def public_bsc_directory(
    q: Optional[str] = None,
    skip: int = 0,
    limit: int = 60,
    deposit_only: bool = False,
    listed_only: bool = False,
    web3_only: bool = False,
):
    """BSC / Web3 token directory (same set as wallet deposit search) for markets + landing."""
    provider_rows: list = []
    get_nets = _deps.get("get_provider_networks")
    if get_nets:
        try:
            provider_rows = await get_nets()
        except Exception:  # noqa: BLE001
            logger.exception("bsc-directory: provider networks failed")
    try:
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
    except Exception:  # noqa: BLE001
        logger.exception("public bsc-directory failed")
        return {"items": [], "total": 0, "skip": skip, "limit": limit, "chain": "bsc", "counts": {}}


@router.get("/market-catalog")
async def public_market_catalog():
    """Market catalog for landing + markets UI (metadata; prices via /trading/markets or WS)."""
    get_markets = _deps.get("get_markets")
    get_controls = _deps.get("get_controls")
    if not get_markets:
        return {"items": [], "featured": [], "total": 0, "categories": {}}
    try:
        controls = await get_controls() if get_controls else {}
        rows = await get_markets()
        from listings.market_catalog import build_public_market_catalog

        return build_public_market_catalog(rows, controls=controls, featured_limit=8)
    except Exception:  # noqa: BLE001
        logger.exception("public market-catalog failed")
        return {"items": [], "featured": [], "total": 0, "categories": {}}


@router.get("/listed")
async def public_listed_tokens():
    """Approved tokens visible on marketing surfaces (no contract secrets)."""
    if not _deps.get("db"):
        return {"items": []}
    from listings.constants import COL_TOKENS, STATUS_APPROVED

    rows = await _deps["db"][COL_TOKENS].find(
        {"status": STATUS_APPROVED, "trading_enabled": True},
        {"_id": 0, "contract_address_enc": 0, "networks.contract_address_enc": 0},
    ).sort("token_symbol", 1).to_list(200)
    public = []
    for r in rows:
        public.append({
            "id": r.get("id"),
            "project_name": r.get("project_name"),
            "token_name": r.get("token_name"),
            "token_symbol": r.get("token_symbol"),
            "spot_symbol": r.get("spot_symbol"),
            "logo_url": r.get("logo_url"),
            "official_website": r.get("official_website"),
            "trading_enabled": r.get("trading_enabled"),
            "market_tagline": r.get("market_tagline"),
            "market_category": r.get("market_category"),
            "featured_landing": bool(r.get("featured_landing")),
            "description": (r.get("description") or "")[:280],
        })
    return {"items": public}


@router.post("/submit", response_model=ListingSubmitOut)
async def submit_listing_request(
    request: Request,
    project_name: str = Form(...),
    token_name: str = Form(...),
    token_symbol: str = Form(...),
    blockchain_network: str = Form(...),
    contract_address: str = Form(...),
    dex_swap_link: str = Form(...),
    official_website: str = Form(...),
    twitter_link: Optional[str] = Form(None),
    telegram_link: Optional[str] = Form(None),
    contact_email: str = Form(...),
    description: str = Form(...),
    logo: UploadFile = File(...),
):
    if not _deps.get("db"):
        raise HTTPException(status_code=503, detail="Database unavailable")
    upload_dir = _deps.get("upload_dir")
    if upload_dir is None:
        raise HTTPException(status_code=503, detail="Uploads not configured")

    payload = validate_listing_payload(
        project_name=project_name,
        token_name=token_name,
        token_symbol=token_symbol,
        blockchain_network=blockchain_network,
        contract_address=contract_address,
        dex_swap_link=dex_swap_link,
        official_website=official_website,
        twitter_link=twitter_link,
        telegram_link=telegram_link,
        contact_email=contact_email,
        description=description,
    )
    await _submit_rate_limit(request, payload["contact_email"])

    logo_url = await service.save_logo_upload(upload_dir, logo)

    result = await service.create_listing_request(
        _deps["db"],
        payload=payload,
        logo_url=logo_url,
        submitter_uid=None,
    )
    return ListingSubmitOut(request_id=result["id"])
