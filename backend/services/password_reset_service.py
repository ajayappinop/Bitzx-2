"""Email-based password reset tokens (Phase 1 — user + admin-triggered).

Plain tokens are never stored — only ``sha256(token)``. The reset link is
built from ``EXCHANGE_PUBLIC_URL`` (or ``PASSWORD_RESET_PUBLIC_URL``) +
``/reset-password?token=…``.

SMTP delivery is now delegated to ``email_service`` + ``email_templates``
so all outbound emails share the same premium HTML design.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote, urlparse

from services import email_service, email_templates

logger = logging.getLogger(__name__)

RESET_TTL_HOURS = int(os.getenv("PASSWORD_RESET_TTL_HOURS", "24"))
DEFAULT_RESET_BASE = "https://exchange.ibo.io"
# Hosts that must never be used for reset links (no DNS / wrong app).
_BLOCKED_RESET_HOSTS = frozenset({"app.ibo.io"})


def _normalize_reset_base(raw: str) -> Optional[str]:
    val = (raw or "").strip().rstrip("/")
    if not val:
        return None
    host = (urlparse(val).hostname or "").lower()
    if host in _BLOCKED_RESET_HOSTS:
        logger.warning(
            "password_reset: ignoring reset base %r — host %s is not configured; using %s",
            val,
            host,
            DEFAULT_RESET_BASE,
        )
        return None
    return val


def _reset_public_base() -> str:
    """Public web URL where ``/reset-password`` is hosted (exchange app)."""
    for key in ("PASSWORD_RESET_PUBLIC_URL", "EXCHANGE_PUBLIC_URL"):
        base = _normalize_reset_base(os.getenv(key) or "")
        if base:
            return base
    # Legacy deployments still set FRONTEND_PUBLIC_URL only — accept if not blocked.
    legacy = _normalize_reset_base(os.getenv("FRONTEND_PUBLIC_URL") or "")
    if legacy:
        logger.info("password_reset: using FRONTEND_PUBLIC_URL for reset links (legacy)")
        return legacy
    return DEFAULT_RESET_BASE


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_reset_link(plain_token: str) -> str:
    return f"{_reset_public_base()}/reset-password?token={quote(plain_token, safe='')}"


def reset_link_host_for_log(link: str) -> str:
    """Safe host string for logs (no token)."""
    return (urlparse(link).hostname or "?").lower()


def smtp_configured() -> bool:
    """Proxy to the shared email service config check."""
    return email_service.smtp_configured()


def mask_email(email: str) -> str:
    e = (email or "").strip()
    if "@" not in e or len(e) < 5:
        return "***"
    local, _, domain = e.partition("@")
    if len(local) <= 2:
        return f"**@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


async def send_password_reset_email(to_email: str, reset_link: str, name: str = "") -> bool:
    """Send a premium HTML password-reset email. Returns True on success."""
    subject, html, text = email_templates.password_reset_email(
        name=name or "",
        reset_link=reset_link,
        expires_hours=RESET_TTL_HOURS,
    )
    return await email_service.send_email(
        to=to_email,
        subject=subject,
        html_body=html,
        text_body=text,
        log_tag="password_reset",
    )


async def issue_token(
    db,
    *,
    uid: str,
    email: str,
    admin_triggered: bool,
) -> Tuple[str, str]:
    """Create a fresh reset token. Returns ``(plain_token, row_id)``."""
    plain = secrets.token_urlsafe(32)
    th    = hash_token(plain)
    rid   = f"prt_{secrets.token_hex(12)}"
    now   = datetime.now(timezone.utc)
    exp   = now + timedelta(hours=RESET_TTL_HOURS)
    await db.password_reset_tokens.delete_many({"uid": uid, "consumed_at": None})
    await db.password_reset_tokens.insert_one(
        {
            "id":               rid,
            "uid":              uid,
            "email":            (email or "").strip().lower(),
            "token_hash":       th,
            "admin_triggered":  bool(admin_triggered),
            "created_at":       now.isoformat(),
            "expires_at":       exp,
            "consumed_at":      None,
        }
    )
    return plain, rid


async def validate_active_token(db, *, plain_token: str) -> Optional[Dict[str, Any]]:
    """Return the row (no ``token_hash``) if valid, not consumed, not expired."""
    th  = hash_token(plain_token)
    now = datetime.now(timezone.utc)
    row = await db.password_reset_tokens.find_one(
        {"token_hash": th, "consumed_at": None, "expires_at": {"$gte": now}},
        {"_id": 0, "token_hash": 0},
    )
    return row


async def mark_consumed(db, *, row_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db.password_reset_tokens.update_one({"id": row_id}, {"$set": {"consumed_at": now}})
