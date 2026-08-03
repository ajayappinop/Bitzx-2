"""Signzy Face Match API — selfie vs ID document verification.

Compares a live selfie (``firstImage``) against an ID photo (``secondImage``).
Both parameters must be **publicly reachable URLs** (Signzy fetches them).

Configuration (backend/.env):
    SIGNZY_API_KEY              — shared with other Signzy integrations
    SIGNZY_ENV                  — "production" or "preproduction"
    API_PUBLIC_URL              — public base URL of this API, e.g. https://api.ibo.io
    SIGNZY_FACE_MATCH_THRESHOLD — 0.05–0.95 (default 0.5)
    SIGNZY_FACE_MATCH_REQUIRED  — "true" / "false" (default true)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_PROD_URL = "https://api.signzy.app/api/v3/face/match"
_PRE_URL = "https://api-preproduction.signzy.app/api/v3/face/match"
_TIMEOUT = 30.0


@dataclass
class FaceMatchResult:
    verified: bool
    message: str
    match_percentage: Optional[float] = None
    match_score: Optional[float] = None
    threshold: Optional[float] = None
    mask_detections: List[Dict[str, Any]] = field(default_factory=list)


def _api_key() -> str:
    return (os.getenv("SIGNZY_API_KEY") or "").strip()


def _endpoint() -> str:
    env = (os.getenv("SIGNZY_ENV") or "preproduction").strip().lower()
    return _PROD_URL if env == "production" else _PRE_URL


def face_match_configured() -> bool:
    return bool(_api_key())


def _threshold() -> float:
    raw = (os.getenv("SIGNZY_FACE_MATCH_THRESHOLD") or "0.5").strip()
    try:
        val = float(raw)
    except ValueError:
        val = 0.5
    return max(0.05, min(0.95, val))


def face_match_required() -> bool:
    v = (os.getenv("SIGNZY_FACE_MATCH_REQUIRED") or "true").strip().lower()
    return v not in ("false", "0", "no")


def max_selfie_bytes() -> int:
    return _MAX_IMAGE_BYTES


def public_asset_url(url: str) -> str:
    """Turn a relative ``/uploads/...`` path or absolute URL into a Signzy-fetchable URL."""
    u = (url or "").strip()
    if not u:
        raise ValueError("Image URL is empty")
    if u.lower().startswith("http://") or u.lower().startswith("https://"):
        return u
    base = (os.getenv("API_PUBLIC_URL") or os.getenv("BACKEND_PUBLIC_URL") or "").strip().rstrip("/")
    if not base:
        raise ValueError(
            "API_PUBLIC_URL (or BACKEND_PUBLIC_URL) must be set so Signzy can fetch KYC images"
        )
    if not u.startswith("/"):
        u = "/" + u
    return f"{base}{u}"


def _parse_match_score(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip().rstrip("%")
    try:
        return float(s)
    except ValueError:
        return None


_CONFUSING_FACE_MATCH_PHRASES = (
    "negative result",
    "completed with negative",
    "verification completed",
    "no match found",
)


def _is_confusing_face_match_message(msg: str) -> bool:
    lower = (msg or "").strip().lower()
    if not lower:
        return True
    return any(phrase in lower for phrase in _CONFUSING_FACE_MATCH_PHRASES)


def _humanize_face_match_message(
    verified: bool,
    raw_message: str,
    match_pct: Optional[float],
) -> str:
    """Turn Signzy jargon into plain user-facing copy."""
    msg = (raw_message or "").strip()
    if verified:
        if not msg or _is_confusing_face_match_message(msg):
            return "Face match passed"
        return msg

    if not msg or _is_confusing_face_match_message(msg):
        pct_hint = f" ({match_pct:.0f}% match)" if match_pct is not None else ""
        return (
            f"Face verification failed{pct_hint}. "
            "Your selfie did not match your ID photo — please retake it in good lighting."
        )
    return msg


async def match_faces(
    selfie_url: str,
    id_image_url: str,
    *,
    detect_mask_on: Optional[List[str]] = None,
) -> FaceMatchResult:
    """Call Signzy Face Match API."""
    key = _api_key()
    if not key:
        raise RuntimeError("SIGNZY_API_KEY is not set")

    first = public_asset_url(selfie_url)
    second = public_asset_url(id_image_url)
    thr = _threshold()

    payload: Dict[str, Any] = {
        "firstImage": first,
        "secondImage": second,
        "threshold": thr,
    }
    if detect_mask_on:
        mask_urls = [public_asset_url(u) for u in detect_mask_on if u]
        if mask_urls:
            payload["detectMask"] = mask_urls

    endpoint = _endpoint()
    logger.info(
        "[FaceMatch] REQUEST endpoint=%s threshold=%s first=%s second=%s",
        endpoint,
        thr,
        first[:80],
        second[:80],
    )

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json", "Authorization": key},
            )
    except httpx.TimeoutException as exc:
        logger.error("[FaceMatch] TIMEOUT endpoint=%s", endpoint)
        raise ValueError("Signzy face match request timed out") from exc
    except httpx.RequestError as exc:
        logger.error("[FaceMatch] REQUEST_ERROR %s", exc)
        raise ValueError(f"Signzy face match request error: {exc}") from exc

    logger.info("[FaceMatch] RESPONSE status=%s body=%s", resp.status_code, resp.text[:500])

    if not resp.is_success:
        raise ValueError(f"Signzy face match API error {resp.status_code}: {resp.text}")

    try:
        data = resp.json()
    except Exception as exc:
        raise ValueError(f"Signzy face match returned non-JSON: {resp.text}") from exc

    result = data.get("result") if isinstance(data.get("result"), dict) else data
    if not isinstance(result, dict):
        result = {}

    match_pct_raw = result.get("matchPercentage") or result.get("matchPercent")
    match_pct = _parse_match_score(match_pct_raw)
    match_score = _parse_match_score(result.get("matchScore"))
    verified_raw = result.get("verified")
    if verified_raw is not None:
        verified = bool(verified_raw)
    elif match_pct is not None:
        cut = thr * 100 if thr <= 1 else thr
        verified = match_pct >= cut
    else:
        verified = False
    message = (result.get("message") or result.get("reason") or "").strip()

    masks: List[Dict[str, Any]] = []
    raw_masks = result.get("maskDetections") or result.get("maskDetection") or []
    if isinstance(raw_masks, list):
        for m in raw_masks:
            if isinstance(m, dict):
                masks.append(m)

    message = _humanize_face_match_message(verified, message, match_pct)

    logger.info(
        "[FaceMatch] PARSED verified=%s match=%s masks=%d",
        verified,
        match_pct,
        len(masks),
    )

    return FaceMatchResult(
        verified=verified,
        message=message,
        match_percentage=match_pct,
        match_score=match_score,
        threshold=thr,
        mask_detections=masks,
    )
