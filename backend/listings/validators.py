"""Input validation for token listings."""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

from fastapi import HTTPException

_ETH_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_BTC_RE = re.compile(r"^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$")
_TRON_RE = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")
_SOL_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
_SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,12}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _norm_url(raw: Optional[str], *, required: bool = False) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        if required:
            raise HTTPException(status_code=400, detail="URL is required")
        return None
    if not s.startswith(("http://", "https://")):
        s = f"https://{s}"
    parsed = urlparse(s)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid URL")
    return s[:512]


def normalize_symbol(sym: str) -> str:
    s = (sym or "").strip().upper()
    if not _SYMBOL_RE.match(s):
        raise HTTPException(
            status_code=400,
            detail="Token symbol must be 2–12 uppercase letters or digits",
        )
    return s


def validate_contract_address(network: str, address: str) -> str:
    net = (network or "").strip()
    addr = (address or "").strip()
    if not addr:
        raise HTTPException(status_code=400, detail="Contract address is required")
    if net == "Bitcoin Network":
        if not _BTC_RE.match(addr):
            raise HTTPException(status_code=400, detail="Invalid Bitcoin address format")
        return addr
    if net == "TRC-20 (Tron)":
        if not _TRON_RE.match(addr):
            raise HTTPException(status_code=400, detail="Invalid Tron address format")
        return addr
    if net == "Solana":
        if not _SOL_RE.match(addr):
            raise HTTPException(status_code=400, detail="Invalid Solana address format")
        return addr
    if net in ("ERC-20 (Ethereum)", "BEP-20 (BNB Chain)"):
        if not _ETH_RE.match(addr):
            raise HTTPException(status_code=400, detail="Invalid EVM contract address (0x + 40 hex)")
        return addr.lower()
    raise HTTPException(status_code=400, detail=f"Unsupported network: {net}")


def validate_listing_payload(
    *,
    project_name: str,
    token_name: str,
    token_symbol: str,
    blockchain_network: str,
    contract_address: str,
    dex_swap_link: str,
    official_website: str,
    twitter_link: Optional[str],
    telegram_link: Optional[str],
    contact_email: str,
    description: str,
) -> dict:
    pn = (project_name or "").strip()
    tn = (token_name or "").strip()
    sym = normalize_symbol(token_symbol)
    net = (blockchain_network or "").strip()
    if net not in (
        "Bitcoin Network",
        "ERC-20 (Ethereum)",
        "BEP-20 (BNB Chain)",
        "TRC-20 (Tron)",
        "Solana",
    ):
        raise HTTPException(status_code=400, detail="Invalid blockchain network")
    if len(pn) < 2 or len(pn) > 120:
        raise HTTPException(status_code=400, detail="Project name must be 2–120 characters")
    if len(tn) < 2 or len(tn) > 80:
        raise HTTPException(status_code=400, detail="Token name must be 2–80 characters")
    email = (contact_email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid contact email")
    desc = (description or "").strip()
    if len(desc) < 20 or len(desc) > 2000:
        raise HTTPException(status_code=400, detail="Description must be 20–2000 characters")
    contract = validate_contract_address(net, contract_address)
    return {
        "project_name": pn,
        "token_name": tn,
        "token_symbol": sym,
        "blockchain_network": net,
        "contract_address": contract,
        "contract_address_display": contract,
        "dex_swap_link": _norm_url(dex_swap_link, required=True),
        "official_website": _norm_url(official_website, required=True),
        "twitter_link": _norm_url(twitter_link),
        "telegram_link": _norm_url(telegram_link),
        "contact_email": email[:254],
        "description": desc,
    }
