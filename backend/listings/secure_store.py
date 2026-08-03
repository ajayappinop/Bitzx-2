"""Optional Fernet encryption for contract addresses at rest."""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from typing import Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)


def _fernet() -> Optional[Fernet]:
    raw = (os.getenv("LISTINGS_CONFIG_ENCRYPTION_KEY") or "").strip()
    if not raw:
        seed = (
            os.getenv("JWT_SECRET_KEY")
            or os.getenv("LISTINGS_CONFIG_ENCRYPTION_SEED")
            or ""
        ).strip()
        if not seed:
            return None
        digest = hashlib.sha256(seed.encode("utf-8")).digest()
        raw = base64.urlsafe_b64encode(digest).decode("ascii")
    try:
        return Fernet(raw.encode("ascii") if len(raw) == 44 else raw)
    except Exception:  # noqa: BLE001
        logger.warning("listings: invalid LISTINGS_CONFIG_ENCRYPTION_KEY — storing plaintext")
        return None


def encrypt_contract(plaintext: str) -> Tuple[str, bool]:
    f = _fernet()
    if not f or not plaintext:
        return plaintext, False
    try:
        return f.encrypt(plaintext.encode("utf-8")).decode("ascii"), True
    except Exception:  # noqa: BLE001
        logger.exception("listings: encrypt failed")
        return plaintext, False


def decrypt_contract(stored: str, *, encrypted: bool = False) -> str:
    if not stored:
        return ""
    if not encrypted:
        return stored
    f = _fernet()
    if not f:
        return stored
    try:
        return f.decrypt(stored.encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning("listings: could not decrypt contract — returning stored value")
        return stored
    except Exception:  # noqa: BLE001
        logger.exception("listings: decrypt failed")
        return stored
