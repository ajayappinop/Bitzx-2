"""FastAPI dependencies for the futures module.

Implemented standalone (rather than importing :mod:`server`) so the
futures package stays decoupled. We re-read the same env vars used in
``server.py`` so tokens minted there validate seamlessly here.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from services.db import get_db

# IMPORTANT: must match the defaults in :mod:`server` exactly so tokens
# minted via the spot auth endpoints validate here too.
_DEFAULT_JWT_SECRET = "ibo-dev-secret-CHANGE-IN-PRODUCTION"
_security = HTTPBearer(auto_error=False)


def _jwt_settings() -> tuple[str, str]:
    """Read JWT secret + algorithm at *call time*, not import time.

    The server only invokes ``load_dotenv()`` after this module has been
    imported — if we cached ``os.environ.get("JWT_SECRET_KEY")`` at
    module level, we'd freeze the *default* fallback and every token
    issued with the real ``.env`` secret would 403/401 here.

    Reading on each request is cheap and avoids a bootstrap-order bug.
    """
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
    """Admin JWT (typ=admin) → admin_users row. Used by /api/admin/futures/*.

    The static ``X-Admin-Key`` legacy auth is intentionally NOT supported
    here — futures admin actions are higher-risk than spot, so we require
    a real admin JWT issued by ``POST /api/admin/auth/login``.
    """
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
    """Mirror ``adminAccess.hasPermission`` from the frontend."""
    if not permission:
        return True
    perms = admin.get("permissions") or []
    if perms:
        return "*" in perms or permission in perms
    role = str(admin.get("role") or "").lower()
    role_map = {
        "superadmin": ["*"],
        "operations": ["view_dashboard", "view_users", "view_kyc", "view_orders",
                       "view_trades", "view_withdrawals", "view_markets",
                       "view_analytics", "view_alerts", "run_surveillance",
                       "view_system_logs", "view_support", "manage_support"],
        "compliance": ["view_dashboard", "view_users", "view_kyc",
                       "view_compliance", "manage_compliance",
                       "run_surveillance", "view_alerts", "view_system_logs",
                       "view_support", "manage_support"],
        "finance":    ["view_dashboard", "view_orders", "view_trades",
                       "view_withdrawals", "view_finance", "export_finance",
                       "view_treasury", "manage_treasury", "view_hedger",
                       "manage_hedger", "execute_hedger", "view_ledger",
                       "adjust_wallets", "view_alerts", "view_system_logs",
                       "view_support"],
        "support":    ["view_dashboard", "view_users", "manage_users",
                       "view_kyc", "view_orders", "view_trades",
                       "view_withdrawals", "view_alerts", "view_system_logs",
                       "view_hedger"],
        "viewer":     ["view_dashboard", "view_users", "view_kyc",
                       "view_orders", "view_trades", "view_withdrawals",
                       "view_alerts", "view_markets", "view_analytics",
                       "view_system_logs"],
    }
    perms = role_map.get(role, [])
    return "*" in perms or permission in perms


def require_admin_permission(*permissions: str):
    """FastAPI dependency factory: require *any* of the given permissions."""
    async def _dep(admin: dict = Depends(current_admin)) -> dict:
        if not permissions or any(admin_has_permission(admin, p) for p in permissions):
            return admin
        raise HTTPException(status_code=403, detail=f"Requires one of: {', '.join(permissions)}")
    return _dep


async def user_from_ws_token(token: Optional[str] = Query(None)) -> Optional[dict]:
    """Same logic as ``current_user`` but for WebSocket query-token auth."""
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
