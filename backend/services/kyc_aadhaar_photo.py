"""Persist Aadhaar reference photo from Signzy DigiLocker for face-match.

Signzy may return the face reference as:
  - ``aadhaarJpeg`` (HTTPS URL) on the callback root
  - ``aadharDetail.photo`` (base64 or data-URI)
  - A JPEG link inside ``details.files`` for doctype ADHAR

We download/decode once at callback time and store under ``uploads/kyc/`` so
face-match uses a stable local URL (via API_PUBLIC_URL) instead of expiring
Signzy links.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx

from services.digilocker import DigiLockerKycData

logger = logging.getLogger(__name__)

_MAX_BYTES = 5 * 1024 * 1024
_DATA_URI_RE = re.compile(r"^data:image/[\w+.-]+;base64,", re.I)
_JPEG_URL_KEYS = ("aadhaarJpeg", "aadhaarJPEG", "eAadhaarJpeg", "eaadhaarJpeg")


def _jpeg_url_from_payload(payload: Dict[str, Any]) -> Optional[str]:
    for key in _JPEG_URL_KEYS:
        val = payload.get(key)
        if isinstance(val, str) and val.strip().lower().startswith("http"):
            return val.strip()

    aadhaar = payload.get("aadharDetail") or payload.get("aadhaarDetail") or {}
    if isinstance(aadhaar, dict):
        photo = (aadhaar.get("photo") or "").strip()
        if photo.lower().startswith("http"):
            return photo

    details = payload.get("details")
    if isinstance(details, dict):
        for key in _JPEG_URL_KEYS:
            val = details.get(key)
            if isinstance(val, str) and val.strip().lower().startswith("http"):
                return val.strip()
        files = details.get("files")
        if isinstance(files, list):
            for item in files:
                if not isinstance(item, dict):
                    continue
                dtype = (item.get("doctype") or item.get("docType") or "").strip().upper()
                if dtype and dtype != "ADHAR":
                    continue
                for k in ("url", "fileUrl", "jpegUrl", "imageUrl", "link"):
                    val = item.get(k)
                    if isinstance(val, str) and val.strip().lower().startswith("http"):
                        return val.strip()
    return None


def _photo_base64_from_payload(payload: Dict[str, Any]) -> Optional[bytes]:
    aadhaar = payload.get("aadharDetail") or payload.get("aadhaarDetail") or {}
    if not isinstance(aadhaar, dict):
        return None
    raw = (aadhaar.get("photo") or "").strip()
    if not raw or raw.lower().startswith("http"):
        return None
    if _DATA_URI_RE.match(raw):
        raw = _DATA_URI_RE.sub("", raw, count=1)
    try:
        decoded = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        return None
    if not decoded or len(decoded) > _MAX_BYTES:
        return None
    return decoded


def resolve_aadhaar_face_sources(
    payload: Dict[str, Any],
    kyc_data: DigiLockerKycData,
) -> Tuple[Optional[str], Optional[bytes]]:
    """Return (remote_jpeg_url, base64_photo_bytes) — first usable wins at persist time."""
    remote = _jpeg_url_from_payload(payload) or (
        kyc_data.aadhaar_jpeg_url if kyc_data.aadhaar_jpeg_url else None
    )
    b64 = _photo_base64_from_payload(payload)
    return remote, b64


def _write_aadhaar_bytes(kyc_dir: Path, uid: str, raw: bytes, ext: str = ".jpg") -> str:
    kyc_dir.mkdir(parents=True, exist_ok=True)
    for p in kyc_dir.glob(f"kyc_{uid}_aadhaar_*"):
        try:
            p.unlink()
        except OSError:
            pass
    fname = f"kyc_{uid}_aadhaar_{uuid.uuid4().hex[:12]}{ext}"
    dest = kyc_dir / fname
    dest.write_bytes(raw)
    return f"/uploads/kyc/{fname}"


async def _download_jpeg(url: str) -> bytes:
    if not url.lower().startswith("https://"):
        raise ValueError("Invalid image URL scheme")
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(url)
    if not resp.is_success:
        raise ValueError(f"Failed to download Aadhaar image ({resp.status_code})")
    raw = resp.content
    if not raw or len(raw) > _MAX_BYTES:
        raise ValueError("Aadhaar image empty or too large")
    ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ct and ct not in ("image/jpeg", "image/jpg", "image/png", "image/webp", "application/octet-stream"):
        raise ValueError(f"Unexpected Aadhaar image content-type: {ct}")
    return raw


async def repersist_aadhaar_from_remote_url(
    *,
    uid: str,
    kyc_dir: Path,
    url: str,
) -> Optional[str]:
    """Re-download Aadhaar JPEG from Signzy and store locally (e.g. after deploy or multi-instance miss)."""
    try:
        raw = await _download_jpeg(url.strip())
        path = _write_aadhaar_bytes(kyc_dir, uid, raw)
        logger.info("[DigiLocker] Re-persisted Aadhaar photo uid=%s path=%s", uid, path)
        return path
    except (ValueError, OSError, httpx.RequestError) as exc:
        logger.error("[DigiLocker] Re-persist Aadhaar failed uid=%s url=%s err=%s", uid, url[:80], exc)
        return None


async def persist_aadhaar_reference_photo(
    *,
    uid: str,
    kyc_dir: Path,
    payload: Dict[str, Any],
    kyc_data: DigiLockerKycData,
) -> Optional[str]:
    """Download/decode Aadhaar face image and return local ``/uploads/kyc/...`` path."""
    remote_url, photo_b64 = resolve_aadhaar_face_sources(payload, kyc_data)

    if photo_b64:
        try:
            path = _write_aadhaar_bytes(kyc_dir, uid, photo_b64)
            logger.info("[DigiLocker] Stored Aadhaar photo from base64 uid=%s path=%s", uid, path)
            return path
        except OSError as exc:
            logger.error("[DigiLocker] Failed to write Aadhaar base64 uid=%s: %s", uid, exc)
            return None

    if remote_url:
        try:
            raw = await _download_jpeg(remote_url)
            path = _write_aadhaar_bytes(kyc_dir, uid, raw)
            logger.info("[DigiLocker] Stored Aadhaar photo from URL uid=%s path=%s", uid, path)
            return path
        except (ValueError, httpx.RequestError) as exc:
            logger.error(
                "[DigiLocker] Failed to fetch Aadhaar JPEG uid=%s url=%s err=%s",
                uid,
                remote_url[:80],
                exc,
            )
            return None

    logger.warning(
        "[DigiLocker] No Aadhaar face image in callback uid=%s keys=%s has_jpeg=%s has_photo=%s",
        uid,
        list(payload.keys()),
        bool(remote_url),
        bool(photo_b64),
    )
    return None
