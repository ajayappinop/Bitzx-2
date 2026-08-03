"""FastAPI dependencies for the P2P module.

Follows the same pattern as futures/deps.py — reads the same JWT env vars
so tokens minted by server.py validate here too.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from services.db import get_db

_DEFAULT_JWT_SECRET = "ibo-dev-secret-CHANGE-IN-PRODUCTION"
_security = HTTPBearer(auto_error=False)


def _jwt_settings() -> tuple[str, str]:
    """Read JWT secret + algorithm at call time (not import time) to respect .env loading order."""
    return (
        os.environ.get("JWT_SECRET_KEY", _DEFAULT_JWT_SECRET),
        os.environ.get("JWT_ALGORITHM", "HS256"),
    )


def _decode_user(token: str) -> dict:
    secret, alg = _jwt_settings()
    try:
        payload = jwt.decode(token, secret, algorithms=[alg])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token invalid or expired")
    if (payload.get("typ") or "access") != "access":
        raise HTTPException(status_code=401, detail="Wrong token type")
    return payload


def _decode_admin(token: str) -> dict:
    secret, alg = _jwt_settings()
    try:
        payload = jwt.decode(token, secret, algorithms=[alg])
    except JWTError:
        raise HTTPException(status_code=403, detail="Admin access required")
    if payload.get("typ") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


async def current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_user(credentials.credentials)
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await get_db().users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
    x_admin_key: Optional[str] = None,
) -> dict:
    """Admin JWT (typ=admin) or X-Admin-Key → admin record."""
    # Support X-Admin-Key header (legacy)
    from fastapi import Header
    if not credentials:
        raise HTTPException(status_code=403, detail="Admin access required")
    payload = _decode_admin(credentials.credentials)
    aid = payload.get("sub")
    if not aid:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    admin = await get_db().admin_users.find_one(
        {"aid": aid, "is_active": True},
        {"_id": 0, "password_hash": 0},
    )
    if not admin:
        raise HTTPException(status_code=403, detail="Admin not found or inactive")
    return admin


async def user_from_ws_token(token: Optional[str] = Query(None)) -> Optional[dict]:
    """WebSocket query-token authentication."""
    if not token:
        return None
    try:
        payload = _decode_user(token)
    except HTTPException:
        return None
    uid = payload.get("sub")
    if not uid:
        return None
    return await get_db().users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
