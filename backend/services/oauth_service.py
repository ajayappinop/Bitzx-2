"""
Google + Apple OAuth (Sign in with …) helpers.

Env:
  GOOGLE_OAUTH_CLIENT_ID   — Web client ID (Google Cloud Console)
  APPLE_OAUTH_CLIENT_ID    — Services ID (Apple Developer → Identifiers)
  APPLE_OAUTH_REDIRECT_URI — Must match frontend redirect used by AppleJS (https)
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional

import httpx
from jose import jwk, jwt
from jose.exceptions import JWTError

logger = logging.getLogger(__name__)

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

_google_jwks_cache: Dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_apple_jwks_cache: Dict[str, Any] = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL = 3600.0


def _decode_rs256(token: str, key_dict: dict, *, audience: str, issuer: Optional[str] = None) -> dict:
    key = jwk.construct(key_dict)
    options = {"verify_at_hash": False}
    kwargs: Dict[str, Any] = {
        "algorithms": [key_dict.get("alg") or "RS256"],
        "audience": audience,
        "options": options,
    }
    if issuer:
        kwargs["issuer"] = issuer
    return jwt.decode(token, key, **kwargs)


def google_client_id() -> str:
    return (
        os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
        or os.environ.get("GOOGLE_CLIENT_ID")
        or ""
    ).strip()


def apple_client_id() -> str:
    return (
        os.environ.get("APPLE_OAUTH_CLIENT_ID")
        or os.environ.get("APPLE_CLIENT_ID")
        or os.environ.get("APPLE_SERVICES_ID")
        or ""
    ).strip()


def apple_redirect_uri() -> str:
    return (
        os.environ.get("APPLE_OAUTH_REDIRECT_URI")
        or os.environ.get("APPLE_REDIRECT_URI")
        or ""
    ).strip()


def oauth_public_config() -> Dict[str, Any]:
    g = google_client_id()
    a = apple_client_id()
    return {
        "google_client_id": g,
        "apple_client_id": a,
        "apple_redirect_uri": apple_redirect_uri(),
        "google_enabled": bool(g),
        "apple_enabled": bool(a),
    }


async def _fetch_jwks(url: str, cache: Dict[str, Any]) -> dict:
    now = time.time()
    if cache.get("keys") and (now - float(cache.get("fetched_at") or 0)) < _JWKS_TTL:
        return cache["keys"]
    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
    cache["keys"] = data
    cache["fetched_at"] = now
    return data


def _pick_jwk(jwks: dict, kid: Optional[str]) -> Optional[dict]:
    keys = jwks.get("keys") or []
    if not keys:
        return None
    if kid:
        for k in keys:
            if k.get("kid") == kid:
                return k
    return keys[0]


async def verify_google_id_token(id_token: str) -> Dict[str, Any]:
    """Return normalized profile { sub, email, email_verified, name, picture }."""
    client_id = google_client_id()
    if not client_id:
        raise ValueError("Google Sign-In is not configured (GOOGLE_OAUTH_CLIENT_ID)")
    token = (id_token or "").strip()
    if not token:
        raise ValueError("Missing Google ID token")

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise ValueError("Invalid Google token") from exc

    jwks = await _fetch_jwks(GOOGLE_CERTS_URL, _google_jwks_cache)
    key = _pick_jwk(jwks, header.get("kid"))
    if not key:
        raise ValueError("Could not resolve Google signing key")

    try:
        claims = _decode_rs256(token, key, audience=client_id)
    except JWTError as exc:
        raise ValueError(f"Google token verification failed: {exc}") from exc

    iss = claims.get("iss") or ""
    if iss not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("Invalid Google token issuer")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise ValueError("Google account has no email")
    if claims.get("email_verified") is False:
        raise ValueError("Google email is not verified")

    name = (claims.get("name") or claims.get("given_name") or "").strip()
    if not name:
        name = email.split("@")[0] or "User"

    return {
        "provider": "google",
        "sub": str(claims.get("sub") or ""),
        "email": email,
        "email_verified": bool(claims.get("email_verified", True)),
        "name": name[:50],
        "picture": claims.get("picture"),
    }


async def verify_google_access_token(access_token: str) -> Dict[str, Any]:
    client_id = google_client_id()
    if not client_id:
        raise ValueError("Google Sign-In is not configured (GOOGLE_OAUTH_CLIENT_ID)")
    token = (access_token or "").strip()
    if not token:
        raise ValueError("Missing Google access token")

    async with httpx.AsyncClient(timeout=12.0) as client:
        r = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token}"},
        )
        if r.status_code >= 400:
            raise ValueError("Invalid Google access token")
        info = r.json()

    email = (info.get("email") or "").strip().lower()
    if not email:
        raise ValueError("Google account has no email")
    if info.get("email_verified") is False or info.get("verified_email") is False:
        raise ValueError("Google email is not verified")

    name = (info.get("name") or info.get("given_name") or "").strip()
    if not name:
        name = email.split("@")[0] or "User"

    return {
        "provider": "google",
        "sub": str(info.get("sub") or info.get("id") or ""),
        "email": email,
        "email_verified": True,
        "name": name[:50],
        "picture": info.get("picture"),
    }


async def verify_apple_id_token(id_token: str) -> Dict[str, Any]:
    client_id = apple_client_id()
    if not client_id:
        raise ValueError("Apple Sign-In is not configured (APPLE_OAUTH_CLIENT_ID)")
    token = (id_token or "").strip()
    if not token:
        raise ValueError("Missing Apple ID token")

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise ValueError("Invalid Apple token") from exc

    jwks = await _fetch_jwks(APPLE_KEYS_URL, _apple_jwks_cache)
    key = _pick_jwk(jwks, header.get("kid"))
    if not key:
        raise ValueError("Could not resolve Apple signing key")

    try:
        claims = _decode_rs256(
            token, key, audience=client_id, issuer=APPLE_ISSUER,
        )
    except JWTError as exc:
        raise ValueError(f"Apple token verification failed: {exc}") from exc

    email = (claims.get("email") or "").strip().lower()
    sub = str(claims.get("sub") or "")
    if not sub:
        raise ValueError("Invalid Apple subject")
    # Apple may hide email on subsequent logins; email can be empty for re-auth by sub only

    return {
        "provider": "apple",
        "sub": sub,
        "email": email,
        "email_verified": bool(claims.get("email_verified", True)) if email else False,
        "name": "",  # First-time only name arrives from AppleJS separately
        "picture": None,
    }
