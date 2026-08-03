"""Landing-page promo popup — coin slide + mobile app slide (admin-managed)."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import HTTPException, UploadFile

COL_PROMO = "landing_promo"
DOC_ID = "global"
PROMO_IMAGE_SLOTS = ("coin", "app")
MAX_PROMO_IMAGE_BYTES = 8 * 1024 * 1024
PROMO_IMAGE_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

DEFAULTS: Dict[str, Any] = {
    "id": DOC_ID,
    "enabled": True,
    "auto_scroll_seconds": 4,
    "dismiss_hours": 24,
    "coin": {
        "enabled": True,
        "brand_label": "IBO",
        "title": "IBO COIN",
        "tagline_1": "THE NEXT BIG CRYPTO REVOLUTION!",
        "tagline_2": "JOIN THE FUTURE OF CRYPTO! DON'T MISS OUT!",
        "status_line": "IBO COIN IS GOING LIVE",
        "event_line": "TRADE IBO/USDT ON IBO EXCHANGE",
        "cta_url": "/ibo-markets",
        "cta_label": "Explore IBO Markets",
        "image_url": None,
    },
    "app": {
        "enabled": True,
        "headline": "Your Crypto Journey Just Got Easier!",
        "description": (
            "The Android App for IBO Exchange is live & ready for you! "
            "Trade, track, and manage your crypto anytime, anywhere."
        ),
        "subheadline": "Download Now & Start Trading Instantly!",
        "features": "Fast | Secure | Real-Time",
        "cta_label": "Click here to download",
        "image_url": None,
    },
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _merge_defaults(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    base = {**DEFAULTS, **(doc or {})}
    base["id"] = DOC_ID
    coin = {**DEFAULTS["coin"], **((doc or {}).get("coin") or {})}
    app = {**DEFAULTS["app"], **((doc or {}).get("app") or {})}
    base["coin"] = coin
    base["app"] = app
    try:
        base["auto_scroll_seconds"] = max(2, min(30, int(base.get("auto_scroll_seconds") or 4)))
    except (TypeError, ValueError):
        base["auto_scroll_seconds"] = 4
    try:
        base["dismiss_hours"] = max(1, min(720, int(base.get("dismiss_hours") or 24)))
    except (TypeError, ValueError):
        base["dismiss_hours"] = 24
    base["enabled"] = bool(base.get("enabled", True))
    return base


async def get_config(db) -> Dict[str, Any]:
    doc = await db[COL_PROMO].find_one({"id": DOC_ID}, {"_id": 0})
    return _merge_defaults(doc)


async def save_config(db, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = await get_config(db)
    updates: Dict[str, Any] = {"updated_at": _now_iso()}

    for key in ("enabled", "auto_scroll_seconds", "dismiss_hours"):
        if key in patch and patch[key] is not None:
            updates[key] = patch[key]

    if "coin" in patch and isinstance(patch["coin"], dict):
        updates["coin"] = {**current["coin"], **patch["coin"]}
    if "app" in patch and isinstance(patch["app"], dict):
        updates["app"] = {**current["app"], **patch["app"]}

    merged = _merge_defaults({**current, **updates})
    await db[COL_PROMO].update_one(
        {"id": DOC_ID},
        {"$set": merged},
        upsert=True,
    )
    return merged


async def public_payload(db, apk_release: Dict[str, Any]) -> Dict[str, Any]:
    cfg = await get_config(db)
    app_slide = dict(cfg["app"])
    app_slide["apk"] = apk_release
    return {
        "enabled": cfg["enabled"],
        "auto_scroll_seconds": cfg["auto_scroll_seconds"],
        "dismiss_hours": cfg["dismiss_hours"],
        "coin": cfg["coin"],
        "app": app_slide,
    }


async def upload_image(
    db,
    *,
    slot: str,
    upload: UploadFile,
    promo_dir: Path,
) -> Dict[str, Any]:
    slot = (slot or "").strip().lower()
    if slot not in PROMO_IMAGE_SLOTS:
        raise HTTPException(400, f"slot must be one of {PROMO_IMAGE_SLOTS}")

    ct = (upload.content_type or "").split(";")[0].strip()
    ext = PROMO_IMAGE_EXT.get(ct)
    if not ext:
        raise HTTPException(400, "Image must be JPEG, PNG, or WebP")

    raw = await upload.read()
    if len(raw) > MAX_PROMO_IMAGE_BYTES:
        raise HTTPException(400, "Image too large (max 8 MB)")
    if len(raw) < 256:
        raise HTTPException(400, "Image file too small")

    promo_dir.mkdir(parents=True, exist_ok=True)
    for old in promo_dir.glob(f"{slot}-*"):
        try:
            old.unlink()
        except OSError:
            pass

    fname = f"{slot}-{uuid.uuid4().hex[:12]}{ext}"
    (promo_dir / fname).write_bytes(raw)
    rel_url = f"/uploads/promo/{fname}"

    cfg = await get_config(db)
    section = dict(cfg[slot])
    section["image_url"] = rel_url
    return await save_config(db, {slot: section})
