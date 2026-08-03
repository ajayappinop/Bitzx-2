"""Centralized email service for IBO.

Single entry point for all outbound emails. Provider-agnostic: currently
uses SMTP (smtplib), but swapping to SendGrid / AWS SES / Resend only
requires changing ``_send_sync`` — callers are unaffected.

Configuration (backend/.env):
    SMTP_HOST       e.g. smtp.gmail.com
    SMTP_PORT       e.g. 587  (STARTTLS) or 465 (SSL)
    SMTP_USER       SMTP login username / sender address
    SMTP_PASSWORD   App password or SMTP password
    SMTP_FROM       Optional display name + address,
                    e.g. "IBO Exchange <noreply@ibo.io>"
                    Falls back to SMTP_USER when not set.
    SMTP_SSL        Set to "true" for port-465 direct SSL; default STARTTLS.
"""

from __future__ import annotations

import asyncio
import logging
import os
import smtplib
import ssl
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from services.email_templates import EMAIL_LOGO_CID, load_email_logo_png_bytes

logger = logging.getLogger(__name__)


# ── Config helpers ────────────────────────────────────────────────────────────

def smtp_configured() -> bool:
    """Return True if the minimum SMTP env vars are present."""
    host = (os.getenv("SMTP_HOST") or "").strip()
    user = (os.getenv("SMTP_USER") or "").strip()
    return bool(host and user)


def _smtp_settings() -> dict:
    return {
        "host":     (os.getenv("SMTP_HOST") or "").strip(),
        "port":     int(os.getenv("SMTP_PORT") or "587"),
        "user":     (os.getenv("SMTP_USER") or "").strip(),
        "password": (os.getenv("SMTP_PASSWORD") or "").strip(),
        "from_":    (os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "").strip(),
        "use_ssl":  (os.getenv("SMTP_SSL") or "").strip().lower() in ("1", "true", "yes"),
    }


def _mask(email: str) -> str:
    e = (email or "").strip()
    if "@" not in e or len(e) < 5:
        return "***"
    local, _, domain = e.partition("@")
    if len(local) <= 2:
        return f"**@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


# ── Synchronous SMTP sender (runs in a thread) ────────────────────────────────

def _send_sync(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> None:
    """Build a multipart/alternative MIME message and deliver via SMTP.

    Raises RuntimeError if SMTP is not configured; raises any smtplib /
    socket exception on delivery failure (caller logs + suppresses).
    """
    cfg = _smtp_settings()
    if not cfg["host"] or not cfg["user"]:
        raise RuntimeError("SMTP is not configured (SMTP_HOST / SMTP_USER missing)")

    cid_ref = f"cid:{EMAIL_LOGO_CID}"
    logo_bytes = load_email_logo_png_bytes()
    use_inline_logo = bool(logo_bytes and cid_ref in html_body)

    if use_inline_logo:
        # Flat multipart/related (html + inline image only).
        # Nesting multipart/alternative inside related makes Gmail hide the body
        # behind "Show quoted text".
        msg = MIMEMultipart("related")
        msg.attach(MIMEText(html_body, "html", "utf-8"))
        img = MIMEImage(logo_bytes, _subtype="png")
        img.add_header("Content-ID", f"<{EMAIL_LOGO_CID}>")
        img.add_header("Content-Disposition", "inline", filename="ibo-logo.png")
        msg.attach(img)
    else:
        msg = MIMEMultipart("alternative")
        if text_body:
            msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

    msg["Subject"] = subject
    msg["From"]    = cfg["from_"] or cfg["user"]
    msg["To"]      = to_email
    msg["X-Mailer"] = "IBO-EmailService/1.0"
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "OOF, AutoReply"

    context = ssl.create_default_context()

    if cfg["use_ssl"]:
        # Direct SSL (port 465)
        with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=context, timeout=30) as server:
            server.login(cfg["user"], cfg["password"])
            server.send_message(msg)
    else:
        # STARTTLS (port 587, default)
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=30) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(cfg["user"], cfg["password"])
            server.send_message(msg)


# ── Public async API ──────────────────────────────────────────────────────────

async def send_email(
    to: str,
    subject: str,
    html_body: str,
    text_body: str = "",
    *,
    log_tag: Optional[str] = None,
) -> bool:
    """Send an email asynchronously. Returns True on success, False on failure.

    Never raises — all exceptions are caught and logged so callers don't
    need to wrap in try/except for the email path.

    Args:
        to:        Recipient address.
        subject:   Email subject line.
        html_body: Full HTML body (inline CSS, no external resources).
        text_body: Optional plain-text fallback (auto-generated if omitted).
        log_tag:   Short label for log lines, e.g. "signup_otp" or "welcome".
    """
    tag = log_tag or "email"

    if not smtp_configured():
        logger.warning(
            "%s: SMTP not configured — skipping email to %s",
            tag, _mask(to),
        )
        return False

    # Build a minimal plain-text fallback if caller didn't supply one
    if not text_body:
        import html as _html
        text_body = _html.unescape(
            html_body
            .replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
            .replace("</p>", "\n\n").replace("</div>", "\n")
        )
        # Strip remaining tags crudely
        import re as _re
        text_body = _re.sub(r"<[^>]+>", "", text_body).strip()

    try:
        await asyncio.to_thread(_send_sync, to, subject, html_body, text_body)
        logger.info("%s: email delivered to %s", tag, _mask(to))
        return True
    except RuntimeError as exc:
        logger.error("%s: SMTP not configured — %s", tag, exc)
        return False
    except Exception:  # noqa: BLE001
        logger.exception("%s: SMTP delivery failed for %s", tag, _mask(to))
        return False
