from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, Header, File, UploadFile, Form, WebSocket, WebSocketDisconnect, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse, Response, FileResponse, HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pymongo.errors import (
    AutoReconnect,
    ConnectionFailure,
    DuplicateKeyError,
    InvalidOperation,
    ServerSelectionTimeoutError,
)
import os
import logging
import random
import contextlib
import requests
import math
import bcrypt
from jose import JWTError, jwt
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator, ValidationError, AliasChoices
from typing import List, Optional, Dict, Any, Tuple, Literal, Sequence, Set
from collections import defaultdict
import uuid
import hashlib
import secrets
import json
import re
import csv
import io
import asyncio
import time
import base64
from datetime import datetime, timezone, timedelta
import pandas as pd

from services import db as services_db
from services import wallet_service
from services import blockchain_service
from services.blockchain_service import (
    BlockchainProvider,
    ProviderUnavailable,
    UnsupportedAssetNetwork,
    normalise_network as blockchain_normalise_network,
)
from services.errors import InsufficientFundsError
from services import twofa_service, rate_limit_service
from services import treasury_service
from services import deposit_monitor_service
from services import treasury_wallets_registry as tw_registry
from services import deposit_sweep_service
from services import hedger_service
from services import alert_service
from services import compliance_service
from services import password_reset_service
from services import email_service
from services import email_templates
from services import authkey_sms
from services import sms_otp_service
from services import oauth_service as oauth_svc
from workers import deposit_poller, deposit_crediter, withdrawal_executor
from workers import hedger_worker
from workers import liquidity_retry_worker

# Futures module — fully isolated package; mounts its own router + workers.
from futures.api import router as futures_router
from futures.admin_api import router as futures_admin_router
from futures.ws import router as futures_ws_router
from futures.bootstrap import bootstrap_futures, shutdown_futures
from options.api import router as options_router
from options.admin_api import router as options_admin_router
from options.bootstrap import bootstrap_options, shutdown_options
from options.ws import router as options_ws_router

# P2P module — peer-to-peer trading with escrow, disputes, merchants.
from p2p.api import router as p2p_router
from p2p.admin_api import router as p2p_admin_router
from p2p.ws import router as p2p_ws_router

# IBO Trading Ecosystem — IBO-as-quote pairs and dedicated admin API.
from ibo.admin_api import router as ibo_admin_router
from ibo.admin_api import _register_deps as _ibo_register_deps
from listings.public_api import router as listings_public_router
from listings.public_api import register_listings_public
from listings.admin_api import router as listings_admin_router
from listings.admin_api import register_listings_admin
from inr.api import router as inr_router
from inr.admin_api import router as inr_admin_router
from inr.admin_api import register_inr_admin
import treasury_transfer_api as _treasury_transfer_api
from ibo.constants import (
    IBO_QUOTED_SYMBOL_MAP,
    IBO_QUOTED_PAIRS,
    IBO_CONTROL_DEFAULTS,
    IBO_QUOTED_QUOTE_ASSET,
    IBO_PAIR_FALLBACK_USDT,
)
from ibo import market_data as ibo_market_data
from services import binance_spot_feed as _binance_spot_feed
from services import ibo_mock_market
from services import eth_ws_listener as _eth_ws_listener
from services import mobile_app_service as mobile_app_svc
from services import signup_bonus_service as signup_bonus_svc
from services import referral_service as referral_svc
from services import admin_wallet_service as admin_wallet_svc
from services import landing_promo_service as landing_promo_svc
from services import app_home_banners_service as app_home_banners_svc
from services import ibo_fee as ibo_fee_svc

# Phase 3 — handle to the deposit-poller task (populated at startup, cancelled
# on shutdown). ``None`` when the poller is disabled or the provider isn't
# configured.
_deposit_poller_task = None
# Phase 5 — handle to the deposit-crediter task (promotes deposit_events into
# real wallet balances once they clear the confirmation threshold). ``None``
# when disabled.
_deposit_crediter_task = None
# Phase 6 — handle to the withdrawal executor (broadcasts approved withdrawals
# and polls receipts). ``None`` when disabled.
_withdrawal_executor_task = None
# Phase 8d — handle to the Binance hedger worker. ``None`` when disabled (no
# Binance credentials, kill-switch off, or HEDGER_WORKER_ENABLED != true).
_hedger_worker_task = None
_liquidity_retry_worker_task = None
# Phase 4 — periodic cleanup task for finance export artifacts. This strips
# large file payloads (csv/xlsx blobs) from old completed/failed jobs while
# keeping metadata rows for audit/history.
_finance_export_cleanup_task = None
# Optional scheduled transaction-monitoring persistence (see env COMPLIANCE_TX_MONITOR_INTERVAL_SEC).
_compliance_monitor_task = None
# Background task that proactively refreshes the CoinGecko Web3 BSC catalog.
_web3_catalog_refresh_task = None
_ibo_mock_market_enabled = False


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Source image for GET /api/token-logo (32×32 PNG). Override with TOKEN_LOGO_PATH.
TOKEN_LOGO_SOURCE = Path(
    os.environ.get("TOKEN_LOGO_PATH", str(ROOT_DIR / "assets" / "ibo_token_logo.png"))
)
_token_logo_32_png: Optional[bytes] = None


def _build_token_logo_32_png() -> bytes:
    """Load TOKEN_LOGO_SOURCE, resize to 32×32, return PNG bytes."""
    from PIL import Image

    if not TOKEN_LOGO_SOURCE.is_file():
        raise FileNotFoundError(str(TOKEN_LOGO_SOURCE))
    with Image.open(TOKEN_LOGO_SOURCE) as im:
        rgba = im.convert("RGBA")
        resample = getattr(Image, "Resampling", Image).LANCZOS
        out = rgba.resize((32, 32), resample)
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()


def _token_logo_png_response() -> Response:
    global _token_logo_32_png
    if _token_logo_32_png is None:
        try:
            _token_logo_32_png = _build_token_logo_32_png()
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Token logo file not found. Place ibo_token_logo.png in backend/assets/ "
                    "or set TOKEN_LOGO_PATH."
                ),
            )
        except Exception as exc:
            logger.exception("Failed to build token logo PNG")
            raise HTTPException(status_code=500, detail="Could not render token logo") from exc
    return Response(
        content=_token_logo_32_png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )

UPLOAD_ROOT = ROOT_DIR / "uploads"
AVATAR_DIR = UPLOAD_ROOT / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
MAX_AVATAR_BYTES = 100 * 1024 * 1024  # 100 MB
AVATAR_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

KYC_DIR = UPLOAD_ROOT / "kyc"
KYC_DIR.mkdir(parents=True, exist_ok=True)
MOBILE_APK_DIR = UPLOAD_ROOT / "mobile"
MOBILE_APK_DIR.mkdir(parents=True, exist_ok=True)
PROMO_DIR = UPLOAD_ROOT / "promo"
PROMO_DIR.mkdir(parents=True, exist_ok=True)
HOME_BANNERS_DIR = UPLOAD_ROOT / "home_banners"
HOME_BANNERS_DIR.mkdir(parents=True, exist_ok=True)
LISTINGS_DIR = UPLOAD_ROOT / "listings"
LISTINGS_DIR.mkdir(parents=True, exist_ok=True)
INR_DIR = UPLOAD_ROOT / "inr"
INR_DIR.mkdir(parents=True, exist_ok=True)
(INR_DIR / "qr").mkdir(parents=True, exist_ok=True)
(INR_DIR / "screenshots").mkdir(parents=True, exist_ok=True)
MAX_MOBILE_APK_BYTES = 200 * 1024 * 1024  # 200 MB
MAX_KYC_DOC_BYTES = 15 * 1024 * 1024  # 15 MB per file
MAX_KYC_SELFIE_BYTES = 5 * 1024 * 1024  # Signzy face-match limit
KYC_DOC_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

# KYC: default requires manual review. Set KYC_AUTO_APPROVE_ON_SUBMIT=true only for demos.
KYC_AUTO_APPROVE_ON_SUBMIT = os.environ.get(
    "KYC_AUTO_APPROVE_ON_SUBMIT", "false"
).lower() in ("1", "true", "yes")

# Create the main app
app = FastAPI(title="IBO API", version="1.0.0")


# CORS middleware must be added BEFORE routes are included
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[
        o.strip()
        for o in os.environ.get("CORS_ORIGINS", "*").split(",")
        if o.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    """422 with a short human hint for signup — common cause is password policy."""
    errs = exc.errors()
    body: Dict[str, Any] = {"detail": errs}
    if "/api/auth/register" in request.url.path:
        parts: List[str] = []
        for e in errs:
            loc = e.get("loc") or ()
            tail = " → ".join(str(x) for x in loc[-4:]) if loc else "field"
            parts.append(f"{tail}: {e.get('msg', 'invalid')}")
        body["hint"] = (
            "Use a display name of at least 2 characters, a valid email, and a password of at least 8 characters "
            "that includes uppercase, lowercase, a number, and a special character (for example ! or #). "
            + ("Problems: " + "; ".join(parts[:8]) if parts else "")
        )
    return JSONResponse(status_code=422, content=body)


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
# httpx/httpcore log full request URLs at INFO — QuickNode URLs embed auth
# tokens in the path; keep these libraries quiet unless debugging transport.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# MongoDB connection (lazy init via startup event)
client: Optional[AsyncIOMotorClient] = None
db = None

# ── JWT Configuration ─────────────────────────────────────────────────────────
_DEFAULT_JWT_SECRET = 'ibo-dev-secret-CHANGE-IN-PRODUCTION'
SECRET_KEY                  = os.environ.get('JWT_SECRET_KEY', _DEFAULT_JWT_SECRET)
ALGORITHM                   = os.environ.get('JWT_ALGORITHM', 'HS256')
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '1440'))  # 24 h

security = HTTPBearer(auto_error=False)


# ── Password helpers ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


USER_PASSWORD_MAX_LEN = 128

# Signup email verification — real OTP sent via email.
SIGNUP_PENDING_TTL_HOURS = int(os.environ.get("SIGNUP_PENDING_TTL_HOURS", "24"))
OTP_TTL_MINUTES          = int(os.environ.get("OTP_TTL_MINUTES", "15"))
OTP_MAX_ATTEMPTS         = 5   # invalidate OTP after this many wrong guesses
# Signup OTP channel: email | sms | auto (SMS when mobile + AuthKey configured)
SIGNUP_OTP_CHANNEL       = (os.environ.get("SIGNUP_OTP_CHANNEL") or "auto").strip().lower()


def mask_email_hint(email: str) -> str:
    e = (email or "").strip().lower()
    if "@" not in e:
        return (e[:3] + "***") if e else "***"
    local, _, domain = e.partition("@")
    if len(local) <= 2:
        hint = (local[0] + "***") if local else "***"
    else:
        hint = local[:2] + "***"
    return f"{hint}@{domain}"


def _phone_e164(country_code: str, national: str) -> str:
    cc = re.sub(r"\D", "", country_code or "") or authkey_sms.default_country_code()
    nat = re.sub(r"\D", "", national or "")
    return f"+{cc}{nat}"


def _signup_uses_sms(creds: "SignupCredentials", controls: Optional[Dict[str, Any]] = None) -> bool:
    mobile = (getattr(creds, "mobile", None) or "").strip()
    ch = SIGNUP_OTP_CHANNEL
    if ch == "email":
        return False
    if ch == "sms":
        if not mobile:
            raise HTTPException(status_code=422, detail="Mobile number is required for SMS verification.")
        if not sms_otp_service.sms_available(controls):
            raise HTTPException(status_code=503, detail="SMS verification is not configured.")
        return True
    if mobile:
        if not sms_otp_service.sms_available(controls):
            raise HTTPException(
                status_code=503,
                detail="SMS verification is not configured. Remove the phone number or contact support.",
            )
        return True
    return False


def validate_strong_user_password_value(password: str) -> str:
    """Return password if policy passes (signup / password change). Raises ValueError for Pydantic."""
    pw = password or ""
    # Temporary: AUTH_RELAXED=1 accepts any non-empty password (dev only).
    # Default is strict strength policy for production-like signups.
    relaxed = os.environ.get("AUTH_RELAXED", "0").strip().lower() in ("1", "true", "yes", "on")
    if relaxed:
        if not pw:
            raise ValueError("Password is required")
        if len(pw) > USER_PASSWORD_MAX_LEN:
            raise ValueError(f"Password must be {USER_PASSWORD_MAX_LEN} characters or less")
        return pw
    if len(pw) < 8:
        raise ValueError("Password must be at least 8 characters")
    if len(pw) > USER_PASSWORD_MAX_LEN:
        raise ValueError(f"Password must be {USER_PASSWORD_MAX_LEN} characters or less")
    if not re.search(r"[a-z]", pw):
        raise ValueError("Password must include at least one lowercase letter")
    if not re.search(r"[A-Z]", pw):
        raise ValueError("Password must include at least one uppercase letter")
    if not re.search(r"\d", pw):
        raise ValueError("Password must include at least one number")
    if not re.search(r"[^A-Za-z0-9]", pw):
        raise ValueError("Password must include at least one special character")
    return pw


# ── Token helpers ─────────────────────────────────────────────────────────────

# Phase 7b — refresh-token settings. The access token stays short-lived
# (``ACCESS_TOKEN_EXPIRE_MINUTES``) and the refresh token lives 30 days by
# default. Rotation is one-shot: every call to ``/auth/refresh`` mints a
# NEW refresh jti and invalidates the previous one. ``sessions_epoch`` is
# a per-user counter bumped by "logout everywhere" — any token whose
# ``epoch`` doesn't match the user's current epoch is rejected, even if
# its ``exp`` is still in the future.
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "30"))


def create_access_token(
    data: dict,
    *,
    expire_minutes: Optional[int] = None,
    sessions_epoch: Optional[int] = None,
) -> str:
    payload = data.copy()
    mins = ACCESS_TOKEN_EXPIRE_MINUTES if expire_minutes is None else expire_minutes
    payload['exp'] = datetime.now(timezone.utc) + timedelta(minutes=mins)
    payload['typ'] = payload.get('typ') or 'access'
    if sessions_epoch is not None:
        payload['epoch'] = int(sessions_epoch)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _create_refresh_token(uid: str, email: str, sessions_epoch: int) -> Tuple[str, str, datetime]:
    """Mint a refresh JWT + return ``(token, jti, expires_at)``.

    The jti is persisted in ``refresh_tokens`` by the caller so we can
    detect replay (deleted jti → token is considered revoked). ``epoch``
    lets ``/auth/sessions/revoke-all`` invalidate every outstanding
    refresh + access token in one shot.
    """
    jti = f"rt_{uuid.uuid4().hex}"
    exp = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub":   uid,
        "email": email,
        "typ":   "refresh",
        "jti":   jti,
        "epoch": int(sessions_epoch),
        "exp":   exp,
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token, jti, exp


async def _issue_token_pair(user: dict) -> Tuple[str, str]:
    """Issue a fresh (access, refresh) pair for ``user``, persisting the jti.

    Callers pass the Mongo user doc. Returns both tokens; the refresh jti
    is stored in ``db.refresh_tokens`` so it can be rotated / revoked.
    """
    epoch = int(user.get("sessions_epoch") or 0)
    access = create_access_token(
        {"sub": user["uid"], "email": user["email"]},
        sessions_epoch=epoch,
    )
    refresh, jti, exp = _create_refresh_token(user["uid"], user["email"], epoch)
    if db is not None:
        try:
            await db.refresh_tokens.insert_one({
                "jti":        jti,
                "uid":        user["uid"],
                "epoch":      epoch,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": exp,
            })
        except Exception:  # noqa: BLE001
            logger.exception("refresh_tokens insert failed for %s", user.get("uid"))
    return access, refresh


ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES", "480"))


class AdminAuthContext:
    __slots__ = ("admin", "via_api_key")

    def __init__(self, admin: Optional[dict], via_api_key: bool):
        self.admin = admin
        self.via_api_key = via_api_key


def create_admin_access_token(aid: str, email: str, role: str) -> str:
    payload = {
        "sub": aid,
        "email": email,
        "role": role,
        "typ": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


async def log_admin_audit(
    auth: AdminAuthContext,
    action: str,
    target_type: str = "",
    target_id: str = "",
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    if db is None:
        return
    aid = (auth.admin or {}).get("aid") if auth.admin else None
    em = (auth.admin or {}).get("email") if auth.admin else None
    src = "api_key" if auth.via_api_key else "jwt"
    last = await db.admin_audit_logs.find_one(
        {},
        {"_id": 0, "chain_hash": 1},
        sort=[("created_at", -1)],
    )
    prev_hash = (last or {}).get("chain_hash") or ""
    row_body = {
        "admin_aid":    aid,
        "admin_email":  em,
        "source":       src,
        "action":       action,
        "target_type":  target_type,
        "target_id":    target_id,
        "extra":        extra or {},
        "created_at":   datetime.now(timezone.utc).isoformat(),
    }
    canon = json.dumps(row_body, sort_keys=True, default=str)
    chain_hash = hashlib.sha256((prev_hash + "|" + canon).encode("utf-8")).hexdigest()
    await db.admin_audit_logs.insert_one({
        "id":           f"aud_{uuid.uuid4().hex[:16]}",
        **row_body,
        "prev_chain_hash": prev_hash or None,
        "chain_hash":      chain_hash,
    })


_admin_api_key_deprecation_warned = False


def _env_flag_true(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes", "on")


def _warn_admin_api_key_deprecation_once() -> None:
    global _admin_api_key_deprecation_warned
    if _admin_api_key_deprecation_warned:
        return
    _admin_api_key_deprecation_warned = True
    logger.warning(
        "DEPRECATED: X-Admin-Key / ADMIN_API_KEY was used. Prefer admin JWT from "
        "POST /api/admin/auth/login; set DISABLE_ADMIN_API_KEY=true in production "
        "after migrating callers; rotate ADMIN_API_KEY regularly."
    )


async def resolve_admin_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
) -> AdminAuthContext:
    """Accept legacy X-Admin-Key or Bearer JWT with typ=admin (from /api/admin/auth/login)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    expected = os.environ.get("ADMIN_API_KEY", "").strip()
    if expected and x_admin_key == expected and _env_flag_true("DISABLE_ADMIN_API_KEY"):
        raise HTTPException(
            status_code=403,
            detail="X-Admin-Key authentication is disabled (DISABLE_ADMIN_API_KEY). Use an admin JWT.",
        )
    if expected and x_admin_key == expected:
        _warn_admin_api_key_deprecation_once()
        return AdminAuthContext(admin=None, via_api_key=True)
    if credentials and credentials.credentials:
        try:
            payload = jwt.decode(
                credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM]
            )
            if payload.get("typ") == "admin":
                aid = payload.get("sub")
                if aid:
                    admin_doc = await db.admin_users.find_one(
                        {"aid": aid, "is_active": True},
                        {"_id": 0, "password_hash": 0},
                    )
                    if admin_doc:
                        return AdminAuthContext(admin=admin_doc, via_api_key=False)
        except JWTError:
            pass
    raise HTTPException(status_code=403, detail="Admin access required")


def _admin_effective_role(auth: AdminAuthContext) -> str:
    if auth.via_api_key:
        return "superadmin"
    return str((auth.admin or {}).get("role") or "support").lower()


def _require_admin_jwt_not_apikey(auth: AdminAuthContext) -> None:
    """Sensitive ops must not be callable with the static X-Admin-Key."""
    if auth.via_api_key or not auth.admin:
        raise HTTPException(
            status_code=403,
            detail="This action requires an admin JWT (API key is not allowed).",
        )


def _require_privileged_ops_admin(auth: AdminAuthContext) -> None:
    """Freeze / withdrawal hold / 2FA reset / forced logout / password-reset email."""
    _require_admin_jwt_not_apikey(auth)
    if _admin_effective_role(auth) not in ("superadmin", "finance"):
        raise HTTPException(
            status_code=403,
            detail="Superadmin or finance role required for this action.",
        )


ROLE_PERMISSIONS: Dict[str, List[str]] = {
    "superadmin": ["*"],
    "operations": [
        "view_dashboard", "view_users", "view_kyc",
        "view_orders", "view_trades", "view_withdrawals",
        "view_markets", "view_analytics", "view_alerts",
        "run_surveillance", "view_system_logs", "view_support", "manage_support",
        "view_listings", "manage_listings",
    ],
    "compliance": [
        "view_dashboard", "view_users", "view_kyc",
        "view_compliance", "manage_compliance",
        "run_surveillance", "view_alerts", "view_system_logs",
    ],
    "finance": [
        "view_dashboard",
        "view_orders", "view_trades", "view_security", "manage_security_blocks",
        "view_system_logs", "run_surveillance", "view_compliance", "manage_compliance",
        "view_finance", "export_finance", "view_treasury", "manage_treasury", "view_hedger", "manage_hedger", "execute_hedger",
        "view_ledger", "adjust_wallets",
    ],
    "support": [
        "view_dashboard", "view_users", "manage_users", "view_kyc",
        "view_orders", "view_trades", "view_withdrawals",
        "view_security", "view_system_logs", "view_alerts",
        "view_support", "manage_support",
    ],
    "viewer": [
        "view_dashboard", "view_users", "view_kyc",
        "view_orders", "view_trades", "view_withdrawals",
        "view_alerts", "view_markets", "view_analytics", "view_system_logs", "view_hedger",
    ],
}


def _admin_permissions(auth: AdminAuthContext) -> List[str]:
    if auth.via_api_key:
        return ["*"]
    row = auth.admin or {}
    perms = row.get("permissions")
    if isinstance(perms, list) and perms:
        return [str(p).strip() for p in perms if str(p).strip()]
    role = _admin_effective_role(auth)
    return list(ROLE_PERMISSIONS.get(role, []))


def _require_admin_permission(auth: AdminAuthContext, permission: str) -> None:
    perms = _admin_permissions(auth)
    if "*" in perms or permission in perms:
        return
    raise HTTPException(status_code=403, detail=f"Missing admin permission: {permission}")


def _require_admin_permission_any(auth: AdminAuthContext, permissions: Sequence[str]) -> None:
    perms = _admin_permissions(auth)
    if "*" in perms:
        return
    for p in permissions:
        if p in perms:
            return
    joined = ", ".join(sorted(set(permissions)))
    raise HTTPException(status_code=403, detail=f"Missing one of admin permissions: {joined}")


def _require_wallet_adjust_permission(auth: AdminAuthContext) -> None:
    """Manual wallet credits/debits and adjustment history (least-privilege: ``adjust_wallets`` or legacy ``manage_users``)."""
    _require_admin_permission_any(auth, ("manage_users", "adjust_wallets"))


async def _log_security_event(
    *,
    event_type: str,
    severity: str = "info",
    source: str = "auth",
    message: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    if db is None:
        return
    try:
        await db.security_events.insert_one({
            "id": f"sec_{uuid.uuid4().hex[:16]}",
            "type": str(event_type or "").strip(),
            "severity": str(severity or "info").strip().lower(),
            "source": str(source or "auth").strip().lower(),
            "message": str(message or "").strip()[:500],
            "meta": meta or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        logger.exception("security_event insert failed type=%s", event_type)


async def _cleanup_finance_export_artifacts_once() -> int:
    """Remove heavy export payloads from old finance export jobs."""
    if db is None:
        return 0
    try:
        retention_hours = max(1, int(os.environ.get("FINANCE_EXPORT_RETENTION_HOURS", "72")))
    except ValueError:
        retention_hours = 72
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=retention_hours)).isoformat()
    res = await db.finance_export_jobs.update_many(
        {
            "status": {"$in": ["completed", "failed"]},
            "completed_at": {"$lte": cutoff},
            "$or": [
                {"file_data_b64": {"$exists": True}},
                {"csv_data": {"$exists": True}},  # backward compatibility
            ],
        },
        {
            "$unset": {"file_data_b64": "", "csv_data": ""},
            "$set": {"artifact_purged_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    return int(getattr(res, "modified_count", 0) or 0)


async def _finance_export_cleanup_loop() -> None:
    """Background sweeper that trims old export blobs on a fixed cadence."""
    try:
        interval_sec = max(60, int(os.environ.get("FINANCE_EXPORT_CLEANUP_INTERVAL_SEC", "600")))
    except ValueError:
        interval_sec = 600
    logger.info(
        "finance export cleanup loop started (interval=%ss, retention=%sh)",
        interval_sec,
        os.environ.get("FINANCE_EXPORT_RETENTION_HOURS", "72"),
    )
    try:
        while True:
            try:
                n = await _cleanup_finance_export_artifacts_once()
                if n:
                    logger.info("finance export cleanup purged artifacts from %d job(s)", n)
            except Exception:
                logger.exception("finance export cleanup iteration failed")
            await asyncio.sleep(interval_sec)
    except asyncio.CancelledError:
        logger.info("finance export cleanup loop stopped")
        raise


async def _is_request_security_blocked(request: Request) -> Optional[Dict[str, Any]]:
    """Check active IP/country security blocks (login-facing guard)."""
    if db is None:
        return None
    ip = rate_limit_service.client_ip_from_request(request)
    country = (
        request.headers.get("cf-ipcountry")
        or request.headers.get("x-country")
        or request.headers.get("x-geo-country")
        or ""
    ).strip().upper()
    clauses: List[Dict[str, Any]] = [{"type": "ip", "value": ip}]
    if country:
        clauses.append({"type": "country", "value": country})
    if not clauses:
        return None
    row = await db.security_blocks.find_one({
        "is_active": True,
        "$or": clauses,
    }, {"_id": 0})
    return row


# ── Admin WebSocket: live positions (one DB compute per filter-group per tick)
_live_pos_ws_lock = asyncio.Lock()
_live_pos_ws_subs: List[Dict[str, Any]] = []
_live_pos_ws_broadcast_task: Optional[asyncio.Task] = None

_user_pos_ws_lock = asyncio.Lock()
_user_pos_ws_subs: List[Dict[str, Any]] = []
_user_pos_ws_broadcast_task: Optional[asyncio.Task] = None


def _ws_client_gone_error(exc: BaseException) -> bool:
    """
    True when the peer closed the socket before we finished sending.
    Common if the browser navigates away while a slow snapshot (e.g. build_user_positions) runs.
    Starlette often surfaces this as websockets.ConnectionClosedError, not WebSocketDisconnect.
    """
    if isinstance(exc, WebSocketDisconnect):
        return True
    cls_name = exc.__class__.__name__
    if cls_name == "ConnectionClosedError":
        return True
    if cls_name == "ConnectionClosedOK":
        return True
    return cls_name == "ClientDisconnected"


# Admin WS: market tickers (one Binance batch per tick for all subscribers)
_markets_tickers_ws_lock = asyncio.Lock()
_markets_tickers_ws_subs: List[WebSocket] = []
_markets_tickers_ws_broadcast_task: Optional[asyncio.Task] = None

# Admin WS: klines grouped by (symbol, interval, limit)
_klines_ws_lock = asyncio.Lock()
_klines_ws_subs: List[Dict[str, Any]] = []
_klines_ws_broadcast_task: Optional[asyncio.Task] = None

# Admin WS: recent trades (same grouping as live positions)
_recent_trades_ws_lock = asyncio.Lock()
_recent_trades_ws_subs: List[Dict[str, Any]] = []
_recent_trades_ws_broadcast_task: Optional[asyncio.Task] = None

# Admin WS: dashboard stats overview (single payload for all subscribers)
_stats_overview_ws_lock = asyncio.Lock()
_stats_overview_ws_subs: List[WebSocket] = []
_stats_overview_ws_broadcast_task: Optional[asyncio.Task] = None


async def _exchange_user_from_ws_token(token: Optional[str]) -> Optional[dict]:
    """Validate end-user JWT for exchange WebSockets (not admin tokens)."""
    if not token or db is None:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") == "admin":
            return None
        uid = payload.get("sub")
        if not uid:
            return None
        user = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
        if not user:
            return None
        controls = await get_platform_controls()
        if controls.get("maintenance_mode", False):
            return None
        return user
    except JWTError:
        return None


async def _admin_doc_from_ws_auth(
    token: Optional[str],
    x_admin_key: Optional[str],
) -> Optional[dict]:
    if db is None:
        return None
    expected = os.environ.get("ADMIN_API_KEY", "").strip()
    if expected and x_admin_key == expected:
        if _env_flag_true("DISABLE_ADMIN_API_KEY"):
            return None
        _warn_admin_api_key_deprecation_once()
        return {"aid": "api_key", "email": "api_key", "role": "superadmin", "is_active": True}
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "admin":
            return None
        aid = payload.get("sub")
        if not aid:
            return None
        return await db.admin_users.find_one(
            {"aid": aid, "is_active": True},
            {"_id": 0, "password_hash": 0},
        )
    except JWTError:
        return None


def _admin_sort_sign(direction: Optional[str]) -> int:
    return 1 if (direction or "").strip().lower() == "asc" else -1


def _admin_sort_mongo_field(sort_by: Optional[str], mapping: Dict[str, str], default_field: str) -> str:
    k = (sort_by or "").strip().lower()
    return mapping.get(k, default_field)


def _apply_live_position_row_sort(
    rows: List[Dict[str, Any]],
    sort_by: Optional[str],
    sort_dir: Optional[str],
) -> None:
    m = {
        "market_value": "market_value_usdt",
        "market_value_usdt": "market_value_usdt",
        "unrealized_pnl": "unrealized_pnl",
        "pnl": "unrealized_pnl",
        "symbol": "symbol",
        "amount": "amount",
        "uid": "uid",
    }
    field = _admin_sort_mongo_field(sort_by, m, "market_value_usdt")
    reverse = _admin_sort_sign(sort_dir) == -1

    def keyfn(r: Dict[str, Any]):
        v = r.get(field)
        if field in ("symbol", "uid"):
            return str(v or "").lower()
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    rows.sort(key=keyfn, reverse=reverse)


_MAX_ADMIN_LIVE_POS_USERS = 48
_MAX_ADMIN_LIVE_POS_CONCURRENCY = 8


async def _compute_admin_live_position_rows(
    uid: Optional[str],
    q: Optional[str],
    symbol: Optional[str],
    asset: Optional[str],
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Full sorted position rows for admin live view (no pagination)."""
    user_filter: Dict[str, Any] = {}
    if uid:
        user_filter["uid"] = uid.strip()
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        user_filter["$or"] = [{"uid": rx}, {"email": rx}, {"name": rx}]
    if user_filter:
        users = await db.users.find(
            user_filter,
            {"_id": 0, "uid": 1, "name": 1, "email": 1},
        ).limit(_MAX_ADMIN_LIVE_POS_USERS).to_list(_MAX_ADMIN_LIVE_POS_USERS)
    else:
        wrows = await db.wallets.aggregate([
            {"$match": {"$or": [{"available": {"$gt": 0}}, {"locked": {"$gt": 0}}]}},
            {"$group": {"_id": "$uid"}},
            {"$limit": _MAX_ADMIN_LIVE_POS_USERS},
        ]).to_list(_MAX_ADMIN_LIVE_POS_USERS)
        uids_only = [r["_id"] for r in wrows if r.get("_id")]
        if not uids_only:
            users = []
        else:
            users = await db.users.find(
                {"uid": {"$in": uids_only}},
                {"_id": 0, "uid": 1, "name": 1, "email": 1},
            ).to_list(len(uids_only))
    wanted_symbol = symbol.strip().upper() if symbol else ""
    wanted_asset = asset.strip().upper() if asset else ""
    rows: List[Dict[str, Any]] = []
    sem = asyncio.Semaphore(_MAX_ADMIN_LIVE_POS_CONCURRENCY)

    async def _positions_for(u: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        async with sem:
            return u, await build_user_positions(u["uid"])

    pairs = await asyncio.gather(*[_positions_for(u) for u in users])
    for u, p in pairs:
        for pos in p:
            if wanted_symbol and pos.get("symbol") != wanted_symbol:
                continue
            if wanted_asset and pos.get("asset") != wanted_asset:
                continue
            rows.append({
                **pos,
                "uid": u["uid"],
                "user_name": u.get("name") or "",
                "user_email": u.get("email") or "",
            })
    _apply_live_position_row_sort(rows, sort_by, sort_dir)
    return rows


def _live_positions_payload_from_rows(
    rows: List[Dict[str, Any]],
    skip: int,
    limit: int,
) -> Dict[str, Any]:
    total = len(rows)
    paged = rows[skip: skip + limit]
    return {
        "type": "live_positions",
        "items": paged,
        "total": total,
        "skip": skip,
        "limit": limit,
        "stats": {
            "market_value_usdt_total": round(sum(float(r.get("market_value_usdt", 0.0)) for r in rows), 4),
            "unrealized_pnl_total": round(sum(float(r.get("unrealized_pnl", 0.0)) for r in rows), 4),
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


async def _live_positions_ws_broadcast_loop():
    global _live_pos_ws_broadcast_task
    try:
        while True:
            await asyncio.sleep(2)
            async with _live_pos_ws_lock:
                if not _live_pos_ws_subs:
                    break
                snapshot = list(_live_pos_ws_subs)
            groups: Dict[tuple, List[Dict[str, Any]]] = defaultdict(list)
            for s in snapshot:
                key = (s["uid"], s["q"], s["symbol"], s["asset"], s.get("sort_by"), s.get("sort_dir"))
                groups[key].append(s)
            for key, group in groups.items():
                uid_f, q_f, sym_f, ast_f, sb, sd = key
                try:
                    rows = await _compute_admin_live_position_rows(uid_f, q_f, sym_f, ast_f, sb, sd)
                except Exception as e:
                    logger.exception("live_positions ws compute failed: %s", e)
                    continue
                for s in group:
                    payload = _live_positions_payload_from_rows(rows, s["skip"], s["limit"])
                    try:
                        await s["websocket"].send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _live_pos_ws_lock:
            _live_pos_ws_broadcast_task = None


async def _ensure_live_positions_ws_broadcaster():
    global _live_pos_ws_broadcast_task
    async with _live_pos_ws_lock:
        if _live_pos_ws_broadcast_task is None or _live_pos_ws_broadcast_task.done():
            _live_pos_ws_broadcast_task = asyncio.create_task(_live_positions_ws_broadcast_loop())


async def _user_positions_ws_broadcast_loop():
    global _user_pos_ws_broadcast_task
    try:
        while True:
            await asyncio.sleep(2)
            async with _user_pos_ws_lock:
                if not _user_pos_ws_subs:
                    break
                by_uid: Dict[str, List[WebSocket]] = defaultdict(list)
                for s in _user_pos_ws_subs:
                    by_uid[s["uid"]].append(s["websocket"])
            for uid, wss in by_uid.items():
                try:
                    user = await db.users.find_one({"uid": uid}, {"_id": 0, "uid": 1, "name": 1, "email": 1})
                    if not user:
                        continue
                    positions = await build_user_positions(uid)
                    payload = {
                        "type": "user_live_positions",
                        "uid": uid,
                        "user_name": user.get("name") or "",
                        "user_email": user.get("email") or "",
                        "positions": positions,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                    for ws in wss:
                        try:
                            await ws.send_json(payload)
                        except Exception:
                            pass
                except Exception as e:
                    logger.exception("user positions ws failed for %s: %s", uid, e)
    finally:
        async with _user_pos_ws_lock:
            _user_pos_ws_broadcast_task = None


async def _ensure_user_positions_ws_broadcaster():
    global _user_pos_ws_broadcast_task
    async with _user_pos_ws_lock:
        if _user_pos_ws_broadcast_task is None or _user_pos_ws_broadcast_task.done():
            _user_pos_ws_broadcast_task = asyncio.create_task(_user_positions_ws_broadcast_loop())


async def _markets_tickers_ws_broadcast_loop():
    global _markets_tickers_ws_broadcast_task
    try:
        while True:
            await asyncio.sleep(5)
            async with _markets_tickers_ws_lock:
                if not _markets_tickers_ws_subs:
                    break
                snapshot = list(_markets_tickers_ws_subs)
            try:
                rows = await _trading_markets_snapshot()
            except Exception as e:
                logger.exception("markets tickers ws: %s", e)
                continue
            payload = {
                "type": "markets_tickers",
                "markets": rows,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            for ws in snapshot:
                try:
                    await ws.send_json(payload)
                except Exception:
                    pass
    finally:
        async with _markets_tickers_ws_lock:
            _markets_tickers_ws_broadcast_task = None


async def _ensure_markets_tickers_ws_broadcaster():
    global _markets_tickers_ws_broadcast_task
    async with _markets_tickers_ws_lock:
        if _markets_tickers_ws_broadcast_task is None or _markets_tickers_ws_broadcast_task.done():
            _markets_tickers_ws_broadcast_task = asyncio.create_task(_markets_tickers_ws_broadcast_loop())


async def _klines_ws_broadcast_loop():
    global _klines_ws_broadcast_task
    try:
        while True:
            await asyncio.sleep(5)
            async with _klines_ws_lock:
                if not _klines_ws_subs:
                    break
                subs = list(_klines_ws_subs)
            groups: Dict[tuple, List[WebSocket]] = defaultdict(list)
            for s in subs:
                key = (s["symbol"], s["interval"], s["limit"])
                groups[key].append(s["websocket"])
            for (sym, iv, lim), wss in groups.items():
                try:
                    klines = await _trading_klines_snapshot(sym, iv, lim)
                except Exception as e:
                    logger.exception("klines ws %s %s: %s", sym, iv, e)
                    continue
                payload = {
                    "type": "trading_klines",
                    "symbol": sym,
                    "interval": iv,
                    "limit": lim,
                    "klines": klines,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                for ws in wss:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _klines_ws_lock:
            _klines_ws_broadcast_task = None


async def _ensure_klines_ws_broadcaster():
    global _klines_ws_broadcast_task
    async with _klines_ws_lock:
        if _klines_ws_broadcast_task is None or _klines_ws_broadcast_task.done():
            _klines_ws_broadcast_task = asyncio.create_task(_klines_ws_broadcast_loop())


async def _recent_trades_ws_broadcast_loop():
    global _recent_trades_ws_broadcast_task
    try:
        while True:
            await asyncio.sleep(4)
            async with _recent_trades_ws_lock:
                if not _recent_trades_ws_subs:
                    break
                snapshot = list(_recent_trades_ws_subs)
            groups: Dict[tuple, List[Dict[str, Any]]] = defaultdict(list)
            for s in snapshot:
                key = (
                    s["symbol"],
                    s["uid"],
                    s.get("liquidity_source"),
                    s["date_from"],
                    s["date_to"],
                    s["skip"],
                    s["limit"],
                    s.get("sort_by"),
                    s.get("sort_dir"),
                )
                groups[key].append(s)
            for key, group in groups.items():
                sym_f, uid_f, liq_f, df_f, dt_f, sk, lm, sb, sd = key
                try:
                    payload = await _admin_recent_trades_payload(sym_f, uid_f, liq_f, df_f, dt_f, sk, lm, sb, sd)
                except Exception as e:
                    logger.exception("recent trades ws: %s", e)
                    continue
                payload["type"] = "recent_trades"
                for s in group:
                    try:
                        await s["websocket"].send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _recent_trades_ws_lock:
            _recent_trades_ws_broadcast_task = None


async def _ensure_recent_trades_ws_broadcaster():
    global _recent_trades_ws_broadcast_task
    async with _recent_trades_ws_lock:
        if _recent_trades_ws_broadcast_task is None or _recent_trades_ws_broadcast_task.done():
            _recent_trades_ws_broadcast_task = asyncio.create_task(_recent_trades_ws_broadcast_loop())


async def _stats_overview_ws_broadcast_loop():
    global _stats_overview_ws_broadcast_task
    try:
        while True:
            await asyncio.sleep(8)
            async with _stats_overview_ws_lock:
                if not _stats_overview_ws_subs:
                    break
                wss = list(_stats_overview_ws_subs)
            if db is None:
                continue
            try:
                stats = await _compute_admin_stats_overview()
            except Exception as e:
                logger.exception("stats overview ws: %s", e)
                continue
            payload = {
                "type": "stats_overview",
                "stats": stats,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            for ws in wss:
                try:
                    await ws.send_json(payload)
                except Exception:
                    pass
    finally:
        async with _stats_overview_ws_lock:
            _stats_overview_ws_broadcast_task = None


async def _ensure_stats_overview_ws_broadcaster():
    global _stats_overview_ws_broadcast_task
    async with _stats_overview_ws_lock:
        if _stats_overview_ws_broadcast_task is None or _stats_overview_ws_broadcast_task.done():
            _stats_overview_ws_broadcast_task = asyncio.create_task(_stats_overview_ws_broadcast_loop())


async def seed_wallet(uid: str):
    """Ensure IBO wallet row exists; dispatch on-chain signup bonus when configured."""
    bonus_ibo = await get_signup_bonus_ibo()
    now = datetime.now(timezone.utc).isoformat()

    existing = await db.wallets.find_one(
        {"uid": uid, "asset": "IBO"},
        {"_id": 0, "available": 1},
    )
    if existing is None:
        await db.wallets.update_one(
            {"uid": uid, "asset": "IBO"},
            {"$setOnInsert": {
                "uid": uid, "asset": "IBO",
                "available": 0.0, "locked": 0.0,
                "created_at": now, "updated_at": now,
            }},
            upsert=True,
        )

    if bonus_ibo > 0:
        import asyncio as _asyncio

        async def _dispatch() -> None:
            try:
                await signup_bonus_svc.dispatch_on_chain_signup_bonus(
                    db,
                    uid,
                    bonus_ibo,
                    get_or_create_address=_get_or_create_user_deposit_address,
                )
            except Exception:  # noqa: BLE001
                logger.exception("signup_bonus: background dispatch failed uid=%s", uid)

        _asyncio.create_task(_dispatch())


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:
    """Dependency — validates Bearer JWT and returns the user document (no password_hash)."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        uid: str = payload.get("sub")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        # Access tokens only — refresh tokens live on a separate endpoint
        # so mixing the two (accidental or malicious) is a hard 401.
        tok_typ = payload.get("typ") or "access"
        if tok_typ != "access":
            raise HTTPException(status_code=401, detail="Wrong token type")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token invalid or expired")

    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Phase 7b — honour ``sessions_epoch``. Tokens minted before the user
    # clicked "Log out of all devices" / changed their password carry an
    # older epoch and are force-expired here regardless of ``exp``.
    # Admin impersonation tokens (``imp=true``) bypass epoch so support can
    # still inspect an account after a forced logout.
    user_epoch = int(user.get("sessions_epoch") or 0)
    tok_epoch = int(payload.get("epoch") or 0)
    if not payload.get("imp") and user_epoch and tok_epoch != user_epoch:
        raise HTTPException(status_code=401, detail="Session revoked — please sign in again.")

    controls = await get_platform_controls()
    if controls.get("maintenance_mode", False):
        raise HTTPException(status_code=503, detail="Platform is temporarily paused by admin")
    return user


def _reject_if_impersonating(
    credentials: Optional[HTTPAuthorizationCredentials],
    *,
    action: str = "This action",
) -> None:
    """Block account/session mutations during admin impersonation.

    Impersonation tokens are read-only support views — they must never bump
    ``sessions_epoch``, revoke refresh tokens, or change security settings.
    The real user's login session stays untouched and invisible to them.
    """
    if not credentials:
        return
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("imp"):
            raise HTTPException(
                status_code=403,
                detail=f"{action} is not available during a support impersonation session.",
            )
    except JWTError:
        return


# ── Platform controls (runtime feature flags) ────────────────────────────────

# Env fallback until admin sets platform_controls.signup_bonus_ibo in the panel.
# SIGNUP_BONUS_USDT is accepted as a legacy env alias (same numeric amount, now IBO).
_SIGNUP_BONUS_IBO_ENV = float(
    os.environ.get("SIGNUP_BONUS_IBO")
    or os.environ.get("SIGNUP_BONUS_USDT")
    or "0"
)

PLATFORM_CONTROL_DEFAULTS: Dict[str, Any] = {
    # When True the entire exchange shows the Coming Soon page (no login, no trading).
    "coming_soon_enabled": False,
    "coming_soon_message": "",   # Optional custom message shown on the coming soon page
    "coming_soon_launch_date": "",  # Optional ISO date string shown as countdown target
    "maintenance_mode": False,
    "signup_enabled":   True,
    "login_enabled":    True,
    # When True, signup/profile SMS OTP uses sms_dev_otp_code instead of AuthKey (dev/staging).
    "sms_dev_otp_enabled": os.environ.get("SMS_DEV_OTP_ENABLED", "").lower() in ("1", "true", "yes"),
    "sms_dev_otp_code": sms_otp_service.normalize_dev_otp_code(os.environ.get("SMS_DEV_OTP_CODE", "123456")),
    # Service-level controls for OTP channels during signup.
    # When email_otp_service_enabled=False, email OTP verification is skipped during
    # registration and the email is accepted without OTP. Users can verify later.
    # When sms_otp_service_enabled=False, the phone number step is skipped entirely
    # during registration; users can add/verify their mobile from the Profile page.
    "email_otp_service_enabled": True,
    "sms_otp_service_enabled": True,
    # IBO credited on-chain to the user's deposit address after signup; crediter
    # holds balance until KYC when credit_requires_kyc_approval is true.
    "signup_bonus_ibo": _SIGNUP_BONUS_IBO_ENV,
    "trading_enabled":  True,
    "kyc_enabled":      True,
    # KYC verification mode: "manual" (admin reviews docs), "auto" (Signzy DigiLocker),
    # or "disabled" (KYC submissions blocked regardless of kyc_enabled).
    "kyc_mode": "manual",
    # Bank account verification mode: "auto" (Signzy penny-drop API, default),
    # "manual" (admin reviews; no API call), or "disabled" (no verification at all).
    "bank_verify_mode": "auto",
    "wallet_enabled":   True,
    "profile_enabled":  True,
    "maker_fee_rate":   0.001,
    "taker_fee_rate":   0.001,
    "withdraw_fee_rate": 0.0,
    "withdraw_min_usdt": 0.0,
    "withdraw_max_usdt": 0.0,
    "withdraw_daily_limit_usdt": 0.0,
    # Fixed / per-chain IBO gas fee per withdrawal (deducted from user's IBO).
    # Real chain gas (BNB / ETH / TRX) is paid by the treasury hot wallet.
    # Values come only from admin panel — 0 means no IBO gas fee (no silent defaults).
    "withdraw_gas_fee_ibo": 0.0,
    # Optional overrides: { "bsc": 2, "eth": 15, "tron": 1, ... }
    "withdraw_gas_fee_ibo_by_chain": {},
    # Exchange mobile app CTA: "google_play" (Play Store link) or "direct_apk" (server APK).
    "mobile_app_distribution": "direct_apk",
    "mobile_app_google_play_url": "",
    # IBO ↔ USDT wallet swap — platform charge (IBO), separate from spot taker/maker.
    # swap_fee_rate: fraction of swap USDT notional. swap_fee_ibo_fixed: flat IBO per swap.
    "swap_fee_rate": 0.001,
    "swap_fee_ibo_fixed": 0.0,
    # Phase 2 — new controls (all default to a "no behaviour change" value so
    # turning them on is an explicit admin decision in later phases).
    # Phase 5 — when > 0, withdrawals whose USDT notional is <= this value
    # can be auto-approved by the executor. 0 = disabled (manual only).
    "withdrawal_auto_approve_limit_usdt": 0.0,
    # Phase 4 — minimum on-chain confirmations required before a pending
    # deposit is auto-credited. 0 = use the asset-specific built-in default.
    "deposit_min_confirmations": 0,
    # Phase 5 — per-asset overrides for the confirmation threshold. Keys must
    # be uppercase asset symbols ("BTC", "ETH", "USDT"). Missing entries fall
    # back to ``deposit_min_confirmations`` (when > 0) and finally to the
    # built-in defaults in ``DEPOSIT_CONFIRMATION_DEFAULTS``.
    "deposit_min_confirmations_by_asset": {},
    # Phase 5 — when True (default), the deposit crediter leaves events in
    # ``pending_kyc`` instead of crediting wallets until the user's
    # ``kyc_status`` is ``approved``. Admins can still manually credit via
    # the override endpoint.
    "credit_requires_kyc_approval":       True,
    # Phase 4/5/6 — master switches (disabled by default so Phase 1/2 deploys
    # stay purely manual / existing behaviour).
    "deposit_auto_credit_enabled":        False,
    # Admin-panel toggle for live deposit sweeps (same effect as the server env
    # var DEPOSIT_SWEEP_LIVE_ENABLED=true). When either the env var OR this flag
    # is True, "confirm_live=true" sweeps will broadcast real on-chain txs.
    # Defaults to False — admin must explicitly enable before running a live sweep.
    "deposit_sweep_live_enabled":         False,
    # Per-chain QuickNode / JSON-RPC toggles (btc, eth, bsc, tron, solana).
    # False = endpoint disabled in wallet UIs, deposit addresses, and scanning
    # even when QUICKNODE_*_URL is set in the API process environment.
    "blockchain_chain_settings": {
        "btc": True,
        "eth": True,
        "bsc": True,
        "tron": True,
        "solana": True,
    },
    "withdrawal_auto_execute_enabled":    False,
    "two_factor_enabled":                 False,
    "two_factor_required_for_withdrawal": False,
    # Phase 7b — rate-limit presets. These are the production defaults; ops
    # can loosen / tighten each bucket from the admin Settings page without
    # a redeploy. A value of 0 disables that specific bucket but the
    # enforcement helper is still called so we get counters + 429s back if
    # the entry is flipped on later.
    "rate_limit_enabled":                 True,
    "rate_limit_login_per_ip_per_min":    5,
    "rate_limit_login_per_email_per_hr":  10,
    "rate_limit_register_per_ip_per_min": 5,
    "rate_limit_2fa_per_uid_per_min":     10,
    "rate_limit_withdraw_per_uid_per_min": 5,
    "rate_limit_withdraw_per_uid_per_day": 30,
    # Phase 8 — Liquidity & Risk
    # The platform is the implicit counterparty for any leftover quantity of
    # a market order (the SYSTEM-fill path). These knobs make that exposure
    # visible *and* bounded:
    #
    # - ``system_spread_bps_default`` — basis points (1 bp = 0.01%) added to
    #   the user-side fill price for every SYSTEM fill. Captured as treasury
    #   USDT revenue. 15 bps = 0.15%, in line with retail CEX taker spreads.
    # - ``system_spread_bps_by_symbol`` — per-pair overrides. Empty dict
    #   means "use the default for every symbol".
    # - ``system_liquidity_enabled`` — when False, the matching engine will
    #   not use treasury/SYSTEM as fallback counterparty for market remainders.
    #   Book-to-book matching still works; unfilled market remainder is refunded
    #   and marked with reject_reason="system_liquidity_disabled" when needed.
    # - ``treasury_inventory_limit_base_by_symbol`` — per-pair caps on the
    #   absolute treasury position in *base units* (e.g. 10 means the
    #   treasury may go from -10 ETH to +10 ETH on ETHUSDT). 0 / missing
    #   means "uncapped" — preserves legacy behaviour for assets ops haven't
    #   set a limit for yet. Hybrid handling: when a SYSTEM fill would
    #   breach the cap the matching engine fills as much as the cap allows
    #   and refunds the unfilled remainder to the user.
    # - ``treasury_started_at`` — one-shot ISO timestamp of the cutover
    #   moment. Set automatically on first startup after Phase 8 deploys;
    #   used by the admin treasury page as the "since" anchor.
    "system_spread_bps_default":              15.0,
    "system_spread_bps_by_symbol":            {},
    "system_liquidity_enabled":               True,
    "treasury_inventory_limit_base_by_symbol": {},
    "treasury_started_at":                    None,
    # Phase 5 — risk controls. ``risk_max_order_notional_usdt`` caps single
    # order size globally; per-symbol overrides take precedence when set.
    # ``risk_max_open_notional_usdt_by_symbol`` caps aggregate open exposure
    # (sum of remaining notional) per user+symbol.
    "risk_max_order_notional_usdt":            0.0,
    "risk_max_open_notional_usdt":             0.0,
    "risk_max_order_notional_usdt_by_symbol":  {},
    "risk_max_open_notional_usdt_by_symbol":   {},
    # Phase 8d — Binance hedger.
    #
    # - ``hedger_enabled`` is the master kill switch. Default False so a
    #   fresh deployment is silent until ops explicitly opts in from the
    #   admin Settings page (prevents accidental mainnet orders).
    # - ``hedger_dry_run`` makes every hedge attempt log as
    #   ``status="dry_run"`` with no HTTP call. Default True — flip off
    #   only once testnet execution has been validated end-to-end.
    # - ``hedger_default_mode`` applies to any symbol missing a per-symbol
    #   override. ``off`` = worker never touches the symbol.
    # - ``hedger_price_sanity_bps`` rejects hedges where our treasury mark
    #   and Binance's quote diverge by more than this many bps (default
    #   50 bps = 0.5%). Protects against stale feeds.
    # - ``hedger_by_symbol`` holds per-pair config:
    #       { "ETHUSDT": {
    #           "mode": "manual"|"auto"|"off",
    #           "rebalance_threshold": 1.0,   # base units
    #           "max_hedge_size":      5.0,   # base units, per execution
    #           "cooldown_sec":        30.0,
    #         }, ... }
    #   Empty dict means "every symbol uses hedger_default_mode".
    "hedger_enabled":                         False,
    "hedger_dry_run":                         True,
    "hedger_default_mode":                    "off",
    "hedger_price_sanity_bps":                50.0,
    "hedger_by_symbol":                       {},
    # Phase 9a — reconciliation thresholds. Drift is flagged only when
    # BOTH the percentage AND the absolute USD amount cross the cap,
    # so tiny balances don't generate noise. Values are %.
    "hedger_reconcile_warn_pct":              1.0,
    "hedger_reconcile_warn_usd":              100.0,
    "hedger_reconcile_critical_pct":          5.0,
    "hedger_reconcile_critical_usd":          250.0,
    # Phase 10 — Binance-liquidity consistency and concurrency guardrails.
    "liquidity_mode":                         "HEDGE_ONLY",  # OFF | HEDGE_ONLY | BINANCE_BACKSTOP
    "binance_liquidity_enabled":              False,
    "binance_execution_mode":                 "dry_run",     # dry_run | live | shadow
    "binance_kill_switch":                    False,
    "binance_allowed_symbols":                [],
    "binance_rollout_symbols":                [],
    "binance_rollout_users":                  [],
    "binance_rollout_percent":                0,
    "binance_max_notional_per_order":         0.0,
    "binance_max_notional_per_day":           0.0,
    "binance_slippage_bps_limit":             50.0,
    "binance_latency_threshold_ms":           1500.0,
    "binance_quote_stale_ms":                 3000.0,
    "binance_last_look_bps":                  30.0,
    "binance_cb_failure_threshold":           5,
    "binance_cb_cooldown_sec":                60.0,
    "liquidity_max_abs_exposure_base_by_symbol": {},
    # Phase 9c — alerts. ``alert_webhook_url`` is optional; if blank, no
    # webhooks are delivered and alerts are DB-only (which is still
    # surfaced in the admin /alerts page + nav badge).
    # ``alert_webhook_min_severity`` floors which alerts get relayed —
    # default "warn" so "info" events don't spam Slack/Discord.
    "alert_webhook_url":                      "",
    "alert_webhook_min_severity":             "warn",
    # INR fiat deposits — IBO/INR = (ibo_price_override or IBO_BASE) / inr_per_usdt
    "inr_per_usdt":                           84.0,
    # INR deposit flow: manual | gateway | hybrid (see backend/inr/gateway_ops.py)
    "inr_deposit_mode":                       "manual",
    "inr_gateway_provider":                   "none",
    "inr_gateway_auto_approve_max_inr":       0.0,
    "updated_at":       None,
    # ── On-demand deposit monitoring ─────────────────────────────────────────
    # Controls the session-based deposit-monitoring feature available to users
    # on the Wallet → History → Deposits page. All values are runtime-editable
    # from the admin Settings panel without a code deploy.
    #
    # deposit_monitor_enabled             – global kill-switch (default on).
    # deposit_monitor_session_duration_sec – how long a session stays active (s).
    # deposit_monitor_scan_interval_sec   – minimum gap between client-triggered
    #                                       scans (s). Frontend polls at this rate.
    # deposit_monitor_max_scans_per_session – hard cap on blockchain RPC calls
    #                                       per session (prevents runaway costs).
    # deposit_monitor_max_active_sessions – max concurrent active sessions per user
    #                                       (1 = one tab at a time).
    # deposit_monitor_cooldown_sec        – required wait after a session ends
    #                                       before the user may start another.
    # deposit_monitor_message             – banner text shown while monitoring.
    # deposit_monitor_expired_message     – banner text shown after session ends.
    "deposit_monitor_enabled":               True,
    "deposit_monitor_session_duration_sec":  420,
    "deposit_monitor_scan_interval_sec":     30,
    "deposit_monitor_max_scans_per_session": 20,
    "deposit_monitor_max_active_sessions":   1,
    "deposit_monitor_cooldown_sec":          60,
    "deposit_monitor_message":               (
        "Monitoring active — new deposits typically appear within 1–3 minutes."
    ),
    "deposit_monitor_expired_message":       (
        "Monitoring stopped. Tap Restart to resume watching for deposits."
    ),
    # ── IBO Trading Ecosystem ─────────────────────────────────────────────────
    # See ibo/constants.py for key documentation.
    **IBO_CONTROL_DEFAULTS,
    # ── Refer & Earn (MLM referral) ──────────────────────────────────────────
    # referral_enabled: master switch. When False, signup ignores referral
    # codes and no rewards are credited (existing referral_edges/rewards data
    # is preserved either way).
    # referral_levels: distinct amounts for levels 1..(N-1). When
    # referral_flat_from_level > 0, levels N..20 all earn referral_flat_amount_ibo
    # and every level 1..(N-1) must be present here (no gaps).
    # referral_share_website_url / referral_share_playstore_url: base URLs
    # the client appends ``?ref=<code>`` to when building share links —
    # editable here so they can be updated without a redeploy.
    "referral_enabled": False,
    "referral_levels": [
        {"level": 1, "amount_ibo": 0.0},
    ],
    # When referral_flat_from_level > 0, levels 1..(N-1) must be configured in
    # referral_levels and every ancestor at depth N..20 earns referral_flat_amount_ibo.
    "referral_flat_from_level": 0,
    "referral_flat_amount_ibo": 0.0,
    "referral_share_website_url": "",
    "referral_share_playstore_url": "",
}


# Phase 5 — sensible built-in confirmation thresholds when neither
# ``deposit_min_confirmations_by_asset`` (per-asset) nor
# ``deposit_min_confirmations`` (global) is set. These values match common
# exchange policies (BTC=2 for native segwit testnets / sandbox, ETH=12,
# USDT-ERC20 inherits ETH). Ops can tune them per deployment via the
# admin panel without redeploying.
DEPOSIT_CONFIRMATION_DEFAULTS: Dict[str, int] = {
    "BTC":  2,
    "ETH":  12,
    "USDT": 12,
}


def resolve_min_confirmations(controls: Dict[str, Any], asset: str) -> int:
    """Resolve the effective min-confirmations threshold for ``asset``.

    Precedence: per-asset override > global override > built-in default.
    Defaults to ``1`` when nothing is configured (so we never auto-credit
    a 0-conf sighting by accident).
    """
    ast = (asset or "").upper()
    per_asset = controls.get("deposit_min_confirmations_by_asset") or {}
    if isinstance(per_asset, dict):
        v = per_asset.get(ast)
        if v is not None:
            try:
                iv = int(v)
                if iv >= 0:
                    return iv
            except (TypeError, ValueError):
                pass
    glob = controls.get("deposit_min_confirmations") or 0
    try:
        gv = int(glob)
        if gv > 0:
            return gv
    except (TypeError, ValueError):
        pass
    return int(DEPOSIT_CONFIRMATION_DEFAULTS.get(ast, 1))


# ─────────────────────────────────────────────────────────────────────────────
# Phase 8 — Liquidity & Risk: spread + inventory limit resolution
# ─────────────────────────────────────────────────────────────────────────────

# Hard upper bound on the per-symbol spread we'll ever apply. Anything above
# this likely means the operator typo'd a percentage as bps. The matching
# engine clamps to this value, the admin schema rejects it earlier.
_MAX_SPREAD_BPS = 500.0   # 5%

# Extra cushion (in bps) added on top of the spread when computing
# ``lock_px`` for buy market orders. Protects against micro price drift
# between order placement and the moment ``run_matching_engine`` reads
# ``market_price``. 25 bps ≈ 0.25%.
_LOCK_SAFETY_BPS = 25.0


def resolve_system_spread_bps(controls: Dict[str, Any], symbol: str) -> float:
    """Effective SYSTEM-fill spread for ``symbol``, in basis points.

    Precedence: per-symbol override > global default > 0. Always clamped
    to ``[0, _MAX_SPREAD_BPS]`` so a malformed override can never make the
    matching engine fill at a wildly off-market price.
    """
    sym = (symbol or "").upper()
    overrides = controls.get("system_spread_bps_by_symbol") or {}
    if isinstance(overrides, dict):
        v = overrides.get(sym)
        if v is not None:
            try:
                fv = float(v)
                if fv >= 0:
                    return min(fv, _MAX_SPREAD_BPS)
            except (TypeError, ValueError):
                pass
    try:
        gv = float(controls.get("system_spread_bps_default") or 0.0)
        if gv >= 0:
            return min(gv, _MAX_SPREAD_BPS)
    except (TypeError, ValueError):
        pass
    return 0.0


def resolve_treasury_inventory_limit_base(
    controls: Dict[str, Any], symbol: str,
) -> Optional[float]:
    """Per-symbol absolute inventory cap for the treasury (base units).

    Returns ``None`` (uncapped) when no positive override is configured —
    preserves the legacy "platform absorbs unlimited risk" behaviour for
    pairs ops haven't set a limit on yet.
    """
    sym = (symbol or "").upper()
    overrides = controls.get("treasury_inventory_limit_base_by_symbol") or {}
    if not isinstance(overrides, dict):
        return None
    raw = overrides.get(sym)
    if raw is None:
        return None
    try:
        fv = float(raw)
    except (TypeError, ValueError):
        return None
    if fv <= 0:
        return None
    return fv


def _resolve_symbol_usdt_cap(
    controls: Dict[str, Any],
    *,
    global_key: str,
    per_symbol_key: str,
    symbol: str,
) -> float:
    """Resolve global/per-symbol USDT cap; per-symbol override wins."""
    sym = (symbol or "").strip().upper()
    gv = _control_float(controls, global_key, 0.0)
    per = controls.get(per_symbol_key) or {}
    if isinstance(per, dict) and sym in per:
        try:
            pv = float(per.get(sym) or 0.0)
            if pv > 0:
                return pv
        except (TypeError, ValueError):
            pass
    return max(0.0, gv)


async def _user_open_notional_usdt(uid: str, symbol: str, market_price: float) -> float:
    """Current open order notional for one user+symbol in USDT."""
    if db is None:
        return 0.0
    rows = await db.orders.find(
        {"uid": uid, "symbol": symbol, "status": {"$in": ["open", "partially_filled"]}},
        {"_id": 0, "remaining": 1, "price": 1, "lock_price": 1},
    ).to_list(5000)
    total = 0.0
    for r in rows:
        rem = max(0.0, _as_float(r.get("remaining")))
        px = _as_float(r.get("price"))
        if px <= 0:
            px = _as_float(r.get("lock_price"))
        if px <= 0:
            px = market_price
        total += rem * px
    return total


def apply_spread(side: str, mark_price: float, spread_bps: float) -> float:
    """Skew ``mark_price`` against the user by ``spread_bps`` basis points.

    Buy SYSTEM fills are priced at mark × (1 + bps/10000), sells at
    mark × (1 - bps/10000). Returns ``mark_price`` unchanged when
    ``spread_bps <= 0``.
    """
    if spread_bps is None or spread_bps <= 0:
        return float(mark_price)
    factor = float(spread_bps) / 10_000.0
    if side == "buy":
        return float(mark_price) * (1.0 + factor)
    return float(mark_price) * (1.0 - factor)


def _norm_symbol_list(values: Any) -> List[str]:
    out: List[str] = []
    for v in (values or []):
        s = str(v or "").strip().upper()
        if s and s not in out:
            out.append(s)
    return out


def _liquidity_execution_key(order_id: str, symbol: str, side: str, remainder_qty: float) -> str:
    # Deterministic remainder key per order+route payload to prevent duplicate
    # Binance/SYSTEM attempts when retries race with the main flow.
    payload = f"{order_id}|{symbol.upper()}|{side.lower()}|{round(float(remainder_qty), 8):.8f}"
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]
    return f"lex_{digest}"


def _liquidity_client_order_id(execution_key: str) -> str:
    # Binance newClientOrderId max length is 36.
    return f"ibo_{execution_key[-30:]}"


async def _log_liquidity_routing_decision(
    *,
    execution_key: str,
    order_id: str,
    uid: str,
    symbol: str,
    side: str,
    remainder_qty: float,
    route: str,
    reason: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    if db is None:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.liquidity_routing_logs.insert_one({
        "id": f"lrl_{uuid.uuid4().hex[:14]}",
        "execution_key": execution_key,
        "order_id": order_id,
        "uid": uid,
        "symbol": symbol,
        "side": side,
        "remainder_qty": round(max(0.0, float(remainder_qty)), 8),
        "route": route,
        "reason": reason,
        "metadata": metadata or {},
        "created_at": now,
    })


async def _liquidity_get_or_create_intent(
    *,
    execution_key: str,
    order_id: str,
    uid: str,
    symbol: str,
    side: str,
    remainder_qty: float,
    remainder_notional: float,
    expected_price: float,
) -> Dict[str, Any]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    now = datetime.now(timezone.utc).isoformat()
    doc = await db.liquidity_execution_intents.find_one({"execution_key": execution_key}, {"_id": 0})
    if doc:
        return doc
    candidate = {
        "id": f"lei_{uuid.uuid4().hex[:14]}",
        "execution_key": execution_key,
        "order_id": order_id,
        "uid": uid,
        "symbol": symbol,
        "side": side,
        "remainder_qty": round(max(0.0, float(remainder_qty)), 8),
        "remainder_notional": round(max(0.0, float(remainder_notional)), 8),
        "expected_price": round(max(0.0, float(expected_price)), 8),
        "execution_price": None,
        "slippage_bps": None,
        "state": "pending",
        "intent_version": 1,
        "attempt_count": 0,
        "max_attempts": 5,
        "client_order_id": _liquidity_client_order_id(execution_key),
        "binance_order_id": None,
        "hedge_trade_id": None,
        "user_fill_id": None,
        "last_error": None,
        "created_at": now,
        "updated_at": now,
        "finalized_at": None,
    }
    try:
        await db.liquidity_execution_intents.insert_one(candidate)
        return candidate
    except DuplicateKeyError:
        doc = await db.liquidity_execution_intents.find_one({"execution_key": execution_key}, {"_id": 0})
        if doc:
            return doc
        raise


_ALLOWED_LIQUIDITY_TRANSITIONS: Dict[str, set] = {
    "pending": {"executing", "cancelled"},
    "executing": {"executed", "failed"},
    "failed": {"executing", "dead_letter"},
    "executed": {"finalized"},
    "finalized": set(),
    "dead_letter": set(),
    "cancelled": set(),
}


async def _liquidity_transition_state(
    execution_key: str,
    from_state: str,
    to_state: str,
    *,
    reason: str,
    patch: Optional[Dict[str, Any]] = None,
) -> bool:
    if db is None:
        return False
    if to_state not in _ALLOWED_LIQUIDITY_TRANSITIONS.get(from_state, set()):
        return False
    now = datetime.now(timezone.utc).isoformat()
    updates: Dict[str, Any] = {
        "state": to_state,
        "updated_at": now,
    }
    if to_state == "finalized":
        updates["finalized_at"] = now
    if patch:
        updates.update(patch)
    row = await db.liquidity_execution_intents.find_one_and_update(
        {"execution_key": execution_key, "state": from_state},
        {"$set": updates, "$inc": {"intent_version": 1}},
        projection={"_id": 0, "execution_key": 1},
        return_document=ReturnDocument.AFTER,
    )
    if not row:
        return False
    await db.liquidity_state_transitions.insert_one({
        "id": f"lst_{uuid.uuid4().hex[:14]}",
        "execution_key": execution_key,
        "from_state": from_state,
        "to_state": to_state,
        "reason": reason,
        "created_at": now,
    })
    return True


def _retry_backoff_seconds(attempt: int) -> float:
    base = 2.0
    cap = 120.0
    return min(cap, base * (2 ** max(0, attempt)))


def _parse_iso_ts(raw: Any) -> Optional[datetime]:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:  # noqa: BLE001
        return None


async def _binance_breaker_status(controls: Dict[str, Any]) -> Dict[str, Any]:
    if db is None:
        return {"open": False, "reason": "db_unavailable"}
    row = await db.binance_health_metrics.find_one({"id": "global"}, {"_id": 0})
    threshold = max(1, int(controls.get("binance_cb_failure_threshold") or 5))
    cooldown_sec = max(0.0, float(controls.get("binance_cb_cooldown_sec") or 60.0))
    consecutive = int((row or {}).get("consecutive_failures") or 0)
    last_fail_at = _parse_iso_ts((row or {}).get("last_failure_at"))
    if consecutive < threshold:
        return {"open": False, "consecutive_failures": consecutive, "threshold": threshold}
    if not last_fail_at:
        return {"open": True, "reason": "failure_threshold", "consecutive_failures": consecutive, "threshold": threshold}
    elapsed = (datetime.now(timezone.utc) - last_fail_at).total_seconds()
    if elapsed >= cooldown_sec:
        return {"open": False, "consecutive_failures": consecutive, "threshold": threshold, "cooldown_elapsed": True}
    return {
        "open": True,
        "reason": "cooldown_active",
        "consecutive_failures": consecutive,
        "threshold": threshold,
        "retry_after_sec": round(max(0.0, cooldown_sec - elapsed), 3),
    }


async def _record_binance_exec_outcome(*, ok: bool, latency_ms: float, error: Optional[str] = None) -> None:
    if db is None:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    row = await db.binance_health_metrics.find_one({"id": "global"}, {"_id": 0}) or {"id": "global"}
    prev_p95 = float(row.get("latency_p95_ms") or 0.0)
    # Lightweight EMA approximation for live latency health (keeps write path cheap).
    next_p95 = latency_ms if prev_p95 <= 0 else (0.85 * prev_p95 + 0.15 * float(max(0.0, latency_ms)))
    updates: Dict[str, Any] = {
        "id": "global",
        "updated_at": now_iso,
        "last_latency_ms": round(float(max(0.0, latency_ms)), 3),
        "latency_p95_ms": round(next_p95, 3),
    }
    if ok:
        updates["last_success_at"] = now_iso
        updates["consecutive_failures"] = 0
        updates["last_error"] = None
    else:
        updates["last_failure_at"] = now_iso
        updates["consecutive_failures"] = int(row.get("consecutive_failures") or 0) + 1
        updates["last_error"] = str(error or "binance_execution_failed")[:400]
    await db.binance_health_metrics.update_one(
        {"id": "global"},
        {"$set": updates, "$setOnInsert": {"id": "global", "created_at": now_iso}},
        upsert=True,
    )


async def _process_liquidity_retry_queue_once(limit: int = 20) -> int:
    if db is None:
        return 0
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    processed = 0
    for _ in range(max(1, int(limit))):
        job = await db.liquidity_retry_queue.find_one_and_update(
            {
                "status": {"$in": ["pending", "retry_scheduled"]},
                "next_retry_at": {"$lte": now_iso},
            },
            {"$set": {"status": "processing", "updated_at": now_iso}},
            sort=[("next_retry_at", 1)],
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not job:
            break
        processed += 1
        qid = str(job.get("id") or "")
        execution_key = str(job.get("execution_key") or "")
        attempt = int(job.get("attempt") or 0)
        max_attempts = int(job.get("max_attempts") or 5)
        intent = await db.liquidity_execution_intents.find_one({"execution_key": execution_key}, {"_id": 0})
        if not intent:
            await db.liquidity_retry_queue.update_one(
                {"id": qid},
                {"$set": {"status": "dead_letter", "updated_at": now_iso, "last_error": "intent_missing"}},
            )
            await db.liquidity_retry_dlq.insert_one({
                "id": f"ldlq_{uuid.uuid4().hex[:14]}",
                "queue_id": qid,
                "execution_key": execution_key,
                "reason": "intent_missing",
                "payload": job,
                "created_at": now_iso,
            })
            continue
        istate = str(intent.get("state") or "")
        if istate in {"executed", "finalized", "cancelled"}:
            await db.liquidity_retry_queue.update_one(
                {"id": qid},
                {"$set": {"status": "resolved", "updated_at": now_iso, "last_error": None}},
            )
            continue
        controls = await get_platform_controls()
        cb = await _binance_breaker_status(controls)
        if cb.get("open"):
            next_retry_at = (now + timedelta(seconds=max(2.0, float(cb.get("retry_after_sec") or 2.0)))).isoformat()
            await db.liquidity_retry_queue.update_one(
                {"id": qid},
                {"$set": {
                    "status": "retry_scheduled",
                    "updated_at": now_iso,
                    "next_retry_at": next_retry_at,
                    "last_error": "circuit_breaker_open",
                }},
            )
            await db.liquidity_execution_intents.update_one(
                {"execution_key": execution_key},
                {"$set": {"state": "failed", "updated_at": now_iso, "last_error": "circuit_breaker_open"}},
            )
            continue
        from_state = istate if istate in _ALLOWED_LIQUIDITY_TRANSITIONS else "failed"
        moved = await _liquidity_transition_state(
            execution_key,
            from_state,
            "executing",
            reason="retry_worker_attempt",
            patch={"attempt_count": attempt + 1},
        )
        if not moved:
            next_retry_at = (now + timedelta(seconds=1.0)).isoformat()
            await db.liquidity_retry_queue.update_one(
                {"id": qid},
                {"$set": {
                    "status": "retry_scheduled",
                    "updated_at": now_iso,
                    "next_retry_at": next_retry_at,
                    "last_error": "state_transition_conflict",
                }},
            )
            continue

        exec_mode = str(controls.get("binance_execution_mode") or "dry_run").lower()
        if exec_mode in {"dry_run", "shadow"}:
            expected_price = float(intent.get("expected_price") or 0.0)
            slippage = 0.0
            if await _liquidity_transition_state(
                execution_key,
                "executing",
                "executed",
                reason=f"{exec_mode}_simulated_execution",
                patch={
                    "execution_price": expected_price if expected_price > 0 else None,
                    "slippage_bps": slippage,
                },
            ):
                await _liquidity_transition_state(
                    execution_key,
                    "executed",
                    "finalized",
                    reason=f"{exec_mode}_finalized",
                )
            await db.liquidity_retry_queue.update_one(
                {"id": qid},
                {"$set": {"status": "resolved", "updated_at": now_iso, "last_error": None, "attempt": attempt + 1}},
            )
            await _log_liquidity_routing_decision(
                execution_key=execution_key,
                order_id=str(intent.get("order_id") or ""),
                uid=str(intent.get("uid") or ""),
                symbol=str(intent.get("symbol") or ""),
                side=str(intent.get("side") or ""),
                remainder_qty=float(intent.get("remainder_qty") or 0.0),
                route="BINANCE",
                reason=f"{exec_mode}_simulated",
                metadata={"execution_mode": exec_mode, "notional_usdt": float(intent.get("remainder_notional") or 0.0)},
            )
            continue

        try:
            client = await hedger_service.get_client()
            sym = str(intent.get("symbol") or "").upper()
            side = str(intent.get("side") or "buy").lower()
            qty = float(intent.get("remainder_qty") or 0.0)
            base = SYMBOL_BASE_MAP.get(sym)
            treasury_mark = _cached_price_usdt(base or "")
            start_ms = time.perf_counter()
            trade = await hedger_service.execute_hedge(
                symbol=sym,
                side=side if side in {"buy", "sell"} else "buy",
                qty=qty,
                reason="liquidity_retry_worker",
                initiator="worker",
                controls=controls,
                client=client,
                treasury_mark=treasury_mark,
                mode="auto",
                client_order_id=str(intent.get("client_order_id") or ""),
            )
            latency_ms = (time.perf_counter() - start_ms) * 1000.0
            await _record_binance_exec_outcome(ok=True, latency_ms=latency_ms)
            exec_px = float(trade.get("avg_price") or trade.get("binance_price") or intent.get("expected_price") or 0.0)
            exp_px = float(intent.get("expected_price") or 0.0)
            slip = (abs(exec_px - exp_px) / exp_px * 10_000.0) if exp_px > 0 and exec_px > 0 else 0.0
            if await _liquidity_transition_state(
                execution_key,
                "executing",
                "executed",
                reason="binance_retry_executed",
                patch={
                    "execution_price": round(exec_px, 8) if exec_px > 0 else None,
                    "slippage_bps": round(slip, 4),
                    "binance_order_id": trade.get("binance_order_id"),
                    "hedge_trade_id": trade.get("id"),
                },
            ):
                await _liquidity_transition_state(
                    execution_key,
                    "executed",
                    "finalized",
                    reason="binance_retry_finalized",
                )
            await db.liquidity_retry_queue.update_one(
                {"id": qid},
                {"$set": {"status": "resolved", "updated_at": now_iso, "last_error": None, "attempt": attempt + 1}},
            )
            await _log_liquidity_routing_decision(
                execution_key=execution_key,
                order_id=str(intent.get("order_id") or ""),
                uid=str(intent.get("uid") or ""),
                symbol=sym,
                side=side,
                remainder_qty=qty,
                route="BINANCE",
                reason="retry_worker_executed",
                metadata={
                    "notional_usdt": float(intent.get("remainder_notional") or 0.0),
                    "hedge_trade_id": trade.get("id"),
                    "binance_order_id": trade.get("binance_order_id"),
                    "slippage_bps": round(slip, 4),
                },
            )
            continue
        except Exception as exc:  # noqa: BLE001
            latency_ms = (time.perf_counter() - start_ms) * 1000.0 if "start_ms" in locals() else 0.0
            await _record_binance_exec_outcome(ok=False, latency_ms=latency_ms, error=str(exc))
            err = str(exc)
            await _liquidity_transition_state(
                execution_key,
                "executing",
                "failed",
                reason="retry_execution_error",
                patch={"last_error": err},
            )

        if attempt + 1 >= max_attempts:
            await db.liquidity_retry_queue.update_one(
                {"id": qid},
                {"$set": {
                    "status": "dead_letter",
                    "updated_at": now_iso,
                    "attempt": attempt + 1,
                    "last_error": "max_attempts_reached",
                }},
            )
            await db.liquidity_execution_intents.update_one(
                {"execution_key": execution_key},
                {"$set": {"state": "dead_letter", "updated_at": now_iso, "last_error": "max_attempts_reached"}},
            )
            await db.liquidity_retry_dlq.insert_one({
                "id": f"ldlq_{uuid.uuid4().hex[:14]}",
                "queue_id": qid,
                "execution_key": execution_key,
                "reason": "max_attempts_reached",
                "payload": job,
                "created_at": now_iso,
            })
            continue
        next_retry_at = (now + timedelta(seconds=_retry_backoff_seconds(attempt))).isoformat()
        await db.liquidity_retry_queue.update_one(
            {"id": qid},
            {"$set": {
                "status": "retry_scheduled",
                "attempt": attempt + 1,
                "updated_at": now_iso,
                "next_retry_at": next_retry_at,
                "last_error": "retry_scheduled_after_error",
            }},
        )
        await db.liquidity_execution_intents.update_one(
            {"execution_key": execution_key},
            {"$set": {"state": "failed", "updated_at": now_iso, "last_error": "retry_scheduled"}},
        )
    return processed


def _mongodb_read_unavailable(exc: BaseException) -> bool:
    """True when Mongo is down, reloading, or the client was closed (e.g. uvicorn StatReload)."""
    return isinstance(
        exc,
        (AutoReconnect, ConnectionFailure, ServerSelectionTimeoutError, InvalidOperation),
    )


async def get_platform_controls() -> Dict[str, Any]:
    doc: Optional[Dict[str, Any]] = None
    if db is None:
        out = dict(PLATFORM_CONTROL_DEFAULTS)
    else:
        try:
            doc = await db.platform_controls.find_one({"id": "global"}, {"_id": 0})
        except Exception as exc:  # noqa: BLE001
            if _mongodb_read_unavailable(exc):
                logger.warning("platform_controls: MongoDB read failed — using defaults (%s)", exc)
                doc = None
            else:
                raise
        if not doc:
            out = dict(PLATFORM_CONTROL_DEFAULTS)
        else:
            out = dict(PLATFORM_CONTROL_DEFAULTS)
            out.update(doc)
    # When the crediter worker is enabled via env, default auto-credit on unless
    # the admin panel explicitly set deposit_auto_credit_enabled false.
    if _env_flag_true("DEPOSIT_CREDIT_ENABLED"):
        if doc is None or doc.get("deposit_auto_credit_enabled") is None:
            out["deposit_auto_credit_enabled"] = True
    from ibo.pricing import update_platform_controls_cache

    update_platform_controls_cache(out)
    return out


async def get_signup_bonus_ibo() -> float:
    """IBO welcome credit for new registrations (admin-managed; 0 = off)."""
    controls = await get_platform_controls()
    try:
        return max(0.0, float(controls.get("signup_bonus_ibo") or 0))
    except (TypeError, ValueError):
        return 0.0


async def sync_blockchain_chain_admin() -> None:
    """Apply admin chain toggles to the RPC registry and live provider."""
    from services.blockchain_chain_controls import apply_admin_settings_to_registry

    controls = await get_platform_controls()
    apply_admin_settings_to_registry(controls.get("blockchain_chain_settings"))
    provider = blockchain_service.get_provider()
    if hasattr(provider, "refresh_rpc_urls_from_registry"):
        provider.refresh_rpc_urls_from_registry()


async def enforce_feature(feature_key: Optional[str] = None, detail: Optional[str] = None) -> None:
    """
    Raise 503 when maintenance mode is active or a specific feature is disabled.
    `feature_key` should map to a key in PLATFORM_CONTROL_DEFAULTS.
    """
    controls = await get_platform_controls()
    if controls.get("maintenance_mode", False):
        raise HTTPException(status_code=503, detail="Platform is temporarily paused by admin")
    if feature_key and not controls.get(feature_key, True):
        raise HTTPException(
            status_code=503,
            detail=detail or f"Feature '{feature_key}' is currently paused by admin",
        )


def enforce_user_actions_allowed(user: dict) -> None:
    """Block trading, wallet, KYC, and profile mutations for this user when admin pauses them."""
    if user.get("user_features_paused"):
        note = (user.get("user_pause_note") or "").strip()
        detail = (
            note
            if note
            else "Your account actions are temporarily paused by an administrator. Contact support if you believe this is a mistake."
        )
        raise HTTPException(status_code=403, detail=detail)


def enforce_user_trading_allowed(user: dict) -> None:
    """Block only trading actions for this user when admin pauses trading."""
    enforce_user_actions_allowed(user)
    if user.get("user_trading_paused"):
        raise HTTPException(status_code=403, detail="Trading is paused for this account by an administrator")


def enforce_user_withdrawals_allowed(user: dict) -> None:
    """Block withdrawal submissions when admin pauses outbound transfers only."""
    enforce_user_actions_allowed(user)
    if user.get("user_withdrawals_paused"):
        note = (user.get("user_pause_note") or "").strip()
        detail = (
            note
            if note
            else "Withdrawals are paused for this account by an administrator. Contact support if you believe this is a mistake."
        )
        raise HTTPException(status_code=403, detail=detail)


def _control_float(controls: Dict[str, Any], key: str, default: float) -> float:
    try:
        return float(controls.get(key, default))
    except (TypeError, ValueError):
        return default


def _fee_rates_from_controls(controls: Dict[str, Any]) -> tuple[float, float]:
    maker = _control_float(controls, "maker_fee_rate", 0.001)
    taker = _control_float(controls, "taker_fee_rate", 0.001)
    maker = min(max(maker, 0.0), 0.05)
    taker = min(max(taker, 0.0), 0.05)
    return maker, taker


def _swap_fee_from_controls(controls: Dict[str, Any]) -> tuple[float, float]:
    rate = min(max(_control_float(controls, "swap_fee_rate", 0.001), 0.0), 0.05)
    fixed = max(_control_float(controls, "swap_fee_ibo_fixed", 0.0), 0.0)
    return rate, fixed


async def _to_usdt_notional(asset: str, amount: float) -> float:
    if asset == "USDT":
        return float(amount)
    px = await get_current_price(f"{asset}USDT")
    return float(amount) * float(px)


async def _resolve_ibo_usdt_price(controls: Optional[Dict[str, Any]] = None) -> float:
    """Best-effort IBO/USDT mark for IBO fee conversion."""
    from ibo.pricing import platform_ibo_usdt_price

    if controls is None:
        controls = await get_platform_controls()
    return platform_ibo_usdt_price(controls)


def _estimate_ibo_fee(
    *,
    quote_asset: str,
    quote_notional: float,
    fee_rate: float,
    ibo_price_usdt: float,
) -> float:
    q = float(max(quote_notional, 0.0))
    r = float(max(fee_rate, 0.0))
    if q <= 0 or r <= 0:
        return 0.0
    if str(quote_asset or "USDT").upper() == "IBO":
        return round(q * r, 8)
    px = float(ibo_price_usdt or 0.0)
    if px <= 0:
        return 0.0
    return round((q * r) / px, 8)


async def _compliance_monitor_loop() -> None:
    """Persist transaction-monitoring hits on a schedule; optional alert on new rows."""
    interval = int(os.environ.get("COMPLIANCE_TX_MONITOR_INTERVAL_SEC", "900") or "0")
    if interval <= 0:
        return
    while True:
        try:
            await asyncio.sleep(float(interval))
            if db is None:
                continue
            cfg = await _get_screening_config()
            dt_to = datetime.now(timezone.utc)
            dt_from = dt_to - timedelta(days=1)
            tf = dt_from.isoformat()
            tt = dt_to.isoformat()
            events = await compliance_service.build_tx_monitor_events(db, cfg, tf, tt, 150)
            ins, _ = await compliance_service.persist_tx_monitor_events(db, events, source="scheduled")
            if ins > 0:
                url, min_sev = await _alert_webhook_params()
                try:
                    await alert_service.raise_alert(
                        type="compliance.tx_monitor.scheduled",
                        severity="warn",
                        source="system",
                        title="Transaction monitoring: new findings",
                        message=f"{ins} new monitoring event(s) persisted from scheduled scan.",
                        meta={"window_from": tf, "window_to": tt, "inserted": ins},
                        dedupe_key=f"compliance.tx_monitor.scheduled:{tf[:10]}",
                        webhook_url=url,
                        webhook_min_severity=min_sev,
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("compliance monitor: raise_alert failed")
        except asyncio.CancelledError:
            break
        except Exception:  # noqa: BLE001
            logger.exception("compliance monitor loop error")


# ── Database startup/shutdown ─────────────────────────────────────────────────

async def _ensure_mongo_sparse_unique_index(collection, field: str) -> None:
    """Recreate ``field`` as sparse+unique (mobile-first signup may omit email)."""
    index_name = f"{field}_1"
    try:
        await collection.drop_index(index_name)
    except Exception:
        pass
    await collection.create_index(field, unique=True, sparse=True)


@app.on_event("startup")
async def startup_db_client():
    global client, db, _ibo_mock_market_enabled
    try:
        mongo_url = os.environ.get('MONGO_URL', '')
        db_name   = os.environ.get('DB_NAME', 'ibo_live_db')
        if mongo_url:
            client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
            db = client[db_name]
            await client.admin.command('ping')
            # Ensure indexes (all idempotent)
            await db.users.create_index("email", unique=True)
            # Sparse so users without a phone (SMS OTP disabled) don't collide on null.
            await _ensure_mongo_sparse_unique_index(db.users, "phone")
            await db.wallets.create_index([("uid", 1), ("asset", 1)], unique=True)
            await db.deposit_requests.create_index("id", unique=True)
            await db.deposit_requests.create_index("uid")
            await db.deposit_requests.create_index([("status", 1), ("uid", 1)])
            await db.inr_payment_methods.create_index("id", unique=True)
            await db.inr_payment_methods.create_index([("is_active", 1), ("type", 1)])
            await db.inr_deposits.create_index("id", unique=True)
            await db.inr_deposits.create_index("uid")
            await db.inr_deposits.create_index([("status", 1), ("created_at", -1)])
            await db.inr_deposits.create_index([("uid", 1), ("status", 1)])
            # Unset legacy nulls so they are not indexed (sparse unique allows only one null).
            await db.inr_deposits.update_many(
                {"gateway_payment_id": None},
                {"$unset": {"gateway_payment_id": ""}},
            )
            try:
                await db.inr_deposits.drop_index("gateway_payment_id_1")
            except Exception:
                pass
            await db.inr_deposits.create_index(
                "gateway_payment_id",
                unique=True,
                partialFilterExpression={"gateway_payment_id": {"$type": "string"}},
            )
            await db.inr_withdrawals.create_index("id", unique=True)
            await db.inr_withdrawals.create_index("uid")
            await db.inr_withdrawals.create_index([("status", 1), ("created_at", -1)])
            await db.inr_withdrawals.create_index([("uid", 1), ("status", 1)])
            await db.inr_payout_profiles.create_index("uid", unique=True)
            await db.inr_gateway_events.create_index("id", unique=True)
            await db.inr_gateway_events.create_index([("provider", 1), ("created_at", -1)])
            await db.withdrawal_requests.create_index("id", unique=True)
            await db.withdrawal_requests.create_index("uid")
            await db.withdrawal_requests.create_index([("status", 1), ("uid", 1)])
            # Phase 6 — executor scans status+created_at; tx_hash is unique
            # per broadcast so we can detect a duplicate send coming back
            # from a retry.
            await db.withdrawal_requests.create_index([("status", 1), ("created_at", 1)])
            await db.withdrawal_requests.create_index(
                "tx_hash",
                unique=True,
                partialFilterExpression={"tx_hash": {"$type": "string"}},
            )
            await db.orders.create_index("id", unique=True)
            await db.orders.create_index("uid")
            await db.orders.create_index([("symbol", 1), ("side", 1), ("status", 1), ("price", 1)])
            await db.trades.create_index("id", unique=True)
            await db.trades.create_index("taker_uid")
            await db.trades.create_index("maker_uid")
            await db.trades.create_index([("taker_uid", 1), ("created_at", 1)])
            await db.trades.create_index([("maker_uid", 1), ("created_at", 1)])
            await db.kyc.create_index([("status", 1), ("submitted_at", -1)])
            await db.kyc.create_index("uid")
            await db.admin_users.create_index("email", unique=True)
            await db.admin_users.create_index("aid", unique=True)
            await db.admin_audit_logs.create_index([("created_at", -1)])
            await db.support_tickets.create_index("id", unique=True)
            await db.support_tickets.create_index([("uid", 1), ("updated_at", -1)])
            await db.support_tickets.create_index([("status", 1), ("updated_at", -1)])
            await db.support_tickets.create_index([("priority", 1), ("updated_at", -1)])
            await db.support_tickets.create_index([("category", 1), ("updated_at", -1)])
            await db.liquidity_execution_intents.create_index("execution_key", unique=True)
            await db.liquidity_execution_intents.create_index("client_order_id", unique=True)
            await db.liquidity_execution_intents.create_index([("state", 1), ("updated_at", -1)])
            await db.liquidity_execution_intents.create_index([("symbol", 1), ("created_at", -1)])
            await db.liquidity_state_transitions.create_index([("execution_key", 1), ("created_at", -1)])
            await db.liquidity_routing_logs.create_index([("created_at", -1)])
            await db.liquidity_routing_logs.create_index([("order_id", 1), ("created_at", -1)])
            await db.liquidity_routing_logs.create_index([("uid", 1), ("created_at", -1)])
            await db.liquidity_retry_queue.create_index("execution_key")
            await db.liquidity_retry_queue.create_index([("status", 1), ("next_retry_at", 1)])
            await db.balance_reservations.create_index("reservation_id", unique=True)
            await db.balance_reservations.create_index([("execution_key", 1), ("status", 1)])
            await db.binance_health_metrics.create_index("id", unique=True)
            await db.wallet_adjustments.create_index("id", unique=True)
            await db.wallet_adjustments.create_index([("uid", 1), ("created_at", -1)])
            await db.wallet_adjustments.create_index([("asset", 1), ("created_at", -1)])
            await db.platform_controls.create_index("id", unique=True)
            await db.mobile_app_releases.create_index("id", unique=True)
            await db.mobile_app_releases.create_index("version_code", unique=True)
            await db.mobile_app_releases.create_index([("published", 1), ("version_code", -1)])
            await db.landing_promo.create_index("id", unique=True)
            await db.app_home_banners.create_index("id", unique=True)
            await db.app_home_banners.create_index([("enabled", 1), ("sort_order", 1)])
            await db.app_home_banner_settings.create_index("id", unique=True)
            await deposit_monitor_service.ensure_indexes(db)
            await referral_svc.ensure_referral_indexes(db)
            await db.market_pairs.create_index("symbol", unique=True)
            await db.token_listing_requests.create_index("id", unique=True)
            await db.token_listing_requests.create_index([("status", 1), ("created_at", -1)])
            await db.token_listing_requests.create_index("token_symbol")
            await db.token_listing_requests.create_index(
                [("contract_address", 1), ("blockchain_network", 1)],
            )
            await db.listed_tokens.create_index("id", unique=True)
            await db.listed_tokens.create_index("token_symbol", unique=True)
            await db.listed_tokens.create_index("is_platform_default")
            await db.listed_tokens.create_index([("status", 1), ("token_symbol", 1)])
            await _ensure_mongo_sparse_unique_index(db.signup_pending, "email")
            await _ensure_mongo_sparse_unique_index(db.signup_pending, "phone_e164")
            await db.deposit_addresses.create_index("id", unique=True)
            await db.deposit_addresses.create_index([("asset", 1), ("network", 1), ("enabled", 1)])
            # Phase 1 — wallet_txns ledger indexes
            await db.wallet_txns.create_index("id", unique=True)
            await db.wallet_txns.create_index([("uid", 1), ("created_at", -1)])
            await db.wallet_txns.create_index([("uid", 1), ("asset", 1), ("created_at", -1)])
            await db.wallet_txns.create_index([("uid", 1), ("type", 1), ("created_at", -1)])
            await db.wallet_txns.create_index([("ref_type", 1), ("ref_id", 1)])
            await db.wallet_txns.create_index([("asset", 1), ("created_at", -1)])
            await db.wallet_txns.create_index([("created_at", -1)])
            await db.finance_export_jobs.create_index("id", unique=True)
            await db.finance_export_jobs.create_index([("status", 1), ("created_at", -1)])
            await db.finance_export_jobs.create_index([("requested_by", 1), ("created_at", -1)])
            await db.finance_export_jobs.create_index([("completed_at", -1)])

            # Phase 1 — omnibus hot/cold watch addresses (no keys stored).
            await db.treasury_wallets.create_index("id", unique=True)
            await db.treasury_wallets.create_index(
                [("role", 1), ("asset", 1), ("network", 1), ("address", 1)],
                unique=True,
                name="uniq_treasury_wallet_role_asset_network_address",
            )
            await db.treasury_wallets.create_index(
                "idempotency_key",
                unique=True,
                partialFilterExpression={"idempotency_key": {"$type": "string"}},
            )
            await db.treasury_wallets.create_index([("role", 1), ("enabled", 1)])
            await db.treasury_wallet_audit.create_index([("wallet_id", 1), ("created_at", -1)])
            await db.treasury_wallet_audit.create_index([("created_at", -1)])
            await db.treasury_withdrawal_gate_events.create_index(
                [("withdrawal_id", 1), ("created_at", -1)],
            )
            await db.treasury_withdrawal_gate_events.create_index([("created_at", -1)])
            await db.deposit_sweep_runs.create_index("id", unique=True)
            await db.deposit_sweep_runs.create_index([("created_at", -1)])
            await db.deposit_sweep_runs.create_index(
                "idempotency_key",
                unique=True,
                partialFilterExpression={"idempotency_key": {"$type": "string"}},
            )

            # Phase 2 — atomic per-user withdrawal-quota counter (one row per
            # user per UTC day). Unique index makes concurrent upserts safe.
            await db.withdrawal_daily_usage.create_index(
                [("uid", 1), ("day", 1)], unique=True,
            )

            # Phase 3 — blockchain provider support ─────────────────────────
            # ``deposit_addresses`` now also stores per-user HD-derived rows
            # (``uid`` set). Admin-curated shared rows keep ``uid=null``.
            # A unique compound index guarantees one HD address per user
            # per (asset, network) pair.
            #
            # Note: MongoDB partial indexes only support a restricted subset
            # of operators — ``$ne`` / ``$not`` are **not** allowed. We use
            # ``$type: "string"`` instead, which matches exactly the HD rows
            # (where uid is a real user id string) and excludes shared
            # admin rows where uid is missing or null.
            await db.deposit_addresses.create_index(
                [("uid", 1), ("asset", 1), ("network", 1)],
                unique=True,
                partialFilterExpression={"uid": {"$type": "string"}},
            )
            await db.deposit_addresses.create_index("address")
            # Sequential derivation-index counters — one row per (asset, network).
            await db.hd_wallet_state.create_index(
                [("asset", 1), ("network", 1)], unique=True,
            )
            # Poller sightings — idempotent by (asset, network, tx_hash, address).
            await db.deposit_events.create_index(
                [("asset", 1), ("network", 1), ("tx_hash", 1), ("address", 1)],
                unique=True,
            )
            await db.deposit_events.create_index([("uid", 1), ("created_at", -1)])
            await db.deposit_events.create_index([("confirmations", 1)])

            # Phase 7a — two-factor authentication (TOTP). One row per user,
            # keyed on ``uid``. ``confirmed=false`` rows are pending setups
            # (no backup codes issued yet); the unique index lets us treat
            # "re-setup" as an upsert.
            await db.user_2fa.create_index("uid", unique=True)

            # Phase 7b — refresh-token registry. Active refresh tokens live
            # here (one row per jti). Rotation deletes the previous row and
            # inserts a new one atomically. TTL on ``expires_at`` reaps any
            # stragglers.
            await db.refresh_tokens.create_index("jti", unique=True)
            await db.refresh_tokens.create_index("uid")
            await db.refresh_tokens.create_index(
                "expires_at", expireAfterSeconds=0, name="refresh_tokens_ttl",
            )

            # Phase 1 — password-reset tokens (email flow). TTL on BSON Date
            # ``expires_at``; hash is unique so a token can't be replayed twice.
            await db.password_reset_tokens.create_index("token_hash", unique=True)
            await db.password_reset_tokens.create_index("uid")
            await db.password_reset_tokens.create_index(
                "expires_at", expireAfterSeconds=0, name="password_reset_tokens_ttl",
            )

            # Phase 7b — rate-limiter buckets. ``ensure_indexes`` handles
            # TTL + unique compound so we don't duplicate that config here.
            await rate_limit_service.ensure_indexes(db)

            # Phase 8d — Binance hedger storage.
            # ``hedger_state`` is a tiny row-per-symbol runtime table (the
            # admin dashboard reads every row on load). ``hedge_trades`` is
            # append-only audit log for every hedge attempt.
            await db.hedger_state.create_index("id", unique=True)
            await db.hedge_trades.create_index("id", unique=True)
            await db.hedge_trades.create_index([("symbol", 1), ("created_at", -1)])
            await db.hedge_trades.create_index([("status", 1), ("created_at", -1)])
            await db.hedge_trades.create_index([("created_at", -1)])
            # GAP-1 — treasury mirror failure repair queue. Rows are written when
            # record_system_fill raises so ops can backfill from trades collection.
            await db.treasury_mirror_failures.create_index("id", unique=True)
            await db.treasury_mirror_failures.create_index([("resolved", 1), ("created_at", -1)])
            await db.treasury_mirror_failures.create_index([("symbol", 1), ("resolved", 1)])
            # Phase 9a — seed-capital baselines for reconciliation.
            # One row per asset (uppercase). ``qty`` defaults to 0 until
            # admin explicitly snapshots from the Hedger page.
            await db.hedger_baselines.create_index("id", unique=True)
            # Phase 9c — alerts. ``expires_at`` is a BSON Date (see
            # alert_service._ttl_target) so the TTL monitor can drop
            # aged rows automatically after 30 days.
            await db.alerts.create_index("id", unique=True)
            await db.alerts.create_index([("dedupe_key", 1), ("status", 1)])
            await db.alerts.create_index(
                [("status", 1), ("severity", 1), ("last_seen_at", -1)],
            )
            await db.alerts.create_index(
                "expires_at", expireAfterSeconds=0,
            )
            # Phase 2 — security telemetry + blocklists.
            await db.security_events.create_index("id", unique=True)
            await db.security_events.create_index([("created_at", -1)])
            await db.security_events.create_index([("type", 1), ("created_at", -1)])
            await db.security_blocks.create_index("id", unique=True)
            await db.security_blocks.create_index([("is_active", 1), ("type", 1), ("value", 1)])
            # Phase 3 — compliance workflow.
            await db.compliance_cases.create_index("id", unique=True)
            await db.compliance_cases.create_index([("status", 1), ("risk_level", 1), ("updated_at", -1)])
            await db.compliance_cases.create_index([("uid", 1), ("updated_at", -1)])
            await db.compliance_cases.create_index([("case_type", 1), ("updated_at", -1)])
            await db.wallet_blacklist.create_index("id", unique=True)
            await db.wallet_blacklist.create_index([("wallet_address_norm", 1), ("network", 1)], unique=True)
            await db.wallet_blacklist.create_index([("is_active", 1), ("updated_at", -1)])
            await db.sanctions_list.create_index("id", unique=True)
            await db.sanctions_list.create_index([("entity_name_norm", 1), ("list_source", 1)])
            await db.sanctions_list.create_index([("is_active", 1), ("updated_at", -1)])
            await db.sanctions_sync_runs.create_index("id", unique=True)
            await db.sanctions_sync_runs.create_index([("started_at", -1)])
            await db.compliance_reports.create_index("id", unique=True)
            await db.compliance_reports.create_index([("report_type", 1), ("created_at", -1)])
            await db.compliance_reports.create_index([("created_by", 1), ("created_at", -1)])
            await db.tx_monitor_events.create_index("id", unique=True)
            await db.tx_monitor_events.create_index("dedupe_key", unique=True)
            await db.tx_monitor_events.create_index([("created_at", -1)])
            await db.compliance_rules.create_index("id", unique=True)
            await db.fiu_submissions.create_index("id", unique=True)
            await db.fiu_submissions.create_index([("report_id", 1), ("submitted_at", -1)])
            await db.account_restriction_events.create_index("id", unique=True)
            await db.account_restriction_events.create_index([("uid", 1), ("created_at", -1)])
            await db.user_risk_profiles.create_index("uid", unique=True)

            # Hand the client/database to the service layer and probe
            # transaction support (requires a replica set or sharded cluster).
            # NOTE: this MUST happen before any treasury_service / wallet_service
            # call that resolves the db via ``services.db.get_db()`` — otherwise
            # those helpers raise "Database not initialised".
            txn_support = await services_db.detect_transaction_support(client)
            services_db.set_client(client, db, supports_transactions=txn_support)
            await compliance_service.seed_default_compliance_rules(db)
            if not txn_support:
                logger.warning(
                    "MongoDB is not a replica set — wallet ops will run without "
                    "multi-document transactions. Convert the deployment to a "
                    "single-node RS to enable full atomicity (Phase 1 note)."
                )

            # Phase 8 — treasury wallet rows (one per supported asset, plus
            # USDT) so the SYSTEM-fill mirror has somewhere to write to from
            # the very first fill. Idempotent: every call is an upsert.
            # Runs after ``services_db.set_client`` so treasury_service helpers
            # can resolve the db via ``get_db()``.
            _treasury_assets = sorted(
                {*SYMBOL_BASE_MAP.values(), "USDT"}
            )
            await treasury_service.bootstrap(_treasury_assets)
            await treasury_service.stamp_started_at(db.platform_controls)
            logger.info(
                "Phase 8: treasury bootstrapped for %d asset(s) — %s",
                len(_treasury_assets), ", ".join(_treasury_assets),
            )

            logger.info("MongoDB connected successfully")
        else:
            logger.warning("MONGO_URL not set — running without database")
            services_db.set_client(None, None, supports_transactions=False)
    except Exception as e:
        logger.error(f"MongoDB connection failed: {e}")
        client = None
        db = None
        services_db.set_client(None, None, supports_transactions=False)

    if SECRET_KEY == _DEFAULT_JWT_SECRET:
        logger.warning(
            "JWT_SECRET_KEY is unset or default — set a strong random secret before production deploy."
        )

    logger.info(
        "One-step signup model fields: %s (must be name, email, password only)",
        list(SignupCredentials.model_fields.keys()),
    )

    # One-time admin bootstrap (set ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD in .env)
    if db is not None:
        boot_email = os.environ.get("ADMIN_BOOTSTRAP_EMAIL", "").strip().lower()
        boot_pw = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "")
        if boot_email and boot_pw:
            existing = await db.admin_users.find_one({"email": boot_email})
            if not existing:
                aid = f"adm_{uuid.uuid4().hex[:12]}"
                await db.admin_users.insert_one({
                    "aid":           aid,
                    "email":         boot_email,
                    "name":          "Bootstrap Admin",
                    "password_hash": hash_password(boot_pw),
                    "role":          "superadmin",
                    "permissions":   ["*"],
                    "is_active":     True,
                    "created_at":    datetime.now(timezone.utc).isoformat(),
                })
                logger.info("Created bootstrap admin account: %s", boot_email)

    # ── Binance spot-price WS feed ───────────────────────────────────────
    # Seeds the in-memory price cache via REST, then hands off to the WS.
    # Must start before workers that read prices (hedger, mark-price, …).
    try:
        await _binance_spot_feed.start(BINANCE_USDT_PAIRS)
    except Exception:  # noqa: BLE001
        logger.exception("binance_spot_feed: startup failed")

    _ibo_mock_market_enabled = _env_flag_true("IBO_MOCK_MARKET")
    if db is not None:
        try:
            from ibo.pricing import refresh_deposit_driven_ibo_price

            await refresh_deposit_driven_ibo_price(controls=await get_platform_controls())
        except Exception:  # noqa: BLE001
            logger.exception("ibo pricing: startup deposit-driven refresh failed")
    if _ibo_mock_market_enabled and db is None:
        logger.warning("IBO_MOCK_MARKET is set but MongoDB is unavailable — mock market disabled")
        _ibo_mock_market_enabled = False
    elif _ibo_mock_market_enabled:
        try:
            await ibo_mock_market.engine.start()
            try:
                from listings.ibo_markets import invalidate_ibo_rows_cache
                invalidate_ibo_rows_cache()
            except Exception:  # noqa: BLE001
                pass
            logger.info("IBO mock market enabled via IBO_MOCK_MARKET")
        except Exception:  # noqa: BLE001
            logger.exception("ibo_mock_market: startup failed")
            _ibo_mock_market_enabled = False

    # ── Phase 3 — blockchain provider + deposit poller ───────────────────
    # ``get_provider()`` always returns either the real QuickNodeProvider or
    # a safe ``DisabledProvider`` (never raises), so the rest of startup is
    # unaffected by missing env vars.
    await sync_blockchain_chain_admin()
    blockchain_service.get_provider()
    # Listed tokens (IBO, …) must be in registry BEFORE the deposit poller's
    # startup backfill runs — otherwise get_scan_groups() is empty and IBO
    # deposits are never scanned (USDT uses a fixed env contract and still works).
    if db is not None:
        try:
            from listings import registry
            from listings.service import seed_platform_default_ibo

            await seed_platform_default_ibo(db, LISTINGS_DIR)
            await registry.refresh(db)
        except Exception:  # noqa: BLE001
            logger.exception("listings bootstrap failed (pre-poller)")
    # The WebSocket listener and continuous poller run when
    # DEPOSIT_POLL_ENABLED=true (recommended in production so deposits are
    # detected without the user opening Wallet → History). When false,
    # only on-demand GET /api/wallet/verify-deposit scans the chain.
    global _deposit_poller_task, _deposit_crediter_task, _withdrawal_executor_task, _hedger_worker_task, _liquidity_retry_worker_task, _finance_export_cleanup_task, _compliance_monitor_task, _web3_catalog_refresh_task  # noqa: PLW0603
    if deposit_poller._is_enabled():
        # Start the ETH WS listener BEFORE the deposit poller so new_block_event
        # is armed before the first wait() call.
        try:
            await _eth_ws_listener.start()
        except Exception:  # noqa: BLE001
            logger.exception("eth_ws_listener: startup failed")
        _deposit_poller_task = deposit_poller.start(db) if db is not None else None
    else:
        logger.info(
            "deposit_poller: disabled — on-demand verify-deposit mode active "
            "(set DEPOSIT_POLL_ENABLED=true to restore background scanning)"
        )
        _deposit_poller_task = None
    # ── Web3 catalog background refresh ─────────────────────────────────
    # Proactively refreshes the CoinGecko BSC directory on a fixed interval
    # (default 1h, controlled by BSC_WEB3_CATALOG_TTL_SEC env var) so newly
    # ranked tokens appear without waiting for a user-triggered cache miss.
    try:
        from listings.deposit_catalog import run_periodic_web3_catalog_refresh

        _web3_catalog_refresh_interval = int(
            os.getenv("BSC_WEB3_CATALOG_TTL_SEC", str(3600))
        )
        if (os.getenv("BSC_WEB3_CATALOG_ENABLED") or "").strip().lower() in ("1", "true", "yes", "on"):
            _web3_catalog_refresh_task = asyncio.ensure_future(
                run_periodic_web3_catalog_refresh(_web3_catalog_refresh_interval)
            )
            logger.info(
                "web3_catalog_refresh: scheduled every %ds", _web3_catalog_refresh_interval
            )
        else:
            _web3_catalog_refresh_task = None
    except Exception:  # noqa: BLE001
        logger.exception("web3_catalog_refresh: failed to schedule background task")
        _web3_catalog_refresh_task = None
    # ── Phase 5 — deposit auto-crediter ─────────────────────────────────
    # Separate background task so the confirmation-threshold logic can run
    # on its own cadence (faster than the poller) and be feature-flagged
    # independently. Starts only when DEPOSIT_CREDIT_ENABLED=true AND the
    # provider is configured; otherwise returns None.
    _deposit_crediter_task = (
        deposit_crediter.start(
            db,
            get_platform_controls=get_platform_controls,
            resolve_min_confirmations=resolve_min_confirmations,
            min_notional_usdt=MIN_WALLET_NOTIONAL_USDT,
            price_lookup=_cached_price_usdt,
        )
        if db is not None
        else None
    )
    # ── Phase 6 — withdrawal executor ───────────────────────────────────
    # Picks up ``approved`` withdrawal_requests, broadcasts on-chain, then
    # polls receipts until confirmations clear. Gated by the
    # ``withdrawal_auto_execute_enabled`` platform flag AND the
    # ``WITHDRAWAL_EXEC_ENABLED`` env var (so the worker can be attached
    # but paused at runtime via the admin panel).
    _withdrawal_executor_task = (
        withdrawal_executor.start(
            db,
            get_platform_controls=get_platform_controls,
            resolve_min_confirmations=resolve_min_confirmations,
            refund_quota=_refund_withdrawal_quota,
            usdt_notional=_withdrawal_usdt_notional,
        )
        if db is not None
        else None
    )
    # ── Phase 8d — Binance hedger worker ────────────────────────────────
    # Evaluates every hedgeable symbol every few seconds. Auto-execute is
    # double-gated: (1) ``HEDGER_WORKER_ENABLED=true`` env var attaches
    # the task, (2) ``hedger_enabled=true`` in platform_controls lets it
    # actually act. Symbols default to mode=off so nothing happens until
    # ops configures them from the admin panel.
    _hedger_worker_task = (
        hedger_worker.start(
            get_platform_controls=get_platform_controls,
            get_hedger_symbols=lambda: list(BINANCE_USDT_PAIRS),
            treasury_mark_fn=_cached_price_usdt,
        )
        if db is not None
        else None
    )
    _liquidity_retry_worker_task = (
        liquidity_retry_worker.start(_process_liquidity_retry_queue_once)
        if db is not None
        else None
    )
    if db is not None:
        try:
            await bootstrap_futures()
        except Exception:  # noqa: BLE001
            logger.exception("futures bootstrap failed")
        try:
            await bootstrap_options()
        except Exception:  # noqa: BLE001
            logger.exception("options bootstrap failed")
    _finance_export_cleanup_task = (
        asyncio.create_task(_finance_export_cleanup_loop())
        if db is not None
        else None
    )
    _compliance_monitor_task = (
        asyncio.create_task(_compliance_monitor_loop())
        if db is not None
        else None
    )

    # IBO admin module dependency injection — gives admin_api.py access to db
    # and platform-control helpers without circular imports.
    _ibo_register_deps(
        db=db,
        get_platform_controls=get_platform_controls,
        require_admin=resolve_admin_auth,
    )

    async def _listing_provider_network_rows() -> List[Dict[str, Any]]:
        provider: BlockchainProvider = blockchain_service.get_provider()
        return provider.list_supported_networks()

    register_listings_public(
        db=db,
        upload_dir=LISTINGS_DIR,
        rate_limit_check=rate_limit_service.check_rate_limit,
        get_platform_controls=get_platform_controls,
        get_markets_snapshot=_trading_markets_snapshot,
        get_provider_networks=_listing_provider_network_rows,
    )
    register_listings_admin(
        db=db,
        upload_dir=LISTINGS_DIR,
        resolve_admin_auth=resolve_admin_auth,
        require_admin_permission=_require_admin_permission,
        log_admin_audit=log_admin_audit,
        get_platform_controls=get_platform_controls,
        get_markets_snapshot=_trading_markets_snapshot,
        get_provider_networks=_listing_provider_network_rows,
    )
    register_inr_admin(
        db=db,
        inr_upload_dir=INR_DIR,
        get_platform_controls=get_platform_controls,
        resolve_admin_auth=resolve_admin_auth,
        require_admin_permission=_require_admin_permission,
        log_admin_audit=log_admin_audit,
    )
    # Treasury transfer module — dependency injection
    _treasury_transfer_api._register_deps(
        db_getter=lambda: db,
        auth_dep=resolve_admin_auth,
        require_permission=_require_admin_permission,
        get_blockchain_provider=blockchain_service.get_provider,
    )
    # GAP-4: Startup hedger health-check — surface misconfigurations early so
    # ops realises the hedger is inactive before any SYSTEM fills accumulate
    # unhedged exposure. These are only informational / warning logs; they do
    # not block startup.
    if db is not None:
        try:
            _ctrl_check = await get_platform_controls()
            _hedger_enabled = bool(_ctrl_check.get("hedger_enabled", False))
            _hedger_dry_run = bool(_ctrl_check.get("hedger_dry_run", False))
            _hedger_worker_env = (os.environ.get("HEDGER_WORKER_ENABLED") or "").strip().lower() in ("1", "true", "yes", "on")
            _binance_key = bool(os.environ.get("BINANCE_API_KEY") or os.environ.get("BINANCE_TESTNET_API_KEY"))
            if not _hedger_worker_env:
                logger.warning(
                    "GAP-4 health-check: HEDGER_WORKER_ENABLED is not set — "
                    "the hedger worker will not run; unhedged SYSTEM fills will accumulate."
                )
            if not _hedger_enabled:
                logger.warning(
                    "GAP-4 health-check: platform_controls.hedger_enabled=False — "
                    "all hedger symbols are paused regardless of per-symbol mode."
                )
            if _hedger_dry_run:
                logger.warning(
                    "GAP-4 health-check: platform_controls.hedger_dry_run=True — "
                    "hedger will log but NOT place orders on Binance."
                )
            if not _binance_key:
                logger.warning(
                    "GAP-4 health-check: no Binance API key found "
                    "(BINANCE_API_KEY / BINANCE_TESTNET_API_KEY) — "
                    "hedger will operate in no-credentials mode."
                )
            if _hedger_enabled and _hedger_worker_env and _binance_key and not _hedger_dry_run:
                logger.info(
                    "GAP-4 health-check: hedger worker appears correctly configured "
                    "(enabled, credentials present, live mode)."
                )
        except Exception:  # noqa: BLE001
            logger.exception("GAP-4 health-check: could not read platform_controls")


@app.on_event("shutdown")
async def shutdown_db_client():
    global client, _finance_export_cleanup_task, _compliance_monitor_task
    # Stop background workers first so they don't log spurious errors while
    # the Mongo client is being torn down.
    try:
        if _ibo_mock_market_enabled:
            await ibo_mock_market.engine.stop()
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop ibo_mock_market cleanly")
    try:
        await liquidity_retry_worker.stop(_liquidity_retry_worker_task)
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop liquidity_retry_worker cleanly")
    try:
        await shutdown_futures()
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop futures workers cleanly")
    try:
        await shutdown_options()
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop options module cleanly")
    try:
        await hedger_worker.stop(_hedger_worker_task)
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop hedger_worker cleanly")
    try:
        await withdrawal_executor.stop(_withdrawal_executor_task)
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop withdrawal_executor cleanly")
    try:
        await deposit_crediter.stop(_deposit_crediter_task)
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop deposit_crediter cleanly")
    try:
        await deposit_poller.stop(_deposit_poller_task)
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop deposit_poller cleanly")
    # Only stop the WS listener if it was actually started
    # (i.e. DEPOSIT_POLL_ENABLED=true was set at startup).
    if deposit_poller._is_enabled():
        try:
            await _eth_ws_listener.stop()
        except Exception:  # noqa: BLE001
            logger.exception("failed to stop eth_ws_listener cleanly")
    try:
        await _binance_spot_feed.stop()
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop binance_spot_feed cleanly")
    try:
        if _finance_export_cleanup_task is not None:
            _finance_export_cleanup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await _finance_export_cleanup_task
            _finance_export_cleanup_task = None
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop finance_export_cleanup task cleanly")
    try:
        if _compliance_monitor_task is not None:
            _compliance_monitor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await _compliance_monitor_task
            _compliance_monitor_task = None
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop compliance monitor task cleanly")
    try:
        if _web3_catalog_refresh_task is not None:
            _web3_catalog_refresh_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await _web3_catalog_refresh_task
    except Exception:  # noqa: BLE001
        logger.exception("failed to stop web3_catalog_refresh task cleanly")
    # Release the QuickNode httpx client if we opened one.
    try:
        provider = blockchain_service.get_provider()
        close = getattr(provider, "close", None)
        if callable(close):
            await close()
    except Exception:  # noqa: BLE001
        logger.exception("failed to close blockchain provider")
    global client, db
    if client:
        client.close()
        client = None
        db = None
        services_db.set_client(None, None, supports_transactions=False)
        logger.info("MongoDB connection closed")


# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ── Pydantic Models ───────────────────────────────────────────────────────────

class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id:        str      = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


class TokenStats(BaseModel):
    name: str
    symbol: str
    total_supply: str
    network: str
    standard: str
    contract_address: str
    decimals: int
    market_cap:     Optional[str]
    price:          Optional[str]
    holders:        Optional[str]
    volume_24h:     Optional[str]
    listing_status: str
    pancakeswap_url: Optional[str]
    bscscan_url: str


# ── Auth models ───────────────────────────────────────────────────────────────

class SignupCredentials(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
        populate_by_name=True,
        json_schema_extra={
            "examples": [
                {
                    "name": "Jane Doe",
                    "email": "jane@example.com",
                    "password": "SecureStr1!x",
                }
            ]
        },
    )

    name: str = Field(
        ...,
        min_length=2,
        max_length=50,
        description="Display name, 2–50 characters",
        validation_alias=AliasChoices(
            "name",
            "username",
            "display_name",
            "full_name",
            "fullName",
            "displayName",
        ),
    )
    email: EmailStr = Field(
        ...,
        description="Valid email address",
        validation_alias=AliasChoices("email", "emailAddress", "email_address"),
    )
    password: str = Field(
        ...,
        min_length=1,
        max_length=USER_PASSWORD_MAX_LEN,
        description="Account password",
        validation_alias=AliasChoices("password", "pass", "pwd"),
    )
    mobile: Optional[str] = Field(
        None,
        max_length=20,
        description="National mobile number (SMS OTP when AuthKey is enabled)",
        validation_alias=AliasChoices("mobile", "phone", "phone_number", "phoneNumber"),
    )
    country_code: Optional[str] = Field(
        None,
        max_length=4,
        description="Country calling code without + (defaults to AUTHKEY_SMS_COUNTRY_CODE from .env)",
        validation_alias=AliasChoices("country_code", "countryCode", "dial_code"),
    )
    referral_code: Optional[str] = Field(
        None,
        max_length=32,
        description="Sponsor's Refer & Earn code, if signing up via a referral link",
        validation_alias=AliasChoices("referral_code", "referralCode", "ref"),
    )

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return validate_strong_user_password_value(v)

    @field_validator("mobile")
    @classmethod
    def mobile_digits(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not str(v).strip():
            return None
        return str(v).strip()


class UserLogin(BaseModel):
    email:    EmailStr
    password: str = Field(..., min_length=1, max_length=USER_PASSWORD_MAX_LEN)


class UserOut(BaseModel):
    uid:        str
    email:      str
    name:       str
    created_at: str   # ISO-8601 string
    kyc_status: str = "unverified"  # unverified | pending | approved | rejected
    phone:      Optional[str] = None
    country:    Optional[str] = None
    city:       Optional[str] = None
    bio:        Optional[str] = None
    avatar_url: Optional[str] = None  # e.g. /uploads/avatars/u_xxx.jpg
    is_active:              bool = True
    user_features_paused:   bool = False
    user_trading_paused:    bool = False
    user_withdrawals_paused: bool = False
    last_login_at:          Optional[str] = None  # ISO-8601 when set
    # Phase 7a — true when the user has completed 2FA setup (``user_2fa``
    # row with ``confirmed=true``). Derived at serialisation time so stale
    # cached documents never leak a wrong enrollment state to the UI.
    two_factor_enabled:     bool = False
    safe_session:           bool = False
    anti_phishing_code:     Optional[str] = None
    pending_deletion:       bool = False


def user_doc_to_out(user: dict) -> UserOut:
    ca = user.get("created_at")
    if ca is not None and hasattr(ca, "isoformat"):
        ca = ca.isoformat()
    elif ca is not None:
        ca = str(ca)
    else:
        ca = ""
    lia = user.get("last_login_at")
    if lia is not None and hasattr(lia, "isoformat"):
        lia = lia.isoformat()
    elif lia is not None:
        lia = str(lia)
    else:
        lia = None
    return UserOut(
        uid=user["uid"],
        email=user["email"],
        name=user["name"],
        created_at=ca,
        kyc_status=user.get("kyc_status", "unverified"),
        phone=user.get("phone"),
        country=user.get("country"),
        city=user.get("city"),
        bio=user.get("bio"),
        avatar_url=user.get("avatar_url"),
        is_active=bool(user.get("is_active", True)),
        user_features_paused=bool(user.get("user_features_paused", False)),
        user_trading_paused=bool(user.get("user_trading_paused", False)),
        user_withdrawals_paused=bool(user.get("user_withdrawals_paused", False)),
        last_login_at=lia,
        # ``two_factor_enabled`` is a derived field — the source of truth is
        # the ``user_2fa`` collection. Callers that have already resolved it
        # can short-circuit by seeding ``user['two_factor_enabled']``.
        two_factor_enabled=bool(user.get("two_factor_enabled", False)),
        safe_session=bool(user.get("safe_session", False)),
        anti_phishing_code=user.get("anti_phishing_code") or None,
        pending_deletion=bool(user.get("pending_deletion", False)),
    )


class TokenResponse(BaseModel):
    access_token:  str
    # Phase 7b — long-lived refresh token. Optional for backward compat so
    # pre-7b clients that don't know about it still parse the payload
    # cleanly; new clients use it with ``POST /auth/refresh`` to rotate
    # without re-entering credentials.
    refresh_token: Optional[str] = None
    token_type:    str = "bearer"
    user:          UserOut


class RegisterVerify(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    email: EmailStr
    code:  str = Field(..., min_length=1, max_length=32)


class RegisterEmailOtpRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    email: EmailStr
    mobile: Optional[str] = Field(
        None,
        max_length=20,
        validation_alias=AliasChoices("mobile", "phone", "phone_number"),
    )
    country_code: Optional[str] = Field(
        None,
        max_length=4,
        validation_alias=AliasChoices("country_code", "countryCode", "dial_code"),
    )
    referral_code: Optional[str] = Field(
        None,
        max_length=32,
        validation_alias=AliasChoices("referral_code", "referralCode", "ref"),
    )


class RegisterMobileOtpRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    mobile: str = Field(..., max_length=20)
    country_code: Optional[str] = Field(
        None,
        max_length=4,
        validation_alias=AliasChoices("country_code", "countryCode", "dial_code"),
    )
    email: Optional[EmailStr] = None
    referral_code: Optional[str] = Field(
        None,
        max_length=32,
        validation_alias=AliasChoices("referral_code", "referralCode", "ref"),
    )


class RegisterMobileVerify(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    code: str = Field(..., min_length=1, max_length=32)
    email: Optional[EmailStr] = None
    mobile: str = Field(..., max_length=20)
    country_code: Optional[str] = Field(
        None,
        max_length=4,
        validation_alias=AliasChoices("country_code", "countryCode", "dial_code"),
    )


class RegisterCompleteRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    email: EmailStr
    name: str = Field(..., min_length=2, max_length=80)
    password: str = Field(..., min_length=1, max_length=USER_PASSWORD_MAX_LEN)
    mobile: Optional[str] = Field(None, max_length=20)
    country_code: Optional[str] = Field(
        None,
        max_length=4,
        validation_alias=AliasChoices("country_code", "countryCode", "dial_code"),
    )
    referral_code: Optional[str] = Field(
        None,
        max_length=32,
        validation_alias=AliasChoices("referral_code", "referralCode", "ref"),
    )

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return validate_strong_user_password_value(v)


class RegisterRequestResponse(BaseModel):
    ok:         bool = True
    message:    str
    email_hint: str = ""
    phone_hint: str = ""
    verify_channel: str = "both"  # email | sms | both


class RegisterVerifyStepResponse(BaseModel):
    ok: bool = True
    message: str
    next_step: str = "mobile"  # mobile | complete


class AdminLogin(BaseModel):
    email:    EmailStr
    password: str


class AdminOut(BaseModel):
    aid:        str
    email:      str
    name:       str
    role:       str
    permissions: List[str] = []
    is_active:  bool
    created_at: str


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    admin:        AdminOut


class AdminCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    name: str = Field("", max_length=80)
    role: str = Field("support", pattern="^(superadmin|support|finance|operations|compliance|viewer)$")
    permissions: List[str] = Field(default_factory=list, max_length=50)


class AdminPatch(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    role: Optional[str] = Field(None, pattern="^(superadmin|support|finance|operations|compliance|viewer)$")
    permissions: Optional[List[str]] = Field(None, max_length=50)
    is_active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=8)


class SupportTicketCreate(BaseModel):
    subject: str = Field(..., min_length=5, max_length=160)
    category: str = Field("general", pattern=r"^(general|deposit|withdrawal|trade|kyc|security|other|dispute)$")
    priority: str = Field("normal", pattern=r"^(low|normal|high|urgent)$")
    message: str = Field(..., min_length=5, max_length=5000)
    order_id: Optional[str] = Field(None, max_length=120)
    trade_id: Optional[str] = Field(None, max_length=120)
    dispute_kind: Optional[str] = Field(None, max_length=80)


class SupportTicketMessageCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=5000)
    internal_note: bool = False


class SupportTicketPatch(BaseModel):
    status: Optional[str] = Field(None, pattern=r"^(open|in_progress|waiting_user|resolved|closed)$")
    priority: Optional[str] = Field(None, pattern=r"^(low|normal|high|urgent)$")
    assignee_aid: Optional[str] = Field(None, max_length=80)


class PlatformControlsPatch(BaseModel):
    maintenance_mode: Optional[bool] = None
    signup_enabled: Optional[bool] = None
    sms_dev_otp_enabled: Optional[bool] = None
    sms_dev_otp_code: Optional[str] = Field(None, min_length=6, max_length=6, pattern=r"^\d{6}$")
    email_otp_service_enabled: Optional[bool] = None
    sms_otp_service_enabled: Optional[bool] = None
    signup_bonus_ibo: Optional[float] = Field(None, ge=0.0, le=10_000_000.0)
    login_enabled: Optional[bool] = None
    trading_enabled: Optional[bool] = None
    kyc_enabled: Optional[bool] = None
    kyc_mode: Optional[str] = Field(None, pattern=r"^(manual|auto|disabled)$")
    bank_verify_mode: Optional[str] = Field(None, pattern=r"^(auto|manual|disabled)$")
    wallet_enabled: Optional[bool] = None
    profile_enabled: Optional[bool] = None
    maker_fee_rate: Optional[float] = Field(None, ge=0.0, le=0.05)
    taker_fee_rate: Optional[float] = Field(None, ge=0.0, le=0.05)
    withdraw_fee_rate: Optional[float] = Field(None, ge=0.0, le=0.2)
    withdraw_min_usdt: Optional[float] = Field(None, ge=0.0)
    withdraw_max_usdt: Optional[float] = Field(None, ge=0.0)
    withdraw_daily_limit_usdt: Optional[float] = Field(None, ge=0.0)
    withdraw_gas_fee_ibo: Optional[float] = Field(None, ge=0.0)
    withdraw_gas_fee_ibo_by_chain: Optional[Dict[str, float]] = None
    swap_fee_rate: Optional[float] = Field(None, ge=0.0, le=0.05)
    swap_fee_ibo_fixed: Optional[float] = Field(None, ge=0.0)
    # Phase 2 — new controls (exposed for PATCH). All are optional so existing
    # callers that only touch fees/limits keep working unchanged.
    withdrawal_auto_approve_limit_usdt: Optional[float] = Field(None, ge=0.0)
    deposit_min_confirmations: Optional[int] = Field(None, ge=0, le=100)
    # Phase 5 — per-asset confirmation overrides. Keys must be uppercase
    # asset symbols ("BTC", "ETH", "USDT"). Values must be non-negative
    # integers. Empty dict clears all overrides.
    deposit_min_confirmations_by_asset: Optional[Dict[str, int]] = None
    credit_requires_kyc_approval: Optional[bool] = None
    deposit_auto_credit_enabled: Optional[bool] = None
    # Admin-panel equivalent of the DEPOSIT_SWEEP_LIVE_ENABLED env var.
    # When True, "confirm_live" deposit sweeps broadcast real on-chain transactions.
    deposit_sweep_live_enabled: Optional[bool] = None
    withdrawal_auto_execute_enabled: Optional[bool] = None
    two_factor_enabled: Optional[bool] = None
    two_factor_required_for_withdrawal: Optional[bool] = None
    # Phase 7b — rate-limit tuning knobs (admins can patch these live).
    rate_limit_enabled: Optional[bool] = None
    rate_limit_login_per_ip_per_min: Optional[int] = Field(None, ge=0, le=1000)
    rate_limit_login_per_email_per_hr: Optional[int] = Field(None, ge=0, le=10000)
    rate_limit_register_per_ip_per_min: Optional[int] = Field(None, ge=0, le=1000)
    rate_limit_2fa_per_uid_per_min: Optional[int] = Field(None, ge=0, le=1000)
    rate_limit_withdraw_per_uid_per_min: Optional[int] = Field(None, ge=0, le=1000)
    rate_limit_withdraw_per_uid_per_day: Optional[int] = Field(None, ge=0, le=100000)
    # Phase 8 — Liquidity & Risk
    system_spread_bps_default: Optional[float] = Field(None, ge=0.0, le=1000.0)
    system_spread_bps_by_symbol: Optional[Dict[str, float]] = None
    system_liquidity_enabled: Optional[bool] = None
    treasury_inventory_limit_base_by_symbol: Optional[Dict[str, float]] = None
    # Phase 5 — order/exposure risk caps.
    risk_max_order_notional_usdt: Optional[float] = Field(None, ge=0.0)
    risk_max_open_notional_usdt: Optional[float] = Field(None, ge=0.0)
    risk_max_order_notional_usdt_by_symbol: Optional[Dict[str, float]] = None
    risk_max_open_notional_usdt_by_symbol: Optional[Dict[str, float]] = None
    # Phase 8d — Binance hedger knobs. ``hedger_by_symbol`` is a freeform
    # dict-of-dicts (``{symbol: {mode, rebalance_threshold, ...}}``); see
    # PLATFORM_CONTROL_DEFAULTS for the full shape. We validate the
    # individual entries on the dedicated PATCH endpoint instead of baking
    # it into the Pydantic model so admins can clear a single symbol by
    # passing ``null``.
    hedger_enabled: Optional[bool] = None
    hedger_dry_run: Optional[bool] = None
    hedger_default_mode: Optional[str] = Field(None, pattern=r"^(off|manual|auto)$")
    hedger_price_sanity_bps: Optional[float] = Field(None, ge=0.0, le=10000.0)
    hedger_by_symbol: Optional[Dict[str, Any]] = None
    # Phase 9a — reconciliation thresholds (admin-tunable).
    hedger_reconcile_warn_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    hedger_reconcile_warn_usd: Optional[float] = Field(None, ge=0.0)
    hedger_reconcile_critical_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    hedger_reconcile_critical_usd: Optional[float] = Field(None, ge=0.0)
    # Phase 10 — Binance liquidity routing + consistency controls.
    liquidity_mode: Optional[str] = Field(None, pattern=r"^(OFF|HEDGE_ONLY|BINANCE_BACKSTOP)$")
    binance_liquidity_enabled: Optional[bool] = None
    binance_execution_mode: Optional[str] = Field(None, pattern=r"^(dry_run|live|shadow)$")
    binance_kill_switch: Optional[bool] = None
    binance_allowed_symbols: Optional[List[str]] = None
    binance_rollout_symbols: Optional[List[str]] = None
    binance_rollout_users: Optional[List[str]] = None
    binance_rollout_percent: Optional[int] = Field(None, ge=0, le=100)
    binance_max_notional_per_order: Optional[float] = Field(None, ge=0.0)
    binance_max_notional_per_day: Optional[float] = Field(None, ge=0.0)
    binance_slippage_bps_limit: Optional[float] = Field(None, ge=0.0, le=10000.0)
    binance_latency_threshold_ms: Optional[float] = Field(None, ge=0.0)
    binance_quote_stale_ms: Optional[float] = Field(None, ge=0.0)
    binance_last_look_bps: Optional[float] = Field(None, ge=0.0, le=10000.0)
    binance_cb_failure_threshold: Optional[int] = Field(None, ge=1, le=1000)
    binance_cb_cooldown_sec: Optional[float] = Field(None, ge=0.0)
    liquidity_max_abs_exposure_base_by_symbol: Optional[Dict[str, float]] = None
    # Phase 9c — alerts. Empty ``alert_webhook_url`` disables webhook
    # delivery entirely (alerts still log to DB). ``min_severity`` is
    # validated against the known severity set.
    alert_webhook_url: Optional[str] = Field(None, max_length=500)
    alert_webhook_min_severity: Optional[str] = Field(None, pattern=r"^(info|warn|critical)$")
    # Coming Soon / Launch gate
    coming_soon_enabled: Optional[bool] = None
    coming_soon_message: Optional[str] = Field(None, max_length=500)
    coming_soon_launch_date: Optional[str] = Field(None, max_length=50)
    # QuickNode / JSON-RPC per-chain enablement (btc, eth, bsc, tron, solana).
    blockchain_chain_settings: Optional[Dict[str, Any]] = None
    # Refer & Earn (MLM referral)
    referral_enabled: Optional[bool] = None
    referral_levels: Optional[List[Dict[str, Any]]] = None
    referral_flat_from_level: Optional[int] = Field(None, ge=0, le=20)
    referral_flat_amount_ibo: Optional[float] = Field(None, ge=0.0, le=1_000_000.0)
    referral_share_website_url: Optional[str] = Field(None, max_length=500)
    referral_share_playstore_url: Optional[str] = Field(None, max_length=500)
    note: Optional[str] = Field(None, max_length=300)


class MarketPairCreate(BaseModel):
    symbol: str = Field(..., min_length=6, max_length=20)
    base_asset: Optional[str] = Field(None, min_length=1, max_length=12)
    quote_asset: str = Field("USDT", min_length=3, max_length=12)
    is_active: bool = True
    maker_fee_rate: float = Field(0.001, ge=0.0, le=0.05)
    taker_fee_rate: float = Field(0.001, ge=0.0, le=0.05)


class MarketPairPatch(BaseModel):
    is_active: Optional[bool] = None
    maker_fee_rate: Optional[float] = Field(None, ge=0.0, le=0.05)
    taker_fee_rate: Optional[float] = Field(None, ge=0.0, le=0.05)


class MobileReleasePublishPatch(BaseModel):
    published: bool


class MobileAppDistributionPatch(BaseModel):
    distribution: Optional[str] = None
    google_play_url: Optional[str] = None


class LandingPromoCoinPatch(BaseModel):
    enabled: Optional[bool] = None
    brand_label: Optional[str] = None
    title: Optional[str] = None
    tagline_1: Optional[str] = None
    tagline_2: Optional[str] = None
    status_line: Optional[str] = None
    event_line: Optional[str] = None
    cta_url: Optional[str] = None
    cta_label: Optional[str] = None
    image_url: Optional[str] = None


class LandingPromoAppPatch(BaseModel):
    enabled: Optional[bool] = None
    headline: Optional[str] = None
    description: Optional[str] = None
    subheadline: Optional[str] = None
    features: Optional[str] = None
    cta_label: Optional[str] = None
    image_url: Optional[str] = None


class LandingPromoPatch(BaseModel):
    enabled: Optional[bool] = None
    auto_scroll_seconds: Optional[int] = Field(None, ge=2, le=30)
    dismiss_hours: Optional[int] = Field(None, ge=1, le=720)
    coin: Optional[LandingPromoCoinPatch] = None
    app: Optional[LandingPromoAppPatch] = None


class AppHomeBannerSettingsPatch(BaseModel):
    enabled: Optional[bool] = None
    auto_scroll_seconds: Optional[int] = Field(None, ge=3, le=30)


class AppHomeBannerCreate(BaseModel):
    enabled: Optional[bool] = True
    sort_order: Optional[int] = None
    badge: Optional[str] = None
    title: Optional[str] = Field(None, max_length=120)
    subtitle: Optional[str] = Field(None, max_length=240)
    cta_label: Optional[str] = Field(None, max_length=64)
    cta_action: Optional[str] = Field("none", max_length=32)
    cta_url: Optional[str] = Field(None, max_length=512)
    gradient_start: Optional[str] = None
    gradient_end: Optional[str] = None
    overlay_opacity: Optional[float] = Field(None, ge=0.0, le=1.0)


class AppHomeBannerPatch(BaseModel):
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None
    badge: Optional[str] = None
    title: Optional[str] = Field(None, min_length=1, max_length=120)
    subtitle: Optional[str] = None
    cta_label: Optional[str] = None
    cta_action: Optional[str] = None
    cta_url: Optional[str] = None
    gradient_start: Optional[str] = None
    gradient_end: Optional[str] = None
    overlay_opacity: Optional[float] = Field(None, ge=0.0, le=1.0)


def admin_doc_to_out(doc: dict) -> AdminOut:
    ca = doc.get("created_at")
    if ca is not None and hasattr(ca, "isoformat"):
        ca = ca.isoformat()
    elif ca is not None:
        ca = str(ca)
    else:
        ca = ""
    return AdminOut(
        aid=doc["aid"],
        email=doc["email"],
        name=doc.get("name", ""),
        role=doc.get("role", "support"),
        permissions=[str(p) for p in (doc.get("permissions") or []) if str(p)],
        is_active=bool(doc.get("is_active", True)),
        created_at=ca,
    )


class ImpersonateResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user:         UserOut
    impersonation: Dict[str, Any]


# ── Wallet / Ledger models ────────────────────────────────────────────────────

# Assets supported for deposit & withdrawal (align with SYMBOL_BASE_MAP bases + USDT)
SUPPORTED_ASSETS = [
    "USDT", "IBO", "BTC", "ETH", "BNB", "TRX", "SOL", "XRP", "DOGE", "ADA", "POL",
    "AVAX", "DOT", "LINK", "LTC",
]

# Networks per asset (manual review flow — not on-chain verification)
ASSET_NETWORKS: Dict[str, List[str]] = {
    "USDT": ["BEP-20 (BNB Chain)", "ERC-20 (Ethereum)", "TRC-20 (Tron)"],
    "IBO":  ["BEP-20 (BNB Chain)"],
    "BTC":  ["Bitcoin Network", "BEP-20 (BNB Chain)"],
    "ETH":  ["ERC-20 (Ethereum)", "BEP-20 (BNB Chain)"],
    "BNB":  ["BEP-20 (BNB Chain)"],
    "TRX":  ["TRC-20 (Tron)"],
    "SOL":  ["Solana"],
    "XRP":  ["XRP Ledger", "BEP-20 (BNB Chain)"],
    "DOGE": ["Dogecoin Network", "BEP-20 (BNB Chain)"],
    "ADA":  ["Cardano", "BEP-20 (BNB Chain)"],
    "POL": ["Polygon PoS", "BEP-20 (BNB Chain)"],
    "AVAX": ["Avalanche C-Chain", "BEP-20 (BNB Chain)"],
    "DOT":  ["Polkadot", "BEP-20 (BNB Chain)"],
    "LINK": ["ERC-20 (Ethereum)", "BEP-20 (BNB Chain)"],
    "LTC":  ["Litecoin Network", "BEP-20 (BNB Chain)"],
}

# Phase 5 — dust filter. Any deposit whose USDT-equivalent notional falls
# below this threshold is kept on record (for audit) but not credited; it
# shows up in the Wallet history as ``below_min``. Configurable so ops can
# tighten/loosen per deployment without a redeploy.
MIN_WALLET_NOTIONAL_USDT: float = float(os.environ.get("MIN_WALLET_NOTIONAL_USDT", "1.0"))


class WalletBalanceOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    asset:     str
    available: float = 0.0
    locked:    float = 0.0


class DepositCreate(BaseModel):
    asset:    str
    amount:   float = Field(..., gt=0)
    tx_hash:  str   = Field(..., min_length=4, description="Transaction hash or payment reference")
    network:  str
    notes:    Optional[str] = None
    deposit_address_id: Optional[str] = Field(
        None,
        description="Optional platform hot-wallet id the user sent to (from /wallet/deposit-addresses)",
    )


class DepositOut(BaseModel):
    id:          str
    uid:         str
    asset:       str
    amount:      float
    tx_hash:     str
    network:     str
    notes:       Optional[str]
    status:      str
    created_at:  str
    reviewed_at: Optional[str] = None
    deposit_address_id: Optional[str] = None


class DepositAddressPublic(BaseModel):
    """Enabled hot-wallet row for the exchange wallet UI."""

    id: str
    asset: str
    network: str
    address: str
    qr_payload: str
    label: Optional[str] = None


class DepositAddressAdminOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    asset: str
    network: str
    address: str
    qr_override: Optional[str] = None
    qr_payload: str
    label: Optional[str] = None
    enabled: bool
    sort_order: int
    created_at: str
    updated_at: str
    # Phase 3 — per-user HD address metadata (null for shared admin rows).
    uid: Optional[str] = None
    derivation_path: Optional[str] = None
    derivation_index: Optional[int] = None
    provider: Optional[str] = None
    created_by: Optional[str] = None
    last_checked_at: Optional[str] = None


class DepositAddressCreate(BaseModel):
    asset: str
    network: str
    address: str = Field(..., min_length=4, max_length=500)
    qr_override: Optional[str] = Field(
        None,
        max_length=2000,
        description="If set, QR codes encode this (e.g. payment URI) instead of the raw address",
    )
    label: Optional[str] = Field(None, max_length=120)
    enabled: bool = True
    sort_order: int = 0


class DepositAddressPatch(BaseModel):
    asset: Optional[str] = None
    network: Optional[str] = None
    address: Optional[str] = Field(None, min_length=4, max_length=500)
    qr_override: Optional[str] = Field(None, max_length=2000)
    label: Optional[str] = Field(None, max_length=120)
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class WithdrawalCreate(BaseModel):
    asset:   str
    amount:  float  = Field(..., gt=0)
    address: str    = Field(..., min_length=5, description="Destination wallet address")
    network: str
    memo:    Optional[str] = None


class WithdrawalOut(BaseModel):
    id:          str
    uid:         str
    asset:       str
    amount:      float
    address:     str
    network:     str
    memo:        Optional[str]
    fee_rate:    float = 0.0
    fee_amount:  float = 0.0
    net_amount:  float = 0.0
    amount_usdt: float = 0.0
    status:      str
    created_at:  str
    reviewed_at: Optional[str] = None


class AdminActionBody(BaseModel):
    notes: Optional[str] = None


class SecurityBlockCreate(BaseModel):
    type: str = Field(..., pattern=r"^(ip|country)$")
    value: str = Field(..., min_length=1, max_length=120)
    reason: Optional[str] = Field(None, max_length=300)


class SecurityBlockPatch(BaseModel):
    is_active: Optional[bool] = None
    reason: Optional[str] = Field(None, max_length=300)


class ComplianceCaseCreate(BaseModel):
    case_type: str = Field(..., pattern=r"^(sar|str|aml_review)$")
    uid: Optional[str] = None
    title: str = Field(..., min_length=3, max_length=200)
    notes: Optional[str] = Field(None, max_length=4000)
    risk_level: str = Field("medium", pattern=r"^(low|medium|high|critical)$")


class ComplianceCasePatch(BaseModel):
    status: Optional[str] = Field(None, pattern=r"^(open|in_review|escalated|resolved|closed)$")
    assignee_aid: Optional[str] = Field(None, max_length=80)
    notes: Optional[str] = Field(None, max_length=4000)
    risk_level: Optional[str] = Field(None, pattern=r"^(low|medium|high|critical)$")


class ComplianceAttachmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    url: str = Field(..., min_length=3, max_length=600)
    mime_type: Optional[str] = Field(None, max_length=120)
    note: Optional[str] = Field(None, max_length=1000)


class KycRiskPatch(BaseModel):
    risk_tags: List[str] = Field(default_factory=list, max_length=30)
    pep_flag: Optional[bool] = None
    sanctions_flag: Optional[bool] = None
    note: Optional[str] = Field(None, max_length=500)


class ComplianceWalletBlacklistCreate(BaseModel):
    wallet_address: str = Field(..., min_length=4, max_length=160)
    network: str = Field(..., min_length=2, max_length=120)
    reason: Optional[str] = Field(None, max_length=500)
    risk_level: str = Field("high", pattern=r"^(medium|high|critical)$")


class ComplianceWalletBlacklistPatch(BaseModel):
    is_active: Optional[bool] = None
    reason: Optional[str] = Field(None, max_length=500)
    risk_level: Optional[str] = Field(None, pattern=r"^(medium|high|critical)$")


class ComplianceSanctionCreate(BaseModel):
    entity_name: str = Field(..., min_length=2, max_length=200)
    list_source: str = Field("manual", min_length=2, max_length=120)
    reference_id: Optional[str] = Field(None, max_length=120)
    country: Optional[str] = Field(None, max_length=80)
    risk_level: str = Field("high", pattern=r"^(medium|high|critical)$")
    aliases: List[str] = Field(default_factory=list, max_length=40)
    notes: Optional[str] = Field(None, max_length=800)


class ComplianceSanctionPatch(BaseModel):
    is_active: Optional[bool] = None
    risk_level: Optional[str] = Field(None, pattern=r"^(medium|high|critical)$")
    notes: Optional[str] = Field(None, max_length=800)


class ComplianceScreeningConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    min_match_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    fail_closed: Optional[bool] = None
    block_on_wallet_blacklist: Optional[bool] = None
    block_on_sanctions: Optional[bool] = None
    monitor_large_trade_usdt: Optional[float] = Field(None, ge=0.0)
    monitor_daily_turnover_usdt: Optional[float] = Field(None, ge=0.0)
    velocity_withdraw_count_24h: Optional[int] = Field(None, ge=1, le=500)


class ComplianceReportCreate(BaseModel):
    report_type: str = Field(..., pattern=r"^(str|ctr)$")
    date_from: str
    date_to: str
    output_format: str = Field("csv", pattern=r"^(csv|xlsx|json)$")
    threshold_usdt: Optional[float] = Field(None, ge=0.0)
    notes: Optional[str] = Field(None, max_length=1000)


class ComplianceMonitorRunBody(BaseModel):
    large_trade_usdt: Optional[float] = Field(None, ge=0.0)
    daily_turnover_usdt: Optional[float] = Field(None, ge=0.0)
    emit_cases: bool = False


class ComplianceRuleCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., min_length=2, max_length=160)
    rule_kind: str = Field(
        ...,
        pattern=r"^(builtin_large_trade|builtin_high_turnover|builtin_withdraw_velocity)$",
    )
    params: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class ComplianceRulePatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: Optional[str] = Field(None, min_length=2, max_length=160)
    enabled: Optional[bool] = None
    params: Optional[Dict[str, Any]] = None


class AccountFreezeBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scope: str = Field("full", pattern=r"^(full|trading|withdrawals)$")
    reason: str = Field(..., min_length=3, max_length=500)
    frozen_until: Optional[str] = Field(None, max_length=40)


class KycTierPatch(BaseModel):
    kyc_tier: str = Field(..., pattern=r"^(tier_0|tier_1|tier_2)$")


class WalletAdjustmentCreate(BaseModel):
    direction: str = Field(..., pattern="^(credit|debit)$")
    asset: str
    amount: float = Field(..., gt=0)
    note: Optional[str] = Field(None, max_length=300)


# ── Order / Trade models ──────────────────────────────────────────────────────

# Fee rates (Phase 5 — applied from day one)
MAKER_FEE_RATE = 0.001   # 0.1 %
TAKER_FEE_RATE = 0.001   # 0.1 %

# Map every supported symbol → base asset (must match exchange UI listed pairs)
SYMBOL_BASE_MAP: Dict[str, str] = {
    "IBOUSDT":  "IBO",  "BTCUSDT":  "BTC",  "ETHUSDT":  "ETH",
    "BNBUSDT":  "BNB",  "SOLUSDT":  "SOL",  "XRPUSDT":  "XRP",
    "DOGEUSDT": "DOGE", "ADAUSDT":  "ADA",  "POLUSDT": "POL",
    "AVAXUSDT": "AVAX", "DOTUSDT":  "DOT",  "LINKUSDT": "LINK",
    "LTCUSDT":  "LTC",
    # IBO-quoted pairs (IBO as quote asset)
    **IBO_QUOTED_SYMBOL_MAP,
}

# Quote asset per symbol (defaults to "USDT"; IBO-quoted pairs use "IBO")
SYMBOL_QUOTE_MAP: Dict[str, str] = {
    sym: "USDT" for sym in SYMBOL_BASE_MAP
}
for _ibo_sym in IBO_QUOTED_PAIRS:
    SYMBOL_QUOTE_MAP[_ibo_sym] = "IBO"


def trading_symbol_allowed(sym: str) -> bool:
    """Static + listed + dynamic Web3 IBO-quoted symbols."""
    s = (sym or "").upper()
    from listings.integration import effective_symbol_base_map

    return s in effective_symbol_base_map(SYMBOL_BASE_MAP)


# Binance-quoted pairs we proxy (all except internal IBO). Order = default UI sort.
BINANCE_USDT_PAIRS: List[str] = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "POLUSDT",
    "AVAXUSDT", "DOTUSDT", "LINKUSDT", "LTCUSDT",
]

# Fallback mid prices when Binance is unreachable (order matching / P&L only)
FALLBACK_PRICES: Dict[str, float] = {
    "IBOUSDT": 0.4523,
    "BTCUSDT": 84500.0, "ETHUSDT": 3200.0,  "BNBUSDT": 580.0,
    "SOLUSDT": 145.0,   "XRPUSDT": 0.52,    "DOGEUSDT": 0.12,
    "ADAUSDT": 0.45,    "POLUSDT": 0.45,  "AVAXUSDT": 36.0,
    "DOTUSDT": 7.0,     "LINKUSDT": 15.0,   "LTCUSDT": 85.0,
    # RWA index fallback only — XAUT is NOT in BINANCE_USDT_PAIRS (spot Markets stay crypto-only).
    "XAUTUSDT": 4000.0,
    # IBO-quoted pair fallbacks (price in IBO = base_usdt / ibo_price)
    **{sym: round(IBO_PAIR_FALLBACK_USDT.get(base, 1.0) / 0.4523, 4)
       for sym, base in IBO_QUOTED_SYMBOL_MAP.items()},
}


def _normalize_binance_24h(t: Dict[str, Any]) -> Dict[str, Any]:
    """Shape24h ticker for clients (aligns with internal IBO ticker fields)."""
    lp = t.get("lastPrice") or "0"
    return {
        "symbol":             t["symbol"],
        "price":              lp,
        "priceChange":        t.get("priceChange", "0"),
        "priceChangePercent": t.get("priceChangePercent", "0"),
        "highPrice":          t.get("highPrice", lp),
        "lowPrice":           t.get("lowPrice", lp),
        "volume":             t.get("volume", "0"),
        "quoteVolume":        t.get("quoteVolume", "0"),
        "openPrice":          t.get("openPrice", lp),
        "weightedAvgPrice":   t.get("weightedAvgPrice") or lp,
        "bidPrice":           t.get("bidPrice") or lp,
        "askPrice":           t.get("askPrice") or lp,
        "prevClosePrice":     t.get("prevClosePrice"),
        "count":              str(t.get("count", "0")),
    }


def _market_row_from_binance_ticker(t: Dict[str, Any]) -> Dict[str, Any]:
    sym = str(t.get("symbol") or "").upper()
    base = sym[:-4] if sym.endswith("USDT") else sym.replace("USDT", "")
    n = _normalize_binance_24h({**t, "symbol": sym})
    return {
        "symbol":             sym,
        "base":               base,
        "baseAsset":          base,
        "quoteAsset":         "USDT",
        "source":             "binance",
        "stats_source":       "binance",
        **n,
    }


class OrderCreate(BaseModel):
    symbol: str
    side:   str             # "buy" | "sell"
    type:   str             # "limit" | "market"
    amount: float = Field(..., gt=0)
    price:  Optional[float] = None   # required for limit orders


class OrderOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id:             str
    uid:            str
    symbol:         str
    side:           str
    type:           str
    status:         str
    price:          float
    amount:         float
    filled:         float = 0.0
    remaining:      float
    avg_price:      float = 0.0
    total_fee:      float = 0.0
    total_fee_asset: str  = "IBO"
    created_at:     str
    updated_at:     str


class UserTradeOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id:         str
    symbol:     str
    side:       str
    price:      float
    amount:     float
    fee:        float
    fee_asset:  str
    order_id:   str
    created_at: str
    # Average-cost realized P&L in USDT for this fill when ``side`` is ``sell``; null for buys.
    realized_pnl: Optional[float] = None
    liquidity_source: Optional[str] = None


class ClosePositionBody(BaseModel):
    """
    Reduce/close spot holding by selling available base (not locked).
    - Default: market-sell 100% of available.
    - ``amount``: sell this much base (capped by available).
    - ``fraction``: 0–1, sell this share of available (e.g. 0.5 = half).
    - ``order_type``: ``market`` (immediate) or ``limit`` (rests until filled; requires ``price``).
    """
    symbol: str
    order_type: str = "market"  # market | limit
    amount: Optional[float] = Field(default=None, gt=0)
    fraction: Optional[float] = Field(default=None, gt=0, le=1)
    price: Optional[float] = Field(default=None, gt=0)


MIN_BASE_AMOUNT = 0.0001
MIN_ORDER_VALUE_USDT = 1.0
# Spot closes can be small (e.g. low-priced tokens); regular orders still use MIN_ORDER_VALUE_USDT.
MIN_ORDER_VALUE_USDT_CLOSE = 0.01


def _safe_sell_base_qty(requested: float, available: float) -> float:
    """
    Clamp SELL size so we never lock more base than `available`.
    Prevents 'Insufficient {asset}' on full/partial closes when float math or
    rounding would otherwise ask for slightly more than the wallet has.
    """
    if requested <= 0 or available <= 0:
        return 0.0
    max_q = math.floor(available * 1e8 + 1e-12) / 1e8
    req = min(float(requested), float(available))
    req = math.floor(req * 1e8 + 1e-12) / 1e8
    return min(req, max_q)


def _kyc_trading_gate(user_doc: Optional[dict]) -> None:
    kyc_status = (user_doc or {}).get("kyc_status", "unverified")
    if kyc_status == "approved":
        return
    msg_map = {
        "unverified": "Identity verification (KYC) is required before trading. "
                      "Please go to Profile → KYC Verification to submit your documents.",
        "pending":    "Your KYC application is under review. "
                      "Trading will be enabled once your identity is verified (1–2 business days).",
        "rejected":   "Your KYC was rejected. Please resubmit with valid documents "
                      "via Profile → KYC Verification.",
    }
    raise HTTPException(403, msg_map.get(kyc_status, "KYC verification required to trade."))


def _kyc_wallet_gate(user_doc: Optional[dict]) -> None:
    """Require approved KYC before manual deposit / withdrawal requests (aligned with trading gate)."""
    kyc_status = (user_doc or {}).get("kyc_status", "unverified")
    if kyc_status == "approved":
        return
    msg_map = {
        "unverified": "Identity verification (KYC) is required before deposits or withdrawals. "
                      "Submit your documents under KYC Verification.",
        "pending":    "Your KYC is under review. Deposits and withdrawals are enabled after an administrator approves your application.",
        "rejected":   "Your KYC was rejected. Resubmit valid documents under KYC Verification before depositing or withdrawing.",
    }
    raise HTTPException(403, msg_map.get(kyc_status, "KYC verification required for wallet transfers."))


def _deposit_asset_network_ok(asset: str, network: str) -> bool:
    from listings.wallet_assets import deposit_asset_network_ok

    return deposit_asset_network_ok(asset, network)


def _qr_payload_from_deposit_address_doc(doc: dict) -> str:
    o = (doc.get("qr_override") or "").strip()
    if o:
        return o
    return (doc.get("address") or "").strip()


def _deposit_address_admin_out(doc: dict) -> DepositAddressAdminOut:
    return DepositAddressAdminOut(
        id=doc["id"],
        asset=doc.get("asset", ""),
        network=doc.get("network", ""),
        address=doc.get("address", ""),
        qr_override=(doc.get("qr_override") or None) or None,
        qr_payload=_qr_payload_from_deposit_address_doc(doc),
        label=(doc.get("label") or None) or None,
        enabled=bool(doc.get("enabled", True)),
        sort_order=int(doc.get("sort_order", 0) or 0),
        created_at=str(doc.get("created_at") or ""),
        updated_at=str(doc.get("updated_at") or ""),
        uid=doc.get("uid") or None,
        derivation_path=doc.get("derivation_path") or None,
        derivation_index=(
            int(doc["derivation_index"])
            if isinstance(doc.get("derivation_index"), (int, float)) else None
        ),
        provider=doc.get("provider") or None,
        created_by=doc.get("created_by") or None,
        last_checked_at=doc.get("last_checked_at") or None,
    )


# ── Phase 3 — HD wallet index allocation & per-user address provisioning ─────
async def _allocate_hd_index(asset: str, network: str) -> int:
    """Atomically reserve the next BIP44/84 address index for (asset, network).

    Uses a ``find_one_and_update`` with ``$inc`` so concurrent requests
    never collide. The counter lives in the ``hd_wallet_state`` collection
    and starts at 0 the first time an asset/network is provisioned.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    doc = await db.hd_wallet_state.find_one_and_update(
        {"asset": asset.upper(), "network": network},
        {
            "$inc": {"next_index": 1},
            "$setOnInsert": {
                "asset": asset.upper(),
                "network": network,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        },
        upsert=True,
        return_document=ReturnDocument.BEFORE,
    )
    # BEFORE returns None on first insert → the first allocated index is 0.
    current = int((doc or {}).get("next_index") or 0)
    return current


async def _log_deposit_address_audit(
    *,
    event: str,
    uid: Optional[str],
    addr_id: str,
    asset: str,
    network: str,
    address: str,
    created_by: str,
    derivation_path: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Append a row to ``admin_audit_logs`` for every address lifecycle event.

    ``created_by`` is ``"system"`` for auto-generated per-user rows (no admin
    actor) or an admin aid when an admin minted the row.
    """
    if db is None:
        return
    payload = {
        "uid": uid,
        "addr_id": addr_id,
        "asset": asset,
        "network": network,
        "address": address,
        "created_by": created_by,
    }
    if derivation_path:
        payload["derivation_path"] = derivation_path
    if extra:
        payload["extra"] = extra
    try:
        await db.admin_audit_logs.insert_one({
            "id": f"aud_{uuid.uuid4().hex[:16]}",
            "actor_type": "admin" if created_by not in ("system", "") else "system",
            "actor_aid": created_by if created_by not in ("system", "") else None,
            "action": event,
            "entity": "deposit_address",
            "entity_id": addr_id,
            "payload": payload,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:  # noqa: BLE001
        logger.exception("failed to log deposit-address audit event %s", event)


async def _find_user_bep20_sibling_address(uid: str) -> Optional[Dict[str, Any]]:
    """Existing BEP-20 row for this user (shared EVM address across BEP-20 tokens)."""
    from listings.wallet_assets import BEP20_CANONICAL_ASSET_ORDER, BEP20_NETWORK

    for pref in BEP20_CANONICAL_ASSET_ORDER:
        row = await db.deposit_addresses.find_one(
            {
                "uid": uid,
                "asset": pref,
                "network": BEP20_NETWORK,
                "address": {"$exists": True, "$ne": ""},
            },
            {"_id": 0},
        )
        if row:
            return row
    return await db.deposit_addresses.find_one(
        {
            "uid": uid,
            "network": BEP20_NETWORK,
            "address": {"$exists": True, "$ne": ""},
        },
        {"_id": 0},
    )


async def _insert_bep20_alias_address(
    uid: str,
    asset: str,
    network: str,
    sibling: Dict[str, Any],
    *,
    created_by: str = "system",
) -> Dict[str, Any]:
    """Persist a BEP-20 alias row reusing the sibling's EVM address (universal deposit)."""
    now = datetime.now(timezone.utc).isoformat()
    doc_id = f"daddr_{uuid.uuid4().hex[:16]}"
    doc = {
        "id": doc_id,
        "uid": uid,
        "asset": asset,
        "network": network,
        "address": sibling.get("address"),
        "derivation_path": sibling.get("derivation_path"),
        "derivation_index": sibling.get("derivation_index"),
        "provider": sibling.get("provider"),
        "created_by": created_by,
        "qr_override": sibling.get("qr_override"),
        "label": "Auto-generated (BEP-20 universal)",
        "enabled": True,
        "sort_order": 0,
        "last_checked_at": None,
        "created_at": now,
        "updated_at": now,
        "bep20_universal": True,
    }
    try:
        await db.deposit_addresses.insert_one(doc)
    except Exception as exc:  # noqa: BLE001
        logger.info("deposit_address: BEP-20 alias insert raced (%s)", exc)
        winner = await db.deposit_addresses.find_one(
            {"uid": uid, "asset": asset, "network": network},
            {"_id": 0},
        )
        return winner or doc
    await _log_deposit_address_audit(
        event="deposit_address_bep20_alias",
        uid=uid,
        addr_id=doc_id,
        asset=asset,
        network=network,
        address=doc.get("address") or "",
        created_by=created_by,
        derivation_path=doc.get("derivation_path"),
        extra={"sibling_asset": sibling.get("asset"), "universal": True},
    )
    return doc


async def _find_user_trc20_sibling_address(uid: str) -> Optional[Dict[str, Any]]:
    """Existing TRC-20 row for this user (shared Tron address for TRX + USDT)."""
    tron_net = "TRC-20 (Tron)"
    for pref in ("TRX", "USDT"):
        row = await db.deposit_addresses.find_one(
            {
                "uid": uid,
                "asset": pref,
                "network": tron_net,
                "address": {"$exists": True, "$ne": ""},
            },
            {"_id": 0},
        )
        if row and str(row.get("address") or "").startswith("T"):
            return row
    return await db.deposit_addresses.find_one(
        {
            "uid": uid,
            "network": tron_net,
            "address": {"$exists": True, "$ne": ""},
        },
        {"_id": 0},
    )


async def _insert_trc20_alias_address(
    uid: str,
    asset: str,
    network: str,
    sibling: Dict[str, Any],
    *,
    created_by: str = "system",
) -> Dict[str, Any]:
    """Persist a TRC-20 alias row reusing the sibling's Tron address."""
    now = datetime.now(timezone.utc).isoformat()
    doc_id = f"daddr_{uuid.uuid4().hex[:16]}"
    doc = {
        "id": doc_id,
        "uid": uid,
        "asset": asset,
        "network": network,
        "address": sibling.get("address"),
        "derivation_path": sibling.get("derivation_path"),
        "derivation_index": sibling.get("derivation_index"),
        "provider": sibling.get("provider"),
        "created_by": created_by,
        "qr_override": sibling.get("qr_override"),
        "label": "Auto-generated (TRC-20 shared)",
        "enabled": True,
        "sort_order": 0,
        "last_checked_at": None,
        "created_at": now,
        "updated_at": now,
        "trc20_shared": True,
    }
    try:
        await db.deposit_addresses.insert_one(doc)
    except Exception as exc:  # noqa: BLE001
        logger.info("deposit_address: TRC-20 alias insert raced (%s)", exc)
        winner = await db.deposit_addresses.find_one(
            {"uid": uid, "asset": asset, "network": network},
            {"_id": 0},
        )
        return winner or doc
    await _log_deposit_address_audit(
        event="deposit_address_trc20_alias",
        uid=uid,
        addr_id=doc_id,
        asset=asset,
        network=network,
        address=doc.get("address") or "",
        created_by=created_by,
        derivation_path=doc.get("derivation_path"),
        extra={"sibling_asset": sibling.get("asset"), "shared": True},
    )
    return doc


async def _get_or_create_user_deposit_address(
    uid: str, asset: str, network: str, *, created_by: str = "system",
) -> Optional[Dict[str, Any]]:
    """Return the authenticated user's HD-derived deposit address document.

    Behaviour:
    - If a row for ``(uid, asset, network)`` already exists, return it.
    - BEP-20 tokens share one EVM address per user; additional assets get
      alias rows pointing at the same address (for poller + ledger labels).
    - TRX and USDT on TRC-20 share one Tron address per user the same way.
    - Otherwise, call the configured :class:`BlockchainProvider` to derive
      a fresh address, persist it, and return the new document.
    - If the provider is disabled / unconfigured, return ``None`` so the
      caller can fall back to shared admin-curated addresses.

    Security:
    - Only the derived **public** address and derivation path are written.
      The master mnemonic and any intermediate private keys never leave
      ``services.blockchain_service``.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    ast = (asset or "").strip().upper()
    net = (network or "").strip()

    existing = await db.deposit_addresses.find_one(
        {"uid": uid, "asset": ast, "network": net},
        {"_id": 0},
    )
    if existing:
        # Legacy bug: USDT TRC-20 was sometimes derived as an EVM 0x address.
        # Invalidate those rows so a real Tron (T…) address is issued.
        addr = str(existing.get("address") or "").strip()
        if net == "TRC-20 (Tron)" and addr and not addr.startswith("T"):
            logger.warning(
                "deposit_address: replacing invalid TRC-20 address for uid=%s asset=%s (%s…)",
                uid, ast, addr[:10],
            )
            await db.deposit_addresses.delete_one({"uid": uid, "asset": ast, "network": net})
        else:
            return existing

    from listings.wallet_assets import BEP20_NETWORK, is_bep20_universal_asset

    if is_bep20_universal_asset(ast, net):
        sibling = await _find_user_bep20_sibling_address(uid)
        if sibling and (sibling.get("address") or "").strip():
            return await _insert_bep20_alias_address(
                uid, ast, net, sibling, created_by=created_by,
            )

    if net == "TRC-20 (Tron)" and ast in ("TRX", "USDT"):
        sibling = await _find_user_trc20_sibling_address(uid)
        if sibling and str(sibling.get("address") or "").startswith("T"):
            return await _insert_trc20_alias_address(
                uid, ast, net, sibling, created_by=created_by,
            )

    provider: BlockchainProvider = blockchain_service.get_provider()
    if blockchain_normalise_network(ast, net) is None:
        return None  # provider doesn't cover this asset/network — caller falls back

    try:
        index = await _allocate_hd_index(ast, net)
        logger.info(
            "Generating address for user uid=%s asset=%s network=%s index=%d",
            uid, ast, net, index,
        )
        generated = await provider.generate_address(uid, ast, net, derivation_index=index)
    except ProviderUnavailable as exc:
        logger.info("deposit_address: provider unavailable for %s/%s (%s)", ast, net, exc)
        return None
    except UnsupportedAssetNetwork:
        return None
    except Exception:  # noqa: BLE001
        logger.exception("deposit_address: provider failed to generate for uid=%s", uid)
        return None

    now = datetime.now(timezone.utc).isoformat()
    doc_id = f"daddr_{uuid.uuid4().hex[:16]}"
    doc = {
        "id": doc_id,
        "uid": uid,
        "asset": generated.asset,
        "network": generated.network,
        "address": generated.address,
        "derivation_path": generated.derivation_path,
        "derivation_index": generated.derivation_index,
        "provider": generated.provider,
        "created_by": created_by,
        "qr_override": None,
        "label": "Auto-generated",
        "enabled": True,
        "sort_order": 0,
        "last_checked_at": None,
        "created_at": now,
        "updated_at": now,
    }
    if net == BEP20_NETWORK:
        doc["bep20_universal"] = True
    if net == "TRC-20 (Tron)":
        doc["trc20_shared"] = True
    try:
        await db.deposit_addresses.insert_one(doc)
    except Exception as exc:  # noqa: BLE001
        # Under a rare race two requests could both generate at the same
        # time. The unique index on (uid, asset, network) means the loser
        # sees a DuplicateKeyError — re-read and return the winner's row
        # so the user gets a consistent answer.
        logger.info("deposit_address: insert raced (%s) — re-reading winner", exc)
        winner = await db.deposit_addresses.find_one(
            {"uid": uid, "asset": ast, "network": net},
            {"_id": 0},
        )
        return winner

    await _log_deposit_address_audit(
        event="deposit_address_generate",
        uid=uid,
        addr_id=doc_id,
        asset=generated.asset,
        network=generated.network,
        address=generated.address,
        created_by=created_by,
        derivation_path=generated.derivation_path,
        extra={"index": generated.derivation_index, "provider": generated.provider},
    )
    logger.info(
        "deposit_address: issued %s/%s address for uid=%s via %s (index=%d)",
        generated.asset, generated.network, uid, generated.provider, generated.derivation_index,
    )
    return doc


async def _execute_place_order(
    uid: str,
    body: OrderCreate,
    *,
    min_order_value_usdt: Optional[float] = None,
) -> OrderOut:
    """
    Core order placement + matching. Used by POST /orders and POST /portfolio/close_position.
    """
    if db is None:
        raise HTTPException(503, "Database unavailable")

    sym = body.symbol.upper()
    from listings.integration import effective_symbol_base_map

    _sym_map = effective_symbol_base_map(SYMBOL_BASE_MAP)
    if sym not in _sym_map:
        raise HTTPException(400, f"Unsupported symbol: {sym}. Supported: {list(_sym_map)}")
    pair_cfg = await db.market_pairs.find_one({"symbol": sym}, {"_id": 0, "is_active": 1})
    if pair_cfg is not None and not bool(pair_cfg.get("is_active", True)):
        raise HTTPException(409, f"{sym} is currently inactive. New orders are disabled for this pair.")

    if body.type not in ("limit", "market"):
        raise HTTPException(400, "type must be 'limit' or 'market'")
    if body.side not in ("buy", "sell"):
        raise HTTPException(400, "side must be 'buy' or 'sell'")
    if body.type == "limit" and (not body.price or body.price <= 0):
        raise HTTPException(400, "Limit orders require a positive price")

    user_doc = await db.users.find_one({"uid": uid})
    _kyc_trading_gate(user_doc)

    if body.amount < MIN_BASE_AMOUNT:
        raise HTTPException(400,
            f"Minimum order size is {MIN_BASE_AMOUNT} {_sym_map[sym]}. "
            f"You entered {body.amount}.")

    base_asset   = _sym_map[sym]
    market_price = await get_current_price(sym)
    now          = datetime.now(timezone.utc).isoformat()
    controls = await get_platform_controls()

    # SELL: clamp to wallet available (re-read) so lock_funds never exceeds balance
    qty = body.amount
    if body.side == "sell":
        w_avail = await db.wallets.find_one({"uid": uid, "asset": base_asset})
        available = float((w_avail or {}).get("available", 0.0))
        qty = _safe_sell_base_qty(body.amount, available)
        if qty < MIN_BASE_AMOUNT:
            raise HTTPException(
                400,
                f"Cannot sell {SYMBOL_BASE_MAP[sym]}: need at least {MIN_BASE_AMOUNT} available "
                f"(trying to sell {body.amount:.8g}, have {available:.8g} available, "
                f"{float((w_avail or {}).get('locked', 0.0)):.8g} locked). "
                "Cancel open sell orders if coins are locked.",
            )

    eff_price = body.price if (body.type == "limit" and body.price) else market_price
    order_value = eff_price * qty
    min_val = MIN_ORDER_VALUE_USDT if min_order_value_usdt is None else min_order_value_usdt
    if order_value < min_val:
        raise HTTPException(400,
            f"Minimum order value is ${min_val:.2f} USDT. "
            f"Current order value: ${order_value:.4f} USDT.")

    # Phase 5 — risk controls (order size + open exposure caps).
    max_order_usdt = _resolve_symbol_usdt_cap(
        controls,
        global_key="risk_max_order_notional_usdt",
        per_symbol_key="risk_max_order_notional_usdt_by_symbol",
        symbol=sym,
    )
    if max_order_usdt > 0 and order_value > max_order_usdt:
        raise HTTPException(
            400,
            f"Order exceeds risk cap for {sym}: ${order_value:.4f} > ${max_order_usdt:.4f} USDT.",
        )
    max_open_usdt = _resolve_symbol_usdt_cap(
        controls,
        global_key="risk_max_open_notional_usdt",
        per_symbol_key="risk_max_open_notional_usdt_by_symbol",
        symbol=sym,
    )
    if max_open_usdt > 0:
        existing_open_usdt = await _user_open_notional_usdt(uid, sym, market_price)
        projected = existing_open_usdt + order_value
        if projected > max_open_usdt:
            raise HTTPException(
                400,
                f"Open exposure cap exceeded for {sym}: ${projected:.4f} > ${max_open_usdt:.4f} USDT.",
            )

    limit_px  = body.price if body.type == "limit" else 0.0
    # Phase 8 — for buy MARKET orders the lock buffer must cover the
    # SYSTEM spread we'll charge later in ``run_matching_engine``.
    # Otherwise raising the spread above 50 bps (legacy hard-coded
    # 0.5% buffer) would silently under-lock USDT and fills would
    # bounce on InsufficientFunds. Limit orders lock at the user's
    # own price, so they're unaffected.
    if limit_px:
        lock_px = limit_px
    else:
        spread_bps = resolve_system_spread_bps(controls, sym)
        buffer_bps = spread_bps + _LOCK_SAFETY_BPS
        lock_px = market_price * (1.0 + buffer_bps / 10_000.0)

    order_id  = f"ord_{uuid.uuid4().hex[:16]}"
    quote_asset = SYMBOL_QUOTE_MAP.get(sym, "USDT")
    maker_fee_rate, taker_fee_rate = _fee_rates_from_controls(controls)
    fee_rate_for_lock = max(maker_fee_rate, taker_fee_rate)
    ibo_price_usdt = await _resolve_ibo_usdt_price(controls)
    fee_quote_notional_lock = float(lock_px * qty)
    fee_lock_ibo = _estimate_ibo_fee(
        quote_asset=quote_asset,
        quote_notional=fee_quote_notional_lock,
        fee_rate=fee_rate_for_lock,
        ibo_price_usdt=ibo_price_usdt,
    )

    if fee_lock_ibo > 0:
        ibo_wallet = await db.wallets.find_one({"uid": uid, "asset": "IBO"}, {"_id": 0, "available": 1})
        ibo_available = float((ibo_wallet or {}).get("available") or 0.0)
        if ibo_available + 1e-12 < fee_lock_ibo:
            raise HTTPException(
                400,
                (
                    f"Insufficient IBO for trading fee. Need ~{fee_lock_ibo:.8f} IBO, "
                    f"available {ibo_available:.8f} IBO. Trading fees are charged only in IBO."
                ),
            )

    if body.side == "buy":
        await lock_funds(uid, quote_asset, round(lock_px * qty, 8), ref_id=order_id)
    else:
        await lock_funds(uid, base_asset, qty, ref_id=order_id)

    order_doc = {
        "id":             order_id,
        "uid":            uid,
        "symbol":         sym,
        "side":           body.side,
        "type":           body.type,
        "status":         "open",
        "price":          limit_px,
        "lock_price":     lock_px,
        "amount":         qty,
        "filled":         0.0,
        "remaining":      qty,
        "avg_price":      0.0,
        "total_fee":      0.0,
        "total_fee_asset": "IBO",
        "fee_rate":       float(taker_fee_rate),
        "estimated_fee_ibo": float(fee_lock_ibo),
        "created_at":     now,
        "updated_at":     now,
    }
    await db.orders.insert_one(order_doc)
    logger.info(f"Order {order_id} placed: {body.side.upper()} {qty} {sym} @ {limit_px or 'MARKET'}")

    await run_matching_engine(order_doc, market_price, base_asset)

    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return OrderOut(**updated)


# ── General Routes ────────────────────────────────────────────────────────────

@api_router.get("/")
async def root():
    return {"message": "IBO API is running", "version": "1.0.0"}


@api_router.get("/health")
async def health_check():
    return {
        "status":    "healthy",
        "database":  "connected" if db is not None else "unavailable",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@api_router.get("/public/site-config")
async def public_site_config():
    """Public project metadata for token site / explorer submissions (from IBO_* env)."""
    from public_site_config import get_public_site_config

    config = get_public_site_config()
    # Merge runtime OTP service flags from platform_controls so the exchange
    # frontend can skip OTP steps when the respective service is disabled.
    if db is not None:
        try:
            from services import sms_otp_service

            controls = await get_platform_controls()
            signup_cfg = config.setdefault("signup", {})
            email_on = bool(controls.get("email_otp_service_enabled", True))
            sms_on = bool(controls.get("sms_otp_service_enabled", True))
            signup_cfg["email_otp_enabled"] = email_on
            signup_cfg["sms_otp_enabled"] = sms_on
            signup_cfg["sms_available"] = bool(sms_otp_service.sms_available(controls))
            signup_cfg["sms_dev_otp_enabled"] = bool(controls.get("sms_dev_otp_enabled"))
        except Exception:
            pass
    return config


@api_router.get("/token-stats", response_model=TokenStats)
async def get_token_stats():
    contract = (os.getenv("IBO_CONTRACT_ADDRESS") or "0x7962f32a587c49ad4235ddc5982a0ae1945a2c01").strip()
    max_sup = (os.getenv("IBO_MAX_TOTAL_SUPPLY") or "1000000000").strip()
    try:
        max_sup_fmt = f"{int(max_sup):,}"
    except ValueError:
        max_sup_fmt = max_sup
    return TokenStats(
        name=os.getenv("IBO_TOKEN_NAME", "IBO") or "IBO",
        symbol=os.getenv("IBO_TOKEN_SYMBOL", "IBO") or "IBO",
        total_supply=max_sup_fmt,
        network="BNB Chain",
        standard="BEP-20",
        contract_address=contract,
        decimals=int(os.getenv("IBO_TOKEN_DECIMALS", "18") or "18"),
        market_cap="—",
        price="—",
        holders="—",
        volume_24h="—",
        listing_status="listed",
        pancakeswap_url=(os.getenv("IBO_DEX_SWAP_LINK") or "").strip() or None,
        bscscan_url=f"https://bscscan.com/token/{contract}" if contract.startswith("0x") else None,
    )


@api_router.get("/token-logo")
def token_logo():
    """Return the IBO token mark as a 32×32 PNG (suitable for icons / embeds)."""
    return _token_logo_png_response()


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.model_dump())
    if db is not None:
        doc = status_obj.model_dump()
        doc['timestamp'] = doc['timestamp'].isoformat()
        await db.status_checks.insert_one(doc)
    else:
        logger.warning("Database unavailable — status check not persisted")
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    if db is None:
        return []
    checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for c in checks:
        if isinstance(c.get('timestamp'), str):
            c['timestamp'] = datetime.fromisoformat(c['timestamp'])
    return checks


# ── Auth Routes ───────────────────────────────────────────────────────────────


async def _require_json_object(request: Request) -> Dict[str, Any]:
    """Parse POST JSON into a dict. Used for signup routes so validation uses ``SignupCredentials`` only inside the handler (not MongoDB or OpenAPI body injection)."""
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=422,
            detail=[{"loc": ["body"], "msg": "Invalid JSON body", "type": "json_invalid"}],
        ) from None
    if not isinstance(body, dict):
        raise HTTPException(
            status_code=422,
            detail=[{"loc": ["body"], "msg": "Expected a JSON object", "type": "value_error"}],
        )
    return body


def _signup_pending_expired(pending: dict) -> bool:
    raw = pending.get("expires_at")
    if not raw:
        return False
    try:
        exp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > exp
    except Exception:
        return False


async def _get_signup_pending_or_raise(email_lower: str) -> dict:
    pending = await _find_signup_pending(email_lower=email_lower)
    if not pending:
        raise HTTPException(
            status_code=400,
            detail="No pending signup for this email. Please register again.",
        )
    if _signup_pending_expired(pending):
        await _delete_signup_pending(pending)
        raise HTTPException(status_code=400, detail="Verification window expired. Please sign up again.")
    return pending


async def _find_signup_pending(
    *,
    email_lower: Optional[str] = None,
    phone_e164: Optional[str] = None,
) -> Optional[dict]:
    if email_lower:
        pending = await db.signup_pending.find_one({"email": email_lower})
        if pending:
            return pending
    if phone_e164:
        return await db.signup_pending.find_one({"phone_e164": phone_e164})
    return None


async def _delete_signup_pending(pending: dict) -> None:
    if pending.get("email"):
        await db.signup_pending.delete_one({"email": pending["email"]})
        return
    if pending.get("phone_e164"):
        await db.signup_pending.delete_one({"phone_e164": pending["phone_e164"]})


async def _merge_signup_phone_into_email_pending(
    phone_pending: dict,
    email_lower: str,
) -> dict:
    """Merge a phone-keyed pending row into the email-keyed row."""
    email_pending = await db.signup_pending.find_one({"email": email_lower})
    if not email_pending:
        await db.signup_pending.update_one(
            {"_id": phone_pending["_id"]},
            {"$set": {"email": email_lower}},
        )
        return await db.signup_pending.find_one({"email": email_lower}) or phone_pending

    merge_fields: Dict[str, Any] = {}
    for key in (
        "mobile", "country_code", "phone_e164",
        "sms_otp_hash", "sms_otp_expires_at", "sms_otp_attempts",
        "phone_verified", "sms_sent_at",
    ):
        if phone_pending.get(key) is not None and email_pending.get(key) is None:
            merge_fields[key] = phone_pending[key]
    if merge_fields:
        await db.signup_pending.update_one({"email": email_lower}, {"$set": merge_fields})
    if phone_pending.get("_id") != email_pending.get("_id"):
        await db.signup_pending.delete_one({"_id": phone_pending["_id"]})
    return await db.signup_pending.find_one({"email": email_lower}) or email_pending


async def _upsert_signup_pending_record(
    pending: Dict[str, Any],
    *,
    email_lower: Optional[str] = None,
    phone_e164: Optional[str] = None,
) -> None:
    """Persist signup_pending without violating unique indexes on email / phone."""
    pending = dict(pending)
    pending.pop("_id", None)

    doc_by_email = (
        await db.signup_pending.find_one({"email": email_lower}, {"_id": 1, "email": 1})
        if email_lower else None
    )
    doc_by_phone = (
        await db.signup_pending.find_one({"phone_e164": phone_e164}, {"_id": 1, "email": 1})
        if phone_e164 else None
    )

    if doc_by_email and doc_by_phone and doc_by_email["_id"] != doc_by_phone["_id"]:
        logger.info(
            "signup_pending: merging phone doc into email doc for phone=%s email=%s",
            phone_e164, email_lower,
        )
        await db.signup_pending.delete_one({"_id": doc_by_phone["_id"]})
        await db.signup_pending.update_one({"_id": doc_by_email["_id"]}, {"$set": pending})
    elif doc_by_email:
        await db.signup_pending.update_one({"_id": doc_by_email["_id"]}, {"$set": pending})
    elif doc_by_phone:
        if email_lower and doc_by_phone.get("email") and doc_by_phone["email"] != email_lower:
            logger.info(
                "signup_pending: switching email on phone row %s -> %s",
                doc_by_phone.get("email"), email_lower,
            )
        await db.signup_pending.update_one({"_id": doc_by_phone["_id"]}, {"$set": pending})
    else:
        await db.signup_pending.insert_one(pending)


async def _get_signup_pending_for_mobile_verify(
    body: "RegisterMobileVerify",
) -> dict:
    email_lower = body.email.lower().strip() if body.email else None
    try:
        cc, nat = authkey_sms.normalize_mobile(body.mobile, body.country_code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    phone_e164 = _phone_e164(cc, nat)
    pending = await _find_signup_pending(email_lower=email_lower, phone_e164=phone_e164)
    if not pending:
        raise HTTPException(
            status_code=400,
            detail="No pending signup for this mobile. Send an SMS code first.",
        )
    if _signup_pending_expired(pending):
        await _delete_signup_pending(pending)
        raise HTTPException(status_code=400, detail="Verification window expired. Please sign up again.")
    if email_lower and not pending.get("email"):
        pending = await _merge_signup_phone_into_email_pending(pending, email_lower)
    return pending


def _hash_signup_otp(plain: str) -> str:
    return hashlib.sha256(str(plain or "").encode()).hexdigest()


def _new_signup_otp_code() -> str:
    return str(secrets.randbelow(1_000_000)).zfill(6)


def _new_distinct_signup_otp_pair() -> tuple[str, str]:
    """Two different 6-digit codes for email and SMS."""
    email_otp = _new_signup_otp_code()
    sms_otp = _new_signup_otp_code()
    while sms_otp == email_otp:
        sms_otp = _new_signup_otp_code()
    return email_otp, sms_otp


def _signup_channel_otp_expired(pending: dict, expires_field: str) -> bool:
    otp_exp_raw = pending.get(expires_field) or pending.get("otp_expires_at")
    if not otp_exp_raw:
        return False
    try:
        otp_exp = datetime.fromisoformat(str(otp_exp_raw).replace("Z", "+00:00"))
        if otp_exp.tzinfo is None:
            otp_exp = otp_exp.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > otp_exp
    except Exception:
        return False


def _signup_pending_filter(pending: dict) -> Dict[str, Any]:
    if pending.get("email"):
        return {"email": pending["email"]}
    if pending.get("phone_e164"):
        return {"phone_e164": pending["phone_e164"]}
    raise HTTPException(status_code=400, detail="Invalid pending signup. Please start again.")


async def _assert_signup_otp_code(
    pending: dict,
    email_lower: str,
    code_in: str,
    *,
    channel: str = "legacy",
) -> None:
    """Validate OTP for legacy (single), email, or sms signup step."""
    filt = _signup_pending_filter(pending)
    ch = (channel or "legacy").strip().lower()
    if ch == "email":
        attempts_field = "email_otp_attempts"
        hash_field = "email_otp_hash"
        exp_field = "email_otp_expires_at"
        hash_fallback = "otp_hash"
    elif ch == "sms":
        attempts_field = "sms_otp_attempts"
        hash_field = "sms_otp_hash"
        exp_field = "sms_otp_expires_at"
        hash_fallback = None
    else:
        attempts_field = "otp_attempts"
        hash_field = "otp_hash"
        exp_field = "otp_expires_at"
        hash_fallback = None

    attempts = int(pending.get(attempts_field, 0) or 0)
    if attempts >= OTP_MAX_ATTEMPTS:
        await db.signup_pending.delete_one(filt)
        raise HTTPException(
            status_code=400,
            detail="Too many incorrect attempts. Please register again to get a new code.",
        )

    if _signup_channel_otp_expired(pending, exp_field):
        await db.signup_pending.delete_one(filt)
        raise HTTPException(
            status_code=400,
            detail="Verification code has expired. Please request a new one.",
        )

    submitted_hash = _hash_signup_otp(code_in)
    stored_hash = pending.get(hash_field) or ""
    if not stored_hash and hash_fallback:
        stored_hash = pending.get(hash_fallback, "")

    if submitted_hash != stored_hash:
        await db.signup_pending.update_one(
            filt,
            {"$inc": {attempts_field: 1}},
        )
        remaining = OTP_MAX_ATTEMPTS - attempts - 1
        detail = f"Invalid verification code. {remaining} attempt{'s' if remaining != 1 else ''} remaining."
        raise HTTPException(status_code=400, detail=detail)


async def _send_signup_sms_otp_for_pending(
    pending: dict,
    email_lower: str,
    controls: Dict[str, Any],
) -> str:
    """Generate, deliver, and persist SMS OTP for dual-channel signup (after email verified)."""
    nat = (pending.get("mobile") or "").strip()
    cc = pending.get("country_code") or authkey_sms.default_country_code()
    name = pending.get("name") or ""
    if not nat:
        raise HTTPException(status_code=400, detail="Invalid pending signup. Please register again.")
    if not sms_otp_service.sms_available(controls):
        raise HTTPException(
            status_code=503,
            detail="SMS verification is not configured. Contact support.",
        )

    sms_otp_plain, sms_result = await sms_otp_service.send_signup_sms_otp(
        controls=controls,
        mobile=nat,
        country_code=cc,
        name=name,
    )
    if not sms_result.ok:
        logger.warning("signup SMS failed for %s: %s", email_lower, sms_result.error)
        raise HTTPException(
            status_code=502,
            detail="Could not send verification SMS. Check your number and try again.",
        )

    now = datetime.now(timezone.utc)
    otp_expires_iso = (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()
    await db.signup_pending.update_one(
        {"email": email_lower},
        {"$set": {
            "sms_otp_hash": _hash_signup_otp(sms_otp_plain),
            "sms_otp_expires_at": otp_expires_iso,
            "sms_otp_attempts": 0,
            "sms_sent_at": now.isoformat(),
            "otp_sent_at": now.isoformat(),
        }},
    )
    phone_e164 = pending.get("phone_e164") or _phone_e164(cc, nat)
    logger.info("Signup SMS OTP sent for %s (%s)", email_lower, phone_e164)
    return authkey_sms.mask_phone_hint(cc, nat)


async def _complete_signup_from_pending(pending: dict, email_lower: str) -> TokenResponse:
    await db.signup_pending.delete_one({"email": email_lower})

    existing = await db.users.find_one({"email": email_lower})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    # Guard against a race where two pending records share the same phone and
    # both call register_complete concurrently — the DB unique index would also
    # catch this, but an explicit check gives a clean 409 instead of a 500.
    pending_phone = pending.get("phone_e164")
    if pending_phone:
        existing_phone = await db.users.find_one({"phone": pending_phone})
        if existing_phone:
            raise HTTPException(
                status_code=409,
                detail="An account with this mobile number already exists",
            )

    ph = pending.get("password_hash")
    if not ph:
        raise HTTPException(status_code=400, detail="Invalid pending signup. Please register again.")

    uid = f"u_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc).isoformat()
    name = pending.get("name") or "User"
    user_doc = {
        "uid": uid,
        "email": email_lower,
        "name": name,
        "password_hash": ph,
        "created_at": now,
        "is_active": True,
        "kyc_status": "unverified",
        "email_verified": bool(pending.get("email_verified")),
    }
    if pending_phone:
        user_doc["phone"] = pending_phone
        user_doc["mobile_verified"] = bool(pending.get("phone_verified"))

    user_doc["referral_code"] = await referral_svc.generate_referral_code(db)
    await db.users.insert_one(user_doc)
    await seed_wallet(uid)
    try:
        controls = await get_platform_controls()
        await referral_svc.apply_referral_signup(
            db, uid, pending.get("referral_code"), controls,
            get_or_create_address=_get_or_create_user_deposit_address,
        )
    except Exception:  # noqa: BLE001
        logger.exception("register_complete: referral signup link failed uid=%s", uid)
    logger.info("New user registered (after OTP verify): %s (%s)", email_lower, uid)

    async def _send_welcome() -> None:
        subj, html, txt = email_templates.welcome_email(name=name)
        await email_service.send_email(
            to=email_lower, subject=subj, html_body=html, text_body=txt,
            log_tag="welcome",
        )

    import asyncio as _asyncio
    _asyncio.create_task(_send_welcome())

    user_out = user_doc_to_out({**user_doc, "created_at": now})
    access, refresh = await _issue_token_pair({**user_doc, "sessions_epoch": 0})
    return TokenResponse(access_token=access, refresh_token=refresh, user=user_out)


def _normalize_register_verify_json(raw: dict) -> dict:
    """Map common client keys onto RegisterVerify fields before Pydantic validation."""
    email = raw.get("email") or raw.get("emailAddress") or raw.get("email_address")
    code = raw.get("code")
    if code is None or (isinstance(code, str) and not str(code).strip()):
        for k in ("verificationCode", "verification_code", "otp", "email_code"):
            v = raw.get(k)
            if v is not None and str(v).strip():
                code = v
                break
    return {"email": email, "code": code}


async def _register_one_step_from_user_create(body: SignupCredentials) -> TokenResponse:
    """Create user + wallet + JWT (shared by /auth/register and verify-route fallback)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot register users")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    email_lower = body.email.lower().strip()
    existing = await db.users.find_one({"email": email_lower})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    await db.signup_pending.delete_many({"email": email_lower})

    uid = f"u_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc).isoformat()
    # ``users`` documents do not store email OTP / email_verification_code — those live only in the verify HTTP payload and env (SIGNUP_EMAIL_STATIC_CODE). MongoDB shape does not cause request 422s.
    user_doc = {
        "uid":           uid,
        "email":         email_lower,
        "name":          body.name.strip(),
        "password_hash": hash_password(body.password),
        "created_at":    now,
        "is_active":     True,
        "kyc_status":    "unverified",
        "referral_code": await referral_svc.generate_referral_code(db),
    }
    await db.users.insert_one(user_doc)
    await seed_wallet(uid)
    try:
        controls = await get_platform_controls()
        await referral_svc.apply_referral_signup(
            db, uid, body.referral_code, controls,
            get_or_create_address=_get_or_create_user_deposit_address,
        )
    except Exception:  # noqa: BLE001
        logger.exception("register (one-step): referral signup link failed uid=%s", uid)
    logger.info(f"New user registered (one-step): {user_doc['email']} ({uid})")

    user_out = user_doc_to_out({**user_doc, "created_at": now})
    access, refresh = await _issue_token_pair({**user_doc, "sessions_epoch": 0})
    return TokenResponse(access_token=access, refresh_token=refresh, user=user_out)


@api_router.post("/auth/register/request", response_model=RegisterRequestResponse, status_code=200)
async def register_request(request: Request):
    """Send email OTP for signup (email only — no password or mobile required)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot register users")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    controls = await get_platform_controls()
    client_ip = rate_limit_service.client_ip_from_request(request)
    await _rate_limit(controls, "auth.register", f"ip:{client_ip}",
                      limit_key="rate_limit_register_per_ip_per_min", window_sec=60)

    raw = await _require_json_object(request)
    try:
        body = RegisterEmailOtpRequest.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    email_lower = body.email.lower().strip()
    existing = await db.users.find_one({"email": email_lower})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    phone_e164_for_lookup: Optional[str] = None
    if (body.mobile or "").strip():
        try:
            cc_lookup, nat_lookup = authkey_sms.normalize_mobile(body.mobile or "", body.country_code)
            phone_e164_for_lookup = _phone_e164(cc_lookup, nat_lookup)
        except ValueError:
            phone_e164_for_lookup = None

    stale_pending = await _find_signup_pending(
        email_lower=email_lower, phone_e164=phone_e164_for_lookup,
    )
    if stale_pending and _signup_pending_expired(stale_pending):
        await _delete_signup_pending(stale_pending)

    email_otp_enabled = controls.get("email_otp_service_enabled", True)

    now = datetime.now(timezone.utc)
    doc_expires = now + timedelta(hours=SIGNUP_PENDING_TTL_HOURS)

    phone_hint = ""
    doc: Dict[str, Any] = {
        "email": email_lower,
        "created_at": now.isoformat(),
        "expires_at": doc_expires.isoformat(),
        "otp_sent_at": now.isoformat(),
        "otp_channel": "both",
        "email_verified": False,
        # Do NOT include phone_verified here.  _upsert_signup_pending_record uses
        # $set, so any value placed here would overwrite a True written by a prior
        # SMS verification step. Missing field is treated as falsy by
        # pending.get("phone_verified"), which is identical in effect to False.
    }
    if (body.referral_code or "").strip():
        doc["referral_code"] = body.referral_code.strip()

    if email_otp_enabled:
        email_otp_plain = _new_signup_otp_code()
        otp_expires = now + timedelta(minutes=OTP_TTL_MINUTES)
        doc["email_otp_hash"] = _hash_signup_otp(email_otp_plain)
        doc["email_otp_expires_at"] = otp_expires.isoformat()
        doc["email_otp_attempts"] = 0

    if (body.mobile or "").strip():
        try:
            cc, nat = authkey_sms.normalize_mobile(body.mobile or "", body.country_code)
            phone_e164 = _phone_e164(cc, nat)
            existing_phone = await db.users.find_one({"phone": phone_e164})
            if existing_phone:
                raise HTTPException(
                    status_code=409,
                    detail="An account with this mobile number already exists",
                )
            doc["mobile"] = nat
            doc["country_code"] = cc
            doc["phone_e164"] = phone_e164
            phone_hint = authkey_sms.mask_phone_hint(cc, nat)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    if email_otp_enabled:
        subject, html, text = email_templates.otp_email(
            name="",
            otp=email_otp_plain,
            expires_minutes=OTP_TTL_MINUTES,
        )
        email_sent = await email_service.send_email(
            to=email_lower, subject=subject, html_body=html, text_body=text,
            log_tag="signup_otp",
        )
        if not email_sent:
            logger.warning("register_request: OTP email not delivered for %s", email_lower)
            raise HTTPException(
                status_code=502,
                detail="Could not send verification email. Check your address and try again.",
            )
        logger.info("Signup email OTP sent for %s", email_lower)
        message = "We sent a verification code to your email."
    else:
        logger.info("Email OTP service disabled — email stored unverified for signup %s", email_lower)
        message = "Email accepted. You can verify it later from your profile."

    await _upsert_signup_pending_record(
        doc, email_lower=email_lower, phone_e164=doc.get("phone_e164"),
    )
    return RegisterRequestResponse(
        message=message,
        email_hint=mask_email_hint(email_lower),
        phone_hint=phone_hint,
        verify_channel="both",
    )


@api_router.post("/auth/register/mobile/send-otp", response_model=RegisterRequestResponse, status_code=200)
async def register_mobile_send_otp(request: Request):
    """Send SMS OTP for signup (mobile only — no password or email verification required)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot register users")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    controls = await get_platform_controls()
    sms_otp_enabled = controls.get("sms_otp_service_enabled", True)
    sms_can_send = bool(sms_otp_enabled) and sms_otp_service.sms_available(controls)

    client_ip = rate_limit_service.client_ip_from_request(request)
    await _rate_limit(controls, "auth.register", f"ip:{client_ip}",
                      limit_key="rate_limit_register_per_ip_per_min", window_sec=60)

    raw = await _require_json_object(request)
    try:
        body = RegisterMobileOtpRequest.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    try:
        cc, nat = authkey_sms.normalize_mobile(body.mobile, body.country_code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    phone_e164 = _phone_e164(cc, nat)
    existing_phone = await db.users.find_one({"phone": phone_e164})
    if existing_phone:
        raise HTTPException(status_code=409, detail="An account with this mobile number already exists")

    email_lower = body.email.lower().strip() if body.email else None
    if email_lower:
        existing = await db.users.find_one({"email": email_lower})
        if existing:
            raise HTTPException(status_code=409, detail="An account with this email already exists")

    pending = await _find_signup_pending(email_lower=email_lower, phone_e164=phone_e164)
    if pending and _signup_pending_expired(pending):
        await _delete_signup_pending(pending)
        pending = None

    now = datetime.now(timezone.utc)
    doc_expires = now + timedelta(hours=SIGNUP_PENDING_TTL_HOURS)
    if not pending:
        base: Dict[str, Any] = {
            "created_at": now.isoformat(),
            "expires_at": doc_expires.isoformat(),
            "otp_channel": "both",
            "email_verified": False,
            "phone_verified": False,
            "mobile": nat,
            "country_code": cc,
            "phone_e164": phone_e164,
        }
        if email_lower:
            base["email"] = email_lower
        if (body.referral_code or "").strip():
            base["referral_code"] = body.referral_code.strip()
        pending = base
    else:
        pending = {**pending, "mobile": nat, "country_code": cc, "phone_e164": phone_e164}
        if email_lower:
            pending["email"] = email_lower
        if (body.referral_code or "").strip() and not pending.get("referral_code"):
            pending["referral_code"] = body.referral_code.strip()

    if sms_can_send:
        sms_otp_plain, sms_result = await sms_otp_service.send_signup_sms_otp(
            controls=controls,
            mobile=nat,
            country_code=cc,
            name=pending.get("name") or "",
        )
        if not sms_result.ok:
            logger.warning("register mobile OTP failed for %s: %s", phone_e164, sms_result.error)
            raise HTTPException(
                status_code=502,
                detail="Could not send verification SMS. Check your number and try again.",
            )
        otp_expires_iso = (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()
        pending.update({
            "sms_otp_hash": _hash_signup_otp(sms_otp_plain),
            "sms_otp_expires_at": otp_expires_iso,
            "sms_otp_attempts": 0,
            "sms_sent_at": now.isoformat(),
            "otp_sent_at": now.isoformat(),
        })
        logger.info("Signup SMS OTP sent for %s", phone_e164)
        sms_message = "We sent a verification code to your mobile number."
    else:
        pending["otp_sent_at"] = now.isoformat()
        logger.info(
            "SMS OTP inactive/unavailable — phone stored unverified for signup %s",
            phone_e164,
        )
        sms_message = "Phone saved. SMS verification is inactive — you can verify later from your profile."

    await _upsert_signup_pending_record(
        pending, email_lower=email_lower, phone_e164=phone_e164,
    )

    return RegisterRequestResponse(
        message=sms_message,
        email_hint=mask_email_hint(email_lower) if email_lower else "",
        phone_hint=authkey_sms.mask_phone_hint(cc, nat),
        verify_channel="both",
    )


@api_router.post("/auth/register/verify-email", response_model=RegisterVerifyStepResponse, status_code=200)
async def register_verify_email(request: Request):
    """Verify email OTP (step 1). SMS uses a separate code on the next screen."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    raw = await _require_json_object(request)
    try:
        body = RegisterVerify.model_validate(_normalize_register_verify_json(raw))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    email_lower = body.email.lower().strip()
    code_in = (body.code or "").strip()
    pending = await _get_signup_pending_or_raise(email_lower)
    await _assert_signup_otp_code(pending, email_lower, code_in, channel="email")

    await db.signup_pending.update_one(
        {"email": email_lower},
        {"$set": {"email_verified": True}},
    )
    return RegisterVerifyStepResponse(
        message="Email verified. You can verify your mobile separately, then create your account.",
        next_step="complete",
    )


@api_router.post("/auth/register/verify-mobile", response_model=RegisterVerifyStepResponse, status_code=200)
async def register_verify_mobile(request: Request):
    """Verify mobile OTP only (no account creation until /register/complete)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    raw = await _require_json_object(request)
    code_in = str(raw.get("code") or raw.get("otp") or "").strip()
    if not code_in:
        raise HTTPException(status_code=400, detail="Verification code is required.")

    if raw.get("mobile"):
        try:
            body = RegisterMobileVerify.model_validate(raw)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc
        pending = await _get_signup_pending_for_mobile_verify(body)
    else:
        try:
            body = RegisterVerify.model_validate(_normalize_register_verify_json(raw))
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc
        email_lower = body.email.lower().strip()
        pending = await _get_signup_pending_or_raise(email_lower)

    if not pending.get("sms_otp_hash"):
        raise HTTPException(
            status_code=400,
            detail="SMS verification code has not been sent yet. Tap Send OTP on your mobile number.",
        )
    if pending.get("phone_verified"):
        raise HTTPException(status_code=400, detail="Mobile already verified for this signup.")

    lookup_key = (pending.get("email") or "pending").lower()
    await _assert_signup_otp_code(pending, lookup_key, code_in, channel="sms")

    filt: Dict[str, Any]
    if pending.get("email"):
        filt = {"email": pending["email"]}
    else:
        filt = {"phone_e164": pending["phone_e164"]}
    await db.signup_pending.update_one(filt, {"$set": {"phone_verified": True}})
    return RegisterVerifyStepResponse(
        message="Mobile verified. Enter your name and password, then create your account.",
        next_step="complete",
    )


@api_router.post("/auth/register/complete", response_model=TokenResponse, status_code=201)
async def register_complete(request: Request):
    """Create account after email and mobile OTP are both verified."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    raw = await _require_json_object(request)
    try:
        body = RegisterCompleteRequest.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    email_lower = body.email.lower().strip()
    pending = await _get_signup_pending_or_raise(email_lower)

    controls = await get_platform_controls()
    email_otp_enabled = controls.get("email_otp_service_enabled", True)
    sms_otp_enabled = controls.get("sms_otp_service_enabled", True)
    # Require SMS verify only when the channel is both enabled and deliverable
    # (AuthKey configured or admin dev OTP). Otherwise signup would soft-lock.
    sms_required = bool(sms_otp_enabled) and sms_otp_service.sms_available(controls)

    if email_otp_enabled and not pending.get("email_verified"):
        raise HTTPException(status_code=400, detail="Verify your email with the code we sent.")
    if sms_required and not pending.get("phone_verified"):
        raise HTTPException(status_code=400, detail="Verify your mobile with the SMS code we sent.")

    # Ensure mobile on pending matches submitted mobile when provided
    if (body.mobile or "").strip():
        try:
            cc, nat = authkey_sms.normalize_mobile(body.mobile or "", body.country_code)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        phone_e164 = _phone_e164(cc, nat)
        if pending.get("phone_e164") and pending.get("phone_e164") != phone_e164:
            raise HTTPException(status_code=400, detail="Mobile number does not match verified signup.")
        pending_phone = pending.get("phone_e164") or phone_e164
    elif sms_required:
        pending_phone = pending.get("phone_e164")
        if not pending_phone:
            raise HTTPException(status_code=400, detail="Mobile number is required to complete signup.")
    else:
        # SMS not required — phone is optional; use whatever was stored (may be None)
        pending_phone = pending.get("phone_e164")

    complete_set: Dict[str, Any] = {
        "name": body.name.strip(),
        "password_hash": hash_password(body.password),
        "phone_e164": pending_phone,
    }
    if (body.referral_code or "").strip() and not pending.get("referral_code"):
        complete_set["referral_code"] = body.referral_code.strip()
    await db.signup_pending.update_one(
        {"email": email_lower},
        {"$set": complete_set},
    )
    pending = await db.signup_pending.find_one({"email": email_lower}) or pending
    return await _complete_signup_from_pending(pending, email_lower)


@api_router.post("/auth/register/verify", response_model=TokenResponse, status_code=201)
async def register_verify(request: Request):
    """Legacy: single-step verify. Dual-channel signups must use verify-email then verify-mobile."""
    try:
        raw = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=422,
            detail=[{"loc": ["body"], "msg": "Invalid JSON body", "type": "json_invalid"}],
        )
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=422,
            detail=[{"loc": ["body"], "msg": "Expected a JSON object", "type": "value_error"}],
        )

    norm = _normalize_register_verify_json(raw)
    code_in   = str(norm.get("code") or "").strip()
    email_raw = str(norm.get("email") or "").strip()

    # Legacy fallback: one-step payload with no code and no pending row
    has_signup_shape = (
        bool(email_raw)
        and raw.get("name") is not None
        and str(raw.get("name") or "").strip() != ""
        and raw.get("password") is not None
        and str(raw.get("password") or "").strip() != ""
    )
    if not code_in and has_signup_shape:
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable — cannot register users")
        await enforce_feature("signup_enabled", "Signup is currently paused by admin")
        pending_exists = await db.signup_pending.find_one({"email": email_raw.lower()})
        if pending_exists:
            raise HTTPException(
                status_code=422,
                detail=[{
                    "loc": ["body", "code"],
                    "msg": "Missing verification code. Check your email for the 6-digit code and submit it here.",
                    "type": "missing",
                }],
            )
        uc = SignupCredentials.model_validate({
            "name": raw.get("name"), "email": email_raw, "password": raw.get("password"),
        })
        return await _register_one_step_from_user_create(uc)

    try:
        body = RegisterVerify.model_validate(norm)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot register users")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    email_lower = body.email.lower().strip()
    code_in = (body.code or "").strip()
    pending = await _get_signup_pending_or_raise(email_lower)

    if pending.get("otp_channel") == "both" or pending.get("phone_e164"):
        raise HTTPException(
            status_code=400,
            detail="Use email and mobile verification endpoints for this signup.",
        )

    await _assert_signup_otp_code(pending, email_lower, code_in)
    return await _complete_signup_from_pending(pending, email_lower)


@api_router.post("/auth/register/resend", response_model=RegisterRequestResponse, status_code=200)
async def register_resend(request: Request):
    """Resend a new OTP to a pending signup email. Rate-limited to 3 per 15 minutes per email."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await enforce_feature("signup_enabled", "Signup is currently paused by admin")

    controls  = await get_platform_controls()
    client_ip = rate_limit_service.client_ip_from_request(request)
    await _rate_limit(controls, "auth.register_resend", f"ip:{client_ip}",
                      limit_key="rate_limit_register_per_ip_per_min", window_sec=60)

    raw = await _require_json_object(request)
    email_lower = (str(raw.get("email") or "")).strip().lower()
    if not email_lower:
        raise HTTPException(status_code=422, detail="Email is required.")

    channel = (str(raw.get("channel") or raw.get("medium") or "")).strip().lower()
    if channel in ("mobile", "phone"):
        channel = "sms"
    if channel and channel not in ("email", "sms"):
        raise HTTPException(status_code=422, detail="channel must be 'email' or 'sms'.")

    # Rate limit per email: at most 3 resends per 15-minute window
    await _rate_limit(
        controls, "auth.register_resend", f"email:{email_lower}",
        limit_key="rate_limit_login_per_email_per_hr", window_sec=900,
    )

    pending = await db.signup_pending.find_one({"email": email_lower})
    if not pending:
        raise HTTPException(
            status_code=400,
            detail="No pending signup for this email. Please register again.",
        )
    if _signup_pending_expired(pending):
        await db.signup_pending.delete_one({"email": email_lower})
        raise HTTPException(status_code=400, detail="Signup session expired. Please register again.")

    now = datetime.now(timezone.utc)
    otp_expires = now + timedelta(minutes=OTP_TTL_MINUTES)
    otp_expires_iso = otp_expires.isoformat()

    name = pending.get("name") or ""
    nat = pending.get("mobile") or ""
    cc = pending.get("country_code") or authkey_sms.default_country_code()
    otp_channel = (pending.get("otp_channel") or "email").strip().lower()

    if otp_channel == "both":
        if not nat:
            raise HTTPException(status_code=400, detail="Invalid pending signup. Please register again.")
        email_verified = bool(pending.get("email_verified"))
        if not channel:
            channel = "sms" if email_verified else "email"

        if channel == "email":
            email_otp_plain = _new_signup_otp_code()
            await db.signup_pending.update_one(
                {"email": email_lower},
                {"$set": {
                    "email_otp_hash": _hash_signup_otp(email_otp_plain),
                    "email_otp_expires_at": otp_expires_iso,
                    "email_otp_attempts": 0,
                    "otp_sent_at": now.isoformat(),
                }},
            )
            subject, html, text = email_templates.otp_email(
                name=name, otp=email_otp_plain, expires_minutes=OTP_TTL_MINUTES,
            )
            email_sent = await email_service.send_email(
                to=email_lower, subject=subject, html_body=html, text_body=text,
                log_tag="signup_otp_resend",
            )
            if not email_sent:
                raise HTTPException(status_code=502, detail="Could not resend verification email.")
            logger.info("Email OTP resent for %s", email_lower)
            return RegisterRequestResponse(
                message="A new verification code has been sent to your email address.",
                email_hint=mask_email_hint(email_lower),
                phone_hint=authkey_sms.mask_phone_hint(cc, nat),
                verify_channel="both",
            )

        await _send_signup_sms_otp_for_pending(pending, email_lower, controls)
        logger.info("SMS OTP resent for %s (email_verified=%s)", email_lower, email_verified)
        return RegisterRequestResponse(
            message="A new verification code has been sent to your mobile number.",
            email_hint=mask_email_hint(email_lower),
            phone_hint=authkey_sms.mask_phone_hint(cc, nat),
            verify_channel="both",
        )

    otp_plain = _new_signup_otp_code()
    otp_hash = _hash_signup_otp(otp_plain)
    legacy_update = {
        "otp_hash": otp_hash,
        "otp_expires_at": otp_expires_iso,
        "otp_attempts": 0,
        "otp_sent_at": now.isoformat(),
    }

    if otp_channel == "sms":
        if not nat:
            raise HTTPException(status_code=400, detail="Invalid pending signup. Please register again.")
        sms_otp_plain, sms_result = await sms_otp_service.send_signup_sms_otp(
            controls=controls,
            mobile=nat,
            country_code=cc,
            name=name,
        )
        if not sms_result.ok:
            raise HTTPException(status_code=502, detail="Could not resend verification SMS.")
        await db.signup_pending.update_one(
            {"email": email_lower},
            {"$set": {
                "otp_hash": _hash_signup_otp(sms_otp_plain),
                "otp_expires_at": otp_expires_iso,
                "otp_attempts": 0,
                "otp_sent_at": now.isoformat(),
            }},
        )
        return RegisterRequestResponse(
            message="A new verification code has been sent to your mobile number.",
            phone_hint=authkey_sms.mask_phone_hint(cc, nat),
            verify_channel="sms",
        )

    await db.signup_pending.update_one(
        {"email": email_lower},
        {"$set": legacy_update},
    )
    subject, html, text = email_templates.otp_email(
        name=name, otp=otp_plain, expires_minutes=OTP_TTL_MINUTES,
    )
    sent = await email_service.send_email(
        to=email_lower, subject=subject, html_body=html, text_body=text,
        log_tag="signup_otp_resend",
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Could not resend verification email.")
    return RegisterRequestResponse(
        message="A new verification code has been sent to your email address.",
        email_hint=mask_email_hint(email_lower),
        verify_channel="email",
    )


@api_router.post("/auth/register", response_model=TokenResponse, status_code=201)
async def register_one_step(request: Request):  # noqa: D401 - keep existing handler signature
    controls = await get_platform_controls()
    client_ip = rate_limit_service.client_ip_from_request(request)
    await _rate_limit(controls, "auth.register", f"ip:{client_ip}",
                      limit_key="rate_limit_register_per_ip_per_min", window_sec=60)
    return await _register_one_step_impl(request)


async def _register_one_step_impl(request: Request):
    """
    One-step signup (creates the user immediately, no email code).

    Reads raw JSON from the request so FastAPI never injects a separate body schema
    (avoids stale OpenAPI / duplicate models requiring ``email_verification_code``).

    Clients should prefer /auth/register/request + /auth/register/verify when available.
    """
    try:
        body = await _require_json_object(request)
        try:
            uc = SignupCredentials.model_validate(body)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc
        return await _register_one_step_from_user_create(uc)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("register_one_step failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Registration failed: {type(exc).__name__}: {exc}",
        ) from exc


# ── Phase 7 helpers — 2FA, rate limiting, refresh tokens ────────────────────

async def _rate_limit(
    controls: Dict[str, Any],
    scope: str,
    key: str,
    *,
    limit_key: str,
    window_sec: int,
) -> None:
    """Thin wrapper over ``rate_limit_service.check_rate_limit`` that pulls
    the limit from ``platform_controls``. Disabled globally when
    ``rate_limit_enabled`` is False.
    """
    if not bool(controls.get("rate_limit_enabled", True)):
        return
    try:
        limit = int(controls.get(limit_key) or 0)
    except (TypeError, ValueError):
        limit = 0
    if limit <= 0:
        return
    await rate_limit_service.check_rate_limit(
        db, scope=scope, key=key, limit=limit, window_sec=window_sec,
    )


async def _record_login_audit(
    email: str,
    ip: str,
    *,
    success: bool,
    reason: str = "",
    uid: Optional[str] = None,
) -> None:
    """Append a row to ``login_audit``. Never raises — auditing must not
    impact the auth flow."""
    if db is None:
        return
    try:
        await db.login_audit.insert_one({
            "id":         f"la_{uuid.uuid4().hex[:16]}",
            "email":      email or None,
            "uid":        uid,
            "ip":         ip,
            "success":    bool(success),
            "reason":     reason or ("ok" if success else "fail"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:  # noqa: BLE001
        logger.exception("login_audit insert failed")


async def _get_user_2fa_doc(uid: str) -> Optional[Dict[str, Any]]:
    """Fetch the ``user_2fa`` row for ``uid`` (without Mongo ``_id``)."""
    if db is None or not uid:
        return None
    return await db.user_2fa.find_one({"uid": uid}, {"_id": 0})


async def _has_confirmed_2fa(uid: str) -> bool:
    doc = await _get_user_2fa_doc(uid)
    return bool(doc and doc.get("confirmed"))


async def _assert_twofa_code(
    user: Dict[str, Any],
    code: Optional[str],
    *,
    allow_backup: bool = True,
    context: str = "action",
) -> bool:
    """Verify ``code`` against the user's TOTP secret OR (optionally) a
    backup code. Raises HTTPException(401) on failure. Consumes the
    backup code atomically on success (so the same code can't be reused).

    Returns True on success; False if the user simply has no 2FA set up
    (caller decides whether that's acceptable for the context).
    """
    doc = await _get_user_2fa_doc(user["uid"])
    if not doc or not doc.get("confirmed"):
        return False
    if not code or not str(code).strip():
        raise HTTPException(status_code=401, detail=f"Two-factor code required to {context}.")

    # TOTP path
    secret = doc.get("secret_b32")
    if secret and twofa_service.verify_totp(secret, code):
        return True

    # Backup-code path (one-shot)
    if allow_backup:
        codes = list(doc.get("backup_codes") or [])
        idx, _ = twofa_service.match_backup_code(code, codes)
        if idx is not None:
            now_iso = datetime.now(timezone.utc).isoformat()
            # Only mark as used if still unused (atomic guard against
            # two parallel requests racing with the same code).
            res = await db.user_2fa.update_one(
                {
                    "uid": user["uid"],
                    f"backup_codes.{idx}.used_at": None,
                },
                {"$set": {f"backup_codes.{idx}.used_at": now_iso}},
            )
            if res.modified_count == 1:
                return True

    raise HTTPException(status_code=401, detail="Invalid two-factor code.")


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(body: UserLogin, request: Request):
    """Verify credentials and return a JWT + refresh token.

    Rate-limited on two axes:
      * per IP / minute (brute-force from a single host)
      * per email / hour (distributed brute-force against one account)

    Limits are read live from ``platform_controls`` so ops can tune them
    without a redeploy.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot log in")
    try:
        await enforce_feature("login_enabled", "Login is currently paused by admin")
        controls = await get_platform_controls()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if _mongodb_read_unavailable(exc):
            raise HTTPException(
                status_code=503,
                detail="Database temporarily unavailable — try again in a moment",
            ) from exc
        raise
    client_ip = rate_limit_service.client_ip_from_request(request)
    blocked = await _is_request_security_blocked(request)
    if blocked:
        await _log_security_event(
            event_type="auth.blocked",
            severity="warn",
            source="security",
            message="Blocked end-user login attempt.",
            meta={"ip": client_ip, "rule": blocked},
        )
        raise HTTPException(status_code=403, detail="Access is restricted from your network.")
    await _rate_limit(controls, "auth.login",    f"ip:{client_ip}",
                      limit_key="rate_limit_login_per_ip_per_min", window_sec=60)
    email_key = (body.email or "").strip().lower()
    if email_key:
        await _rate_limit(controls, "auth.login", f"email:{email_key}",
                          limit_key="rate_limit_login_per_email_per_hr",
                          window_sec=3600)

    try:
        user = await db.users.find_one({"email": body.email.lower()})
    except Exception as exc:  # noqa: BLE001
        if _mongodb_read_unavailable(exc):
            raise HTTPException(
                status_code=503,
                detail="Database temporarily unavailable — try again in a moment",
            ) from exc
        raise
    if not user:
        await _log_security_event(
            event_type="auth.login_failed",
            severity="warn",
            source="auth",
            message="Invalid end-user credentials.",
            meta={"email": email_key, "ip": client_ip},
        )
        await _record_login_audit(email_key, client_ip, success=False,
                                  reason="bad_credentials")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    ph = user.get("password_hash") or ""
    if not ph:
        await _record_login_audit(email_key, client_ip, success=False,
                                  reason="oauth_only", uid=user.get("uid"))
        raise HTTPException(
            status_code=401,
            detail="This account uses Google or Apple sign-in. Continue with Google or Apple.",
        )
    if not verify_password(body.password, ph):
        await _log_security_event(
            event_type="auth.login_failed",
            severity="warn",
            source="auth",
            message="Invalid end-user credentials.",
            meta={"email": email_key, "ip": client_ip},
        )
        await _record_login_audit(email_key, client_ip, success=False,
                                  reason="bad_credentials")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.get("is_active", True):
        await _record_login_audit(email_key, client_ip, success=False,
                                  reason="account_disabled", uid=user.get("uid"))
        raise HTTPException(status_code=403, detail="Account is disabled")

    now = datetime.now(timezone.utc).isoformat()
    try:
        await db.users.update_one(
            {"uid": user["uid"]},
            {"$set": {"last_login_at": now, "last_login_ip": client_ip}},
        )
    except Exception as exc:  # noqa: BLE001
        if _mongodb_read_unavailable(exc):
            logger.warning("login: could not update last_login_at (%s)", exc)
        else:
            raise
    user["last_login_at"] = now

    # Fresh login clears transient rate-limit buckets for this identity so
    # the user isn't still rate-limited after they legitimately succeed.
    await rate_limit_service.clear_key(db, scope="auth.login", key=f"email:{email_key}")

    user["two_factor_enabled"] = await _has_confirmed_2fa(user["uid"])
    user_out = user_doc_to_out(user)
    access, refresh = await _issue_token_pair(user)
    await _record_login_audit(email_key, client_ip, success=True, uid=user["uid"])
    logger.info("User logged in: %s", user["email"])
    return TokenResponse(access_token=access, refresh_token=refresh, user=user_out)


class OAuthLoginBody(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    id_token: Optional[str] = Field(None, max_length=12000)
    access_token: Optional[str] = Field(None, max_length=8000)
    name: Optional[str] = Field(None, max_length=80)
    referral_code: Optional[str] = Field(None, max_length=32)


async def _oauth_login_or_register(
    *,
    provider: str,
    profile: dict,
    request: Request,
    body: OAuthLoginBody,
) -> TokenResponse:
    """Link existing user by provider subject / email, or create a new account."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot log in")
    await enforce_feature("login_enabled", "Login is currently paused by admin")

    controls = await get_platform_controls()
    client_ip = rate_limit_service.client_ip_from_request(request)
    blocked = await _is_request_security_blocked(request)
    if blocked:
        raise HTTPException(status_code=403, detail="Access is restricted from your network.")
    await _rate_limit(
        controls, "auth.oauth", f"ip:{client_ip}",
        limit_key="rate_limit_login_per_ip_per_min", window_sec=60,
    )

    sub = (profile.get("sub") or "").strip()
    email = (profile.get("email") or "").strip().lower()
    display_name = (body.name or profile.get("name") or "").strip()
    if not display_name and email:
        display_name = email.split("@")[0]
    if not display_name:
        display_name = "User"
    display_name = display_name[:50]

    user = None
    if sub:
        user = await db.users.find_one({f"oauth.{provider}": sub})
    if user is None and email:
        user = await db.users.find_one({"email": email})

    now = datetime.now(timezone.utc).isoformat()
    created = False

    if user is None:
        if not email:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Apple did not return an email. Sign in once more, or use the same Apple ID "
                    "that previously created this account."
                ),
            )
        await enforce_feature("signup_enabled", "Signup is currently paused by admin")
        uid = f"u_{uuid.uuid4().hex[:16]}"
        user_doc = {
            "uid": uid,
            "email": email,
            "name": display_name,
            "password_hash": None,
            "auth_providers": [provider],
            "oauth": {provider: sub} if sub else {},
            "email_verified": bool(profile.get("email_verified", True)),
            "avatar_url": profile.get("picture"),
            "created_at": now,
            "is_active": True,
            "kyc_status": "unverified",
            "referral_code": await referral_svc.generate_referral_code(db),
            "last_login_at": now,
            "last_login_ip": client_ip,
        }
        try:
            await db.users.insert_one(user_doc)
        except DuplicateKeyError:
            user = await db.users.find_one({"email": email})
            if not user:
                raise HTTPException(status_code=409, detail="Account already exists") from None
        else:
            await seed_wallet(uid)
            try:
                await referral_svc.apply_referral_signup(
                    db, uid, body.referral_code, controls,
                    get_or_create_address=_get_or_create_user_deposit_address,
                )
            except Exception:  # noqa: BLE001
                logger.exception("oauth register: referral link failed uid=%s", uid)
            user = user_doc
            created = True
            logger.info("New user via %s OAuth: %s (%s)", provider, email, uid)

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is disabled")

    updates: Dict[str, Any] = {
        "last_login_at": now,
        "last_login_ip": client_ip,
    }
    if sub:
        updates[f"oauth.{provider}"] = sub
    providers = list(user.get("auth_providers") or [])
    if provider not in providers:
        providers.append(provider)
        updates["auth_providers"] = providers
    if profile.get("picture") and not user.get("avatar_url"):
        updates["avatar_url"] = profile.get("picture")
    if email and not user.get("email"):
        updates["email"] = email

    await db.users.update_one({"uid": user["uid"]}, {"$set": updates})
    user = await db.users.find_one({"uid": user["uid"]}) or {**user, **updates}

    user["two_factor_enabled"] = await _has_confirmed_2fa(user["uid"])
    user_out = user_doc_to_out(user)
    access, refresh = await _issue_token_pair(user)
    await _record_login_audit(
        user.get("email") or email or "",
        client_ip,
        success=True,
        uid=user["uid"],
        reason=f"oauth_{provider}" + ("_signup" if created else ""),
    )
    logger.info("User logged in via %s: %s", provider, user.get("email"))
    return TokenResponse(access_token=access, refresh_token=refresh, user=user_out)


@api_router.get("/auth/oauth/config")
async def oauth_config():
    """Public: which social providers are configured (client IDs for GIS / AppleJS)."""
    return oauth_svc.oauth_public_config()


@api_router.post("/auth/oauth/google", response_model=TokenResponse)
async def oauth_google(body: OAuthLoginBody, request: Request):
    try:
        if body.id_token:
            profile = await oauth_svc.verify_google_id_token(body.id_token)
        elif body.access_token:
            profile = await oauth_svc.verify_google_access_token(body.access_token)
        else:
            raise HTTPException(status_code=422, detail="Provide id_token or access_token")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except Exception as exc:
        # Network / cert fetch failures from oauth_service (httpx)
        if type(exc).__module__.startswith("httpx"):
            logger.exception("Google OAuth verification network error")
            raise HTTPException(status_code=502, detail="Could not verify Google token") from exc
        raise
    return await _oauth_login_or_register(
        provider="google", profile=profile, request=request, body=body,
    )


@api_router.post("/auth/oauth/apple", response_model=TokenResponse)
async def oauth_apple(body: OAuthLoginBody, request: Request):
    try:
        if not body.id_token:
            raise HTTPException(status_code=422, detail="Provide Apple id_token")
        profile = await oauth_svc.verify_apple_id_token(body.id_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except Exception as exc:
        if type(exc).__module__.startswith("httpx"):
            logger.exception("Apple OAuth verification network error")
            raise HTTPException(status_code=502, detail="Could not verify Apple token") from exc
        raise
    return await _oauth_login_or_register(
        provider="apple", profile=profile, request=request, body=body,
    )


@api_router.get("/auth/me", response_model=UserOut)
async def get_me(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's profile. Used to validate stored tokens on startup."""
    current_user["two_factor_enabled"] = await _has_confirmed_2fa(current_user["uid"])
    return user_doc_to_out(current_user)


@api_router.get("/referral/me")
async def get_my_referral_info(current_user: dict = Depends(get_current_user)):
    """Caller's referral code, share links, earnings summary, and downstream tree."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    code = await referral_svc.ensure_referral_code(db, uid)
    controls = await get_platform_controls()
    dashboard = await referral_svc.get_referral_dashboard(db, uid)
    return {
        "referral_code": code,
        "referral_enabled": bool(controls.get("referral_enabled", False)),
        "share_links": {
            "website": controls.get("referral_share_website_url") or "",
            "playstore": controls.get("referral_share_playstore_url") or "",
        },
        "summary": dashboard["summary"],
        "referrals": dashboard["referrals"],
    }


@api_router.get("/referral/tree")
async def get_my_referral_tree(current_user: dict = Depends(get_current_user)):
    """Legacy tree-only endpoint (prefer ``/referral/me`` which includes referrals)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    tree = await referral_svc.get_referral_tree(db, uid)
    return {"referrals": tree}


class SessionOut(BaseModel):
    user:                    UserOut
    impersonation_active:    bool = False
    impersonator_admin_id:   Optional[str] = None
    user_features_paused:    bool = False
    user_trading_paused:     bool = False
    user_withdrawals_paused: bool = False
    user_pause_note:         Optional[str] = None


@api_router.get("/auth/session", response_model=SessionOut)
async def get_session(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    current_user: dict = Depends(get_current_user),
):
    """End-user session flags (e.g. admin impersonation) decoded from JWT."""
    imp = False
    iad: Optional[str] = None
    if credentials and credentials.credentials:
        try:
            payload = jwt.decode(
                credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM]
            )
            imp = bool(payload.get("imp"))
            iad = payload.get("iad")
        except JWTError:
            pass
    np = (current_user.get("user_pause_note") or "").strip() or None
    current_user["two_factor_enabled"] = await _has_confirmed_2fa(current_user["uid"])
    return SessionOut(
        user=user_doc_to_out(current_user),
        impersonation_active=imp,
        impersonator_admin_id=iad,
        user_features_paused=bool(current_user.get("user_features_paused", False)),
        user_trading_paused=bool(current_user.get("user_trading_paused", False)),
        user_withdrawals_paused=bool(current_user.get("user_withdrawals_paused", False)),
        user_pause_note=np,
    )


# ── Phase 7b — refresh-token rotation + session revocation ──────────────────

class RefreshBody(BaseModel):
    refresh_token: str = Field(..., min_length=16, max_length=4096)


class RefreshResponse(BaseModel):
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"


@api_router.post("/auth/refresh", response_model=RefreshResponse)
async def refresh_access_token(body: RefreshBody, request: Request):
    """Exchange a valid refresh token for a new (access, refresh) pair.

    Rotation is one-shot: the incoming jti is deleted atomically and a new
    jti is inserted. If the incoming jti has already been consumed
    (replay), ``find_one_and_delete`` returns ``None`` and the caller is
    force-logged-out via 401.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    try:
        payload = jwt.decode(body.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Refresh token invalid or expired")
    if payload.get("typ") != "refresh":
        raise HTTPException(status_code=401, detail="Wrong token type")
    uid = payload.get("sub")
    jti = payload.get("jti")
    if not uid or not jti:
        raise HTTPException(status_code=401, detail="Invalid refresh token payload")

    # Rate-limit per uid so a stolen refresh token can't be hammered.
    controls = await get_platform_controls()
    await _rate_limit(controls, "auth.refresh", f"uid:{uid}",
                      limit_key="rate_limit_2fa_per_uid_per_min", window_sec=60)

    removed = await db.refresh_tokens.find_one_and_delete({"jti": jti, "uid": uid})
    if not removed:
        # Either replayed, revoked, or TTL-expired. Always answer the same
        # so attackers can't distinguish the cases.
        raise HTTPException(status_code=401, detail="Refresh token no longer valid")

    user = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account not available")

    user_epoch = int(user.get("sessions_epoch") or 0)
    if int(payload.get("epoch") or 0) != user_epoch:
        raise HTTPException(status_code=401, detail="Session revoked — please sign in again.")

    access, refresh = await _issue_token_pair(user)
    return RefreshResponse(access_token=access, refresh_token=refresh)


@api_router.post("/auth/logout")
async def logout_current_session(
    body: Optional[RefreshBody] = None,
    current_user: dict = Depends(get_current_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Revoke the refresh token tied to this device (if supplied).

    Safe to call without a refresh token — it's a no-op in that case. The
    access token naturally expires on its own; clients should drop both
    tokens immediately after calling this.
    """
    _reject_if_impersonating(credentials, action="Logout")
    if db is None:
        return {"ok": True}
    if body and body.refresh_token:
        try:
            payload = jwt.decode(body.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
            jti = payload.get("jti")
            if jti and payload.get("sub") == current_user["uid"]:
                await db.refresh_tokens.delete_one({"jti": jti, "uid": current_user["uid"]})
        except JWTError:
            pass  # already invalid; nothing to revoke
    return {"ok": True}


@api_router.post("/auth/sessions/revoke-all")
async def revoke_all_sessions(
    current_user: dict = Depends(get_current_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Log out of every device. Bumps ``sessions_epoch`` so all existing
    access tokens fail the epoch check on their next request, and
    deletes all stored refresh tokens for the user."""
    _reject_if_impersonating(credentials, action="Revoking all sessions")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    res = await db.users.find_one_and_update(
        {"uid": current_user["uid"]},
        {"$inc": {"sessions_epoch": 1}},
        projection={"_id": 0, "sessions_epoch": 1},
        return_document=ReturnDocument.AFTER,
    )
    new_epoch = int((res or {}).get("sessions_epoch") or 1)
    await db.refresh_tokens.delete_many({"uid": current_user["uid"]})
    await db.admin_audit_logs.insert_one({
        "id":          f"aud_{uuid.uuid4().hex[:16]}",
        "admin_aid":   None,
        "admin_email": None,
        "source":      "user",
        "action":      "user.sessions.revoke_all",
        "target_type": "user",
        "target_id":   current_user["uid"],
        "extra":       {"new_epoch": new_epoch},
        "created_at":  datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "sessions_epoch": new_epoch}


# ── Account Activity ──────────────────────────────────────────────────────────

@api_router.get("/auth/account-activity")
async def get_account_activity(current_user: dict = Depends(get_current_user)):
    """Return recent login history and active sessions for the current user."""
    if db is None:
        return {"sessions": [], "login_history": []}
    uid = current_user["uid"]

    raw_sessions = await db.refresh_tokens.find(
        {"uid": uid},
        {"_id": 0, "jti": 1, "created_at": 1, "expires_at": 1},
        sort=[("created_at", -1)],
    ).limit(10).to_list(10)

    sessions = []
    for s in raw_sessions:
        ca = s.get("created_at")
        ea = s.get("expires_at")
        sessions.append({
            "jti": s.get("jti", ""),
            "created_at": ca.isoformat() if hasattr(ca, "isoformat") else str(ca or ""),
            "expires_at": ea.isoformat() if hasattr(ea, "isoformat") else str(ea or ""),
        })

    raw_audits = await db.login_audit.find(
        {"uid": uid},
        {"_id": 0, "success": 1, "ip": 1, "created_at": 1, "reason": 1},
        sort=[("created_at", -1)],
    ).limit(20).to_list(20)

    login_history = []
    for a in raw_audits:
        ca = a.get("created_at")
        login_history.append({
            "success": bool(a.get("success", False)),
            "ip": a.get("ip") or "Unknown",
            "reason": a.get("reason") or "",
            "created_at": ca if isinstance(ca, str) else (ca.isoformat() if hasattr(ca, "isoformat") else str(ca or "")),
        })

    return {"sessions": sessions, "login_history": login_history}


# ── Safe Session ──────────────────────────────────────────────────────────────

class SafeSessionBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: bool


@api_router.post("/auth/safe-session")
async def toggle_safe_session(body: SafeSessionBody, current_user: dict = Depends(get_current_user)):
    """Enable or disable safe session mode for the current user."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await db.users.update_one(
        {"uid": current_user["uid"]},
        {"$set": {"safe_session": body.enabled}},
    )
    return {"ok": True, "safe_session": body.enabled}


# ── Anti-Phishing Code ────────────────────────────────────────────────────────

class AntiPhishingCodeBody(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    code: str = Field(..., min_length=0, max_length=24)


@api_router.get("/auth/anti-phishing-code")
async def get_anti_phishing_code(current_user: dict = Depends(get_current_user)):
    """Return the user's current anti-phishing code (if set)."""
    return {"code": current_user.get("anti_phishing_code") or ""}


@api_router.post("/auth/anti-phishing-code")
async def set_anti_phishing_code(body: AntiPhishingCodeBody, current_user: dict = Depends(get_current_user)):
    """Set or update the anti-phishing code shown in platform emails. Empty string clears it."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    code_val = body.code.strip() or None
    if code_val is not None and len(code_val) < 4:
        raise HTTPException(status_code=422, detail="Anti-phishing code must be at least 4 characters.")
    await db.users.update_one(
        {"uid": current_user["uid"]},
        {"$set": {"anti_phishing_code": code_val}},
    )
    return {"ok": True, "code": code_val or ""}


# ── Account Deletion ──────────────────────────────────────────────────────────

class AccountDeleteBody(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    password: str = Field(..., min_length=1, max_length=USER_PASSWORD_MAX_LEN)
    reason:   Optional[str] = Field(default=None, max_length=500)


@api_router.post("/auth/account/delete")
async def request_account_deletion(
    body: AccountDeleteBody,
    current_user: dict = Depends(get_current_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Mark the account as pending deletion after password confirmation."""
    _reject_if_impersonating(credentials, action="Account deletion")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    user = await db.users.find_one({"uid": current_user["uid"]})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Incorrect password")
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"uid": current_user["uid"]},
        {"$set": {
            "pending_deletion": True,
            "pending_deletion_at": now,
            "pending_deletion_reason": body.reason or "",
        }},
    )
    await db.admin_audit_logs.insert_one({
        "id":          f"aud_{uuid.uuid4().hex[:16]}",
        "admin_aid":   None,
        "admin_email": None,
        "source":      "user",
        "action":      "user.account.deletion_requested",
        "target_type": "user",
        "target_id":   current_user["uid"],
        "extra":       {"reason": body.reason or ""},
        "created_at":  now,
    })
    return {"ok": True, "pending_deletion": True}


@api_router.post("/auth/account/cancel-deletion")
async def cancel_account_deletion(current_user: dict = Depends(get_current_user)):
    """Cancel a pending account deletion request."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    await db.users.update_one(
        {"uid": current_user["uid"]},
        {"$set": {
            "pending_deletion": False,
            "pending_deletion_at": None,
            "pending_deletion_reason": None,
        }},
    )
    return {"ok": True, "pending_deletion": False}


class ForgotPasswordBody(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    email: EmailStr


class ResetPasswordBody(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    token:        str = Field(..., min_length=16, max_length=512)
    new_password: str = Field(..., min_length=8, max_length=USER_PASSWORD_MAX_LEN)

    @field_validator("new_password")
    @classmethod
    def _pw_reset_strength(cls, v: str) -> str:
        return validate_strong_user_password_value(v)


@api_router.post("/auth/forgot-password")
async def auth_forgot_password(
    body: ForgotPasswordBody,
    request: Request,
):
    """Queue a password-reset email. Always returns the same envelope (no user enumeration)."""
    msg = {
        "ok": True,
        "message": "If an account exists for that email, password reset instructions were sent.",
    }
    if db is None:
        return msg
    controls = await get_platform_controls()
    client_ip = rate_limit_service.client_ip_from_request(request)
    await _rate_limit(controls, "auth.forgot_password", f"ip:{client_ip}",
                      limit_key="rate_limit_login_per_ip_per_min", window_sec=60)
    email_key = (body.email or "").strip().lower()
    if email_key:
        await _rate_limit(controls, "auth.forgot_password", f"email:{email_key}",
                          limit_key="rate_limit_login_per_email_per_hr",
                          window_sec=3600)
    user = await db.users.find_one({"email": email_key}, {"_id": 0, "uid": 1, "email": 1, "name": 1})
    if not user:
        return msg
    plain, rid = await password_reset_service.issue_token(
        db,
        uid=user["uid"],
        email=user["email"],
        admin_triggered=False,
    )
    link = password_reset_service.build_reset_link(plain)
    logger.info(
        "auth_forgot_password: reset link host for uid=%s → %s",
        user["uid"],
        password_reset_service.reset_link_host_for_log(link),
    )
    sent = await password_reset_service.send_password_reset_email(user["email"], link, name=user.get("name") or "")
    if not sent:
        await db.password_reset_tokens.delete_one({"id": rid})
        logger.warning(
            "auth_forgot_password: SMTP delivery failed — token rolled back for %s",
            password_reset_service.mask_email(user["email"]),
        )
    else:
        logger.info(
            "auth_forgot_password: reset email sent uid=%s email=%s",
            user["uid"], password_reset_service.mask_email(user["email"]),
        )
    return msg


@api_router.post("/auth/reset-password")
async def auth_reset_password(body: ResetPasswordBody):
    """Consume a reset token and set a new password (invalidates all sessions)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    row = await password_reset_service.validate_active_token(db, plain_token=body.token)
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
    uid = row.get("uid")
    if not uid:
        raise HTTPException(status_code=400, detail="Invalid reset token.")
    new_hash = hash_password(body.new_password)
    await db.users.update_one(
        {"uid": uid},
        {"$set": {"password_hash": new_hash},
         "$inc": {"sessions_epoch": 1}},
    )
    await db.refresh_tokens.delete_many({"uid": uid})
    await password_reset_service.mark_consumed(db, row_id=row["id"])
    logger.info("auth_reset_password: password changed uid=%s", uid)
    return {"ok": True, "message": "Password updated. Please sign in again."}


# ── Phase 7a — TOTP 2FA endpoints ───────────────────────────────────────────

class TwoFASetupOut(BaseModel):
    secret_b32:  str
    otpauth_url: str
    issuer:      str


class TwoFAVerifyBody(BaseModel):
    code: str = Field(..., min_length=1, max_length=32)


class TwoFAVerifyOut(BaseModel):
    enabled:      bool
    backup_codes: List[str]


class TwoFADisableBody(BaseModel):
    password: str = Field(..., min_length=1, max_length=USER_PASSWORD_MAX_LEN)
    code:     Optional[str] = Field(None, max_length=32)


class TwoFARegenBody(BaseModel):
    code: str = Field(..., min_length=1, max_length=32)


class TwoFAStatusOut(BaseModel):
    enabled:                 bool
    pending_setup:           bool
    backup_codes_remaining:  int
    required_for_withdrawal: bool


TWOFA_ISSUER = os.environ.get("TOTP_ISSUER", "IBO")


async def _rate_limit_2fa(controls: Dict[str, Any], uid: str, scope: str) -> None:
    await _rate_limit(controls, scope, f"uid:{uid}",
                      limit_key="rate_limit_2fa_per_uid_per_min", window_sec=60)


@api_router.get("/auth/2fa/status", response_model=TwoFAStatusOut)
async def twofa_status(current_user: dict = Depends(get_current_user)):
    controls = await get_platform_controls()
    doc = await _get_user_2fa_doc(current_user["uid"])
    codes = (doc or {}).get("backup_codes") or []
    remaining = sum(1 for c in codes if isinstance(c, dict) and not c.get("used_at"))
    return TwoFAStatusOut(
        enabled=bool(doc and doc.get("confirmed")),
        pending_setup=bool(doc and not doc.get("confirmed")),
        backup_codes_remaining=remaining,
        required_for_withdrawal=bool(
            controls.get("two_factor_required_for_withdrawal")
            and controls.get("two_factor_enabled")
        ),
    )


@api_router.post("/auth/2fa/setup", response_model=TwoFASetupOut)
async def twofa_setup(current_user: dict = Depends(get_current_user)):
    """Begin 2FA enrollment.

    Generates a fresh TOTP secret and stores it as an UNCONFIRMED row. The
    user must call ``/auth/2fa/verify`` with a valid 6-digit code before
    2FA is actually enabled. Re-calling this endpoint replaces any
    previous unconfirmed secret — but NEVER overrides a confirmed row
    (you have to disable first, which requires the existing code).
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    controls = await get_platform_controls()
    await _rate_limit_2fa(controls, current_user["uid"], "auth.2fa.setup")

    existing = await _get_user_2fa_doc(current_user["uid"])
    if existing and existing.get("confirmed"):
        raise HTTPException(
            status_code=409,
            detail="Two-factor authentication is already enabled. Disable it first to re-enroll.",
        )

    secret = twofa_service.new_secret_b32()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.user_2fa.update_one(
        {"uid": current_user["uid"]},
        {
            "$set": {
                "uid":          current_user["uid"],
                "secret_b32":   secret,
                "confirmed":    False,
                "updated_at":   now_iso,
                "backup_codes": [],
            },
            "$setOnInsert": {"created_at": now_iso},
        },
        upsert=True,
    )
    url = twofa_service.otpauth_url(
        secret_b32=secret,
        account_label=current_user["email"],
        issuer=TWOFA_ISSUER,
    )
    return TwoFASetupOut(secret_b32=secret, otpauth_url=url, issuer=TWOFA_ISSUER)


@api_router.post("/auth/2fa/verify", response_model=TwoFAVerifyOut)
async def twofa_verify(body: TwoFAVerifyBody, current_user: dict = Depends(get_current_user)):
    """Confirm the pending TOTP secret and issue backup codes.

    On success: marks the row ``confirmed=true`` and stores 10 hashed
    backup codes. The plaintext codes are returned ONCE — we never
    expose them again. Users should treat them like a recovery phrase.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    controls = await get_platform_controls()
    await _rate_limit_2fa(controls, current_user["uid"], "auth.2fa.verify")

    doc = await _get_user_2fa_doc(current_user["uid"])
    if not doc:
        raise HTTPException(status_code=400, detail="Start 2FA setup first.")
    if doc.get("confirmed"):
        raise HTTPException(status_code=409, detail="Two-factor authentication is already enabled.")
    secret = doc.get("secret_b32") or ""
    if not twofa_service.verify_totp(secret, body.code):
        raise HTTPException(status_code=401, detail="Invalid code — check the time on your authenticator app and try again.")

    codes = twofa_service.generate_backup_codes()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.user_2fa.update_one(
        {"uid": current_user["uid"]},
        {
            "$set": {
                "confirmed":    True,
                "confirmed_at": now_iso,
                "updated_at":   now_iso,
                "backup_codes": [{"hash": c.hash, "used_at": None} for c in codes],
            },
        },
    )
    await db.admin_audit_logs.insert_one({
        "id":          f"aud_{uuid.uuid4().hex[:16]}",
        "admin_aid":   None,
        "admin_email": None,
        "source":      "user",
        "action":      "user.2fa.enrolled",
        "target_type": "user",
        "target_id":   current_user["uid"],
        "extra":       {},
        "created_at":  now_iso,
    })
    return TwoFAVerifyOut(enabled=True, backup_codes=[c.plaintext for c in codes])


@api_router.post("/auth/2fa/disable")
async def twofa_disable(
    body: TwoFADisableBody,
    current_user: dict = Depends(get_current_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Disable 2FA.

    Requires BOTH the current password AND a valid TOTP / backup code —
    belt and braces, so a stolen-session attacker who doesn't know the
    password can't turn off the user's second factor.
    """
    _reject_if_impersonating(credentials, action="Disabling 2FA")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    controls = await get_platform_controls()
    await _rate_limit_2fa(controls, current_user["uid"], "auth.2fa.disable")

    # Password check (fetch the hash separately — ``current_user`` is
    # projected without it).
    full = await db.users.find_one({"uid": current_user["uid"]})
    if not full or not verify_password(body.password, full.get("password_hash") or ""):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    doc = await _get_user_2fa_doc(current_user["uid"])
    if not doc or not doc.get("confirmed"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled.")

    await _assert_twofa_code(current_user, body.code, context="disable 2FA")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.user_2fa.delete_one({"uid": current_user["uid"]})
    await db.admin_audit_logs.insert_one({
        "id":          f"aud_{uuid.uuid4().hex[:16]}",
        "admin_aid":   None,
        "admin_email": None,
        "source":      "user",
        "action":      "user.2fa.disabled",
        "target_type": "user",
        "target_id":   current_user["uid"],
        "extra":       {},
        "created_at":  now_iso,
    })
    return {"ok": True, "enabled": False}


@api_router.post("/auth/2fa/backup-codes/regenerate", response_model=TwoFAVerifyOut)
async def twofa_regen_backup_codes(
    body: TwoFARegenBody,
    current_user: dict = Depends(get_current_user),
):
    """Invalidate all previous backup codes and mint a new batch.

    Requires a valid TOTP or remaining backup code. Previous codes are
    discarded even if unused — regeneration is a reset.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    controls = await get_platform_controls()
    await _rate_limit_2fa(controls, current_user["uid"], "auth.2fa.regen")

    doc = await _get_user_2fa_doc(current_user["uid"])
    if not doc or not doc.get("confirmed"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled.")
    await _assert_twofa_code(current_user, body.code, context="regenerate backup codes")

    codes = twofa_service.generate_backup_codes()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.user_2fa.update_one(
        {"uid": current_user["uid"]},
        {"$set": {
            "backup_codes": [{"hash": c.hash, "used_at": None} for c in codes],
            "updated_at":   now_iso,
        }},
    )
    return TwoFAVerifyOut(enabled=True, backup_codes=[c.plaintext for c in codes])


# ── Admin panel auth & JSON APIs (Bearer admin JWT or X-Admin-Key) ────────────

def _support_ticket_public_view(ticket: Dict[str, Any], *, is_admin: bool = False) -> Dict[str, Any]:
    out = dict(ticket or {})
    out.pop("_id", None)
    messages = out.get("messages") or []
    if not is_admin:
        messages = [m for m in messages if not bool(m.get("internal_note"))]
    out["messages"] = messages
    return out


@api_router.post("/support/tickets", status_code=201)
async def support_create_ticket(
    body: SupportTicketCreate,
    current_user: dict = Depends(get_current_user),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    enforce_user_actions_allowed(current_user)
    uid = current_user["uid"]
    now = datetime.now(timezone.utc).isoformat()
    tid = f"tkt_{uuid.uuid4().hex[:12]}"
    msg = {
        "id": f"msg_{uuid.uuid4().hex[:14]}",
        "from_type": "user",
        "from_id": uid,
        "message": body.message.strip(),
        "internal_note": False,
        "created_at": now,
    }
    doc = {
        "id": tid,
        "uid": uid,
        "user_email": current_user.get("email"),
        "subject": body.subject.strip(),
        "category": body.category,
        "priority": body.priority,
        "status": "open",
        "assignee_aid": None,
        "order_id": (body.order_id or "").strip() or None,
        "trade_id": (body.trade_id or "").strip() or None,
        "dispute_kind": (body.dispute_kind or "").strip() or None,
        "messages": [msg],
        "created_at": now,
        "updated_at": now,
        "last_user_message_at": now,
        "last_admin_message_at": None,
    }
    await db.support_tickets.insert_one(doc)
    return _support_ticket_public_view(doc, is_admin=False)


@api_router.get("/support/tickets")
async def support_list_tickets(
    status: Optional[str] = None,
    category: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    filt: Dict[str, Any] = {"uid": uid}
    if status:
        filt["status"] = str(status).strip()
    if category:
        filt["category"] = str(category).strip()
    rows = await db.support_tickets.find(filt, {"_id": 0}).sort("updated_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.support_tickets.count_documents(filt)
    return {
        "items": [_support_ticket_public_view(r, is_admin=False) for r in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@api_router.get("/support/tickets/{ticket_id}")
async def support_get_ticket(
    ticket_id: str,
    current_user: dict = Depends(get_current_user),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    row = await db.support_tickets.find_one({"id": ticket_id, "uid": current_user["uid"]}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _support_ticket_public_view(row, is_admin=False)


@api_router.post("/support/tickets/{ticket_id}/messages")
async def support_add_message(
    ticket_id: str,
    body: SupportTicketMessageCreate,
    current_user: dict = Depends(get_current_user),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    now = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": f"msg_{uuid.uuid4().hex[:14]}",
        "from_type": "user",
        "from_id": current_user["uid"],
        "message": body.message.strip(),
        "internal_note": False,
        "created_at": now,
    }
    res = await db.support_tickets.find_one_and_update(
        {"id": ticket_id, "uid": current_user["uid"]},
        {"$push": {"messages": msg}, "$set": {"updated_at": now, "last_user_message_at": now}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not res:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _support_ticket_public_view(res, is_admin=False)


@api_router.get("/admin/support/tickets")
async def admin_support_tickets(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    q: str = "",
    status: str = "",
    category: str = "",
    priority: str = "",
    uid: str = "",
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_support")
    filt: Dict[str, Any] = {}
    clauses: List[Dict[str, Any]] = []
    if q.strip():
        rx = {"$regex": q.strip(), "$options": "i"}
        clauses.append({"$or": [{"id": rx}, {"subject": rx}, {"uid": rx}, {"user_email": rx}]})
    if status.strip():
        clauses.append({"status": status.strip()})
    if category.strip():
        clauses.append({"category": category.strip()})
    if priority.strip():
        clauses.append({"priority": priority.strip()})
    if uid.strip():
        clauses.append({"uid": uid.strip()})
    if clauses:
        filt["$and"] = clauses
    rows = await db.support_tickets.find(filt, {"_id": 0}).sort("updated_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.support_tickets.count_documents(filt)
    return {
        "items": [_support_ticket_public_view(r, is_admin=True) for r in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@api_router.get("/admin/support/tickets/{ticket_id}")
async def admin_support_ticket_get(
    ticket_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_support")
    row = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _support_ticket_public_view(row, is_admin=True)


@api_router.patch("/admin/support/tickets/{ticket_id}")
async def admin_support_ticket_patch(
    ticket_id: str,
    body: SupportTicketPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_support")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    row = await db.support_tickets.find_one_and_update(
        {"id": ticket_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _support_ticket_public_view(row, is_admin=True)


@api_router.post("/admin/support/tickets/{ticket_id}/messages")
async def admin_support_ticket_message(
    ticket_id: str,
    body: SupportTicketMessageCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_support")
    now = datetime.now(timezone.utc).isoformat()
    admin_doc = auth.admin or {}
    msg = {
        "id": f"msg_{uuid.uuid4().hex[:14]}",
        "from_type": "admin",
        "from_id": admin_doc.get("aid"),
        "from_email": admin_doc.get("email"),
        "message": body.message.strip(),
        "internal_note": bool(body.internal_note),
        "created_at": now,
    }
    row = await db.support_tickets.find_one_and_update(
        {"id": ticket_id},
        {"$push": {"messages": msg}, "$set": {"updated_at": now, "last_admin_message_at": now}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _support_ticket_public_view(row, is_admin=True)

@api_router.post("/admin/auth/login", response_model=AdminTokenResponse)
async def admin_login(body: AdminLogin, request: Request):
    """Sign in to the admin panel (separate from end-user JWT)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    client_ip = rate_limit_service.client_ip_from_request(request)
    blocked = await _is_request_security_blocked(request)
    if blocked:
        await _log_security_event(
            event_type="admin.blocked",
            severity="critical",
            source="security",
            message="Blocked admin login attempt.",
            meta={"ip": client_ip, "rule": blocked, "email": body.email.lower()},
        )
        raise HTTPException(status_code=403, detail="Access is restricted from your network.")
    admin = await db.admin_users.find_one({"email": body.email.lower()})
    if not admin or not verify_password(body.password, admin["password_hash"]):
        await _log_security_event(
            event_type="admin.login_failed",
            severity="warn",
            source="auth",
            message="Invalid admin credentials.",
            meta={"email": body.email.lower(), "ip": client_ip},
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not admin.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is disabled")
    token = create_admin_access_token(admin["aid"], admin["email"], admin.get("role", "support"))
    logger.info("Admin logged in: %s", admin["email"])
    return AdminTokenResponse(access_token=token, admin=admin_doc_to_out(admin))


@api_router.get("/admin/auth/me", response_model=AdminOut)
async def admin_me(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    return admin_doc_to_out(auth.admin)


@api_router.get("/admin/rpc-usage")
async def admin_rpc_usage(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    hours: int = Query(2, ge=1, le=3),
):
    """In-process QuickNode RPC / WS counters for the current UTC hour (no extra RPC calls)."""
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "view_settings")
    from services.rpc_usage import get_usage_snapshot

    return get_usage_snapshot(hours=hours)


@api_router.get("/admin/platform-controls")
async def admin_get_platform_controls(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "view_settings")
    controls = await get_platform_controls()
    return controls


@api_router.patch("/admin/platform-controls")
async def admin_patch_platform_controls(
    body: PlatformControlsPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    updates = body.model_dump(exclude_none=True)
    note = updates.pop("note", None)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    current = await get_platform_controls()
    merged = dict(current)
    merged.update(updates)
    wd_min = _control_float(merged, "withdraw_min_usdt", 0.0)
    wd_max = _control_float(merged, "withdraw_max_usdt", 0.0)
    wd_day = _control_float(merged, "withdraw_daily_limit_usdt", 0.0)
    if wd_max > 0 and wd_min > wd_max:
        raise HTTPException(status_code=400, detail="withdraw_min_usdt must be <= withdraw_max_usdt")
    if wd_day > 0 and wd_max > 0 and wd_day < wd_max:
        raise HTTPException(status_code=400, detail="withdraw_daily_limit_usdt must be >= withdraw_max_usdt")
    # Phase 2 coherence: auto-approve threshold must fit inside the hard max.
    wd_auto = _control_float(merged, "withdrawal_auto_approve_limit_usdt", 0.0)
    if wd_auto > 0 and wd_max > 0 and wd_auto > wd_max:
        raise HTTPException(
            status_code=400,
            detail="withdrawal_auto_approve_limit_usdt must be <= withdraw_max_usdt",
        )
    if updates.get("two_factor_required_for_withdrawal") and not merged.get("two_factor_enabled"):
        raise HTTPException(
            status_code=400,
            detail="two_factor_enabled must be on before requiring 2FA for withdrawals",
        )
    if "sms_dev_otp_code" in updates:
        code = str(updates.get("sms_dev_otp_code") or "").strip()
        if code and not (len(code) == 6 and code.isdigit()):
            raise HTTPException(status_code=400, detail="sms_dev_otp_code must be exactly 6 digits")
    if updates.get("sms_dev_otp_enabled") is True:
        code = sms_otp_service.normalize_dev_otp_code(merged.get("sms_dev_otp_code"))
        updates["sms_dev_otp_code"] = code
        merged["sms_dev_otp_code"] = code
    # Phase 5 — sanitise per-asset confirmation overrides. Accept only the
    # assets we can actually credit, coerce keys to upper-case, and drop
    # anything non-integer / negative.
    if "deposit_min_confirmations_by_asset" in updates:
        raw = updates.get("deposit_min_confirmations_by_asset") or {}
        clean: Dict[str, int] = {}
        for k, v in raw.items():
            key = (str(k) or "").strip().upper()
            if key not in DEPOSIT_CONFIRMATION_DEFAULTS:
                continue  # silently ignore unsupported assets
            try:
                iv = int(v)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=400,
                    detail=f"deposit_min_confirmations_by_asset[{key}] must be an integer",
                )
            if iv < 0 or iv > 100:
                raise HTTPException(
                    status_code=400,
                    detail=f"deposit_min_confirmations_by_asset[{key}] must be in 0..100",
                )
            clean[key] = iv
        updates["deposit_min_confirmations_by_asset"] = clean
    # Withdrawal IBO gas fees — sanitize per-chain map from admin Fees / Settings.
    if "withdraw_gas_fee_ibo_by_chain" in updates:
        raw = updates.get("withdraw_gas_fee_ibo_by_chain") or {}
        if not isinstance(raw, dict):
            raise HTTPException(
                status_code=400,
                detail="withdraw_gas_fee_ibo_by_chain must be an object of chain_id → IBO amount",
            )
        allowed = {"bsc", "eth", "tron", "btc", "solana"}
        clean_gas: Dict[str, float] = {}
        for k, v in raw.items():
            key = (str(k) or "").strip().lower()
            if key not in allowed:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=400,
                    detail=f"withdraw_gas_fee_ibo_by_chain[{key}] must be a number",
                )
            if fv < 0 or fv > 1_000_000:
                raise HTTPException(
                    status_code=400,
                    detail=f"withdraw_gas_fee_ibo_by_chain[{key}] must be in 0..1000000",
                )
            clean_gas[key] = round(fv, 8)
        updates["withdraw_gas_fee_ibo_by_chain"] = clean_gas
    # Phase 5 — sanitize symbol->USDT cap maps.
    for k in ("risk_max_order_notional_usdt_by_symbol", "risk_max_open_notional_usdt_by_symbol"):
        if k in updates:
            raw = updates.get(k) or {}
            clean_f: Dict[str, float] = {}
            for sk, sv in raw.items():
                sym = (str(sk) or "").strip().upper()
                if sym not in SYMBOL_BASE_MAP:
                    continue
                try:
                    fv = float(sv)
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"{k}[{sym}] must be a number")
                if fv < 0:
                    raise HTTPException(status_code=400, detail=f"{k}[{sym}] must be >= 0")
                clean_f[sym] = fv
            updates[k] = clean_f
    if "blockchain_chain_settings" in updates:
        from services.blockchain_chain_controls import merge_blockchain_chain_settings_patch

        updates["blockchain_chain_settings"] = merge_blockchain_chain_settings_patch(
            current.get("blockchain_chain_settings"),
            updates.get("blockchain_chain_settings"),
        )
    # Refer & Earn — sanitize level rows: positive int level, non-negative
    # IBO amount, de-duplicated by level (last one wins), sorted ascending.
    referral_fields_touched = {
        k for k in (
            "referral_levels",
            "referral_flat_from_level",
            "referral_flat_amount_ibo",
        )
        if k in updates
    }
    if referral_fields_touched:
        from services.referral_service import validate_referral_settings

        raw_levels = updates.get("referral_levels")
        if raw_levels is None:
            raw_levels = current.get("referral_levels") or []
        if not isinstance(raw_levels, list):
            raise HTTPException(status_code=400, detail="referral_levels must be a list")
        clean_levels: Dict[int, float] = {}
        for row in raw_levels:
            if not isinstance(row, dict):
                continue
            try:
                lvl = int(row.get("level"))
                amt = float(row.get("amount_ibo") or 0)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="referral_levels rows need integer level + numeric amount_ibo")
            if lvl < 1 or lvl > 20:
                raise HTTPException(status_code=400, detail="referral_levels level must be between 1 and 20")
            if amt < 0 or amt > 1_000_000:
                raise HTTPException(status_code=400, detail="referral_levels amount_ibo must be in 0..1000000")
            clean_levels[lvl] = round(amt, 8)
        normalized_levels = [
            {"level": lvl, "amount_ibo": clean_levels[lvl]} for lvl in sorted(clean_levels)
        ]

        flat_from = updates.get("referral_flat_from_level")
        if flat_from is None:
            flat_from = current.get("referral_flat_from_level") or 0
        try:
            flat_from = int(flat_from or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="referral_flat_from_level must be an integer 0..20")

        flat_amt = updates.get("referral_flat_amount_ibo")
        if flat_amt is None:
            flat_amt = current.get("referral_flat_amount_ibo") or 0.0
        try:
            flat_amt = float(flat_amt or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="referral_flat_amount_ibo must be numeric")

        err = validate_referral_settings(
            normalized_levels,
            flat_from_level=flat_from,
            flat_amount_ibo=flat_amt,
        )
        if err:
            raise HTTPException(status_code=400, detail=err)

        if "referral_levels" in updates:
            updates["referral_levels"] = normalized_levels
        if "referral_flat_from_level" in updates:
            updates["referral_flat_from_level"] = flat_from
        if "referral_flat_amount_ibo" in updates:
            updates["referral_flat_amount_ibo"] = round(flat_amt, 8)
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.platform_controls.update_one(
        {"id": "global"},
        {"$set": updates, "$setOnInsert": {"id": "global"}},
        upsert=True,
    )
    if "blockchain_chain_settings" in updates:
        blockchain_service.reset_provider_for_tests()
        await sync_blockchain_chain_admin()
    await log_admin_audit(
        auth,
        "platform_controls_patch",
        "platform_controls",
        "global",
        {"updates": updates, "note": note},
    )
    return await get_platform_controls()


# ── Mobile app (APK) releases ─────────────────────────────────────────────────

@api_router.get("/mobile-app/release")
async def public_mobile_app_release():
    """Mobile app CTA for the exchange — Google Play or direct APK (no auth)."""
    if db is None:
        return {"available": False}
    return await mobile_app_svc.get_public_release_info(db)


@api_router.get("/mobile-app/download")
async def public_mobile_app_download():
    """Stream the published APK with a proper attachment filename."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    path, doc = await mobile_app_svc.get_release_file_path(db, MOBILE_APK_DIR)
    fname = doc.get("file_name") or path.name
    return FileResponse(
        path,
        media_type="application/vnd.android.package-archive",
        filename=fname,
        headers={"Cache-Control": "public, max-age=300"},
    )


@api_router.get("/admin/mobile-app/releases")
async def admin_list_mobile_releases(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    limit: int = Query(50, ge=1, le=200),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "view_settings")
    items = await mobile_app_svc.list_releases(db, limit=limit)
    published = await mobile_app_svc.get_published_release(db)
    distribution = await mobile_app_svc.get_distribution_config(db)
    return {
        "items": items,
        "count": len(items),
        "published": published,
        "distribution": distribution,
    }


@api_router.get("/admin/mobile-app/distribution")
async def admin_get_mobile_app_distribution(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "view_settings")
    return await mobile_app_svc.get_distribution_config(db)


@api_router.patch("/admin/mobile-app/distribution")
async def admin_patch_mobile_app_distribution(
    body: MobileAppDistributionPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    current = await mobile_app_svc.get_distribution_config(db)
    dist = body.distribution if body.distribution is not None else current["distribution"]
    play_url = (
        body.google_play_url
        if body.google_play_url is not None
        else current["google_play_url"]
    )
    out = await mobile_app_svc.save_distribution_config(
        db,
        distribution=dist,
        google_play_url=play_url,
    )
    await log_admin_audit(
        auth,
        "mobile_app_distribution_patch",
        "platform_controls",
        "global",
        out,
    )
    return out


@api_router.post("/admin/mobile-app/releases")
async def admin_upload_mobile_release(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    file: UploadFile = File(...),
    version: str = Form(...),
    version_code: int = Form(...),
    release_notes: str = Form(""),
    publish: str = Form("true"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    publish_bool = str(publish).strip().lower() in ("1", "true", "yes", "on")
    doc = await mobile_app_svc.upload_release(
        db,
        upload=file,
        version=version,
        version_code=int(version_code),
        release_notes=release_notes,
        publish=publish_bool,
        uploaded_by=str(auth.admin.get("aid") or auth.admin.get("email") or "admin"),
        mobile_dir=MOBILE_APK_DIR,
        max_bytes=MAX_MOBILE_APK_BYTES,
    )
    await log_admin_audit(
        auth, "mobile_apk_upload", "mobile_app_release", doc["id"],
        {"version": doc["version"], "version_code": doc["version_code"], "publish": doc["published"]},
    )
    return doc


@api_router.patch("/admin/mobile-app/releases/{release_id}")
async def admin_patch_mobile_release(
    release_id: str,
    body: MobileReleasePublishPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    updated = await mobile_app_svc.set_published(db, release_id, publish=body.published)
    await log_admin_audit(
        auth, "mobile_apk_publish" if body.published else "mobile_apk_unpublish",
        "mobile_app_release", release_id,
        {"version": updated.get("version"), "published": updated.get("published")},
    )
    return updated


@api_router.delete("/admin/mobile-app/releases/{release_id}")
async def admin_delete_mobile_release(
    release_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    doc = await db.mobile_app_releases.find_one({"id": release_id}, {"_id": 0, "version": 1})
    await mobile_app_svc.delete_release(db, release_id, MOBILE_APK_DIR)
    await log_admin_audit(
        auth, "mobile_apk_delete", "mobile_app_release", release_id,
        {"version": (doc or {}).get("version")},
    )
    return {"ok": True}


# ── Landing promo popup (coin + app carousel) ─────────────────────────────────

@api_router.get("/landing-promo")
async def public_landing_promo():
    """Public config for the landing-page promo modal + APK slide."""
    if db is None:
        return {"enabled": False}
    app_info = await mobile_app_svc.get_public_release_info(db)
    return await landing_promo_svc.public_payload(db, app_info)


@api_router.get("/admin/landing-promo")
async def admin_get_landing_promo(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "view_settings")
    app_info = await mobile_app_svc.get_public_release_info(db)
    cfg = await landing_promo_svc.get_config(db)
    distribution = await mobile_app_svc.get_distribution_config(db)
    return {"config": cfg, "apk": app_info, "distribution": distribution}


@api_router.patch("/admin/landing-promo")
async def admin_patch_landing_promo(
    body: LandingPromoPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    patch = body.model_dump(exclude_none=True)
    if body.coin is not None:
        patch["coin"] = body.coin.model_dump(exclude_none=True)
    if body.app is not None:
        patch["app"] = body.app.model_dump(exclude_none=True)
    out = await landing_promo_svc.save_config(db, patch)
    await log_admin_audit(auth, "landing_promo_patch", "landing_promo", "global", {"keys": list(patch.keys())})
    return out


@api_router.post("/admin/landing-promo/image")
async def admin_upload_landing_promo_image(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    slot: str = Form(...),
    file: UploadFile = File(...),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    out = await landing_promo_svc.upload_image(
        db, slot=slot, upload=file, promo_dir=PROMO_DIR,
    )
    await log_admin_audit(auth, "landing_promo_image", "landing_promo", slot, {"image_url": out.get("coin", {}).get("image_url") or out.get("app", {}).get("image_url")})
    return out


# ── Mobile app home banners (dashboard carousel) ─────────────────────────────

@api_router.get("/app/home-banners")
async def public_app_home_banners():
    """Public carousel slides for the mobile app home screen."""
    if db is None:
        return {"enabled": False, "auto_scroll_seconds": 5, "banners": []}
    return await app_home_banners_svc.public_payload(db)


@api_router.get("/admin/app-home-banners")
async def admin_list_app_home_banners(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "view_settings")
    settings = await app_home_banners_svc.get_settings(db)
    banners = await app_home_banners_svc.list_all_banners(db)
    return {"settings": settings, "banners": banners, "image_spec": {"width": 1200, "height": 490, "aspect": "2.45:1"}}


@api_router.patch("/admin/app-home-banners/settings")
async def admin_patch_app_home_banner_settings(
    body: AppHomeBannerSettingsPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    out = await app_home_banners_svc.save_settings(db, body.model_dump(exclude_none=True))
    await log_admin_audit(auth, "app_home_banners_settings", "app_home_banners", "global", body.model_dump(exclude_none=True))
    return out


@api_router.post("/admin/app-home-banners")
async def admin_create_app_home_banner(
    body: AppHomeBannerCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    out = await app_home_banners_svc.create_banner(db, body.model_dump(exclude_none=True))
    await log_admin_audit(auth, "app_home_banner_create", "app_home_banners", out["id"], {"title": out.get("title")})
    return out


@api_router.patch("/admin/app-home-banners/{banner_id}")
async def admin_patch_app_home_banner(
    banner_id: str,
    body: AppHomeBannerPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    out = await app_home_banners_svc.update_banner(db, banner_id, body.model_dump(exclude_none=True))
    await log_admin_audit(auth, "app_home_banner_patch", "app_home_banners", banner_id, body.model_dump(exclude_none=True))
    return out


@api_router.delete("/admin/app-home-banners/{banner_id}")
async def admin_delete_app_home_banner(
    banner_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    await app_home_banners_svc.delete_banner(db, banner_id, banners_dir=HOME_BANNERS_DIR)
    await log_admin_audit(auth, "app_home_banner_delete", "app_home_banners", banner_id, {})
    return {"ok": True}


@api_router.post("/admin/app-home-banners/{banner_id}/image")
async def admin_upload_app_home_banner_image(
    banner_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    file: UploadFile = File(...),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    out = await app_home_banners_svc.upload_banner_image(
        db, banner_id=banner_id, upload=file, banners_dir=HOME_BANNERS_DIR,
    )
    await log_admin_audit(auth, "app_home_banner_image", "app_home_banners", banner_id, {"image_url": out.get("image_url")})
    return out


@api_router.get("/admin/admin-users")
async def admin_list_admin_users(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    q: str = "",
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_admins")
    filt: Dict[str, Any] = {}
    clauses: List[Dict[str, Any]] = []
    if q.strip():
        rx = {"$regex": q.strip(), "$options": "i"}
        clauses.append({"$or": [{"email": rx}, {"name": rx}, {"aid": rx}]})
    if role:
        role_l = role.strip().lower()
        if role_l not in ("superadmin", "support", "finance", "operations", "compliance", "viewer"):
            raise HTTPException(status_code=400, detail="Invalid role filter")
        clauses.append({"role": role_l})
    if is_active is True:
        clauses.append({"$or": [{"is_active": True}, {"is_active": {"$exists": False}}]})
    elif is_active is False:
        clauses.append({"is_active": False})
    if created_from:
        clauses.append({"created_at": {"$gte": created_from}})
    if created_to:
        clauses.append({"created_at": {"$lte": created_to}})
    if clauses:
        filt["$and"] = clauses
    sf = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "email": "email",
        "name": "name",
        "role": "role",
        "aid": "aid",
        "is_active": "is_active",
    }, "created_at")
    cur = db.admin_users.find(filt, {"_id": 0, "password_hash": 0}).sort(sf, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    rows = await cur.to_list(limit)
    total = await db.admin_users.count_documents(filt)
    active_filter = dict(filt)
    active_filter["$and"] = list(active_filter.get("$and", [])) + [
        {"$or": [{"is_active": True}, {"is_active": {"$exists": False}}]}
    ]
    disabled_filter = dict(filt)
    disabled_filter["$and"] = list(disabled_filter.get("$and", [])) + [{"is_active": False}]
    active_count = await db.admin_users.count_documents(active_filter)
    disabled_count = await db.admin_users.count_documents(disabled_filter)
    return {
        "items": [admin_doc_to_out(r).model_dump() for r in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
        "stats": {
            "active": active_count,
            "disabled": disabled_count,
        },
    }


@api_router.post("/admin/admin-users", response_model=AdminOut, status_code=201)
async def admin_create_admin_user(body: AdminCreate, auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_admins")
    email = body.email.lower()
    existing = await db.admin_users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Admin email already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "aid": f"adm_{uuid.uuid4().hex[:12]}",
        "email": email,
        "name": body.name.strip() or email.split("@")[0],
        "role": body.role,
        "permissions": [str(p).strip() for p in (body.permissions or []) if str(p).strip()],
        "is_active": True,
        "password_hash": hash_password(body.password),
        "created_at": now,
        "last_login": None,
    }
    await db.admin_users.insert_one(doc)
    await log_admin_audit(auth, "admin_user_create", "admin_user", doc["aid"], {"email": email, "role": body.role})
    return admin_doc_to_out(doc)


@api_router.patch("/admin/admin-users/{aid}", response_model=AdminOut)
async def admin_patch_admin_user(aid: str, body: AdminPatch, auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_admins")
    target = await db.admin_users.find_one({"aid": aid})
    if not target:
        raise HTTPException(status_code=404, detail="Admin user not found")
    updates: Dict[str, Any] = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.role is not None:
        updates["role"] = body.role
    if body.permissions is not None:
        updates["permissions"] = [str(p).strip() for p in (body.permissions or []) if str(p).strip()]
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.password is not None:
        updates["password_hash"] = hash_password(body.password)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    if aid == auth.admin.get("aid") and updates.get("is_active") is False:
        raise HTTPException(status_code=400, detail="You cannot disable your own admin account")
    await db.admin_users.update_one({"aid": aid}, {"$set": updates})
    updated = await db.admin_users.find_one({"aid": aid}, {"_id": 0, "password_hash": 0})
    await log_admin_audit(auth, "admin_user_patch", "admin_user", aid, {"updates": list(updates.keys())})
    return admin_doc_to_out(updated)


async def _admin_fee_totals_since(since_iso: str) -> List[Dict[str, Any]]:
    """Aggregate taker+maker fees by asset since `since_iso` (ISO string compare on created_at)."""
    if db is None:
        return []
    pipe = [
        {"$match": {"created_at": {"$gte": since_iso}}},
        {"$project": {
            "pairs": [
                {"a": "$taker_fee_asset", "v": {"$ifNull": ["$taker_fee", 0]}},
                {"a": "$maker_fee_asset", "v": {"$ifNull": ["$maker_fee", 0]}},
            ],
        }},
        {"$unwind": "$pairs"},
        {"$match": {"pairs.a": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$pairs.a", "total": {"$sum": "$pairs.v"}}},
        {"$sort": {"total": -1}},
    ]
    cur = db.trades.aggregate(pipe)
    rows = await cur.to_list(50)
    return [{"asset": r["_id"], "total": round(float(r["total"]), 8)} for r in rows]


async def _admin_volume_trades_since(since_iso: str) -> Dict[str, Any]:
    """Sum notional (price * amount) and trade count since `since_iso`."""
    if db is None:
        return {"volume_usdt": 0.0, "trades": 0}
    pipe = [
        {"$match": {"created_at": {"$gte": since_iso}}},
        {"$group": {
            "_id": None,
            "volume_usdt": {"$sum": {"$multiply": ["$price", "$amount"]}},
            "trades":      {"$sum": 1},
        }},
    ]
    cur = db.trades.aggregate(pipe)
    rows = await cur.to_list(1)
    if not rows:
        return {"volume_usdt": 0.0, "trades": 0}
    return {
        "volume_usdt": round(float(rows[0].get("volume_usdt") or 0), 4),
        "trades":      int(rows[0].get("trades") or 0),
    }


def _usdt_fee_total(fee_rows: List[Dict[str, Any]]) -> float:
    for r in fee_rows:
        if r.get("asset") == "USDT":
            return float(r.get("total", 0))
    return 0.0


async def _compute_admin_stats_overview() -> Dict[str, Any]:
    if db is None:
        raise RuntimeError("database unavailable")
    since_7d = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    users_new_7d = await db.users.count_documents({"created_at": {"$gte": since_7d}})
    trades_total = await db.trades.count_documents({})
    since_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    trades_24h = await db.trades.count_documents({"created_at": {"$gte": since_24h}})
    fees_24h = await _admin_fee_totals_since(since_24h)
    fees_7d = await _admin_fee_totals_since(since_7d)
    vol24 = await _admin_volume_trades_since(since_24h)
    vol7 = await _admin_volume_trades_since(since_7d)
    audit_7d = await db.admin_audit_logs.count_documents({"created_at": {"$gte": since_7d}})
    return {
        "users_total":           await db.users.count_documents({}),
        "users_new_7d":          users_new_7d,
        "kyc_pending":           await db.kyc.count_documents({"status": "pending"}),
        "deposits_pending":      await db.deposit_requests.count_documents({"status": "pending"}),
        "withdrawals_pending":   await db.withdrawal_requests.count_documents({"status": "pending"}),
        "withdrawals_awaiting_treasury": await db.withdrawal_requests.count_documents(
            {"status": "awaiting_treasury"},
        ),
        # Phase 4 — on-chain pipeline: poller writes deposit_events; crediter
        # promotes to wallet balances when confirmations + controls allow.
        "deposit_events_chain_inflight": await db.deposit_events.count_documents(
            {"status": {"$in": ["pending", "confirming"]}},
        ),
        "deposit_events_operator_attention": await db.deposit_events.count_documents(
            {"status": {"$in": ["pending_kyc", "below_min", "reorg_review"]}},
        ),
        "trades_total":          trades_total,
        "trades_24h":            trades_24h,
        "trades_7d":             vol7["trades"],
        "platform_volume_24h":   vol24["volume_usdt"],
        "platform_volume_7d":    vol7["volume_usdt"],
        "fees_by_asset_24h":     fees_24h,
        "fees_by_asset_7d":      fees_7d,
        "fee_revenue_usdt_24h":  round(_usdt_fee_total(fees_24h), 8),
        "fee_revenue_usdt_7d":   round(_usdt_fee_total(fees_7d), 8),
        "audit_events_7d":       audit_7d,
    }


@api_router.get("/admin/stats/overview")
async def admin_stats_overview(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_dashboard")
    return await _compute_admin_stats_overview()


@api_router.get("/admin/stats/flows")
async def admin_stats_flows(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    days: int = Query(14, ge=1, le=90),
):
    """Approved deposits / withdrawals bucketed by calendar day (reviewed_at or created_at)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_dashboard")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    day_dep: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    day_wd: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))

    deps = await db.deposit_requests.find({"status": "approved"}, {"_id": 0}).to_list(8000)
    for d in deps:
        ts = d.get("reviewed_at") or d.get("created_at") or ""
        if not ts or ts < cutoff:
            continue
        day = ts[:10]
        day_dep[day][d.get("asset", "?")] += float(d.get("amount", 0))

    wds = await db.withdrawal_requests.find({"status": "approved"}, {"_id": 0}).to_list(8000)
    for w in wds:
        ts = w.get("reviewed_at") or w.get("created_at") or ""
        if not ts or ts < cutoff:
            continue
        day = ts[:10]
        day_wd[day][w.get("asset", "?")] += float(w.get("amount", 0))

    all_days = sorted(set(day_dep.keys()) | set(day_wd.keys()), reverse=True)
    days_out = []
    for day in all_days:
        days_out.append({
            "date":         day,
            "deposits":     {k: round(v, 8) for k, v in day_dep[day].items()},
            "withdrawals":  {k: round(v, 8) for k, v in day_wd[day].items()},
        })
    return {"days": days_out, "window_days": days}


@api_router.get("/admin/stats/fees")
async def admin_stats_fees(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    """Sum trading fees from `trades` by fee asset (taker + maker)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_dashboard")
    pipe = [
        {"$project": {
            "pairs": [
                {"a": "$taker_fee_asset", "v": {"$ifNull": ["$taker_fee", 0]}},
                {"a": "$maker_fee_asset", "v": {"$ifNull": ["$maker_fee", 0]}},
            ],
        }},
        {"$unwind": "$pairs"},
        {"$match": {"pairs.a": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$pairs.a", "total": {"$sum": "$pairs.v"}}},
        {"$sort": {"total": -1}},
    ]
    cur = db.trades.aggregate(pipe)
    rows = await cur.to_list(50)
    return {
        "by_asset": [{"asset": r["_id"], "total": round(float(r["total"]), 8)} for r in rows],
    }


@api_router.get("/admin/stats/analytics")
async def admin_stats_analytics(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    days: int = Query(30, ge=1, le=120),
    symbol: Optional[str] = None,
):
    """
    Daily trade count + notional volume (price * amount) and period fee totals.
    Optional `symbol` filters to one pair (e.g. BTCUSDT).
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_analytics")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    match: Dict[str, Any] = {"created_at": {"$gte": cutoff}}
    if symbol:
        match["symbol"] = symbol.strip().upper()
    pipe_daily = [
        {"$match": match},
        {"$project": {
            "day": {"$substr": ["$created_at", 0, 10]},
            "vol": {"$multiply": ["$price", "$amount"]},
        }},
        {"$group": {
            "_id": "$day",
            "trades":      {"$sum": 1},
            "volume_usdt": {"$sum": "$vol"},
        }},
        {"$sort": {"_id": 1}},
    ]
    cur_d = db.trades.aggregate(pipe_daily)
    raw_d = await cur_d.to_list(400)
    daily = [
        {
            "date":         r["_id"],
            "trades":       r["trades"],
            "volume_usdt":  round(float(r["volume_usdt"]), 4),
        }
        for r in raw_d
    ]
    pipe_fees = [
        {"$match": match},
        {"$project": {
            "pairs": [
                {"a": "$taker_fee_asset", "v": {"$ifNull": ["$taker_fee", 0]}},
                {"a": "$maker_fee_asset", "v": {"$ifNull": ["$maker_fee", 0]}},
            ],
        }},
        {"$unwind": "$pairs"},
        {"$match": {"pairs.a": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$pairs.a", "total": {"$sum": "$pairs.v"}}},
        {"$sort": {"total": -1}},
    ]
    cur_f = db.trades.aggregate(pipe_fees)
    raw_f = await cur_f.to_list(50)
    fees_period = [{"asset": r["_id"], "total": round(float(r["total"]), 8)} for r in raw_f]
    return {
        "window_days": days,
        "symbol":      symbol,
        "daily":       daily,
        "fees_period": fees_period,
    }


def _as_float(v: Any) -> float:
    try:
        return float(v or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _asset_mark_usdt(asset: str) -> float:
    ast = str(asset or "").upper()
    if ast == "USDT":
        return 1.0
    return float(_cached_price_usdt(ast))


async def _finance_liabilities_vs_reserves_rows() -> Dict[str, Any]:
    """Compute user liabilities vs treasury reserves snapshot by asset."""
    if db is None:
        return {"rows": [], "totals": {}}

    # Liabilities: all user wallets except internal treasury pseudo-user.
    liab_pipe = [
        {"$match": {"uid": {"$ne": treasury_service.TREASURY_UID}}},
        {"$project": {"asset": 1, "bal": {"$add": [{"$ifNull": ["$available", 0]}, {"$ifNull": ["$locked", 0]}]}}},
        {"$group": {"_id": "$asset", "total": {"$sum": "$bal"}}},
    ]
    liab_raw = await db.wallets.aggregate(liab_pipe).to_list(500)
    liabilities_by_asset: Dict[str, float] = {
        str(r.get("_id") or "").upper(): _as_float(r.get("total")) for r in liab_raw if r.get("_id")
    }

    treasury_wallets = await treasury_service.list_wallets()
    reserves_by_asset: Dict[str, float] = {}
    for w in treasury_wallets:
        ast = str(w.get("asset") or "").upper()
        if not ast:
            continue
        reserves_by_asset[ast] = _as_float(w.get("available")) + _as_float(w.get("locked"))

    assets = sorted({*liabilities_by_asset.keys(), *reserves_by_asset.keys()})
    rows: List[Dict[str, Any]] = []
    liab_usdt_total = 0.0
    reserve_usdt_total = 0.0
    for ast in assets:
        liability_qty = _as_float(liabilities_by_asset.get(ast))
        reserve_qty = _as_float(reserves_by_asset.get(ast))
        gap_qty = reserve_qty - liability_qty
        mark = _asset_mark_usdt(ast)
        liability_usdt = liability_qty * mark
        reserve_usdt = reserve_qty * mark
        gap_usdt = reserve_usdt - liability_usdt
        coverage_pct = None
        if abs(liability_qty) > 1e-12:
            coverage_pct = round((reserve_qty / liability_qty) * 100.0, 4)
        rows.append({
            "asset": ast,
            "mark_usdt": round(mark, 8),
            "liability_qty": round(liability_qty, 8),
            "reserve_qty": round(reserve_qty, 8),
            "gap_qty": round(gap_qty, 8),
            "liability_usdt": round(liability_usdt, 4),
            "reserve_usdt": round(reserve_usdt, 4),
            "gap_usdt": round(gap_usdt, 4),
            "coverage_pct": coverage_pct,
        })
        liab_usdt_total += liability_usdt
        reserve_usdt_total += reserve_usdt

    totals = {
        "liabilities_usdt": round(liab_usdt_total, 4),
        "reserves_usdt": round(reserve_usdt_total, 4),
        "gap_usdt": round(reserve_usdt_total - liab_usdt_total, 4),
        "coverage_pct": round((reserve_usdt_total / liab_usdt_total) * 100.0, 4) if liab_usdt_total > 1e-12 else None,
    }
    return {"rows": rows, "totals": totals}


@api_router.get("/admin/finance/overview")
async def admin_finance_overview(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    days: int = Query(30, ge=1, le=365),
    symbol: Optional[str] = None,
):
    """Phase 4 — finance summary: fees/volume + liabilities vs reserves."""
    _require_admin_permission(auth, "view_finance")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    sym = (symbol or "").strip().upper() or None
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    match: Dict[str, Any] = {"created_at": {"$gte": cutoff}}
    if sym:
        match["symbol"] = sym

    # Volume/trade count in selected window.
    summary_pipe = [
        {"$match": match},
        {"$project": {"notional": {"$multiply": ["$price", "$amount"]}}},
        {"$group": {"_id": None, "trades": {"$sum": 1}, "volume_usdt": {"$sum": "$notional"}}},
    ]
    summary_raw = await db.trades.aggregate(summary_pipe).to_list(1)
    period = summary_raw[0] if summary_raw else {}

    # Fees in native assets + estimated USDT notional.
    fees_pipe = [
        {"$match": match},
        {"$project": {
            "pairs": [
                {"a": "$taker_fee_asset", "v": {"$ifNull": ["$taker_fee", 0]}},
                {"a": "$maker_fee_asset", "v": {"$ifNull": ["$maker_fee", 0]}},
            ],
        }},
        {"$unwind": "$pairs"},
        {"$match": {"pairs.a": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$pairs.a", "total": {"$sum": "$pairs.v"}}},
        {"$sort": {"total": -1}},
    ]
    fees_raw = await db.trades.aggregate(fees_pipe).to_list(100)
    fees_by_asset: List[Dict[str, Any]] = []
    fees_usdt_est = 0.0
    for r in fees_raw:
        ast = str(r.get("_id") or "").upper()
        amt = _as_float(r.get("total"))
        mark = _asset_mark_usdt(ast)
        usdt = amt * mark
        fees_usdt_est += usdt
        fees_by_asset.append({
            "asset": ast,
            "amount": round(amt, 8),
            "mark_usdt": round(mark, 8),
            "usdt_estimate": round(usdt, 4),
        })

    lvr = await _finance_liabilities_vs_reserves_rows()
    return {
        "window_days": days,
        "symbol": sym,
        "period": {
            "trades": int(period.get("trades") or 0),
            "volume_usdt": round(_as_float(period.get("volume_usdt")), 4),
            "fees_usdt_estimate": round(fees_usdt_est, 4),
            "fees_by_asset": fees_by_asset,
        },
        "liabilities_vs_reserves": lvr,
    }


def _build_finance_overview_csv(payload: Dict[str, Any]) -> str:
    lvr = payload.get("liabilities_vs_reserves") or {}
    rows = list(lvr.get("rows") or [])
    totals = lvr.get("totals") or {}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "asset", "mark_usdt", "liability_qty", "reserve_qty", "gap_qty",
        "liability_usdt", "reserve_usdt", "gap_usdt", "coverage_pct",
    ])
    for r in rows:
        w.writerow([
            r.get("asset"), r.get("mark_usdt"), r.get("liability_qty"), r.get("reserve_qty"),
            r.get("gap_qty"), r.get("liability_usdt"), r.get("reserve_usdt"),
            r.get("gap_usdt"), r.get("coverage_pct"),
        ])
    w.writerow([])
    w.writerow([
        "totals", "", "", "", "",
        totals.get("liabilities_usdt"), totals.get("reserves_usdt"),
        totals.get("gap_usdt"), totals.get("coverage_pct"),
    ])
    return buf.getvalue()


def _build_finance_overview_xlsx_bytes(payload: Dict[str, Any]) -> bytes:
    lvr = payload.get("liabilities_vs_reserves") or {}
    rows = list(lvr.get("rows") or [])
    totals = lvr.get("totals") or {}
    period = payload.get("period") or {}
    window_days = payload.get("window_days")
    symbol = payload.get("symbol")

    df_rows = pd.DataFrame(rows or [])
    df_totals = pd.DataFrame([totals or {}])
    df_period = pd.DataFrame([{
        "window_days": window_days,
        "symbol": symbol or "",
        "trades": period.get("trades"),
        "volume_usdt": period.get("volume_usdt"),
        "fees_usdt_estimate": period.get("fees_usdt_estimate"),
    }])

    out = io.BytesIO()
    with pd.ExcelWriter(out, engine="openpyxl") as writer:
        df_rows.to_excel(writer, index=False, sheet_name="liabilities_vs_reserves")
        df_totals.to_excel(writer, index=False, sheet_name="totals")
        df_period.to_excel(writer, index=False, sheet_name="period")
    return out.getvalue()


def _build_finance_overview_file(
    payload: Dict[str, Any],
    fmt: str = "csv",
) -> Tuple[bytes, str, str]:
    f = str(fmt or "csv").strip().lower()
    if f == "xlsx":
        return (
            _build_finance_overview_xlsx_bytes(payload),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xlsx",
        )
    csv_text = _build_finance_overview_csv(payload)
    return (csv_text.encode("utf-8"), "text/csv; charset=utf-8", "csv")


@api_router.get("/admin/finance/overview/export")
async def admin_finance_overview_export_csv(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    days: int = Query(30, ge=1, le=365),
    symbol: Optional[str] = None,
    format: str = Query("csv"),
):
    """CSV export for Phase 4 finance overview (asset liability/reserve rows)."""
    _require_admin_permission(auth, "export_finance")
    payload = await admin_finance_overview(auth=auth, days=days, symbol=symbol)
    file_bytes, mime_type, ext = _build_finance_overview_file(payload, fmt=format)
    filename = f"finance_overview_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.{ext}"
    return StreamingResponse(
        iter([file_bytes]),
        media_type=mime_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class FinanceExportJobCreate(BaseModel):
    days: int = Field(30, ge=1, le=365)
    symbol: Optional[str] = None
    format: Literal["csv", "xlsx"] = "csv"


async def _run_finance_export_job(
    job_id: str,
    days: int,
    symbol: Optional[str],
    requested_by: str,
    file_format: str = "csv",
) -> None:
    if db is None:
        return
    try:
        await db.finance_export_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "running", "started_at": datetime.now(timezone.utc).isoformat()}},
        )
        # Internal context object so we can reuse existing compute function.
        pseudo_auth = AdminAuthContext(admin={"aid": requested_by, "role": "superadmin"}, via_api_key=False)
        payload = await admin_finance_overview(auth=pseudo_auth, days=days, symbol=symbol)
        file_bytes, mime_type, ext = _build_finance_overview_file(payload, fmt=file_format)
        filename = f"finance_overview_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.{ext}"
        file_data_b64 = base64.b64encode(file_bytes).decode("ascii")
        await db.finance_export_jobs.update_one(
            {"id": job_id},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "filename": filename,
                    "file_format": ext,
                    "mime_type": mime_type,
                    "file_data_b64": file_data_b64,
                    "rows": len((payload.get("liabilities_vs_reserves") or {}).get("rows") or []),
                },
                "$unset": {"error": ""},
            },
        )
    except Exception as e:
        logger.exception("finance export job failed id=%s", job_id)
        await db.finance_export_jobs.update_one(
            {"id": job_id},
            {
                "$set": {
                    "status": "failed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "error": str(e)[:400],
                },
            },
        )


@api_router.post("/admin/finance/overview/export-jobs")
async def admin_create_finance_export_job(
    body: FinanceExportJobCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    _require_admin_permission(auth, "export_finance")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    admin_row = auth.admin or {}
    requester = str(admin_row.get("aid") or admin_row.get("email") or "admin")
    job_id = f"finexp_{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": job_id,
        "status": "pending",
        "days": int(body.days),
        "symbol": (body.symbol or "").strip().upper() or None,
        "file_format": str(body.format or "csv").strip().lower(),
        "requested_by": requester,
        "created_at": now,
        "started_at": None,
        "completed_at": None,
        "filename": None,
        "mime_type": None,
        "rows": 0,
        "error": None,
    }
    await db.finance_export_jobs.insert_one(doc)
    asyncio.create_task(_run_finance_export_job(
        job_id, doc["days"], doc["symbol"], requester, doc["file_format"],
    ))
    return {"job_id": job_id, "status": "pending"}


@api_router.get("/admin/finance/overview/export-jobs/{job_id}")
async def admin_get_finance_export_job(
    job_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    _require_admin_permission(auth, "export_finance")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    row = await db.finance_export_jobs.find_one({"id": job_id}, {"_id": 0, "file_data_b64": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Export job not found")
    return row


@api_router.get("/admin/finance/overview/export-jobs/{job_id}/download")
async def admin_download_finance_export_job(
    job_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    _require_admin_permission(auth, "export_finance")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    row = await db.finance_export_jobs.find_one({"id": job_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Export job not found")
    if row.get("status") != "completed":
        raise HTTPException(status_code=409, detail="Export job not completed yet")
    file_b64 = str(row.get("file_data_b64") or "")
    if not file_b64:
        raise HTTPException(status_code=410, detail="Export artifact is missing")
    file_data = base64.b64decode(file_b64.encode("ascii"))
    filename = str(row.get("filename") or f"{job_id}.{row.get('file_format') or 'csv'}")
    mime_type = str(row.get("mime_type") or "application/octet-stream")
    return StreamingResponse(
        iter([file_data]),
        media_type=mime_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/admin/finance/revenue-report")
async def admin_finance_revenue_report(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    days: int = Query(30, ge=1, le=365),
    symbol: Optional[str] = None,
):
    """Phase 4 — daily revenue report (volume, fees estimate, spread PnL)."""
    _require_admin_permission(auth, "view_finance")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    sym = (symbol or "").strip().upper() or None
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    match: Dict[str, Any] = {"created_at": {"$gte": cutoff}}
    if sym:
        match["symbol"] = sym

    daily_pipe = [
        {"$match": match},
        {"$project": {
            "day": {"$substr": ["$created_at", 0, 10]},
            "vol": {"$multiply": ["$price", "$amount"]},
        }},
        {"$group": {"_id": "$day", "trades": {"$sum": 1}, "volume_usdt": {"$sum": "$vol"}}},
        {"$sort": {"_id": 1}},
    ]
    daily_raw = await db.trades.aggregate(daily_pipe).to_list(800)

    fees_day_asset_pipe = [
        {"$match": match},
        {"$project": {
            "day": {"$substr": ["$created_at", 0, 10]},
            "pairs": [
                {"a": "$taker_fee_asset", "v": {"$ifNull": ["$taker_fee", 0]}},
                {"a": "$maker_fee_asset", "v": {"$ifNull": ["$maker_fee", 0]}},
            ],
        }},
        {"$unwind": "$pairs"},
        {"$match": {"pairs.a": {"$nin": [None, ""]}}},
        {"$group": {"_id": {"day": "$day", "asset": "$pairs.a"}, "total": {"$sum": "$pairs.v"}}},
    ]
    fees_day_asset_raw = await db.trades.aggregate(fees_day_asset_pipe).to_list(5_000)

    spread_match: Dict[str, Any] = {
        "uid": treasury_service.TREASURY_UID,
        "type": "system_spread_pnl",
        "created_at": {"$gte": cutoff},
    }
    spread_day_pipe = [
        {"$match": spread_match},
        {"$project": {
            "day": {"$substr": ["$created_at", 0, 10]},
            "signed": {
                "$cond": [
                    {"$eq": ["$direction", "credit"]},
                    "$amount",
                    {"$multiply": ["$amount", -1]},
                ],
            },
        }},
        {"$group": {"_id": "$day", "spread_usdt": {"$sum": "$signed"}}},
    ]
    spread_day_raw = await db.wallet_txns.aggregate(spread_day_pipe).to_list(800)
    spread_by_day = {str(r.get("_id") or ""): _as_float(r.get("spread_usdt")) for r in spread_day_raw}

    fee_marks: Dict[str, float] = {}
    fees_day_usdt: Dict[str, float] = defaultdict(float)
    for r in fees_day_asset_raw:
        rid = r.get("_id") or {}
        day = str(rid.get("day") or "")
        ast = str(rid.get("asset") or "").upper()
        if not day or not ast:
            continue
        amt = _as_float(r.get("total"))
        if ast not in fee_marks:
            fee_marks[ast] = _asset_mark_usdt(ast)
        fees_day_usdt[day] += amt * fee_marks[ast]

    rows = []
    total_volume = 0.0
    total_fees = 0.0
    total_spread = 0.0
    for r in daily_raw:
        day = str(r.get("_id") or "")
        trades = int(r.get("trades") or 0)
        volume = _as_float(r.get("volume_usdt"))
        fees_est = _as_float(fees_day_usdt.get(day))
        spread = _as_float(spread_by_day.get(day))
        total = fees_est + spread
        rows.append({
            "date": day,
            "trades": trades,
            "volume_usdt": round(volume, 4),
            "fees_usdt_estimate": round(fees_est, 4),
            "spread_pnl_usdt": round(spread, 4),
            "total_revenue_usdt_estimate": round(total, 4),
        })
        total_volume += volume
        total_fees += fees_est
        total_spread += spread

    return {
        "window_days": days,
        "symbol": sym,
        "rows": rows,
        "totals": {
            "trades": sum(int(x["trades"]) for x in rows),
            "volume_usdt": round(total_volume, 4),
            "fees_usdt_estimate": round(total_fees, 4),
            "spread_pnl_usdt": round(total_spread, 4),
            "total_revenue_usdt_estimate": round(total_fees + total_spread, 4),
        },
    }


@api_router.get("/admin/finance/revenue-report/export")
async def admin_finance_revenue_report_export(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    days: int = Query(30, ge=1, le=365),
    symbol: Optional[str] = None,
):
    _require_admin_permission(auth, "export_finance")
    payload = await admin_finance_revenue_report(auth=auth, days=days, symbol=symbol)
    rows = list(payload.get("rows") or [])
    totals = payload.get("totals") or {}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "trades", "volume_usdt", "fees_usdt_estimate", "spread_pnl_usdt", "total_revenue_usdt_estimate"])
    for r in rows:
        w.writerow([r.get("date"), r.get("trades"), r.get("volume_usdt"), r.get("fees_usdt_estimate"), r.get("spread_pnl_usdt"), r.get("total_revenue_usdt_estimate")])
    w.writerow([])
    w.writerow(["totals", totals.get("trades"), totals.get("volume_usdt"), totals.get("fees_usdt_estimate"), totals.get("spread_pnl_usdt"), totals.get("total_revenue_usdt_estimate")])
    csv_text = buf.getvalue()
    filename = f"finance_revenue_report_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _admin_profiles_for_uids(uids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not uids or db is None:
        return {}
    cur = db.users.find({"uid": {"$in": uids}}, {"_id": 0, "uid": 1, "email": 1, "name": 1})
    docs = await cur.to_list(len(uids) + 10)
    return {d["uid"]: d for d in docs}


async def _sum_notional_usdt_by_uid_from_asset_totals(
    by_uid_assets: Dict[str, Dict[str, float]],
) -> Dict[str, float]:
    """
    For each uid, sum wallet notionals using current marks for non-USDT assets.
    ``by_uid_assets[uid][asset]`` = cumulative native amount for that uid.
    """
    assets = set()
    for amap in by_uid_assets.values():
        assets.update(amap.keys())
    px: Dict[str, float] = {}
    for a in assets:
        if a == "USDT":
            continue
        sym = f"{a}USDT"
        try:
            px[a] = float(await get_current_price(sym))
        except Exception:
            logger.warning("leaderboard: mark for %s failed; using 0", sym)
            px[a] = 0.0
    out: Dict[str, float] = {}
    for uid, amap in by_uid_assets.items():
        total = 0.0
        for a, amt in amap.items():
            if amt <= 0:
                continue
            if a == "USDT":
                total += amt
            else:
                total += amt * float(px.get(a, 0.0))
        if total > 1e-12:
            out[uid] = round(total, 4)
    return out


def _leaderboard_pnl_sort_key(rank_by: str):
    rb = (rank_by or "combined").strip().lower()
    if rb == "realized":
        return lambda r: r["realized_pnl_usdt"]
    if rb == "unrealized":
        return lambda r: r["unrealized_pnl_usdt"]
    if rb == "volume":
        return lambda r: r["volume_notional_usdt"]
    return lambda r: r["combined_pnl_estimate_usdt"]


async def _compute_admin_leaderboard(
    limit: int,
    days: int,
    min_fills: int = 0,
    min_volume_usdt: float = 0.0,
    rank_by: str = "combined",
    flow_asset: Optional[str] = None,
) -> Dict[str, Any]:
    if db is None:
        raise RuntimeError("database unavailable")
    cutoff: Optional[str] = None
    if days and days > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    fa = (flow_asset or "").strip().upper() or None

    pipe_uids = [
        {"$project": {"u": ["$taker_uid", "$maker_uid"]}},
        {"$unwind": "$u"},
        {"$match": {"u": {"$nin": [None, "", "SYSTEM"]}}},
        {"$group": {"_id": "$u"}},
    ]
    uid_rows = await db.trades.aggregate(pipe_uids).to_list(100_000)
    trader_uids = [r["_id"] for r in uid_rows]

    sem = asyncio.Semaphore(25)

    async def _one_analytics(uid: str) -> Optional[Dict[str, Any]]:
        async with sem:
            try:
                return await _admin_trading_analytics_for_user(uid)
            except Exception as e:
                logger.warning("leaderboard trading analytics uid=%s: %s", uid, e)
                return None

    analytics_list = await asyncio.gather(*[_one_analytics(u) for u in trader_uids])
    analytics_ok = [a for a in analytics_list if a]

    pnl_rows: List[Dict[str, Any]] = []
    for a in analytics_ok:
        pnl_rows.append({
            "uid": a["uid"],
            "realized_pnl_usdt": float(a.get("realized_pnl_usdt") or 0),
            "unrealized_pnl_usdt":         float(a.get("unrealized_pnl_usdt") or 0),
            "combined_pnl_estimate_usdt":  float(a.get("combined_pnl_estimate_usdt") or 0),
            "volume_notional_usdt":        float(a.get("volume_notional_usdt") or 0),
            "trade_fill_count":            int(a.get("trade_fill_count") or 0),
            "sell_fill_count":             int(a.get("sell_fill_count") or 0),
        })

    pnl_filtered: List[Dict[str, Any]] = []
    for r in pnl_rows:
        if r["trade_fill_count"] < int(min_fills):
            continue
        if r["volume_notional_usdt"] < float(min_volume_usdt or 0):
            continue
        pnl_filtered.append(r)

    sort_key = _leaderboard_pnl_sort_key(rank_by)
    pnl_sorted_hi = sorted(pnl_filtered, key=sort_key, reverse=True)
    top_gainers = pnl_sorted_hi[:limit]
    pnl_sorted_lo = sorted(pnl_filtered, key=sort_key)
    top_losers = pnl_sorted_lo[:limit]

    profitable_n = sum(1 for r in pnl_filtered if r["combined_pnl_estimate_usdt"] > 1e-6)
    losing_n = sum(1 for r in pnl_filtered if r["combined_pnl_estimate_usdt"] < -1e-6)

    by_dep: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    dep_docs = await db.deposit_requests.find(
        {"status": "approved"},
        {"_id": 0, "uid": 1, "asset": 1, "amount": 1, "created_at": 1, "reviewed_at": 1},
    ).to_list(20_000)
    for d in dep_docs:
        ts = d.get("reviewed_at") or d.get("created_at") or ""
        if cutoff and (not ts or ts < cutoff):
            continue
        uid = d.get("uid")
        if not uid:
            continue
        ast = d.get("asset") or "USDT"
        if fa and ast != fa:
            continue
        by_dep[uid][ast] += float(d.get("amount") or 0)
    dep_notional = await _sum_notional_usdt_by_uid_from_asset_totals(by_dep)
    top_deposits = sorted(dep_notional.items(), key=lambda kv: -kv[1])[:limit]

    wd_notional: Dict[str, float] = defaultdict(float)
    by_wd_assets: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    wd_docs = await db.withdrawal_requests.find(
        {"status": "approved"},
        {"_id": 0, "uid": 1, "asset": 1, "amount": 1, "amount_usdt": 1, "created_at": 1, "reviewed_at": 1},
    ).to_list(20_000)
    for w in wd_docs:
        ts = w.get("reviewed_at") or w.get("created_at") or ""
        if cutoff and (not ts or ts < cutoff):
            continue
        uid = w.get("uid")
        if not uid:
            continue
        wast = w.get("asset") or "USDT"
        if fa and wast != fa:
            continue
        if w.get("amount_usdt") is not None:
            wd_notional[uid] += float(w.get("amount_usdt") or 0)
        else:
            ast = w.get("asset") or "USDT"
            by_wd_assets[uid][ast] += float(w.get("amount") or 0)
    extra_wd = await _sum_notional_usdt_by_uid_from_asset_totals(by_wd_assets)
    for u, v in extra_wd.items():
        wd_notional[u] += v
    wd_rounded = {u: round(v, 4) for u, v in wd_notional.items() if v > 1e-12}
    top_withdrawals = sorted(wd_rounded.items(), key=lambda kv: -kv[1])[:limit]

    need_uids = set()
    for row in top_gainers + top_losers:
        need_uids.add(row["uid"])
    for u, _ in top_deposits:
        need_uids.add(u)
    for u, _ in top_withdrawals:
        need_uids.add(u)
    prof = await _admin_profiles_for_uids(list(need_uids))

    def _attach_pnl(row: Dict[str, Any]) -> Dict[str, Any]:
        p = prof.get(row["uid"], {})
        return {
            **row,
            "email": p.get("email"),
            "name":  p.get("name"),
        }

    def _attach_flow(uid: str, total: float) -> Dict[str, Any]:
        p = prof.get(uid, {})
        out = {
            "uid": uid,
            "total_notional_usdt": float(total),
            "email": p.get("email"),
            "name":  p.get("name"),
        }
        if fa:
            out["asset_filter"] = fa
        return out

    best_c = top_gainers[0]["combined_pnl_estimate_usdt"] if top_gainers else None
    worst_c = top_losers[0]["combined_pnl_estimate_usdt"] if top_losers else None
    sum_dep_top = sum(v for _, v in top_deposits) if top_deposits else 0.0
    sum_wd_top = sum(v for _, v in top_withdrawals) if top_withdrawals else 0.0

    rb_safe = (rank_by or "combined").strip().lower()
    if rb_safe not in ("combined", "realized", "unrealized", "volume"):
        rb_safe = "combined"

    return {
        "limit":              limit,
        "days":               days,
        "min_fills":          int(min_fills),
        "min_volume_usdt":    float(min_volume_usdt or 0),
        "rank_by":            rb_safe,
        "flow_asset":         fa,
        "pnl_scope":          "all_time",
        "flows_cutoff_note":  "All-time approved flows" if not cutoff else f"Approved flows with review/create time in the last {days} days",
        "methodology": (
            "P&L ranks use the same model as user analytics: realized (average-cost sells) + unrealized (marks vs avg cost). "
            "Deposit/withdraw ranks use USDT notional at current marks for non-USDT assets."
        ),
        "summary": {
            "traders_with_history": len(trader_uids),
            "traders_after_filters":    len(pnl_filtered),
            "traders_profitable_approx": profitable_n,
            "traders_losing_approx":     losing_n,
            "best_combined_in_top":      round(best_c, 4) if best_c is not None else None,
            "worst_combined_in_top":     round(worst_c, 4) if worst_c is not None else None,
            "sum_top_deposits_usdt":     round(sum_dep_top, 4),
            "sum_top_withdrawals_usdt":  round(sum_wd_top, 4),
        },
        "top_gainers":        [_attach_pnl(r) for r in top_gainers],
        "top_losers":         [_attach_pnl(r) for r in top_losers],
        "top_deposits":       [_attach_flow(u, v) for u, v in top_deposits],
        "top_withdrawals":    [_attach_flow(u, v) for u, v in top_withdrawals],
        "traders_considered": len(trader_uids),
    }


@api_router.get("/admin/stats/leaderboard")
async def admin_stats_leaderboard(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    limit: int = Query(10, ge=1, le=50),
    days: int = Query(0, ge=0, le=365),
    min_fills: int = Query(0, ge=0, le=500_000),
    min_volume_usdt: float = Query(0, ge=0),
    rank_by: str = Query("combined", description="combined | realized | unrealized | volume"),
    flow_asset: Optional[str] = Query(None, description="Limit deposit/withdraw totals to this asset (e.g. USDT, BTC)"),
):
    """
    Leaderboard: trading P&L (sortable), deposits, withdrawals.
    ``days`` filters deposit/withdrawal totals only (0 = all time). Trading P&L is always all-time.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_analytics")
    rb = (rank_by or "combined").strip().lower()
    if rb not in ("combined", "realized", "unrealized", "volume"):
        raise HTTPException(status_code=400, detail="rank_by must be combined, realized, unrealized, or volume")
    return await _compute_admin_leaderboard(
        limit, days, min_fills=min_fills, min_volume_usdt=min_volume_usdt, rank_by=rb, flow_asset=flow_asset
    )


async def _uids_matching_deposit_address(q: str, *, limit: int = 100) -> List[str]:
    """Return distinct user UIDs whose HD deposit address matches ``q``.

    Supports partial paste (min 6 chars) and case-insensitive EVM ``0x…`` matches.
    """
    if db is None:
        return []
    qs = (q or "").strip()
    if len(qs) < 6:
        return []
    # Escape regex metacharacters so partial address paste stays literal.
    escaped = re.escape(qs)
    addr_filt: Dict[str, Any] = {
        "address": {"$regex": escaped, "$options": "i"},
        "uid": {"$exists": True, "$ne": None},
    }
    uids: List[str] = []
    seen: set = set()
    async for row in db.deposit_addresses.find(
        addr_filt, {"_id": 0, "uid": 1},
    ).limit(max(1, min(int(limit), 500))):
        uid = (row.get("uid") or "").strip()
        if uid and uid not in seen:
            seen.add(uid)
            uids.append(uid)
    return uids


@api_router.get("/admin/search/users")
async def admin_search_users(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    q: str = Query("", min_length=1),
    limit: int = Query(15, le=50),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_users")
    qs = q.strip()
    rx = {"$regex": qs, "$options": "i"}
    or_clauses: List[Dict[str, Any]] = [
        {"email": rx}, {"name": rx}, {"uid": rx}, {"phone": rx},
    ]
    addr_uids = await _uids_matching_deposit_address(qs, limit=limit * 3)
    if addr_uids:
        or_clauses.append({"uid": {"$in": addr_uids}})
    filt: Dict[str, Any] = {"$or": or_clauses}
    cur = db.users.find(filt, {"_id": 0, "password_hash": 0}).limit(limit)
    items = await cur.to_list(limit)
    # Prefer deposit-address hits first when the query looks like an address.
    if addr_uids:
        rank = {u: i for i, u in enumerate(addr_uids)}
        items.sort(key=lambda u: (0 if u.get("uid") in rank else 1, rank.get(u.get("uid"), 10_000)))
    out = []
    for u in items:
        ks = u.get("kyc_status", "unverified")
        out.append({
            "uid": u["uid"],
            "email": u["email"],
            "name": u.get("name", "") or "",
            "kyc_status": ks,
            "country": u.get("country") or "",
            "phone": u.get("phone") or "",
            "is_active": bool(u.get("is_active", True)),
            "matched_via_deposit_address": u.get("uid") in set(addr_uids),
        })
    return out


@api_router.get("/admin/kyc/pending")
async def admin_kyc_pending(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    q: str = "",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=300),
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    """KYC submissions awaiting review (compliance queue)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_kyc")
    filt: Dict[str, Any] = {"status": "pending"}
    if q.strip():
        qs = q.strip()
        rx = {"$regex": qs, "$options": "i"}
        user_uids = await db.users.distinct("uid", {"$or": [{"uid": rx}, {"email": rx}, {"name": rx}]})
        filt["$or"] = [{"uid": rx}, {"uid": {"$in": user_uids}}]
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        filt["submitted_at"] = dr
    ksf = _admin_sort_mongo_field(sort_by, {
        "submitted_at": "submitted_at",
        "reviewed_at": "reviewed_at",
        "uid": "uid",
        "status": "status",
    }, "submitted_at")
    cur = db.kyc.find(filt, {"_id": 0}).sort(ksf, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.kyc.count_documents(filt)
    uids = [row.get("uid") for row in items if row.get("uid")]
    umap: Dict[str, Dict[str, Any]] = {}
    if uids:
        async for u in db.users.find(
            {"uid": {"$in": uids}},
            {"_id": 0, "uid": 1, "email": 1, "name": 1, "kyc_status": 1},
        ):
            umap[u["uid"]] = u
    out = []
    for row in items:
        uid = row.get("uid")
        u = umap.get(uid) if uid else None
        out.append({
            **row,
            "user_email": (u or {}).get("email"),
            "user_name":  (u or {}).get("name"),
        })
    return {"items": out, "total": total, "skip": skip, "limit": limit}


async def _approved_amount_totals_by_uid(collection, uids: List[str]) -> Dict[str, Dict[str, float]]:
    """Sum approved request amounts per user and asset (gross withdrawal `amount`)."""
    if not uids:
        return {}
    cur = collection.aggregate([
        {"$match": {"status": "approved", "uid": {"$in": uids}}},
        {"$group": {
            "_id": {"uid": "$uid", "asset": {"$ifNull": ["$asset", ""]}},
            "total": {"$sum": "$amount"},
        }},
    ])
    rows = await cur.to_list(5000)
    out: Dict[str, Dict[str, float]] = {}
    for r in rows:
        key = r.get("_id") or {}
        uid = key.get("uid")
        if not uid:
            continue
        raw_a = key.get("asset")
        asset = (str(raw_a).strip().upper() or "—") if raw_a else "—"
        try:
            amt = float(r.get("total") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        out.setdefault(uid, {})[asset] = round(amt, 8)
    return out


async def _sum_approved_amount_by_asset(collection, match_extra: Dict[str, Any]) -> Dict[str, float]:
    m: Dict[str, Any] = {"status": "approved"}
    m.update(match_extra)
    cur = collection.aggregate([
        {"$match": m},
        {"$group": {"_id": {"$ifNull": ["$asset", ""]}, "total": {"$sum": "$amount"}}},
    ])
    rows = await cur.to_list(200)
    out: Dict[str, float] = {}
    for r in rows:
        raw = r.get("_id")
        asset = (str(raw).strip().upper() or "—") if raw else "—"
        try:
            out[asset] = round(float(r.get("total") or 0), 8)
        except (TypeError, ValueError):
            out[asset] = 0.0
    return out


async def _approved_flow_totals_by_asset_for_user_filter(
    collection, user_filt: Dict[str, Any]
) -> Dict[str, float]:
    """Sum approved `amount` by asset for requests whose user matches ``user_filt`` (same as user list)."""
    if db is None:
        return {}
    if not user_filt:
        return await _sum_approved_amount_by_asset(collection, {})
    uids = await db.users.distinct("uid", user_filt)
    if not uids:
        return {}
    merged: Dict[str, float] = {}
    chunk_size = 1000
    for i in range(0, len(uids), chunk_size):
        chunk = uids[i : i + chunk_size]
        part = await _sum_approved_amount_by_asset(collection, {"uid": {"$in": chunk}})
        for k, v in part.items():
            merged[k] = merged.get(k, 0.0) + v
    return {k: round(v, 8) for k, v in merged.items()}


@api_router.get("/admin/users")
async def admin_list_users(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    q: str = "",
    kyc_status: Optional[str] = None,
    is_active: Optional[bool] = None,
    country: Optional[str] = None,
    features_paused: Optional[bool] = None,
    trading_paused: Optional[bool] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_users")
    filt: Dict[str, Any] = {}
    clauses: List[Dict[str, Any]] = []
    if kyc_status:
        filt["kyc_status"] = kyc_status
    if is_active is True:
        clauses.append({"$or": [{"is_active": True}, {"is_active": {"$exists": False}}]})
    elif is_active is False:
        clauses.append({"is_active": False})
    if country and country.strip():
        crx = {"$regex": country.strip(), "$options": "i"}
        clauses.append({"country": crx})
    if features_paused is True:
        clauses.append({"user_features_paused": True})
    elif features_paused is False:
        clauses.append({"$or": [{"user_features_paused": False}, {"user_features_paused": {"$exists": False}}]})
    if trading_paused is True:
        clauses.append({"user_trading_paused": True})
    elif trading_paused is False:
        clauses.append({"$or": [{"user_trading_paused": False}, {"user_trading_paused": {"$exists": False}}]})
    if q.strip():
        qs = q.strip()
        rx = {"$regex": qs, "$options": "i"}
        user_or: List[Dict[str, Any]] = [
            {"email": rx}, {"name": rx}, {"uid": rx}, {"phone": rx},
        ]
        addr_uids = await _uids_matching_deposit_address(qs, limit=200)
        if addr_uids:
            user_or.append({"uid": {"$in": addr_uids}})
        clauses.append({"$or": user_or})
    if created_from or created_to:
        dr: Dict[str, Any] = {}
        if created_from:
            dr["$gte"] = created_from
        if created_to:
            dr["$lte"] = created_to
        clauses.append({"created_at": dr})
    if clauses:
        filt["$and"] = clauses
    usf = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "joined": "created_at",
        "email": "email",
        "name": "name",
        "uid": "uid",
        "kyc_status": "kyc_status",
        "last_login_at": "last_login_at",
        "country": "country",
    }, "created_at")
    cur = db.users.find(filt, {"_id": 0, "password_hash": 0}).sort(usf, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.users.count_documents(filt)
    dep_overall, wd_overall = await asyncio.gather(
        _approved_flow_totals_by_asset_for_user_filter(db.deposit_requests, filt),
        _approved_flow_totals_by_asset_for_user_filter(db.withdrawal_requests, filt),
    )
    uids = [u["uid"] for u in items]
    dep_by_uid = await _approved_amount_totals_by_uid(db.deposit_requests, uids)
    wd_by_uid = await _approved_amount_totals_by_uid(db.withdrawal_requests, uids)

    # Phase 7a — hydrate 2FA state for the page in one query so admins can
    # see at a glance who has it enabled.
    twofa_uids: set = set()
    if uids:
        async for r in db.user_2fa.find(
            {"uid": {"$in": uids}, "confirmed": True},
            {"_id": 0, "uid": 1},
        ):
            if r.get("uid"):
                twofa_uids.add(r["uid"])

    out_items = []
    for u in items:
        u["two_factor_enabled"] = u["uid"] in twofa_uids
        row = user_doc_to_out(u).model_dump()
        uid = u["uid"]
        row["deposit_totals"] = dep_by_uid.get(uid, {})
        row["withdrawal_totals"] = wd_by_uid.get(uid, {})
        out_items.append(row)
    return {
        "items": out_items,
        "total": total,
        "skip":  skip,
        "limit": limit,
        "stats": {
            "deposit_totals": dep_overall,
            "withdrawal_totals": wd_overall,
        },
    }


@api_router.get("/admin/users/{uid}")
async def admin_get_user(uid: str, auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_users")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    wallets = await db.wallets.find({"uid": uid}, {"_id": 0}).to_list(100)
    n_orders = await db.orders.count_documents({"uid": uid})
    n_trades = await db.trades.count_documents({"$or": [{"taker_uid": uid}, {"maker_uid": uid}]})
    n_dep = await db.deposit_requests.count_documents({"uid": uid})
    n_wd = await db.withdrawal_requests.count_documents({"uid": uid})
    last_order = await db.orders.find({"uid": uid}, {"_id": 0, "created_at": 1}).sort("created_at", -1).to_list(1)
    last_trade = await db.trades.find({"$or": [{"taker_uid": uid}, {"maker_uid": uid}]}, {"_id": 0, "created_at": 1}).sort("created_at", -1).to_list(1)
    last_dep = await db.deposit_requests.find({"uid": uid}, {"_id": 0, "created_at": 1}).sort("created_at", -1).to_list(1)
    last_wd = await db.withdrawal_requests.find({"uid": uid}, {"_id": 0, "created_at": 1}).sort("created_at", -1).to_list(1)
    last_adj = await db.wallet_adjustments.find({"uid": uid}, {"_id": 0, "created_at": 1}).sort("created_at", -1).to_list(1)
    latest_candidates = [
        (last_order[0].get("created_at") if last_order else None),
        (last_trade[0].get("created_at") if last_trade else None),
        (last_dep[0].get("created_at") if last_dep else None),
        (last_wd[0].get("created_at") if last_wd else None),
        (last_adj[0].get("created_at") if last_adj else None),
    ]
    last_activity_at = max([x for x in latest_candidates if x], default=None)
    kyc = await db.kyc.find_one({"uid": uid}, {"_id": 0})
    # Per-user HD deposit addresses (same shape as GET /admin/deposit-addresses/by-user/{uid}).
    deposit_addrs = await db.deposit_addresses.find(
        {"uid": uid, "provider": {"$ne": "admin"}},
        {"_id": 0},
    ).sort([("asset", 1), ("network", 1)]).to_list(100)
    return {
        "user":   {
            **user_doc_to_out(user).model_dump(),
            "is_active":   user.get("is_active", True),
            "admin_notes": user.get("admin_notes") or "",
            "user_features_paused": bool(user.get("user_features_paused", False)),
            "user_trading_paused":  bool(user.get("user_trading_paused", False)),
            "user_withdrawals_paused": bool(user.get("user_withdrawals_paused", False)),
            "user_pause_note":      user.get("user_pause_note") or "",
            "last_login_at": user.get("last_login_at"),
            "last_activity_at": last_activity_at,
            "kyc_tier": user.get("kyc_tier"),
            "aml_risk_score": user.get("aml_risk_score"),
            "aml_risk_factors": user.get("aml_risk_factors"),
            "account_frozen_at": user.get("account_frozen_at"),
            "account_frozen_until": user.get("account_frozen_until"),
            "account_frozen_scope": user.get("account_frozen_scope"),
            "account_frozen_reason": user.get("account_frozen_reason"),
        },
        "wallets": wallets,
        "deposit_addresses": [
            _deposit_address_admin_out(d).model_dump()
            for d in deposit_addrs
        ],
        "counts": {
            "orders": n_orders, "trades": n_trades,
            "deposits": n_dep, "withdrawals": n_wd,
        },
        "kyc": kyc,
    }


@api_router.get("/admin/users/{uid}/referrals")
async def admin_get_user_referrals(uid: str, auth: AdminAuthContext = Depends(resolve_admin_auth)):
    """Refer & Earn detail for one user: their code, upline sponsor, and full downstream tree."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_users")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "uid": 1, "referral_code": 1, "referred_by": 1, "name": 1, "email": 1, "avatar_url": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    code = user.get("referral_code") or await referral_svc.ensure_referral_code(db, uid)
    sponsor = None
    sponsor_uid = user.get("referred_by")
    if sponsor_uid:
        sponsor_doc = await db.users.find_one({"uid": sponsor_uid}, {"_id": 0, "uid": 1, "name": 1, "email": 1})
        sponsor = sponsor_doc
    dash = await referral_svc.get_admin_referral_dashboard(db, uid)
    root_user = await _admin_referral_root_user(db, user)
    return {
        "referral_code": code,
        "referred_by": sponsor,
        "root": root_user,
        "summary": dash["summary"],
        "referrals": dash["referrals"],
    }


async def _admin_referral_root_user(db, user: dict) -> dict:
    uid = user["uid"]
    code = user.get("referral_code") or await referral_svc.ensure_referral_code(db, uid)
    root_doc = await db.users.find_one(
        {"uid": uid},
        {"_id": 0, "uid": 1, "name": 1, "email": 1, "avatar_url": 1, "referral_code": 1},
    )
    return {
        "uid": uid,
        "name": root_doc.get("name") if root_doc else user.get("name"),
        "email": root_doc.get("email") if root_doc else user.get("email"),
        "avatar_url": (root_doc or {}).get("avatar_url") or "",
        "referral_code": code,
    }


@api_router.get("/admin/referrals/tree")
async def admin_referral_tree_search(
    q: str = "",
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Search a user by uid/email/name/referral_code and return their full downstream graph.

    Includes every direct and indirect referral (not capped at configured reward levels).
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_users")
    query = (q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Provide a uid, email, name, or referral code to search")
    user = await db.users.find_one(
        {"$or": [
            {"uid": query},
            {"email": query.lower()},
            {"referral_code": query.upper()},
            {"name": {"$regex": re.escape(query), "$options": "i"}},
        ]},
        {"_id": 0, "uid": 1, "name": 1, "email": 1, "referral_code": 1, "referred_by": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="No user matched that search")
    uid = user["uid"]
    dash = await referral_svc.get_admin_referral_dashboard(db, uid)
    upline = await referral_svc.get_upline_chain(db, uid)
    return {
        "root": await _admin_referral_root_user(db, user),
        "upline": upline,
        "summary": dash["summary"],
        "referrals": dash["referrals"],
    }


@api_router.get("/admin/users/{uid}/orders")
async def admin_user_orders(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    status: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_orders")
    user = await db.users.find_one({"uid": uid}, {"_id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    filt: Dict[str, Any] = {"uid": uid}
    if status:
        filt["status"] = status
    osf = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "status": "status",
        "symbol": "symbol",
        "side": "side",
        "type": "type",
        "price": "price",
        "amount": "amount",
        "id": "id",
    }, "created_at")
    cur = db.orders.find(filt, {"_id": 0}).sort(osf, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.orders.count_documents(filt)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.get("/admin/orders")
async def admin_orders(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
    uid: Optional[str] = None,
    symbol: Optional[str] = None,
    status: Optional[str] = None,
    side: Optional[str] = None,
    type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    """Platform-wide orders explorer (read-only, filterable)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_orders")
    filt: Dict[str, Any] = {}
    if uid:
        filt["uid"] = uid.strip()
    if symbol:
        filt["symbol"] = symbol.strip().upper()
    if status:
        raw = [s.strip().lower() for s in str(status).split(",") if s.strip()]
        if len(raw) == 1:
            filt["status"] = raw[0]
        elif raw:
            filt["status"] = {"$in": raw}
    if side:
        filt["side"] = side.strip().lower()
    if type:
        filt["type"] = type.strip().lower()
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        filt["created_at"] = dr
    osf = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "status": "status",
        "uid": "uid",
        "symbol": "symbol",
        "side": "side",
        "type": "type",
        "price": "price",
        "amount": "amount",
        "id": "id",
    }, "created_at")
    cur = (
        db.orders.find(filt, {"_id": 0})
        .sort(osf, _admin_sort_sign(sort_dir))
        .skip(skip)
        .limit(limit)
    )
    items = await cur.to_list(limit)
    total = await db.orders.count_documents(filt)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


async def _cancel_order_core(order_id: str, uid: str) -> Dict[str, Any]:
    """Cancel one order and release still-locked funds (user or admin)."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    peek = await db.orders.find_one({"id": order_id, "uid": uid}, {"_id": 0, "status": 1})
    if not peek:
        raise HTTPException(404, "Order not found")
    if peek["status"] not in ("open", "partially_filled"):
        raise HTTPException(409, f"Order is already '{peek['status']}'")
    now = datetime.now(timezone.utc).isoformat()
    claimed = await db.orders.find_one_and_update(
        {"id": order_id, "uid": uid, "status": {"$in": ["open", "partially_filled"]}},
        {"$set": {"status": "cancelled", "updated_at": now}},
        return_document=ReturnDocument.BEFORE,
    )
    if not claimed:
        raise HTTPException(409, "Order is no longer cancellable")
    base_asset = SYMBOL_BASE_MAP.get(claimed["symbol"], "USDT")
    _cancel_quote = SYMBOL_QUOTE_MAP.get(claimed["symbol"].upper(), "USDT")
    remaining = float(claimed.get("remaining") or 0.0)
    if remaining > 1e-10:
        if claimed["side"] == "buy":
            refund = float(claimed.get("lock_price") or claimed.get("price") or 0.0) * remaining
            await return_locked(claimed["uid"], _cancel_quote, round(refund, 8), ref_id=order_id)
        else:
            await return_locked(claimed["uid"], base_asset, remaining, ref_id=order_id)
    return {"ok": True, "message": "Order cancelled successfully"}


@api_router.post("/admin/orders/{order_id}/cancel")
async def admin_cancel_order(
    order_id: str,
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_orders")
    row = await db.orders.find_one({"id": order_id}, {"_id": 0, "uid": 1})
    if not row:
        raise HTTPException(404, "Order not found")
    return await _cancel_order_core(order_id, row["uid"])


@api_router.post("/admin/orders/bulk-cancel")
async def admin_bulk_cancel_orders(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
    symbol: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = Query(200, ge=1, le=2000),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_orders")
    filt: Dict[str, Any] = {"status": {"$in": ["open", "partially_filled"]}}
    if symbol:
        filt["symbol"] = symbol.strip().upper()
    if uid:
        filt["uid"] = uid.strip()
    rows = await db.orders.find(filt, {"_id": 0, "id": 1, "uid": 1}).limit(limit).to_list(limit)
    cancelled = 0
    failed = 0
    for r in rows:
        try:
            await _cancel_order_core(str(r.get("id")), str(r.get("uid")))
            cancelled += 1
        except HTTPException:
            failed += 1
        except Exception:
            failed += 1
    return {
        "ok": True,
        "matched": len(rows),
        "cancelled": cancelled,
        "failed": failed,
        "limit": limit,
    }


@api_router.get("/admin/markets/pairs")
async def admin_market_pairs(_auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_markets")
    controls = await get_platform_controls()
    global_maker = float(controls.get("maker_fee_rate", 0.001) or 0.001)
    global_taker = float(controls.get("taker_fee_rate", 0.001) or 0.001)
    rows = await _trading_markets_snapshot()
    cfg_rows = await db.market_pairs.find({}, {"_id": 0}).to_list(500)
    cfg = {str(r.get("symbol", "")).upper(): r for r in cfg_rows if r.get("symbol")}
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for r in rows:
        sym = str(r.get("symbol") or "").upper()
        if not sym:
            continue
        seen.add(sym)
        c = cfg.get(sym, {})
        out.append({
            "symbol": sym,
            "base_asset": r.get("baseAsset") or r.get("base") or sym.replace("USDT", ""),
            "quote_asset": r.get("quoteAsset") or "USDT",
            "is_active": bool(c.get("is_active", True)),
            "maker_fee_rate": float(c.get("maker_fee_rate", global_maker)),
            "taker_fee_rate": float(c.get("taker_fee_rate", global_taker)),
            "price": r.get("price"),
            "quote_volume": r.get("quoteVolume"),
        })
    for sym, c in cfg.items():
        if sym in seen:
            continue
        out.append({
            "symbol": sym,
            "base_asset": c.get("base_asset") or sym.replace("USDT", ""),
            "quote_asset": c.get("quote_asset") or "USDT",
            "is_active": bool(c.get("is_active", True)),
            "maker_fee_rate": float(c.get("maker_fee_rate", global_maker)),
            "taker_fee_rate": float(c.get("taker_fee_rate", global_taker)),
            "price": None,
            "quote_volume": None,
        })
    out.sort(key=lambda x: x["symbol"])
    return {"items": out, "total": len(out)}


@api_router.post("/admin/markets/pairs")
async def admin_create_market_pair(
    body: MarketPairCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_settings")
    sym = str(body.symbol or "").strip().upper()
    if not sym or len(sym) < 6:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "symbol": sym,
        "base_asset": (body.base_asset or sym.replace(str(body.quote_asset).upper(), "")).upper(),
        "quote_asset": str(body.quote_asset or "USDT").upper(),
        "is_active": bool(body.is_active),
        "maker_fee_rate": float(body.maker_fee_rate),
        "taker_fee_rate": float(body.taker_fee_rate),
        "created_at": now,
        "updated_at": now,
    }
    await db.market_pairs.update_one({"symbol": sym}, {"$set": doc, "$setOnInsert": {"symbol": sym}}, upsert=True)
    await log_admin_audit(auth, "market_pair_create", "market_pair", sym, {"is_active": doc["is_active"]})
    return {"ok": True, "pair": doc}


@api_router.patch("/admin/markets/pairs/{symbol}")
async def admin_patch_market_pair(
    symbol: str,
    body: MarketPairPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_settings")
    sym = str(symbol or "").strip().upper()
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.market_pairs.update_one({"symbol": sym}, {"$set": updates, "$setOnInsert": {"symbol": sym}}, upsert=True)
    row = await db.market_pairs.find_one({"symbol": sym}, {"_id": 0})
    await log_admin_audit(auth, "market_pair_patch", "market_pair", sym, {"updates": list(updates.keys())})
    return {"ok": True, "pair": row or {"symbol": sym, **updates}}


@api_router.get("/admin/users/{uid}/trades")
async def admin_user_trades(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    symbol: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_trades")
    user = await db.users.find_one({"uid": uid}, {"_id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    filt: Dict[str, Any] = {"$or": [{"taker_uid": uid}, {"maker_uid": uid}]}
    if symbol:
        filt["symbol"] = symbol.strip().upper()
    tsf = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "symbol": "symbol",
        "price": "price",
        "amount": "amount",
        "id": "id",
    }, "created_at")
    cur = db.trades.find(filt, {"_id": 0}).sort(tsf, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.trades.count_documents(filt)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.get("/admin/users/{uid}/trading-analytics")
async def admin_user_trading_analytics(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Per-user realized / unrealized P&L, fee totals, and open positions (admin)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_trades")
    user = await db.users.find_one({"uid": uid}, {"_id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return await _admin_trading_analytics_for_user(uid)


@api_router.get("/admin/users/{uid}/positions/live")
async def admin_user_live_positions(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_trades")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "uid": 1, "name": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    positions = await build_user_positions(uid)
    return {
        "uid": uid,
        "user_name": user.get("name") or "",
        "user_email": user.get("email") or "",
        "positions": positions,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@api_router.get("/admin/positions/live")
async def admin_live_positions(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    uid: Optional[str] = None,
    q: Optional[str] = None,
    symbol: Optional[str] = None,
    asset: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_trades")
    rows = await _compute_admin_live_position_rows(uid, q, symbol, asset, sort_by, sort_dir)
    payload = _live_positions_payload_from_rows(rows, skip, limit)
    payload.pop("type", None)
    return payload


@api_router.websocket("/admin/ws/live-positions")
async def ws_admin_live_positions(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    x_admin_key: Optional[str] = Query(None, alias="x_admin_key"),
    uid: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    asset: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    if db is None:
        await websocket.close(code=1011)
        return
    admin_doc = await _admin_doc_from_ws_auth(token, x_admin_key)
    if not admin_doc:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    sub = {
        "websocket": websocket,
        "uid": (uid or "").strip() or None,
        "q": (q or "").strip() or None,
        "symbol": (symbol or "").strip() or None,
        "asset": (asset or "").strip() or None,
        "sort_by": (sort_by or "").strip() or None,
        "sort_dir": (sort_dir or "").strip() or None,
        "skip": skip,
        "limit": limit,
    }
    try:
        rows = await _compute_admin_live_position_rows(
            sub["uid"], sub["q"], sub["symbol"], sub["asset"], sub["sort_by"], sub["sort_dir"],
        )
        await websocket.send_json(_live_positions_payload_from_rows(rows, sub["skip"], sub["limit"]))
    except WebSocketDisconnect:
        async with _live_pos_ws_lock:
            _live_pos_ws_subs[:] = [s for s in _live_pos_ws_subs if s["websocket"] != websocket]
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws live-positions: client gone before initial snapshot (%s)", e)
            return
        logger.exception("ws live-positions initial snapshot: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _live_pos_ws_lock:
        _live_pos_ws_subs.append(sub)
    await _ensure_live_positions_ws_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _live_pos_ws_lock:
            _live_pos_ws_subs[:] = [s for s in _live_pos_ws_subs if s["websocket"] != websocket]


@api_router.websocket("/admin/ws/users/{uid}/positions/live")
async def ws_admin_user_live_positions(
    websocket: WebSocket,
    uid: str,
    token: Optional[str] = Query(None),
    x_admin_key: Optional[str] = Query(None, alias="x_admin_key"),
):
    if db is None:
        await websocket.close(code=1011)
        return
    admin_doc = await _admin_doc_from_ws_auth(token, x_admin_key)
    if not admin_doc:
        await websocket.close(code=4401)
        return
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "uid": 1, "name": 1, "email": 1})
    if not user:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    sub = {"websocket": websocket, "uid": uid}
    try:
        positions = await build_user_positions(uid)
        await websocket.send_json({
            "type": "user_live_positions",
            "uid": uid,
            "user_name": user.get("name") or "",
            "user_email": user.get("email") or "",
            "positions": positions,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws user positions: client gone before initial snapshot (%s)", e)
            return
        logger.exception("ws user positions initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _user_pos_ws_lock:
        _user_pos_ws_subs.append(sub)
    await _ensure_user_positions_ws_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _user_pos_ws_lock:
            _user_pos_ws_subs[:] = [s for s in _user_pos_ws_subs if s["websocket"] != websocket]


@api_router.websocket("/admin/ws/markets-tickers")
async def ws_admin_markets_tickers(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    x_admin_key: Optional[str] = Query(None, alias="x_admin_key"),
):
    admin_doc = await _admin_doc_from_ws_auth(token, x_admin_key)
    if not admin_doc:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        rows = await _trading_markets_snapshot()
        await websocket.send_json({
            "type": "markets_tickers",
            "markets": rows,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws markets-tickers: client gone before initial snapshot (%s)", e)
            return
        logger.exception("ws markets-tickers initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _markets_tickers_ws_lock:
        _markets_tickers_ws_subs.append(websocket)
    await _ensure_markets_tickers_ws_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _markets_tickers_ws_lock:
            _markets_tickers_ws_subs[:] = [w for w in _markets_tickers_ws_subs if w != websocket]


@api_router.websocket("/admin/ws/trading-klines")
async def ws_admin_trading_klines(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    x_admin_key: Optional[str] = Query(None, alias="x_admin_key"),
    symbol: str = Query(..., min_length=1),
    interval: str = Query("1h"),
    limit: int = Query(200, ge=1, le=500),
):
    admin_doc = await _admin_doc_from_ws_auth(token, x_admin_key)
    if not admin_doc:
        await websocket.close(code=4401)
        return
    sym = symbol.strip().upper()
    if sym not in SYMBOL_BASE_MAP:
        await websocket.close(code=4400)
        return
    await websocket.accept()
    sub = {"websocket": websocket, "symbol": sym, "interval": interval, "limit": limit}
    try:
        klines = await _trading_klines_snapshot(sym, interval, limit)
        await websocket.send_json({
            "type": "trading_klines",
            "symbol": sym,
            "interval": interval,
            "limit": limit,
            "klines": klines,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws trading-klines: client gone before initial snapshot (%s)", e)
            return
        logger.exception("ws trading-klines initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _klines_ws_lock:
        _klines_ws_subs.append(sub)
    await _ensure_klines_ws_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _klines_ws_lock:
            _klines_ws_subs[:] = [s for s in _klines_ws_subs if s["websocket"] != websocket]


@api_router.websocket("/admin/ws/trades/recent")
async def ws_admin_trades_recent(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    x_admin_key: Optional[str] = Query(None, alias="x_admin_key"),
    symbol: Optional[str] = Query(None),
    uid: Optional[str] = Query(None),
    liquidity_source: Optional[str] = Query(None, description="all|system|user|binance"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    if db is None:
        await websocket.close(code=1011)
        return
    admin_doc = await _admin_doc_from_ws_auth(token, x_admin_key)
    if not admin_doc:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    sub = {
        "websocket": websocket,
        "symbol": (symbol or "").strip() or None,
        "uid": (uid or "").strip() or None,
        "liquidity_source": (liquidity_source or "").strip() or None,
        "date_from": date_from or None,
        "date_to": date_to or None,
        "sort_by": (sort_by or "").strip() or None,
        "sort_dir": (sort_dir or "").strip() or None,
        "skip": skip,
        "limit": limit,
    }
    try:
        payload = await _admin_recent_trades_payload(
            sub["symbol"], sub["uid"], sub["liquidity_source"], sub["date_from"], sub["date_to"],
            sub["skip"], sub["limit"], sub["sort_by"], sub["sort_dir"],
        )
        payload["type"] = "recent_trades"
        await websocket.send_json(payload)
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws trades/recent: client gone before initial snapshot (%s)", e)
            return
        logger.exception("ws trades/recent initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _recent_trades_ws_lock:
        _recent_trades_ws_subs.append(sub)
    await _ensure_recent_trades_ws_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _recent_trades_ws_lock:
            _recent_trades_ws_subs[:] = [s for s in _recent_trades_ws_subs if s["websocket"] != websocket]


@api_router.websocket("/admin/ws/stats-overview")
async def ws_admin_stats_overview(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    x_admin_key: Optional[str] = Query(None, alias="x_admin_key"),
):
    if db is None:
        await websocket.close(code=1011)
        return
    admin_doc = await _admin_doc_from_ws_auth(token, x_admin_key)
    if not admin_doc:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        stats = await _compute_admin_stats_overview()
        await websocket.send_json({
            "type": "stats_overview",
            "stats": stats,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws stats-overview: client gone before initial snapshot (%s)", e)
            return
        logger.exception("ws stats-overview initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _stats_overview_ws_lock:
        _stats_overview_ws_subs.append(websocket)
    await _ensure_stats_overview_ws_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _stats_overview_ws_lock:
            _stats_overview_ws_subs[:] = [w for w in _stats_overview_ws_subs if w != websocket]


class UserAdminPatch(BaseModel):
    is_active:                Optional[bool] = None
    admin_notes:              Optional[str] = Field(None, max_length=4000)
    user_features_paused:    Optional[bool] = None
    user_trading_paused:      Optional[bool] = None
    user_withdrawals_paused: Optional[bool] = None
    user_pause_note:          Optional[str] = Field(None, max_length=500)


@api_router.patch("/admin/users/{uid}")
async def admin_patch_user(
    uid: str,
    body: UserAdminPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    user = await db.users.find_one({"uid": uid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    sensitive = any(
        v is not None
        for v in (
            body.is_active,
            body.user_features_paused,
            body.user_trading_paused,
            body.user_withdrawals_paused,
        )
    )
    if sensitive:
        _require_privileged_ops_admin(auth)
    else:
        _require_admin_permission(auth, "manage_users")
    updates: Dict[str, Any] = {}
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.admin_notes is not None:
        updates["admin_notes"] = body.admin_notes.strip()
    if body.user_features_paused is not None:
        updates["user_features_paused"] = body.user_features_paused
    if body.user_trading_paused is not None:
        updates["user_trading_paused"] = body.user_trading_paused
    if body.user_withdrawals_paused is not None:
        updates["user_withdrawals_paused"] = body.user_withdrawals_paused
    if body.user_pause_note is not None:
        updates["user_pause_note"] = body.user_pause_note.strip()
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    await db.users.update_one({"uid": uid}, {"$set": updates})
    await log_admin_audit(auth, "user_patch", "user", uid, {"updates": list(updates.keys())})
    u2 = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    return {
        "ok": True,
        "user": {
            **user_doc_to_out(u2).model_dump(),
            "is_active":                u2.get("is_active", True),
            "admin_notes":              u2.get("admin_notes") or "",
            "user_features_paused":     bool(u2.get("user_features_paused", False)),
            "user_trading_paused":      bool(u2.get("user_trading_paused", False)),
            "user_withdrawals_paused":  bool(u2.get("user_withdrawals_paused", False)),
            "user_pause_note":          u2.get("user_pause_note") or "",
        },
    }


@api_router.post("/admin/users/{uid}/account-freeze")
async def admin_account_freeze(
    uid: str,
    body: AccountFreezeBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)
    user = await db.users.find_one({"uid": uid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    now = datetime.now(timezone.utc).isoformat()
    aid = (auth.admin or {}).get("aid")
    scope = body.scope.strip()
    updates: Dict[str, Any] = {
        "account_frozen_at": now,
        "account_frozen_by": aid,
        "account_frozen_reason": body.reason.strip(),
        "account_frozen_until": (body.frozen_until or "").strip() or None,
        "account_frozen_scope": scope,
        "user_pause_note": body.reason.strip(),
    }
    if scope == "full":
        updates["user_features_paused"] = True
        updates["user_trading_paused"] = True
        updates["user_withdrawals_paused"] = True
    elif scope == "trading":
        updates["user_trading_paused"] = True
    else:
        updates["user_withdrawals_paused"] = True
    await db.users.update_one({"uid": uid}, {"$set": updates})
    await compliance_service.record_account_restriction_event(
        db,
        uid=uid,
        action="freeze",
        scope=scope,
        reason=body.reason.strip(),
        admin_aid=aid,
        frozen_until=updates.get("account_frozen_until"),
    )
    await log_admin_audit(auth, "account_freeze", "user", uid, {"scope": scope})
    u2 = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": u2}


@api_router.post("/admin/users/{uid}/account-unfreeze")
async def admin_account_unfreeze(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)
    user = await db.users.find_one({"uid": uid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    scope = str(user.get("account_frozen_scope") or "full")
    updates: Dict[str, Any] = {
        "account_frozen_at": None,
        "account_frozen_by": None,
        "account_frozen_reason": None,
        "account_frozen_until": None,
        "account_frozen_scope": None,
        "user_pause_note": "",
    }
    if scope == "full":
        updates["user_features_paused"] = False
        updates["user_trading_paused"] = False
        updates["user_withdrawals_paused"] = False
    elif scope == "trading":
        updates["user_trading_paused"] = False
    else:
        updates["user_withdrawals_paused"] = False
    await db.users.update_one({"uid": uid}, {"$set": updates})
    await compliance_service.record_account_restriction_event(
        db,
        uid=uid,
        action="unfreeze",
        scope=scope,
        reason="admin_unfreeze",
        admin_aid=(auth.admin or {}).get("aid"),
    )
    await log_admin_audit(auth, "account_unfreeze", "user", uid, {"scope": scope})
    u2 = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "user": u2}


class AdminPasswordResetRequestBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note: Optional[str] = Field(None, max_length=300)


@api_router.post("/admin/users/{uid}/force-logout")
async def admin_force_logout_user(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Invalidate every access + refresh token for the user (sessions_epoch++)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)
    user = await db.users.find_one({"uid": uid}, {"_id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    res = await db.users.find_one_and_update(
        {"uid": uid},
        {"$inc": {"sessions_epoch": 1}},
        projection={"_id": 0, "sessions_epoch": 1},
        return_document=ReturnDocument.AFTER,
    )
    new_epoch = int((res or {}).get("sessions_epoch") or 1)
    await db.refresh_tokens.delete_many({"uid": uid})
    await log_admin_audit(
        auth,
        "user_force_logout",
        "user",
        uid,
        {"new_sessions_epoch": new_epoch},
    )
    return {"ok": True, "sessions_epoch": new_epoch}


@api_router.post("/admin/users/{uid}/2fa/reset")
async def admin_reset_user_2fa(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Remove the user's TOTP enrollment and backup codes."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)
    user = await db.users.find_one({"uid": uid}, {"_id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    result = await db.user_2fa.delete_many({"uid": uid})
    await log_admin_audit(
        auth,
        "user_2fa_reset",
        "user",
        uid,
        {"deleted": int(result.deleted_count)},
    )
    return {"ok": True, "deleted": int(result.deleted_count)}


@api_router.post("/admin/users/{uid}/password-reset-request")
async def admin_request_password_reset_email(
    uid: str,
    body: AdminPasswordResetRequestBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Trigger the same email-based reset flow as ``/auth/forgot-password``."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)
    if not password_reset_service.smtp_configured():
        raise HTTPException(
            status_code=503,
            detail="SMTP is not configured (set SMTP_HOST, SMTP_USER, …). Cannot send reset email.",
        )
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "uid": 1, "email": 1, "name": 1})
    if not user or not user.get("email"):
        raise HTTPException(status_code=404, detail="User not found")
    plain, rid = await password_reset_service.issue_token(
        db,
        uid=user["uid"],
        email=str(user["email"]),
        admin_triggered=True,
    )
    link = password_reset_service.build_reset_link(plain)
    sent = await password_reset_service.send_password_reset_email(str(user["email"]), link, name=user.get("name") or "")
    if not sent:
        await db.password_reset_tokens.delete_one({"id": rid})
        raise HTTPException(status_code=500, detail="Failed to send password reset email.")
    await log_admin_audit(
        auth,
        "user_password_reset_email",
        "user",
        uid,
        {"note": (body.note or "").strip() or None},
    )
    return {"ok": True, "message": "Password reset email sent."}


@api_router.get("/admin/users/{uid}/wallet-txns")
async def admin_user_wallet_txns(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    asset: Optional[str] = None,
    type: Optional[str] = None,
    ref_id: Optional[str] = None,
    ref_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Per-user slice of ``wallet_txns`` (read-only)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_users")
    user = await db.users.find_one({"uid": uid}, {"_id": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    ttype = None
    if type:
        ttype = type.strip().lower()
        if ttype not in _USER_LEDGER_TYPES:
            raise HTTPException(400, f"Unknown transaction type: {type}")
    items = await wallet_service.list_txns(
        uid=uid,
        asset=asset,
        txn_type=ttype,
        ref_id=(ref_id or "").strip() or None,
        ref_type=(ref_type or "").strip() or None,
        date_from=date_from,
        date_to=date_to,
        skip=skip,
        limit=limit,
    )
    total = await wallet_service.count_txns(
        uid=uid,
        asset=asset,
        txn_type=ttype,
        ref_id=(ref_id or "").strip() or None,
        ref_type=(ref_type or "").strip() or None,
        date_from=date_from,
        date_to=date_to,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.get("/admin/users/{uid}/sessions")
async def admin_user_sessions(
    uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Active refresh-token rows + current ``sessions_epoch`` (jti redacted)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_users")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "sessions_epoch": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    cur = (
        db.refresh_tokens.find({"uid": uid}, {"_id": 0, "jti": 1, "epoch": 1, "created_at": 1, "expires_at": 1})
        .sort("created_at", -1)
        .limit(100)
    )
    raw = await cur.to_list(100)
    sessions: List[Dict[str, Any]] = []
    for r in raw:
        jti = str(r.get("jti") or "")
        mask = f"{jti[:10]}…{jti[-4:]}" if len(jti) > 16 else "(redacted)"
        exp = r.get("expires_at")
        exp_out = exp.isoformat() if hasattr(exp, "isoformat") else exp
        sessions.append({
            "jti_masked": mask,
            "epoch":      int(r.get("epoch") or 0),
            "created_at": r.get("created_at"),
            "expires_at": exp_out,
        })
    return {
        "uid": uid,
        "sessions_epoch": int(user.get("sessions_epoch") or 0),
        "refresh_sessions": sessions,
    }


@api_router.post("/admin/users/{uid}/wallet-adjustments")
async def admin_adjust_user_wallet(
    uid: str,
    body: WalletAdjustmentCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_wallet_adjust_permission(auth)
    _require_admin_jwt_not_apikey(auth)
    user = await db.users.find_one({"uid": uid}, {"_id": 1, "uid": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    asset = body.asset.strip().upper()
    if asset not in SUPPORTED_ASSETS:
        raise HTTPException(status_code=400, detail=f"Unsupported asset: {asset}")

    now = datetime.now(timezone.utc).isoformat()
    amount = float(body.amount)
    direction = body.direction
    signed_delta = amount if direction == "credit" else -amount
    adj_id = f"wadj_{uuid.uuid4().hex[:12]}"
    note = (body.note or "").strip()

    # Read current wallet snapshot for the legacy adjustment record.
    before_doc = await db.wallets.find_one({"uid": uid, "asset": asset}, {"_id": 0, "available": 1, "locked": 1})
    before_available = float((before_doc or {}).get("available", 0.0))
    before_locked = float((before_doc or {}).get("locked", 0.0))

    # Route the balance change through the ledger so a matching wallet_txns
    # row is written atomically (type="adjustment", direction=credit/debit,
    # ref = adjustment id). The wallet_adjustments collection is kept so
    # existing admin UI queries stay intact.
    meta = {
        "note": note,
        "admin_aid": (auth.admin or {}).get("aid"),
        "admin_email": (auth.admin or {}).get("email"),
        "source": "api_key" if auth.via_api_key else "jwt",
    }
    try:
        if direction == "debit":
            ledger_doc = await wallet_service.debit(
                uid, asset, amount,
                txn_type="adjustment",
                ref_type="wallet_adjustment", ref_id=adj_id,
                meta=meta,
            )
        else:
            ledger_doc = await wallet_service.credit(
                uid, asset, amount,
                txn_type="adjustment",
                ref_type="wallet_adjustment", ref_id=adj_id,
                meta=meta,
            )
    except InsufficientFundsError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient {asset} available balance ({exc.have:.8f}) for debit {amount:.8f}",
        )

    after_available = float(ledger_doc.get("balance_after", {}).get("available", 0.0))
    after_locked = float(ledger_doc.get("balance_after", {}).get("locked", 0.0))

    rec = {
        "id": adj_id,
        "uid": uid,
        "asset": asset,
        "direction": direction,
        "amount": round(amount, 8),
        "delta": round(signed_delta, 8),
        "balance_before": round(before_available, 8),
        "balance_after": round(after_available, 8),
        "locked_before": round(before_locked, 8),
        "locked_after": round(after_locked, 8),
        "note": note,
        "admin_aid": (auth.admin or {}).get("aid"),
        "admin_email": (auth.admin or {}).get("email"),
        "source": "api_key" if auth.via_api_key else "jwt",
        "created_at": now,
        "wallet_txn_id": ledger_doc.get("id"),
    }
    await db.wallet_adjustments.insert_one(rec)
    rec.pop("_id", None)
    await log_admin_audit(
        auth,
        "wallet_adjustment",
        "wallet_adjustment",
        adj_id,
        {"uid": uid, "asset": asset, "direction": direction, "amount": amount},
    )
    return {"ok": True, "item": rec}


@api_router.post("/admin/users/{uid}/orders", response_model=OrderOut, status_code=201)
async def admin_place_order_for_user(
    uid: str,
    body: OrderCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_users")
    _require_admin_jwt_not_apikey(auth)
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "uid": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await enforce_feature("trading_enabled", "Trading is currently paused by admin")
    out = await _execute_place_order(uid, body)
    await log_admin_audit(
        auth, "admin_place_order_for_user", "user", uid,
        {"symbol": body.symbol, "side": body.side, "type": body.type, "amount": body.amount},
    )
    return out


async def _close_position_for_uid(uid: str, body: ClosePositionBody) -> OrderOut:
    if db is None:
        raise HTTPException(503, "Database unavailable")
    sym = body.symbol.upper()
    if sym not in SYMBOL_BASE_MAP:
        raise HTTPException(400, f"Unsupported symbol: {sym}")

    ot = (body.order_type or "market").lower()
    if ot not in ("market", "limit"):
        raise HTTPException(400, "order_type must be 'market' or 'limit'")
    if ot == "limit" and (body.price is None or body.price <= 0):
        raise HTTPException(400, "Limit close requires a positive price")
    if body.amount is not None and body.fraction is not None:
        raise HTTPException(400, "Specify only one of 'amount' or 'fraction', not both")

    base_asset = SYMBOL_BASE_MAP[sym]
    wallet = await db.wallets.find_one({"uid": uid, "asset": base_asset})
    available = float((wallet or {}).get("available", 0.0))

    if body.amount is not None:
        sell_amount = min(body.amount, available)
    elif body.fraction is not None:
        sell_amount = available * body.fraction
    else:
        sell_amount = available

    sell_amount = _safe_sell_base_qty(sell_amount, available)
    if sell_amount < MIN_BASE_AMOUNT:
        raise HTTPException(
            400,
            f"No closable size: need at least {MIN_BASE_AMOUNT} {base_asset} available "
            f"(have {available:.8f}). Cancel open sell orders if coins are locked.",
        )

    market_price = await get_current_price(sym)
    ref_px = float(body.price) if ot == "limit" and body.price else market_price
    if sell_amount * ref_px < MIN_ORDER_VALUE_USDT_CLOSE:
        raise HTTPException(
            400,
            f"Order value is below minimum (${MIN_ORDER_VALUE_USDT_CLOSE:.2f} USDT). "
            "Increase size or wait for price movement.",
        )

    close_body = OrderCreate(
        symbol=sym,
        side="sell",
        type="limit" if ot == "limit" else "market",
        amount=sell_amount,
        price=float(body.price) if ot == "limit" else None,
    )
    return await _execute_place_order(
        uid, close_body, min_order_value_usdt=MIN_ORDER_VALUE_USDT_CLOSE,
    )


@api_router.get("/admin/wallet-adjustments")
async def admin_list_wallet_adjustments(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    uid: Optional[str] = None,
    q: Optional[str] = None,
    asset: Optional[str] = None,
    direction: Optional[str] = None,
    admin_aid: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_wallet_adjust_permission(auth)
    _require_admin_jwt_not_apikey(auth)
    filt: Dict[str, Any] = {}
    if uid:
        filt["uid"] = uid.strip()
    if asset:
        filt["asset"] = asset.strip().upper()
    if direction:
        d = direction.strip().lower()
        if d not in ("credit", "debit"):
            raise HTTPException(status_code=400, detail="direction must be credit or debit")
        filt["direction"] = d
    if admin_aid:
        filt["admin_aid"] = admin_aid.strip()
    if q and q.strip():
        qv = q.strip()
        rx = {"$regex": re.escape(qv), "$options": "i"}
        filt["$or"] = [{"uid": rx}, {"asset": rx}, {"admin_email": rx}, {"note": rx}, {"id": rx}]
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        filt["created_at"] = dr

    wsf = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "amount": "amount",
        "asset": "asset",
        "direction": "direction",
        "id": "id",
        "uid": "uid",
    }, "created_at")
    cur = db.wallet_adjustments.find(filt, {"_id": 0}).sort(wsf, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.wallet_adjustments.count_documents(filt)
    stats_rows = await db.wallet_adjustments.aggregate([
        {"$match": filt},
        {"$group": {
            "_id": "$direction",
            "amount_total": {"$sum": "$amount"},
            "delta_total": {"$sum": "$delta"},
        }},
    ]).to_list(10)
    stats = {"credit_total": 0.0, "debit_total": 0.0, "net_delta": 0.0}
    for row in stats_rows:
        if row.get("_id") == "credit":
            stats["credit_total"] = float(row.get("amount_total", 0.0))
        elif row.get("_id") == "debit":
            stats["debit_total"] = float(row.get("amount_total", 0.0))
        stats["net_delta"] += float(row.get("delta_total", 0.0))

    stats["credit_total"] = round(stats["credit_total"], 8)
    stats["debit_total"] = round(stats["debit_total"], 8)
    stats["net_delta"] = round(stats["net_delta"], 8)
    return {"items": items, "total": total, "skip": skip, "limit": limit, "stats": stats}


@api_router.get("/admin/wallet-txns")
async def admin_list_wallet_txns(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    uid: Optional[str] = None,
    asset: Optional[str] = None,
    type: Optional[str] = None,
    ref_id: Optional[str] = None,
    ref_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Admin-wide ledger query (``wallet_txns``). Read-only."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_ledger")
    ttype = None
    if type:
        ttype = type.strip().lower()
        if ttype not in _USER_LEDGER_TYPES:
            raise HTTPException(400, f"Unknown transaction type: {type}")
    items = await wallet_service.list_txns(
        uid=(uid or "").strip() or None,
        asset=asset,
        txn_type=ttype,
        ref_id=(ref_id or "").strip() or None,
        ref_type=(ref_type or "").strip() or None,
        date_from=date_from,
        date_to=date_to,
        skip=skip,
        limit=limit,
    )
    total = await wallet_service.count_txns(
        uid=(uid or "").strip() or None,
        asset=asset,
        txn_type=ttype,
        ref_id=(ref_id or "").strip() or None,
        ref_type=(ref_type or "").strip() or None,
        date_from=date_from,
        date_to=date_to,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.get("/admin/wallet-txns/export")
async def admin_export_wallet_txns_csv(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    uid: Optional[str] = None,
    asset: Optional[str] = None,
    type: Optional[str] = None,
    ref_id: Optional[str] = None,
    ref_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    max_rows: int = Query(10_000, ge=1, le=50_000),
):
    """Download ``wallet_txns`` as CSV (same filters as ``GET /admin/wallet-txns``)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission_any(auth, ("view_ledger", "export_finance"))
    ttype = None
    if type:
        ttype = type.strip().lower()
        if ttype not in _USER_LEDGER_TYPES:
            raise HTTPException(400, f"Unknown transaction type: {type}")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "id", "uid", "asset", "type", "direction", "amount", "status",
        "ref_type", "ref_id", "created_at",
        "avail_before", "locked_before", "avail_after", "locked_after",
    ])
    fetched = 0
    batch = 500
    skip = 0
    while fetched < max_rows:
        take = min(batch, max_rows - fetched)
        chunk = await wallet_service.list_txns(
            uid=(uid or "").strip() or None,
            asset=asset,
            txn_type=ttype,
            ref_id=(ref_id or "").strip() or None,
            ref_type=(ref_type or "").strip() or None,
            date_from=date_from,
            date_to=date_to,
            skip=skip,
            limit=take,
        )
        if not chunk:
            break
        for row in chunk:
            bb = row.get("balance_before") or {}
            ba = row.get("balance_after") or {}
            w.writerow([
                row.get("id"),
                row.get("uid"),
                row.get("asset"),
                row.get("type"),
                row.get("direction"),
                row.get("amount"),
                row.get("status"),
                row.get("ref_type"),
                row.get("ref_id"),
                row.get("created_at"),
                (bb.get("available") if isinstance(bb, dict) else ""),
                (bb.get("locked") if isinstance(bb, dict) else ""),
                (ba.get("available") if isinstance(ba, dict) else ""),
                (ba.get("locked") if isinstance(ba, dict) else ""),
            ])
        fetched += len(chunk)
        skip += len(chunk)
        if len(chunk) < take:
            break
    buf.seek(0)
    filename = f"wallet_txns_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Phase 4 — ``GET /admin/deposits`` removed. Deposits are now purely
# blockchain-driven; admin tracking lives under ``/admin/deposit-events``
# (list) and ``/admin/deposit-addresses`` (HD-address tracker).


@api_router.get("/admin/deposit-events")
async def admin_list_deposit_events(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    status: Optional[str] = None,
    uid: Optional[str] = None,
    asset: Optional[str] = None,
    network: Optional[str] = None,
    address: Optional[str] = None,
    tx_hash: Optional[str] = None,
    source: Optional[str] = Query(None, description="signup_bonus | onchain (regular deposits) | leave blank for all"),
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Admin view into blockchain deposit sightings (``deposit_events``).

    This is the replacement for the old ``/admin/deposits`` endpoint. The
    rows here are system-generated by the poller — there is no manual
    approve/reject. When the crediter promotes a row, ``credited_at`` and
    related fields are written on the event document.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_withdrawals")
    filt: Dict[str, Any] = {}
    if status:
        filt["status"] = status.strip().lower()
    if uid:
        filt["uid"] = uid.strip()
    if asset:
        filt["asset"] = asset.strip().upper()
    if network:
        filt["network"] = network.strip()
    if address:
        filt["address"] = address.strip()
    if tx_hash:
        filt["tx_hash"] = tx_hash.strip()
    qq = (q or "").strip()
    if qq:
        rx = {"$regex": re.escape(qq), "$options": "i"}
        filt["$or"] = [
            {"asset": rx},
            {"network": rx},
        ]
    src = (source or "").strip().lower()
    if src == "signup_bonus":
        filt["source"] = "signup_bonus"
    elif src in ("onchain", "deposit"):
        filt["source"] = {"$ne": "signup_bonus"}
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        filt["created_at"] = dr
    cur = db.deposit_events.find(filt, {"_id": 0, "raw": 0}).sort(
        "created_at", -1,
    ).skip(int(skip)).limit(int(limit))
    items = await cur.to_list(limit)
    total = await db.deposit_events.count_documents(filt)
    # Phase 5 — include the resolved confirmation threshold for each row
    # so the admin UI can render "5/12 (credited)" / "1/12 (confirming)".
    controls = await get_platform_controls()
    _thr_cache: Dict[str, int] = {}
    for row in items:
        ast = (row.get("asset") or "").upper()
        if ast not in _thr_cache:
            _thr_cache[ast] = resolve_min_confirmations(controls, ast)
        row["threshold"] = _thr_cache[ast]
    return {"items": items, "total": total, "skip": skip, "limit": limit}


class AdminDepositCreditBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    # Optional override of the credited amount (defaults to the observed
    # on-chain amount). Can only be smaller or equal — admins cannot
    # credit more than the chain reported.
    amount: Optional[float] = Field(None, gt=0.0)
    note: Optional[str] = Field(None, max_length=300)


@api_router.post("/admin/deposit-events/rescan-listed")
async def admin_rescan_listed_deposits(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Re-scan recent blocks for listed ERC-20/BEP-20 tokens and repair orphan rows."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_withdrawals")
    from workers.deposit_poller import rescan_listed_token_deposits

    result = await rescan_listed_token_deposits(db)
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("detail") or "Rescan failed")
    await log_admin_audit(auth, "deposit_rescan_listed", "deposit_events", "listed", result)
    return result


@api_router.post("/admin/deposit-events/{event_id}/credit")
async def admin_credit_deposit_event(
    event_id: str,
    body: AdminDepositCreditBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Phase 5 — manually credit a ``deposit_events`` row.

    Exists for edge cases where the automated crediter cannot promote a
    sighting on its own:

    - ``pending_kyc`` rows where KYC was subsequently approved offline.
    - ``below_min`` rows the operator decides to credit anyway.
    - ``pending`` rows stuck because auto-credit is disabled in
      ``platform_controls``.

    Safety:

    - Fully atomic — uses the same ``crediting`` lock as the worker so
      the two can never race.
    - Idempotent — already-``credited`` or ``reorg_review`` rows are
      rejected outright, no double-credit possible.
    - Writes a ``wallet_txns`` row like any other deposit, with
      ``ref_type="deposit_event"`` and ``meta.admin_override=True``.
    - Emits an ``admin_audit`` entry capturing the actor and optional note.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_treasury")

    event = await db.deposit_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Deposit event not found")

    status = (event.get("status") or "").lower()
    if status in ("credited", "crediting", "reorg_review"):
        raise HTTPException(
            status_code=409,
            detail=f"Deposit event is already in terminal state '{status}'",
        )

    uid = (event.get("uid") or "").strip()
    asset = (event.get("asset") or "").upper()
    observed = float(event.get("amount") or 0.0)
    if not uid:
        raise HTTPException(status_code=400, detail="Event has no user mapping (orphan)")
    if observed <= 0:
        raise HTTPException(status_code=400, detail="Event amount is zero or negative")

    amount = float(body.amount) if body.amount is not None else observed
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Credit amount must be > 0")
    if amount > observed + 1e-12:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot credit more than observed amount ({observed})",
        )

    # Reserve the row — same lock the background worker uses.
    reserved = await db.deposit_events.find_one_and_update(
        {"id": event_id, "status": {"$in": ["pending", "confirming", "pending_kyc", "below_min"]}},
        {"$set": {
            "status": "crediting",
            "crediting_started_at": datetime.now(timezone.utc).isoformat(),
        }},
        return_document=ReturnDocument.BEFORE,
    )
    if reserved is None:
        raise HTTPException(
            status_code=409,
            detail="Deposit event is no longer eligible for crediting",
        )
    prev_status = (reserved.get("status") or "pending").lower()

    try:
        txn = await wallet_service.credit(
            uid, asset, amount,
            txn_type="deposit",
            ref_type="deposit_event",
            ref_id=event_id,
            meta={
                "tx_hash": event.get("tx_hash"),
                "network": event.get("network"),
                "address": event.get("address"),
                "confirmations": int(event.get("confirmations") or 0),
                "block_height": event.get("block_height"),
                "admin_override": True,
                "admin_aid": auth.admin.get("aid") if auth.admin else None,
                "note": (body.note or None),
                "observed_amount": observed,
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("admin_credit_deposit_event: wallet credit failed for %s", event_id)
        await db.deposit_events.update_one(
            {"id": event_id, "status": "crediting"},
            {"$set": {
                "status": prev_status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(
            status_code=500,
            detail=f"Wallet credit failed: {exc}",
        )

    try:
        await treasury_service.record_custody_deposit(
            asset,
            amount,
            ref_type="deposit_event",
            ref_id=event_id,
            meta={
                "uid": uid,
                "tx_hash": event.get("tx_hash"),
                "admin_override": True,
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("admin_credit_deposit_event: treasury custody mirror failed for %s", event_id)

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.deposit_events.update_one(
        {"id": event_id, "status": "crediting"},
        {"$set": {
            "status": "credited",
            "credited_at": now_iso,
            "credited_amount": amount,
            "credited_block_height": event.get("block_height"),
            "wallet_txn_id": txn.get("id") if isinstance(txn, dict) else None,
            "admin_override": True,
            "updated_at": now_iso,
        }},
    )
    await log_admin_audit(
        auth,
        "deposit_event_manual_credit",
        "deposit_events",
        event_id,
        {
            "uid": uid,
            "asset": asset,
            "amount": amount,
            "observed_amount": observed,
            "prev_status": prev_status,
            "note": body.note,
        },
    )

    refreshed = await db.deposit_events.find_one({"id": event_id}, {"_id": 0, "raw": 0})
    return {
        "ok": True,
        "event": refreshed,
        "wallet_txn_id": txn.get("id") if isinstance(txn, dict) else None,
    }


@api_router.get("/admin/deposit-addresses", response_model=List[DepositAddressAdminOut])
async def admin_list_deposit_addresses(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    asset: Optional[str] = None,
    network: Optional[str] = None,
    uid: Optional[str] = None,
    owner: Optional[str] = Query(
        None,
        description="Filter by row type: 'user' (uid set, HD-derived), 'shared' (admin-curated), or 'all'.",
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
):
    """List deposit addresses (Phase 3: supports uid + owner filters + pagination)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_treasury")
    filt: Dict[str, Any] = {}
    if asset:
        filt["asset"] = asset.strip().upper()
    if network:
        filt["network"] = network.strip()
    if uid:
        filt["uid"] = uid.strip()
    if owner:
        o = owner.strip().lower()
        if o == "user":
            filt["uid"] = filt.get("uid") or {"$exists": True, "$ne": None}
        elif o == "shared":
            if "uid" in filt and filt["uid"] and filt["uid"] != {"$exists": True, "$ne": None}:
                raise HTTPException(
                    status_code=400,
                    detail="owner=shared is incompatible with an explicit uid filter",
                )
            filt["$or"] = [{"uid": {"$exists": False}}, {"uid": None}]
            filt.pop("uid", None)
    rows = await db.deposit_addresses.find(filt, {"_id": 0}).sort(
        [("asset", 1), ("network", 1), ("sort_order", 1), ("created_at", -1)]
    ).skip(int(skip)).to_list(int(limit))
    return [_deposit_address_admin_out(d) for d in rows]


@api_router.get(
    "/admin/deposit-addresses/by-user/{target_uid}",
    response_model=List[DepositAddressAdminOut],
)
async def admin_list_user_deposit_addresses(
    target_uid: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    asset: Optional[str] = None,
    network: Optional[str] = None,
):
    """All HD-derived deposit addresses issued to a single user.

    Admin-only tracking endpoint — used by the admin panel to audit which
    addresses belong to which user, what asset/network they're for, and
    the derivation path used to generate them. Private keys are never
    exposed here.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    # User Management admins need this on the user detail Wallets tab;
    # treasury viewers keep access for audits.
    _require_admin_permission_any(auth, ("view_users", "manage_users", "view_treasury"))
    filt: Dict[str, Any] = {"uid": target_uid.strip(), "provider": {"$ne": "admin"}}
    if asset:
        filt["asset"] = asset.strip().upper()
    if network:
        filt["network"] = network.strip()
    rows = await db.deposit_addresses.find(filt, {"_id": 0}).sort(
        [("asset", 1), ("network", 1), ("created_at", -1)]
    ).to_list(500)
    return [_deposit_address_admin_out(d) for d in rows]


# Phase 4 — admin shared-deposit-address CRUD (POST / PATCH / DELETE) has
# been removed. The platform now only uses HD-derived per-user addresses
# generated by ``/api/wallet/deposit-addresses``. The GET list endpoints
# above still expose every row in ``deposit_addresses`` for admin auditing.
#
# ``GET /admin/withdrawals`` has been superseded by the on-chain withdrawal
# queue (``withdrawal_requests`` + executor). Global deposit sightings live
# under ``GET /admin/deposit-events``.


@api_router.get("/admin/audit-logs")
async def admin_list_audit_logs(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action: Optional[str] = None,
    admin_aid: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    source: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_system_logs")
    clauses: List[Dict[str, Any]] = []
    if action:
        clauses.append({"action": action})
    if admin_aid:
        # Backward compatibility: older audit rows used ``actor_aid``.
        clauses.append({"$or": [{"admin_aid": admin_aid}, {"actor_aid": admin_aid}]})
    if source:
        src = source.strip().lower()
        # Backward compatibility: older system rows used ``actor_type`` only.
        if src == "system":
            clauses.append({"$or": [{"source": "system"}, {"actor_type": "system"}]})
        elif src == "jwt":
            clauses.append({"$or": [{"source": "jwt"}, {"actor_type": "admin"}]})
        elif src == "api_key":
            clauses.append({"source": "api_key"})
        else:
            clauses.append({"source": src})
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        clauses.append({"created_at": dr})
    filt: Dict[str, Any] = {"$and": clauses} if len(clauses) > 1 else (clauses[0] if clauses else {})
    asf = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "action": "action",
        "admin_aid": "admin_aid",
        "target_id": "target_id",
    }, "created_at")
    cur = db.admin_audit_logs.find(filt, {"_id": 0}).sort(asf, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.admin_audit_logs.count_documents(filt)
    return {
        "items": items, "total": total, "skip": skip, "limit": limit,
        "stats": {"source_filter": source or "all"},
    }


@api_router.get("/admin/security/dashboard")
async def admin_security_dashboard(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_security")
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    failed_user = await db.security_events.count_documents({
        "type": {"$in": ["auth.login_failed", "auth.blocked"]},
        "created_at": {"$gte": since},
    })
    failed_admin = await db.security_events.count_documents({
        "type": {"$in": ["admin.login_failed", "admin.blocked"]},
        "created_at": {"$gte": since},
    })
    active_blocks = await db.security_blocks.count_documents({"is_active": True})
    rate_limit_rows = await db.rate_limits.aggregate([
        {"$match": {"window_start": {"$gte": int(time.time()) - 86400}}},
        {"$group": {"_id": "$scope", "hits": {"$sum": "$count"}}},
        {"$sort": {"hits": -1}},
        {"$limit": 20},
    ]).to_list(20)
    return {
        "window": "24h",
        "failed_user_logins": int(failed_user),
        "failed_admin_logins": int(failed_admin),
        "active_blocks": int(active_blocks),
        "rate_limit_hits_by_scope": [
            {"scope": r.get("_id"), "hits": int(r.get("hits") or 0)} for r in rate_limit_rows
        ],
    }


@api_router.get("/admin/security/blocks")
async def admin_list_security_blocks(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    type: Optional[str] = None,
    is_active: Optional[bool] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_security")
    filt: Dict[str, Any] = {}
    if type:
        filt["type"] = type.strip().lower()
    if is_active is not None:
        filt["is_active"] = bool(is_active)
    cur = db.security_blocks.find(filt, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.security_blocks.count_documents(filt)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.post("/admin/security/blocks", status_code=201)
async def admin_create_security_block(
    body: SecurityBlockCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_security_blocks")
    now = datetime.now(timezone.utc).isoformat()
    norm_type = body.type.strip().lower()
    norm_val = body.value.strip().upper() if norm_type == "country" else body.value.strip()
    existing = await db.security_blocks.find_one({"type": norm_type, "value": norm_val})
    if existing:
        raise HTTPException(status_code=409, detail="Security block already exists for this value.")
    row = {
        "id": f"blk_{uuid.uuid4().hex[:16]}",
        "type": norm_type,
        "value": norm_val,
        "is_active": True,
        "reason": body.reason or "",
        "created_at": now,
        "updated_at": now,
        "created_by": (auth.admin or {}).get("aid"),
    }
    await db.security_blocks.insert_one(row)
    await log_admin_audit(auth, "security_block_create", "security_block", row["id"], {
        "type": row["type"], "value": row["value"], "reason": row["reason"],
    })
    return row


@api_router.patch("/admin/security/blocks/{block_id}")
async def admin_patch_security_block(
    block_id: str,
    body: SecurityBlockPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_security_blocks")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.security_blocks.find_one_and_update(
        {"id": block_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
    if res is None:
        raise HTTPException(status_code=404, detail="Security block not found")
    await log_admin_audit(auth, "security_block_patch", "security_block", block_id, {"updates": updates})
    res.pop("_id", None)
    return res


@api_router.get("/admin/system-logs")
async def admin_system_logs(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    source: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_system_logs")
    lim = min(max(int(limit), 1), 200)
    q = (search or "").strip().lower()
    src = (source or "").strip().lower()
    rows: List[Dict[str, Any]] = []

    if src in ("", "audit"):
        cur = db.admin_audit_logs.find({}, {"_id": 0}).sort("created_at", -1).limit(lim)
        for r in await cur.to_list(lim):
            rows.append({
                "id": r.get("id"),
                "created_at": r.get("created_at"),
                "source": "audit",
                "type": r.get("action"),
                "severity": "info",
                "message": f"{r.get('action')} {r.get('target_type') or ''}:{r.get('target_id') or ''}".strip(),
                "meta": r,
            })
    if src in ("", "security"):
        cur = db.security_events.find({}, {"_id": 0}).sort("created_at", -1).limit(lim)
        for r in await cur.to_list(lim):
            rows.append({
                "id": r.get("id"),
                "created_at": r.get("created_at"),
                "source": "security",
                "type": r.get("type"),
                "severity": r.get("severity") or "warn",
                "message": r.get("message") or "",
                "meta": r.get("meta") or {},
            })
    if src in ("", "alerts"):
        cur = db.alerts.find({}, {"_id": 0}).sort("last_seen_at", -1).limit(lim)
        for r in await cur.to_list(lim):
            rows.append({
                "id": r.get("id"),
                "created_at": r.get("last_seen_at") or r.get("created_at"),
                "source": "alerts",
                "type": r.get("type"),
                "severity": r.get("severity") or "info",
                "message": r.get("title") or "",
                "meta": {"status": r.get("status"), "occurrences": r.get("occurrences")},
            })
    rows.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    if q:
        rows = [
            r for r in rows
            if q in str(r.get("type") or "").lower()
            or q in str(r.get("message") or "").lower()
            or q in str(r.get("source") or "").lower()
        ]
    total = len(rows)
    page = rows[skip: skip + lim]
    return {"items": page, "total": total, "skip": skip, "limit": lim}


@api_router.get("/admin/trades/surveillance")
async def admin_trades_surveillance(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    large_notional_usdt: float = Query(100_000.0, ge=0.0),
    emit_alerts: bool = False,
    limit: int = Query(200, ge=1, le=1000),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "run_surveillance")
    filt: Dict[str, Any] = {}
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        filt["created_at"] = dr
    large_rows = await db.trades.find({
        **filt,
        "$expr": {"$gte": [{"$multiply": ["$price", "$amount"]}, float(large_notional_usdt)]},
    }, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    self_rows = await db.trades.find({
        **filt,
        "$expr": {"$eq": ["$taker_uid", "$maker_uid"]},
    }, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    if emit_alerts and (large_rows or self_rows):
        controls = await get_platform_controls()
        webhook_url = str(controls.get("alert_webhook_url") or "").strip() or None
        webhook_min = str(controls.get("alert_webhook_min_severity") or "warn").strip().lower()
        if large_rows:
            await alert_service.raise_alert(
                type="surveillance.large_trade",
                severity="warn",
                source="system",
                title="Large trade(s) detected",
                message=f"{len(large_rows)} trade(s) exceeded {large_notional_usdt:,.2f} USDT notional.",
                meta={"threshold_usdt": large_notional_usdt, "count": len(large_rows)},
                dedupe_key=f"surveillance.large_trade:{int(large_notional_usdt)}",
                webhook_url=webhook_url,
                webhook_min_severity=webhook_min,
            )
        if self_rows:
            await alert_service.raise_alert(
                type="surveillance.self_trade",
                severity="critical",
                source="system",
                title="Self-trade(s) detected",
                message=f"{len(self_rows)} self-trade row(s) found in the selected window.",
                meta={"count": len(self_rows)},
                dedupe_key="surveillance.self_trade",
                webhook_url=webhook_url,
                webhook_min_severity=webhook_min,
            )
    return {
        "window": {"from": date_from, "to": date_to},
        "large_notional_usdt": large_notional_usdt,
        "emit_alerts": bool(emit_alerts),
        "large_trades": large_rows,
        "self_trades": self_rows,
        "counts": {"large": len(large_rows), "self": len(self_rows)},
    }


async def _admin_recent_trades_payload(
    symbol: Optional[str],
    uid: Optional[str],
    liquidity_source: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
    skip: int,
    limit: int,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
) -> Dict[str, Any]:
    if db is None:
        raise RuntimeError("database unavailable")
    clauses: List[Dict[str, Any]] = []
    if symbol:
        clauses.append({"symbol": symbol.strip().upper()})
    if uid:
        clauses.append({"$or": [{"taker_uid": uid}, {"maker_uid": uid}]})
    liq = (liquidity_source or "").strip().lower()
    if liq == "system":
        clauses.append({"$or": [{"maker_uid": "SYSTEM"}, {"liquidity_source": "SYSTEM"}]})
    elif liq == "binance":
        clauses.append({"liquidity_source": "BINANCE"})
    elif liq == "user":
        clauses.append({"$and": [{"maker_uid": {"$ne": "SYSTEM"}}, {"liquidity_source": {"$ne": "BINANCE"}}]})
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        clauses.append({"created_at": dr})
    filt: Dict[str, Any] = {"$and": clauses} if len(clauses) > 1 else (clauses[0] if clauses else {})
    sort_field = _admin_sort_mongo_field(sort_by, {
        "created_at": "created_at",
        "time": "created_at",
        "symbol": "symbol",
        "price": "price",
        "amount": "amount",
    }, "created_at")
    cur = db.trades.find(filt, {"_id": 0}).sort(sort_field, _admin_sort_sign(sort_dir)).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.trades.count_documents(filt)
    vol_pipe = [{"$match": filt}, {"$group": {"_id": None, "notional_usdt": {"$sum": {"$multiply": ["$price", "$amount"]}}}}]
    vol_rows = await db.trades.aggregate(vol_pipe).to_list(1)
    notional_total = float(vol_rows[0]["notional_usdt"]) if vol_rows else 0.0
    return {
        "items": items, "total": total, "skip": skip, "limit": limit,
        "stats": {"notional_usdt_total": round(notional_total, 8)},
    }


@api_router.get("/admin/trades/recent")
async def admin_recent_trades(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
    symbol: Optional[str] = None,
    uid: Optional[str] = None,
    liquidity_source: Optional[str] = Query(None, description="all|system|user|binance"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = Query(None, description="asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """Platform-wide recent fills (read-only)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_trades")
    return await _admin_recent_trades_payload(
        symbol, uid, liquidity_source, date_from, date_to, skip, limit, sort_by, sort_dir,
    )


@api_router.post("/admin/impersonate/{uid}", response_model=ImpersonateResponse)
async def admin_impersonate(uid: str, auth: AdminAuthContext = Depends(resolve_admin_auth)):
    """
    Issue a short-lived end-user JWT (claim imp=true) for support / superadmin.
    Exchange app should show a banner when decoding `imp` from the token or via /api/auth/session.

    Does NOT create refresh-token rows, bump sessions_epoch, update last_login_at,
    or write login_audit — the real user's sessions stay untouched and invisible.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if auth.via_api_key or auth.admin is None:
        raise HTTPException(status_code=403, detail="Admin JWT required for impersonation")
    _require_admin_permission(auth, "manage_users")
    if auth.admin.get("role") not in ("superadmin", "support"):
        raise HTTPException(status_code=403, detail="Insufficient privileges")
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="User account is disabled")
    imp_mins = int(os.environ.get("IMPERSONATE_TOKEN_MINUTES", "10"))
    token = create_access_token({
        "sub":   user["uid"],
        "email": user["email"],
        "imp":   True,
        "iad":   auth.admin["aid"],
    }, expire_minutes=imp_mins)
    await log_admin_audit(auth, "impersonate", "user", uid, {"target_email": user.get("email")})
    return ImpersonateResponse(
        access_token=token,
        user=user_doc_to_out(user),
        impersonation={
            "active":               True,
            "admin_aid":            auth.admin["aid"],
            "admin_email":          auth.admin["email"],
            "expires_in_minutes":   imp_mins,
        },
    )


# ── Profile Routes ─────────────────────────────────────────────────────────────

class ProfilePhoneSendOtp(BaseModel):
    mobile: str = Field(..., max_length=20)
    country_code: Optional[str] = Field(
        None,
        max_length=4,
        validation_alias=AliasChoices("country_code", "countryCode", "dial_code"),
    )

    @field_validator("mobile")
    @classmethod
    def mobile_digits(cls, v: str) -> str:
        s = str(v or "").strip()
        if not s:
            raise ValueError("Mobile number is required")
        return s


class ProfileUpdate(BaseModel):
    name:    Optional[str] = Field(None, max_length=80)
    phone:   Optional[str] = Field(None, max_length=32)
    mobile:  Optional[str] = Field(
        None,
        max_length=20,
        validation_alias=AliasChoices("mobile", "phone_number", "phoneNumber"),
    )
    country_code: Optional[str] = Field(
        None,
        max_length=4,
        validation_alias=AliasChoices("country_code", "countryCode", "dial_code"),
    )
    phone_otp: Optional[str] = Field(
        None,
        max_length=12,
        validation_alias=AliasChoices("phone_otp", "phoneOtp", "otp", "code"),
    )
    country: Optional[str] = Field(None, max_length=120)
    city:    Optional[str] = Field(None, max_length=100)
    bio:     Optional[str] = Field(None, max_length=500)


class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=USER_PASSWORD_MAX_LEN)
    new_password:     str = Field(..., min_length=8, max_length=USER_PASSWORD_MAX_LEN)

    @field_validator("new_password")
    @classmethod
    def new_password_strength(cls, v: str) -> str:
        return validate_strong_user_password_value(v)


def _parse_stored_phone_cc_nat(phone_e164: str) -> tuple[str, str]:
    """Best-effort (country_code, national) from stored E.164 or digit string."""
    digits = re.sub(r"\D", "", phone_e164 or "")
    if not digits:
        return "", ""
    default_cc = authkey_sms.default_country_code()
    if digits.startswith(default_cc) and len(digits) > len(default_cc):
        return default_cc, digits[len(default_cc):]
    if len(digits) == 10:
        return default_cc, digits
    if len(digits) > 10:
        return digits[: len(digits) - 10], digits[-10:]
    return default_cc, digits


def _profile_phone_otp_expired(pending: dict) -> bool:
    return _signup_channel_otp_expired(pending, "expires_at")


async def _send_profile_phone_change_otp(
    user: dict,
    *,
    controls: Dict[str, Any],
    cc: str,
    nat: str,
    phone_e164: str,
) -> str:
    if not sms_otp_service.sms_available(controls):
        raise HTTPException(
            status_code=503,
            detail="SMS verification is not configured. Contact support.",
        )
    otp_plain, sms_result = await sms_otp_service.send_signup_sms_otp(
        controls=controls,
        mobile=nat,
        country_code=cc,
        name=user.get("name") or "",
    )
    if not sms_result.ok:
        logger.warning(
            "profile phone OTP failed for uid=%s: %s",
            user.get("uid"),
            sms_result.error,
        )
        raise HTTPException(
            status_code=502,
            detail="Could not send verification SMS. Check your number and try again.",
        )
    now = datetime.now(timezone.utc)
    otp_expires_iso = (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat()
    await db.users.update_one(
        {"uid": user["uid"]},
        {"$set": {
            "phone_change_otp": {
                "phone_e164": phone_e164,
                "mobile": nat,
                "country_code": cc,
                "otp_hash": _hash_signup_otp(otp_plain),
                "expires_at": otp_expires_iso,
                "attempts": 0,
                "sent_at": now.isoformat(),
            },
        }},
    )
    logger.info("Profile phone OTP sent for uid=%s (%s)", user.get("uid"), phone_e164)
    return authkey_sms.mask_phone_hint(cc, nat)


async def _verify_profile_phone_change_otp(
    user: dict,
    *,
    phone_e164: str,
    code_in: str,
) -> None:
    pending = user.get("phone_change_otp") or {}
    uid = user["uid"]
    if not pending or pending.get("phone_e164") != phone_e164:
        raise HTTPException(
            status_code=400,
            detail="Send a verification code to your new mobile number first.",
        )
    attempts = int(pending.get("attempts", 0) or 0)
    if attempts >= OTP_MAX_ATTEMPTS:
        await db.users.update_one({"uid": uid}, {"$unset": {"phone_change_otp": ""}})
        raise HTTPException(
            status_code=400,
            detail="Too many incorrect attempts. Request a new verification code.",
        )
    if _profile_phone_otp_expired(pending):
        await db.users.update_one({"uid": uid}, {"$unset": {"phone_change_otp": ""}})
        raise HTTPException(
            status_code=400,
            detail="Verification code has expired. Request a new code.",
        )
    submitted_hash = _hash_signup_otp(code_in)
    if submitted_hash != pending.get("otp_hash", ""):
        await db.users.update_one(
            {"uid": uid},
            {"$inc": {"phone_change_otp.attempts": 1}},
        )
        remaining = OTP_MAX_ATTEMPTS - attempts - 1
        detail = (
            f"Invalid verification code. {remaining} attempt"
            f"{'s' if remaining != 1 else ''} remaining."
        )
        raise HTTPException(status_code=400, detail=detail)


@api_router.post("/auth/profile/phone/send-otp", status_code=200)
async def profile_phone_send_otp(
    body: ProfilePhoneSendOtp,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Send SMS OTP before changing the account mobile number on profile."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("profile_enabled", "Profile updates are currently paused by admin")

    controls = await get_platform_controls()
    client_ip = rate_limit_service.client_ip_from_request(request)
    await _rate_limit(
        controls,
        "auth.profile_phone_otp",
        f"uid:{current_user['uid']}",
        limit_key="rate_limit_profile_phone_otp_per_uid_per_min",
        window_sec=60,
    )

    try:
        cc, nat = authkey_sms.normalize_mobile(body.mobile, body.country_code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    phone_e164 = _phone_e164(cc, nat)

    cur_cc, cur_nat = _parse_stored_phone_cc_nat(current_user.get("phone") or "")
    if cur_nat and cur_cc == cc and cur_nat == nat:
        raise HTTPException(status_code=400, detail="This is already your mobile number.")

    existing_phone = await db.users.find_one(
        {"phone": phone_e164, "uid": {"$ne": current_user["uid"]}},
    )
    if existing_phone:
        raise HTTPException(
            status_code=409,
            detail="An account with this mobile number already exists",
        )

    if not controls.get("sms_otp_service_enabled", True):
        return {
            "message": "SMS verification is inactive — save your profile to apply the new number.",
            "phone_hint": authkey_sms.mask_phone_hint(cc, nat),
            "otp_required": False,
        }

    phone_hint = await _send_profile_phone_change_otp(
        current_user,
        controls=controls,
        cc=cc,
        nat=nat,
        phone_e164=phone_e164,
    )
    return {
        "message": f"Verification code sent to {phone_hint}.",
        "phone_hint": phone_hint,
    }


@api_router.put("/auth/profile", response_model=UserOut)
async def update_profile(body: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Update profile fields (name, phone, country, city, bio). Phone changes require SMS OTP."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("profile_enabled", "Profile updates are currently paused by admin")
    updates: Dict[str, Any] = {}
    if body.name is not None:
        n = body.name.strip()
        if len(n) < 2:
            raise HTTPException(400, "Name must be at least 2 characters")
        updates["name"] = n

    phone_changing = False
    new_phone_e164: Optional[str] = None
    controls = await get_platform_controls()
    sms_otp_enabled = bool(controls.get("sms_otp_service_enabled", True))
    if body.mobile is not None and str(body.mobile).strip():
        try:
            cc, nat = authkey_sms.normalize_mobile(body.mobile, body.country_code)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        new_phone_e164 = _phone_e164(cc, nat)
        cur_cc, cur_nat = _parse_stored_phone_cc_nat(current_user.get("phone") or "")
        phone_changing = not (cur_nat and cur_cc == cc and cur_nat == nat)
        if phone_changing:
            existing_phone = await db.users.find_one(
                {"phone": new_phone_e164, "uid": {"$ne": current_user["uid"]}},
            )
            if existing_phone:
                raise HTTPException(
                    status_code=409,
                    detail="An account with this mobile number already exists",
                )
            if sms_otp_enabled:
                code_in = (body.phone_otp or "").strip()
                if not code_in:
                    raise HTTPException(
                        status_code=400,
                        detail="Enter the SMS verification code sent to your new mobile number.",
                    )
                fresh = await db.users.find_one({"uid": current_user["uid"]}) or current_user
                await _verify_profile_phone_change_otp(
                    fresh,
                    phone_e164=new_phone_e164,
                    code_in=code_in,
                )
            updates["phone"] = new_phone_e164
            updates["mobile_verified"] = bool(sms_otp_enabled)
    elif body.phone is not None:
        legacy = body.phone.strip() or None
        if legacy and legacy != (current_user.get("phone") or "").strip():
            raise HTTPException(
                status_code=400,
                detail="To change your mobile number, enter a 10-digit number and verify with SMS OTP.",
            )
        if legacy:
            updates["phone"] = legacy

    if body.country is not None:
        updates["country"] = body.country.strip() or None
    if body.city is not None:
        updates["city"] = body.city.strip() or None
    if body.bio is not None:
        updates["bio"] = body.bio.strip() or None
    if not updates:
        raise HTTPException(400, "No fields to update")

    patch: Dict[str, Any] = {"$set": updates}
    if phone_changing:
        patch["$unset"] = {"phone_change_otp": ""}
    await db.users.update_one({"uid": current_user["uid"]}, patch)
    user = await db.users.find_one({"uid": current_user["uid"]}, {"_id": 0, "password_hash": 0})
    return user_doc_to_out(user)


@api_router.post("/auth/profile/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload a profile image (JPEG, PNG, or WebP, max 100MB). Replaces any previous avatar."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("profile_enabled", "Profile updates are currently paused by admin")
    ct = file.content_type or ""
    if ct not in AVATAR_MIME_EXT:
        raise HTTPException(400, "Image must be JPEG, PNG, or WebP")
    raw = await file.read()
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(400, "Image too large (max 100MB)")
    uid = current_user["uid"]
    ext = AVATAR_MIME_EXT[ct]
    for p in AVATAR_DIR.glob(f"{uid}.*"):
        try:
            p.unlink()
        except OSError:
            pass
    dest = AVATAR_DIR / f"{uid}{ext}"
    dest.write_bytes(raw)
    rel_url = f"/uploads/avatars/{uid}{ext}"
    await db.users.update_one({"uid": uid}, {"$set": {"avatar_url": rel_url}})
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    return user_doc_to_out(user)


@api_router.delete("/auth/profile/avatar", response_model=UserOut)
async def delete_avatar(current_user: dict = Depends(get_current_user)):
    """Remove profile photo."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("profile_enabled", "Profile updates are currently paused by admin")
    uid = current_user["uid"]
    for p in AVATAR_DIR.glob(f"{uid}.*"):
        try:
            p.unlink()
        except OSError:
            pass
    await db.users.update_one({"uid": uid}, {"$set": {"avatar_url": None}})
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "password_hash": 0})
    return user_doc_to_out(user)


@api_router.put("/auth/password")
async def change_password(
    body: PasswordChange,
    current_user: dict = Depends(get_current_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Change the authenticated user's password after verifying the current one.

    Phase 7b — a successful password change also bumps
    ``sessions_epoch``, which forcibly invalidates every other session
    (stolen access / refresh tokens become useless immediately). All
    stored refresh tokens for this user are also purged.
    """
    _reject_if_impersonating(credentials, action="Changing password")
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    user_doc = await db.users.find_one({"uid": current_user["uid"]})
    if not user_doc:
        raise HTTPException(404, "User not found")
    if not verify_password(body.current_password, user_doc["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    updated = await db.users.find_one_and_update(
        {"uid": current_user["uid"]},
        {
            "$set": {"password_hash": hash_password(body.new_password)},
            "$inc": {"sessions_epoch": 1},
        },
        projection={"_id": 0, "password_hash": 0},
        return_document=ReturnDocument.AFTER,
    )
    await db.refresh_tokens.delete_many({"uid": current_user["uid"]})
    # Re-issue tokens under the NEW epoch so the caller's session keeps
    # working without a re-login; every OTHER session is killed (their
    # outstanding tokens carry the old epoch and will 401 next request).
    access, refresh = await _issue_token_pair(updated or current_user)
    return {
        "ok": True,
        "message": "Password updated successfully",
        "access_token": access,
        "refresh_token": refresh,
    }


def _kyc_stored_url_valid_for_uid(uid: str, rel_url: Optional[str], side: str) -> bool:
    if not rel_url or not isinstance(rel_url, str):
        return False
    if not rel_url.startswith("/uploads/kyc/"):
        return False
    fname = rel_url.strip().rsplit("/", 1)[-1]
    if ".." in fname or "/" in fname:
        return False
    prefix = f"kyc_{uid}_{side}_"
    return fname.startswith(prefix)


def _kyc_reference_image_valid(uid: str, rel_url: str) -> bool:
    """Local KYC image owned by user (uploaded ID front or stored Aadhaar ref)."""
    return _kyc_stored_url_valid_for_uid(uid, rel_url, "front") or _kyc_stored_url_valid_for_uid(
        uid, rel_url, "aadhaar"
    )


async def _kyc_upload_file_present(upload: Optional[UploadFile]) -> bool:
    """True when multipart part has a filename or non-empty body (mobile often omits filename)."""
    if upload is None:
        return False
    if (upload.filename or "").strip():
        return True
    chunk = await upload.read(1)
    if chunk:
        await upload.seek(0)
        return True
    return False


def _normalize_kyc_upload_content_type(side: str, upload: UploadFile) -> str:
    ct = (upload.content_type or "").split(";")[0].strip().lower()
    if ct == "image/jpg":
        ct = "image/jpeg"
    if ct in ("", "application/octet-stream", "binary/octet-stream"):
        fn = (upload.filename or "").lower()
        if fn.endswith(".png"):
            ct = "image/png"
        elif fn.endswith(".webp"):
            ct = "image/webp"
        elif fn.endswith(".pdf"):
            ct = "application/pdf"
        elif side == "selfie":
            ct = "image/jpeg"
    return ct


async def _write_kyc_upload(
    uid: str,
    side: str,
    upload: UploadFile,
    *,
    max_bytes: int = MAX_KYC_DOC_BYTES,
) -> str:
    ct = _normalize_kyc_upload_content_type(side, upload)
    if ct not in KYC_DOC_MIME_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"{side}: use JPEG, PNG, WebP, or PDF (got {upload.content_type or 'unknown'})",
        )
    if side == "selfie" and ct == "application/pdf":
        raise HTTPException(status_code=400, detail="Selfie must be a photo (JPEG, PNG, or WebP)")
    raw = await upload.read()
    max_mb = max(1, max_bytes // (1024 * 1024))
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail=f"{side}: file too large (max {max_mb}MB)")
    ext = KYC_DOC_MIME_EXT[ct]
    short = uuid.uuid4().hex[:12]
    fname = f"kyc_{uid}_{side}_{short}{ext}"
    dest = KYC_DIR / fname
    for p in KYC_DIR.glob(f"kyc_{uid}_{side}_*"):
        try:
            p.unlink()
        except OSError:
            pass
    dest.write_bytes(raw)
    return f"/uploads/kyc/{fname}"


# ── KYC Models & Routes ────────────────────────────────────────────────────────

def _kyc_id_image_for_face_match(kyc: Optional[dict]) -> Optional[str]:
    """Reference photo for face match: stored Aadhaar JPEG, uploaded ID front, or Signzy URL."""
    if not kyc:
        return None
    stored_field = kyc.get("aadhaar_photo_url")
    if isinstance(stored_field, str) and stored_field.strip():
        return stored_field.strip()
    ver = kyc.get("verification") or {}
    stored = ver.get("aadhaar_photo_stored_url")
    if isinstance(stored, str) and stored.strip():
        return stored.strip()
    front = kyc.get("document_front_url")
    if isinstance(front, str) and front.strip():
        f = front.strip()
        if f.lower().endswith(".pdf"):
            pass
        elif f.startswith("/uploads/kyc/") or f.lower().startswith("http"):
            return f
    return ver.get("aadhaar_jpeg_url") or ver.get("photo_url")


def _kyc_local_upload_file_exists(rel_url: str) -> bool:
    if not rel_url.startswith("/uploads/kyc/"):
        return True
    fname = rel_url.strip().rsplit("/", 1)[-1]
    if ".." in fname or "/" in fname:
        return False
    return (KYC_DIR / fname).is_file()


def _kyc_signzy_photo_fallback(kyc: dict) -> Optional[str]:
    ver = kyc.get("verification") or {}
    for key in ("aadhaar_jpeg_url", "photo_url"):
        u = ver.get(key)
        if isinstance(u, str) and u.strip().lower().startswith("http"):
            return u.strip()
    return None


async def _resolve_kyc_id_image_for_face_match(kyc: dict, uid: str) -> Optional[str]:
    """Resolve ID image URL; re-fetch Aadhaar from Signzy if local file is missing on disk."""
    id_img = _kyc_id_image_for_face_match(kyc)
    if not id_img or not id_img.startswith("/uploads/kyc/"):
        return id_img
    if _kyc_local_upload_file_exists(id_img):
        return id_img

    remote = _kyc_signzy_photo_fallback(kyc)
    if not remote:
        logger.error("[FaceMatch] Local Aadhaar missing and no Signzy fallback uid=%s path=%s", uid, id_img)
        return None

    from services.kyc_aadhaar_photo import repersist_aadhaar_from_remote_url

    logger.warning(
        "[FaceMatch] Local Aadhaar file missing uid=%s path=%s — re-persisting from Signzy",
        uid,
        id_img,
    )
    new_path = await repersist_aadhaar_from_remote_url(uid=uid, kyc_dir=KYC_DIR, url=remote)
    if new_path:
        now = datetime.now(timezone.utc).isoformat()
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "aadhaar_photo_url": new_path,
                "document_front_url": new_path,
                "verification.aadhaar_photo_stored_url": new_path,
                "updated_at": now,
            }},
        )
        return new_path

    logger.warning("[FaceMatch] Re-persist failed uid=%s — using Signzy URL directly", uid)
    return remote


def _face_match_to_doc(result) -> Dict[str, Any]:
    return {
        "verified": result.verified,
        "message": result.message,
        "match_percentage": result.match_percentage,
        "match_score": result.match_score,
        "threshold": result.threshold,
        "mask_detections": result.mask_detections,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "engine": "signzy_face_match",
    }


def _pan_verify_to_doc(result) -> Dict[str, Any]:
    return {
        "verified": result.verified,
        "message": result.message,
        "pan": result.pan,
        "pan_status": result.pan_status,
        "name_matched": result.name_matched,
        "dob_matched": result.dob_matched,
        "seeding_status": result.seeding_status,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "engine": "signzy_pan_verify",
    }


def _kyc_pan_required_and_missing(kyc: Dict[str, Any]) -> bool:
    from services.pan_verify import pan_info_satisfied, pan_verify_configured, pan_verify_required

    if not pan_verify_required() or not pan_verify_configured():
        return False
    return not pan_info_satisfied(kyc.get("pan_info"))


async def _finalize_kyc_approval(uid: str, *, now: Optional[str] = None) -> None:
    """Mark user + KYC record approved (tier_1), refresh AML score, and immediately
    credit any pending signup-bonus deposit events for the user."""
    ts = now or datetime.now(timezone.utc).isoformat()
    await db.kyc.update_one(
        {"uid": uid},
        {"$set": {
            "status": "approved",
            "kyc_tier": "tier_1",
            "reviewed_at": ts,
            "updated_at": ts,
            "rejection_reason": None,
        }},
    )
    await db.users.update_one(
        {"uid": uid},
        {"$set": {"kyc_status": "approved", "kyc_tier": "tier_1", "updated_at": ts}},
    )
    await compliance_service.recompute_aml_risk_for_user(db, uid)
    try:
        result = await signup_bonus_svc.credit_signup_bonus_on_kyc_approval(db, uid)
        if result.get("credited"):
            logger.info(
                "kyc_approval: signup bonus credited uid=%s credited=%d",
                uid, result["credited"],
            )
    except Exception:  # noqa: BLE001
        logger.exception("kyc_approval: signup bonus credit trigger failed uid=%s", uid)
    try:
        await referral_svc.credit_referral_rewards_on_kyc_approval(db, uid)
    except Exception:  # noqa: BLE001
        logger.exception("kyc_approval: referral reward credit trigger failed uid=%s", uid)


async def _apply_digilocker_success(uid: str, request_id: str, payload: Dict[str, Any]) -> str:
    """Persist DigiLocker KYC data — auto-approve (legacy) or advance to selfie when face match is on."""
    from services.digilocker import parse_digilocker_callback, pan_info_from_documents
    from services.face_match import face_match_configured, face_match_required
    from services.kyc_aadhaar_photo import persist_aadhaar_reference_photo
    from services.pan_verify import pan_info_satisfied, pan_verify_configured, pan_verify_required

    kyc_data = parse_digilocker_callback(payload)
    pan_info = pan_info_from_documents(kyc_data.documents)
    now = datetime.now(timezone.utc).isoformat()

    personal_info = {
        "full_name":    kyc_data.full_name or "",
        "date_of_birth": kyc_data.dob or "",
        "nationality":  "Indian",
        "address":      kyc_data.address or "",
        "city":         (kyc_data.split_address or {}).get("city", [""])[0] if kyc_data.split_address else "",
        "country":      "India",
        "postal_code":  (kyc_data.split_address or {}).get("pincode", "") if kyc_data.split_address else "",
    }
    document_info = {
        "document_type":   "national_id",
        "document_number": kyc_data.uid_masked or "N/A (Aadhaar)",
        "document_expiry": "",
    }

    verification_record = {
        "engine":                  "signzy_digilocker",
        "document_authenticity":   "auto_approved",
        "checked_at":              now,
        "digilocker_id":           kyc_data.digilocker_id,
        "eaadhaar_linked":         kyc_data.eaadhaar == "Y",
        "aadhaar_pdf_url":         kyc_data.aadhaar_pdf_url,
        "aadhaar_jpeg_url":        kyc_data.aadhaar_jpeg_url,
        "photo_url":               kyc_data.photo_url,
        "pan_linked":              pan_info.get("linked", False),
        "pan_number":              pan_info.get("number"),
        "pan_file_id":             pan_info.get("file_id"),
        "pan_issuer":              pan_info.get("issuer"),
    }

    fm_required = face_match_required()
    fm_configured = face_match_configured()
    need_selfie = fm_required and fm_configured
    need_pan = pan_verify_required() and pan_verify_configured() and not pan_info_satisfied(pan_info)

    if fm_required and not fm_configured:
        logger.error(
            "[DigiLocker] Face match required but SIGNZY_API_KEY missing uid=%s requestId=%s",
            uid,
            request_id,
        )
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "status": "digilocker_failed",
                "digilocker_failure_reason": "face_match_not_configured",
                "personal_info": personal_info,
                "document_info": document_info,
                "pan_info": pan_info,
                "verification": verification_record,
                "updated_at": now,
            }},
        )
        return "digilocker_failed"

    if need_selfie:
        aadhaar_local = await persist_aadhaar_reference_photo(
            uid=uid,
            kyc_dir=KYC_DIR,
            payload=payload,
            kyc_data=kyc_data,
        )
        if aadhaar_local:
            verification_record["aadhaar_photo_stored_url"] = aadhaar_local

        ref_photo = (
            aadhaar_local
            or kyc_data.aadhaar_jpeg_url
            or kyc_data.photo_url
        )
        if not ref_photo:
            logger.error(
                "[DigiLocker] Aadhaar photo unavailable uid=%s requestId=%s — cannot run face match",
                uid,
                request_id,
            )
            await db.kyc.update_one(
                {"uid": uid},
                {"$set": {
                    "status": "digilocker_failed",
                    "digilocker_failure_reason": "aadhaar_photo_unavailable",
                    "personal_info": personal_info,
                    "document_info": document_info,
                    "pan_info": pan_info,
                    "verification": verification_record,
                    "updated_at": now,
                }},
            )
            return "digilocker_failed"

        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "status":               "awaiting_pan" if need_pan else "awaiting_selfie",
                "personal_info":        personal_info,
                "document_info":        document_info,
                "pan_info":             pan_info,
                "aadhaar_photo_url":    ref_photo,
                "document_front_url":   ref_photo,
                "document_back_url":    None,
                "kyc_tier":             "tier_0",
                "verification":         verification_record,
                "submitted_at":         now,
                "reviewed_at":          None,
                "updated_at":           now,
                "digilocker_failure_reason": None,
                "face_match":           None,
                "pan_verify":           None,
            }},
        )
        await db.users.update_one(
            {"uid": uid},
            {"$set": {"kyc_status": "unverified", "kyc_tier": "tier_0", "updated_at": now}},
        )
        logger.info(
            "[DigiLocker] %s uid=%s requestId=%s name=%s pan_linked=%s",
            "AWAITING_PAN" if need_pan else "AWAITING_SELFIE",
            uid, request_id, kyc_data.full_name, pan_info.get("linked"),
        )
        return "awaiting_pan" if need_pan else "awaiting_selfie"

    if need_pan:
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "status":               "awaiting_pan",
                "personal_info":        personal_info,
                "document_info":        document_info,
                "pan_info":             pan_info,
                "document_front_url":   kyc_data.aadhaar_jpeg_url or kyc_data.aadhaar_pdf_url or "",
                "document_back_url":    None,
                "kyc_tier":             "tier_0",
                "verification":         verification_record,
                "submitted_at":         now,
                "reviewed_at":          None,
                "updated_at":           now,
                "pan_verify":           None,
            }},
        )
        await db.users.update_one(
            {"uid": uid},
            {"$set": {"kyc_status": "unverified", "kyc_tier": "tier_0", "updated_at": now}},
        )
        logger.info(
            "[DigiLocker] AWAITING_PAN uid=%s requestId=%s name=%s",
            uid, request_id, kyc_data.full_name,
        )
        return "awaiting_pan"

    # Legacy path (last commit): DigiLocker alone auto-approves KYC.
    await db.kyc.update_one(
        {"uid": uid},
        {"$set": {
            "status":               "approved",
            "personal_info":        personal_info,
            "document_info":        document_info,
            "pan_info":             pan_info,
            "document_front_url":   kyc_data.aadhaar_jpeg_url or kyc_data.aadhaar_pdf_url or "",
            "document_back_url":    None,
            "kyc_tier":             "tier_1",
            "verification":         verification_record,
            "submitted_at":         now,
            "reviewed_at":          now,
            "updated_at":           now,
        }},
    )
    await db.users.update_one(
        {"uid": uid},
        {"$set": {"kyc_status": "approved", "kyc_tier": "tier_1", "updated_at": now}},
    )
    try:
        await signup_bonus_svc.credit_signup_bonus_on_kyc_approval(db, uid)
    except Exception:  # noqa: BLE001
        logger.exception("[DigiLocker] signup bonus credit trigger failed uid=%s", uid)
    try:
        await referral_svc.credit_referral_rewards_on_kyc_approval(db, uid)
    except Exception:  # noqa: BLE001
        logger.exception("[DigiLocker] referral reward credit trigger failed uid=%s", uid)
    logger.info(
        "[DigiLocker] AUTO_APPROVED uid=%s requestId=%s name=%s",
        uid, request_id, kyc_data.full_name,
    )
    return "approved"


KycDocumentType = Literal["passport", "national_id", "driving_license"]


class KYCPersonalInfo(BaseModel):
    """Aligned with exchange `kycValidation.js` (lengths / required fields)."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    full_name: str = Field(..., min_length=3, max_length=200)
    date_of_birth: str = Field(..., min_length=10, max_length=32)
    nationality: str = Field(..., min_length=2, max_length=80)
    address: str = Field(..., min_length=12, max_length=500)
    city: str = Field(..., min_length=2, max_length=100)
    country: str = Field(..., min_length=2, max_length=100)
    postal_code: str = Field(..., min_length=2, max_length=16)


class KYCDocumentInfo(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    document_type: KycDocumentType
    document_number: str = Field(..., min_length=4, max_length=80)
    document_expiry: str = Field(..., min_length=10, max_length=32)


class KYCSubmit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    personal_info: KYCPersonalInfo
    document_info: KYCDocumentInfo
    document_front_url: Optional[str] = None
    document_back_url: Optional[str] = None


class KYCPanVerifyRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    pan: str = Field(..., min_length=10, max_length=10)
    name: Optional[str] = Field(None, min_length=3, max_length=200)
    date_of_birth: Optional[str] = Field(None, min_length=8, max_length=32)


@api_router.post("/kyc/upload")
async def upload_kyc_documents(
    document_front: Optional[UploadFile] = File(None),
    document_back: Optional[UploadFile] = File(None),
    document_selfie: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    """Upload ID images and/or selfie. Selfie max 5 MB (Signzy face-match limit)."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("kyc_enabled", "KYC submission is currently paused by admin")
    uid = current_user["uid"]
    existing = await db.kyc.find_one({"uid": uid})
    if existing and existing.get("status") == "approved":
        raise HTTPException(400, "KYC already approved — no uploads needed")

    has_f = await _kyc_upload_file_present(document_front)
    has_b = await _kyc_upload_file_present(document_back)
    has_s = await _kyc_upload_file_present(document_selfie)
    if not has_f and not has_b and not has_s:
        raise HTTPException(status_code=400, detail="No files received")

    prev_front = (existing or {}).get("document_front_url")
    prev_back = (existing or {}).get("document_back_url")
    prev_selfie = (existing or {}).get("selfie_url")

    front_url: Optional[str] = prev_front if prev_front else None
    back_url: Optional[str] = prev_back if prev_back else None
    selfie_url: Optional[str] = prev_selfie if prev_selfie else None
    if has_f:
        front_url = await _write_kyc_upload(uid, "front", document_front)  # type: ignore[arg-type]
    if has_b:
        back_url = await _write_kyc_upload(uid, "back", document_back)  # type: ignore[arg-type]
    if has_s:
        selfie_url = await _write_kyc_upload(
            uid,
            "selfie",
            document_selfie,  # type: ignore[arg-type]
            max_bytes=MAX_KYC_SELFIE_BYTES,
        )

    if has_f or has_b:
        if not front_url:
            raise HTTPException(
                status_code=400,
                detail="Upload the front of your ID first (or send both files in one request).",
            )

    now = datetime.now(timezone.utc).isoformat()
    snap = await db.kyc.find_one({"uid": uid})
    st = (snap or {}).get("status")
    if st in ("pending", "rejected", "awaiting_selfie", "face_match_failed"):
        keep_status = st
    else:
        keep_status = "draft"
    if has_s and st == "face_match_failed":
        keep_status = "awaiting_selfie"

    set_fields: Dict[str, Any] = {
        "uid": uid,
        "status": keep_status,
        "updated_at": now,
    }
    if front_url is not None:
        set_fields["document_front_url"] = front_url
    if back_url is not None:
        set_fields["document_back_url"] = back_url
    if selfie_url is not None:
        set_fields["selfie_url"] = selfie_url
        set_fields["face_match"] = None

    await db.kyc.update_one(
        {"uid": uid},
        {
            "$set": set_fields,
            "$setOnInsert": {
                "personal_info": None,
                "document_info": None,
                "submitted_at": None,
                "reviewed_at": None,
                "rejection_reason": None,
            },
        },
        upsert=True,
    )
    if keep_status == "draft":
        await db.users.update_one({"uid": uid}, {"$set": {"kyc_status": "unverified"}})

    return {
        "ok": True,
        "document_front_url": front_url,
        "document_back_url": back_url,
        "selfie_url": selfie_url,
    }


@api_router.delete("/kyc/upload/{side}")
async def delete_kyc_upload(
    side: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove an uploaded KYC document side (front | back | selfie) from disk and DB."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("kyc_enabled", "KYC submission is currently paused by admin")
    side_key = (side or "").strip().lower()
    field_map = {
        "front": "document_front_url",
        "back": "document_back_url",
        "selfie": "selfie_url",
    }
    if side_key not in field_map:
        raise HTTPException(status_code=400, detail="side must be front, back, or selfie")
    uid = current_user["uid"]
    existing = await db.kyc.find_one({"uid": uid})
    if existing and existing.get("status") == "approved":
        raise HTTPException(400, "KYC already approved — documents cannot be removed")
    if existing and existing.get("status") == "pending":
        raise HTTPException(400, "KYC is under review — documents cannot be removed")

    for p in KYC_DIR.glob(f"kyc_{uid}_{side_key}_*"):
        try:
            p.unlink()
        except OSError:
            pass

    field = field_map[side_key]
    unset_fields: Dict[str, Any] = {field: ""}
    if side_key == "selfie":
        unset_fields["face_match"] = ""
    now = datetime.now(timezone.utc).isoformat()
    await db.kyc.update_one(
        {"uid": uid},
        {
            "$unset": unset_fields,
            "$set": {"updated_at": now},
        },
    )
    snap = await db.kyc.find_one({"uid": uid}, {"_id": 0}) or {}
    return {
        "ok": True,
        "side": side_key,
        "document_front_url": snap.get("document_front_url"),
        "document_back_url": snap.get("document_back_url"),
        "selfie_url": snap.get("selfie_url"),
    }


@api_router.post("/kyc/submit", status_code=201)
async def submit_kyc(body: KYCSubmit, current_user: dict = Depends(get_current_user)):
    """Submit or resubmit KYC documents. Pending by default; auto-approved when KYC_AUTO_APPROVE_ON_SUBMIT is enabled."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("kyc_enabled", "KYC submission is currently paused by admin")
    uid = current_user["uid"]
    existing = await db.kyc.find_one({"uid": uid})
    if existing and existing.get("status") == "approved":
        raise HTTPException(400, "KYC already approved — no resubmission needed")
    now = datetime.now(timezone.utc).isoformat()

    front_u = body.document_front_url or (existing or {}).get("document_front_url")
    back_u = body.document_back_url or (existing or {}).get("document_back_url")

    if not KYC_AUTO_APPROVE_ON_SUBMIT:
        if not front_u or not _kyc_stored_url_valid_for_uid(uid, front_u, "front"):
            raise HTTPException(
                status_code=400,
                detail="ID document upload required. On the document step, upload a clear photo of your ID (front), then submit.",
            )
        if back_u and not _kyc_stored_url_valid_for_uid(uid, back_u, "back"):
            raise HTTPException(status_code=400, detail="Invalid back document file reference — upload again.")

    from services.face_match import face_match_configured, face_match_required

    if face_match_required() and face_match_configured():
        selfie_u = (existing or {}).get("selfie_url")
        if not selfie_u or not _kyc_stored_url_valid_for_uid(uid, selfie_u, "selfie"):
            raise HTTPException(
                status_code=400,
                detail="Selfie upload required. Upload a clear selfie, then complete POST /kyc/face-match.",
            )
        fm = (existing or {}).get("face_match") or {}
        if not fm.get("verified"):
            raise HTTPException(
                status_code=400,
                detail="Selfie face match not verified. Complete POST /kyc/face-match before submitting.",
            )

    cfg_scr = await _get_screening_config()
    name_scr = await compliance_service.screen_kyc_name(db, body.personal_info.full_name, cfg_scr)

    if KYC_AUTO_APPROVE_ON_SUBMIT:
        if name_scr.get("blocked"):
            kyc_doc = {
                "uid": uid,
                "status":              "pending",
                "personal_info":       body.personal_info.model_dump(),
                "document_info":       body.document_info.model_dump(),
                "document_front_url":  front_u,
                "document_back_url":   back_u,
                "selfie_url":          (existing or {}).get("selfie_url"),
                "face_match":          (existing or {}).get("face_match"),
                "submitted_at":        now,
                "reviewed_at":         None,
                "rejection_reason":    None,
                "screening":           {"name_screening": name_scr},
                "verification":        {"engine": "internal", "document_authenticity": "manual_review_required", "checked_at": now},
                "kyc_tier":            "tier_0",
            }
            await db.kyc.update_one({"uid": uid}, {"$set": kyc_doc}, upsert=True)
            await db.users.update_one({"uid": uid}, {"$set": {"kyc_status": "pending", "kyc_tier": "tier_0"}})
            await compliance_service.recompute_aml_risk_for_user(db, uid)
            logger.info("KYC auto-approve skipped for %s — sanctions screening requires manual review", uid)
            return {
                "ok": True,
                "status": "pending",
                "message": "Automated screening requires manual review before approval.",
            }
        kyc_doc = {
            "uid": uid,
            "status":              "approved",
            "personal_info":       body.personal_info.model_dump(),
            "document_info":       body.document_info.model_dump(),
            "document_front_url":  front_u,
            "document_back_url":   back_u,
            "selfie_url":          (existing or {}).get("selfie_url"),
            "face_match":          (existing or {}).get("face_match"),
            "submitted_at":        now,
            "reviewed_at":         now,
            "rejection_reason":    None,
            "screening":           {"name_screening": name_scr},
            "verification":        {"engine": "internal", "document_authenticity": "auto_approved", "checked_at": now},
            "kyc_tier":            "tier_1",
        }
        await db.kyc.update_one({"uid": uid}, {"$set": kyc_doc}, upsert=True)
        await db.users.update_one({"uid": uid}, {"$set": {"kyc_status": "approved", "kyc_tier": "tier_1"}})
        await compliance_service.recompute_aml_risk_for_user(db, uid)
        try:
            await signup_bonus_svc.credit_signup_bonus_on_kyc_approval(db, uid)
        except Exception:  # noqa: BLE001
            logger.exception("kyc_submit auto-approve: signup bonus credit trigger failed uid=%s", uid)
        try:
            await referral_svc.credit_referral_rewards_on_kyc_approval(db, uid)
        except Exception:  # noqa: BLE001
            logger.exception("kyc_submit auto-approve: referral reward credit trigger failed uid=%s", uid)
        logger.info(f"KYC auto-approved on submit for {uid} (KYC_AUTO_APPROVE_ON_SUBMIT=true)")
        return {
            "ok": True,
            "status": "approved",
            "message": "KYC verified and approved. You can trade now.",
        }

    if name_scr.get("blocked"):
        raise HTTPException(
            status_code=403,
            detail="Identity screening matched a sanctions list entry. If you believe this is an error, contact support.",
        )

    kyc_doc = {
        "uid":                 uid,
        "status":              "pending",
        "personal_info":       body.personal_info.model_dump(),
        "document_info":       body.document_info.model_dump(),
        "document_front_url":  front_u,
        "document_back_url":   back_u,
        "selfie_url":          (existing or {}).get("selfie_url"),
        "face_match":          (existing or {}).get("face_match"),
        "submitted_at":        now,
        "reviewed_at":         None,
        "rejection_reason":    None,
        "screening":           {"name_screening": name_scr},
        "verification":        {"engine": "internal", "document_authenticity": "manual_review_required", "checked_at": now},
        "kyc_tier":            "tier_0",
    }
    await db.kyc.update_one({"uid": uid}, {"$set": kyc_doc}, upsert=True)
    await db.users.update_one({"uid": uid}, {"$set": {"kyc_status": "pending", "kyc_tier": "tier_0"}})
    await compliance_service.recompute_aml_risk_for_user(db, uid)
    logger.info(f"KYC submitted for {uid} (pending manual review)")
    return {"ok": True, "status": "pending", "message": "KYC submitted. Under review — usually 1–2 business days."}


@api_router.get("/kyc/status")
async def get_kyc_status(current_user: dict = Depends(get_current_user)):
    """Get the authenticated user's KYC status and submission details."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    urow = await db.users.find_one({"uid": current_user["uid"]}, {"kyc_tier": 1, "aml_risk_score": 1})
    kyc = await db.kyc.find_one({"uid": current_user["uid"]}, {"_id": 0})
    from services.face_match import face_match_configured, face_match_required
    from services.pan_verify import pan_verify_configured, pan_verify_required

    fm_required = face_match_required() and face_match_configured()
    pv_required = pan_verify_required() and pan_verify_configured()
    if not kyc:
        return {
            "status": "unverified",
            "submitted_at": None,
            "reviewed_at": None,
            "rejection_reason": None,
            "personal_info": None,
            "document_info": None,
            "document_front_url": None,
            "document_back_url": None,
            "selfie_url": None,
            "face_match": None,
            "face_match_required": fm_required,
            "pan_verify_required": pv_required,
            "pan_verify": None,
            "kyc_tier": (urow or {}).get("kyc_tier"),
            "screening": None,
            "verification": None,
            "aml_risk_score": (urow or {}).get("aml_risk_score"),
            "digilocker_failure_reason": None,
            "pan_info": None,
        }
    raw_status = kyc.get("status", "unverified")
    display_status = "unverified" if raw_status == "draft" else raw_status
    return {
        "status":              display_status,
        "submitted_at":        kyc.get("submitted_at"),
        "reviewed_at":         kyc.get("reviewed_at"),
        "rejection_reason":    kyc.get("rejection_reason"),
        "personal_info":       kyc.get("personal_info"),
        "document_info":       kyc.get("document_info"),
        "document_front_url":  kyc.get("document_front_url"),
        "document_back_url":   kyc.get("document_back_url"),
        "selfie_url":          kyc.get("selfie_url"),
        "face_match":          kyc.get("face_match"),
        "face_match_required": fm_required,
        "pan_verify_required": pv_required,
        "pan_verify":          kyc.get("pan_verify"),
        "kyc_tier":            kyc.get("kyc_tier") or (urow or {}).get("kyc_tier"),
        "screening":           kyc.get("screening"),
        "verification":        kyc.get("verification"),
        "aml_risk_score":      (urow or {}).get("aml_risk_score"),
        "digilocker_failure_reason": kyc.get("digilocker_failure_reason"),
        "pan_info":            kyc.get("pan_info"),
    }


@api_router.get("/kyc/mode")
async def get_kyc_mode(_user=Depends(get_current_user)):
    """Return the active KYC verification mode so the frontend can render the right flow."""
    from services.face_match import face_match_configured, face_match_required
    from services.pan_verify import pan_verify_configured, pan_verify_required

    controls = await get_platform_controls()
    return {
        "kyc_mode": controls.get("kyc_mode", "manual"),
        "kyc_enabled": controls.get("kyc_enabled", True),
        "face_match_required": face_match_required() and face_match_configured(),
        "face_match_configured": face_match_configured(),
        "pan_verify_required": pan_verify_required() and pan_verify_configured(),
        "pan_verify_configured": pan_verify_configured(),
    }


@api_router.post("/kyc/pan/verify")
async def kyc_pan_verify(
    body: KYCPanVerifyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Verify PAN via Signzy when it was not linked in DigiLocker."""
    from services.pan_verify import (
        build_pan_info_from_verify,
        pan_info_satisfied,
        pan_verify_configured,
        verify_pan,
    )
    from services.face_match import face_match_configured, face_match_required

    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("kyc_enabled", "KYC verification is currently paused by admin")
    if not pan_verify_configured():
        raise HTTPException(503, "PAN verification is not configured (SIGNZY_API_KEY missing).")

    uid = current_user["uid"]
    kyc = await db.kyc.find_one({"uid": uid})
    if not kyc:
        raise HTTPException(400, "Complete DigiLocker Aadhaar verification before verifying PAN.")
    if kyc.get("status") == "approved":
        raise HTTPException(400, "KYC already approved.")
    if pan_info_satisfied(kyc.get("pan_info")):
        return {
            "ok": True,
            "verified": True,
            "message": "PAN already on file.",
            "pan_info": kyc.get("pan_info"),
            "status": kyc.get("status"),
        }
    if kyc.get("status") not in ("awaiting_pan", "awaiting_selfie", "face_match_failed", "pan_verify_failed"):
        raise HTTPException(
            400,
            "PAN verification is only available after DigiLocker when PAN was not linked.",
        )

    personal = kyc.get("personal_info") if isinstance(kyc.get("personal_info"), dict) else {}
    name = (body.name or personal.get("full_name") or "").strip()
    dob = (body.date_of_birth or personal.get("date_of_birth") or "").strip()
    if not name or not dob:
        raise HTTPException(400, "Aadhaar name and date of birth are required to verify PAN.")

    try:
        result = await verify_pan(pan=body.pan, name=name, dob=dob)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc

    pv_doc = _pan_verify_to_doc(result)
    now = datetime.now(timezone.utc).isoformat()
    st = kyc.get("status")
    next_status = st
    if result.verified:
        pan_info = build_pan_info_from_verify(result)
        pan_info["verified_at"] = now
        verification = dict(kyc.get("verification") or {})
        verification.update({
            "pan_linked": False,
            "pan_number": result.pan,
            "pan_source": "signzy_pan_verify",
            "pan_verified_at": now,
        })
        if st in ("awaiting_pan", "pan_verify_failed"):
            fm_on = face_match_required() and face_match_configured()
            next_status = "awaiting_selfie" if fm_on else "approved"
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "pan_info": pan_info,
                "pan_verify": pv_doc,
                "verification": verification,
                "status": next_status,
                "updated_at": now,
                **({"reviewed_at": now, "kyc_tier": "tier_1"} if next_status == "approved" else {}),
            }},
        )
        if next_status == "approved":
            await db.users.update_one(
                {"uid": uid},
                {"$set": {"kyc_status": "approved", "kyc_tier": "tier_1", "updated_at": now}},
            )
            await compliance_service.recompute_aml_risk_for_user(db, uid)
            try:
                await signup_bonus_svc.credit_signup_bonus_on_kyc_approval(db, uid)
            except Exception:  # noqa: BLE001
                logger.exception("[PanVerify] signup bonus credit trigger failed uid=%s", uid)
            try:
                await referral_svc.credit_referral_rewards_on_kyc_approval(db, uid)
            except Exception:  # noqa: BLE001
                logger.exception("[PanVerify] referral reward credit trigger failed uid=%s", uid)
        logger.info("[PanVerify] success uid=%s pan=%s next=%s", uid, result.pan, next_status)
    else:
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "pan_verify": pv_doc,
                "status": "pan_verify_failed",
                "updated_at": now,
            }},
        )
        logger.warning("[PanVerify] failed uid=%s panStatus=%s", uid, result.pan_status)

    return {
        "ok": True,
        "verified": result.verified,
        "message": result.message,
        "pan_verify": pv_doc,
        "pan_info": build_pan_info_from_verify(result) if result.verified else kyc.get("pan_info"),
        "status": next_status if result.verified else "pan_verify_failed",
        "kyc_status": "approved" if (result.verified and next_status == "approved") else None,
    }


@api_router.post("/kyc/face-match")
async def kyc_face_match(current_user: dict = Depends(get_current_user)):
    """Compare uploaded selfie against ID photo via Signzy Face Match API."""
    from services.face_match import face_match_configured, match_faces

    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("kyc_enabled", "KYC submission is currently paused by admin")
    if not face_match_configured():
        raise HTTPException(503, "Selfie verification is not configured (SIGNZY_API_KEY missing).")

    uid = current_user["uid"]
    kyc = await db.kyc.find_one({"uid": uid})
    if not kyc:
        raise HTTPException(400, "Upload your ID and selfie before running face verification.")
    if kyc.get("status") == "approved":
        raise HTTPException(400, "KYC already approved.")

    if _kyc_pan_required_and_missing(kyc):
        raise HTTPException(
            400,
            "PAN verification required. Complete POST /kyc/pan/verify before face match.",
        )

    selfie = kyc.get("selfie_url")
    if not selfie or not _kyc_stored_url_valid_for_uid(uid, selfie, "selfie"):
        raise HTTPException(400, "Upload a selfie first (POST /kyc/upload with document_selfie).")

    id_img = await _resolve_kyc_id_image_for_face_match(kyc, uid)
    if not id_img:
        raise HTTPException(
            400,
            "Aadhaar reference photo is missing on the server. Open DigiLocker again and tap Check status, then retry selfie.",
        )
    if id_img.startswith("/uploads/kyc/") and not _kyc_reference_image_valid(uid, id_img):
        raise HTTPException(400, "Invalid ID reference image for face match.")
    if selfie.strip() == id_img.strip():
        raise HTTPException(400, "Selfie and ID photo must be different images.")

    try:
        result = await match_faces(selfie, id_img, detect_mask_on=[selfie])
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc

    fm_doc = _face_match_to_doc(result)
    now = datetime.now(timezone.utc).isoformat()
    st = kyc.get("status")
    digilocker_selfie_flow = st in ("awaiting_selfie", "face_match_failed")

    if digilocker_selfie_flow and result.verified:
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "face_match": fm_doc,
                "status": "approved",
                "kyc_tier": "tier_1",
                "reviewed_at": now,
                "updated_at": now,
                "rejection_reason": None,
            }},
        )
        await db.users.update_one(
            {"uid": uid},
            {"$set": {"kyc_status": "approved", "kyc_tier": "tier_1", "updated_at": now}},
        )
        await compliance_service.recompute_aml_risk_for_user(db, uid)
        try:
            await signup_bonus_svc.credit_signup_bonus_on_kyc_approval(db, uid)
        except Exception:  # noqa: BLE001
            logger.exception("[FaceMatch] signup bonus credit trigger failed uid=%s", uid)
        try:
            await referral_svc.credit_referral_rewards_on_kyc_approval(db, uid)
        except Exception:  # noqa: BLE001
            logger.exception("[FaceMatch] referral reward credit trigger failed uid=%s", uid)
        logger.info("[FaceMatch] DigiLocker KYC approved uid=%s match=%s", uid, result.match_percentage)
    elif digilocker_selfie_flow and not result.verified:
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {"face_match": fm_doc, "status": "face_match_failed", "updated_at": now}},
        )
        logger.warning("[FaceMatch] DigiLocker selfie failed uid=%s match=%s", uid, result.match_percentage)
    else:
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {"face_match": fm_doc, "updated_at": now}},
        )

    return {
        "ok": True,
        "verified": result.verified,
        "message": result.message,
        "match_percentage": result.match_percentage,
        "face_match": fm_doc,
        "kyc_status": "approved" if (digilocker_selfie_flow and result.verified) else None,
    }


@api_router.post("/kyc/digilocker/init")
async def kyc_digilocker_init(
    body: Optional[Dict[str, Any]] = None,
    current_user: dict = Depends(get_current_user),
):
    """Create a Signzy DigiLocker URL for the authenticated user.

    Body (optional): ``{ "client": "android" | "web" }`` — Android uses
    ``SIGNZY_DIGILOCKER_ANDROID_SUCCESS_URL`` when configured.

    Returns ``{ url, request_id }`` — open ``url`` in a browser tab / Custom Tab.
    The request_id is stored on the pending KYC record so the callback can match it.
    """
    from services.digilocker import (
        SignzyApiError,
        create_digilocker_url,
        digilocker_configured,
        resolve_digilocker_redirect_urls,
    )

    if db is None:
        raise HTTPException(503, "Database unavailable")

    controls = await get_platform_controls()
    if not controls.get("kyc_enabled", True):
        raise HTTPException(503, "KYC submissions are currently paused.")
    if controls.get("kyc_mode", "manual") != "auto":
        raise HTTPException(400, "DigiLocker KYC is not enabled by admin.")
    if not digilocker_configured():
        raise HTTPException(503, "DigiLocker KYC service is not configured. Contact support.")

    uid = current_user["uid"]

    existing = await db.kyc.find_one({"uid": uid}, {"status": 1})
    if existing:
        est = existing.get("status")
        if est == "approved":
            raise HTTPException(400, "KYC is already approved.")
        if est == "pending":
            raise HTTPException(400, "KYC is already pending manual review.")
        if est in ("awaiting_pan", "awaiting_selfie", "face_match_failed", "pan_verify_failed"):
            raise HTTPException(
                400,
                "DigiLocker identity is verified — complete PAN and selfie steps before starting again.",
            )

    now = datetime.now(timezone.utc).isoformat()
    client = str((body or {}).get("client") or "").strip().lower()
    success_url, failure_url = resolve_digilocker_redirect_urls(client or None)
    try:
        result = await create_digilocker_url(
            internal_id=uid,
            success_redirect_url=success_url or None,
            failure_redirect_url=failure_url or None,
        )
    except SignzyApiError as exc:
        logger.error("[DigiLocker] init failed for uid=%s: %s", uid, exc.message)
        raise HTTPException(exc.http_status, exc.message) from exc
    except ValueError as exc:
        logger.error("[DigiLocker] init failed for uid=%s: %s", uid, exc)
        raise HTTPException(502, str(exc)) from exc

    # Upsert a draft KYC record tracking the pending DigiLocker request
    await db.kyc.update_one(
        {"uid": uid},
        {
            "$set": {
                "status": "digilocker_pending",
                "digilocker_request_id": result.request_id,
                "digilocker_initiated_at": now,
                "updated_at": now,
            },
            "$setOnInsert": {"uid": uid},
        },
        upsert=True,
    )

    logger.info("[DigiLocker] init uid=%s requestId=%s client=%s", uid, result.request_id, client or "web")
    return {"url": result.url, "request_id": result.request_id}


@api_router.get("/kyc/digilocker/return", response_class=HTMLResponse)
async def kyc_digilocker_return_page(request: Request):
    """HTTPS bridge after DigiLocker — opens the mobile app via custom scheme.

    request_id and other params are URL-encoded before being embedded in the
    deep link, and JSON-encoded before being placed in the inline JS, so they
    cannot inject script or break the HTML attribute.
    """
    import html as _html
    from urllib.parse import quote as _quote

    qp = request.query_params
    # Strip and allow only printable ASCII to block control chars / weird encodings.
    def _clean(v: str) -> str:
        return "".join(c for c in v if c.isprintable())[:256]

    request_id = _clean((qp.get("requestId") or qp.get("request_id") or "").strip())
    status = _clean((qp.get("status") or "success").strip())
    scope = _clean((qp.get("scope") or "").strip())

    # Build deep link with percent-encoded query params so HTML attrs stay intact.
    deep = "ibo://kyc/digilocker-complete"
    if request_id:
        deep += (
            "?requestId=" + _quote(request_id, safe="")
            + "&status=" + _quote(status, safe="")
        )
        if scope:
            deep += "&scope=" + _quote(scope, safe="")

    # json.dumps produces a properly JS-escaped string literal (double-quoted,
    # backslashes and < / > escaped), safe to embed in <script>.
    deep_js = json.dumps(deep)
    request_id_js = json.dumps(request_id)
    # Escape for an HTML attribute (href="…").
    deep_attr = _html.escape(deep, quote=True)

    page = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Return to IBO</title>
<style>
  body {{ font-family: system-ui, sans-serif; background:#05070d; color:#e8eaed;
    display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; }}
  .card {{ max-width:400px; text-align:center; }}
  h1 {{ font-size:1.25rem; margin:0 0 12px; }}
  p {{ color:#9aa0a6; line-height:1.5; font-size:0.95rem; }}
  a {{ color:#22c55e; }}
</style>
</head><body>
<div class="card">
  <h1>DigiLocker complete</h1>
  <p>Return to the IBO app to continue verification (PAN / selfie if required).</p>
  <p><a id="open" href="{deep_attr}">Open IBO app</a></p>
</div>
<script>
  (function() {{
    var deep = {deep_js};
    var requestId = {request_id_js};
    function notifyApp() {{
      try {{
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {{
          window.ReactNativeWebView.postMessage(JSON.stringify({{
            type: "digilocker_return",
            requestId: requestId,
            deep: deep
          }}));
        }}
      }} catch (e) {{}}
    }}
    function go() {{
      notifyApp();
      try {{ window.location.href = deep; }} catch (e) {{}}
    }}
    notifyApp();
    go();
    setTimeout(go, 400);
  }})();
</script>
</body></html>"""
    return HTMLResponse(content=page)


@api_router.post("/kyc/digilocker/complete")
async def kyc_digilocker_complete(
    body: Optional[Dict[str, Any]] = None,
    current_user: dict = Depends(get_current_user),
):
    """Pull e-Aadhaar from Signzy after browser redirect (local dev / missed webhook)."""
    from services.digilocker import (
        SignzyApiError,
        enrich_digilocker_payload_with_details,
        fetch_digilocker_eaadhaar,
        parse_digilocker_callback,
    )

    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("kyc_enabled", "KYC verification is currently paused by admin")

    uid = current_user["uid"]
    record = await db.kyc.find_one({"uid": uid})
    if not record:
        raise HTTPException(400, "No DigiLocker session found. Start verification first.")

    status = record.get("status")
    if status in ("awaiting_pan", "awaiting_selfie", "face_match_failed", "pan_verify_failed", "approved"):
        return {"ok": True, "status": status, "already_processed": True}

    stored_rid = str(record.get("digilocker_request_id") or "").strip()
    body_rid = str((body or {}).get("request_id") or "").strip()
    if body_rid and stored_rid and body_rid != stored_rid:
        logger.warning(
            "[DigiLocker] complete rejected — request_id mismatch uid=%s stored=%s body=%s",
            uid,
            stored_rid,
            body_rid,
        )
        raise HTTPException(
            status_code=403,
            detail="DigiLocker request_id does not match your active verification session.",
        )

    request_id = stored_rid or body_rid
    if not request_id:
        raise HTTPException(400, "Missing DigiLocker request_id")

    owner = await db.kyc.find_one(
        {"digilocker_request_id": request_id},
        {"uid": 1},
    )
    if owner and owner.get("uid") != uid:
        logger.warning(
            "[DigiLocker] complete rejected — session owned by another uid=%s owner=%s requestId=%s",
            uid,
            owner.get("uid"),
            request_id,
        )
        raise HTTPException(
            status_code=403,
            detail="This DigiLocker session belongs to another account.",
        )

    if status not in ("digilocker_pending", "digilocker_failed"):
        raise HTTPException(
            400,
            f"Cannot complete DigiLocker while KYC status is '{status}'. "
            "If you submitted manual documents earlier, wait for admin review or contact support.",
        )

    try:
        payload = await fetch_digilocker_eaadhaar(str(request_id))
        payload = await enrich_digilocker_payload_with_details(str(request_id), payload)
    except SignzyApiError as exc:
        logger.error("[DigiLocker] complete fetch failed uid=%s requestId=%s: %s", uid, request_id, exc.message)
        raise HTTPException(exc.http_status, exc.message) from exc
    except ValueError as exc:
        msg = str(exc)
        if "not completed" in msg.lower() or "not found" in msg.lower():
            return {"ok": False, "status": status, "message": msg}
        logger.error("[DigiLocker] complete fetch failed uid=%s requestId=%s: %s", uid, request_id, exc)
        raise HTTPException(502, msg) from exc

    kyc_data = parse_digilocker_callback(payload)
    if kyc_data.status != "success":
        return {
            "ok": False,
            "status": status,
            "message": "DigiLocker authorization is not complete yet. Try again in a few seconds.",
        }

    final_status = await _apply_digilocker_success(uid, str(request_id), payload)
    return {"ok": True, "status": final_status}


@api_router.post("/kyc/digilocker/callback")
async def kyc_digilocker_callback(request: Request):
    """Webhook from Signzy — called after the user completes DigiLocker auth.

    This endpoint is PUBLIC (no user auth) — Signzy calls it directly.
    We verify the request by matching ``requestId`` to a pending KYC record and
    only accept callbacks while status is ``digilocker_pending``.
    """
    from services.digilocker import parse_digilocker_callback

    if db is None:
        raise HTTPException(503, "Database unavailable")

    verify_auth = (os.getenv("SIGNZY_CALLBACK_VERIFY_AUTH") or "").strip().lower() in (
        "true",
        "1",
        "yes",
    )
    if verify_auth:
        expected = (
            os.getenv("SIGNZY_DIGILOCKER_CALLBACK_SECRET") or os.getenv("SIGNZY_API_KEY") or ""
        ).strip()
        auth_header = (request.headers.get("Authorization") or "").strip()
        if expected and auth_header != expected:
            logger.warning("[DigiLocker] Callback rejected — Authorization mismatch")
            raise HTTPException(status_code=403, detail="Forbidden")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid JSON payload")

    logger.info("[DigiLocker] callback received keys=%s", list(payload.keys()))

    kyc_data = parse_digilocker_callback(payload)
    request_id = kyc_data.request_id

    if not request_id:
        logger.warning("[DigiLocker] Callback missing requestId — ignored")
        return {"ok": True}

    record = await db.kyc.find_one(
        {"digilocker_request_id": request_id},
        {"uid": 1, "status": 1},
    )
    if not record:
        logger.warning("[DigiLocker] No KYC record for requestId=%s", request_id)
        return {"ok": True}

    uid = record["uid"]
    now = datetime.now(timezone.utc).isoformat()

    if record.get("status") != "digilocker_pending":
        logger.warning(
            "[DigiLocker] Callback ignored (not pending) uid=%s requestId=%s status=%s",
            uid,
            request_id,
            record.get("status"),
        )
        return {"ok": True}

    if kyc_data.status != "success":
        logger.warning("[DigiLocker] Auth failed uid=%s requestId=%s status=%s", uid, request_id, kyc_data.status)
        await db.kyc.update_one(
            {"uid": uid},
            {"$set": {
                "status": "digilocker_failed",
                "digilocker_failure_reason": kyc_data.event,
                "updated_at": now,
            }},
        )
        return {"ok": True}

    from services.digilocker import enrich_digilocker_payload_with_details

    payload = await enrich_digilocker_payload_with_details(request_id, payload)
    await _apply_digilocker_success(uid, request_id, payload)
    return {"ok": True}


@api_router.post("/admin/kyc/{uid}/approve")
async def admin_approve_kyc(uid: str, auth: AdminAuthContext = Depends(resolve_admin_auth)):
    """Admin: approve KYC for a user."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_kyc")
    now = datetime.now(timezone.utc).isoformat()
    await db.kyc.update_one(
        {"uid": uid},
        {"$set": {"status": "approved", "reviewed_at": now, "rejection_reason": None, "kyc_tier": "tier_1", "updated_at": now}},
    )
    await db.users.update_one({"uid": uid}, {"$set": {"kyc_status": "approved", "kyc_tier": "tier_1"}})
    await compliance_service.recompute_aml_risk_for_user(db, uid)
    try:
        bonus_result = await signup_bonus_svc.credit_signup_bonus_on_kyc_approval(db, uid)
        if bonus_result.get("credited"):
            logger.info(
                "admin_approve_kyc: signup bonus credited uid=%s credited=%d",
                uid, bonus_result["credited"],
            )
    except Exception:  # noqa: BLE001
        logger.exception("admin_approve_kyc: signup bonus credit trigger failed uid=%s", uid)
    try:
        await referral_svc.credit_referral_rewards_on_kyc_approval(db, uid)
    except Exception:  # noqa: BLE001
        logger.exception("admin_approve_kyc: referral reward credit trigger failed uid=%s", uid)
    await log_admin_audit(auth, "kyc_approve", "user", uid)
    logger.info(f"KYC approved for {uid}")
    return {"ok": True, "message": f"KYC approved for {uid}"}


@api_router.post("/admin/kyc/{uid}/reject")
async def admin_reject_kyc(uid: str, body: dict, auth: AdminAuthContext = Depends(resolve_admin_auth)):
    """Admin: reject KYC for a user with a reason."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_kyc")
    now    = datetime.now(timezone.utc).isoformat()
    reason = body.get("reason", "Documents were insufficient or invalid")
    await db.kyc.update_one(
        {"uid": uid},
        {"$set": {"status": "rejected", "reviewed_at": now, "rejection_reason": reason, "kyc_tier": "tier_0", "updated_at": now}},
    )
    await db.users.update_one({"uid": uid}, {"$set": {"kyc_status": "rejected", "kyc_tier": "tier_0"}})
    await compliance_service.recompute_aml_risk_for_user(db, uid)
    await log_admin_audit(auth, "kyc_reject", "user", uid, {"reason": reason})
    logger.info(f"KYC rejected for {uid}: {reason}")
    return {"ok": True, "message": f"KYC rejected for {uid}"}


@api_router.patch("/admin/kyc/{uid}/risk")
async def admin_patch_kyc_risk(
    uid: str,
    body: KycRiskPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    clean_tags = sorted({
        str(t).strip().lower().replace(" ", "_")
        for t in (body.risk_tags or [])
        if str(t).strip()
    })
    updates: Dict[str, Any] = {
        "risk_tags": clean_tags,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.pep_flag is not None:
        updates["pep_flag"] = bool(body.pep_flag)
    if body.sanctions_flag is not None:
        updates["sanctions_flag"] = bool(body.sanctions_flag)
    if body.note is not None:
        updates["risk_note"] = body.note
    await db.kyc.update_one({"uid": uid}, {"$set": updates}, upsert=True)
    await log_admin_audit(auth, "kyc_risk_patch", "user", uid, {"updates": updates})
    row = await db.kyc.find_one({"uid": uid}, {"_id": 0, "risk_tags": 1, "pep_flag": 1, "sanctions_flag": 1, "risk_note": 1})
    return {"uid": uid, **(row or {})}


@api_router.patch("/admin/kyc/{uid}/tier")
async def admin_patch_kyc_tier(
    uid: str,
    body: KycTierPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    tier = body.kyc_tier.strip()
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"uid": uid}, {"$set": {"kyc_tier": tier, "kyc_tier_updated_at": now}})
    await db.kyc.update_one({"uid": uid}, {"$set": {"kyc_tier": tier, "updated_at": now}}, upsert=True)
    await log_admin_audit(auth, "kyc_tier_patch", "user", uid, {"kyc_tier": tier})
    await compliance_service.recompute_aml_risk_for_user(db, uid)
    return {"ok": True, "uid": uid, "kyc_tier": tier}


@api_router.post("/admin/kyc/{uid}/re-request")
async def admin_rerequest_kyc(
    uid: str,
    body: AdminActionBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    now = datetime.now(timezone.utc).isoformat()
    reason = (body.notes or "").strip() or "Please re-submit KYC documents for additional verification."
    await db.kyc.update_one(
        {"uid": uid},
        {"$set": {
            "status": "re_request",
            "reviewed_at": now,
            "rejection_reason": reason,
        }},
        upsert=True,
    )
    await db.users.update_one({"uid": uid}, {"$set": {"kyc_status": "pending"}})
    await log_admin_audit(auth, "kyc_rerequest", "user", uid, {"reason": reason})
    return {"ok": True, "uid": uid, "status": "re_request", "reason": reason}


@api_router.get("/admin/compliance/cases")
async def admin_list_compliance_cases(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    case_type: Optional[str] = None,
    status: Optional[str] = None,
    uid: Optional[str] = None,
    risk_level: Optional[str] = None,
    q: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    filt: Dict[str, Any] = {}
    if case_type:
        filt["case_type"] = case_type.strip().lower()
    if status:
        filt["status"] = status.strip().lower()
    if uid:
        filt["uid"] = uid.strip()
    if risk_level:
        filt["risk_level"] = risk_level.strip().lower()
    if q and q.strip():
        rx = {"$regex": q.strip(), "$options": "i"}
        filt["$or"] = [{"title": rx}, {"notes": rx}, {"uid": rx}, {"id": rx}]
    cur = db.compliance_cases.find(filt, {"_id": 0}).sort("updated_at", -1).skip(skip).limit(limit)
    items = await cur.to_list(limit)
    total = await db.compliance_cases.count_documents(filt)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.post("/admin/compliance/cases", status_code=201)
async def admin_create_compliance_case(
    body: ComplianceCaseCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": f"cmp_{uuid.uuid4().hex[:16]}",
        "case_type": body.case_type.strip().lower(),
        "uid": (body.uid or "").strip() or None,
        "title": body.title.strip(),
        "notes": (body.notes or "").strip(),
        "status": "open",
        "risk_level": body.risk_level.strip().lower(),
        "assignee_aid": None,
        "attachments": [],
        "created_at": now,
        "updated_at": now,
        "created_by": (auth.admin or {}).get("aid"),
    }
    await db.compliance_cases.insert_one(row)
    await log_admin_audit(auth, "compliance_case_create", "compliance_case", row["id"], {
        "case_type": row["case_type"], "uid": row["uid"], "risk_level": row["risk_level"],
    })
    return row


@api_router.patch("/admin/compliance/cases/{case_id}")
async def admin_patch_compliance_case(
    case_id: str,
    body: ComplianceCasePatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = (auth.admin or {}).get("aid")
    row = await db.compliance_cases.find_one_and_update(
        {"id": case_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Compliance case not found")
    row.pop("_id", None)
    await log_admin_audit(auth, "compliance_case_patch", "compliance_case", case_id, {"updates": list(updates.keys())})
    return row


@api_router.post("/admin/compliance/cases/{case_id}/attachments")
async def admin_add_compliance_attachment(
    case_id: str,
    body: ComplianceAttachmentCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    now = datetime.now(timezone.utc).isoformat()
    att = {
        "id": f"att_{uuid.uuid4().hex[:14]}",
        "name": body.name.strip(),
        "url": body.url.strip(),
        "mime_type": (body.mime_type or "").strip() or None,
        "note": (body.note or "").strip() or None,
        "created_at": now,
        "created_by": (auth.admin or {}).get("aid"),
    }
    row = await db.compliance_cases.find_one_and_update(
        {"id": case_id},
        {"$push": {"attachments": att}, "$set": {"updated_at": now, "updated_by": (auth.admin or {}).get("aid")}},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Compliance case not found")
    row.pop("_id", None)
    await log_admin_audit(auth, "compliance_case_attachment_add", "compliance_case", case_id, {"attachment_id": att["id"], "name": att["name"]})
    return {"ok": True, "case_id": case_id, "attachment": att}


@api_router.get("/admin/compliance/dashboard")
async def admin_compliance_dashboard(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    total_cases = await db.compliance_cases.count_documents({})
    open_cases = await db.compliance_cases.count_documents({"status": {"$in": ["open", "in_review", "escalated"]}})
    high_risk = await db.compliance_cases.count_documents({"risk_level": {"$in": ["high", "critical"]}})
    pending_kyc = await db.kyc.count_documents({"status": {"$in": ["pending", "re_request"]}})
    pep_count = await db.kyc.count_documents({"pep_flag": True})
    sanctions_count = await db.kyc.count_documents({"sanctions_flag": True})
    by_type_rows = await db.compliance_cases.aggregate([
        {"$group": {"_id": "$case_type", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(20)
    return {
        "cases_total": int(total_cases),
        "cases_open": int(open_cases),
        "cases_high_risk": int(high_risk),
        "kyc_pending_or_rerequest": int(pending_kyc),
        "kyc_pep_flagged": int(pep_count),
        "kyc_sanctions_flagged": int(sanctions_count),
        "cases_by_type": [{"type": r.get("_id"), "count": int(r.get("count") or 0)} for r in by_type_rows],
    }


def _norm_wallet_address(value: str) -> str:
    return str(value or "").strip().lower()


def _default_screening_config() -> Dict[str, Any]:
    return {
        "enabled": True,
        "min_match_score": 0.8,
        "fail_closed": False,
        "block_on_wallet_blacklist": True,
        "block_on_sanctions": True,
        "monitor_large_trade_usdt": 25000.0,
        "monitor_daily_turnover_usdt": 100000.0,
        "velocity_withdraw_count_24h": 3,
        "updated_at": None,
        "updated_by": None,
    }


def _parse_iso_window(date_from: str, date_to: str) -> Tuple[datetime, datetime]:
    try:
        dt_from = datetime.fromisoformat(str(date_from).replace("Z", "+00:00"))
        dt_to = datetime.fromisoformat(str(date_to).replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="date_from/date_to must be valid ISO datetime")
    if dt_from.tzinfo is None:
        dt_from = dt_from.replace(tzinfo=timezone.utc)
    if dt_to.tzinfo is None:
        dt_to = dt_to.replace(tzinfo=timezone.utc)
    if dt_from >= dt_to:
        raise HTTPException(status_code=400, detail="date_from must be earlier than date_to")
    return dt_from, dt_to


def _serialize_rows_csv(rows: List[Dict[str, Any]]) -> str:
    if not rows:
        return ""
    cols = sorted({k for row in rows for k in row.keys()})
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=cols)
    w.writeheader()
    for row in rows:
        w.writerow({c: row.get(c, "") for c in cols})
    return out.getvalue()


def _serialize_rows_xlsx_bytes(rows: List[Dict[str, Any]]) -> bytes:
    df = pd.DataFrame(rows or [])
    bio = io.BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Report", index=False)
    return bio.getvalue()


async def _get_screening_config() -> Dict[str, Any]:
    if db is None:
        return _default_screening_config()
    row = await db.platform_controls.find_one({"id": "global"}, {"_id": 0, "compliance_screening_config": 1})
    cfg = dict(_default_screening_config())
    cfg.update(((row or {}).get("compliance_screening_config") or {}))
    return cfg


@api_router.get("/admin/compliance/screening-config")
async def admin_get_compliance_screening_config(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    return await _get_screening_config()


@api_router.patch("/admin/compliance/screening-config")
async def admin_patch_compliance_screening_config(
    body: ComplianceScreeningConfigPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    now = datetime.now(timezone.utc).isoformat()
    updates["updated_at"] = now
    updates["updated_by"] = (auth.admin or {}).get("aid")
    await db.platform_controls.update_one(
        {"id": "global"},
        {"$set": {f"compliance_screening_config.{k}": v for k, v in updates.items()}},
        upsert=True,
    )
    await log_admin_audit(auth, "compliance_screening_config_patch", "platform_controls", "global", {"updates": updates})
    return await _get_screening_config()


@api_router.get("/admin/compliance/wallet-blacklist")
async def admin_list_wallet_blacklist(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    is_active: Optional[bool] = None,
    q: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    filt: Dict[str, Any] = {}
    if is_active is not None:
        filt["is_active"] = bool(is_active)
    if q and q.strip():
        rx = {"$regex": q.strip(), "$options": "i"}
        filt["$or"] = [{"wallet_address": rx}, {"network": rx}, {"reason": rx}, {"id": rx}]
    items = await db.wallet_blacklist.find(filt, {"_id": 0}).sort("updated_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.wallet_blacklist.count_documents(filt)
    return {"items": items, "total": int(total), "skip": skip, "limit": limit}


@api_router.post("/admin/compliance/wallet-blacklist", status_code=201)
async def admin_create_wallet_blacklist(
    body: ComplianceWalletBlacklistCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    now = datetime.now(timezone.utc).isoformat()
    wallet_norm = _norm_wallet_address(body.wallet_address)
    row = {
        "id": f"wbl_{uuid.uuid4().hex[:14]}",
        "wallet_address": body.wallet_address.strip(),
        "wallet_address_norm": wallet_norm,
        "network": body.network.strip().upper(),
        "reason": (body.reason or "").strip() or None,
        "risk_level": body.risk_level,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "created_by": (auth.admin or {}).get("aid"),
        "updated_by": (auth.admin or {}).get("aid"),
    }
    try:
        await db.wallet_blacklist.insert_one(row)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Wallet blacklist entry already exists")
    await log_admin_audit(auth, "wallet_blacklist_create", "wallet_blacklist", row["id"], {"wallet": row["wallet_address"], "network": row["network"]})
    return row


@api_router.patch("/admin/compliance/wallet-blacklist/{entry_id}")
async def admin_patch_wallet_blacklist(
    entry_id: str,
    body: ComplianceWalletBlacklistPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = (auth.admin or {}).get("aid")
    row = await db.wallet_blacklist.find_one_and_update({"id": entry_id}, {"$set": updates}, return_document=ReturnDocument.AFTER)
    if not row:
        raise HTTPException(status_code=404, detail="Wallet blacklist entry not found")
    row.pop("_id", None)
    await log_admin_audit(auth, "wallet_blacklist_patch", "wallet_blacklist", entry_id, {"updates": list(updates.keys())})
    return row


@api_router.get("/admin/compliance/sanctions")
async def admin_list_sanctions(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    is_active: Optional[bool] = None,
    q: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    filt: Dict[str, Any] = {}
    if is_active is not None:
        filt["is_active"] = bool(is_active)
    if q and q.strip():
        rx = {"$regex": q.strip(), "$options": "i"}
        filt["$or"] = [{"entity_name": rx}, {"aliases": rx}, {"reference_id": rx}, {"country": rx}, {"id": rx}]
    items = await db.sanctions_list.find(filt, {"_id": 0}).sort("updated_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.sanctions_list.count_documents(filt)
    return {"items": items, "total": int(total), "skip": skip, "limit": limit}


@api_router.post("/admin/compliance/sanctions", status_code=201)
async def admin_create_sanction(
    body: ComplianceSanctionCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    now = datetime.now(timezone.utc).isoformat()
    aliases = sorted({str(a).strip() for a in (body.aliases or []) if str(a).strip()})
    row = {
        "id": f"snc_{uuid.uuid4().hex[:14]}",
        "entity_name": body.entity_name.strip(),
        "entity_name_norm": body.entity_name.strip().lower(),
        "list_source": body.list_source.strip(),
        "reference_id": (body.reference_id or "").strip() or None,
        "country": (body.country or "").strip() or None,
        "risk_level": body.risk_level,
        "aliases": aliases,
        "notes": (body.notes or "").strip() or None,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "created_by": (auth.admin or {}).get("aid"),
        "updated_by": (auth.admin or {}).get("aid"),
    }
    await db.sanctions_list.insert_one(row)
    await log_admin_audit(auth, "sanction_create", "sanctions_list", row["id"], {"entity_name": row["entity_name"], "source": row["list_source"]})
    return row


@api_router.patch("/admin/compliance/sanctions/{entry_id}")
async def admin_patch_sanction(
    entry_id: str,
    body: ComplianceSanctionPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = (auth.admin or {}).get("aid")
    row = await db.sanctions_list.find_one_and_update({"id": entry_id}, {"$set": updates}, return_document=ReturnDocument.AFTER)
    if not row:
        raise HTTPException(status_code=404, detail="Sanction entry not found")
    row.pop("_id", None)
    await log_admin_audit(auth, "sanction_patch", "sanctions_list", entry_id, {"updates": list(updates.keys())})
    return row


@api_router.post("/admin/compliance/sanctions/sync")
async def admin_sync_sanctions(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    now = datetime.now(timezone.utc).isoformat()
    run_id = f"ssr_{uuid.uuid4().hex[:12]}"
    sample_rows = [
        {"entity_name": "Example Sanctioned Entity A", "country": "IR", "reference_id": "OFAC-SAMPLE-001"},
        {"entity_name": "Example Sanctioned Entity B", "country": "KP", "reference_id": "UN-SAMPLE-210"},
    ]
    upserts = 0
    for item in sample_rows:
        q = {"entity_name_norm": item["entity_name"].lower(), "list_source": "sample_feed"}
        update = {
            "$set": {
                "entity_name": item["entity_name"],
                "entity_name_norm": item["entity_name"].lower(),
                "list_source": "sample_feed",
                "reference_id": item["reference_id"],
                "country": item["country"],
                "risk_level": "critical",
                "is_active": True,
                "updated_at": now,
                "updated_by": (auth.admin or {}).get("aid"),
            },
            "$setOnInsert": {"id": f"snc_{uuid.uuid4().hex[:14]}", "aliases": [], "created_at": now, "created_by": (auth.admin or {}).get("aid")},
        }
        res = await db.sanctions_list.update_one(q, update, upsert=True)
        upserts += int(bool(res.upserted_id or res.modified_count))
    await db.sanctions_sync_runs.insert_one({
        "id": run_id,
        "status": "completed",
        "source": "sample_feed",
        "started_at": now,
        "completed_at": now,
        "upserted_count": upserts,
        "error": None,
        "triggered_by": (auth.admin or {}).get("aid"),
    })
    await log_admin_audit(auth, "sanctions_sync_run", "sanctions_sync_runs", run_id, {"upserted_count": upserts})
    return {"ok": True, "run_id": run_id, "status": "completed", "upserted_count": upserts}


@api_router.get("/admin/compliance/sanctions/sync-status")
async def admin_sanctions_sync_status(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    last = await db.sanctions_sync_runs.find_one({}, {"_id": 0}, sort=[("started_at", -1)])
    total_active = await db.sanctions_list.count_documents({"is_active": True})
    return {"last_run": last, "active_sanctions": int(total_active)}


@api_router.get("/admin/compliance/rules")
async def admin_list_compliance_rules(auth: AdminAuthContext = Depends(resolve_admin_auth)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    items = await db.compliance_rules.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return {"items": items}


@api_router.post("/admin/compliance/rules", status_code=201)
async def admin_create_compliance_rule(
    body: ComplianceRuleCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    now = datetime.now(timezone.utc).isoformat()
    rid = f"rule_{uuid.uuid4().hex[:12]}"
    row = {
        "id": rid,
        "name": body.name.strip(),
        "enabled": bool(body.enabled),
        "rule_kind": body.rule_kind.strip(),
        "params": body.params or {},
        "severity_default": "medium",
        "created_at": now,
        "updated_at": now,
        "created_by": (auth.admin or {}).get("aid"),
    }
    await db.compliance_rules.insert_one(row)
    await log_admin_audit(auth, "compliance_rule_create", "compliance_rules", rid, {"rule_kind": row["rule_kind"]})
    return row


@api_router.patch("/admin/compliance/rules/{rule_id}")
async def admin_patch_compliance_rule(
    rule_id: str,
    body: ComplianceRulePatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = (auth.admin or {}).get("aid")
    row = await db.compliance_rules.find_one_and_update({"id": rule_id}, {"$set": updates}, return_document=ReturnDocument.AFTER)
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    row.pop("_id", None)
    await log_admin_audit(auth, "compliance_rule_patch", "compliance_rules", rule_id, {"updates": list(updates.keys())})
    return row


@api_router.get("/admin/compliance/transaction-monitoring")
async def admin_transaction_monitoring(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    source: str = Query("live", pattern=r"^(live|stored)$"),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    cfg = await _get_screening_config()
    if source == "stored":
        items, total = await compliance_service.list_tx_monitor_events(db, 0, limit)
        return {
            "items": items,
            "count": len(items),
            "total": total,
            "source": "stored",
            "thresholds": {
                "large_trade_usdt": float(cfg.get("monitor_large_trade_usdt") or 25000.0),
                "daily_turnover_usdt": float(cfg.get("monitor_daily_turnover_usdt") or 100000.0),
            },
        }
    dt_to = datetime.now(timezone.utc)
    dt_from = dt_to - timedelta(days=7)
    if date_from and date_to:
        dt_from, dt_to = _parse_iso_window(date_from, date_to)
    tf = dt_from.isoformat()
    tt = dt_to.isoformat()
    events = await compliance_service.build_tx_monitor_events(db, cfg, tf, tt, limit)
    return {
        "items": events,
        "count": len(events),
        "source": "live",
        "thresholds": {
            "large_trade_usdt": float(cfg.get("monitor_large_trade_usdt") or 25000.0),
            "daily_turnover_usdt": float(cfg.get("monitor_daily_turnover_usdt") or 100000.0),
            "velocity_withdraw_count_24h": int(cfg.get("velocity_withdraw_count_24h") or 3),
        },
    }


@api_router.post("/admin/compliance/transaction-monitoring/run")
async def admin_run_transaction_monitoring(
    body: ComplianceMonitorRunBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    cfg = dict(await _get_screening_config())
    large_trade = body.large_trade_usdt if body.large_trade_usdt is not None else float(cfg.get("monitor_large_trade_usdt") or 25000.0)
    daily_turnover = body.daily_turnover_usdt if body.daily_turnover_usdt is not None else float(cfg.get("monitor_daily_turnover_usdt") or 100000.0)
    cfg["monitor_large_trade_usdt"] = large_trade
    cfg["monitor_daily_turnover_usdt"] = daily_turnover
    dt_to = datetime.now(timezone.utc)
    dt_from = dt_to - timedelta(days=7)
    tf = dt_from.isoformat()
    tt = dt_to.isoformat()
    items = await compliance_service.build_tx_monitor_events(db, cfg, tf, tt, 200)
    persisted, _ = await compliance_service.persist_tx_monitor_events(db, items, source="manual_run")
    if persisted:
        url, min_sev = await _alert_webhook_params()
        try:
            await alert_service.raise_alert(
                type="compliance.tx_monitor.manual_run",
                severity="warn",
                source="system",
                title="Transaction monitoring run",
                message=f"{persisted} new monitoring event(s) saved.",
                meta={"items": len(items), "persisted": persisted},
                dedupe_key=f"compliance.tx_monitor.manual:{tf[:10]}:{len(items)}:{persisted}",
                webhook_url=url,
                webhook_min_severity=min_sev,
            )
        except Exception:  # noqa: BLE001
            logger.exception("transaction_monitoring_run: alert emit failed")
    created_cases = 0
    if body.emit_cases:
        now = datetime.now(timezone.utc).isoformat()
        for ev in items[:50]:
            case = {
                "id": f"cmp_{uuid.uuid4().hex[:16]}",
                "case_type": "str",
                "uid": ev.get("uid"),
                "title": f"Monitoring: {ev.get('event_type')} ({ev.get('amount_usdt')} USDT)",
                "notes": ev.get("reason"),
                "status": "open",
                "risk_level": "high" if ev.get("severity") == "high" else "medium",
                "assignee_aid": None,
                "attachments": [],
                "created_at": now,
                "updated_at": now,
                "created_by": (auth.admin or {}).get("aid"),
            }
            await db.compliance_cases.insert_one(case)
            created_cases += 1
    await log_admin_audit(auth, "transaction_monitoring_run", "compliance_monitoring", "manual", {"items": len(items), "created_cases": created_cases, "persisted": persisted, "large_trade_usdt": large_trade, "daily_turnover_usdt": daily_turnover})
    return {"ok": True, "items_found": len(items), "persisted": persisted, "created_cases": created_cases, "thresholds": {"large_trade_usdt": large_trade, "daily_turnover_usdt": daily_turnover}}


def _build_ctr_rows(wallet_txns: List[Dict[str, Any]], threshold_usdt: float) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for w in wallet_txns:
        amt = abs(float(w.get("amount") or 0.0))
        if amt < threshold_usdt:
            continue
        rows.append({
            "txn_id": w.get("id"),
            "uid": w.get("uid"),
            "asset": w.get("asset"),
            "amount": amt,
            "type": w.get("type"),
            "direction": w.get("direction"),
            "created_at": w.get("created_at"),
            "reason": f"Cash-equivalent movement >= {threshold_usdt:.2f}",
        })
    return rows


def _build_str_rows(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for e in events:
        rows.append({
            "event_type": e.get("event_type"),
            "uid": e.get("uid"),
            "ref_id": e.get("ref_id"),
            "symbol": e.get("symbol"),
            "amount_usdt": e.get("amount_usdt"),
            "severity": e.get("severity"),
            "created_at": e.get("created_at"),
            "reason": e.get("reason"),
        })
    return rows


@api_router.post("/admin/compliance/reports", status_code=201)
async def admin_generate_compliance_report(
    body: ComplianceReportCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    dt_from, dt_to = _parse_iso_window(body.date_from, body.date_to)
    tf = dt_from.isoformat()
    tt = dt_to.isoformat()
    report_type = body.report_type.strip().lower()
    output_format = body.output_format.strip().lower()
    threshold = float(body.threshold_usdt or 10000.0)
    rows: List[Dict[str, Any]] = []
    if report_type == "ctr":
        wallet_rows = await db.wallet_txns.find({"created_at": {"$gte": tf, "$lte": tt}}, {"_id": 0}).to_list(20000)
        rows = _build_ctr_rows(wallet_rows, threshold)
    else:
        monitoring = await admin_transaction_monitoring(auth=auth, date_from=tf, date_to=tt, limit=500)
        rows = _build_str_rows(monitoring.get("items") or [])
    now = datetime.now(timezone.utc).isoformat()
    report_id = f"rpt_{uuid.uuid4().hex[:14]}"
    file_name = f"{report_type.upper()}_{dt_from.strftime('%Y%m%d')}_{dt_to.strftime('%Y%m%d')}.{output_format}"
    payload_text = ""
    payload_bytes = b""
    mime = "application/json"
    if output_format == "csv":
        payload_text = _serialize_rows_csv(rows)
        payload_bytes = payload_text.encode("utf-8")
        mime = "text/csv"
    elif output_format == "xlsx":
        payload_bytes = _serialize_rows_xlsx_bytes(rows)
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        payload_text = json.dumps(rows, ensure_ascii=False, indent=2)
        payload_bytes = payload_text.encode("utf-8")
    row = {
        "id": report_id,
        "report_type": report_type,
        "output_format": output_format,
        "date_from": tf,
        "date_to": tt,
        "threshold_usdt": threshold,
        "notes": (body.notes or "").strip() or None,
        "rows_count": len(rows),
        "status": "ready",
        "file_name": file_name,
        "mime_type": mime,
        "payload_b64": base64.b64encode(payload_bytes).decode("ascii"),
        "created_at": now,
        "created_by": (auth.admin or {}).get("aid"),
        "fiu_status": "draft",
    }
    await db.compliance_reports.insert_one(row)
    await log_admin_audit(auth, "compliance_report_generate", "compliance_report", report_id, {"report_type": report_type, "format": output_format, "rows": len(rows)})
    return {"id": report_id, "report_type": report_type, "output_format": output_format, "rows_count": len(rows), "status": "ready", "file_name": file_name, "fiu_status": "draft"}


@api_router.get("/admin/compliance/reports")
async def admin_list_compliance_reports(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    report_type: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    filt: Dict[str, Any] = {}
    if report_type:
        filt["report_type"] = report_type.strip().lower()
    items = await db.compliance_reports.find(filt, {"_id": 0, "payload_b64": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.compliance_reports.count_documents(filt)
    return {"items": items, "total": int(total), "skip": skip, "limit": limit}


@api_router.get("/admin/compliance/reports/{report_id}/download")
async def admin_download_compliance_report(
    report_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_compliance")
    row = await db.compliance_reports.find_one({"id": report_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    payload_b64 = row.get("payload_b64")
    if not payload_b64:
        raise HTTPException(status_code=404, detail="Report artifact not available")
    data = base64.b64decode(payload_b64)
    return StreamingResponse(
        io.BytesIO(data),
        media_type=row.get("mime_type") or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{row.get("file_name") or "compliance_report"}"'},
    )


@api_router.post("/admin/compliance/reports/{report_id}/fiu-submit")
async def admin_submit_compliance_report_fiu(
    report_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_compliance")
    exists = await db.compliance_reports.find_one({"id": report_id}, {"_id": 0, "id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Report not found")
    res = await compliance_service.submit_fiu_report(
        db,
        report_id=report_id,
        admin_aid=(auth.admin or {}).get("aid"),
    )
    if not res.get("ok"):
        await log_admin_audit(auth, "compliance_report_fiu_submit_failed", "compliance_report", report_id, res)
        raise HTTPException(status_code=502, detail=res.get("error") or "FIU submission failed")
    await log_admin_audit(auth, "compliance_report_fiu_submit", "compliance_report", report_id, {"submission_id": res.get("submission_id")})
    row = await db.compliance_reports.find_one({"id": report_id}, {"_id": 0, "fiu_status": 1, "fiu_submitted_at": 1, "fiu_submission_id": 1})
    return {"ok": True, "id": report_id, **(row or {}), "submission": res}


# ── Wallet Routes ─────────────────────────────────────────────────────────────


async def _wallet_balances_for_uid(uid: str) -> List[WalletBalanceOut]:
    """All wallet rows for a user (shared by REST and exchange account WebSocket)."""
    if db is None:
        return []
    docs = await db.wallets.find({"uid": uid}, {"_id": 0}).to_list(100)
    for doc in docs:
        if abs(doc.get("locked", 0)) < 1e-7:
            doc["locked"] = 0.0
    return [
        WalletBalanceOut(
            asset=d["asset"],
            available=float(d.get("available", 0)),
            locked=float(d.get("locked", 0)),
        )
        for d in docs
    ]


async def _open_orders_for_uid(uid: str) -> List[OrderOut]:
    if db is None:
        return []
    docs = await db.orders.find(
        {"uid": uid, "status": {"$in": ["open", "partially_filled"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return [OrderOut(**d) for d in docs]


async def _order_history_for_uid(uid: str) -> List[OrderOut]:
    if db is None:
        return []
    docs = await db.orders.find(
        {"uid": uid, "status": {"$in": ["filled", "cancelled"]}},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(500)
    return [OrderOut(**d) for d in docs]


async def _user_trades_for_uid(uid: str) -> List[UserTradeOut]:
    if db is None:
        return []
    docs_asc = await db.trades.find(
        {"$or": [{"taker_uid": uid}, {"maker_uid": uid}]}, {"_id": 0},
    ).sort("created_at", 1).to_list(10000)
    pnl_map = _user_fill_realized_pnl_map(uid, docs_asc)
    docs_show = list(reversed(docs_asc))[:500]
    result: List[UserTradeOut] = []
    for d in docs_show:
        is_taker = d.get("taker_uid") == uid
        side = d["taker_side"] if is_taker else d["maker_side"]
        fee = float(d["taker_fee"] if is_taker else (d.get("maker_fee") or 0.0))
        fee_ast = d["taker_fee_asset"] if is_taker else d.get("maker_fee_asset", "USDT")
        oid = d["taker_order_id"] if is_taker else d["maker_order_id"]
        rp = pnl_map.get(d["id"])
        liq_source = str(d.get("liquidity_source") or ("SYSTEM" if d.get("maker_uid") == "SYSTEM" else "USER")).upper()
        result.append(UserTradeOut(
            id=d["id"], symbol=d["symbol"], side=side,
            price=d["price"], amount=d["amount"],
            fee=fee, fee_asset=fee_ast, order_id=oid,
            created_at=d["created_at"],
            realized_pnl=rp,
            liquidity_source=liq_source,
        ))
    return result


@api_router.get("/wallet/deposit-addresses", response_model=List[DepositAddressPublic])
async def list_public_deposit_addresses(
    asset: str = Query(..., description="Asset symbol, e.g. USDT"),
    network: str = Query(..., description="Exact network label for that asset"),
    current_user: dict = Depends(get_current_user),
):
    """Return the authenticated user's HD-derived deposit address for (asset, network).

    Phase 4 behaviour (new CEX-only flow):

    - Auth is **required** — anonymous callers get 401.
    - The shared admin-curated hot-wallet fallback has been removed; every
      row returned is the caller's own HD-derived address.
    - If the blockchain provider is disabled or doesn't support this
      (asset, network) pair, an empty list is returned so the UI can show
      "not available yet" instead of reusing a shared address.

    Security: the response only ever exposes the **public** address
    string, the QR payload, and a human label. Private keys and
    derivation paths never cross this API boundary.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    ast = asset.strip().upper()
    net = (network or "").strip()
    if not _deposit_asset_network_ok(ast, net):
        raise HTTPException(status_code=400, detail="Unsupported asset or invalid network for this asset")
    await sync_blockchain_chain_admin()
    if blockchain_normalise_network(ast, net) is None:
        raise HTTPException(
            status_code=400,
            detail=f"Blockchain provider does not support {ast} on {net}",
        )

    try:
        personal = await _get_or_create_user_deposit_address(
            current_user["uid"], ast, network,
        )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("deposit-addresses: personal address lookup failed")
        return []

    if not personal or not (personal.get("address") or "").strip() or not personal.get("enabled", True):
        return []

    return [
        DepositAddressPublic(
            id=personal["id"],
            asset=ast,
            network=network,
            address=(personal.get("address") or "").strip(),
            qr_payload=_qr_payload_from_deposit_address_doc(personal),
            label=(personal.get("label") or "Your deposit address"),
        )
    ]


@api_router.get("/wallet/assets")
async def get_supported_assets():
    """Assets with live + planned networks from the blockchain provider."""
    await sync_blockchain_chain_admin()
    try:
        provider: BlockchainProvider = blockchain_service.get_provider()
        rows = provider.list_supported_networks()
    except Exception:  # noqa: BLE001
        logger.exception("wallet/assets: provider query failed")
        rows = []
    by_asset: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        ast = row.get("asset")
        if not ast:
            continue
        by_asset.setdefault(ast, []).append({
            "network": row.get("network"),
            "label": row.get("label"),
            "chain": row.get("chain"),
            "chain_id": row.get("chain_id"),
            "testnet": row.get("testnet", False),
            "deposit_enabled": row.get("deposit_enabled", False),
            "withdraw_enabled": row.get("withdraw_enabled", False),
            "status": row.get("status", "active"),
        })
    out = []
    seen_assets = set()
    for ast in SUPPORTED_ASSETS:
        seen_assets.add(ast)
        out.append({"asset": ast, "networks": by_asset.get(ast, [])})
    for ast, nets in sorted(by_asset.items()):
        if ast not in seen_assets:
            out.append({"asset": ast, "networks": nets})
    return out


@api_router.get("/wallet/chains")
async def get_wallet_chains():
    """QuickNode chain infrastructure summary (public, tokens masked)."""
    from services.blockchain_chain_controls import normalize_blockchain_chain_settings
    from services.rpc_endpoints import get_registry, mask_rpc_url

    await sync_blockchain_chain_admin()
    reg = get_registry()
    admin = normalize_blockchain_chain_settings(
        (await get_platform_controls()).get("blockchain_chain_settings"),
    )
    out = []
    for env_ep in reg.all_chains_env():
        if not env_ep.http_url:
            continue
        eff = reg.get(env_ep.chain_id)
        out.append({
            "chain_id": env_ep.chain_id,
            "label": env_ep.label,
            "admin_enabled": admin.get(env_ep.chain_id, True),
            "deposit_scan_enabled": eff.deposit_scan_enabled,
            "http_configured": True,
            "ws_configured": bool(eff.ws_url),
            "http_host": mask_rpc_url(env_ep.http_url),
        })
    return out


@api_router.get("/wallet/supported-networks")
async def get_supported_networks():
    """Return (asset, network) pairs for wallet deposit/withdraw UIs.

    Includes ``deposit_enabled``, ``withdraw_enabled``, ``status``, and
    ``chain_id`` so clients can show active rails vs coming-soon chains.
    Anonymous callers are allowed — no user-specific data.
    """
    await sync_blockchain_chain_admin()
    try:
        from listings.integration import merge_supported_networks

        provider: BlockchainProvider = blockchain_service.get_provider()
        base = provider.list_supported_networks()
        return merge_supported_networks(base)
    except Exception:  # noqa: BLE001
        logger.exception("supported-networks: provider query failed")
        return []


@api_router.get("/wallet/deposit-catalog")
async def get_wallet_deposit_catalog(
    chain: Optional[str] = Query(
        None,
        description="Filter by chain_id (e.g. bsc, eth, btc). Omit for all chains.",
    ),
    q: Optional[str] = Query(None, description="Search by symbol, name, or contract"),
    deposit_only: bool = Query(
        False,
        description="When true, only deposit-enabled rows (default shows full Web3 catalog)",
    ),
    include_all_listed: bool = Query(
        True,
        description="Include all admin-approved listed tokens on the chain",
    ),
    include_web3_directory: bool = Query(
        True,
        description="Merge CoinGecko BSC token directory when BSC_WEB3_CATALOG_ENABLED=1",
    ),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
):
    """Searchable deposit catalog for Web + mobile wallet UIs.

    Merges admin-listed tokens, platform rails, and optional CoinGecko BSC
    directory (thousands of Web3 tokens for search). Use ``q`` + pagination.
    """
    await sync_blockchain_chain_admin()
    try:
        from listings.deposit_catalog import build_deposit_catalog

        provider: BlockchainProvider = blockchain_service.get_provider()
        base = provider.list_supported_networks()
        return build_deposit_catalog(
            base,
            chain=chain,
            q=q,
            deposit_only=deposit_only,
            include_all_listed=include_all_listed,
            include_web3_directory=include_web3_directory,
            skip=skip,
            limit=limit,
        )
    except Exception:  # noqa: BLE001
        logger.exception("deposit-catalog: build failed")
        return {
            "items": [],
            "total": 0,
            "skip": skip,
            "limit": limit,
            "chain": (chain or "all").lower(),
            "bep20_universal": {"enabled": False, "network": "BEP-20 (BNB Chain)", "chain_id": "bsc", "note": ""},
        }


@api_router.post("/admin/web3-catalog/refresh")
async def admin_refresh_web3_catalog(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Force-expire the CoinGecko Web3 BSC catalog cache and re-fetch immediately.

    Useful when admin wants newly listed/ranked tokens to appear in the deposit
    catalog without waiting for the hourly background refresh cycle.
    """
    if auth.via_api_key or not auth.admin:
        raise HTTPException(status_code=403, detail="Admin JWT required")
    _require_admin_permission(auth, "manage_settings")
    try:
        import asyncio
        from listings.deposit_catalog import force_refresh_web3_catalog

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, force_refresh_web3_catalog)
        logger.info(
            "admin: web3 catalog force-refreshed — %d tokens (%d with contract)",
            result.get("total_web3_tokens", 0),
            result.get("with_contract_address", 0),
        )
        return result
    except Exception as exc:  # noqa: BLE001
        logger.exception("admin: web3 catalog force-refresh failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@api_router.get("/wallet/withdraw-config")
async def get_withdraw_config(
    network: Optional[str] = Query(None, description="Canonical network label for per-chain gas fee"),
    chain_id: Optional[str] = Query(None, description="Optional chain_id (bsc|eth|tron|…)"),
):
    """Public withdrawal fee/limit knobs for exchange + mobile UIs.

    Returns platform-wide settings only — no user-specific data. Clients use
    this to show fee breakdowns before the user submits a withdrawal.
    Gas fees are always billed in IBO; treasury pays native chain gas.
    """
    controls = await get_platform_controls()
    fee_rate = max(0.0, _control_float(controls, "withdraw_fee_rate", 0.0))
    net = (network or "").strip() or None
    if not net and chain_id:
        net = (chain_id or "").strip().lower()
    ibo_gas = ibo_fee_svc.resolve_withdraw_gas_fee_ibo(controls, net)
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price(controls)
    schedule = ibo_fee_svc.withdraw_gas_fee_schedule(controls)
    return {
        "withdraw_fee_rate": fee_rate,
        "withdraw_gas_fee_ibo": ibo_gas,
        "withdraw_gas_fee_ibo_by_chain": schedule,
        "withdraw_gas_network": net,
        "withdraw_gas_chain_id": ibo_fee_svc.network_to_chain_id(net) if net else None,
        "withdraw_min_usdt": max(0.0, _control_float(controls, "withdraw_min_usdt", 0.0)),
        "withdraw_max_usdt": max(0.0, _control_float(controls, "withdraw_max_usdt", 0.0)),
        "withdraw_daily_limit_usdt": max(0.0, _control_float(controls, "withdraw_daily_limit_usdt", 0.0)),
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "platform_fee_asset": ibo_fee_svc.FEE_ASSET,
        "ibo_price_usdt": ibo_px,
        "gas_fee_asset": ibo_fee_svc.FEE_ASSET,
        "gas_fee_label": "Network gas fee (IBO)",
        "platform_fee_description": (
            "Platform withdrawal fee is a percentage of the withdrawal's USDT notional, "
            "charged in IBO from your spot wallet. The on-chain transfer sends the full "
            "requested amount."
        ),
        "gas_fee_description": (
            "Network gas is paid by the platform in the chain's native coin "
            "(BNB on BNB Chain, ETH on Ethereum, TRX on Tron). You are charged the "
            "IBO amount configured by the exchange for this network — never in "
            "BNB/ETH/TRX."
        ),
    }


@api_router.get("/wallet/balances", response_model=List[WalletBalanceOut])
async def get_wallet_balances(current_user: dict = Depends(get_current_user)):
    """Return all wallet balances for the authenticated user."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    return await _wallet_balances_for_uid(current_user["uid"])


class IboSwapExecute(BaseModel):
    direction: Literal["ibo_to_usdt", "usdt_to_ibo"]
    amount: float = Field(..., gt=0, description="Amount in the source asset (IBO or USDT)")


@api_router.get("/wallet/swap/config")
async def get_swap_config():
    """Public IBO ↔ USDT swap fee knobs for exchange + mobile UIs."""
    controls = await get_platform_controls()
    swap_rate, swap_fixed = _swap_fee_from_controls(controls)
    _, taker_fee = _fee_rates_from_controls(controls)
    ibo_px = await _resolve_ibo_usdt_price(controls)
    return {
        "swap_fee_rate": swap_rate,
        "swap_fee_ibo_fixed": swap_fixed,
        "taker_fee_rate": taker_fee,
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "ibo_price_usdt": ibo_px,
        "swap_fee_description": (
            "Swap platform fee: percentage of swap USDT notional plus optional flat IBO, "
            "deducted from your IBO balance when the swap executes. "
            "The underlying IBOUSDT market order may also incur a trading fee in IBO."
        ),
    }


@api_router.get("/wallet/swap/quote")
async def wallet_swap_quote(
    direction: Literal["ibo_to_usdt", "usdt_to_ibo"] = Query(...),
    amount: float = Query(..., gt=0),
    current_user: dict = Depends(get_current_user),
):
    """Preview IBO ↔ USDT instant swap (executes as IBOUSDT market order)."""
    from services import ibo_swap as ibo_swap_svc

    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    enforce_user_actions_allowed(current_user)

    sym = ibo_swap_svc.SWAP_SYMBOL
    if sym not in SYMBOL_BASE_MAP:
        raise HTTPException(status_code=503, detail="IBO/USDT swap is not available.")

    uid = current_user["uid"]
    controls = await get_platform_controls()
    swap_rate, swap_fixed = _swap_fee_from_controls(controls)
    _, taker_fee = _fee_rates_from_controls(controls)

    price, bal_doc = await asyncio.gather(
        get_current_price(sym),
        db.wallets.find_one({"uid": uid, "asset": "IBO" if direction == "ibo_to_usdt" else "USDT"}, {"_id": 0, "available": 1}),
    )
    if price <= 0:
        raise HTTPException(status_code=503, detail="IBO price unavailable. Try again shortly.")

    ibo_px = float(price) if sym == ibo_swap_svc.SWAP_SYMBOL else await _resolve_ibo_usdt_price(controls)

    try:
        ibo_swap_svc.build_market_order(
            direction,
            amount,
            price,
            min_base_amount=MIN_BASE_AMOUNT,
            min_order_value_usdt=MIN_ORDER_VALUE_USDT,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    notional = ibo_swap_svc.swap_usdt_notional(direction, amount, price)
    trading_fee_ibo = ibo_fee_svc.estimate_ibo_fee(
        quote_asset="USDT",
        quote_notional=notional,
        fee_rate=taker_fee,
        ibo_price_usdt=ibo_px,
    )

    quote = ibo_swap_svc.estimate_swap_output(
        direction,
        amount,
        price,
        swap_fee_rate=swap_rate,
        swap_fee_ibo_fixed=swap_fixed,
        ibo_price_usdt=ibo_px,
        trading_fee_ibo_estimated=trading_fee_ibo,
    )

    from_asset = quote["from_asset"]
    available = float((bal_doc or {}).get("available") or 0.0)
    quote["available_from"] = round(available, 8)
    quote["min_from_amount"] = (
        MIN_BASE_AMOUNT if direction == "ibo_to_usdt" else MIN_ORDER_VALUE_USDT
    )
    return quote


@api_router.post("/wallet/swap", response_model=OrderOut)
async def wallet_swap_execute(
    body: IboSwapExecute,
    current_user: dict = Depends(get_current_user),
):
    """Swap IBO ↔ USDT instantly at market price on IBOUSDT."""
    from services import ibo_swap as ibo_swap_svc

    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    enforce_user_actions_allowed(current_user)
    await enforce_feature("trading_enabled", "Trading is currently paused by admin")

    sym = ibo_swap_svc.SWAP_SYMBOL
    if sym not in SYMBOL_BASE_MAP:
        raise HTTPException(status_code=503, detail="IBO/USDT swap is not available.")

    price = await get_current_price(sym)
    if price <= 0:
        raise HTTPException(status_code=503, detail="IBO price unavailable. Try again shortly.")

    controls = await get_platform_controls()
    swap_rate, swap_fixed = _swap_fee_from_controls(controls)
    _, taker_fee = _fee_rates_from_controls(controls)
    ibo_px = await _resolve_ibo_usdt_price(controls)

    try:
        side, base_qty = ibo_swap_svc.build_market_order(
            body.direction,
            body.amount,
            price,
            min_base_amount=MIN_BASE_AMOUNT,
            min_order_value_usdt=MIN_ORDER_VALUE_USDT,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    notional = ibo_swap_svc.swap_usdt_notional(body.direction, body.amount, price)
    trading_fee_ibo = ibo_fee_svc.estimate_ibo_fee(
        quote_asset="USDT",
        quote_notional=notional,
        fee_rate=taker_fee,
        ibo_price_usdt=ibo_px,
    )
    fee_parts = ibo_swap_svc.compute_swap_platform_fee_ibo(
        body.direction,
        body.amount,
        price,
        swap_fee_rate=swap_rate,
        swap_fee_ibo_fixed=swap_fixed,
        ibo_price_usdt=ibo_px,
    )
    swap_fee_ibo = float(fee_parts["fee_ibo_estimated"])
    fee_total = round(swap_fee_ibo + trading_fee_ibo, 8)
    uid = current_user["uid"]

    try:
        await ibo_fee_svc.ensure_ibo_fee_balance(uid, fee_total, context="swap")
    except InsufficientFundsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    order = await _execute_place_order(
        uid,
        OrderCreate(symbol=sym, side=side, type="market", amount=base_qty),
    )

    if swap_fee_ibo > 0:
        try:
            await ibo_fee_svc.charge_ibo_fee(
                uid,
                swap_fee_ibo,
                trade_id=str(order.order_id),
                ref_type="swap",
                meta={
                    "direction": body.direction,
                    "from_amount": body.amount,
                    "swap_fee_rate": swap_rate,
                    "swap_fee_ibo_fixed": swap_fixed,
                    "usdt_notional": notional,
                },
            )
        except InsufficientFundsError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Swap filled but platform fee debit failed: {exc}",
            ) from exc

    return order


# Phase 4 — manual deposit submission has been removed. Deposits are now
# detected on-chain by the poller (``deposit_events`` collection) and will
# be credited automatically. The legacy ``POST /wallet/deposit`` and
# ``GET /wallet/deposits`` endpoints are gone; use ``GET /wallet/deposit-events``
# below for the user's deposit history.


@api_router.get("/wallet/deposit-events")
async def list_user_deposit_events(
    current_user: dict = Depends(get_current_user),
    asset: Optional[str] = None,
    status: Optional[str] = Query(None, description="Filter by event status (pending/credited/orphan)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Return blockchain deposit sightings recorded for this user.

    These are on-chain transactions observed by the deposit poller
    (``deposit_events`` collection). The shape is intentionally minimal —
    we only surface fields the UI needs, and never leak raw RPC payloads.
    Phase 4: rows move to ``credited`` (balance updates) when the
    :mod:`workers.deposit_crediter` task runs with ``deposit_auto_credit_enabled``,
    KYC, and min-notional checks all satisfied.
    """
    if db is None:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    uid = current_user["uid"]
    filt: Dict[str, Any] = {"uid": uid}
    if asset:
        filt["asset"] = asset.strip().upper()
    if status:
        filt["status"] = status.strip().lower()
    total = await db.deposit_events.count_documents(filt)
    cur = db.deposit_events.find(filt, {"_id": 0, "raw": 0}).sort(
        "created_at", -1,
    ).skip(int(skip)).limit(int(limit))
    items = await cur.to_list(limit)
    # Phase 5 — annotate each row with the confirmation threshold resolved
    # from ``platform_controls`` so the UI can show "5/12 confirmations"
    # without having to hit a second endpoint. We compute this per-asset
    # (with a tiny local cache) to avoid re-reading controls in a loop.
    controls = await get_platform_controls()
    _thr_cache: Dict[str, int] = {}
    for row in items:
        ast = (row.get("asset") or "").upper()
        if ast not in _thr_cache:
            _thr_cache[ast] = resolve_min_confirmations(controls, ast)
        row["threshold"] = _thr_cache[ast]
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.get("/wallet/signup-bonus-pending")
async def wallet_signup_bonus_pending(current_user: dict = Depends(get_current_user)):
    """Prompt payload when an on-chain signup bonus awaits KYC / confirmations."""
    if db is None:
        return {"show_prompt": False}
    kyc_status = (current_user.get("kyc_status") or "unverified").lower()
    bonus_ibo = await get_signup_bonus_ibo()
    return await signup_bonus_svc.signup_bonus_pending_prompt(
        db,
        current_user["uid"],
        kyc_status=kyc_status,
        configured_bonus_ibo=bonus_ibo,
    )


# ── On-demand deposit monitoring ─────────────────────────────────────────────
#
# Four endpoints drive the session-based model.  The blockchain provider is
# looked up from the app state so no extra coupling is needed here.


def _get_provider_from_app():
    """Return the shared blockchain provider instance, or None."""
    try:
        from services import blockchain_service as _bcs
        return _bcs.get_provider()
    except Exception:
        return None


@api_router.get("/wallet/deposit-monitor/status")
async def deposit_monitor_status(
    current_user: dict = Depends(get_current_user),
):
    """Return the user's current (or most recent) monitoring session.

    Called on page load so the UI can restore the active state across
    navigation.  Returns ``null`` when the user has no session history.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    controls = await get_platform_controls()
    cfg = deposit_monitor_service.get_monitor_config(controls)
    session = await deposit_monitor_service.get_session_status(db, uid)
    return {"session": session, "config": cfg}


@api_router.post("/wallet/deposit-monitor/start")
async def deposit_monitor_start(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Create (or return an existing) monitoring session for this user.

    Idempotent: if an active session already exists it is returned unchanged,
    so the client can safely call this on every page load without creating
    duplicates.

    Rate limits / security
    ----------------------
    - Session duration, scan interval, max-scans, and cooldown are all set
      server-side from ``platform_controls``.  Browser timers are decorative.
    - Cooldown is enforced between sessions: if the previous session ended
      less than ``cooldown_sec`` ago the server returns 429 with a
      ``retry_after_sec`` field.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    controls = await get_platform_controls()
    ip = request.client.host if request.client else ""
    ua = request.headers.get("user-agent", "")
    try:
        session = await deposit_monitor_service.create_session(
            db, uid, controls, ip=ip, user_agent=ua,
        )
    except ValueError as exc:
        err_msg = str(exc)
        # Parse wait time from error message for the client.
        retry_after = 0
        import re as _re
        m = _re.search(r"(\d+) second", err_msg)
        if m:
            retry_after = int(m.group(1))
        raise HTTPException(
            status_code=429,
            detail={"message": err_msg, "retry_after_sec": retry_after},
        )
    cfg = deposit_monitor_service.get_monitor_config(controls)
    return {"session": session, "config": cfg}


@api_router.post("/wallet/deposit-monitor/scan")
async def deposit_monitor_scan(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Run one on-demand blockchain scan for the user's deposit addresses.

    Scans only blocks produced since the previous scan, for only this user's
    own addresses.  The session must be active and not yet expired.

    Returns detected deposit events (which are also written to
    ``deposit_events`` for the normal crediting pipeline).

    Security
    --------
    - ``session_id`` is validated server-side (ownership + expiry + scan count).
    - A per-scan rate-limit (based on ``scan_interval_sec``) prevents spamming:
      early calls receive ``skipped=true`` + ``retry_in_sec`` instead of an RPC
      call.  No credits are consumed for skipped scans.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    try:
        body = await request.json()
    except Exception:
        body = {}
    session_id = str((body or {}).get("session_id") or "").strip()
    if not session_id:
        raise HTTPException(status_code=422, detail="session_id is required")

    provider = _get_provider_from_app()
    if provider is None:
        raise HTTPException(status_code=503, detail="Blockchain provider not available")

    result = await deposit_monitor_service.run_scan(
        db, uid, session_id, provider=provider,
    )
    if not result.get("ok") and result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Session not found")
    return result


@api_router.delete("/wallet/deposit-monitor/stop")
async def deposit_monitor_stop(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Stop the user's active monitoring session early.

    Safe to call even if the session has already expired — returns
    ``stopped=false`` in that case without an error.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    try:
        body = await request.json()
    except Exception:
        body = {}
    session_id = str((body or {}).get("session_id") or "").strip()
    if not session_id:
        raise HTTPException(status_code=422, detail="session_id is required")
    stopped = await deposit_monitor_service.stop_session(db, uid, session_id)
    return {"stopped": stopped}


@api_router.get("/wallet/verify-deposit")
async def verify_deposit(
    current_user: dict = Depends(get_current_user),
):
    """On-demand deposit verification — no session or background polling required.

    Called by the frontend deposit page every ``VERIFY_DEPOSIT_INTERVAL_MINUTES``
    (default 5) while the user is actively viewing the page.  Stops automatically
    when the user navigates away (the frontend clears its timer on unmount).

    What it does
    ------------
    1. Loads the authenticated user's deposit addresses from the DB.
    2. Scans the last ``VERIFY_BLOCK_LOOKBACK`` (default 100) blocks on each
       supported chain using a single batched ``eth_getLogs`` per chain.
    3. Detects new deposits, ignores already-processed tx hashes (idempotent).
    4. Stores new deposit events for the crediting pipeline.
    5. Returns the count of newly discovered events.

    Rate limiting
    -------------
    A per-user server-side cooldown (``VERIFY_BLOCK_LOOKBACK`` × block-time,
    min 60 s) prevents accidental hammering.  Early calls receive
    ``skipped=true`` + ``retry_in_sec`` without consuming RPC credits.

    RPC cost
    --------
    One ``eth_getLogs`` per chain (all token contracts batched), plus one
    ``eth_blockNumber`` per chain.  Approximately 75–300 QuickNode CUs per call
    — vs. 4–5 M CUs/day for the old continuous poller.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    uid = current_user["uid"]
    provider = _get_provider_from_app()
    if provider is None:
        raise HTTPException(status_code=503, detail="Blockchain provider not available")
    result = await deposit_monitor_service.verify_deposit_on_demand(
        db, uid, provider=provider,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error", "Verification failed"))
    return result


# ── Phase 2 — atomic per-user daily withdrawal quota counter ─────────────────
def _withdrawal_day_key(now_dt: Optional[datetime] = None) -> str:
    """UTC day bucket key (YYYY-MM-DD) used by ``withdrawal_daily_usage``."""
    dt = now_dt or datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


async def _consume_withdrawal_quota(uid: str, amount_usdt: float, cap_usdt: float) -> bool:
    """Atomically reserve ``amount_usdt`` against the user's daily cap.

    Returns ``True`` when the reservation succeeded, ``False`` when the
    increment would push the user over ``cap_usdt``. Cap of 0 means
    "no daily limit" — always succeeds without touching the counter.
    """
    if cap_usdt <= 0 or db is None:
        return True
    day = _withdrawal_day_key()
    now_iso = datetime.now(timezone.utc).isoformat()
    # Make sure the counter row exists so the conditional $inc has a target.
    await db.withdrawal_daily_usage.update_one(
        {"uid": uid, "day": day},
        {"$setOnInsert": {
            "uid": uid, "day": day,
            "used_usdt": 0.0,
            "created_at": now_iso,
        }},
        upsert=True,
    )
    # Conditional $inc — only succeeds when the post-increment total stays
    # within the cap. ``used_usdt <= cap - amount`` is equivalent to
    # ``used_usdt + amount <= cap``.
    headroom = round(cap_usdt - amount_usdt, 8)
    res = await db.withdrawal_daily_usage.update_one(
        {"uid": uid, "day": day, "used_usdt": {"$lte": headroom}},
        {"$inc": {"used_usdt": float(amount_usdt)},
         "$set": {"updated_at": now_iso}},
    )
    return res.modified_count == 1


async def _refund_withdrawal_quota(uid: str, amount_usdt: float, *,
                                    day: Optional[str] = None) -> None:
    """Decrement the per-user daily counter (best effort).

    Used when a withdrawal is rolled back (insert failed, or admin rejected
    the request) so the user can resubmit on the same day.
    """
    if amount_usdt <= 0 or db is None:
        return
    day_key = day or _withdrawal_day_key()
    try:
        await db.withdrawal_daily_usage.update_one(
            {"uid": uid, "day": day_key},
            {"$inc": {"used_usdt": -float(amount_usdt)},
             "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception:  # noqa: BLE001
        logger.exception("failed to refund withdrawal quota for %s (%.4f USDT)", uid, amount_usdt)


# ── Phase 6 — on-chain withdrawal flow ──────────────────────────────────────
# Status machine (on ``withdrawal_requests.status``):
#
#   pending_approval ──► approved ──► broadcasting ──► broadcasted ──► confirmed
#          │                │                             │
#          │                ├── awaiting_treasury (Phase 2 — no hot omnibus yet)
#          │                └── rejected (refund lock + quota)
#          │                                              │
#          └─► rejected                                   └─► failed (refund)
#
# ``auto_approved=True`` means the submission was under
# ``withdrawal_auto_approve_limit_usdt`` and we skipped the
# ``pending_approval`` state. All balance changes still flow through
# :mod:`services.wallet_service` so the ``wallet_txns`` ledger stays the
# authoritative source of truth — no direct ``$inc`` on ``wallets``.

_WITHDRAWAL_NON_TERMINAL = (
    "pending_approval", "on_hold", "awaiting_treasury", "approved", "broadcasting", "broadcasted",
)
_WITHDRAWAL_TERMINAL = ("confirmed", "rejected", "failed")


async def _withdrawal_risk_flags_for_submission(
    uid: str,
    asset: str,
    canonical_addr: str,
    notional_usdt: float,
    controls: Dict[str, Any],
    network: str,
) -> List[str]:
    """Light-weight risk tags for ops triage (Phase 1)."""
    if db is None:
        return []
    flags: List[str] = []
    ast = (asset or "").upper()
    addr_key = canonical_addr.lower() if ast in ("ETH", "USDT") else canonical_addr
    prior = await db.withdrawal_requests.count_documents(
        {
            "uid": uid,
            "asset": ast,
            "$or": [{"address": canonical_addr}, {"address": addr_key}],
            "status": {"$in": ["awaiting_treasury", "approved", "broadcasting", "broadcasted", "confirmed"]},
        }
    )
    if prior == 0:
        flags.append("new_address")

    auto_limit = _control_float(controls, "withdrawal_auto_approve_limit_usdt", 0.0)
    if auto_limit > 0 and notional_usdt > 0 and notional_usdt > auto_limit * 2.0:
        flags.append("large_amount")
    elif notional_usdt > 50_000.0:
        flags.append("large_amount")

    scfg = await _get_screening_config()
    v_thr = int(scfg.get("velocity_withdraw_count_24h") or 3)
    since_dt = datetime.now(timezone.utc) - timedelta(hours=24)
    since = since_dt.isoformat()
    recent = await db.withdrawal_requests.count_documents(
        {
            "uid": uid,
            "created_at": {"$gte": since},
            "status": {"$nin": ["rejected", "failed"]},
        }
    )
    if recent >= v_thr:
        flags.append("velocity")

    try:
        bl = await compliance_service.check_wallet_blacklist_hit(db, canonical_addr, network)
        if bl:
            flags.append("wallet_blacklist")
    except Exception:  # noqa: BLE001
        logger.exception("wallet blacklist check failed for withdrawal risk flags")

    kyc = await db.kyc.find_one({"uid": uid}, {"screening": 1})
    scr = (kyc or {}).get("screening") or {}
    if (scr.get("name_screening") or {}).get("hits"):
        flags.append("kyc_screening_hit")

    return flags


class WithdrawSubmitBody(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    asset: str = Field(..., min_length=2, max_length=10)
    network: str = Field(..., min_length=3, max_length=60)
    address: str = Field(..., min_length=8, max_length=120)
    amount: float = Field(..., gt=0.0)
    # Optional free-text label users attach for their own records (not sent
    # on-chain). Memo-style coins aren't wired up yet — reserved for Phase 7+.
    note: Optional[str] = Field(None, max_length=200)
    # Phase 7a — 6-digit TOTP (or a 10-char backup code). Required when
    # the user has 2FA enabled, or when ops have turned on
    # ``two_factor_required_for_withdrawal`` globally.
    totp: Optional[str] = Field(None, max_length=32)


class AdminWithdrawalRejectBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str = Field(..., min_length=3, max_length=300)


class AdminWithdrawalApproveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note: Optional[str] = Field(None, max_length=300)


def _withdrawal_usdt_notional(asset: str, amount: float) -> float:
    """Best-effort USDT-equivalent of ``amount`` ``asset``.

    Uses the sync spot-price cache populated by trading flows; falls back
    to ``FALLBACK_PRICES`` when the cache is cold. Returns ``amount`` for
    USDT itself. Never raises — a 0 return means "price unknown" and the
    callers treat that as "skip USDT-denominated quota / auto-approve".
    """
    return float(amount or 0.0) * _cached_price_usdt(asset)


def _platform_address_filter(canonical: str) -> Dict[str, Any]:
    """Mongo filter that matches a destination address (case-insensitive for EVM)."""
    if (canonical or "").startswith(("0x", "0X")):
        return {"address": {"$regex": f"^{re.escape(canonical)}$", "$options": "i"}}
    return {"address": canonical}


async def _find_platform_destination(
    asset: str, network: str, canonical: str,
) -> Optional[Dict[str, Any]]:
    """Return match info when ``canonical`` is a IBO-owned address, else ``None``.

    Matches:
    - Per-user HD deposit addresses (any asset — EVM addresses are shared)
    - Configured treasury hot / Tron signer addresses
    - Omnibus treasury_wallets registry rows
    """
    if db is None or not canonical:
        return None

    addr_filter = _platform_address_filter(canonical)
    existing = await db.deposit_addresses.find_one(
        addr_filter,
        {"_id": 0, "uid": 1, "address": 1, "asset": 1, "network": 1},
    )
    if existing and (existing.get("address") or "").strip():
        return {
            "match_type": "deposit_address",
            "matched_uid": existing.get("uid"),
            "matched_asset": existing.get("asset"),
            "matched_network": existing.get("network"),
            "matched_address": existing.get("address"),
        }

    # Treasury hot wallet (EVM) + Tron base58 form of the same key.
    try:
        provider = blockchain_service.get_provider()
        treasury = (provider.treasury_address(asset) or "").strip()
        if treasury and canonical.lower() == treasury.lower():
            return {
                "match_type": "treasury_hot",
                "matched_uid": None,
                "matched_address": treasury,
            }
        tron_fn = getattr(provider, "treasury_tron_address", None)
        tron_addr = (tron_fn() if callable(tron_fn) else None) or ""
        if tron_addr and canonical == tron_addr:
            return {
                "match_type": "treasury_hot_tron",
                "matched_uid": None,
                "matched_address": tron_addr,
            }
    except Exception:  # noqa: BLE001
        logger.exception("platform destination: treasury address lookup failed")

    try:
        omni = await db.treasury_wallets.find_one(
            {**addr_filter, "enabled": {"$ne": False}},
            {"_id": 0, "address": 1, "role": 1, "asset": 1, "network": 1},
        )
        if omni and (omni.get("address") or "").strip():
            return {
                "match_type": f"treasury_{(omni.get('role') or 'omnibus')}",
                "matched_uid": None,
                "matched_address": omni.get("address"),
                "matched_asset": omni.get("asset"),
                "matched_network": omni.get("network"),
            }
    except Exception:  # noqa: BLE001
        logger.exception("platform destination: omnibus lookup failed")

    return None


def _synthetic_withdrawal_tx_hash(wd_id: str, network: str) -> str:
    """Deterministic explorer-style hash so History looks like a normal payout."""
    digest = hashlib.sha256(f"ibo-wd:{wd_id}".encode("utf-8")).hexdigest()
    net = (network or "").strip()
    if net == "TRC-20 (Tron)" or net == "Bitcoin Network" or net == "Solana":
        return digest
    return "0x" + digest


async def _validate_withdrawal_address(
    asset: str, address: str, network: str, *, sender_uid: Optional[str] = None,
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """Return ``(canonical_address, internal_hit_or_None)`` or raise HTTP 400.

    - External address → ``internal_hit is None`` (on-chain withdrawal).
    - Another user's HD deposit address → internal transfer hit.
    - Own HD address / treasury hot / omnibus → rejected.
    """
    try:
        canonical = blockchain_service.validate_address(asset, address, network)
    except blockchain_service.BlockchainError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid destination address: {exc}",
        )

    platform_hit = await _find_platform_destination(asset, network, canonical)
    if not platform_hit:
        return canonical, None

    match_type = str(platform_hit.get("match_type") or "")
    if match_type.startswith("treasury") or match_type in ("treasury_hot", "treasury_hot_tron"):
        raise HTTPException(
            status_code=400,
            detail="Withdrawals to the platform hot wallet / treasury address are not allowed.",
        )

    matched_uid = (platform_hit.get("matched_uid") or "").strip()
    if match_type == "deposit_address" and matched_uid:
        if sender_uid and matched_uid == sender_uid:
            raise HTTPException(
                status_code=400,
                detail="You cannot withdraw to your own deposit address. Use an external wallet or another user's address.",
            )
        return canonical, platform_hit

    raise HTTPException(
        status_code=400,
        detail="This destination address belongs to the platform and cannot be used for withdrawals.",
    )


async def _settle_internal_user_transfer(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Settle A → B when destination is another user's HD deposit address.

    Debits sender locked balances, credits recipient available balance for the
    same asset, confirms the withdrawal with a real-looking History hash.
    Does not touch on-chain treasury custody and does not credit admin treasury.
    """
    wd_id = doc.get("id") or ""
    uid = doc.get("uid") or ""
    asset = (doc.get("asset") or "").upper()
    network = doc.get("network") or ""
    amount = float(doc.get("amount") or 0.0)
    fee_amount = float(doc.get("fee_amount") or 0.0)
    fee_asset = (doc.get("fee_asset") or "").upper()
    ibo_gas_fee = float(doc.get("ibo_gas_fee") or 0.0)
    dest = doc.get("platform_destination") or {}
    recipient_uid = (dest.get("matched_uid") or "").strip()
    now_iso = datetime.now(timezone.utc).isoformat()
    tx_hash = _synthetic_withdrawal_tx_hash(wd_id, network)
    threshold = int(doc.get("threshold") or 1) or 1

    if not recipient_uid or recipient_uid == uid:
        raise HTTPException(
            status_code=400,
            detail="Internal transfer requires a different user's deposit address.",
        )

    reserved = await db.withdrawal_requests.find_one_and_update(
        {"id": wd_id, "status": {"$in": ["approved", "pending_approval", "awaiting_treasury"]}},
        {"$set": {
            "status": "confirming",
            "settlement_type": "internal_transfer",
            "skip_broadcast": True,
            "tx_hash": tx_hash,
            "from_address": uid,
            "to_address": doc.get("address"),
            "recipient_uid": recipient_uid,
            "broadcasted_at": now_iso,
            "updated_at": now_iso,
        }},
        return_document=ReturnDocument.BEFORE,
    )
    if reserved is None:
        refreshed = await db.withdrawal_requests.find_one({"id": wd_id}, {"_id": 0})
        return refreshed or doc

    try:
        if amount > 0:
            await wallet_service.debit_locked(
                uid, asset, amount,
                txn_type="withdraw",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "withdrawal_confirmed",
                    "tx_hash": tx_hash,
                    "confirmations": threshold,
                    "settlement": "internal_transfer",
                    "recipient_uid": recipient_uid,
                },
            )
            await wallet_service.credit(
                recipient_uid, asset, amount,
                txn_type="deposit",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "internal_transfer_credit",
                    "tx_hash": tx_hash,
                    "from_uid": uid,
                    "network": network,
                    "address": doc.get("address"),
                    "settlement": "internal_transfer",
                },
            )
        if fee_amount > 0 and not doc.get("ibo_fees_settled"):
            # Legacy: platform fee was locked until confirm.
            fee_debit_asset = "IBO" if fee_asset == "IBO" else asset
            await wallet_service.debit_locked(
                uid, fee_debit_asset, fee_amount,
                txn_type="fee",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "withdrawal_ibo_platform_fee" if fee_asset == "IBO" else "withdrawal_fee",
                    "tx_hash": tx_hash,
                    "settlement": "internal_transfer",
                },
            )
        if ibo_gas_fee > 0 and not doc.get("ibo_fees_settled"):
            await wallet_service.debit_locked(
                uid, "IBO", ibo_gas_fee,
                txn_type="fee",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "withdrawal_ibo_gas_fee",
                    "tx_hash": tx_hash,
                    "settlement": "internal_transfer",
                },
            )
    except Exception:  # noqa: BLE001
        logger.exception(
            "internal transfer settle failed wd=%s — leaving for reconcile", wd_id,
        )
        await db.withdrawal_requests.update_one(
            {"id": wd_id, "status": "confirming"},
            {"$set": {
                "status": "approved",
                "reconcile_required": True,
                "skip_broadcast": True,
                "settlement_type": "internal_transfer",
                "updated_at": now_iso,
            }},
        )
        refreshed = await db.withdrawal_requests.find_one({"id": wd_id}, {"_id": 0})
        return refreshed or doc

    await db.withdrawal_requests.update_one(
        {"id": wd_id, "status": "confirming"},
        {"$set": {
            "status": "confirmed",
            "confirmed_at": now_iso,
            "confirmations": threshold,
            "block_height": None,
            "settlement_type": "internal_transfer",
            "skip_broadcast": True,
            "recipient_uid": recipient_uid,
            "tx_hash": tx_hash,
            "updated_at": now_iso,
        }},
    )
    logger.info(
        "withdrawal internal_transfer: id=%s from=%s to=%s asset=%s amount=%s",
        wd_id, uid, recipient_uid, asset, amount,
    )
    refreshed = await db.withdrawal_requests.find_one({"id": wd_id}, {"_id": 0})
    return refreshed or doc


# Back-compat alias (older admin approve path / hot reload)
async def _settle_platform_destination_withdrawal(doc: Dict[str, Any]) -> Dict[str, Any]:
    return await _settle_internal_user_transfer(doc)


def _withdrawal_ibo_fee_amounts(doc: Dict[str, Any]) -> Tuple[float, float]:
    """Return (platform_fee_ibo, gas_fee_ibo) for a withdrawal request row."""
    gas = float(doc.get("ibo_gas_fee") or 0.0)
    fee_asset = (doc.get("fee_asset") or "").upper()
    platform = float(doc.get("fee_amount") or 0.0)
    if platform > 0 and fee_asset and fee_asset != ibo_fee_svc.FEE_ASSET:
        # Legacy rows charged platform fee in the withdrawn asset — not IBO.
        if not doc.get("ibo_fees_settled"):
            platform = 0.0
    elif platform > 0 and not fee_asset and not doc.get("ibo_fees_settled"):
        platform = 0.0
    return max(0.0, platform), max(0.0, gas)


async def _refund_withdrawal_ibo_fees(
    doc: Dict[str, Any],
    *,
    phase: str,
    reason: Optional[str] = None,
) -> None:
    """Refund IBO withdrawal fees (credit if charged at submit, else unlock)."""
    uid = (doc.get("uid") or "").strip()
    wd_id = doc.get("id") or ""
    if not uid or not wd_id:
        return
    platform, gas = _withdrawal_ibo_fee_amounts(doc)
    settled = bool(doc.get("ibo_fees_settled"))
    for amount, fee_kind in ((platform, "platform"), (gas, "gas")):
        if amount <= 0:
            continue
        meta = {
            "phase": f"{phase}_ibo_{fee_kind}_refund",
            "fee_kind": fee_kind,
        }
        if reason:
            meta["reason"] = reason
        try:
            if settled:
                await wallet_service.credit(
                    uid,
                    ibo_fee_svc.FEE_ASSET,
                    amount,
                    txn_type="adjustment",
                    ref_type="withdrawal",
                    ref_id=wd_id,
                    meta=meta,
                )
            else:
                await wallet_service.unlock(
                    uid,
                    ibo_fee_svc.FEE_ASSET,
                    amount,
                    ref_type="withdrawal",
                    ref_id=wd_id,
                    meta=meta,
                )
        except Exception:  # noqa: BLE001
            logger.exception(
                "withdrawal IBO %s fee refund failed wd=%s phase=%s",
                fee_kind, wd_id, phase,
            )


def _withdrawal_safe_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return a user-visible copy of a ``withdrawal_requests`` row.

    Strips internal-only fields so the response shape is stable even if
    we add ops/audit fields later. Admin responses use the raw doc.
    """
    if not doc:
        return {}
    out = {
        "id": doc.get("id"),
        "uid": doc.get("uid"),
        "asset": doc.get("asset"),
        "network": doc.get("network"),
        "address": doc.get("address"),
        "amount": float(doc.get("amount") or 0.0),
        "fee_amount": float(doc.get("fee_amount") or 0.0),
        "fee_asset": doc.get("fee_asset") or (
            ibo_fee_svc.FEE_ASSET if float(doc.get("fee_amount") or 0) > 0 else None
        ),
        "fee_usdt": doc.get("fee_usdt"),
        "total_charge": float(doc.get("total_charge") or 0.0),
        "ibo_gas_fee": float(doc.get("ibo_gas_fee") or 0.0),
        "ibo_fees_total": doc.get("ibo_fees_total"),
        "status": doc.get("status"),
        "auto_approved": bool(doc.get("auto_approved") or False),
        "tx_hash": doc.get("tx_hash"),
        "block_height": doc.get("block_height"),
        "confirmations": int(doc.get("confirmations") or 0),
        "threshold": int(doc.get("threshold") or 0),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "broadcasted_at": doc.get("broadcasted_at"),
        "confirmed_at": doc.get("confirmed_at"),
        "rejected_at": doc.get("rejected_at"),
        "failure_reason": doc.get("failure_reason"),
        "reject_reason": doc.get("reject_reason"),
        "note": doc.get("note"),
        "treasury_gate_reason": doc.get("treasury_gate_reason"),
        "treasury_gate_at": doc.get("treasury_gate_at"),
        "treasury_ready_at": doc.get("treasury_ready_at"),
    }
    return out


@api_router.post("/wallet/withdraw")
async def submit_withdrawal(
    body: WithdrawSubmitBody,
    current_user: dict = Depends(get_current_user),
):
    """User-initiated withdrawal.

    Steps (all atomic as a group):

    1. Validate asset/network combination against the blockchain provider
       (``supported-networks``) and the destination address format. BTC
       and other non-broadcastable assets are rejected up-front in
       Phase 6 — they'll come online in a later phase.
    2. Enforce platform controls: ``wallet_enabled`` / maintenance /
       KYC gate / daily USDT cap / min+max notional.
    3. Atomically lock ``amount`` in the user's balance via
       ``wallet_service.lock`` (emits a ``wallet_txns`` row of type
       ``lock``). Platform + gas fees are debited immediately in IBO
       (``fee`` ledger rows); reject/fail paths refund those fees.
    4. Consume the daily quota counter. On any failure past this point
       the lock is released + quota refunded before raising.
    5. Insert the ``withdrawal_requests`` row. Status is ``approved``
       when under the auto-approve limit, else ``pending_approval``.

    The worker (:mod:`workers.withdrawal_executor`) picks up ``approved``
    rows and broadcasts. This endpoint never touches the chain directly.
    """
    await enforce_feature("wallet_enabled", "Wallet operations are temporarily paused by admin")
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    user_row = await db.users.find_one({"uid": current_user["uid"]}, {"_id": 0})
    if not user_row:
        raise HTTPException(status_code=401, detail="User not found")
    user_row = await compliance_service.apply_auto_unfreeze(db, user_row)
    _kyc_wallet_gate(user_row)
    enforce_user_actions_allowed(user_row)
    enforce_user_withdrawals_allowed(user_row)

    asset = body.asset.upper()
    network = body.network.strip()
    controls = await get_platform_controls()
    provider: blockchain_service.BlockchainProvider = blockchain_service.get_provider()

    # 1) Supported-network + provider check. ``can_broadcast`` ensures we
    # don't queue assets we can't ever fulfil (BTC in Phase 6).
    try:
        from listings.integration import merge_supported_networks

        supported = merge_supported_networks(provider.list_supported_networks())
    except Exception:  # noqa: BLE001
        supported = provider.list_supported_networks()
    net_row = next(
        (s for s in supported if s.get("asset") == asset and s.get("network") == network),
        None,
    )
    if not net_row:
        raise HTTPException(
            status_code=400,
            detail=f"{asset} on '{network}' is not currently available for withdrawal.",
        )
    if not net_row.get("withdraw_enabled"):
        raise HTTPException(
            status_code=400,
            detail=f"{asset} withdrawals on '{network}' are not enabled yet.",
        )

    # 2) Destination address validation.
    # Another user's HD deposit address → internal ledger transfer (A → B).
    # Treasury / hot wallet → rejected. External → on-chain broadcast.
    canonical_addr, platform_hit = await _validate_withdrawal_address(
        asset, body.address, network, sender_uid=current_user["uid"],
    )
    is_internal_transfer = platform_hit is not None

    # On-chain broadcast capability is only required for external destinations.
    if not is_internal_transfer and not provider.can_broadcast(asset, network=network):
        raise HTTPException(
            status_code=400,
            detail=f"{asset} withdrawals are temporarily disabled on this exchange.",
        )

    sc_cfg = await _get_screening_config()
    bl_hit = await compliance_service.check_wallet_blacklist_hit(db, canonical_addr, network)
    if bl_hit and bool(sc_cfg.get("block_on_wallet_blacklist", True)):
        raise HTTPException(
            status_code=400,
            detail="This withdrawal address is blocked by compliance policy. Choose a different destination or contact support.",
        )

    # 2b) Rate-limit before doing any write. Two buckets:
    #   - per-minute cap (5 by default) catches "accidentally submitted
    #     twice" and small-scale abuse;
    #   - per-day cap (30) catches automation running behind a single
    #     compromised session.
    uid_key = current_user["uid"]
    await _rate_limit(controls, "wallet.withdraw.minute", f"uid:{uid_key}",
                      limit_key="rate_limit_withdraw_per_uid_per_min", window_sec=60)
    await _rate_limit(controls, "wallet.withdraw.day", f"uid:{uid_key}",
                      limit_key="rate_limit_withdraw_per_uid_per_day", window_sec=86400)

    # 3) 2FA gate. Phase 7a — verify an actual TOTP / backup code. If the
    # user has 2FA enabled, OR ops force it globally for withdrawals, a
    # valid code is required. Users without 2FA are only blocked when the
    # ``required_for_withdrawal`` flag is set.
    has_twofa = await _has_confirmed_2fa(current_user["uid"])
    require_twofa = bool(
        controls.get("two_factor_required_for_withdrawal")
        and controls.get("two_factor_enabled")
    )
    if require_twofa and not has_twofa:
        raise HTTPException(
            status_code=403,
            detail="Two-factor authentication is required for withdrawals. Enable 2FA in your profile.",
        )
    if has_twofa:
        await _assert_twofa_code(current_user, body.totp, context="withdraw")

    # 4) Amount bounds. ``withdraw_min_usdt`` / ``withdraw_max_usdt`` are
    # denominated in USDT notional so we need a price for non-USDT assets.
    fee_rate = max(0.0, _control_float(controls, "withdraw_fee_rate", 0.0))
    amount = float(body.amount)
    total_charge = round(amount, 12)
    notional_usdt = _withdrawal_usdt_notional(asset, amount)
    ibo_px = await ibo_fee_svc.resolve_ibo_usdt_price(controls)
    fee_usdt = round(float(notional_usdt or 0.0) * fee_rate, 8) if fee_rate > 0 else 0.0
    ibo_platform_fee = (
        ibo_fee_svc.usdt_notional_to_ibo_fee(fee_usdt, ibo_px) if fee_usdt > 0 else 0.0
    )
    fee_amount = ibo_platform_fee
    # IBO gas fee — user always pays IBO; treasury pays native chain gas (BNB/ETH/TRX).
    # Amount depends on the selected network. Also charged for platform-retained
    # destinations (no on-chain send) so fee policy stays consistent.
    ibo_gas_fee = ibo_fee_svc.resolve_withdraw_gas_fee_ibo(
        controls, network, asset=asset,
    )
    wd_min = _control_float(controls, "withdraw_min_usdt", 0.0)
    wd_max = _control_float(controls, "withdraw_max_usdt", 0.0)
    if wd_min > 0 and notional_usdt > 0 and notional_usdt < wd_min:
        raise HTTPException(
            status_code=400,
            detail=f"Withdrawal below the minimum of {wd_min} USDT.",
        )
    if wd_max > 0 and notional_usdt > 0 and notional_usdt > wd_max:
        raise HTTPException(
            status_code=400,
            detail=f"Withdrawal exceeds the maximum per-request of {wd_max} USDT.",
        )

    # 5) Atomic lock (available → locked) for the withdrawal amount only.
    # Platform + gas fees are always charged in IBO (separate debit + fee ledger
    # rows). Withdrawal is refused when the user cannot cover IBO fees.
    uid = current_user["uid"]
    wd_id = f"wd_{uuid.uuid4().hex[:20]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    ibo_fees_total = round(ibo_platform_fee + ibo_gas_fee, 12)

    if ibo_fees_total > 0:
        try:
            await ibo_fee_svc.ensure_ibo_fee_balance(
                uid, ibo_fees_total, context="withdrawal",
            )
        except InsufficientFundsError as exc:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient IBO for withdrawal fees. "
                    f"Need ~{exc.need:.8f} IBO, available {exc.have:.8f} IBO. "
                    f"Withdrawal is not possible without enough IBO to cover fees."
                ),
            ) from exc

    if asset == ibo_fee_svc.FEE_ASSET and ibo_fees_total > 0:
        ibo_avail = await ibo_fee_svc.read_ibo_available(uid)
        need_total = round(float(amount) + ibo_fees_total, 12)
        if ibo_avail + 1e-12 < need_total:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient IBO for withdrawal plus fees. "
                    f"Need {need_total:.8f} IBO "
                    f"({float(amount):.8f} withdraw + {ibo_fees_total:.8f} fees), "
                    f"available {ibo_avail:.8f} IBO."
                ),
            )

    try:
        await wallet_service.lock(
            uid, asset, total_charge,
            ref_type="withdrawal", ref_id=wd_id,
            meta={
                "phase": "withdrawal_submit",
                "amount": amount,
                "fee_amount": fee_amount,
                "fee_asset": ibo_fee_svc.FEE_ASSET if fee_amount > 0 else None,
                "ibo_gas_fee": ibo_gas_fee,
                "asset": asset,
                "network": network,
            },
        )
    except InsufficientFundsError as exc:
        raise HTTPException(status_code=400, detail=f"Insufficient {asset} balance: {exc}")

    # Charge IBO fees immediately so fee wallet_txns exist at submit time.
    # Reject / fail paths refund via _refund_withdrawal_ibo_fees.
    ibo_fees_settled = False
    if ibo_platform_fee > 0:
        try:
            await wallet_service.debit(
                uid, ibo_fee_svc.FEE_ASSET, ibo_platform_fee,
                txn_type="fee",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "withdrawal_ibo_platform_fee",
                    "fee_kind": "platform",
                    "fee_usdt": fee_usdt,
                    "fee_rate": fee_rate,
                    "asset": asset,
                    "network": network,
                    "fee_asset": ibo_fee_svc.FEE_ASSET,
                },
            )
            ibo_fees_settled = True
        except InsufficientFundsError:
            try:
                await wallet_service.unlock(
                    uid, asset, total_charge,
                    ref_type="withdrawal", ref_id=wd_id,
                    meta={"phase": "withdrawal_ibo_platform_fee_rollback"},
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "submit_withdrawal: rollback after IBO platform fee charge failure (%s)", wd_id,
                )
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient IBO balance for withdrawal platform fee "
                    f"({ibo_platform_fee:.8f} IBO required)."
                ),
            )

    if ibo_gas_fee > 0:
        try:
            await wallet_service.debit(
                uid, ibo_fee_svc.FEE_ASSET, ibo_gas_fee,
                txn_type="fee",
                ref_type="withdrawal", ref_id=wd_id,
                meta={
                    "phase": "withdrawal_ibo_gas_fee",
                    "fee_kind": "gas",
                    "asset": asset,
                    "network": network,
                    "fee_asset": ibo_fee_svc.FEE_ASSET,
                },
            )
            ibo_fees_settled = True
        except InsufficientFundsError:
            try:
                await wallet_service.unlock(
                    uid, asset, total_charge,
                    ref_type="withdrawal", ref_id=wd_id,
                    meta={"phase": "withdrawal_ibo_gas_fee_rollback"},
                )
            except Exception:  # noqa: BLE001
                logger.exception("submit_withdrawal: rollback after IBO gas fee charge failure (%s)", wd_id)
            if ibo_platform_fee > 0:
                try:
                    await wallet_service.credit(
                        uid, ibo_fee_svc.FEE_ASSET, ibo_platform_fee,
                        txn_type="adjustment",
                        ref_type="withdrawal", ref_id=wd_id,
                        meta={"phase": "withdrawal_ibo_gas_fee_rollback"},
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "submit_withdrawal: rollback IBO platform fee after gas charge failure (%s)",
                        wd_id,
                    )
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient IBO balance for gas fee ({ibo_gas_fee} IBO required).",
            )

    # 6) Daily USDT quota — withdrawal notional plus platform fee USDT equivalent.
    daily_cap = _control_float(controls, "withdraw_daily_limit_usdt", 0.0)
    quota_notional = float(notional_usdt or 0.0) + float(fee_usdt or 0.0)
    if not await _consume_withdrawal_quota(uid, quota_notional, daily_cap):
        # Roll back the lock — the user's funds must come back cleanly.
        try:
            await wallet_service.unlock(
                uid, asset, total_charge,
                ref_type="withdrawal", ref_id=wd_id,
                meta={"phase": "withdrawal_quota_refund"},
            )
        except Exception:  # noqa: BLE001
            logger.exception("submit_withdrawal: failed to refund lock after quota rejection (%s)", wd_id)
        await _refund_withdrawal_ibo_fees(
            {
                "id": wd_id,
                "uid": uid,
                "fee_amount": ibo_platform_fee,
                "fee_asset": ibo_fee_svc.FEE_ASSET if ibo_platform_fee > 0 else None,
                "ibo_gas_fee": ibo_gas_fee,
                "ibo_fees_settled": ibo_fees_settled,
            },
            phase="withdrawal_quota",
        )
        raise HTTPException(
            status_code=400,
            detail=f"Daily withdrawal limit of {daily_cap} USDT exceeded.",
        )

    # 7) Auto-approval check. ``auto_limit=0`` means "manual only".
    # Internal A→B HD transfers settle immediately (no chain broadcast).
    auto_limit = _control_float(controls, "withdrawal_auto_approve_limit_usdt", 0.0)
    auto_approved = (
        is_internal_transfer
        or (
            auto_limit > 0
            and notional_usdt > 0
            and notional_usdt <= auto_limit
        )
    )
    status = "approved" if auto_approved else "pending_approval"
    risk_flags = await _withdrawal_risk_flags_for_submission(
        uid, asset, canonical_addr, float(notional_usdt or 0.0), controls, network,
    )
    # Never auto-approve when any risk tag fired — ops must review first.
    # Internal transfers skip this (ledger-only A→B).
    if status == "approved" and risk_flags and not is_internal_transfer:
        status = "pending_approval"
        auto_approved = False

    # Phase 2 — v1 asset/network pairs require hot omnibus == treasury signer
    # before the executor may broadcast; otherwise queue as awaiting_treasury.
    # Skipped for internal transfers (no broadcast).
    treasury_gate_reason = None
    if (
        status == "approved"
        and not is_internal_transfer
        and tw_registry.treasury_gate_applies(asset, network)
    ):
        gate_reason = await tw_registry.treasury_gate_block_reason(db, asset, network)
        if gate_reason:
            status = "awaiting_treasury"
            treasury_gate_reason = gate_reason

    doc = {
        "id": wd_id,
        "uid": uid,
        "asset": asset,
        "network": network,
        "address": canonical_addr,
        "amount": float(amount),
        "fee_amount": float(fee_amount),
        "fee_asset": ibo_fee_svc.FEE_ASSET if fee_amount > 0 else None,
        "fee_usdt": float(fee_usdt) if fee_usdt else None,
        "total_charge": float(total_charge),
        "fee_rate": float(fee_rate),
        "ibo_gas_fee": float(ibo_gas_fee),
        "ibo_gas_chain_id": ibo_fee_svc.network_to_chain_id(network) or None,
        "ibo_fees_total": float(ibo_fees_total) if ibo_fees_total > 0 else None,
        "ibo_fees_settled": bool(ibo_fees_settled),
        "notional_usdt": float(notional_usdt) if notional_usdt else None,
        "status": status,
        "auto_approved": auto_approved,
        "risk_flags": risk_flags,
        "note": body.note or None,
        "tx_hash": None,
        "confirmations": 0,
        "threshold": int(resolve_min_confirmations(controls, asset)),
        "created_at": now_iso,
        "updated_at": now_iso,
        "day_key": _withdrawal_day_key(),  # so _refund_withdrawal_quota targets the right bucket
    }
    if is_internal_transfer:
        doc["platform_destination"] = platform_hit
        doc["settlement_type"] = "internal_transfer"
        doc["skip_broadcast"] = True
        doc["recipient_uid"] = (platform_hit or {}).get("matched_uid")
    if treasury_gate_reason:
        doc["treasury_gate_reason"] = treasury_gate_reason
        doc["treasury_gate_at"] = now_iso
    try:
        await db.withdrawal_requests.insert_one(doc)
    except Exception as exc:
        # Rare — most likely a Mongo hiccup. Keep the ledger clean by
        # reversing the lock + quota we just consumed.
        logger.exception("submit_withdrawal: insert failed for %s — rolling back", wd_id)
        try:
            await wallet_service.unlock(
                uid, asset, total_charge,
                ref_type="withdrawal", ref_id=wd_id,
                meta={"phase": "withdrawal_insert_failed"},
            )
        except Exception:  # noqa: BLE001
            logger.exception("submit_withdrawal: failed to refund lock after insert failure (%s)", wd_id)
        await _refund_withdrawal_ibo_fees(
            {
                "id": wd_id,
                "uid": uid,
                "fee_amount": ibo_platform_fee,
                "fee_asset": ibo_fee_svc.FEE_ASSET if ibo_platform_fee > 0 else None,
                "ibo_gas_fee": ibo_gas_fee,
                "ibo_fees_settled": ibo_fees_settled,
            },
            phase="withdrawal_insert_failed",
        )
        await _refund_withdrawal_quota(uid, quota_notional)
        raise HTTPException(status_code=500, detail=f"Could not queue withdrawal: {exc}")

    logger.info(
        "withdrawal submitted: id=%s uid=%s asset=%s amount=%s fee=%s status=%s auto=%s internal=%s",
        wd_id, uid, asset, amount, fee_amount, status, auto_approved, bool(is_internal_transfer),
    )

    if is_internal_transfer:
        try:
            doc = await _settle_internal_user_transfer(doc)
        except Exception:  # noqa: BLE001
            logger.exception(
                "submit_withdrawal: internal transfer settle failed wd=%s", wd_id,
            )
        try:
            await compliance_service.recompute_aml_risk_for_user(db, uid)
        except Exception:  # noqa: BLE001
            logger.exception("recompute_aml_risk_for_user failed after withdrawal (%s)", uid)
        return {"ok": True, "withdrawal": _withdrawal_safe_doc(doc)}

    if status == "awaiting_treasury":
        try:
            await tw_registry.notify_withdrawal_entered_awaiting_treasury(
                db, doc, entry_source="withdrawal_submit",
            )
            await tw_registry.log_withdrawal_gate_transition(
                db,
                action="queue",
                withdrawal_id=wd_id,
                from_status="new",
                to_status="awaiting_treasury",
                reason_code=str(treasury_gate_reason or "unknown"),
                reason="Withdrawal created awaiting treasury hot/signer alignment",
                actor=f"user:{uid}",
                meta={"asset": asset, "network": network, "auto_approved": auto_approved},
            )
        except Exception:  # noqa: BLE001
            logger.exception("withdrawal_submit: awaiting_treasury notify/log failed wd=%s", wd_id)
    try:
        await compliance_service.recompute_aml_risk_for_user(db, uid)
    except Exception:  # noqa: BLE001
        logger.exception("recompute_aml_risk_for_user failed after withdrawal (%s)", uid)
    return {"ok": True, "withdrawal": _withdrawal_safe_doc(doc)}


@api_router.get("/wallet/withdrawals")
async def list_user_withdrawals(
    current_user: dict = Depends(get_current_user),
    status: Optional[str] = None,
    asset: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Return the authenticated user's withdrawal requests, newest first."""
    if db is None:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    filt: Dict[str, Any] = {"uid": current_user["uid"]}
    if status:
        filt["status"] = status.strip().lower()
    if asset:
        filt["asset"] = asset.strip().upper()
    total = await db.withdrawal_requests.count_documents(filt)
    cur = (
        db.withdrawal_requests.find(filt, {"_id": 0})
        .sort("created_at", -1)
        .skip(int(skip))
        .limit(int(limit))
    )
    rows = await cur.to_list(length=limit)
    return {
        "items": [_withdrawal_safe_doc(r) for r in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


# ── Admin endpoints ──────────────────────────────────────────────────────────

@api_router.get("/admin/withdrawals")
async def admin_list_withdrawals(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    status: Optional[str] = None,
    uid: Optional[str] = None,
    asset: Optional[str] = None,
    address: Optional[str] = None,
    tx_hash: Optional[str] = None,
    risk_flag: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Admin queue for withdrawal approvals and audit.

    Returns the full ``withdrawal_requests`` doc (not the redacted user
    shape) so the admin UI can see fee breakdowns, auto_approved flag,
    reject reasons, etc. Status filtering makes it easy to pull just the
    ``pending_approval`` rows that need a decision.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_withdrawals")
    filt: Dict[str, Any] = {}
    if status:
        filt["status"] = status.strip().lower()
    if uid:
        filt["uid"] = uid.strip()
    if asset:
        filt["asset"] = asset.strip().upper()
    if address:
        filt["address"] = address.strip()
    if tx_hash:
        filt["tx_hash"] = tx_hash.strip()
    if risk_flag:
        filt["risk_flags"] = risk_flag.strip().lower()
    qq = (q or "").strip()
    if qq:
        # Single search box: match UID, destination address, or tx hash.
        rx = {"$regex": re.escape(qq), "$options": "i"}
        filt["$or"] = [
            {"uid": rx},
            {"address": rx},
            {"tx_hash": rx},
        ]
    if date_from or date_to:
        dr: Dict[str, Any] = {}
        if date_from:
            dr["$gte"] = date_from
        if date_to:
            dr["$lte"] = date_to
        filt["created_at"] = dr
    total = await db.withdrawal_requests.count_documents(filt)
    cur = (
        db.withdrawal_requests.find(filt, {"_id": 0})
        .sort("created_at", -1)
        .skip(int(skip))
        .limit(int(limit))
    )
    items = await cur.to_list(length=limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@api_router.post("/admin/withdrawals/{wd_id}/approve")
async def admin_approve_withdrawal(
    wd_id: str,
    body: AdminWithdrawalApproveBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Manually approve a ``pending_approval`` or ``on_hold`` withdrawal.

    Flips status to ``approved`` (or ``awaiting_treasury`` when Phase 2
    hot-wallet gate applies and no enabled hot omnibus is configured yet).
    Atomic ``find_one_and_update`` on the status filter means a race with
    rejection / double-approval is impossible.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)

    now_iso = datetime.now(timezone.utc).isoformat()
    before = await db.withdrawal_requests.find_one(
        {"id": wd_id, "status": {"$in": ["pending_approval", "on_hold"]}},
        {"_id": 0},
    )
    if before is None:
        raise HTTPException(
            status_code=409,
            detail="Withdrawal is not in 'pending_approval' or 'on_hold' state.",
        )
    asset_a = str(before.get("asset") or "")
    net_a = str(before.get("network") or "")
    next_status = "approved"
    extra_unset: Dict[str, str] = {}
    extra_set: Dict[str, Any] = {
        "status": next_status,
        "approved_at": now_iso,
        "approved_by": (auth.admin or {}).get("aid"),
        "approve_note": body.note or None,
        "updated_at": now_iso,
    }
    is_internal_transfer = bool(
        before.get("skip_broadcast")
        or before.get("settlement_type") in ("internal_transfer", "platform_retained")
        or before.get("platform_destination")
    )
    if is_internal_transfer:
        extra_set["skip_broadcast"] = True
        extra_set["settlement_type"] = "internal_transfer"
    elif tw_registry.treasury_gate_applies(asset_a, net_a):
        gate_reason = await tw_registry.treasury_gate_block_reason(db, asset_a, net_a)
        if gate_reason:
            next_status = "awaiting_treasury"
            extra_set["status"] = next_status
            extra_set["treasury_gate_reason"] = gate_reason
            extra_set["treasury_gate_at"] = now_iso
        else:
            extra_unset = {"treasury_gate_reason": "", "treasury_gate_at": ""}

    upd: Dict[str, Any] = {"$set": extra_set}
    if extra_unset:
        upd["$unset"] = extra_unset

    updated = await db.withdrawal_requests.find_one_and_update(
        {"id": wd_id, "status": {"$in": ["pending_approval", "on_hold"]}},
        upd,
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise HTTPException(
            status_code=409,
            detail="Withdrawal is not in 'pending_approval' or 'on_hold' state.",
        )
    await log_admin_audit(
        auth,
        "withdrawal_approve",
        "withdrawal_requests",
        wd_id,
        {
            "uid": updated.get("uid"),
            "asset": updated.get("asset"),
            "amount": updated.get("amount"),
            "note": body.note,
            "status": updated.get("status"),
        },
    )
    if updated.get("skip_broadcast") or updated.get("settlement_type") in (
        "internal_transfer", "platform_retained",
    ):
        try:
            updated = await _settle_internal_user_transfer(updated)
        except Exception:  # noqa: BLE001
            logger.exception(
                "admin_approve_withdrawal: internal transfer settle failed wd=%s", wd_id,
            )
        updated.pop("_id", None)
        return {"ok": True, "withdrawal": updated}

    if updated.get("status") == "awaiting_treasury":
        try:
            await tw_registry.notify_withdrawal_entered_awaiting_treasury(
                db, updated, entry_source="admin_withdrawal_approve",
            )
            aid = (auth.admin or {}).get("aid") or ""
            await tw_registry.log_withdrawal_gate_transition(
                db,
                action="queue",
                withdrawal_id=wd_id,
                from_status=str(before.get("status") or "pending_approval"),
                to_status="awaiting_treasury",
                reason_code=str(updated.get("treasury_gate_reason") or "unknown"),
                reason="Admin approved; treasury hot/signer gate not satisfied",
                actor=f"admin:{aid}",
                meta={"note": body.note},
            )
        except Exception:  # noqa: BLE001
            logger.exception("admin_approve_withdrawal: awaiting_treasury notify/log failed wd=%s", wd_id)
    updated.pop("_id", None)
    return {"ok": True, "withdrawal": updated}


class AdminWithdrawalHoldBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note: Optional[str] = Field(None, max_length=300)


@api_router.post("/admin/withdrawals/{wd_id}/hold")
async def admin_hold_withdrawal(
    wd_id: str,
    body: AdminWithdrawalHoldBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Move a ``pending_approval`` withdrawal to ``on_hold`` for manual review."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.withdrawal_requests.find_one_and_update(
        {"id": wd_id, "status": "pending_approval"},
        {"$set": {
            "status": "on_hold",
            "held_at": now_iso,
            "held_by": (auth.admin or {}).get("aid"),
            "hold_note": (body.note or "").strip() or None,
            "updated_at": now_iso,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise HTTPException(
            status_code=409,
            detail="Withdrawal is not in 'pending_approval' state.",
        )
    await log_admin_audit(
        auth,
        "withdrawal_hold",
        "withdrawal_requests",
        wd_id,
        {"uid": updated.get("uid"), "note": body.note},
    )
    updated.pop("_id", None)
    return {"ok": True, "withdrawal": updated}


@api_router.post("/admin/withdrawals/{wd_id}/reject")
async def admin_reject_withdrawal(
    wd_id: str,
    body: AdminWithdrawalRejectBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Reject a ``pending_approval``, ``on_hold``, or ``awaiting_treasury`` withdrawal.

    Atomically:
    1. Flips status to ``rejected`` (only if still ``pending_approval`` / ``on_hold`` / ``awaiting_treasury``).
    2. Unlocks the full ``total_charge`` back to the user's ``available``.
    3. Refunds the daily quota.

    Writing the status flip first means even if the unlock later fails
    (extremely unlikely) we can reconcile manually; we can never double-
    refund because the filter requires the prior ``pending_approval``.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_privileged_ops_admin(auth)

    now_iso = datetime.now(timezone.utc).isoformat()
    reason = (body.reason or "").strip() or "Rejected"

    before = await db.withdrawal_requests.find_one_and_update(
        {"id": wd_id, "status": {"$in": ["pending_approval", "on_hold", "awaiting_treasury"]}},
        {"$set": {
            "status": "rejected",
            "rejected_at": now_iso,
            "rejected_by": (auth.admin or {}).get("aid"),
            "reject_reason": reason,
            "updated_at": now_iso,
        }},
        return_document=ReturnDocument.BEFORE,
    )
    if before is None:
        raise HTTPException(
            status_code=409,
            detail="Withdrawal is not in a rejectable state (pending_approval, on_hold, or awaiting_treasury).",
        )

    uid = before.get("uid")
    asset = before.get("asset")
    total_charge = float(before.get("total_charge") or 0.0)
    try:
        if uid and asset and total_charge > 0:
            await wallet_service.unlock(
                uid, asset, total_charge,
                ref_type="withdrawal", ref_id=wd_id,
                meta={"phase": "withdrawal_rejected", "reason": reason},
            )
    except Exception:  # noqa: BLE001
        logger.exception("admin_reject_withdrawal: unlock failed for %s", wd_id)
        # Flag the row for manual review rather than silently leaving
        # the user's funds trapped.
        await db.withdrawal_requests.update_one(
            {"id": wd_id},
            {"$set": {
                "status": "rejected",
                "reconcile_required": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

    await _refund_withdrawal_ibo_fees(before, phase="withdrawal_rejected", reason=reason)

    try:
        fee_usdt_refund = float(before.get("fee_usdt") or 0.0)
        notional = _withdrawal_usdt_notional(asset or "", total_charge) + fee_usdt_refund
        await _refund_withdrawal_quota(uid, notional, day=before.get("day_key"))
    except Exception:  # noqa: BLE001
        logger.exception("admin_reject_withdrawal: quota refund failed for %s", wd_id)

    await log_admin_audit(
        auth,
        "withdrawal_reject",
        "withdrawal_requests",
        wd_id,
        {"uid": uid, "asset": asset, "amount": before.get("amount"), "reason": reason},
    )
    refreshed = await db.withdrawal_requests.find_one({"id": wd_id}, {"_id": 0})
    return {"ok": True, "withdrawal": refreshed}


# ── Phase 8 — Treasury reporting (admin) ──────────────────────────────────────

@api_router.get("/admin/treasury")
async def admin_treasury_overview(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Phase 8 — read-only snapshot of the platform's risk envelope.

    Returns:

    - ``positions``: per-asset treasury balance + USD value + per-symbol
      inventory limit + utilisation %. ``available`` < 0 means the platform
      is *short* that asset (owes inventory to users).
    - ``revenue``: total spread captured since cutover, plus a per-asset
      breakdown of SYSTEM-fill volume.
    - ``limits``: current spread defaults / overrides + per-symbol caps.
    - ``started_at``: cutover anchor (set on first startup after Phase 8).
    - ``provider``: blockchain provider readiness (so ops can spot a
      mis-configured deploy at a glance).

    The endpoint is intentionally read-only — all knobs are mutated via
    the existing ``/admin/platform/controls`` PATCH so we have a single
    audit trail for risk-parameter changes.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_treasury")

    controls = await get_platform_controls()
    spread_default = float(controls.get("system_spread_bps_default") or 0.0)
    spread_overrides = dict(controls.get("system_spread_bps_by_symbol") or {})
    limit_overrides = dict(
        controls.get("treasury_inventory_limit_base_by_symbol") or {}
    )

    wallets_raw = await treasury_service.list_wallets()
    fills_by_asset = await treasury_service.aggregate_fills_by_asset()
    spread_summary = await treasury_service.aggregate_spread_revenue()
    custody_raw = await treasury_service.get_custody_reserves_summary()

    # Per-asset rows. Walk every supported asset so the UI can render a
    # complete table even when an asset hasn't traded against SYSTEM yet.
    wallet_map = {(w.get("asset") or "").upper(): w for w in wallets_raw}
    deposit_assets = {
        str(k).upper()
        for k in (custody_raw.get("totals") or {}).get("expected_by_asset") or {}
    }
    all_assets = sorted({*SYMBOL_BASE_MAP.values(), "USDT", *deposit_assets})

    positions: List[Dict[str, Any]] = []
    total_long_usdt = 0.0
    total_short_usdt = 0.0
    for asset in all_assets:
        w = wallet_map.get(asset, {})
        avail = float((w or {}).get("available") or 0.0)
        locked = float((w or {}).get("locked") or 0.0)
        net = avail + locked
        # USD valuation. USDT is itself the unit, IBO has no Binance
        # mark — fall back to FALLBACK_PRICES for IBO (synthetic).
        if asset == "USDT":
            mark = 1.0
        else:
            mark = _cached_price_usdt(asset)
        usd_value = net * mark

        # Limit utilisation (only meaningful for non-USDT assets that
        # appear in SYMBOL_BASE_MAP via their own pair).
        sym = f"{asset}USDT"
        sym_limit = (
            float(limit_overrides.get(sym))
            if (sym in limit_overrides and float(limit_overrides[sym] or 0) > 0)
            else None
        )
        utilisation = None
        if sym_limit and sym_limit > 0:
            utilisation = round(min(1.0, abs(net) / sym_limit) * 100.0, 2)

        fills = fills_by_asset.get(asset, {})
        positions.append({
            "asset":            asset,
            "available":        round(avail, 8),
            "locked":           round(locked, 8),
            "net_position":     round(net, 8),
            "is_short":         net < -1e-12,
            "mark_price_usdt":  round(mark, 8),
            "usd_value":        round(usd_value, 4),
            "limit_base":       sym_limit,
            "utilisation_pct":  utilisation,
            "spread_bps":       resolve_system_spread_bps(controls, sym),
            "fills_inflow":     fills.get("inflow", 0.0),
            "fills_outflow":    fills.get("outflow", 0.0),
            "fill_legs":        fills.get("fill_legs", 0),
        })
        if usd_value > 0:
            total_long_usdt += usd_value
        else:
            total_short_usdt += usd_value  # negative

    custody_rows: List[Dict[str, Any]] = []
    custody_expected_usd = 0.0
    custody_mirrored_usd = 0.0
    for row in custody_raw.get("rows") or []:
        ast = str(row.get("asset") or "").upper()
        if not ast:
            continue
        mark = 1.0 if ast == "USDT" else _cached_price_usdt(ast)
        expected = float(row.get("expected_net") or 0.0)
        mirrored = float(row.get("mirrored_net") or 0.0)
        expected_usd = round(expected * mark, 4)
        mirrored_usd = round(mirrored * mark, 4)
        custody_expected_usd += expected_usd
        custody_mirrored_usd += mirrored_usd
        custody_rows.append({
            **row,
            "mark_price_usdt": round(mark, 8),
            "expected_usd": expected_usd,
            "mirrored_usd": mirrored_usd,
        })

    # Provider snapshot — useful for "why is treasury empty?" debugging.
    try:
        provider = blockchain_service.get_provider()
        provider_supported = provider.list_supported_networks()
    except Exception:  # noqa: BLE001
        provider_supported = []

    return {
        "started_at":   controls.get("treasury_started_at"),
        "positions":    positions,
        "totals":       {
            "long_usdt":  round(total_long_usdt, 4),
            "short_usdt": round(total_short_usdt, 4),
            "net_usdt":   round(total_long_usdt + total_short_usdt, 4),
        },
        "revenue":      {
            "spread_total_usdt": spread_summary.get("total_usdt", 0.0),
            "spread_fill_count": spread_summary.get("fill_count", 0),
        },
        "custody":      {
            "rows": custody_rows,
            "expected_usd": round(custody_expected_usd, 4),
            "mirrored_usd": round(custody_mirrored_usd, 4),
            "sync_gap_usd": round(custody_expected_usd - custody_mirrored_usd, 4),
        },
        "limits":       {
            "spread_bps_default":     spread_default,
            "spread_bps_by_symbol":   spread_overrides,
            "inventory_limit_base":   limit_overrides,
        },
        "provider":     {
            "configured":         len(provider_supported) > 0,
            "supported_networks": provider_supported,
        },
    }


@api_router.get("/admin/treasury/deposit-summary")
async def admin_treasury_deposit_summary(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    uid: Optional[str] = None,
    asset: Optional[str] = None,
):
    """Per-user deposit summary sourced exclusively from credited deposit_events.

    Unlike the wallets collection (which includes signup bonuses, manual
    adjustments, and trading PnL), this endpoint only counts real on-chain
    credits so operators see exactly what was deposited.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_treasury")

    match_filt: Dict[str, Any] = {"status": "credited"}
    if uid:
        match_filt["uid"] = uid.strip()
    if asset:
        match_filt["asset"] = asset.strip().upper()

    # Per-user, per-asset totals from credited deposit events.
    pipeline = [
        {"$match": match_filt},
        {
            "$group": {
                "_id": {"uid": "$uid", "asset": "$asset"},
                "total_deposited": {
                    "$sum": {"$ifNull": ["$credited_amount", {"$ifNull": ["$amount", 0]}]},
                },
                "event_count": {"$sum": 1},
                "last_credited_at": {"$max": "$credited_at"},
            },
        },
        {"$sort": {"_id.uid": 1, "_id.asset": 1}},
    ]
    rows_raw = await db.deposit_events.aggregate(pipeline).to_list(length=2000)

    # Asset-level totals (for headline numbers).
    asset_totals: Dict[str, float] = {}
    user_rows = []
    for r in rows_raw:
        ast = str((r.get("_id") or {}).get("asset") or "").upper()
        u = str((r.get("_id") or {}).get("uid") or "")
        qty = float(r.get("total_deposited") or 0.0)
        if not ast or qty <= 0:
            continue
        asset_totals[ast] = round(asset_totals.get(ast, 0.0) + qty, 8)
        user_rows.append({
            "uid": u,
            "asset": ast,
            "total_deposited": round(qty, 8),
            "event_count": int(r.get("event_count") or 0),
            "last_credited_at": r.get("last_credited_at"),
        })

    # USD valuation for asset totals.
    asset_summary = []
    grand_usdt = 0.0
    for ast in sorted(asset_totals.keys()):
        qty = asset_totals[ast]
        mark = 1.0 if ast == "USDT" else _cached_price_usdt(ast)
        usd = round(qty * mark, 4)
        grand_usdt += usd
        asset_summary.append({
            "asset": ast,
            "total_deposited": qty,
            "mark_price_usdt": round(mark, 8),
            "usd_value": usd,
        })

    return {
        "asset_totals": asset_summary,
        "grand_total_usd": round(grand_usdt, 4),
        "user_rows": user_rows,
        "note": "Only includes on-chain deposit_events with status=credited. Excludes signup bonuses, manual adjustments, and trading PnL.",
    }


@api_router.post("/admin/treasury/sync-custody")
async def admin_treasury_sync_custody(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Backfill treasury custody rows from credited deposit events (minus confirmed withdrawals)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_treasury")
    result = await treasury_service.sync_custody_from_events()
    await log_admin_audit(
        auth,
        "treasury_sync_custody",
        "treasury",
        "",
        {"adjustments": result.get("adjustments") or []},
    )
    return {"ok": True, **result}


# ── Phase 1 — Omnibus hot/cold watch registry (admin) ──────────────────────────


class TreasuryOmnibusWalletCreate(BaseModel):
    """Register a watch-only hot or cold omnibus address (v1: BTC + ETH/USDT ERC-20)."""

    model_config = ConfigDict(extra="forbid")
    role: Literal["hot", "cold"]
    asset: str = Field(..., min_length=2, max_length=16)
    network: str = Field(..., min_length=2, max_length=120)
    address: str = Field(..., min_length=6, max_length=200)
    label: Optional[str] = Field(None, max_length=200)
    enabled: bool = True
    is_default_payout: bool = False
    idempotency_key: Optional[str] = Field(None, max_length=128)


class TreasuryOmnibusWalletPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Optional[str] = Field(None, max_length=200)
    enabled: Optional[bool] = None
    is_default_payout: Optional[bool] = None


@api_router.get("/admin/treasury/omnibus-wallets")
async def admin_list_treasury_omnibus_wallets(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    role: Optional[str] = Query(None, description="hot or cold"),
    enabled: Optional[bool] = None,
    asset: Optional[str] = None,
    network: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List configured omnibus watch addresses (no balances in Phase 1)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_treasury")
    items, total = await tw_registry.list_wallets(
        db,
        role=role,
        enabled=enabled,
        asset=asset,
        network=network,
        skip=skip,
        limit=limit,
    )
    return {
        "items": items,
        "total": total,
        "skip": skip,
        "limit": limit,
        "allowed_asset_networks": [
            {"asset": a, "network": n} for a, n in tw_registry.TREASURY_WALLET_V1_ASSET_NETWORKS
        ],
        "treasury_signers": {
            a: tw_registry.treasury_signer_for_asset(a)
            for a in sorted({pair[0] for pair in tw_registry.TREASURY_WALLET_V1_ASSET_NETWORKS})
        },
        "treasury_cold_signer": tw_registry.treasury_cold_signer_address(),
    }


@api_router.post("/admin/treasury/omnibus-wallets")
async def admin_create_treasury_omnibus_wallet(
    body: TreasuryOmnibusWalletCreate,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Create a treasury omnibus row. Idempotent when ``idempotency_key`` repeats."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "manage_treasury")
    idem = (body.idempotency_key or "").strip() or None
    if idem:
        existing = await db.treasury_wallets.find_one({"idempotency_key": idem}, {"_id": 0})
        if existing:
            return tw_registry.wallet_doc_to_public(existing)

    if body.role == "cold" and body.is_default_payout:
        raise HTTPException(status_code=400, detail="Cold wallets cannot be default payout")

    try:
        norm = tw_registry.validate_wallet_row(
            role=body.role,
            asset=body.asset,
            network=body.network,
            address=body.address,
            label=body.label,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    now = datetime.now(timezone.utc).isoformat()
    aid = (auth.admin or {}).get("aid")
    em = (auth.admin or {}).get("email")
    wid = tw_registry.new_wallet_id()
    is_def = bool(body.is_default_payout and norm["role"] == "hot")

    if is_def:
        await tw_registry.clear_default_payout_for_hot_asset_network(
            db, asset=norm["asset"], network=norm["network"], except_wallet_id=None,
        )

    doc: Dict[str, Any] = {
        "id": wid,
        **norm,
        "enabled": bool(body.enabled),
        "is_default_payout": is_def,
        "created_at": now,
        "updated_at": now,
        "created_by_aid": aid,
        "updated_by_aid": aid,
        "created_by_email": em,
        "updated_by_email": em,
    }
    if idem:
        doc["idempotency_key"] = idem
    try:
        await db.treasury_wallets.insert_one(doc)
    except DuplicateKeyError as exc:
        if idem:
            hit = await db.treasury_wallets.find_one({"idempotency_key": idem}, {"_id": 0})
            if hit:
                return tw_registry.wallet_doc_to_public(hit)
        raise HTTPException(
            status_code=409,
            detail="A treasury omnibus row with this role, asset, network, and address already exists.",
        ) from exc

    pub = tw_registry.wallet_doc_to_public(doc)
    try:
        await tw_registry.append_audit(
            db,
            wallet_id=wid,
            action="created",
            admin_aid=aid,
            admin_email=em,
            before={},
            after=pub,
            idempotency_key=idem,
        )
    except Exception:  # noqa: BLE001
        logger.exception("treasury_wallet_audit insert failed wallet_id=%s", wid)
    await log_admin_audit(
        auth,
        "treasury_omnibus_wallet_create",
        "treasury_wallet",
        wid,
        {"payload": {k: v for k, v in pub.items() if k not in ("idempotency_key",)}},
    )
    try:
        n = await tw_registry.promote_awaiting_treasury_to_approved(db, context="after_omnibus_create")
        if n:
            logger.info("treasury omnibus create promoted %d withdrawal(s) to approved", n)
    except Exception:  # noqa: BLE001
        logger.exception("promote_awaiting_treasury_to_approved after omnibus create")
    return pub


@api_router.patch("/admin/treasury/omnibus-wallets/{wallet_id}")
async def admin_patch_treasury_omnibus_wallet(
    wallet_id: str,
    body: TreasuryOmnibusWalletPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Update label / enabled / default payout flag. Address and role are immutable."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "manage_treasury")
    before = await db.treasury_wallets.find_one({"id": wallet_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Treasury wallet not found")
    if before.get("role") == "cold" and body.is_default_payout is True:
        raise HTTPException(status_code=400, detail="Cold wallets cannot be default payout")

    updates: Dict[str, Any] = {}
    if body.label is not None:
        updates["label"] = body.label.strip()[:200] or None
    if body.enabled is not None:
        updates["enabled"] = bool(body.enabled)
    if body.is_default_payout is not None:
        if before.get("role") != "hot" and body.is_default_payout:
            raise HTTPException(status_code=400, detail="Only hot wallets can be default payout")
        updates["is_default_payout"] = bool(body.is_default_payout)

    if not updates:
        raise HTTPException(status_code=400, detail="No updates")

    if updates.get("enabled") is False:
        updates["is_default_payout"] = False

    now = datetime.now(timezone.utc).isoformat()
    updates["updated_at"] = now
    updates["updated_by_aid"] = (auth.admin or {}).get("aid")
    updates["updated_by_email"] = (auth.admin or {}).get("email")

    if updates.get("is_default_payout") is True:
        await tw_registry.clear_default_payout_for_hot_asset_network(
            db,
            asset=str(before.get("asset") or ""),
            network=str(before.get("network") or ""),
            except_wallet_id=None,
        )

    await db.treasury_wallets.update_one({"id": wallet_id}, {"$set": updates})
    after = await db.treasury_wallets.find_one({"id": wallet_id}, {"_id": 0})
    pub = tw_registry.wallet_doc_to_public(after or {})

    try:
        await tw_registry.append_audit(
            db,
            wallet_id=wallet_id,
            action="updated",
            admin_aid=(auth.admin or {}).get("aid"),
            admin_email=(auth.admin or {}).get("email"),
            before=tw_registry.wallet_doc_to_public(before),
            after=pub,
        )
    except Exception:  # noqa: BLE001
        logger.exception("treasury_wallet_audit insert failed wallet_id=%s", wallet_id)
    await log_admin_audit(
        auth,
        "treasury_omnibus_wallet_patch",
        "treasury_wallet",
        wallet_id,
        {"updates": updates},
    )
    try:
        n = await tw_registry.promote_awaiting_treasury_to_approved(db, context="after_omnibus_patch")
        if n:
            logger.info("treasury omnibus patch promoted %d withdrawal(s) to approved", n)
    except Exception:  # noqa: BLE001
        logger.exception("promote_awaiting_treasury_to_approved after omnibus patch")
    return pub


@api_router.get("/admin/treasury/omnibus-wallets/{wallet_id}/audit")
async def admin_treasury_omnibus_wallet_audit(
    wallet_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """Append-only audit trail for a single omnibus wallet row."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "view_treasury")
    exists = await db.treasury_wallets.find_one({"id": wallet_id}, {"_id": 0, "id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Treasury wallet not found")
    cur = (
        db.treasury_wallet_audit.find({"wallet_id": wallet_id}, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    rows = await cur.to_list(length=limit)
    total = await db.treasury_wallet_audit.count_documents({"wallet_id": wallet_id})
    return {"items": rows, "total": total, "skip": skip, "limit": limit}


class AdminDepositSweepRunBody(BaseModel):
    """Manual deposit sweep. Defaults preserve backward compatibility (dry-run)."""

    model_config = ConfigDict(extra="forbid")
    dry_run: bool = True
    confirm_live: bool = False
    asset: Optional[str] = Field(None, max_length=16)
    network: Optional[str] = Field(None, max_length=120)
    limit: int = Field(30, ge=1, le=500)
    idempotency_key: Optional[str] = Field(None, max_length=120)
    auto_gas_fund: bool = Field(
        False,
        description=(
            "Gas-station mode: when true and a token sweep returns insufficient_gas, "
            "the hot wallet automatically sends a small BNB/ETH amount to the deposit "
            "address and retries the sweep. Only active on live (dry_run=false) runs."
        ),
    )


@api_router.get("/admin/treasury/deposit-sweeps/live-status")
async def admin_deposit_sweeps_live_status(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Return the current live-sweep enablement state (env var + admin panel toggle)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "view_treasury")
    env_flag = deposit_sweep_service._live_sweep_env_enabled()
    controls = await get_platform_controls()
    db_flag = bool(controls.get("deposit_sweep_live_enabled", False))
    return {
        "env_flag_set": env_flag,
        "admin_panel_flag_set": db_flag,
        "effective": env_flag or db_flag,
    }


@api_router.post("/admin/treasury/deposit-sweeps/preview")
async def admin_deposit_sweeps_preview(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    asset: Optional[str] = None,
    network: Optional[str] = None,
    limit: int = Query(30, ge=1, le=500),
):
    """Plan only: balances + sweep targets (read-only RPC + DB reads)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "view_treasury")
    items, err = await deposit_sweep_service.plan_items(db, asset=asset, network=network, limit=limit)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "items": items, "limit": limit}


@api_router.post("/admin/treasury/deposit-sweeps/run")
async def admin_deposit_sweeps_run(
    body: AdminDepositSweepRunBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Record a sweep run. Live native-ETH broadcast requires env + ``confirm_live``."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "manage_treasury")
    aid = (auth.admin or {}).get("aid")
    controls = await get_platform_controls()
    db_live_enabled = bool(controls.get("deposit_sweep_live_enabled", False))
    out = await deposit_sweep_service.run_sweep(
        db,
        dry_run=bool(body.dry_run),
        confirm_live=bool(body.confirm_live),
        asset=body.asset,
        network=body.network,
        limit=int(body.limit),
        idempotency_key=body.idempotency_key,
        admin_aid=aid,
        admin_panel_live_enabled=db_live_enabled,
        auto_gas_fund=bool(body.auto_gas_fund),
    )
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("error") or "sweep_failed")
    run = out.get("run") or {}
    await log_admin_audit(
        auth,
        "deposit_sweep_run",
        "deposit_sweep_runs",
        str(run.get("id") or ""),
        {
            "mode": run.get("mode"),
            "status": run.get("status"),
            "dry_run": run.get("dry_run"),
            "replay": out.get("replay"),
            "item_count": len(run.get("items") or []),
        },
    )
    return out


@api_router.get("/admin/treasury/deposit-sweeps/history")
async def admin_deposit_sweeps_history(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List past sweep runs newest-first, with summary stats per run."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "view_treasury")
    total = await db.deposit_sweep_runs.count_documents({})
    cursor = (
        db.deposit_sweep_runs
        .find({}, {"_id": 0, "items": 0})  # exclude large items array from list view
        .sort("created_at", -1)
        .skip(offset)
        .limit(limit)
    )
    runs = await cursor.to_list(length=limit)
    return {"ok": True, "runs": runs, "total": total, "limit": limit, "offset": offset}


@api_router.get("/admin/treasury/deposit-sweeps/runs/{run_id}")
async def admin_deposit_sweeps_run_detail(
    run_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Fetch one sweep run with full item list."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "view_treasury")
    run = await db.deposit_sweep_runs.find_one({"id": run_id}, {"_id": 0})
    if run is None:
        raise HTTPException(status_code=404, detail="sweep_run_not_found")
    return {"ok": True, "run": run}


@api_router.get("/admin/treasury/admin-wallet")
async def admin_treasury_admin_wallet_overview(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Treasury wallet KPIs, on-chain balances, and flow stats."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_treasury")
    bonus_ibo = await get_signup_bonus_ibo()
    return await admin_wallet_svc.build_overview(db, signup_bonus_ibo=bonus_ibo)


@api_router.get("/admin/treasury/admin-wallet/transactions")
async def admin_treasury_admin_wallet_transactions(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
    type: Optional[str] = Query(None, description="deposit | signup_bonus | withdrawal | sweep | all"),
    status: Optional[str] = None,
    uid: Optional[str] = None,
    tx_hash: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """Filterable treasury movement feed: deposits, signup bonuses, withdrawals, sweeps."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_treasury")
    items, total = await admin_wallet_svc.list_transactions(
        db,
        tx_type=type,
        status=status,
        uid=uid,
        tx_hash=tx_hash,
        search=search,
        date_from=date_from,
        date_to=date_to,
        skip=skip,
        limit=limit,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


class AdminWalletAddressSlot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str = Field(..., min_length=6, max_length=200)
    label: Optional[str] = Field(None, max_length=200)
    enabled: bool = True


class AdminWalletTreasurySlotPatch(BaseModel):
    """Upsert any allowed treasury omnibus row (BTC / ETH / USDT / IBO)."""

    model_config = ConfigDict(extra="forbid")
    role: Literal["hot", "cold", "deposit"]
    asset: str = Field(..., min_length=2, max_length=16)
    network: str = Field(..., min_length=2, max_length=120)
    address: str = Field(..., min_length=6, max_length=200)
    label: Optional[str] = Field(None, max_length=200)
    enabled: bool = True


class AdminWalletAddressesPatch(BaseModel):
    """Upsert treasury omnibus addresses from the admin wallet page."""

    model_config = ConfigDict(extra="forbid")
    hot: Optional[AdminWalletAddressSlot] = None
    cold: Optional[AdminWalletAddressSlot] = None
    wallet: Optional[AdminWalletTreasurySlotPatch] = None


@api_router.patch("/admin/treasury/admin-wallet/addresses")
async def admin_treasury_admin_wallet_addresses_patch(
    body: AdminWalletAddressesPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Create or update treasury hot/cold addresses from the admin wallet page."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_jwt_not_apikey(auth)
    _require_admin_permission(auth, "manage_treasury")
    if not body.hot and not body.cold and not body.wallet:
        raise HTTPException(status_code=400, detail="Provide wallet, hot, and/or cold address updates")

    aid = (auth.admin or {}).get("aid")
    em = (auth.admin or {}).get("email")
    updated: List[Dict[str, Any]] = []
    try:
        if body.wallet:
            updated.append(
                await admin_wallet_svc.upsert_treasury_wallet_address(
                    db,
                    role=body.wallet.role,
                    asset=body.wallet.asset,
                    network=body.wallet.network,
                    address=body.wallet.address,
                    label=body.wallet.label,
                    enabled=body.wallet.enabled,
                    admin_aid=aid,
                    admin_email=em,
                ),
            )
        if body.hot:
            updated.append(
                await admin_wallet_svc.upsert_ibo_wallet_address(
                    db,
                    role="hot",
                    address=body.hot.address,
                    label=body.hot.label,
                    enabled=body.hot.enabled,
                    admin_aid=aid,
                    admin_email=em,
                ),
            )
        if body.cold:
            updated.append(
                await admin_wallet_svc.upsert_ibo_wallet_address(
                    db,
                    role="cold",
                    address=body.cold.address,
                    label=body.cold.label,
                    enabled=body.cold.enabled,
                    admin_aid=aid,
                    admin_email=em,
                ),
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await log_admin_audit(
        auth,
        "admin_wallet_addresses_patch",
        "treasury_wallet",
        "ibo_bep20",
        {"updated_roles": [u.get("role") for u in updated]},
    )
    bonus_ibo = await get_signup_bonus_ibo()
    return await admin_wallet_svc.build_overview(db, signup_bonus_ibo=bonus_ibo)


# ── Phase 8d — Binance hedger (admin) ─────────────────────────────────────────

class HedgerSymbolPatch(BaseModel):
    """Per-symbol hedger config. All fields optional so partial updates work."""

    mode: Optional[str] = Field(None, pattern=r"^(off|manual|auto)$")
    rebalance_threshold: Optional[float] = Field(None, ge=0.0)
    max_hedge_size: Optional[float] = Field(None, ge=0.0)
    cooldown_sec: Optional[float] = Field(None, ge=0.0, le=86_400.0)


class HedgerExecuteRequest(BaseModel):
    """Manual hedge execution body.

    ``qty`` is optional — when omitted we fall back to the latest stored
    suggestion for the symbol, which lets the admin click "Execute" in
    the UI without re-entering the number.
    """

    side: Literal["buy", "sell"]
    qty: Optional[float] = Field(None, gt=0)
    reason: Optional[str] = Field("manual", max_length=80)


@api_router.get("/admin/hedger")
async def admin_hedger_overview(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Return the live hedger dashboard payload.

    Per-symbol row includes:

    - effective config (mode / thresholds / cooldown) derived from
      ``platform_controls.hedger_by_symbol``
    - current treasury position + running ``net_hedged_qty`` offset
    - latest suggestion computed on-demand (independent of the worker's
      cached suggestion so the UI is always correct even if the worker
      is paused)
    - cooldown remaining in seconds
    - unhedgeable flag (e.g. IBO)
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_hedger")
    controls = await get_platform_controls()

    client = await hedger_service.get_client()
    rows: List[Dict[str, Any]] = []
    for sym in BINANCE_USDT_PAIRS:
        base = sym[:-4] if sym.endswith("USDT") else sym
        cfg = hedger_service.resolve_symbol_config(controls, sym)
        treasury_pos = await treasury_service.get_position(base)
        state = await hedger_service.get_state(sym)
        net_hedged = float(state.get("net_hedged_qty") or 0.0)
        suggestion = hedger_service.suggest_hedge(
            symbol=sym,
            treasury_pos_base=treasury_pos,
            net_hedged_qty=net_hedged,
            config=cfg,
        )
        cooldown_left = hedger_service._cooldown_remaining_sec(
            state, float(cfg.get("cooldown_sec") or 0.0),
        )
        rows.append({
            "symbol":              sym,
            "base_asset":          base,
            "config":              cfg,
            "treasury_pos_base":   round(treasury_pos, 8),
            "net_hedged_qty":      round(net_hedged, 8),
            "treasury_mark_usdt":  round(_cached_price_usdt(base), 8),
            "suggestion":          suggestion,
            "cooldown_remaining_sec": round(cooldown_left, 2),
            "last_hedge_at":       state.get("last_hedge_at"),
            "last_evaluated_at":   state.get("last_evaluated_at"),
            "unhedgeable":         base in hedger_service.UNHEDGEABLE_BASES,
        })

    # Pull a compact slice of recent trades so the dashboard has history.
    recent_trades = await hedger_service.list_trades(limit=50)

    # Surface the worker lifecycle so the admin UI can call out the most
    # common "I flipped the master switch but nothing happens" trap: the
    # background task is gated by ``HEDGER_WORKER_ENABLED`` in the backend
    # env and only ever attaches at startup. The DB toggle alone is not
    # enough — both must be truthy.
    worker_env_enabled = hedger_worker._is_enabled()
    worker_attached = bool(
        _hedger_worker_task is not None and not _hedger_worker_task.done()
    )
    return {
        "enabled":           bool(controls.get("hedger_enabled", False)),
        "dry_run":           bool(controls.get("hedger_dry_run", True)),
        "default_mode":      controls.get("hedger_default_mode", "off"),
        "price_sanity_bps":  float(controls.get("hedger_price_sanity_bps") or 0.0),
        "testnet":           client.testnet,
        "has_credentials":   client.has_credentials,
        "worker_env_enabled": worker_env_enabled,
        "worker_attached":    worker_attached,
        "symbols":           rows,
        "recent_trades":     recent_trades,
    }


@api_router.get("/admin/hedger/trades")
async def admin_hedger_trades(
    symbol: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Paginated hedge-trade history. Newest first, up to ``limit`` rows."""
    _require_admin_permission(_auth, "view_hedger")
    items = await hedger_service.list_trades(limit=limit, symbol=symbol)
    return {"items": items, "count": len(items)}


@api_router.patch("/admin/hedger/symbol/{symbol}")
async def admin_patch_hedger_symbol(
    symbol: str,
    body: HedgerSymbolPatch,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Update per-symbol hedger config.

    Rejects unknown symbols and IBO (not hedgeable). Stores under
    ``platform_controls.hedger_by_symbol`` so the worker + dashboard
    both pick up the change on the next tick without a restart.
    """
    _require_admin_permission(auth, "manage_hedger")
    sym = symbol.upper().strip()
    if sym not in SYMBOL_BASE_MAP:
        raise HTTPException(400, f"Unknown symbol: {sym}")
    base = SYMBOL_BASE_MAP[sym]
    if base in hedger_service.UNHEDGEABLE_BASES:
        raise HTTPException(
            400,
            f"{base} is not hedgeable (no Binance market — IBO is internal-only).",
        )
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    controls = await get_platform_controls()
    table = dict(controls.get("hedger_by_symbol") or {})
    current = dict(table.get(sym) or {})
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No fields provided")
    current.update(patch)
    table[sym] = current

    now = datetime.now(timezone.utc).isoformat()
    await db.platform_controls.update_one(
        {"id": "global"},
        {"$set": {"hedger_by_symbol": table, "updated_at": now}},
        upsert=True,
    )
    await log_admin_audit(
        auth, "hedger_config_update", "hedger_by_symbol", sym,
        {"patch": patch, "merged": current},
    )
    return {"ok": True, "symbol": sym, "config": current}


@api_router.post("/admin/hedger/symbol/{symbol}/execute")
async def admin_execute_hedge(
    symbol: str,
    body: HedgerExecuteRequest,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Manually place a hedge for ``symbol``.

    - Uses the existing safety rails in :func:`hedger_service.execute_hedge`
      (cooldown, LOT_SIZE, MIN_NOTIONAL, price sanity).
    - Ignores per-symbol ``mode=off`` — explicit admin action takes
      precedence. (Manual mode is the happy path; off lets ops hedge once
      without flipping the symbol into manual.)
    - Respects the global kill switch ``hedger_enabled``.
    """
    _require_admin_permission(auth, "execute_hedger")
    sym = symbol.upper().strip()
    if sym not in SYMBOL_BASE_MAP:
        raise HTTPException(400, f"Unknown symbol: {sym}")
    base = SYMBOL_BASE_MAP[sym]
    if base in hedger_service.UNHEDGEABLE_BASES:
        raise HTTPException(400, f"{base} is not hedgeable on Binance.")

    controls = await get_platform_controls()
    if not controls.get("hedger_enabled", False):
        raise HTTPException(
            409,
            "Hedger master switch is OFF. Enable it in Settings before executing hedges.",
        )
    cb = await _binance_breaker_status(controls)
    if cb.get("open"):
        retry_after = cb.get("retry_after_sec")
        detail = "Binance circuit breaker is open."
        if retry_after is not None:
            detail = f"Binance circuit breaker is open (retry in ~{retry_after}s)."
        raise HTTPException(409, detail)

    # Resolve the quantity. When the client omits it we fall back to the
    # latest suggestion so the UI can ship a one-click "Execute" button.
    qty = body.qty
    if qty is None:
        state = await hedger_service.get_state(sym)
        sug = (state or {}).get("last_suggestion") or {}
        qty = float(sug.get("target_qty") or 0.0)
    if not qty or qty <= 0:
        raise HTTPException(400, "No suggestion available — pass an explicit qty.")

    client = await hedger_service.get_client()
    treasury_mark = _cached_price_usdt(base)
    admin_email = (auth.admin or {}).get("email") if auth.admin else None

    try:
        start_ms = time.perf_counter()
        trade = await hedger_service.execute_hedge(
            symbol=sym,
            side=body.side,
            qty=qty,
            reason=body.reason or "manual",
            initiator="admin",
            controls=controls,
            client=client,
            treasury_mark=treasury_mark,
            admin_email=admin_email,
            mode="manual",
        )
        latency_ms = (time.perf_counter() - start_ms) * 1000.0
        await _record_binance_exec_outcome(ok=True, latency_ms=latency_ms)
    except hedger_service.HedgerSafetyError as exc:
        latency_ms = (time.perf_counter() - start_ms) * 1000.0 if "start_ms" in locals() else 0.0
        await _record_binance_exec_outcome(ok=False, latency_ms=latency_ms, error=str(exc))
        raise HTTPException(409, f"Hedge blocked by safety rail: {exc}") from exc
    except hedger_service.HedgerConfigError as exc:
        latency_ms = (time.perf_counter() - start_ms) * 1000.0 if "start_ms" in locals() else 0.0
        await _record_binance_exec_outcome(ok=False, latency_ms=latency_ms, error=str(exc))
        raise HTTPException(503, f"Hedger misconfigured: {exc}") from exc
    except hedger_service.HedgerError as exc:
        latency_ms = (time.perf_counter() - start_ms) * 1000.0 if "start_ms" in locals() else 0.0
        await _record_binance_exec_outcome(ok=False, latency_ms=latency_ms, error=str(exc))
        raise HTTPException(502, f"Hedge execution failed: {exc}") from exc

    await log_admin_audit(
        auth, "hedger_manual_execute", "hedge_trades",
        str(trade.get("id") or ""),
        {
            "symbol": sym, "side": body.side, "qty": qty,
            "status": trade.get("status"),
            "binance_order_id": trade.get("binance_order_id"),
            "dry_run": trade.get("dry_run"),
        },
    )
    return {"ok": True, "trade": trade}


# ── Phase 9a — Hedger reconciliation (admin) ──────────────────────────────────
#
# Compare what the Binance account actually holds against what the hedger
# thinks it holds. Three endpoints:
#
#   GET  /api/admin/hedger/reconcile             — read-only snapshot
#   POST /api/admin/hedger/reconcile/snapshot    — lock in seed-capital
#                                                   baselines (audit-logged)
#   POST /api/admin/hedger/reconcile/accept      — snap internal net_hedged
#                                                   to match actual balance
#                                                   (superadmin-only)

class HedgerBaselineSnapshotRequest(BaseModel):
    """Optional note attached to the baseline snapshot audit row."""

    note: Optional[str] = Field(None, max_length=300)


class HedgerAcceptDriftRequest(BaseModel):
    asset: str = Field(..., min_length=1, max_length=16)
    note: Optional[str] = Field(None, max_length=300)


def _reconcile_supported_bases() -> List[str]:
    """Bases the platform treats as first-class hedge targets.

    Pulled from ``SYMBOL_BASE_MAP`` minus IBO (synthetic, not on Binance).
    Kept narrow on purpose so the reconcile table doesn't balloon with
    every ERC-20 ops happens to dust-send into the Binance account.
    """
    return sorted(
        {b for b in SYMBOL_BASE_MAP.values()
         if b not in hedger_service.UNHEDGEABLE_BASES}
    )


@api_router.get("/admin/hedger/reconcile")
async def admin_hedger_reconcile(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Return the live reconciliation snapshot.

    Safe to call frequently: reads Binance ``/api/v3/account`` once, joins
    against ``hedger_state`` + ``hedger_baselines``, and returns a ready-
    to-render table. Binance failures surface as ``error`` in the payload
    so the UI can show baselines / internal state anyway.
    """
    _require_admin_permission(_auth, "view_hedger")
    controls = await get_platform_controls()
    client = await hedger_service.get_client()
    snapshot = await hedger_service.reconcile(
        client=client,
        price_lookup=_cached_price_usdt,
        supported_bases=_reconcile_supported_bases(),
        controls=controls,
    )
    return snapshot


@api_router.post("/admin/hedger/reconcile/snapshot")
async def admin_hedger_reconcile_snapshot(
    body: HedgerBaselineSnapshotRequest,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Overwrite ``hedger_baselines`` with the CURRENT Binance totals.

    Call this after funding the Binance account with seed capital. The
    very next /reconcile call will therefore show drift ≈ 0 for every
    asset that was present at snapshot time.

    Superadmin-only: this is a "trust me, this is the new zero" action
    and silently hides any drift that existed before the click.
    """
    _require_admin_permission(auth, "manage_hedger")
    if (auth.admin or {}).get("role") != "superadmin":
        raise HTTPException(
            status_code=403,
            detail="Only superadmins can snapshot the reconciliation baseline.",
        )

    client = await hedger_service.get_client()
    try:
        balances = await hedger_service.get_binance_balances(
            client, include_zero=False,
        )
    except hedger_service.HedgerConfigError as exc:
        raise HTTPException(503, f"Hedger misconfigured: {exc}") from exc
    except (hedger_service.BinanceAPIError, hedger_service.HedgerError) as exc:
        raise HTTPException(502, f"Binance call failed: {exc}") from exc

    if not balances:
        raise HTTPException(
            409,
            "Binance account has no non-zero balances to snapshot.",
        )

    admin_email = (auth.admin or {}).get("email")
    rows = await hedger_service.snapshot_baselines(
        balances, snapshot_by=admin_email, note=body.note,
    )
    await log_admin_audit(
        auth, "hedger_baseline_snapshot", "hedger_baselines", "",
        {
            "count":    len(rows),
            "assets":   [r.get("id") for r in rows],
            "note":     body.note,
        },
    )
    return {"ok": True, "baselines": rows, "count": len(rows)}


@api_router.post("/admin/hedger/reconcile/accept")
async def admin_hedger_reconcile_accept(
    body: HedgerAcceptDriftRequest,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Snap the hedger's ``net_hedged_qty`` to match the observed
    Binance balance for ``body.asset``.

    Use case: ops manually traded on Binance to close a position; we
    need our internal counter to match so the worker doesn't re-hedge
    the "missing" quantity. Idempotent — calling twice in a row simply
    re-reads the live balance and produces the same result.

    Superadmin-only (balance mutation). Audit-logged.
    """
    _require_admin_permission(auth, "manage_hedger")
    if (auth.admin or {}).get("role") != "superadmin":
        raise HTTPException(
            status_code=403,
            detail="Only superadmins can accept reconciliation drift.",
        )

    client = await hedger_service.get_client()
    admin_email = (auth.admin or {}).get("email")
    try:
        result = await hedger_service.accept_drift(
            body.asset, client=client,
            admin_email=admin_email, note=body.note,
        )
    except hedger_service.HedgerSafetyError as exc:
        raise HTTPException(409, str(exc)) from exc
    except hedger_service.HedgerConfigError as exc:
        raise HTTPException(503, str(exc)) from exc
    except hedger_service.HedgerError as exc:
        raise HTTPException(502, str(exc)) from exc

    await log_admin_audit(
        auth, "hedger_accept_drift", "hedger_state",
        result.get("symbol") or body.asset.upper(),
        {
            "asset":               body.asset.upper(),
            "symbol":              result.get("symbol"),
            "previous_net_hedged": result.get("previous_net_hedged"),
            "new_net_hedged":      result.get("new_net_hedged"),
            "binance_qty":         result.get("binance_qty"),
            "baseline_qty":        result.get("baseline_qty"),
            "note":                body.note,
        },
    )
    return {"ok": True, "result": result}


# ── Phase 9b — Hedger PnL (admin) ─────────────────────────────────────────────

_HEDGER_PNL_WINDOWS: Tuple[str, ...] = ("24h", "7d", "30d", "all")


def _hedgeable_symbols() -> List[str]:
    """Symbol set the PnL report scopes over.

    Mirrors the set used by the hedger worker (BINANCE_USDT_PAIRS) so
    "zero-activity" rows appear for supported pairs that haven't traded
    in the window yet. IBO is internal-only — always excluded.
    """
    return [
        sym for sym in BINANCE_USDT_PAIRS
        if SYMBOL_BASE_MAP.get(sym) not in hedger_service.UNHEDGEABLE_BASES
    ]


@api_router.get("/admin/hedger/pnl")
async def admin_hedger_pnl(
    window: str = Query("7d", pattern=r"^(24h|7d|30d|all)$"),
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Return per-symbol + aggregate hedger PnL for the requested window.

    Level-A PnL (per the Phase 9b decision):

    - ``spread_revenue_usdt``  — captured from SYSTEM fills in ``trades``.
    - ``hedge_cost_usdt``      — slippage vs mark on real Binance fills
                                 in ``hedge_trades``. Negative = favourable.
    - ``net_realized_usdt``    — spread − hedge cost.
    - ``open_exposure_usdt``   — current treasury position × mark. Not
                                 folded into realised; shown side-by-side
                                 so ops can watch unhedged drift separately.

    Also returns a dense time series (hourly for 24h, daily otherwise)
    so the admin UI can render a quick bar chart without client-side
    bucketing.
    """
    if window not in _HEDGER_PNL_WINDOWS:
        raise HTTPException(400, f"Unknown window: {window}")
    _require_admin_permission(_auth, "view_hedger")
    controls = await get_platform_controls()
    payload = await hedger_service.compute_pnl(
        window=window,
        hedgeable_symbols=_hedgeable_symbols(),
        price_lookup=_cached_price_usdt,
        get_position_fn=treasury_service.get_position,
        treasury_started_at=controls.get("treasury_started_at"),
    )
    return payload


# ── Phase 9c — Alerts (admin) ────────────────────────────────────────────────
#
# Three user-visible endpoints:
#   GET    /api/admin/alerts              list + filters + pagination
#   GET    /api/admin/alerts/stats        counters for the nav badge
#   POST   /api/admin/alerts/{id}/resolve mark resolved
#   POST   /api/admin/alerts/{id}/mute    mark muted (no auto-reopen)
#   POST   /api/admin/alerts/test         synthetic alert (superadmin)
#
# Alert PRODUCTION points (``alert_service.raise_alert``) are wired
# inside the subsystems that detect the condition — see
# ``hedger_service.reconcile`` and ``hedger_service.execute_hedge``.
# Keeping callers close to the source means less cross-file state and
# fewer "where did this get raised from?" moments during on-call.


class AlertResolveRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class AlertTestRequest(BaseModel):
    severity: str = Field("warn", pattern=r"^(info|warn|critical)$")
    title:    str = Field("Synthetic test alert", max_length=200)
    message:  str = Field("This alert was emitted by POST /api/admin/alerts/test.",
                          max_length=2000)


async def _alert_webhook_params() -> Tuple[Optional[str], Optional[str]]:
    """Pull the webhook URL + min severity out of platform_controls.

    Trimmed + normalised so a whitespace-only URL is treated as
    disabled. Kept as a helper because every producer path needs it.
    """
    controls = await get_platform_controls()
    url = str(controls.get("alert_webhook_url") or "").strip() or None
    min_sev = str(controls.get("alert_webhook_min_severity") or "").strip().lower() or None
    return url, min_sev


@api_router.get("/admin/alerts")
async def admin_alerts_list(
    status: Optional[str] = Query(None, pattern=r"^(open|resolved|muted|all)$"),
    severity: Optional[str] = Query(None, pattern=r"^(info|warn|critical)$"),
    source: Optional[str] = Query(None, max_length=40),
    type: Optional[str] = Query(None, max_length=120),
    search: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Paginated alert list. Defaults to ``status=open`` so the page
    opens on what needs attention."""
    _require_admin_permission(auth, "view_alerts")
    return await alert_service.list_alerts(
        status=(status or "open"),
        severity=severity,
        source=source,
        type=type,
        search=search,
        page=page,
        limit=limit,
    )


@api_router.get("/admin/alerts/stats")
async def admin_alerts_stats(
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Small counter blob for the nav badge. Polled every ~30s; kept
    lean so it's cheap even at high admin-UI concurrency."""
    _require_admin_permission(auth, "view_alerts")
    return await alert_service.count_stats()


@api_router.post("/admin/alerts/{alert_id}/resolve")
async def admin_alerts_resolve(
    alert_id: str,
    body: AlertResolveRequest,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    _require_admin_permission(auth, "view_alerts")
    admin_email = (auth.admin or {}).get("email")
    try:
        doc = await alert_service.resolve_alert(
            alert_id, resolved_by=admin_email, note=body.note,
        )
    except alert_service.AlertError as exc:
        raise HTTPException(404, str(exc)) from exc
    await log_admin_audit(
        auth, "alert_resolve", "alerts", alert_id,
        {"note": body.note, "type": doc.get("type"), "severity": doc.get("severity")},
    )
    return {"ok": True, "alert": doc}


@api_router.post("/admin/alerts/{alert_id}/mute")
async def admin_alerts_mute(
    alert_id: str,
    body: AlertResolveRequest,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    _require_admin_permission(auth, "view_alerts")
    admin_email = (auth.admin or {}).get("email")
    try:
        doc = await alert_service.mute_alert(
            alert_id, muted_by=admin_email, note=body.note,
        )
    except alert_service.AlertError as exc:
        raise HTTPException(404, str(exc)) from exc
    await log_admin_audit(
        auth, "alert_mute", "alerts", alert_id,
        {"note": body.note, "type": doc.get("type"), "severity": doc.get("severity")},
    )
    return {"ok": True, "alert": doc}


@api_router.post("/admin/alerts/test")
async def admin_alerts_test(
    body: AlertTestRequest,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    """Emit a synthetic alert. Useful for verifying webhook wiring end
    to end without waiting for a real incident. Superadmin-only to
    keep the noise surface small."""
    _require_admin_jwt_not_apikey(auth)
    if (auth.admin or {}).get("role") != "superadmin":
        raise HTTPException(
            status_code=403, detail="Only superadmins can emit test alerts.",
        )
    url, min_sev = await _alert_webhook_params()
    doc = await alert_service.raise_alert(
        type="system.alert.test",
        severity=body.severity,
        source="system",
        title=body.title,
        message=body.message,
        meta={"triggered_by": (auth.admin or {}).get("email")},
        dedupe_key=None,  # never dedupe test alerts
        webhook_url=url,
        webhook_min_severity=min_sev,
    )
    await log_admin_audit(
        auth, "alert_test", "alerts", doc.get("id") or "",
        {"severity": body.severity, "title": body.title,
         "webhook_configured": bool(url)},
    )
    return {"ok": True, "alert": doc}


# Phase 1 — user-facing ledger endpoint
_USER_LEDGER_TYPES = {
    "deposit", "withdraw", "trade", "fee", "adjustment",
    "lock", "unlock", "seed", "opening_balance",
}


@api_router.get("/wallet/transactions")
async def get_wallet_transactions(
    current_user: dict = Depends(get_current_user),
    asset: Optional[str] = None,
    type: Optional[str] = None,
    ref_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Return this user's wallet ledger (``wallet_txns``), newest first.

    Filters:
    - ``asset``     – restrict to a single asset (case-insensitive)
    - ``type``      – single ledger type (deposit/withdraw/trade/fee/…)
    - ``ref_id``    – exact match (e.g. an order_id or withdrawal_id)
    - ``date_from`` – ISO-8601 inclusive lower bound on ``created_at``
    - ``date_to``   – ISO-8601 inclusive upper bound on ``created_at``
    """
    if db is None:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    ttype = None
    if type:
        ttype = type.strip().lower()
        if ttype not in _USER_LEDGER_TYPES:
            raise HTTPException(400, f"Unknown transaction type: {type}")
    items = await wallet_service.list_txns(
        uid=current_user["uid"],
        asset=asset,
        txn_type=ttype,
        ref_id=ref_id,
        date_from=date_from,
        date_to=date_to,
        skip=skip,
        limit=limit,
    )
    total = await wallet_service.count_txns(
        uid=current_user["uid"],
        asset=asset,
        txn_type=ttype,
        ref_id=ref_id,
        date_from=date_from,
        date_to=date_to,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


# ── Matching-engine helpers ───────────────────────────────────────────────────

# Live marks for P&L / valuation (Binance spot last); TTL avoids hammering API when many users share symbols.
_spot_px_cache: Dict[str, Tuple[float, float]] = {}
_spot_px_cache_lock = asyncio.Lock()
_SPOT_PX_CACHE_TTL_SEC = 1.25

# GAP-2: Circuit-breaker counters for Binance price failures (per symbol).
# When _PRICE_CB_THRESHOLD consecutive failures occur, a critical alert is raised
# so ops knows all fills are using stale/hardcoded fallback prices.
_price_fail_counts: Dict[str, int] = {}
_PRICE_CB_THRESHOLD = 5

# GAP-9: Maximum age (seconds) for _cached_price_usdt to use a hot-cache entry.
# Prevents hedger/deposit-crediter from using prices that are many minutes old.
_CACHED_PRICE_USDT_MAX_AGE_SEC = 60.0


def _binance_spot_last_price(sym: str) -> float:
    r = requests.get(
        "https://api.binance.com/api/v3/ticker/price",
        params={"symbol": sym},
        timeout=6,
    )
    r.raise_for_status()
    return float(r.json()["price"])


async def get_current_price(symbol: str) -> float:
    sym = symbol.upper()
    if sym == "IBOUSDT":
        from ibo.pricing import platform_ibo_usdt_price

        return platform_ibo_usdt_price() * random.uniform(0.999, 1.001)
    from listings.ibo_pairs import base_usdt_for_ibo_pair, is_ibo_quoted_pair
    from listings.listed_trading import listed_usdt_price, non_binance_listed_usdt_symbols
    from listings.integration import effective_symbol_base_map

    _eff_map = effective_symbol_base_map(SYMBOL_BASE_MAP)

    if is_ibo_quoted_pair(sym):
        from listings.ibo_pairs import resolve_ibo_base
        from ibo.pricing import platform_ibo_usdt_price

        base = resolve_ibo_base(sym) or ""
        base_usdt = base_usdt_for_ibo_pair(base) or IBO_PAIR_FALLBACK_USDT.get(base, 1.0)
        return round(float(base_usdt) / max(platform_ibo_usdt_price(), 1e-12), 8)
    if sym in non_binance_listed_usdt_symbols():
        base = _eff_map.get(sym) or sym.replace("USDT", "")
        px = listed_usdt_price(base)
        return px if px > 0 else 0.0001
    if sym not in SYMBOL_BASE_MAP and sym not in _eff_map:
        return FALLBACK_PRICES.get(sym, 1.0)

    # ── WS feed cache — zero REST when fresh ─────────────────────────────
    ws_price, ws_age = _binance_spot_feed.get_price(sym)
    if ws_price is not None and ws_age <= _binance_spot_feed.STALE_AFTER_SEC:
        _spot_px_cache[sym] = (ws_price, time.monotonic())
        _price_fail_counts[sym] = 0
        return ws_price

    now = time.monotonic()
    hit = _spot_px_cache.get(sym)
    if hit is not None and (now - hit[1]) < _SPOT_PX_CACHE_TTL_SEC:
        return hit[0]
    async with _spot_px_cache_lock:
        now = time.monotonic()
        hit = _spot_px_cache.get(sym)
        if hit is not None and (now - hit[1]) < _SPOT_PX_CACHE_TTL_SEC:
            return hit[0]
        try:
            px = await asyncio.to_thread(_binance_spot_last_price, sym)
        except Exception as e:
            # GAP-2: Track consecutive failures and fire a circuit-breaker alert
            # once the threshold is reached so ops knows SYSTEM fills are priced
            # off potentially stale hardcoded fallback values.
            fails = _price_fail_counts.get(sym, 0) + 1
            _price_fail_counts[sym] = fails
            logger.warning(
                "get_current_price: Binance failed for %s (consecutive=%d) — %s; using fallback",
                sym, fails, e,
            )
            if fails >= _PRICE_CB_THRESHOLD and db is not None:
                asyncio.create_task(
                    alert_service.raise_alert(
                        type="price.feed.circuit_breaker",
                        severity="critical",
                        source="get_current_price",
                        title=f"Binance price feed dead for {sym} ({fails} consecutive failures)",
                        message=(
                            f"SYSTEM fills for {sym} are using stale/hardcoded fallback prices "
                            f"after {fails} consecutive Binance API failures. "
                            "Verify Binance connectivity and consider pausing trading."
                        ),
                        meta={"symbol": sym, "consecutive_failures": fails},
                        dedupe_key=f"price.feed.circuit_breaker:{sym}",
                    )
                )
            return FALLBACK_PRICES.get(sym, 1.0)
        # Success — reset the failure counter.
        _price_fail_counts[sym] = 0
        _spot_px_cache[sym] = (px, time.monotonic())
        return px


def _cached_price_usdt(asset: str) -> float:
    """Synchronous best-effort USDT price lookup for background workers.

    Reads from the existing live-price cache (populated by trading flows and
    P&L calculators) without issuing new HTTP calls — a background worker
    should never block on an outbound request. Returns ``0.0`` on miss,
    which callers interpret as "unknown; skip the price-dependent gate".

    GAP-9: Cache entries older than _CACHED_PRICE_USDT_MAX_AGE_SEC are
    treated as stale and FALLBACK_PRICES is used instead, preventing the
    hedger / deposit-crediter from acting on prices that are many minutes old.

    Used by the Phase 5 deposit-crediter to dust-filter non-USDT deposits.
    """
    ast = (asset or "").upper()
    if ast == "USDT":
        return 1.0
    if ast == "IBO":
        from ibo.pricing import platform_ibo_usdt_price

        return platform_ibo_usdt_price()
    try:
        from listings.listed_trading import listed_usdt_price, non_binance_listed_usdt_symbols

        listed_sym = f"{ast}USDT"
        if listed_sym in non_binance_listed_usdt_symbols():
            px = listed_usdt_price(ast)
            if px > 0:
                return float(px)
    except Exception:  # noqa: BLE001
        pass
    sym = f"{ast}USDT"

    # ── WS feed cache — primary source (zero REST) ────────────────────────
    ws_price, ws_age = _binance_spot_feed.get_price(sym)
    if ws_price is not None and ws_age <= _binance_spot_feed.STALE_AFTER_SEC:
        try:
            return float(ws_price)
        except (TypeError, ValueError):
            pass

    # ── Local spot-price cache (populated by trading flows) ───────────────
    hit = _spot_px_cache.get(sym)
    if hit is not None:
        age = time.monotonic() - hit[1]
        if age <= _CACHED_PRICE_USDT_MAX_AGE_SEC:
            try:
                return float(hit[0] or 0.0)
            except (TypeError, ValueError):
                return 0.0
        logger.debug(
            "_cached_price_usdt: cache stale for %s (age=%.1fs > max=%.1fs); using fallback",
            sym, age, _CACHED_PRICE_USDT_MAX_AGE_SEC,
        )
    # Last-ditch static fallback — still better than 0 for the dust gate.
    try:
        return float(FALLBACK_PRICES.get(sym, 0.0) or 0.0)
    except (TypeError, ValueError):
        return 0.0


async def lock_funds(uid: str, asset: str, amount: float, *, ref_id: Optional[str] = None):
    """Atomically move `amount` from available → locked. Raises 400 if insufficient.

    Thin wrapper around ``wallet_service.lock`` so every lock produces a
    ``wallet_txns`` row. ``ref_id`` should be the order id (or withdrawal
    request id) so the ledger row is traceable.
    """
    try:
        await wallet_service.lock(
            uid, asset, amount,
            ref_type="order" if (ref_id or "").startswith("ord_") else "wallet",
            ref_id=ref_id,
        )
    except InsufficientFundsError as exc:
        raise HTTPException(
            400,
            f"Insufficient {asset} (need {amount:.6g}, have {exc.have:.6g})",
        )


async def return_locked(uid: str, asset: str, amount: float, *, ref_id: Optional[str] = None):
    """Return `amount` from locked → available (cancel or excess on fill)."""
    try:
        await wallet_service.unlock(
            uid, asset, amount,
            ref_type="order" if (ref_id or "").startswith("ord_") else "wallet",
            ref_id=ref_id,
        )
    except InsufficientFundsError as exc:
        # GAP-8: Never let a cancel/refund 500 — preserve legacy semantics.
        # But raise an alert so ops can investigate the locked-balance mismatch.
        logger.warning(
            "return_locked: not enough locked %s for uid=%s (have=%.8f need=%.8f ref=%s)",
            asset, uid, exc.have, exc.need, ref_id,
        )
        if db is not None:
            asyncio.create_task(
                alert_service.raise_alert(
                    type="wallet.return_locked.failed",
                    severity="high",
                    source="return_locked",
                    title=f"return_locked failed: uid={uid} asset={asset} ref={ref_id}",
                    message=(
                        f"Could not unlock {amount:.8f} {asset} for user {uid} "
                        f"(ref={ref_id}): only {exc.have:.8f} was locked. "
                        "User's locked balance may be inconsistent — review wallet_txns ledger."
                    ),
                    meta={"uid": uid, "asset": asset, "amount": amount, "have": exc.have, "ref_id": ref_id},
                    dedupe_key=f"wallet.return_locked.failed:{uid}:{asset}",
                )
            )


async def settle_buy_fill(
    uid: str, base_asset: str, fill_price: float,
    fill_amount: float, lock_price: float, fee_rate: float,
    *, quote_asset: str = "USDT",
    ibo_price_usdt: float,
    order_id: Optional[str] = None, trade_id: Optional[str] = None,
):
    """Settle a BUY fill for `uid`. Returns (fee_amount, fee_asset).

    Delegates to :func:`wallet_service.settle_buy_fill` so the ledger rows
    (unlock quote / debit quote cost / credit base / fee) are produced
    atomically.  Pass ``quote_asset="IBO"`` for IBO-quoted pairs.
    """
    return await wallet_service.settle_buy_fill(
        uid, base_asset,
        fill_price=fill_price,
        fill_amount=fill_amount,
        lock_price=lock_price,
        fee_rate=fee_rate,
        ibo_price_usdt=ibo_price_usdt,
        quote_asset=quote_asset,
        order_id=order_id,
        trade_id=trade_id,
    )


async def settle_sell_fill(
    uid: str, base_asset: str, fill_price: float, fill_amount: float, fee_rate: float,
    *, quote_asset: str = "USDT",
    ibo_price_usdt: float,
    order_id: Optional[str] = None, trade_id: Optional[str] = None,
):
    """Settle a SELL fill for `uid`. Returns (fee_amount, fee_asset).

    Pass ``quote_asset="IBO"`` for IBO-quoted pairs.
    """
    return await wallet_service.settle_sell_fill(
        uid, base_asset,
        fill_price=fill_price,
        fill_amount=fill_amount,
        fee_rate=fee_rate,
        ibo_price_usdt=ibo_price_usdt,
        quote_asset=quote_asset,
        order_id=order_id,
        trade_id=trade_id,
    )


def _resolve_liquidity_mode(controls: Dict[str, Any]) -> str:
    raw = str(controls.get("liquidity_mode") or "HEDGE_ONLY").strip().upper()
    if raw not in {"OFF", "HEDGE_ONLY", "BINANCE_BACKSTOP"}:
        return "HEDGE_ONLY"
    return raw


def _route_rollout_allowed(controls: Dict[str, Any], *, uid: str, symbol: str) -> bool:
    allow_symbols = _norm_symbol_list(controls.get("binance_rollout_symbols"))
    if allow_symbols and symbol.upper() not in allow_symbols:
        return False
    allow_users = [str(x or "").strip() for x in (controls.get("binance_rollout_users") or []) if str(x or "").strip()]
    if allow_users and uid not in allow_users:
        return False
    pct = int(controls.get("binance_rollout_percent") or 0)
    if pct <= 0:
        return False
    if pct >= 100:
        return True
    hv = int(hashlib.sha256(f"{uid}:{symbol.upper()}".encode("utf-8")).hexdigest()[:8], 16) % 100
    return hv < pct


async def _validate_binance_liquidity_policy(
    *,
    controls: Dict[str, Any],
    uid: str,
    symbol: str,
    notional_usdt: float,
    expected_price: float,
    market_price: float,
) -> Tuple[bool, str]:
    if not bool(controls.get("binance_liquidity_enabled", False)):
        return False, "binance_disabled"
    if bool(controls.get("binance_kill_switch", False)):
        return False, "binance_kill_switch"
    if str(controls.get("binance_execution_mode") or "dry_run").lower() not in {"dry_run", "live", "shadow"}:
        return False, "invalid_execution_mode"
    allowed = _norm_symbol_list(controls.get("binance_allowed_symbols"))
    if allowed and symbol.upper() not in allowed:
        return False, "symbol_not_allowed"
    max_order = float(controls.get("binance_max_notional_per_order") or 0.0)
    if max_order > 0 and notional_usdt > max_order + 1e-9:
        return False, "max_notional_per_order"
    max_day = float(controls.get("binance_max_notional_per_day") or 0.0)
    if max_day > 0 and db is not None:
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        used = await db.liquidity_routing_logs.aggregate([
            {"$match": {
                "route": "BINANCE",
                "created_at": {"$gte": start},
                "symbol": symbol.upper(),
            }},
            {"$group": {"_id": None, "v": {"$sum": {"$ifNull": ["$metadata.notional_usdt", 0]}}}},
        ]).to_list(1)
        used_v = float((used[0] or {}).get("v") or 0.0) if used else 0.0
        if used_v + notional_usdt > max_day + 1e-9:
            return False, "max_notional_per_day"
    slippage_limit_bps = float(controls.get("binance_slippage_bps_limit") or 0.0)
    if slippage_limit_bps > 0 and expected_price > 0 and market_price > 0:
        drift_bps = abs(market_price - expected_price) / expected_price * 10_000.0
        if drift_bps > slippage_limit_bps:
            return False, "slippage_guard"
    latency_th = float(controls.get("binance_latency_threshold_ms") or 0.0)
    if latency_th > 0 and db is not None:
        row = await db.binance_health_metrics.find_one({"id": "global"}, {"_id": 0, "latency_p95_ms": 1, "updated_at": 1})
        p95 = float((row or {}).get("latency_p95_ms") or 0.0)
        if p95 > 0 and p95 > latency_th:
            return False, "latency_guard"
        stale_ms = float(controls.get("binance_quote_stale_ms") or 0.0)
        if stale_ms > 0:
            updated_at = _parse_iso_ts((row or {}).get("updated_at"))
            if not updated_at:
                return False, "quote_stale_guard"
            age_ms = (datetime.now(timezone.utc) - updated_at).total_seconds() * 1000.0
            if age_ms > stale_ms:
                return False, "quote_stale_guard"
    last_look_bps = float(controls.get("binance_last_look_bps") or 0.0)
    if last_look_bps > 0 and expected_price > 0 and market_price > 0:
        drift_bps = abs(market_price - expected_price) / expected_price * 10_000.0
        if drift_bps > last_look_bps:
            return False, "last_look_reject"
    cb = await _binance_breaker_status(controls)
    if cb.get("open"):
        return False, "circuit_breaker_open"
    if not _route_rollout_allowed(controls, uid=uid, symbol=symbol):
        return False, "rollout_gate"
    return True, "ok"


def _system_exposure_guard_ok(
    *,
    controls: Dict[str, Any],
    symbol: str,
    side: str,
    treasury_pos_base: float,
    fill_amt: float,
) -> Tuple[bool, str]:
    caps = controls.get("liquidity_max_abs_exposure_base_by_symbol") or {}
    cap = None
    if isinstance(caps, dict):
        try:
            raw = caps.get(symbol.upper())
            if raw is not None:
                cap = float(raw)
        except (TypeError, ValueError):
            cap = None
    if cap is None or cap <= 0:
        return True, "uncapped"
    projected = treasury_pos_base + (fill_amt if side == "buy" else -fill_amt)
    if abs(projected) > cap + 1e-9:
        return False, "global_exposure_cap"
    return True, "ok"


async def _execute_fill(taker: dict, maker: dict, fill_price: float,
                         fill_amount: float, base_asset: str,
                         quote_asset: str = "USDT"):
    """
    Execute one fill between two real orders.

    Phase 2 atomic-correctness change: we **claim the maker order first** with
    a conditional ``find_one_and_update`` (status still cancellable AND
    ``remaining >= fill_amount``) before touching any wallet balances. If the
    claim fails (the maker user cancelled, or another fill consumed it
    concurrently) we return ``None`` and the matching engine simply skips
    this maker — no settlement happens, no funds move, and the caller does
    not record a trade against a stale maker.

    The fee is applied to the maker order via a follow-up ``$inc`` once it
    is known (we couldn't compute it before settlement).

    Returns the taker fee amount, or ``None`` if the fill was skipped.
    """
    now      = datetime.now(timezone.utc).isoformat()
    trade_id = f"trd_{uuid.uuid4().hex[:12]}"
    controls = await get_platform_controls()
    maker_fee_rate, taker_fee_rate = _fee_rates_from_controls(controls)
    ibo_price_usdt = await _resolve_ibo_usdt_price(controls)

    # ── 1. Atomically claim the maker order ──────────────────────────────────
    # If a concurrent cancel or another fill already consumed the maker, the
    # filter doesn't match and we skip without settling. ``$gte`` tolerates
    # float rounding by allowing a tiny epsilon under the requested amount.
    new_filled    = round(float(maker.get("filled") or 0.0) + fill_amount, 8)
    new_remaining = round(max(0.0, float(maker.get("remaining") or 0.0) - fill_amount), 8)
    new_status    = "filled" if new_remaining < 1e-10 else "partially_filled"
    if new_filled > 0:
        new_avg = (
            (float(maker.get("avg_price") or 0.0) * float(maker.get("filled") or 0.0))
            + fill_price * fill_amount
        ) / new_filled
    else:
        new_avg = fill_price

    claimed_maker = await db.orders.find_one_and_update(
        {
            "id": maker["id"],
            "status": {"$in": ["open", "partially_filled"]},
            "remaining": {"$gte": fill_amount - 1e-9},
        },
        {"$set": {
            "filled":     new_filled,
            "remaining":  new_remaining,
            "avg_price":  round(new_avg, 8),
            "status":     new_status,
            "updated_at": now,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed_maker:
        logger.info(
            "matching: maker %s no longer fillable for %.8f (cancelled or consumed concurrently)",
            maker["id"], fill_amount,
        )
        return None

    # ── 2. Settle wallets — we exclusively own this fill ────────────────────
    if taker["side"] == "buy":
        taker_fee, taker_fee_asset = await settle_buy_fill(
            taker["uid"], base_asset, fill_price, fill_amount,
            taker.get("lock_price", fill_price), taker_fee_rate,
            quote_asset=quote_asset,
            ibo_price_usdt=ibo_price_usdt,
            order_id=taker["id"], trade_id=trade_id,
        )
        maker_fee, maker_fee_asset = await settle_sell_fill(
            maker["uid"], base_asset, fill_price, fill_amount, maker_fee_rate,
            quote_asset=quote_asset,
            ibo_price_usdt=ibo_price_usdt,
            order_id=maker["id"], trade_id=trade_id,
        )
        taker_side, maker_side = "buy", "sell"
    else:
        taker_fee, taker_fee_asset = await settle_sell_fill(
            taker["uid"], base_asset, fill_price, fill_amount, taker_fee_rate,
            quote_asset=quote_asset,
            ibo_price_usdt=ibo_price_usdt,
            order_id=taker["id"], trade_id=trade_id,
        )
        maker_fee, maker_fee_asset = await settle_buy_fill(
            maker["uid"], base_asset, fill_price, fill_amount,
            maker.get("lock_price", fill_price), maker_fee_rate,
            quote_asset=quote_asset,
            ibo_price_usdt=ibo_price_usdt,
            order_id=maker["id"], trade_id=trade_id,
        )
        taker_side, maker_side = "sell", "buy"

    await db.trades.insert_one({
        "id": trade_id, "symbol": taker["symbol"],
        "taker_uid": taker["uid"],  "maker_uid": maker["uid"],
        "taker_order_id": taker["id"], "maker_order_id": maker["id"],
        "taker_side": taker_side, "maker_side": maker_side,
        "price": round(fill_price, 8), "amount": round(fill_amount, 8),
        "taker_fee": taker_fee, "taker_fee_asset": taker_fee_asset,
        "maker_fee": maker_fee, "maker_fee_asset": maker_fee_asset,
        "liquidity_source": "USER",
        "created_at": now,
    })

    # ── 3. Roll the maker fee into total_fee (additive — safe under races) ──
    if maker_fee:
        await db.orders.update_one(
            {"id": maker["id"]},
            {"$inc": {"total_fee": float(maker_fee)}},
        )
    return taker_fee


async def run_matching_engine(new_order: dict, market_price: float, base_asset: str):
    """
    Match `new_order` against resting orders; optional SYSTEM fill only for MARKET remainder.
    - Market: match book, then simulate any leftover at `market_price`.
    - Limit: match book only; any leftover stays open (resting) — never SYSTEM-fills limits.
    """
    sym        = new_order["symbol"]
    side       = new_order["side"]
    o_type     = new_order["type"]
    uid        = new_order["uid"]
    order_id   = new_order["id"]
    limit_px   = new_order["price"]           # 0 for market
    lock_px    = new_order.get("lock_price", market_price)
    now        = datetime.now(timezone.utc).isoformat()
    # Determine quote asset (USDT for standard pairs, IBO for IBO-quoted pairs)
    _quote_asset = SYMBOL_QUOTE_MAP.get(sym.upper(), "USDT")

    t_filled   = 0.0    # how much we've filled so far
    t_wpx      = 0.0    # weighted price sum for avg calculation
    t_fee      = 0.0    # cumulative fee
    t_remaining = new_order["amount"]

    # ── 1. Match against real orders in the book ──────────────────────────────
    if side == "buy":
        price_q = {"$lte": limit_px} if (o_type == "limit" and limit_px > 0) else {"$gt": 0}
        makers  = await db.orders.find(
            {"symbol": sym, "side": "sell",
             "status": {"$in": ["open", "partially_filled"]},
             "uid": {"$ne": uid}, "price": price_q},
            {"_id": 0},
        ).sort([("price", 1), ("created_at", 1)]).to_list(50)
    else:
        price_q = {"$gte": limit_px} if (o_type == "limit" and limit_px > 0) else {"$gt": 0}
        makers  = await db.orders.find(
            {"symbol": sym, "side": "buy",
             "status": {"$in": ["open", "partially_filled"]},
             "uid": {"$ne": uid}, "price": price_q},
            {"_id": 0},
        ).sort([("price", -1), ("created_at", 1)]).to_list(50)

    for maker in makers:
        if t_remaining < 1e-10:
            break
        fill_amt = min(t_remaining, maker["remaining"])
        fill_px  = maker["price"]

        taker_fee = await _execute_fill(new_order, maker, fill_px, fill_amt, base_asset, quote_asset=_quote_asset)
        # Phase 2: maker may have been cancelled / consumed concurrently. The
        # claim inside `_execute_fill` failed, no settlement happened — skip
        # it and try the next price level.
        if taker_fee is None:
            continue

        t_filled    += fill_amt
        t_remaining -= fill_amt
        t_wpx       += fill_px * fill_amt
        t_fee       += taker_fee

    # ── 2. Simulate remaining fill only for MARKET orders ─────────────────────
    # Limit orders always rest any unfilled size on the book (even if "marketable").
    # Otherwise aggressive limits were fully SYSTEM-filled and never appeared under open orders.
    simulate = bool(t_remaining >= 1e-10 and o_type == "market")

    if simulate:
        controls = await get_platform_controls()
        liquidity_mode = _resolve_liquidity_mode(controls)
        system_liquidity_enabled = bool(controls.get("system_liquidity_enabled", True))
        _, taker_fee_rate = _fee_rates_from_controls(controls)
        ibo_price_usdt = await _resolve_ibo_usdt_price(controls)
        reject_reason = "treasury_inventory_limit"
        execution_key = _liquidity_execution_key(order_id, sym, side, t_remaining)
        remainder_notional = float(lock_px or market_price or 0.0) * float(max(0.0, t_remaining))
        intent = await _liquidity_get_or_create_intent(
            execution_key=execution_key,
            order_id=order_id,
            uid=uid,
            symbol=sym,
            side=side,
            remainder_qty=t_remaining,
            remainder_notional=remainder_notional,
            expected_price=float(market_price or lock_px or 0.0),
        )
        if intent.get("state") in {"executed", "finalized"}:
            t_remaining = 0.0
            cap_partial = False
            await _log_liquidity_routing_decision(
                execution_key=execution_key,
                order_id=order_id,
                uid=uid,
                symbol=sym,
                side=side,
                remainder_qty=0.0,
                route="REJECT",
                reason="duplicate_execution_guard",
                metadata={"liquidity_mode": liquidity_mode},
            )
            simulate = False
        else:
            await _liquidity_transition_state(
                execution_key,
                intent.get("state") or "pending",
                "executing",
                reason="matching_remainder_start",
            )

        if simulate and liquidity_mode == "OFF":
            refunded_qty = round(max(0.0, t_remaining), 8)
            if side == "buy":
                refund_usdt = round(lock_px * refunded_qty, 8)
                if refund_usdt > 0:
                    await return_locked(uid, _quote_asset, refund_usdt, ref_id=order_id)
            else:
                if refunded_qty > 0:
                    await return_locked(uid, base_asset, refunded_qty, ref_id=order_id)
            cap_partial = True
            t_remaining = 0.0
            reject_reason = "liquidity_mode_off"
            await _log_liquidity_routing_decision(
                execution_key=execution_key,
                order_id=order_id,
                uid=uid,
                symbol=sym,
                side=side,
                remainder_qty=refunded_qty,
                route="REJECT",
                reason=reject_reason,
                metadata={"liquidity_mode": liquidity_mode},
            )
            await _liquidity_transition_state(
                execution_key,
                "executing",
                "failed",
                reason=reject_reason,
                patch={"last_error": reject_reason},
            )
        elif simulate and not system_liquidity_enabled:
            # Explicitly disable treasury/SYSTEM fallback: refund all remaining
            # locked funds for the market remainder after real book matches.
            refunded_qty = round(max(0.0, t_remaining), 8)
            if side == "buy":
                refund_usdt = round(lock_px * refunded_qty, 8)
                if refund_usdt > 0:
                    await return_locked(uid, _quote_asset, refund_usdt, ref_id=order_id)
            else:
                if refunded_qty > 0:
                    await return_locked(uid, base_asset, refunded_qty, ref_id=order_id)
            cap_partial = True
            t_remaining = 0.0
            reject_reason = "system_liquidity_disabled"
            logger.warning(
                "matching: SYSTEM liquidity disabled for sym=%s side=%s — refunded %.8f",
                sym, side, refunded_qty,
            )
            await _log_liquidity_routing_decision(
                execution_key=execution_key,
                order_id=order_id,
                uid=uid,
                symbol=sym,
                side=side,
                remainder_qty=refunded_qty,
                route="REJECT",
                reason=reject_reason,
                metadata={"liquidity_mode": liquidity_mode},
            )
            await _liquidity_transition_state(
                execution_key,
                "executing",
                "failed",
                reason=reject_reason,
                patch={"last_error": reject_reason},
            )
        elif simulate:

            # GAP-3: Warn early when about to SYSTEM-fill an unhedgeable asset
            # (e.g. IBO has no external market). The fill still proceeds — the
            # platform accepts the exposure intentionally — but the warning
            # surfaces in logs so ops can configure an inventory limit for it.
            if base_asset in hedger_service.UNHEDGEABLE_BASES:
                logger.warning(
                    "matching: SYSTEM fill for unhedgeable asset '%s' (sym=%s side=%s qty=%.8f) — "
                    "exposure CANNOT be hedged on Binance; set a treasury inventory limit.",
                    base_asset, sym, side, t_remaining,
                )

            # Phase 8b — apply spread to the user-side fill price. Mark stays the
            # reference for treasury bookkeeping; the user transacts at the
            # skewed price (worse for the taker by ``spread_bps`` basis points).
            spread_bps = resolve_system_spread_bps(controls, sym)
            user_fill_px = apply_spread(side, market_price, spread_bps)

            # Phase 8c — clamp the SYSTEM fill to whatever the per-symbol
            # treasury inventory cap can still absorb. ``inventory_limit_base``
            # of ``None`` (no override) preserves legacy unbounded behaviour.
            inv_limit = resolve_treasury_inventory_limit_base(controls, sym)
            treasury_pos_base = await treasury_service.get_position(base_asset)
            sys_cap_qty = treasury_service.system_capacity(
                side=side,
                requested_qty=t_remaining,
                treasury_position_base=treasury_pos_base,
                inventory_limit_base=inv_limit,
            )
            # Round to the wallet precision (8 dp) so float drift can't leave
            # us with a 1e-12 sliver that fails the MIN_BASE_AMOUNT check.
            sys_cap_qty = round(max(0.0, sys_cap_qty), 8)

            leftover_qty = round(max(0.0, t_remaining - sys_cap_qty), 8)
            fill_amt = sys_cap_qty
            fill_px  = user_fill_px

            if fill_amt >= 1e-10:
                ok_exposure, exposure_reason = _system_exposure_guard_ok(
                    controls=controls,
                    symbol=sym,
                    side=side,
                    treasury_pos_base=treasury_pos_base,
                    fill_amt=fill_amt,
                )
                if not ok_exposure:
                    leftover_qty = round(max(0.0, t_remaining), 8)
                    fill_amt = 0.0
                    reject_reason = exposure_reason
                # HEDGE_ONLY stays on SYSTEM path; BINANCE_BACKSTOP policy gate
                # determines whether we should queue Binance fallback later.
                if fill_amt < 1e-10 and liquidity_mode == "BINANCE_BACKSTOP":
                    notional = float(max(0.0, leftover_qty * market_price))
                    ok_bin, why = await _validate_binance_liquidity_policy(
                        controls=controls,
                        uid=uid,
                        symbol=sym,
                        notional_usdt=notional,
                        expected_price=float(user_fill_px),
                        market_price=float(market_price),
                    )
                    if ok_bin:
                        await _log_liquidity_routing_decision(
                            execution_key=execution_key,
                            order_id=order_id,
                            uid=uid,
                            symbol=sym,
                            side=side,
                            remainder_qty=leftover_qty,
                            route="RETRY_QUEUE",
                            reason="binance_backstop_placeholder",
                            metadata={
                                "liquidity_mode": liquidity_mode,
                                "notional_usdt": notional,
                                "policy": why,
                                "execution_mode": controls.get("binance_execution_mode", "dry_run"),
                            },
                        )
                        await db.liquidity_retry_queue.insert_one({
                            "id": f"lrq_{uuid.uuid4().hex[:14]}",
                            "execution_key": execution_key,
                            "order_id": order_id,
                            "uid": uid,
                            "symbol": sym,
                            "side": side,
                            "status": "pending",
                            "attempt": 0,
                            "max_attempts": 5,
                            "qty": round(leftover_qty, 8),
                            "created_at": now,
                            "updated_at": now,
                            "next_retry_at": now,
                            "reason": "binance_backstop_placeholder",
                        })
                    else:
                        reject_reason = why
                        await _log_liquidity_routing_decision(
                            execution_key=execution_key,
                            order_id=order_id,
                            uid=uid,
                            symbol=sym,
                            side=side,
                            remainder_qty=leftover_qty,
                            route="REJECT",
                            reason=why,
                            metadata={"liquidity_mode": liquidity_mode, "notional_usdt": notional},
                        )
                    cap_partial = True
                    t_remaining = 0.0

            if fill_amt >= 1e-10:
                trade_id = f"trd_{uuid.uuid4().hex[:12]}"
                _q_asset = SYMBOL_QUOTE_MAP.get(sym.upper(), "USDT")
                if side == "buy":
                    sim_fee, sim_fee_asset = await settle_buy_fill(
                        uid, base_asset, fill_px, fill_amt, lock_px, taker_fee_rate,
                        quote_asset=_q_asset,
                        ibo_price_usdt=ibo_price_usdt,
                        order_id=order_id, trade_id=trade_id,
                    )
                else:
                    sim_fee, sim_fee_asset = await settle_sell_fill(
                        uid, base_asset, fill_px, fill_amt, taker_fee_rate,
                        quote_asset=_q_asset,
                        ibo_price_usdt=ibo_price_usdt,
                        order_id=order_id, trade_id=trade_id,
                    )

            await db.trades.insert_one({
                "id": trade_id, "symbol": sym,
                "taker_uid": uid,    "maker_uid": "SYSTEM",
                "taker_order_id": order_id, "maker_order_id": "SYSTEM",
                "taker_side": side,  "maker_side": "buy" if side == "sell" else "sell",
                "price": round(fill_px, 8), "amount": round(fill_amt, 8),
                "taker_fee": sim_fee,    "taker_fee_asset": sim_fee_asset,
                "maker_fee": 0.0,        "maker_fee_asset": "IBO",
                # Phase 8 — record the spread + mark we transacted at so the
                # admin treasury page can replay revenue without re-deriving.
                "mark_price":   round(market_price, 8),
                "spread_bps":   round(float(spread_bps), 4),
                "system_fill":  True,
                "liquidity_source": "SYSTEM",
                "execution_key": execution_key,
                "created_at":   now,
            })

            # Phase 8a — mirror the SYSTEM fill onto the treasury ledger so
            # the platform's exposure (signed base position + USDT cash)
            # stays in sync with what the user just received. Failure here
            # must NOT roll back the user's settled fill — wallet_txns is
            # append-only, the worst case is a missing treasury row that
            # ops can backfill from the trades collection.
            try:
                await treasury_service.record_system_fill(
                    side=side,
                    base_asset=base_asset,
                    fill_amount=fill_amt,
                    fill_price_user=fill_px,
                    mark_price=market_price,
                    spread_bps=float(spread_bps),
                    trade_id=trade_id,
                    order_id=order_id,
                    user_uid=uid,
                )
            except Exception:  # noqa: BLE001
                # GAP-1: Don't silently swallow — write a repair-queue document
                # so ops (or an automated job) can backfill the missing treasury
                # row from the trades collection, and fire a critical alert.
                logger.exception(
                    "treasury mirror failed for trade=%s sym=%s side=%s amt=%.8f",
                    trade_id, sym, side, fill_amt,
                )
                if db is not None:
                    try:
                        await db.treasury_mirror_failures.insert_one({
                            "id": f"tmf_{uuid.uuid4().hex[:14]}",
                            "trade_id": trade_id,
                            "symbol": sym,
                            "side": side,
                            "base_asset": base_asset,
                            "fill_amount": round(fill_amt, 8),
                            "fill_price": round(fill_px, 8),
                            "mark_price": round(market_price, 8),
                            "spread_bps": round(float(spread_bps), 4),
                            "order_id": order_id,
                            "user_uid": uid,
                            "resolved": False,
                            "created_at": now,
                        })
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "treasury mirror failure: could not write repair-queue doc for trade=%s",
                            trade_id,
                        )
                    asyncio.create_task(
                        alert_service.raise_alert(
                            type="treasury.mirror.failed",
                            severity="critical",
                            source="matching_engine",
                            title=f"Treasury mirror failed — {sym} trade {trade_id}",
                            message=(
                                f"SYSTEM fill {trade_id} ({side} {fill_amt:.8f} {base_asset} "
                                f"@ {fill_px:.8f}) settled for user {uid} but treasury ledger "
                                "was NOT updated. Platform exposure is inaccurate. "
                                "Backfill from treasury_mirror_failures collection."
                            ),
                            meta={
                                "trade_id": trade_id, "symbol": sym, "side": side,
                                "fill_amount": fill_amt, "order_id": order_id, "user_uid": uid,
                            },
                            dedupe_key=f"treasury.mirror.failed:{sym}",
                        )
                    )

            t_filled    += fill_amt
            t_wpx       += fill_px * fill_amt
            t_fee       += sim_fee
            t_remaining -= fill_amt
            await _log_liquidity_routing_decision(
                execution_key=execution_key,
                order_id=order_id,
                uid=uid,
                symbol=sym,
                side=side,
                remainder_qty=fill_amt,
                route="SYSTEM",
                reason="system_fill",
                metadata={
                    "liquidity_mode": liquidity_mode,
                    "notional_usdt": round(fill_amt * fill_px, 8),
                    "trade_id": trade_id,
                },
            )

            # Phase 8c — refund the user's locked funds for whatever the
            # treasury could not absorb. Once we've refunded we MUST leave
            # ``t_remaining = 0``: the cancel-order path would otherwise see
            # ``status=partially_filled, remaining > 0`` and try to release
            # funds we've already released (double-refund).
            cap_partial = False
            if leftover_qty >= 1e-10:
                if side == "buy":
                    refund_usdt = round(lock_px * leftover_qty, 8)
                    if refund_usdt > 0:
                        await return_locked(uid, _quote_asset, refund_usdt, ref_id=order_id)
                else:
                    await return_locked(uid, base_asset, leftover_qty, ref_id=order_id)
                cap_partial = True
                t_remaining = 0.0
                logger.warning(
                    "matching: SYSTEM fill capped for sym=%s side=%s — filled %.8f, "
                    "refunded %.8f (treasury_pos=%.8f, limit=%s)",
                    sym, side, fill_amt, leftover_qty, treasury_pos_base,
                    inv_limit if inv_limit is not None else "uncapped",
                )
            else:
                t_remaining = 0.0

            if fill_amt >= 1e-10:
                if await _liquidity_transition_state(
                    execution_key,
                    "executing",
                    "executed",
                    reason="system_fill_settled",
                    patch={
                        "execution_price": round(fill_px, 8),
                        "slippage_bps": round(abs(fill_px - market_price) / max(market_price, 1e-12) * 10_000.0, 4),
                        "user_fill_id": trade_id,
                    },
                ):
                    await _liquidity_transition_state(
                        execution_key,
                        "executed",
                        "finalized",
                        reason="system_fill_finalized",
                    )
            else:
                await _liquidity_transition_state(
                    execution_key,
                    "executing",
                    "failed",
                    reason=reject_reason,
                    patch={"last_error": reject_reason},
                )
    else:
        cap_partial = False

    # ── 3. Persist final state of the new order ───────────────────────────────
    if t_filled > 0:
        avg_px   = t_wpx / t_filled
        # Funds are fully released either way (partial book + cap refund).
        # ``filled`` < ``amount`` is still visible to the user; the optional
        # ``cap_partial`` flag lets the frontend surface "couldn't complete
        # the requested size — treasury inventory limit reached".
        status   = "filled" if t_remaining < 1e-10 else "partially_filled"
        update_doc: Dict[str, Any] = {
            "filled":    round(t_filled, 8),
            "remaining": round(max(0.0, t_remaining), 8),
            "avg_price": round(avg_px, 8),
            "total_fee": round(t_fee, 8),
            "status":    status,
            "updated_at": now,
        }
        if cap_partial:
            update_doc["cap_partial"] = True
        await db.orders.update_one({"id": order_id}, {"$set": update_doc})
        logger.info(f"Order {order_id} → {status} (filled {t_filled:.4f} @ avg {avg_px:.6f})")
    elif simulate and cap_partial:
        # Market order, treasury fully exhausted, no book matches either —
        # everything was refunded. Mark the order as rejected so it doesn't
        # linger as "open" with no liquidity behind it.
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "status":      "rejected",
                "remaining":   0.0,
                "cap_partial": True,
                "reject_reason": reject_reason,
                "updated_at":  now,
            }},
        )
        logger.warning(
            "Order %s rejected — no SYSTEM fill path available (reason=%s, sym=%s side=%s)",
            order_id, reject_reason, sym, side,
        )


# ── Admin Routes (no UI — use Postman / curl with X-Admin-Key header) ─────────

# Phase 4 — manual deposit/withdrawal approval endpoints have been REMOVED.
# Deposits are detected on-chain and will be credited automatically by the
# deposit pipeline (Phase 3 → Phase 5). Withdrawals will be signed + sent
# on-chain via ``BlockchainProvider.send_transaction`` in Phase 5.
#
# The ``deposit_requests`` and ``withdrawal_requests`` collections are
# retained intact for historical audit — nothing in the platform writes
# new rows into them anymore, and no API exposes them.


# ── Order Routes ──────────────────────────────────────────────────────────────

@api_router.post("/orders", response_model=OrderOut, status_code=201)
async def place_order(body: OrderCreate, current_user: dict = Depends(get_current_user)):
    """
    Place a new spot order. Locks funds and runs the matching engine.
    Market orders fill immediately when liquidity is simulated. Resting limits stay in open orders.
    """
    enforce_user_trading_allowed(current_user)
    await enforce_feature("trading_enabled", "Trading is currently paused by admin")
    return await _execute_place_order(current_user["uid"], body)


@api_router.post("/portfolio/close_position", response_model=OrderOut, status_code=201)
async def close_position(body: ClosePositionBody, current_user: dict = Depends(get_current_user)):
    """
    Sell **available** base for this pair (market or limit). Locked coins are excluded.
    Use ``amount`` or ``fraction`` for partial close; omit both for 100% of available.
    """
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_trading_allowed(current_user)
    await enforce_feature("trading_enabled", "Trading is currently paused by admin")
    return await _close_position_for_uid(current_user["uid"], body)


@api_router.post("/admin/users/{uid}/close-position", response_model=OrderOut, status_code=201)
async def admin_close_position_for_user(
    uid: str,
    body: ClosePositionBody,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "manage_users")
    _require_admin_jwt_not_apikey(auth)
    user = await db.users.find_one({"uid": uid}, {"_id": 0, "uid": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await enforce_feature("trading_enabled", "Trading is currently paused by admin")
    out = await _close_position_for_uid(uid, body)
    await log_admin_audit(
        auth, "admin_close_position_for_user", "user", uid,
        {"symbol": body.symbol, "order_type": body.order_type, "amount": body.amount, "fraction": body.fraction},
    )
    return out


@api_router.get("/admin/liquidity/retry-queue")
async def admin_liquidity_retry_queue(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
    status: Optional[str] = Query(None, description="pending|processing|retry_scheduled|resolved|dead_letter"),
    limit: int = Query(200, ge=1, le=1000),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_hedger")
    filt: Dict[str, Any] = {}
    if status:
        filt["status"] = str(status).strip()
    items = await db.liquidity_retry_queue.find(filt, {"_id": 0}).sort("updated_at", -1).limit(limit).to_list(limit)
    return {"items": items, "count": len(items)}


@api_router.post("/admin/liquidity/retry-queue/{queue_id}/retry")
async def admin_liquidity_retry_now(
    queue_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "execute_hedger")
    now = datetime.now(timezone.utc).isoformat()
    row = await db.liquidity_retry_queue.find_one_and_update(
        {"id": queue_id},
        {"$set": {"status": "pending", "next_retry_at": now, "updated_at": now}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Retry queue item not found")
    await log_admin_audit(auth, "liquidity_retry_now", "liquidity_retry_queue", queue_id, {"status": row.get("status")})
    return {"ok": True, "item": row}


@api_router.get("/admin/liquidity/dead-letters")
async def admin_liquidity_dead_letters(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
    limit: int = Query(200, ge=1, le=1000),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_hedger")
    items = await db.liquidity_retry_dlq.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": items, "count": len(items)}


@api_router.get("/admin/liquidity/execution/{execution_key}")
async def admin_liquidity_execution_detail(
    execution_key: str,
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_hedger")
    ek = str(execution_key or "").strip()
    if not ek:
        raise HTTPException(status_code=400, detail="execution_key is required")
    intent = await db.liquidity_execution_intents.find_one({"execution_key": ek}, {"_id": 0})
    if not intent:
        raise HTTPException(status_code=404, detail="Execution intent not found")
    transitions = await db.liquidity_state_transitions.find(
        {"execution_key": ek},
        {"_id": 0},
    ).sort("created_at", 1).to_list(1000)
    queue_items = await db.liquidity_retry_queue.find(
        {"execution_key": ek},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(200)
    dead_items = await db.liquidity_retry_dlq.find(
        {"execution_key": ek},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    routes = await db.liquidity_routing_logs.find(
        {"execution_key": ek},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return {
        "intent": intent,
        "transitions": transitions,
        "queue_items": queue_items,
        "dead_letters": dead_items,
        "routing_logs": routes,
    }


@api_router.get("/admin/liquidity/health")
async def admin_liquidity_health(
    _auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(_auth, "view_hedger")
    controls = await get_platform_controls()
    metrics = await db.binance_health_metrics.find_one({"id": "global"}, {"_id": 0}) or {}
    cb = await _binance_breaker_status(controls)
    return {
        "metrics": metrics,
        "circuit_breaker": cb,
        "thresholds": {
            "latency_ms": float(controls.get("binance_latency_threshold_ms") or 0.0),
            "quote_stale_ms": float(controls.get("binance_quote_stale_ms") or 0.0),
            "last_look_bps": float(controls.get("binance_last_look_bps") or 0.0),
            "cb_failure_threshold": int(controls.get("binance_cb_failure_threshold") or 5),
            "cb_cooldown_sec": float(controls.get("binance_cb_cooldown_sec") or 60.0),
        },
    }


@api_router.post("/admin/liquidity/dead-letters/{dead_id}/retry")
async def admin_liquidity_dead_letter_retry(
    dead_id: str,
    auth: AdminAuthContext = Depends(resolve_admin_auth),
):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    _require_admin_permission(auth, "execute_hedger")
    row = await db.liquidity_retry_dlq.find_one({"id": dead_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Dead-letter item not found")
    now = datetime.now(timezone.utc).isoformat()
    execution_key = str(row.get("execution_key") or "")
    queue_id = f"lrq_{uuid.uuid4().hex[:14]}"
    await db.liquidity_retry_queue.insert_one({
        "id": queue_id,
        "execution_key": execution_key,
        "order_id": row.get("payload", {}).get("order_id"),
        "uid": row.get("payload", {}).get("uid"),
        "symbol": row.get("payload", {}).get("symbol"),
        "side": row.get("payload", {}).get("side"),
        "status": "pending",
        "attempt": 0,
        "max_attempts": int(row.get("payload", {}).get("max_attempts") or 5),
        "qty": float(row.get("payload", {}).get("qty") or 0.0),
        "created_at": now,
        "updated_at": now,
        "next_retry_at": now,
        "reason": "admin_retry_from_dead_letter",
    })
    await log_admin_audit(auth, "liquidity_dead_letter_retry", "liquidity_retry_dlq", dead_id, {"execution_key": execution_key, "queue_id": queue_id})
    return {"ok": True, "queue_id": queue_id, "execution_key": execution_key}


@api_router.get("/orders", response_model=List[OrderOut])
async def get_open_orders(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's currently open (and partially filled) orders."""
    if db is None:
        return []
    return await _open_orders_for_uid(current_user["uid"])


@api_router.get("/orders/history", response_model=List[OrderOut])
async def get_order_history(current_user: dict = Depends(get_current_user)):
    """Return FULLY filled and cancelled orders (not partially-filled that are still active)."""
    if db is None:
        return []
    return await _order_history_for_uid(current_user["uid"])


def _user_fill_realized_pnl_map(uid: str, trades_asc: List[dict]) -> Dict[str, Optional[float]]:
    """
    Replay fills in time order with average-cost inventory per symbol.
    For each sell leg belonging to ``uid``, realized P&L (USDT) = net proceeds − avg_cost × amount.
    Buy legs return None for that trade id (caller still keys by id).
    """
    states: Dict[str, Dict[str, float]] = {}
    out: Dict[str, Optional[float]] = {}

    def st(sym: str) -> Dict[str, float]:
        if sym not in states:
            states[sym] = {"qty": 0.0, "cost": 0.0}
        return states[sym]

    for t in trades_asc:
        tid = t["id"]
        sym = t["symbol"]
        s = st(sym)

        if t.get("taker_uid") == uid:
            side = t["taker_side"]
            fee = float(t.get("taker_fee") or 0.0)
            fa = t.get("taker_fee_asset") or "USDT"
        elif t.get("maker_uid") == uid:
            side = t["maker_side"]
            fee = float(t.get("maker_fee") or 0.0)
            fa = t.get("maker_fee_asset") or "USDT"
        else:
            continue

        fee_usdt = fee if fa == "USDT" else 0.0
        px = float(t["price"])
        amt = float(t["amount"])

        if side == "buy":
            s["cost"] += px * amt + fee_usdt
            s["qty"] += amt
            out[tid] = None
        else:
            qty, cost = s["qty"], s["cost"]
            avg = (cost / qty) if qty > 1e-14 else 0.0
            proceeds = px * amt - fee_usdt
            cogs = avg * amt
            realized = proceeds - cogs
            new_qty = qty - amt
            new_cost = cost - cogs
            if new_qty < 1e-12:
                new_qty, new_cost = 0.0, 0.0
            s["qty"], s["cost"] = new_qty, new_cost
            out[tid] = round(realized, 4)

    return out


@api_router.get("/orders/trades", response_model=List[UserTradeOut])
async def get_user_trades(current_user: dict = Depends(get_current_user)):
    """Return trades (fills) for the user, newest first, with realized P&L on sells (average-cost basis)."""
    if db is None:
        return []
    return await _user_trades_for_uid(current_user["uid"])


@api_router.delete("/orders/{order_id}")
async def cancel_order(order_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel an open order and return locked funds to available balance.

    Atomic: the status flip and the funds release happen in the correct order
    so the matching engine cannot fill the order concurrently and cause a
    double-unlock. The claim is a single ``find_one_and_update`` with a
    status filter — if a fill has already finalised the order, the update
    doesn't match and we return 409 instead of releasing funds we don't own.
    """
    if db is None:
        raise HTTPException(503, "Database unavailable")
    enforce_user_trading_allowed(current_user)
    out = await _cancel_order_core(order_id, current_user["uid"])
    logger.info("Order %s cancelled by %s", order_id, current_user["uid"])
    return out


_TRADE_PROJ_POSITION_REPLAY = {
    "_id": 0,
    "symbol": 1,
    "taker_uid": 1,
    "maker_uid": 1,
    "taker_side": 1,
    "maker_side": 1,
    "taker_fee": 1,
    "maker_fee": 1,
    "taker_fee_asset": 1,
    "maker_fee_asset": 1,
    "price": 1,
    "amount": 1,
    "created_at": 1,
}


async def build_user_positions(uid: str) -> List[dict]:
    """
    Open positions with cost-basis for live P&L (wallet holdings + average-cost inventory from fills).

    Replays trades in time order and maintains running (qty, cost_usdt) per base asset — the same
    average-cost model as realized P&L on sells. The previous implementation used
    ``sum(buy_cost)/sum(buy_qty) * wallet_qty``, which is wrong after partial sells and later buys.
    """
    trades = await db.trades.find(
        {"$or": [{"taker_uid": uid}, {"maker_uid": uid}]},
        _TRADE_PROJ_POSITION_REPLAY,
    ).sort("created_at", 1).to_list(10000)

    states: Dict[str, Dict[str, float]] = {}
    activity: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "buy_qty": 0.0,
            "sell_qty": 0.0,
            "last_side": None,
            "last_at": None,
            "last_amount": None,
            "last_price": None,
        }
    )

    def _inv(base: str) -> Dict[str, float]:
        if base not in states:
            states[base] = {"qty": 0.0, "cost": 0.0}
        return states[base]

    for t in trades:
        sym = str(t.get("symbol") or "")
        if not sym.endswith("USDT") or sym == "USDT":
            continue
        base = sym.replace("USDT", "")
        if not base:
            continue

        is_taker = t.get("taker_uid") == uid
        side = t["taker_side"] if is_taker else t["maker_side"]
        fee = float(t["taker_fee"] if is_taker else (t.get("maker_fee") or 0.0))
        fee_asset = (t["taker_fee_asset"] if is_taker else t.get("maker_fee_asset", "USDT")) or "USDT"
        px = float(t["price"])
        amt = float(t["amount"])
        fee_usdt = fee if str(fee_asset).upper() == "USDT" else 0.0

        s = _inv(base)
        if side == "buy":
            s["cost"] += px * amt + fee_usdt
            s["qty"] += amt
        else:
            q, c = s["qty"], s["cost"]
            sell_amt = min(amt, q) if q > 1e-14 else 0.0
            avg = (c / q) if q > 1e-14 else 0.0
            cogs = avg * sell_amt
            s["qty"] = q - sell_amt
            s["cost"] = c - cogs
            if s["qty"] < 1e-12:
                s["qty"], s["cost"] = 0.0, 0.0

        act = activity[base]
        if side == "buy":
            act["buy_qty"] += amt
        else:
            act["sell_qty"] += amt
        act["last_side"] = side
        act["last_at"] = t.get("created_at")
        act["last_amount"] = amt
        act["last_price"] = px

    wallets = await db.wallets.find({"uid": uid}, {"_id": 0}).to_list(None)
    bal_map = {w["asset"]: float(w.get("available", 0.0)) + float(w.get("locked", 0.0)) for w in wallets}
    avail_map = {w["asset"]: float(w.get("available", 0.0)) for w in wallets}
    lock_map  = {w["asset"]: float(w.get("locked", 0.0)) for w in wallets}

    staged: List[Dict[str, Any]] = []
    for w in wallets:
        base = w["asset"]
        if base == "USDT":
            continue
        current_qty = bal_map.get(base, 0.0)
        if current_qty < 1e-8:
            continue

        sym = f"{base}USDT"
        if sym not in SYMBOL_BASE_MAP:
            continue

        led = states.get(base, {"qty": 0.0, "cost": 0.0})
        lq, lc = float(led["qty"]), float(led["cost"])

        # Split current holdings into a "bought" slice (with cost basis from
        # trades) and a "deposit" slice (no cost basis). Reporting P&L on
        # deposit-origin coins as if they were bought at $0 makes a pure
        # deposit look like a 100% profit, which is misleading.
        if lq > 1e-12:
            bought_qty   = min(lq, current_qty)
            deposit_qty  = max(0.0, current_qty - bought_qty)
            total_invested = lc * (bought_qty / lq)  # scale by what we still hold
        else:
            bought_qty   = 0.0
            deposit_qty  = current_qty
            total_invested = 0.0

        # avg_cost is meaningful only over the bought slice. Frontend should
        # render "—" when there is no cost basis.
        avg_cost = (total_invested / bought_qty) if bought_qty > 1e-12 else 0.0

        # Source flag for the UI:
        #   "bought"          → all holdings have cost basis (P&L is meaningful)
        #   "deposit"         → no buy fills behind these holdings (P&L hidden)
        #   "mixed"           → both — P&L applies only to the bought slice
        if bought_qty < 1e-12:
            source = "deposit"
        elif deposit_qty < 1e-12:
            source = "bought"
        else:
            source = "mixed"

        act = activity.get(base) or {}
        lf_amt = act.get("last_amount")
        lf_px = act.get("last_price")
        staged.append({
            "base": base,
            "sym": sym,
            "current_qty": current_qty,
            "bought_qty": bought_qty,
            "deposit_qty": deposit_qty,
            "total_invested": total_invested,
            "avg_cost": avg_cost,
            "source": source,
            "act": act,
            "lf_amt": lf_amt,
            "lf_px": lf_px,
            "avail": avail_map.get(base, 0.0),
            "lock": lock_map.get(base, 0.0),
        })

    syms = list({s["sym"] for s in staged})
    if syms:
        px_vals = await asyncio.gather(*[get_current_price(s) for s in syms])
        px_map = dict(zip(syms, px_vals))
    else:
        px_map = {}

    positions = []
    for st in staged:
        base = st["base"]
        sym = st["sym"]
        current_qty = st["current_qty"]
        bought_qty = st["bought_qty"]
        deposit_qty = st["deposit_qty"]
        total_invested = st["total_invested"]
        avg_cost = st["avg_cost"]
        source = st["source"]
        act = st["act"]
        lf_amt = st["lf_amt"]
        lf_px = st["lf_px"]
        px = float(px_map.get(sym, 0.0))
        mval = px * current_qty                      # full holding value at mark
        bought_value = px * bought_qty               # only the bought slice for P&L
        # P&L is computed against the bought slice only. For pure-deposit
        # holdings there is no cost basis, so unrealized_pnl = 0 and the
        # frontend should render "—" instead of a fake number.
        upnl = bought_value - total_invested if bought_qty > 1e-12 else 0.0
        upnlp = (upnl / total_invested * 100.0) if total_invested > 1e-10 else 0.0
        positions.append({
            "asset":              base,
            "symbol":             sym,
            "position_side":      "long",
            "amount":             round(current_qty, 8),
            "available":          round(float(st["avail"]), 8),
            "locked":             round(float(st["lock"]), 8),
            "avg_cost":           round(avg_cost, 8),
            "total_invested":     round(total_invested, 4),
            "current_price":      round(px, 8),
            "market_value_usdt":  round(mval, 4),
            "unrealized_pnl":     round(upnl, 4),
            "unrealized_pnl_pct": round(upnlp, 4),
            # Phase: provenance breakdown so the UI can correctly render
            # cost-basis columns and disable misleading P&L on deposits.
            "source":             source,           # "bought" | "deposit" | "mixed"
            "bought_amount":      round(bought_qty, 8),
            "deposit_amount":     round(deposit_qty, 8),
            "has_cost_basis":     bought_qty > 1e-12,
            "last_fill_side":     act.get("last_side"),
            "last_fill_at":       act.get("last_at"),
            "last_fill_amount":   round(float(lf_amt), 8) if lf_amt is not None else None,
            "last_fill_price":    round(float(lf_px), 8) if lf_px is not None else None,
            "lifetime_buy_qty":   round(float(act.get("buy_qty", 0.0)), 8),
            "lifetime_sell_qty":  round(float(act.get("sell_qty", 0.0)), 8),
        })

    positions.sort(key=lambda p: abs(float(p.get("market_value_usdt", 0.0))), reverse=True)
    return positions


async def _admin_trading_analytics_for_user(uid: str) -> Dict[str, Any]:
    trades_asc = await db.trades.find(
        {"$or": [{"taker_uid": uid}, {"maker_uid": uid}]}, {"_id": 0}
    ).sort("created_at", 1).to_list(10000)

    pnl_map = _user_fill_realized_pnl_map(uid, trades_asc)
    realized_list = [v for v in pnl_map.values() if v is not None]
    realized_total = round(sum(realized_list), 4)
    sell_fills = len(realized_list)
    winning_sells = sum(1 for v in realized_list if v > 1e-8)
    losing_sells = sum(1 for v in realized_list if v < -1e-8)
    flat_sells = sell_fills - winning_sells - losing_sells

    per_sym: Dict[str, float] = defaultdict(float)
    for t in trades_asc:
        rp = pnl_map.get(t["id"])
        if rp is not None:
            per_sym[t["symbol"]] += rp
    realized_by_symbol = [
        {"symbol": s, "realized_pnl": round(v, 4)}
        for s, v in sorted(per_sym.items(), key=lambda kv: abs(kv[1]), reverse=True)
    ]

    fees_by_asset: Dict[str, float] = defaultdict(float)
    volume_quote = 0.0
    for t in trades_asc:
        is_taker = t.get("taker_uid") == uid
        if is_taker:
            fee = float(t.get("taker_fee") or 0.0)
            fa = t.get("taker_fee_asset") or "USDT"
        elif t.get("maker_uid") == uid:
            fee = float(t.get("maker_fee") or 0.0)
            fa = t.get("maker_fee_asset") or "USDT"
        else:
            continue
        if fee > 0 and fa:
            fees_by_asset[fa] += fee
        volume_quote += float(t["price"]) * float(t["amount"])

    fees_out = [
        {"asset": a, "total": round(v, 8)}
        for a, v in sorted(fees_by_asset.items(), key=lambda kv: -kv[1])
    ]

    positions = await build_user_positions(uid)
    unrealized_total = round(sum(p["unrealized_pnl"] for p in positions), 4)
    combined_estimate = round(realized_total + unrealized_total, 4)

    return {
        "uid": uid,
        "trade_fill_count": len(trades_asc),
        "sell_fill_count": sell_fills,
        "winning_sell_fills": winning_sells,
        "losing_sell_fills": losing_sells,
        "breakeven_sell_fills": flat_sells,
        "realized_pnl_usdt": realized_total,
        "unrealized_pnl_usdt": unrealized_total,
        "combined_pnl_estimate_usdt": combined_estimate,
        "volume_notional_usdt": round(volume_quote, 4),
        "fees_by_asset": fees_out,
        "realized_pnl_by_symbol": realized_by_symbol,
        "open_positions": positions,
        "methodology": (
            "Realized P&L: average-cost inventory per symbol on sell fills (USDT fees when fee asset is USDT). "
            "Unrealized: wallet holdings vs avg cost vs live mark. Combined is realized + unrealized (not tax advice)."
        ),
    }


@api_router.get("/portfolio/positions")
async def get_positions(current_user: dict = Depends(get_current_user)):
    """
    Return user's open positions with cost-basis for live P&L calculation.
    Positions are derived from wallet balances + weighted-average cost from trade history.
    """
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return await build_user_positions(current_user["uid"])


# ── Trading Simulation ────────────────────────────────────────────────────────

IBO_BASE_PRICE = 0.4523
IBO_24H_CHANGE = 2.33
IBO_24H_HIGH   = 0.4812
IBO_24H_LOW    = 0.4156
IBO_VOLUME     = 7_284_521.45


def _seeded_float(seed: int, lo: float, hi: float) -> float:
    seed = ((seed * 1_103_515_245) + 12_345) & 0x7FFF_FFFF
    return lo + (seed / 0x7FFF_FFFF) * (hi - lo)


def generate_ibo_klines(interval: str = "1h", limit: int = 200) -> List[Dict]:
    interval_seconds = {
        "1m": 60, "5m": 300, "15m": 900, "30m": 1_800,
        "1h": 3_600, "4h": 14_400, "1d": 86_400,
    }.get(interval, 3_600)

    now_ts   = int(datetime.now(timezone.utc).timestamp())
    boundary = (now_ts // interval_seconds) * interval_seconds

    candles = []
    price   = IBO_BASE_PRICE * 0.82

    for i in range(limit, 0, -1):
        t     = boundary - i * interval_seconds
        seed  = t ^ 0xDEADBEEF
        pct   = _seeded_float(seed,     -0.025, 0.030)
        close = price * (1 + pct)
        high  = max(price, close) * (1 + _seeded_float(seed + 1, 0, 0.012))
        low   = min(price, close) * (1 - _seeded_float(seed + 2, 0, 0.012))
        vol   = _seeded_float(seed + 3, 30_000, 600_000)
        candles.append({
            "time":   t,
            "open":   round(price, 6),
            "high":   round(high,  6),
            "low":    round(low,   6),
            "close":  round(close, 6),
            "volume": round(vol,   2),
        })
        price = close

    if candles:
        scale = IBO_BASE_PRICE / candles[-1]["close"] if candles[-1]["close"] else 1
        for c in candles:
            c["open"]  = round(c["open"]  * scale, 6)
            c["high"]  = round(c["high"]  * scale, 6)
            c["low"]   = round(c["low"]   * scale, 6)
            c["close"] = round(c["close"] * scale, 6)

    return candles


def generate_ibo_orderbook(depth: int = 20) -> Dict:
    rng      = random.Random()
    best_ask = IBO_BASE_PRICE * 1.0008
    best_bid = IBO_BASE_PRICE * 0.9992
    asks, bids = [], []
    for i in range(depth):
        asks.append([round(best_ask * (1 + i * 0.00055), 6), round(rng.uniform(200, 8000) * (1 + i * 0.15), 2)])
        bids.append([round(best_bid * (1 - i * 0.00055), 6), round(rng.uniform(200, 8000) * (1 + i * 0.15), 2)])
    return {"lastUpdateId": int(datetime.now().timestamp() * 1000), "asks": asks, "bids": bids}


def generate_ibo_trades(limit: int = 50) -> List[Dict]:
    rng    = random.Random()
    now    = datetime.now(timezone.utc)
    trades = []
    for i in range(limit):
        price = IBO_BASE_PRICE * rng.uniform(0.994, 1.006)
        qty   = rng.uniform(10, 3000)
        ts    = now - timedelta(seconds=i * rng.uniform(3, 45))
        trades.append({
            "id":           limit - i,
            "price":        f"{price:.6f}",
            "qty":          f"{qty:.2f}",
            "quoteQty":     f"{price * qty:.4f}",
            "time":         int(ts.timestamp() * 1000),
            "isBuyerMaker": rng.random() > 0.48,
        })
    return trades


# ── Trading Routes ────────────────────────────────────────────────────────────

async def _trading_markets_snapshot() -> List[Dict[str, Any]]:
    """
    Single-call market snapshot: all Binance USDT spot pairs (24h stats) + listed symbols,
    platform IBOUSDT (never Binance — unrelated token), IBO-quoted pairs from USDT tickers.
    """
    from ibo.pricing import platform_ibo_usdt_price
    from listings.market_data import (
        append_listed_rows_from_binance,
        fetch_all_binance_usdt_tickers,
        fetch_binance_24hr_map,
        usdt_symbols_for_snapshot,
    )

    # Full USDT universe for Markets UI; fall back to targeted batch if full fetch is empty.
    by_sym = fetch_all_binance_usdt_tickers()
    if not by_sym:
        symbols = usdt_symbols_for_snapshot(BINANCE_USDT_PAIRS)
        by_sym = fetch_binance_24hr_map(symbols)

    controls = await get_platform_controls()
    ibo_usdt_px = platform_ibo_usdt_price(controls)
    ibo_row: Dict[str, Any]
    if _ibo_mock_market_enabled:
        try:
            live = await ibo_mock_market.to_exchange_ticker("IBOUSDT")
            ibo_usdt_px = float(live["price"])
            ibo_row = {
                "symbol": "IBOUSDT",
                "base": "IBO",
                "baseAsset": "IBO",
                "quoteAsset": "USDT",
                "source": "internal",
                "stats_source": "mock",
                "price": live["price"],
                "priceChange": live["priceChange"],
                "priceChangePercent": live["priceChangePercent"],
                "highPrice": live["highPrice"],
                "lowPrice": live["lowPrice"],
                "volume": live["volume"],
                "quoteVolume": live["quoteVolume"],
                "openPrice": live["openPrice"],
                "weightedAvgPrice": live["weightedAvgPrice"],
                "bidPrice": live["bidPrice"],
                "askPrice": live["askPrice"],
                "prevClosePrice": live.get("prevClosePrice"),
                "count": live.get("count", "0"),
            }
        except Exception:  # noqa: BLE001
            ibo_row = None
    else:
        ibo_row = None

    if ibo_row is None:
        px = ibo_usdt_px
        spr = px * 0.0004
        ibo_row = {
            "symbol": "IBOUSDT",
            "base": "IBO",
            "baseAsset": "IBO",
            "quoteAsset": "USDT",
            "source": "internal",
            "stats_source": "internal",
            "price": f"{px:.6f}",
            "priceChange": f"{IBO_BASE_PRICE * IBO_24H_CHANGE / 100:.6f}",
            "priceChangePercent": f"{IBO_24H_CHANGE:.2f}",
            "highPrice": f"{IBO_24H_HIGH:.6f}",
            "lowPrice": f"{IBO_24H_LOW:.6f}",
            "volume": f"{IBO_VOLUME:.2f}",
            "quoteVolume": f"{IBO_VOLUME * px:.2f}",
            "openPrice": f"{IBO_BASE_PRICE * (1 - IBO_24H_CHANGE / 100):.6f}",
            "weightedAvgPrice": f"{px:.6f}",
            "bidPrice": f"{max(px - spr / 2, 1e-8):.6f}",
            "askPrice": f"{px + spr / 2:.6f}",
            "prevClosePrice": None,
            "count": "0",
        }

    rows: List[Dict[str, Any]] = [ibo_row]
    seen: Set[str] = {"IBOUSDT"}

    def _append_usdt_row(s: str) -> None:
        if s in seen:
            return
        seen.add(s)
        if s in by_sym:
            rows.append(_market_row_from_binance_ticker(by_sym[s]))
            return
        if s not in BINANCE_USDT_PAIRS:
            return
        fb = FALLBACK_PRICES.get(s, 1.0)
        base = s[:-4] if s.endswith("USDT") else s.replace("USDT", "")
        rows.append({
            "symbol": s,
            "base": base,
            "baseAsset": base,
            "quoteAsset": "USDT",
            "source": "binance",
            "stats_source": "fallback",
            "price": str(fb),
            "priceChange": "0",
            "priceChangePercent": "0",
            "openPrice": str(fb),
            "highPrice": str(fb),
            "lowPrice": str(fb),
            "volume": "0",
            "quoteVolume": "0",
            "weightedAvgPrice": str(fb),
            "bidPrice": str(fb * 0.9999),
            "askPrice": str(fb * 1.0001),
            "prevClosePrice": None,
            "count": "0",
        })

    # Majors first (stable order), then every other Binance USDT pair by 24h quote volume.
    for s in BINANCE_USDT_PAIRS:
        _append_usdt_row(s)

    rest = [s for s in by_sym if s not in seen]
    rest.sort(
        key=lambda s: float(by_sym[s].get("quoteVolume") or 0),
        reverse=True,
    )
    for s in rest:
        _append_usdt_row(s)

    from listings.ibo_markets import broadcast_ibo_rows, get_cached_ibo_rows

    all_ibo = get_cached_ibo_rows(ibo_usdt_px)
    for ib in broadcast_ibo_rows(all_ibo):
        sym = (ib.get("symbol") or "").upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        rows.append(ib)

    rows = append_listed_rows_from_binance(
        rows,
        by_sym,
        row_from_ticker=_market_row_from_binance_ticker,
    )

    from listings.market_data import append_listed_stub_rows

    rows = append_listed_stub_rows(rows)

    try:
        from listings.integration import merge_trading_markets_snapshot

        controls = await get_platform_controls()
        rows = merge_trading_markets_snapshot(
            rows, ibo_base_price=IBO_BASE_PRICE, controls=controls,
        )
    except Exception:  # noqa: BLE001
        logger.exception("trading markets: listed-token merge failed")

    return rows


@api_router.get("/platform/launch-status")
async def get_launch_status():
    """Public (no-auth) endpoint used by the exchange frontend to check whether
    the Coming Soon gate is active.  Returns immediately from the platform-
    controls cache so there is no DB hit on every page load."""
    controls = await get_platform_controls()
    return {
        "coming_soon":    bool(controls.get("coming_soon_enabled", False)),
        "message":        controls.get("coming_soon_message", "") or "",
        "launch_date":    controls.get("coming_soon_launch_date", "") or "",
    }


@api_router.get("/trading/markets")
async def get_markets_list():
    return await _trading_markets_snapshot()


@api_router.get("/trading/fee-config")
async def get_trading_fee_config():
    """Unified trading fee config for spot, futures, and options (settlement in IBO)."""
    from services import ibo_fee as ibo_fee_svc

    controls = await get_platform_controls()
    spot_maker, spot_taker = _fee_rates_from_controls(controls)
    ibo_price_usdt = await ibo_fee_svc.resolve_ibo_usdt_price(controls)

    futures_ctrl: Dict[str, Any] = {}
    try:
        from futures.services import controls as futures_controls_svc

        futures_ctrl = await futures_controls_svc.read_controls()
    except Exception:
        futures_ctrl = {}

    options_taker = options_maker = 0.0
    try:
        from options.services import controls as options_controls_svc

        options_taker, options_maker = await options_controls_svc.effective_fee_rates()
    except Exception:
        pass

    return {
        "fee_asset": ibo_fee_svc.FEE_ASSET,
        "ibo_price_usdt": float(ibo_price_usdt),
        "spot": {
            "maker_fee_rate": float(spot_maker),
            "taker_fee_rate": float(spot_taker),
        },
        "futures": {
            "maker_fee_rate": float(futures_ctrl.get("futures_maker_fee_rate", 0.0002)),
            "taker_fee_rate": float(futures_ctrl.get("futures_taker_fee_rate", 0.0005)),
            "liquidation_fee_rate": float(futures_ctrl.get("futures_liquidation_fee_rate", 0.005)),
        },
        "options": {
            "maker_fee_rate": float(options_maker),
            "taker_fee_rate": float(options_taker),
            "basis": "premium_notional",
        },
        # Back-compat for existing clients
        "maker_fee_rate": float(spot_maker),
        "taker_fee_rate": float(spot_taker),
    }


async def _live_ibo_usdt_mark() -> float:
    """Platform IBO/USDT for IBO-quoted market rows (live mock tick when enabled)."""
    from ibo.pricing import platform_ibo_usdt_price

    px = platform_ibo_usdt_price()
    if _ibo_mock_market_enabled:
        try:
            tk = await ibo_mock_market.engine.ticker("IBOUSDT")
            px = float(tk["price"])
        except Exception:  # noqa: BLE001
            pass
    return float(px)


async def _ibo_markets_ws_payload() -> Dict[str, Any]:
    """Lightweight WS payload — featured/top pairs + summary (not full catalog)."""
    from listings.ibo_markets import (
        broadcast_ibo_rows,
        get_cached_ibo_rows,
        summarize_ibo_rows,
        top_gainers_losers,
    )

    ibo_px = await _live_ibo_usdt_mark()
    rows = get_cached_ibo_rows(ibo_px, force=True)
    return {
        "markets": broadcast_ibo_rows(rows),
        "summary": summarize_ibo_rows(rows),
        "top_gainers": top_gainers_losers(rows)[0],
        "top_losers": top_gainers_losers(rows)[1],
        "ibo_usdt_price": ibo_px,
        "total_catalog": len(rows),
    }


@api_router.get("/trading/ibo-markets")
async def get_ibo_markets_list(
    skip: int = Query(0, ge=0),
    limit: int = Query(40, ge=1, le=80),
    q: Optional[str] = Query(None, description="Search symbol or name"),
    tier: str = Query(
        "featured",
        description="featured | major | web3 | all",
    ),
):
    """Paginated IBO-quoted markets (optimized; full catalog up to IBO_WEB3 limit)."""
    from listings.ibo_markets import paginate_ibo_markets

    ibo_px = await _live_ibo_usdt_mark()
    return paginate_ibo_markets(
        ibo_px,
        skip=skip,
        limit=limit,
        q=q,
        tier=tier,
    )


async def _trading_ticker_snapshot(sym: str) -> Dict[str, Any]:
    """sym uppercased, must be in SYMBOL_BASE_MAP. Raises requests.RequestException for Binance failures."""
    from listings.ibo_pairs import base_usdt_for_ibo_pair, is_ibo_quoted_pair, resolve_ibo_base

    # Live mock ticker when enabled; otherwise platform deposit-driven mark.
    if sym == "IBOUSDT" and _ibo_mock_market_enabled:
        return await ibo_mock_market.to_exchange_ticker(sym)

    if sym == "IBOUSDT":
        from ibo.pricing import platform_ibo_usdt_price

        ibo_px = platform_ibo_usdt_price()
        live_price = ibo_px * random.uniform(0.997, 1.003)
        return {
            "symbol":             sym,
            "price":              f"{live_price:.6f}",
            "priceChange":        f"{ibo_px * IBO_24H_CHANGE / 100:.6f}",
            "priceChangePercent": f"{IBO_24H_CHANGE:.2f}",
            "highPrice":          f"{IBO_24H_HIGH:.6f}",
            "lowPrice":           f"{IBO_24H_LOW:.6f}",
            "volume":             f"{IBO_VOLUME:.2f}",
            "quoteVolume":        f"{IBO_VOLUME * ibo_px:.2f}",
            "count":              random.randint(10_000, 15_000),
            "openPrice":          f"{ibo_px * (1 - IBO_24H_CHANGE / 100):.6f}",
            "weightedAvgPrice":   f"{ibo_px:.6f}",
            "bidPrice":           f"{live_price * 0.9998:.6f}",
            "askPrice":           f"{live_price * 1.0002:.6f}",
            "prevClosePrice":     None,
        }

    if _ibo_mock_market_enabled and ibo_mock_market.is_supported(sym):
        return await ibo_mock_market.to_exchange_ticker(sym)

    if is_ibo_quoted_pair(sym):
        from ibo.pricing import platform_ibo_usdt_price

        base = resolve_ibo_base(sym) or ""
        usdt = base_usdt_for_ibo_pair(base)
        ibo_px = platform_ibo_usdt_price()
        return ibo_market_data.generate_ibo_pair_ticker(sym, ibo_px, base_usdt=usdt)
    from listings.listed_trading import generate_listed_usdt_ticker, non_binance_listed_usdt_symbols

    if sym in non_binance_listed_usdt_symbols():
        return generate_listed_usdt_ticker(sym)
    r = requests.get(
        "https://api.binance.com/api/v3/ticker/24hr",
        params={"symbol": sym},
        timeout=10,
    )
    r.raise_for_status()
    return _normalize_binance_24h(r.json())


@api_router.get("/trading/ticker/{symbol}")
async def get_ticker(symbol: str):
    sym = symbol.upper()
    if not trading_symbol_allowed(sym):
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {sym}")
    try:
        return await _trading_ticker_snapshot(sym)
    except requests.RequestException as e:
        logger.warning("Binance ticker failed for %s: %s", sym, e)
        raise HTTPException(status_code=502, detail="Ticker temporarily unavailable") from e


async def _trading_klines_snapshot(sym: str, interval: str, limit: int) -> List[Dict[str, Any]]:
    """sym must be uppercased and present in SYMBOL_BASE_MAP."""
    from listings.ibo_pairs import is_ibo_quoted_pair

    if _ibo_mock_market_enabled and ibo_mock_market.is_supported(sym):
        return await ibo_mock_market.to_exchange_klines(sym, interval, limit)

    if is_ibo_quoted_pair(sym):
        return ibo_market_data.generate_ibo_pair_klines(sym, IBO_BASE_PRICE, interval, limit)
    if sym == "IBOUSDT":
        return generate_ibo_klines(interval, limit)
    from listings.listed_trading import generate_listed_usdt_klines, non_binance_listed_usdt_symbols

    if sym in non_binance_listed_usdt_symbols():
        return generate_listed_usdt_klines(sym, interval, limit)
    try:
        r = requests.get(
            "https://api.binance.com/api/v3/klines",
            params={"symbol": sym, "interval": interval, "limit": limit},
            timeout=15,
        )
        r.raise_for_status()
        raw = r.json()
    except requests.RequestException as e:
        logger.warning("Binance klines failed for %s: %s", sym, e)
        raise HTTPException(status_code=502, detail="Chart data temporarily unavailable") from e
    out = []
    for c in raw:
        out.append({
            "time":   int(c[0] // 1000),
            "open":   float(c[1]),
            "high":   float(c[2]),
            "low":    float(c[3]),
            "close":  float(c[4]),
            "volume": float(c[5]),
        })
    return out


@api_router.get("/trading/klines/{symbol}")
async def get_klines(
    symbol:   str,
    interval: str = Query(default="1h"),
    limit:    int = Query(default=200, le=500),
):
    sym = symbol.upper()
    if not trading_symbol_allowed(sym):
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {sym}")
    return await _trading_klines_snapshot(sym, interval, limit)


async def _trading_orderbook_snapshot(sym: str, limit: int) -> Dict[str, Any]:
    from listings.ibo_pairs import is_ibo_quoted_pair

    if _ibo_mock_market_enabled and ibo_mock_market.is_supported(sym):
        return await ibo_mock_market.to_exchange_orderbook(sym, limit)

    if is_ibo_quoted_pair(sym):
        tick = await _trading_ticker_snapshot(sym)
        mid = float(tick.get("price") or 0)
        return ibo_market_data.generate_ibo_pair_orderbook(
            sym, IBO_BASE_PRICE, min(limit, 50), mid_price=mid if mid > 0 else None,
        )
    if sym == "IBOUSDT":
        return generate_ibo_orderbook(min(limit, 50))
    from listings.listed_trading import generate_listed_usdt_orderbook, non_binance_listed_usdt_symbols

    if sym in non_binance_listed_usdt_symbols():
        tick = await _trading_ticker_snapshot(sym)
        mid = float(tick.get("price") or 0)
        return generate_listed_usdt_orderbook(sym, min(limit, 50), mid=mid if mid > 0 else None)
    r = requests.get(
        "https://api.binance.com/api/v3/depth",
        params={"symbol": sym, "limit": min(limit, 1000)},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


@api_router.get("/trading/orderbook/{symbol}")
async def get_orderbook(symbol: str, limit: int = Query(default=20, le=100)):
    """
    IBO: synthetic book. Other pairs: proxy Binance depth (allowlisted symbols only).
    """
    sym = symbol.upper()
    if not trading_symbol_allowed(sym):
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {sym}")
    try:
        return await _trading_orderbook_snapshot(sym, limit)
    except requests.RequestException as e:
        logger.warning("Binance depth fetch failed for %s: %s", sym, e)
        raise HTTPException(
            status_code=502,
            detail="Order book temporarily unavailable",
        ) from e


async def _trading_trades_feed_snapshot(sym: str, limit: int) -> List[Dict[str, Any]]:
    from listings.ibo_pairs import is_ibo_quoted_pair

    if _ibo_mock_market_enabled and ibo_mock_market.is_supported(sym):
        return await ibo_mock_market.to_exchange_trades(sym, limit)

    if is_ibo_quoted_pair(sym):
        tick = await _trading_ticker_snapshot(sym)
        mid = float(tick.get("price") or 0)
        return ibo_market_data.generate_ibo_pair_trades(
            sym, IBO_BASE_PRICE, limit, mid_price=mid if mid > 0 else None,
        )
    if sym == "IBOUSDT":
        return generate_ibo_trades(limit)
    r = requests.get(
        "https://api.binance.com/api/v3/trades",
        params={"symbol": sym, "limit": min(limit, 1000)},
        timeout=10,
    )
    r.raise_for_status()
    raw = r.json()
    out = []
    for t in raw:
        price = float(t["price"])
        qty = float(t["qty"])
        out.append({
            "id":           t.get("id"),
            "price":        t["price"],
            "qty":          t["qty"],
            "quoteQty":     f"{price * qty:.8f}",
            "time":         t["time"],
            "isBuyerMaker": t.get("isBuyerMaker", False),
        })
    return out


@api_router.get("/trading/trades/{symbol}")
async def get_recent_trades(symbol: str, limit: int = Query(default=50, le=100)):
    sym = symbol.upper()
    if not trading_symbol_allowed(sym):
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {sym}")
    try:
        return await _trading_trades_feed_snapshot(sym, limit)
    except requests.RequestException as e:
        logger.warning("Binance trades failed for %s: %s", sym, e)
        raise HTTPException(status_code=502, detail="Trades feed temporarily unavailable") from e


# ── Dedicated IBO mock market APIs (toggle: IBO_MOCK_MARKET=true) ────────────

def _require_ibo_mock_enabled() -> None:
    if not _ibo_mock_market_enabled:
        raise HTTPException(
            status_code=503,
            detail="IBO mock market is disabled (set IBO_MOCK_MARKET=true).",
        )


def _ibo_symbol_or_400(symbol: str) -> str:
    sym = (symbol or "").strip().upper()
    if not ibo_mock_market.is_supported(sym):
        raise HTTPException(status_code=400, detail=f"Unsupported IBO symbol: {sym}")
    return sym


@api_router.get("/ibo/candles")
async def ibo_get_candles(
    symbol: str = Query(...),
    interval: str = Query("1m"),
    limit: int = Query(200, ge=1, le=500),
):
    _require_ibo_mock_enabled()
    sym = _ibo_symbol_or_400(symbol)
    iv = (interval or "1m").lower()
    if iv not in ibo_mock_market.INTERVAL_SECONDS:
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {iv}")
    try:
        return await ibo_mock_market.engine.candles(sym, iv, limit)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@api_router.get("/ibo/orderbook")
async def ibo_get_orderbook(
    symbol: str = Query(...),
):
    _require_ibo_mock_enabled()
    sym = _ibo_symbol_or_400(symbol)
    try:
        return await ibo_mock_market.engine.orderbook(sym)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@api_router.get("/ibo/trades")
async def ibo_get_trades(
    symbol: str = Query(...),
    limit: int = Query(50, ge=1, le=50),
):
    _require_ibo_mock_enabled()
    sym = _ibo_symbol_or_400(symbol)
    try:
        return await ibo_mock_market.engine.trades(sym, limit)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@api_router.get("/ibo/ticker")
async def ibo_get_ticker(
    symbol: str = Query(...),
):
    _require_ibo_mock_enabled()
    sym = _ibo_symbol_or_400(symbol)
    try:
        return await ibo_mock_market.engine.ticker(sym)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@api_router.get("/ibo/ticker/all")
async def ibo_get_ticker_all():
    _require_ibo_mock_enabled()
    return await ibo_mock_market.engine.ticker_all()


# ── Exchange WebSocket (public market streams + JWT positions) ────────────────
_ex_ws_markets_lock = asyncio.Lock()
_ex_ws_markets_subs: List[WebSocket] = []
_ex_ws_markets_task: Optional[asyncio.Task] = None

_ex_ws_ticker_lock = asyncio.Lock()
_ex_ws_ticker_subs: List[Dict[str, Any]] = []
_ex_ws_ticker_task: Optional[asyncio.Task] = None

_ex_ws_book_lock = asyncio.Lock()
_ex_ws_book_subs: List[Dict[str, Any]] = []
_ex_ws_book_task: Optional[asyncio.Task] = None

_ex_ws_trades_lock = asyncio.Lock()
_ex_ws_trades_subs: List[Dict[str, Any]] = []
_ex_ws_trades_task: Optional[asyncio.Task] = None

_ex_ws_positions_lock = asyncio.Lock()
_ex_ws_positions_subs: List[Dict[str, Any]] = []
_ex_ws_positions_task: Optional[asyncio.Task] = None

_ex_ws_account_lock = asyncio.Lock()
_ex_ws_account_subs: List[Dict[str, Any]] = []
_ex_ws_account_task: Optional[asyncio.Task] = None


async def _exchange_account_snapshot(uid: str) -> dict:
    """Single payload for exchange trade state: balances, orders, fills, spot P&L positions."""
    wallet, open_o, hist, trades, positions = await asyncio.gather(
        _wallet_balances_for_uid(uid),
        _open_orders_for_uid(uid),
        _order_history_for_uid(uid),
        _user_trades_for_uid(uid),
        build_user_positions(uid),
    )
    return {
        "wallet": [w.model_dump() for w in wallet],
        "open_orders": [o.model_dump() for o in open_o],
        "order_history": [o.model_dump() for o in hist],
        "user_trades": [t.model_dump() for t in trades],
        "positions": positions,
    }


async def _ex_ws_markets_broadcast_loop():
    global _ex_ws_markets_task
    try:
        while True:
            await asyncio.sleep(2)
            async with _ex_ws_markets_lock:
                if not _ex_ws_markets_subs:
                    break
                wss = list(_ex_ws_markets_subs)
            try:
                rows = await _trading_markets_snapshot()
            except Exception as e:
                logger.exception("exchange ws markets: %s", e)
                continue
            payload = {
                "type": "exchange_markets",
                "markets": rows,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            for ws in wss:
                try:
                    await ws.send_json(payload)
                except Exception:
                    pass
    finally:
        async with _ex_ws_markets_lock:
            _ex_ws_markets_task = None


async def _ensure_ex_ws_markets_broadcaster():
    global _ex_ws_markets_task
    async with _ex_ws_markets_lock:
        if _ex_ws_markets_task is None or _ex_ws_markets_task.done():
            _ex_ws_markets_task = asyncio.create_task(_ex_ws_markets_broadcast_loop())


async def _ex_ws_ticker_broadcast_loop():
    global _ex_ws_ticker_task
    try:
        while True:
            await asyncio.sleep(2)
            async with _ex_ws_ticker_lock:
                if not _ex_ws_ticker_subs:
                    break
                snap = list(_ex_ws_ticker_subs)
            by_sym: Dict[str, List[WebSocket]] = defaultdict(list)
            for s in snap:
                by_sym[s["symbol"]].append(s["websocket"])
            for sym, wss in by_sym.items():
                try:
                    tick = await _trading_ticker_snapshot(sym)
                except Exception as e:
                    logger.warning("exchange ws ticker %s: %s", sym, e)
                    continue
                payload = {
                    "type": "exchange_ticker",
                    "symbol": sym,
                    "ticker": tick,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                for ws in wss:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _ex_ws_ticker_lock:
            _ex_ws_ticker_task = None


async def _ensure_ex_ws_ticker_broadcaster():
    global _ex_ws_ticker_task
    async with _ex_ws_ticker_lock:
        if _ex_ws_ticker_task is None or _ex_ws_ticker_task.done():
            _ex_ws_ticker_task = asyncio.create_task(_ex_ws_ticker_broadcast_loop())


async def _ex_ws_book_broadcast_loop():
    global _ex_ws_book_task
    try:
        while True:
            await asyncio.sleep(1.5)
            async with _ex_ws_book_lock:
                if not _ex_ws_book_subs:
                    break
                snap = list(_ex_ws_book_subs)
            groups: Dict[tuple, List[WebSocket]] = defaultdict(list)
            for s in snap:
                groups[(s["symbol"], s["limit"])].append(s["websocket"])
            for (sym, lim), wss in groups.items():
                try:
                    book = await _trading_orderbook_snapshot(sym, lim)
                except Exception as e:
                    logger.warning("exchange ws orderbook %s: %s", sym, e)
                    continue
                payload = {
                    "type": "exchange_orderbook",
                    "symbol": sym,
                    "limit": lim,
                    "book": book,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                for ws in wss:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _ex_ws_book_lock:
            _ex_ws_book_task = None


async def _ensure_ex_ws_book_broadcaster():
    global _ex_ws_book_task
    async with _ex_ws_book_lock:
        if _ex_ws_book_task is None or _ex_ws_book_task.done():
            _ex_ws_book_task = asyncio.create_task(_ex_ws_book_broadcast_loop())


async def _ex_ws_trades_broadcast_loop():
    global _ex_ws_trades_task
    try:
        while True:
            await asyncio.sleep(1.5)
            async with _ex_ws_trades_lock:
                if not _ex_ws_trades_subs:
                    break
                snap = list(_ex_ws_trades_subs)
            groups: Dict[tuple, List[WebSocket]] = defaultdict(list)
            for s in snap:
                groups[(s["symbol"], s["limit"])].append(s["websocket"])
            for (sym, lim), wss in groups.items():
                try:
                    trades = await _trading_trades_feed_snapshot(sym, lim)
                except Exception as e:
                    logger.warning("exchange ws trades %s: %s", sym, e)
                    continue
                payload = {
                    "type": "exchange_trades",
                    "symbol": sym,
                    "limit": lim,
                    "trades": trades,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                for ws in wss:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _ex_ws_trades_lock:
            _ex_ws_trades_task = None


async def _ensure_ex_ws_trades_broadcaster():
    global _ex_ws_trades_task
    async with _ex_ws_trades_lock:
        if _ex_ws_trades_task is None or _ex_ws_trades_task.done():
            _ex_ws_trades_task = asyncio.create_task(_ex_ws_trades_broadcast_loop())


async def _ex_ws_positions_broadcast_loop():
    global _ex_ws_positions_task
    try:
        while True:
            await asyncio.sleep(2)
            async with _ex_ws_positions_lock:
                if not _ex_ws_positions_subs:
                    break
                snap = list(_ex_ws_positions_subs)
            by_uid: Dict[str, List[WebSocket]] = defaultdict(list)
            for s in snap:
                by_uid[s["uid"]].append(s["websocket"])
            for uid, wss in by_uid.items():
                try:
                    positions = await build_user_positions(uid)
                except Exception as e:
                    logger.exception("exchange ws positions %s: %s", uid, e)
                    continue
                payload = {
                    "type": "exchange_positions",
                    "positions": positions,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                for ws in wss:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _ex_ws_positions_lock:
            _ex_ws_positions_task = None


async def _ensure_ex_ws_positions_broadcaster():
    global _ex_ws_positions_task
    async with _ex_ws_positions_lock:
        if _ex_ws_positions_task is None or _ex_ws_positions_task.done():
            _ex_ws_positions_task = asyncio.create_task(_ex_ws_positions_broadcast_loop())


async def _ex_ws_account_broadcast_loop():
    global _ex_ws_account_task
    try:
        while True:
            await asyncio.sleep(2)
            async with _ex_ws_account_lock:
                if not _ex_ws_account_subs:
                    break
                snap = list(_ex_ws_account_subs)
            by_uid: Dict[str, List[WebSocket]] = defaultdict(list)
            for s in snap:
                by_uid[s["uid"]].append(s["websocket"])
            for uid, wss in by_uid.items():
                try:
                    data = await _exchange_account_snapshot(uid)
                except Exception as e:
                    logger.exception("exchange ws account %s: %s", uid, e)
                    continue
                payload = {
                    "type": "exchange_account",
                    **data,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                for ws in wss:
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        pass
    finally:
        async with _ex_ws_account_lock:
            _ex_ws_account_task = None


async def _ensure_ex_ws_account_broadcaster():
    global _ex_ws_account_task
    async with _ex_ws_account_lock:
        if _ex_ws_account_task is None or _ex_ws_account_task.done():
            _ex_ws_account_task = asyncio.create_task(_ex_ws_account_broadcast_loop())


@api_router.websocket("/ws/exchange/markets")
async def ws_exchange_markets(websocket: WebSocket):
    await websocket.accept()
    try:
        rows = await _trading_markets_snapshot()
        await websocket.send_json({
            "type": "exchange_markets",
            "markets": rows,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws exchange markets: client gone before snapshot (%s)", e)
            return
        logger.exception("ws exchange markets initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _ex_ws_markets_lock:
        _ex_ws_markets_subs.append(websocket)
    await _ensure_ex_ws_markets_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _ex_ws_markets_lock:
            _ex_ws_markets_subs[:] = [w for w in _ex_ws_markets_subs if w != websocket]


@api_router.websocket("/ws/exchange/ticker")
async def ws_exchange_ticker(
    websocket: WebSocket,
    symbol: str = Query(..., min_length=5),
):
    sym = symbol.strip().upper()
    if not trading_symbol_allowed(sym):
        await websocket.close(code=4400)
        return
    await websocket.accept()
    sub = {"websocket": websocket, "symbol": sym}
    try:
        tick = await _trading_ticker_snapshot(sym)
        await websocket.send_json({
            "type": "exchange_ticker",
            "symbol": sym,
            "ticker": tick,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws exchange ticker: client gone (%s)", e)
            return
        logger.warning("ws exchange ticker initial %s: %s", sym, e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _ex_ws_ticker_lock:
        _ex_ws_ticker_subs.append(sub)
    await _ensure_ex_ws_ticker_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _ex_ws_ticker_lock:
            _ex_ws_ticker_subs[:] = [s for s in _ex_ws_ticker_subs if s["websocket"] != websocket]


@api_router.websocket("/ws/exchange/orderbook")
async def ws_exchange_orderbook(
    websocket: WebSocket,
    symbol: str = Query(..., min_length=5),
    limit: int = Query(100, ge=5, le=1000),
):
    sym = symbol.strip().upper()
    if not trading_symbol_allowed(sym):
        await websocket.close(code=4400)
        return
    await websocket.accept()
    sub = {"websocket": websocket, "symbol": sym, "limit": limit}
    try:
        book = await _trading_orderbook_snapshot(sym, limit)
        await websocket.send_json({
            "type": "exchange_orderbook",
            "symbol": sym,
            "limit": limit,
            "book": book,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws exchange orderbook: client gone (%s)", e)
            return
        logger.warning("ws exchange orderbook initial %s: %s", sym, e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _ex_ws_book_lock:
        _ex_ws_book_subs.append(sub)
    await _ensure_ex_ws_book_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _ex_ws_book_lock:
            _ex_ws_book_subs[:] = [s for s in _ex_ws_book_subs if s["websocket"] != websocket]


@api_router.websocket("/ws/exchange/trades")
async def ws_exchange_trades(
    websocket: WebSocket,
    symbol: str = Query(..., min_length=5),
    limit: int = Query(40, ge=5, le=100),
):
    sym = symbol.strip().upper()
    if not trading_symbol_allowed(sym):
        await websocket.close(code=4400)
        return
    await websocket.accept()
    sub = {"websocket": websocket, "symbol": sym, "limit": limit}
    try:
        trades = await _trading_trades_feed_snapshot(sym, limit)
        await websocket.send_json({
            "type": "exchange_trades",
            "symbol": sym,
            "limit": limit,
            "trades": trades,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws exchange trades: client gone (%s)", e)
            return
        logger.warning("ws exchange trades initial %s: %s", sym, e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _ex_ws_trades_lock:
        _ex_ws_trades_subs.append(sub)
    await _ensure_ex_ws_trades_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _ex_ws_trades_lock:
            _ex_ws_trades_subs[:] = [s for s in _ex_ws_trades_subs if s["websocket"] != websocket]


@api_router.websocket("/ws/exchange/positions")
async def ws_exchange_positions(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    if db is None:
        await websocket.close(code=1011)
        return
    user = await _exchange_user_from_ws_token(token)
    if not user:
        await websocket.close(code=4401)
        return
    uid = user["uid"]
    await websocket.accept()
    sub = {"websocket": websocket, "uid": uid}
    try:
        positions = await build_user_positions(uid)
        await websocket.send_json({
            "type": "exchange_positions",
            "positions": positions,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws exchange positions: client gone (%s)", e)
            return
        logger.exception("ws exchange positions initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _ex_ws_positions_lock:
        _ex_ws_positions_subs.append(sub)
    await _ensure_ex_ws_positions_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _ex_ws_positions_lock:
            _ex_ws_positions_subs[:] = [s for s in _ex_ws_positions_subs if s["websocket"] != websocket]


@api_router.websocket("/ws/exchange/account")
async def ws_exchange_account(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    if db is None:
        await websocket.close(code=1011)
        return
    user = await _exchange_user_from_ws_token(token)
    if not user:
        await websocket.close(code=4401)
        return
    uid = user["uid"]
    await websocket.accept()
    sub = {"websocket": websocket, "uid": uid}
    try:
        data = await _exchange_account_snapshot(uid)
        await websocket.send_json({
            "type": "exchange_account",
            **data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            logger.debug("ws exchange account: client gone (%s)", e)
            return
        logger.exception("ws exchange account initial: %s", e)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    async with _ex_ws_account_lock:
        _ex_ws_account_subs.append(sub)
    await _ensure_ex_ws_account_broadcaster()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with _ex_ws_account_lock:
            _ex_ws_account_subs[:] = [s for s in _ex_ws_account_subs if s["websocket"] != websocket]


# ── IBO WebSocket streams ─────────────────────────────────────────────────────
# Dedicated namespace: /api/ws/ibo/... for IBO-as-quote pair data.

@api_router.websocket("/ws/ibo-market")
async def ws_ibo_market(
    websocket: WebSocket,
    symbol: str = Query("IBOUSDT"),
    interval: str = Query("1m"),
):
    if not _ibo_mock_market_enabled:
        await websocket.close(code=4403)
        return

    sym = (symbol or "").strip().upper()
    iv = (interval or "1m").strip().lower()
    if not ibo_mock_market.is_supported(sym) or iv not in ibo_mock_market.INTERVAL_SECONDS:
        await websocket.close(code=4400)
        return

    await websocket.accept()
    try:
        candles = await ibo_mock_market.engine.candles(sym, iv, 200)
        orderbook = await ibo_mock_market.engine.orderbook(sym)
        trades = await ibo_mock_market.engine.trades(sym, 20)
        ticker = await ibo_mock_market.engine.ticker(sym)
        await websocket.send_json(
            {
                "type": "snapshot",
                "symbol": sym,
                "interval": iv,
                "candles": candles[-200:],
                "orderbook": orderbook,
                "trades": trades[-20:],
                "ticker": ticker,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as e:  # noqa: BLE001
        if not _ws_client_gone_error(e):
            logger.warning("ws ibo-market initial failed: %s", e)
        with contextlib.suppress(Exception):
            await websocket.close(code=1011)
        return

    # Two-speed streaming loop
    # Fast  (every ~1 s)  → ticker + orderbook + live candle + trade
    # Slow  (every ~5 s)  → full book qty refresh (handled by engine slow loop)
    # Ping  (every ~15 s) → heartbeat so clients detect stale connections
    try:
        ping_counter = 0
        while True:
            await asyncio.sleep(1.0)
            ping_counter += 1

            # ── heartbeat ──────────────────────────────────────────────────
            if ping_counter >= 15:
                ping_counter = 0
                await websocket.send_json({
                    "type": "ping",
                    "ts": int(datetime.now(timezone.utc).timestamp() * 1000),
                })

            # ── fast: ticker + live candle edge + one new trade ───────────
            ticker = await ibo_mock_market.engine.ticker(sym)
            await websocket.send_json({"type": "ticker", **ticker})

            # Always push the open (live) candle every second so the chart's
            # right edge tracks the price in real time.  candles() now returns
            # close = st.price so this is a no-op in terms of data volume.
            live_candles = await ibo_mock_market.engine.candles(sym, iv, 1)
            if live_candles:
                await websocket.send_json({
                    "type": "candle",
                    "symbol": sym,
                    "interval": iv,
                    "candle": live_candles[-1],
                })

            trades = await ibo_mock_market.engine.trades(sym, 1)
            if trades:
                await websocket.send_json({"type": "trade", "symbol": sym, **trades[0]})

            orderbook = await ibo_mock_market.engine.orderbook(sym)
            await websocket.send_json({
                "type": "orderbook",
                "symbol": sym,
                "bids": orderbook["bids"],
                "asks": orderbook["asks"],
            })
    except (WebSocketDisconnect, Exception):
        pass

@api_router.websocket("/ws/ibo/markets")
async def ws_ibo_markets(websocket: WebSocket):
    """Push snapshot of all IBO-quoted pair tickers; re-broadcasts every 5 s."""
    await websocket.accept()
    try:
        payload = await _ibo_markets_ws_payload()
        await websocket.send_json({
            "type": "ibo_markets",
            **payload,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        if _ws_client_gone_error(e):
            return
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
        return
    try:
        while True:
            await asyncio.sleep(8)
            payload = await _ibo_markets_ws_payload()
            await websocket.send_json({
                "type": "ibo_markets",
                **payload,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
    except (WebSocketDisconnect, Exception):
        pass


@api_router.websocket("/ws/ibo/ticker")
async def ws_ibo_ticker(
    websocket: WebSocket,
    symbol: str = Query(..., min_length=5),
):
    """Stream 24-h ticker for a single IBO-quoted pair at 3-s intervals."""
    sym = symbol.strip().upper()
    from listings.ibo_pairs import is_ibo_quoted_pair

    if not is_ibo_quoted_pair(sym):
        await websocket.close(code=4400)
        return
    await websocket.accept()
    try:
        while True:
            from listings.ibo_pairs import base_usdt_for_ibo_pair, resolve_ibo_base

            base = resolve_ibo_base(sym) or ""
            tick = ibo_market_data.generate_ibo_pair_ticker(
                sym, IBO_BASE_PRICE, base_usdt=base_usdt_for_ibo_pair(base),
            )
            await websocket.send_json({
                "type": "ibo_ticker",
                "symbol": sym,
                "ticker": tick,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            await asyncio.sleep(3)
    except (WebSocketDisconnect, Exception):
        pass


@api_router.websocket("/ws/ibo/orderbook")
async def ws_ibo_orderbook(
    websocket: WebSocket,
    symbol: str = Query(..., min_length=5),
    limit: int = Query(20, ge=5, le=50),
):
    """Stream order book for a IBO-quoted pair at 2-s intervals."""
    sym = symbol.strip().upper()
    from listings.ibo_pairs import is_ibo_quoted_pair

    if not is_ibo_quoted_pair(sym):
        await websocket.close(code=4400)
        return
    await websocket.accept()
    try:
        while True:
            book = ibo_market_data.generate_ibo_pair_orderbook(sym, IBO_BASE_PRICE, limit)
            await websocket.send_json({
                "type": "ibo_orderbook",
                "symbol": sym,
                "book": book,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            await asyncio.sleep(2)
    except (WebSocketDisconnect, Exception):
        pass


# ── Include router ────────────────────────────────────────────────────────────
# Same 32×32 PNG as /api/token-logo, without the /api prefix (handy for wallet UIs / deep links).
@app.get("/token-logo")
def token_logo_at_root():
    return _token_logo_png_response()


app.include_router(api_router)
app.include_router(futures_router)
app.include_router(futures_admin_router)
app.include_router(futures_ws_router)
app.include_router(options_ws_router)
app.include_router(options_router)
app.include_router(options_admin_router)
app.include_router(p2p_router)
app.include_router(p2p_admin_router)
app.include_router(p2p_ws_router)
app.include_router(ibo_admin_router)
app.include_router(listings_public_router)
app.include_router(listings_admin_router)
app.include_router(inr_router)
app.include_router(inr_admin_router)
app.include_router(_treasury_transfer_api.router)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_ROOT)), name="uploads")
