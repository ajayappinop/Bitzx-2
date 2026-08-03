"""Premium HTML email templates for IBO.

Every function returns a ``(subject, html, text)`` tuple.
All CSS is inline — required for broad email-client compatibility
(Gmail, Outlook, Apple Mail, mobile clients).

Brand palette:
    Background  #0a0b0d  (near-black)
    Card        #12141a
    Gold        #9C7941
    Gold-light  #EBD38D
    White       #ffffff
    Muted       #8a8f9e
"""

from __future__ import annotations

import base64
import os
from io import BytesIO
from pathlib import Path
from typing import Tuple

TemplateResult = Tuple[str, str, str]  # (subject, html, text)

_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
_DEFAULT_LOGO_FILE = _ASSETS_DIR / "ibo_token_logo.png"
_LOGO_SRC_CACHE: str | None = None
# Inline MIME attachment id — Gmail/Outlook block data: URIs; cid: works reliably.
EMAIL_LOGO_CID = "ibo-logo@ibo.io"


# ── Brand constants ───────────────────────────────────────────────────────────

SUPPORT_EMAIL = os.getenv("BRAND_SUPPORT_EMAIL") or "support@ibo.io"
BRAND_NAME    = os.getenv("BRAND_NAME") or "IBO Exchange"
FRONTEND_URL  = (os.getenv("FRONTEND_PUBLIC_URL") or "https://ibo.io").rstrip("/")


def _public_api_base() -> str:
    return (
        os.getenv("API_PUBLIC_URL")
        or os.getenv("BACKEND_PUBLIC_URL")
        or ""
    ).strip().rstrip("/")


def _normalize_public_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if u.startswith("http://api.ibo.io"):
        return "https://api.ibo.io" + u[len("http://api.ibo.io"):]
    return u


def load_email_logo_png_bytes() -> bytes | None:
    """PNG bytes for CID inline attachment in outgoing mail."""
    if not _DEFAULT_LOGO_FILE.is_file():
        return None
    try:
        raw = _DEFAULT_LOGO_FILE.read_bytes()
        try:
            from PIL import Image  # type: ignore

            with Image.open(_DEFAULT_LOGO_FILE) as im:
                im = im.convert("RGBA")
                im = im.resize((88, 88), Image.Resampling.LANCZOS)
                buf = BytesIO()
                im.save(buf, format="PNG", optimize=True)
                return buf.getvalue()
        except Exception:
            return raw
    except Exception:
        return None


def _build_embedded_logo_data_uri() -> str:
    """Inline PNG for email clients — relative / remote logo URLs often fail in inbox."""
    if not _DEFAULT_LOGO_FILE.is_file():
        return ""
    try:
        raw = _DEFAULT_LOGO_FILE.read_bytes()
        try:
            from PIL import Image  # type: ignore

            with Image.open(_DEFAULT_LOGO_FILE) as im:
                im = im.convert("RGBA")
                im = im.resize((88, 88), Image.Resampling.LANCZOS)
                buf = BytesIO()
                im.save(buf, format="PNG", optimize=True)
                raw = buf.getvalue()
        except Exception:
            pass
        b64 = base64.b64encode(raw).decode("ascii")
        return f"data:image/png;base64,{b64}"
    except Exception:
        return ""


def email_logo_src() -> str:
    """Logo ``src`` for HTML emails — CID inline attachment by default."""
    global _LOGO_SRC_CACHE
    if _LOGO_SRC_CACHE is not None:
        return _LOGO_SRC_CACHE

    embed_env = (os.getenv("EMAIL_LOGO_EMBED") or "true").strip().lower()
    prefer_embed = embed_env not in ("0", "false", "no")

    # CID attachment (see email_service) — works in Gmail, Outlook, Apple Mail.
    if prefer_embed and load_email_logo_png_bytes():
        _LOGO_SRC_CACHE = f"cid:{EMAIL_LOGO_CID}"
        return _LOGO_SRC_CACHE

    # Explicit email-only override (e.g. CDN-hosted logo).
    explicit = _normalize_public_url(os.getenv("EMAIL_LOGO_URL") or "")
    if explicit.startswith(("http://", "https://")) and "emergent" not in explicit:
        _LOGO_SRC_CACHE = explicit
        return _LOGO_SRC_CACHE

    override = _normalize_public_url(
        os.getenv("BRAND_LOGO_URL")
        or os.getenv("IBO_LOGO_URL")
        or ""
    )
    if override and ("emergentagent.com" in override or "emergent.sh" in override):
        override = ""

    if override.startswith(("http://", "https://")):
        _LOGO_SRC_CACHE = override
        return _LOGO_SRC_CACHE

    if override.startswith("/"):
        base = _normalize_public_url(_public_api_base())
        if base:
            _LOGO_SRC_CACHE = f"{base}{override}"
            return _LOGO_SRC_CACHE

    # Public static logo on the exchange site (if deployed).
    frontend_logo = f"{FRONTEND_URL}/ibo-logo.png"
    if FRONTEND_URL.startswith("https://"):
        _LOGO_SRC_CACHE = frontend_logo
        return _LOGO_SRC_CACHE

    base = _normalize_public_url(_public_api_base())
    if base:
        _LOGO_SRC_CACHE = f"{base}/api/token-logo"
        return _LOGO_SRC_CACHE

    embedded = _build_embedded_logo_data_uri()
    _LOGO_SRC_CACHE = embedded
    return _LOGO_SRC_CACHE


# ── Shared base layout ────────────────────────────────────────────────────────

def _base(content_html: str, preheader: str = "") -> str:
    """Wrap content in the shared email chrome (outer table, header, footer)."""
    logo_src = email_logo_src()
    logo_img = (
        f'<img src="{logo_src}" alt="{BRAND_NAME}" width="44" height="44" '
        'style="display:block;border-radius:10px;object-fit:contain;">'
        if logo_src
        else (
            '<span style="display:inline-block;width:44px;height:44px;line-height:44px;'
            'text-align:center;font-size:18px;font-weight:800;color:#EBD38D;'
            'background-color:rgba(156,121,65,0.2);border:1px solid rgba(235,211,141,0.35);'
            'border-radius:10px;">BX</span>'
        )
    )
    pre = f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{preheader}&nbsp;</div>' if preheader else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>{BRAND_NAME}</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#08090c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  {pre}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#08090c;min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;
                 border:1px solid #1e2028;background-color:#0d0f14;">

          <tr>
            <td style="background:linear-gradient(135deg,#1a1508 0%,#211a08 50%,#1a1508 100%);
                        border-bottom:1px solid #2a2210;padding:28px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    {logo_img}
                  </td>
                  <td style="padding-left:14px;vertical-align:middle;">
                    <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">IBO</span>
                    <br>
                    <span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9C7941;">Exchange</span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block;font-size:11px;font-weight:700;
                                 letter-spacing:1.5px;text-transform:uppercase;
                                 color:#EBD38D;background-color:rgba(156,121,65,0.15);
                                 border:1px solid rgba(235,211,141,0.25);
                                 padding:5px 12px;border-radius:20px;">Official</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:40px 40px 32px;">
              {content_html}
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#9C7941,transparent);"></div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 32px;background-color:#0a0b0d;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align:center;">
                    <p style="margin:0 0 8px;font-size:12px;color:#555b6e;">
                      This email was sent by {BRAND_NAME}.
                    </p>
                    <p style="margin:0 0 8px;font-size:12px;color:#555b6e;">
                      Questions? <a href="mailto:{SUPPORT_EMAIL}"
                        style="color:#9C7941;text-decoration:none;">{SUPPORT_EMAIL}</a>
                    </p>
                    <p style="margin:0;font-size:11px;color:#3d4152;">
                      &copy; 2025 {BRAND_NAME}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>"""


def _btn(text: str, url: str, color: str = "#9C7941") -> str:
    """Gold CTA button, works in all email clients."""
    return f"""
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr>
        <td align="center"
          style="background:linear-gradient(135deg,{color},{color}cc);
                 border-radius:12px;padding:1px;">
          <a href="{url}" target="_blank"
            style="display:inline-block;padding:14px 36px;
                   background:linear-gradient(135deg,{color},{color}cc);
                   border-radius:11px;font-size:15px;font-weight:700;
                   letter-spacing:0.3px;color:#0a0b0d;text-decoration:none;
                   white-space:nowrap;">{text}</a>
        </td>
      </tr>
    </table>"""


def _security_note(text: str) -> str:
    return f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin-top:24px;background-color:rgba(156,121,65,0.06);
             border:1px solid rgba(156,121,65,0.18);border-radius:10px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0;font-size:12px;color:#9C7941;line-height:1.6;">
            🔒 {text}
          </p>
        </td>
      </tr>
    </table>"""


# ── OTP Verification Email ────────────────────────────────────────────────────

def otp_email(name: str, otp: str, expires_minutes: int = 15) -> TemplateResult:
    """Signup email OTP — clean, trustworthy, easy to read on any device."""
    subject = f"{otp} is your IBO verification code"
    first   = (name or "").strip().split()[0] if name.strip() else "there"

    # Split OTP into individual digit boxes for visual clarity
    digit_boxes = "".join(
        f'<td style="padding:0 4px;">'
        f'<span style="display:inline-block;width:44px;height:56px;'
        f'line-height:56px;text-align:center;font-size:28px;font-weight:800;'
        f'color:#EBD38D;background-color:#12141a;border:1.5px solid #2a2828;'
        f'border-radius:10px;letter-spacing:0;">{d}</span>'
        f'</td>'
        for d in otp
    )

    body = f"""
    <!-- Greeting -->
    <p style="margin:0 0 8px;font-size:14px;color:#8a8f9e;font-weight:500;">
      Hi {first},
    </p>
    <h1 style="margin:0 0 20px;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">
      Verify your email address
    </h1>
    <p style="margin:0 0 28px;font-size:15px;color:#b0b5c0;line-height:1.6;">
      Enter the 6-digit code below to complete your <strong style="color:#ffffff;">IBO</strong>
      account registration. The code expires in&nbsp;<strong style="color:#EBD38D;">{expires_minutes} minutes</strong>.
    </p>

    <!-- OTP Digit boxes -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
      style="margin:0 auto 28px;">
      <tr>{digit_boxes}</tr>
    </table>

    <!-- Expiry pill -->
    <p style="text-align:center;margin:0 0 28px;">
      <span style="display:inline-block;font-size:12px;font-weight:700;
                   color:#EBD38D;background-color:rgba(235,211,141,0.1);
                   border:1px solid rgba(235,211,141,0.25);
                   padding:5px 14px;border-radius:20px;letter-spacing:0.5px;">
        ⏱ Expires in {expires_minutes} minutes
      </span>
    </p>

    <!-- Divider -->
    <div style="height:1px;background-color:#1e2028;margin:0 0 24px;"></div>

    {_security_note(
        "This code was requested for a new IBO account registration. "
        "If you did not sign up, you can safely ignore this email — "
        "no account will be created without this code."
    )}

    <!-- Anti-phishing note -->
    <p style="margin:20px 0 0;font-size:12px;color:#555b6e;line-height:1.6;">
      For your security, IBO will never ask for this code via phone, chat, or any other channel.
      Only enter it on the official IBO website.
    </p>"""

    text = (
        f"Hi {first},\n\n"
        f"Your IBO email verification code is: {otp}\n\n"
        f"This code expires in {expires_minutes} minutes.\n\n"
        f"If you did not sign up for IBO, please ignore this email.\n\n"
        f"— {BRAND_NAME}"
    )

    return subject, _base(body, preheader=f"Your IBO verification code: {otp} (expires in {expires_minutes} min)"), text


# ── Welcome Email ─────────────────────────────────────────────────────────────

def welcome_email(name: str) -> TemplateResult:
    """Sent immediately after successful email verification + account creation."""
    subject = f"Welcome to IBO, {(name or '').strip().split()[0] or 'Trader'}! Your account is ready."
    first   = (name or "").strip().split()[0] if name.strip() else "Trader"

    features = [
        ("📈", "Professional Charts", "Full TradingView integration with 100+ indicators"),
        ("⚡", "Instant Demo Balance", "$5,000 USDT demo balance — start trading now"),
        ("🔄", "100+ Trading Pairs", "Spot, Futures & Options on all major pairs"),
        ("🛡", "Secure by Default", "2FA, Anti-phishing codes & KYC verification"),
        ("🤝", "P2P Trading", "Buy and sell directly with other traders"),
    ]

    feature_rows = ""
    for icon, title, desc in features:
        feature_rows += f"""
        <tr>
          <td style="padding:10px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="width:44px;vertical-align:top;padding-top:1px;">
                  <span style="display:inline-block;width:36px;height:36px;
                               line-height:36px;text-align:center;font-size:18px;
                               background-color:rgba(156,121,65,0.1);
                               border:1px solid rgba(156,121,65,0.2);
                               border-radius:9px;">{icon}</span>
                </td>
                <td style="padding-left:14px;vertical-align:top;">
                  <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#ffffff;">{title}</p>
                  <p style="margin:0;font-size:13px;color:#8a8f9e;">{desc}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>"""

    body = f"""
    <!-- Hero -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;width:68px;height:68px;
                  line-height:68px;border-radius:50%;font-size:30px;
                  background:linear-gradient(135deg,rgba(156,121,65,0.2),rgba(235,211,141,0.1));
                  border:1.5px solid rgba(235,211,141,0.3);
                  margin-bottom:18px;">✅</div>
      <h1 style="margin:0 0 10px;font-size:28px;font-weight:800;color:#ffffff;line-height:1.2;">
        Welcome to <span style="color:#EBD38D;">IBO</span>, {first}!
      </h1>
      <p style="margin:0;font-size:15px;color:#8a8f9e;max-width:400px;margin:0 auto;line-height:1.6;">
        Your account is verified and ready. Start your trading journey today.
      </p>
    </div>

    <!-- Gold divider -->
    <div style="height:2px;background:linear-gradient(90deg,transparent,#9C7941 30%,#EBD38D 50%,#9C7941 70%,transparent);
                border-radius:2px;margin:0 0 32px;"></div>

    <!-- Features -->
    <p style="margin:0 0 16px;font-size:12px;font-weight:700;letter-spacing:1.5px;
               text-transform:uppercase;color:#555b6e;">What's waiting for you</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      {feature_rows}
    </table>

    <!-- CTA -->
    <div style="margin:36px 0 8px;text-align:center;">
      {_btn("Start Trading Now", f"{FRONTEND_URL}/markets")}
    </div>

    <!-- Steps hint -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin-top:32px;background-color:#12141a;border:1px solid #1e2028;border-radius:12px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:1.5px;
                     text-transform:uppercase;color:#555b6e;">Quick start — 3 steps</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="padding:6px 0;">
                <span style="color:#9C7941;font-weight:700;font-size:13px;">1 &nbsp;</span>
                <span style="color:#b0b5c0;font-size:13px;">Complete KYC for full trading access</span>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;">
                <span style="color:#9C7941;font-weight:700;font-size:13px;">2 &nbsp;</span>
                <span style="color:#b0b5c0;font-size:13px;">Enable 2FA in Security &amp; Settings</span>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;">
                <span style="color:#9C7941;font-weight:700;font-size:13px;">3 &nbsp;</span>
                <span style="color:#b0b5c0;font-size:13px;">Explore markets and place your first trade</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    {_security_note(
        "Keep your account safe: enable Two-Factor Authentication (2FA) and "
        "set an anti-phishing code in Security &amp; Settings."
    )}"""

    text = (
        f"Welcome to IBO, {first}!\n\n"
        f"Your account has been verified and is ready to use.\n\n"
        f"Get started:\n"
        f"  1. Complete KYC for full trading access\n"
        f"  2. Enable 2FA in Security & Settings\n"
        f"  3. Explore markets: {FRONTEND_URL}/markets\n\n"
        f"Questions? Email us at {SUPPORT_EMAIL}\n\n"
        f"— {BRAND_NAME}"
    )

    return subject, _base(body, preheader=f"Your IBO account is ready — welcome aboard, {first}!"), text


# ── Password Reset Email ──────────────────────────────────────────────────────

def password_reset_email(name: str, reset_link: str, expires_hours: int = 24) -> TemplateResult:
    """Transactional password reset email (replaces plain-text version)."""
    subject = "Reset your IBO password"
    first   = (name or "").strip().split()[0] if name.strip() else "there"

    body = f"""
    <!-- Icon -->
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;width:64px;height:64px;
                  line-height:64px;border-radius:50%;font-size:28px;
                  background:rgba(156,121,65,0.1);
                  border:1.5px solid rgba(156,121,65,0.3);
                  margin-bottom:16px;">🔑</div>
      <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">
        Reset your password
      </h1>
      <p style="margin:0;font-size:15px;color:#8a8f9e;">
        Hi {first} — we received a request to reset your IBO account password.
      </p>
    </div>

    <!-- Divider -->
    <div style="height:1px;background-color:#1e2028;margin:0 0 28px;"></div>

    <p style="margin:0 0 28px;font-size:15px;color:#b0b5c0;line-height:1.6;text-align:center;">
      Click the button below to set a new password.
      This link is valid for <strong style="color:#EBD38D;">{expires_hours} hours</strong>.
    </p>

    <!-- CTA -->
    <div style="text-align:center;margin:0 0 28px;">
      {_btn("Reset My Password", reset_link)}
    </div>

    <!-- Fallback link -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background-color:#12141a;border:1px solid #1e2028;border-radius:10px;margin-bottom:24px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0 0 6px;font-size:12px;color:#555b6e;">Or copy this link into your browser:</p>
          <p style="margin:0;font-size:11px;color:#9C7941;word-break:break-all;">{reset_link}</p>
        </td>
      </tr>
    </table>

    {_security_note(
        "If you did not request a password reset, you can safely ignore this email. "
        "Your password will not change unless you use the link above."
    )}"""

    text = (
        f"Hi {first},\n\n"
        f"We received a request to reset your IBO password.\n\n"
        f"Reset link (valid {expires_hours}h):\n{reset_link}\n\n"
        f"If you did not request this, please ignore this email.\n\n"
        f"— {BRAND_NAME}"
    )

    return subject, _base(body, preheader="Reset your IBO password — link valid 24 hours"), text


def inr_deposit_submitted(
    name: str,
    amount_inr: float,
    request_id: str,
    *,
    utr: str = "",
    payment_method_label: str = "",
) -> TemplateResult:
    """Confirm an INR deposit request was received and is pending review."""
    first = (name or "Trader").split()[0]
    subject = f"INR deposit request received — ₹{amount_inr:,.2f}"
    utr_line = (
        f'<p style="margin:12px 0 0;font-size:12px;color:#555b6e;">UTR / Ref: {utr}</p>'
        if utr
        else ""
    )
    method_line = (
        f'<p style="margin:8px 0 0;font-size:13px;color:#8a8f9e;">Method: {payment_method_label}</p>'
        if payment_method_label
        else ""
    )
    body = f"""
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ffffff;">Deposit request received</p>
      <p style="margin:0;font-size:15px;color:#8a8f9e;">
        Hi {first} — we received your INR deposit request. Our team will review it shortly.
      </p>
    </div>
    <div style="height:1px;background-color:#1e2028;margin:0 0 24px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background-color:#12141a;border:1px solid #1e2028;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#8a8f9e;">Amount (INR)</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#EBD38D;">₹{amount_inr:,.2f}</p>
        {method_line}
        {utr_line}
        <p style="margin:16px 0 0;font-size:12px;color:#555b6e;">Request ID: {request_id}</p>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:14px;color:#8a8f9e;line-height:1.6;">
      You will receive another email when your deposit is approved or if we need more information.
    </p>
    {_btn("View wallet", f"{FRONTEND_URL}/wallet")}
    """
    text = (
        f"Hi {first},\n\n"
        f"We received your INR deposit request for ₹{amount_inr:,.2f}.\n"
        f"Request ID: {request_id}\n"
        + (f"UTR / Ref: {utr}\n" if utr else "")
        + (f"Method: {payment_method_label}\n" if payment_method_label else "")
        + "\nOur team will review it shortly. You will receive another email when it is approved.\n\n"
        f"— {BRAND_NAME}"
    )
    return subject, _base(body, preheader="Your INR deposit request is under review"), text


def inr_withdrawal_submitted(
    name: str,
    amount_inr: float,
    amount_ibo: float,
    request_id: str,
) -> TemplateResult:
    """Confirm an INR sell / payout request was received and is pending review."""
    first = (name or "Trader").split()[0]
    subject = f"INR payout request received — ₹{amount_inr:,.2f}"
    ibo_line = (
        f'<p style="margin:12px 0 0;font-size:13px;color:#8a8f9e;">IBO reserved for payout</p>'
        f'<p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#fbbf24;">{amount_ibo:.8f} IBO</p>'
        if amount_ibo > 0
        else ""
    )
    body = f"""
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ffffff;">Payout request received</p>
      <p style="margin:0;font-size:15px;color:#8a8f9e;">
        Hi {first} — we received your request to sell IBO and receive INR. It is now under review.
      </p>
    </div>
    <div style="height:1px;background-color:#1e2028;margin:0 0 24px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background-color:#12141a;border:1px solid #1e2028;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#8a8f9e;">Amount (INR)</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#EBD38D;">₹{amount_inr:,.2f}</p>
        {ibo_line}
        <p style="margin:16px 0 0;font-size:12px;color:#555b6e;">Request ID: {request_id}</p>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:14px;color:#8a8f9e;line-height:1.6;">
      You will receive another email when your payout is sent or if the request cannot be processed.
    </p>
    {_btn("View wallet", f"{FRONTEND_URL}/wallet?tab=history&inr=withdraw")}
    """
    text = (
        f"Hi {first},\n\n"
        f"We received your INR payout request for ₹{amount_inr:,.2f}.\n"
        f"Request ID: {request_id}\n"
        + (f"IBO reserved: {amount_ibo:.8f}\n" if amount_ibo > 0 else "")
        + "\nOur team will review it shortly. You will receive another email when it is approved or declined.\n\n"
        f"— {BRAND_NAME}"
    )
    return subject, _base(body, preheader="Your INR payout request is under review"), text


def inr_deposit_approved(
    name: str,
    amount_inr: float,
    amount_ibo: float,
    utr: str,
) -> TemplateResult:
    """Notify user that an INR deposit was approved and IBO was credited."""
    first = (name or "Trader").split()[0]
    subject = f"INR deposit approved — {amount_ibo:.4f} IBO credited"
    body = f"""
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ffffff;">Deposit approved</p>
      <p style="margin:0;font-size:15px;color:#8a8f9e;">
        Hi {first} — your INR deposit has been reviewed and approved.
      </p>
    </div>
    <div style="height:1px;background-color:#1e2028;margin:0 0 24px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background-color:#12141a;border:1px solid #1e2028;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#8a8f9e;">Amount (INR)</p>
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#EBD38D;">₹{amount_inr:,.2f}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#8a8f9e;">IBO credited</p>
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#4ade80;">{amount_ibo:.8f} IBO</p>
        <p style="margin:0;font-size:12px;color:#555b6e;">UTR / Ref: {utr or "—"}</p>
      </td></tr>
    </table>
    {_btn("View wallet", f"{FRONTEND_URL}/wallet")}
    """
    text = (
        f"Hi {first},\n\n"
        f"Your INR deposit of ₹{amount_inr:,.2f} was approved.\n"
        f"{amount_ibo:.8f} IBO has been credited to your wallet.\n"
        f"UTR: {utr or '—'}\n\n"
        f"— {BRAND_NAME}"
    )
    return subject, _base(body, preheader="Your INR deposit was approved"), text


def inr_deposit_rejected(
    name: str,
    amount_inr: float,
    reason: str,
) -> TemplateResult:
    """Notify user that an INR deposit was rejected."""
    first = (name or "Trader").split()[0]
    subject = "INR deposit could not be approved"
    body = f"""
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ffffff;">Deposit not approved</p>
      <p style="margin:0;font-size:15px;color:#8a8f9e;">
        Hi {first} — we could not approve your INR deposit request of ₹{amount_inr:,.2f}.
      </p>
    </div>
    <div style="height:1px;background-color:#1e2028;margin:0 0 24px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background-color:#12141a;border:1px solid #1e2028;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#8a8f9e;">Reason</p>
        <p style="margin:0;font-size:15px;color:#fca5a5;line-height:1.5;">{reason}</p>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;color:#8a8f9e;line-height:1.6;">
      If you believe this is an error, contact <a href="mailto:{SUPPORT_EMAIL}" style="color:#9C7941;">{SUPPORT_EMAIL}</a>.
    </p>
    """
    text = (
        f"Hi {first},\n\n"
        f"Your INR deposit of ₹{amount_inr:,.2f} was not approved.\n"
        f"Reason: {reason}\n\n"
        f"Contact {SUPPORT_EMAIL} if you need help.\n\n"
        f"— {BRAND_NAME}"
    )
    return subject, _base(body, preheader="Your INR deposit was not approved"), text


def inr_withdrawal_approved(
    name: str,
    amount_inr: float,
    payout_reference: str,
) -> TemplateResult:
    """Notify user that an INR withdrawal was approved and sent."""
    first = (name or "Trader").split()[0]
    subject = f"INR withdrawal approved — ₹{amount_inr:,.2f}"
    ref_line = payout_reference or "—"
    body = f"""
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ffffff;">Withdrawal sent</p>
      <p style="margin:0;font-size:15px;color:#8a8f9e;">
        Hi {first} — your INR withdrawal has been processed.
      </p>
    </div>
    <div style="height:1px;background-color:#1e2028;margin:0 0 24px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background-color:#12141a;border:1px solid #1e2028;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#8a8f9e;">Amount (INR)</p>
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#EBD38D;">₹{amount_inr:,.2f}</p>
        <p style="margin:0;font-size:12px;color:#555b6e;">Payout reference: {ref_line}</p>
      </td></tr>
    </table>
    {_btn("View wallet", f"{FRONTEND_URL}/wallet")}
    """
    text = (
        f"Hi {first},\n\n"
        f"Your INR withdrawal of ₹{amount_inr:,.2f} was approved and sent.\n"
        f"Payout reference: {ref_line}\n\n"
        f"— {BRAND_NAME}"
    )
    return subject, _base(body, preheader="Your INR withdrawal was approved"), text


def inr_withdrawal_rejected(
    name: str,
    amount_inr: float,
    reason: str,
) -> TemplateResult:
    """Notify user that an INR withdrawal was rejected (IBO unlocked)."""
    first = (name or "Trader").split()[0]
    subject = "INR withdrawal could not be processed"
    body = f"""
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ffffff;">Withdrawal declined</p>
      <p style="margin:0;font-size:15px;color:#8a8f9e;">
        Hi {first} — we could not process your INR withdrawal of ₹{amount_inr:,.2f}.
        Your reserved IBO balance has been returned.
      </p>
    </div>
    <div style="height:1px;background-color:#1e2028;margin:0 0 24px;"></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background-color:#12141a;border:1px solid #1e2028;border-radius:10px;margin-bottom:24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#8a8f9e;">Reason</p>
        <p style="margin:0;font-size:15px;color:#fca5a5;line-height:1.5;">{reason}</p>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;color:#8a8f9e;line-height:1.6;">
      Contact <a href="mailto:{SUPPORT_EMAIL}" style="color:#9C7941;">{SUPPORT_EMAIL}</a> if you need help.
    </p>
    """
    text = (
        f"Hi {first},\n\n"
        f"Your INR withdrawal of ₹{amount_inr:,.2f} was not approved.\n"
        f"Reason: {reason}\n"
        f"Your IBO balance has been unlocked.\n\n"
        f"— {BRAND_NAME}"
    )
    return subject, _base(body, preheader="Your INR withdrawal was declined"), text
