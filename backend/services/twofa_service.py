"""Phase 7a — TOTP (RFC 6238) + backup-code primitives.

Kept intentionally small. ``server.py`` handles HTTP / persistence; this
module handles the cryptographic primitives so they can be unit-tested in
isolation and reused by future services (e.g. admin 2FA, API-key auth).

Design notes:

- ``secret_b32`` is a base32-encoded TOTP seed (160 bits of entropy by
  default, same as Google Authenticator). Stored as-is in Mongo; at this
  layer the DB is the trust boundary. Production deployments should wrap
  the ``user_2fa`` collection with a KMS / sealed-box envelope.
- Verification is **time-skew tolerant** (``valid_window=1`` → ±30 s).
  Anything wider exposes unnecessary replay windows.
- Backup codes are formatted as ``XXXXX-XXXXX`` (10 alphanumeric chars +
  separator). Stored hashed (bcrypt) alongside an optional ``used_at``.
- All helpers are pure and synchronous — no I/O.
"""

from __future__ import annotations

import logging
import secrets
import string
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple
from urllib.parse import quote

import bcrypt
import pyotp

logger = logging.getLogger(__name__)

# Backup-code shape. Fixed format so frontend display / clipboard is
# consistent; do NOT tune these per deployment without rotating everyone.
BACKUP_CODE_GROUP_LEN = 5
BACKUP_CODE_COUNT     = 10
# We avoid visually ambiguous characters (0/O, 1/I/L) so users hand-typing
# from a printout don't fight character recognition.
_BACKUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

# TOTP knobs. Rotating these without a migration breaks existing enrollments.
TOTP_DIGITS   = 6
TOTP_INTERVAL = 30  # seconds
TOTP_VALID_WINDOW = 1  # ±30 s clock skew tolerance


# ── Secret generation / URI ─────────────────────────────────────────────────

def new_secret_b32() -> str:
    """Return a fresh 160-bit TOTP secret (base32-encoded, 32 chars)."""
    return pyotp.random_base32()


def otpauth_url(
    *,
    secret_b32: str,
    account_label: str,
    issuer: str,
) -> str:
    """Build a standard ``otpauth://`` URI the frontend can turn into a QR.

    ``account_label`` is typically the user's email. Both label and issuer
    are URL-encoded per RFC 6238 / KeyUri spec so unusual characters
    (``+``, spaces, etc.) don't break scanners.
    """
    issuer = (issuer or "").strip() or "IBO"
    label = f"{issuer}:{account_label}"
    return (
        f"otpauth://totp/{quote(label, safe='')}"
        f"?secret={secret_b32}"
        f"&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1"
        f"&digits={TOTP_DIGITS}"
        f"&period={TOTP_INTERVAL}"
    )


# ── Verification ────────────────────────────────────────────────────────────

def verify_totp(secret_b32: str, code: str) -> bool:
    """Return True if ``code`` is a valid TOTP for ``secret_b32`` right now.

    Tolerates ±30 s of clock skew (one step on either side). Normalises
    user input (strips spaces, keeps digits only) so e.g. "123 456" works.
    Never raises — a malformed code just returns False.
    """
    if not secret_b32 or not code:
        return False
    digits = "".join(ch for ch in str(code) if ch.isdigit())
    if len(digits) != TOTP_DIGITS:
        return False
    try:
        totp = pyotp.TOTP(secret_b32, digits=TOTP_DIGITS, interval=TOTP_INTERVAL)
        return bool(totp.verify(digits, valid_window=TOTP_VALID_WINDOW))
    except Exception:  # noqa: BLE001
        logger.exception("twofa_service.verify_totp failed")
        return False


# ── Backup codes ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class BackupCode:
    """A generated backup code pair — plaintext for the user, hash for DB."""
    plaintext: str
    hash: str


def _format_backup_code() -> str:
    """Generate one formatted code (``XXXXX-XXXXX`` uppercase)."""
    groups = []
    for _ in range(2):
        buf = "".join(
            secrets.choice(_BACKUP_ALPHABET) for _ in range(BACKUP_CODE_GROUP_LEN)
        )
        groups.append(buf)
    return "-".join(groups)


def generate_backup_codes(count: int = BACKUP_CODE_COUNT) -> List[BackupCode]:
    """Generate a batch of plaintext + hashed backup codes.

    Plaintexts are returned to the caller so the frontend can show them
    once; hashes go into Mongo. Bcrypt with default cost matches how we
    store user passwords, which is fine for single-use recovery codes.
    """
    out: List[BackupCode] = []
    for _ in range(max(1, int(count))):
        plain = _format_backup_code()
        h = bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        out.append(BackupCode(plaintext=plain, hash=h))
    return out


def normalise_backup_code(raw: str) -> str:
    """Canonicalise user input.

    Users may paste "abcde-fghij" or "abcde fghij" or without the dash.
    We uppercase, drop everything outside the alphabet, then re-insert the
    dash. Mismatched lengths simply fail verification downstream.
    """
    s = (raw or "").upper()
    keep = "".join(ch for ch in s if ch in _BACKUP_ALPHABET)
    total_len = BACKUP_CODE_GROUP_LEN * 2
    if len(keep) != total_len:
        return keep  # let verify fail cleanly
    return f"{keep[:BACKUP_CODE_GROUP_LEN]}-{keep[BACKUP_CODE_GROUP_LEN:]}"


def match_backup_code(
    candidate: str,
    stored: Iterable[dict],
) -> Tuple[Optional[int], Optional[dict]]:
    """Find which stored row (if any) matches ``candidate``.

    ``stored`` is the ``backup_codes`` array from ``user_2fa`` — each row
    has ``{hash, used_at}``. Returns ``(index, row)`` for the first match
    that has NOT been used, or ``(None, None)``. The caller is responsible
    for marking the row ``used_at`` atomically.
    """
    norm = normalise_backup_code(candidate)
    if not norm:
        return None, None
    enc = norm.encode("utf-8")
    for idx, row in enumerate(stored):
        if not isinstance(row, dict):
            continue
        if row.get("used_at"):
            continue
        h = (row.get("hash") or "").encode("utf-8")
        if not h:
            continue
        try:
            if bcrypt.checkpw(enc, h):
                return idx, row
        except Exception:  # noqa: BLE001
            continue
    return None, None
