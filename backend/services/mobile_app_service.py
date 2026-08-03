"""Mobile APK release management — admin upload + public download metadata."""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile
from pymongo import ReturnDocument

logger = logging.getLogger(__name__)

COL_RELEASES = "mobile_app_releases"
COL_CONTROLS = "platform_controls"
CONTROLS_ID = "global"

DISTRIBUTION_DIRECT_APK = "direct_apk"
DISTRIBUTION_GOOGLE_PLAY = "google_play"
VALID_DISTRIBUTIONS = frozenset({DISTRIBUTION_DIRECT_APK, DISTRIBUTION_GOOGLE_PLAY})

APK_MAGIC = b"PK\x03\x04"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")
CHUNK_SIZE = 1024 * 1024  # 1 MiB — stream large APKs without loading into RAM


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_filename(version: str, version_code: int) -> str:
    ver = re.sub(r"[^0-9A-Za-z._-]", "_", version.strip())
    return f"ibo-{int(version_code)}-{ver}.apk"


async def _stream_apk(
    upload: UploadFile,
    dest: Path,
    *,
    max_bytes: int,
) -> Tuple[int, str]:
    """Write upload to disk in chunks; return (size, sha256 hex)."""
    hasher = hashlib.sha256()
    total = 0
    first_chunk = True
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with tmp.open("wb") as out:
            while True:
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break
                if first_chunk:
                    if not chunk.startswith(APK_MAGIC):
                        raise HTTPException(
                            400,
                            "File is not a valid APK (expected ZIP/APK header)",
                        )
                    first_chunk = False
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        400,
                        f"APK too large (max {max_bytes // (1024 * 1024)} MB)",
                    )
                hasher.update(chunk)
                out.write(chunk)
        if total < 1024:
            raise HTTPException(400, "APK file is too small to be valid")
        tmp.replace(dest)
    except HTTPException:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise
    except Exception:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise
    return total, hasher.hexdigest()


def _public_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "available": True,
        "id": doc["id"],
        "version": doc["version"],
        "version_code": int(doc["version_code"]),
        "download_url": doc["download_url"],
        "download_api_url": "/api/mobile-app/download",
        "file_size_bytes": int(doc.get("file_size_bytes") or 0),
        "sha256": doc.get("sha256") or "",
        "release_notes": doc.get("release_notes") or "",
        "published_at": doc.get("published_at") or doc.get("created_at"),
    }


def _normalize_distribution(value: Optional[str]) -> str:
    dist = (value or DISTRIBUTION_DIRECT_APK).strip().lower()
    if dist not in VALID_DISTRIBUTIONS:
        return DISTRIBUTION_DIRECT_APK
    return dist


def _validate_google_play_url(url: str) -> str:
    cleaned = (url or "").strip()
    if not cleaned.startswith(("http://", "https://")):
        raise HTTPException(
            400,
            "google_play_url must be a full URL starting with http:// or https://",
        )
    return cleaned


async def get_distribution_config(db) -> Dict[str, Any]:
    doc = await db[COL_CONTROLS].find_one({"id": CONTROLS_ID}, {"_id": 0}) or {}
    dist = _normalize_distribution(doc.get("mobile_app_distribution"))
    play_url = (doc.get("mobile_app_google_play_url") or "").strip()
    return {
        "distribution": dist,
        "google_play_url": play_url,
    }


async def save_distribution_config(
    db,
    *,
    distribution: str,
    google_play_url: str,
) -> Dict[str, Any]:
    dist = _normalize_distribution(distribution)
    play_url = (google_play_url or "").strip()
    if dist == DISTRIBUTION_GOOGLE_PLAY:
        play_url = _validate_google_play_url(play_url)
    elif play_url and not play_url.startswith(("http://", "https://")):
        play_url = ""

    now = _now_iso()
    await db[COL_CONTROLS].update_one(
        {"id": CONTROLS_ID},
        {
            "$set": {
                "id": CONTROLS_ID,
                "mobile_app_distribution": dist,
                "mobile_app_google_play_url": play_url,
                "updated_at": now,
            },
        },
        upsert=True,
    )
    return {"distribution": dist, "google_play_url": play_url}


async def get_public_release_info(db) -> Dict[str, Any]:
    """Public payload for exchange landing — Google Play or direct APK."""
    cfg = await get_distribution_config(db)
    dist = cfg["distribution"]
    base: Dict[str, Any] = {
        "distribution": dist,
        "google_play_url": cfg["google_play_url"] if dist == DISTRIBUTION_GOOGLE_PLAY else "",
    }

    if dist == DISTRIBUTION_GOOGLE_PLAY:
        play_url = cfg["google_play_url"]
        if play_url.startswith(("http://", "https://")):
            return {
                **base,
                "available": True,
                "store_label": "Google Play",
                "download_url": play_url,
            }
        return {**base, "available": False}

    apk = await get_published_release(db)
    if not apk.get("available"):
        return {**base, "available": False}
    return {**base, **apk}


async def get_published_release(db) -> Dict[str, Any]:
    doc = await db[COL_RELEASES].find_one(
        {"published": True},
        {"_id": 0},
        sort=[("version_code", -1), ("created_at", -1)],
    )
    if not doc:
        return {"available": False}
    return _public_doc(doc)


async def list_releases(db, *, limit: int = 50) -> List[Dict[str, Any]]:
    cur = db[COL_RELEASES].find({}, {"_id": 0}).sort(
        [("version_code", -1), ("created_at", -1)]
    ).limit(limit)
    return await cur.to_list(length=limit)


async def upload_release(
    db,
    *,
    upload: UploadFile,
    version: str,
    version_code: int,
    release_notes: str,
    publish: bool,
    uploaded_by: str,
    mobile_dir: Path,
    max_bytes: int,
) -> Dict[str, Any]:
    version = (version or "").strip()
    if not VERSION_RE.match(version):
        raise HTTPException(
            400,
            "version must look like 1.0.0 or 1.2.3-beta1",
        )
    if version_code < 1:
        raise HTTPException(400, "version_code must be a positive integer")

    fname = upload.filename or ""
    if fname and not fname.lower().endswith(".apk"):
        raise HTTPException(400, "File must have .apk extension")

    existing = await db[COL_RELEASES].find_one(
        {"version_code": int(version_code)}, {"_id": 0, "id": 1}
    )
    if existing:
        raise HTTPException(
            409,
            f"version_code {version_code} already exists (release {existing['id']})",
        )

    rel_name = _safe_filename(version, version_code)
    dest = mobile_dir / rel_name
    if dest.exists():
        raise HTTPException(409, "APK file already on disk — use a new version_code")

    size, sha256 = await _stream_apk(upload, dest, max_bytes=max_bytes)
    rel_url = f"/uploads/mobile/{rel_name}"
    now = _now_iso()
    doc_id = f"mrel_{uuid.uuid4().hex[:16]}"

    if publish:
        await db[COL_RELEASES].update_many(
            {"published": True},
            {"$set": {"published": False, "updated_at": now}},
        )

    doc: Dict[str, Any] = {
        "id": doc_id,
        "version": version,
        "version_code": int(version_code),
        "download_url": rel_url,
        "file_name": rel_name,
        "file_size_bytes": size,
        "sha256": sha256,
        "release_notes": (release_notes or "").strip()[:4000],
        "published": bool(publish),
        "published_at": now if publish else None,
        "uploaded_by": uploaded_by,
        "created_at": now,
        "updated_at": now,
    }
    await db[COL_RELEASES].insert_one(doc)
    out = dict(doc)
    out.pop("_id", None)
    logger.info(
        "mobile_app: uploaded %s v%s (code=%s, %s bytes, publish=%s)",
        doc_id, version, version_code, size, publish,
    )
    return out


async def set_published(db, release_id: str, *, publish: bool) -> Dict[str, Any]:
    now = _now_iso()
    doc = await db[COL_RELEASES].find_one({"id": release_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Release not found")

    if publish:
        await db[COL_RELEASES].update_many(
            {"published": True, "id": {"$ne": release_id}},
            {"$set": {"published": False, "updated_at": now}},
        )
        patch = {"published": True, "published_at": now, "updated_at": now}
    else:
        patch = {"published": False, "updated_at": now}

    updated = await db[COL_RELEASES].find_one_and_update(
        {"id": release_id},
        {"$set": patch},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not updated:
        raise HTTPException(404, "Release not found")
    return updated


async def get_release_file_path(db, mobile_dir: Path) -> Tuple[Path, Dict[str, Any]]:
    """Resolve on-disk APK path for the currently published release."""
    doc = await db[COL_RELEASES].find_one(
        {"published": True},
        {"_id": 0},
        sort=[("version_code", -1), ("created_at", -1)],
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No published APK")
    fname = (doc.get("file_name") or "").strip()
    if not fname:
        raise HTTPException(status_code=404, detail="Published release has no file")
    path = mobile_dir / fname
    if not path.is_file():
        raise HTTPException(status_code=404, detail="APK file missing on server")
    return path, doc


async def delete_release(db, release_id: str, mobile_dir: Path) -> None:
    doc = await db[COL_RELEASES].find_one({"id": release_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Release not found")
    fname = doc.get("file_name") or ""
    if fname:
        path = mobile_dir / fname
        if path.is_file():
            try:
                path.unlink()
            except OSError as exc:
                logger.warning("mobile_app: could not delete %s: %s", path, exc)
    await db[COL_RELEASES].delete_one({"id": release_id})
