"""Mobile app home screen promo banners — admin-managed carousel."""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import HTTPException, UploadFile


def _json_safe(value: Any) -> Any:
    """Recursively strip Mongo types so FastAPI can serialize API responses."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value

COL_BANNERS = "app_home_banners"
COL_SETTINGS = "app_home_banner_settings"
SETTINGS_ID = "global"

# Mobile carousel aspect (matches reference card ~2.45:1)
BANNER_TARGET_W = 1200
BANNER_TARGET_H = 490
BANNER_ASPECT = BANNER_TARGET_W / BANNER_TARGET_H

MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

DEFAULT_SETTINGS: Dict[str, Any] = {
    "id": SETTINGS_ID,
    "enabled": True,
    "auto_scroll_seconds": 5,
}

DEFAULT_GRADIENT = {
    "gradient_start": "#1a1408",
    "gradient_end": "#4a3820",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return f"banner_{uuid.uuid4().hex[:12]}"


def _normalize_banner(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out = _json_safe(out)
    out["id"] = str(out.get("id") or _new_id())
    out["enabled"] = bool(out.get("enabled", True))
    try:
        out["sort_order"] = int(out.get("sort_order") or 0)
    except (TypeError, ValueError):
        out["sort_order"] = 0
    out["badge"] = str(out.get("badge") or "").strip() or None
    out["title"] = str(out.get("title") or "").strip()
    out["subtitle"] = str(out.get("subtitle") or "").strip() or None
    out["cta_label"] = str(out.get("cta_label") or "").strip() or None
    out["cta_action"] = str(out.get("cta_action") or "none").strip().lower()
    out["cta_url"] = str(out.get("cta_url") or "").strip() or None
    out["image_url"] = out.get("image_url") or None
    gs = str(out.get("gradient_start") or DEFAULT_GRADIENT["gradient_start"]).strip()
    ge = str(out.get("gradient_end") or DEFAULT_GRADIENT["gradient_end"]).strip()
    out["gradient_start"] = gs
    out["gradient_end"] = ge
    try:
        out["overlay_opacity"] = max(0.0, min(1.0, float(out.get("overlay_opacity", 0.55))))
    except (TypeError, ValueError):
        out["overlay_opacity"] = 0.55
    return out


async def get_settings(db) -> Dict[str, Any]:
    doc = await db[COL_SETTINGS].find_one({"id": SETTINGS_ID}, {"_id": 0})
    base = {**DEFAULT_SETTINGS, **(doc or {})}
    base["id"] = SETTINGS_ID
    try:
        base["auto_scroll_seconds"] = max(3, min(30, int(base.get("auto_scroll_seconds") or 5)))
    except (TypeError, ValueError):
        base["auto_scroll_seconds"] = 5
    base["enabled"] = bool(base.get("enabled", True))
    return _json_safe(base)


async def save_settings(db, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = await get_settings(db)
    merged = {**current, **{k: v for k, v in patch.items() if v is not None}}
    merged["updated_at"] = _now_iso()
    await db[COL_SETTINGS].update_one(
        {"id": SETTINGS_ID},
        {"$set": merged},
        upsert=True,
    )
    return await get_settings(db)


async def list_all_banners(db) -> List[Dict[str, Any]]:
    rows = await db[COL_BANNERS].find({}, {"_id": 0}).sort("sort_order", 1).to_list(200)
    return [_normalize_banner(d) for d in rows]


async def get_banner(db, banner_id: str) -> Dict[str, Any]:
    doc = await db[COL_BANNERS].find_one({"id": banner_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Banner not found")
    return _normalize_banner(doc)


async def public_payload(db) -> Dict[str, Any]:
    settings = await get_settings(db)
    if not settings.get("enabled"):
        return {**settings, "banners": []}
    all_rows = await list_all_banners(db)
    # Show any enabled banner that has either a title or an image — title is no longer required
    banners = [b for b in all_rows if b.get("enabled") and (b.get("title") or b.get("image_url"))]
    return {
        "enabled": True,
        "auto_scroll_seconds": settings["auto_scroll_seconds"],
        "banners": banners,
    }


async def create_banner(db, body: Dict[str, Any]) -> Dict[str, Any]:
    rows = await list_all_banners(db)
    max_order = max((r.get("sort_order", 0) for r in rows), default=-1)
    banner_id = _new_id()
    doc = _normalize_banner({
        "id": banner_id,
        "sort_order": max_order + 1,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        **body,
    })
    # Insert a copy — pymongo/motor mutate the dict in-place with ObjectId _id
    await db[COL_BANNERS].insert_one({**doc})
    return await get_banner(db, banner_id)


async def update_banner(db, banner_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = await get_banner(db, banner_id)
    merged = _normalize_banner({**current, **patch, "updated_at": _now_iso()})
    await db[COL_BANNERS].update_one({"id": banner_id}, {"$set": merged})
    return merged


async def delete_banner(db, banner_id: str, *, banners_dir: Path) -> None:
    doc = await get_banner(db, banner_id)
    img = doc.get("image_url")
    if img and str(img).startswith("/uploads/home_banners/"):
        fname = Path(str(img)).name
        try:
            (banners_dir / fname).unlink(missing_ok=True)
        except OSError:
            pass
    await db[COL_BANNERS].delete_one({"id": banner_id})


def _process_banner_image(raw: bytes) -> bytes:
    """Center-crop to carousel aspect and resize so mobile always displays cleanly."""
    from PIL import Image

    with Image.open(io.BytesIO(raw)) as im:
        rgb = im.convert("RGB")
        w, h = rgb.size
        if w < 32 or h < 32:
            raise HTTPException(400, "Image too small (min 32×32)")

        src_aspect = w / h
        if src_aspect > BANNER_ASPECT:
            new_w = int(h * BANNER_ASPECT)
            left = (w - new_w) // 2
            box = (left, 0, left + new_w, h)
        else:
            new_h = int(w / BANNER_ASPECT)
            top = (h - new_h) // 2
            box = (0, top, w, top + new_h)
        cropped = rgb.crop(box)
        resample = getattr(Image, "Resampling", Image).LANCZOS
        resized = cropped.resize((BANNER_TARGET_W, BANNER_TARGET_H), resample)
        buf = io.BytesIO()
        resized.save(buf, format="JPEG", quality=88, optimize=True)
        return buf.getvalue()


async def upload_banner_image(
    db,
    *,
    banner_id: str,
    upload: UploadFile,
    banners_dir: Path,
) -> Dict[str, Any]:
    await get_banner(db, banner_id)

    ct = (upload.content_type or "").split(";")[0].strip()
    if ct not in IMAGE_MIME_EXT:
        raise HTTPException(400, "Image must be JPEG, PNG, or WebP")

    raw = await upload.read()
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Image too large (max 10 MB)")
    if len(raw) < 256:
        raise HTTPException(400, "Image file too small")

    try:
        processed = _process_banner_image(raw)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Could not process image: {exc}") from exc

    banners_dir.mkdir(parents=True, exist_ok=True)
    current = await get_banner(db, banner_id)
    old_url = current.get("image_url")
    if old_url and str(old_url).startswith("/uploads/home_banners/"):
        try:
            (banners_dir / Path(str(old_url)).name).unlink(missing_ok=True)
        except OSError:
            pass

    fname = f"{banner_id}-{uuid.uuid4().hex[:8]}.jpg"
    (banners_dir / fname).write_bytes(processed)
    rel_url = f"/uploads/home_banners/{fname}"
    return await update_banner(db, banner_id, {"image_url": rel_url})
