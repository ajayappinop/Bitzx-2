"""Auth dependencies for options (same JWT contract as futures)."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from services.db import get_db

_DEFAULT_JWT_SECRET = "ibo-dev-secret-CHANGE-IN-PRODUCTION"
_security = HTTPBearer(auto_error=False)


def _jwt_settings() -> tuple[str, str]:
    return (
        os.environ.get("JWT_SECRET_KEY", _DEFAULT_JWT_SECRET),
        os.environ.get("JWT_ALGORITHM", "HS256"),
    )


def _decode(token: str) -> dict:
    secret, alg = _jwt_settings()
    try:
        payload = jwt.decode(token, secret, algorithms=[alg])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token invalid or expired")
    if (payload.get("typ") or "access") != "access":
        raise HTTPException(status_code=401, detail="Wrong token type")
    return payload


async def user_from_ws_token(token: Optional[str] = None) -> Optional[dict]:
    """Same rules as ``current_user`` but for WebSocket query-string auth."""
    if not token:
        return None
    try:
        payload = _decode(token)
    except HTTPException:
        return None
    uid = payload.get("sub")
    if not uid:
        return None
    user = await get_db().users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    return user


async def current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode(credentials.credentials)
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await get_db().users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=403, detail="Admin access required")
    secret, alg = _jwt_settings()
    try:
        payload = jwt.decode(credentials.credentials, secret, algorithms=[alg])
    except JWTError:
        raise HTTPException(status_code=403, detail="Admin access required")
    if payload.get("typ") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
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


def admin_has_permission(admin: dict, permission: str) -> bool:
    """Mirror ``adminAccess.hasPermission`` from the frontend (same as futures)."""
    if not permission:
        return True
    perms = admin.get("permissions") or []
    if perms:
        return "*" in perms or permission in perms
    role = str(admin.get("role") or "").lower()
    role_map = {
        "superadmin": ["*"],
        "operations": [
            "view_dashboard", "view_users", "view_kyc", "view_orders",
            "view_trades", "view_withdrawals", "view_markets",
            "view_analytics", "view_alerts", "run_surveillance",
            "view_system_logs", "view_support", "manage_support",
        ],
        "compliance": [
            "view_dashboard", "view_users", "view_kyc",
            "view_compliance", "manage_compliance",
            "run_surveillance", "view_alerts", "view_system_logs",
            "view_support", "manage_support",
        ],
        "finance": [
            "view_dashboard", "view_orders", "view_trades",
            "view_withdrawals", "view_finance", "export_finance",
            "view_treasury", "manage_treasury", "view_hedger",
            "manage_hedger", "execute_hedger", "view_ledger",
            "adjust_wallets", "view_alerts", "view_system_logs",
            "view_support",
        ],
        "support": [
            "view_dashboard", "view_users", "manage_users",
            "view_kyc", "view_orders", "view_trades",
            "view_withdrawals", "view_alerts", "view_system_logs",
            "view_hedger",
        ],
        "viewer": [
            "view_dashboard", "view_users", "view_kyc",
            "view_orders", "view_trades", "view_withdrawals",
            "view_alerts", "view_markets", "view_analytics",
            "view_system_logs",
        ],
    }
    perms = role_map.get(role, [])
    return "*" in perms or permission in perms


def require_admin_permission(*permissions: str):
    async def _dep(admin: dict = Depends(current_admin)) -> dict:
        if not permissions or any(admin_has_permission(admin, p) for p in permissions):
            return admin
        raise HTTPException(status_code=403, detail=f"Requires one of: {', '.join(permissions)}")

    return _dep
