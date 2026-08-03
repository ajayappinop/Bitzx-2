"""Public project metadata for token site, explorers, and BscScan submissions."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List


def _s(key: str, default: str = "") -> str:
    return (os.getenv(key) or default).strip()


def _team_from_env() -> List[Dict[str, str]]:
    raw = _s("IBO_TEAM_JSON")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [
                    {
                        "name": str(m.get("name", "")).strip(),
                        "role": str(m.get("role", "")).strip(),
                        "bio": str(m.get("bio", "")).strip(),
                        "linkedin": str(m.get("linkedin", "")).strip(),
                    }
                    for m in parsed
                    if m.get("name")
                ]
        except json.JSONDecodeError:
            pass

    name = _s("IBO_TEAM_DIRECTOR_NAME")
    if not name:
        return []

    return [
        {
            "name": name,
            "role": _s("IBO_TEAM_DIRECTOR_ROLE", "Director"),
            "bio": _s("IBO_TEAM_DIRECTOR_BIO"),
            "linkedin": _s("IBO_TEAM_DIRECTOR_LINKEDIN"),
        }
    ]


def get_public_site_config() -> Dict[str, Any]:
    contract = _s(
        "IBO_CONTRACT_ADDRESS",
        "0x7962f32a587c49ad4235ddc5982a0ae1945a2c01",
    ).lower()
    website = _s("IBO_OFFICIAL_WEBSITE", "https://ibo.io")
    logo = _s("IBO_LOGO_URL", "").strip()
    if not logo or "emergentagent.com" in logo or "emergent.sh" in logo:
        logo = "/api/token-logo"
    email = _s("IBO_CONTACT_EMAIL", "admin@ibo.io")
    dex = _s("IBO_DEX_SWAP_LINK") or (
        f"https://pancakeswap.finance/swap?outputCurrency={contract}"
        if contract.startswith("0x")
        else ""
    )

    return {
        "project_name": _s("IBO_PROJECT_NAME", "IBO"),
        "token_name": _s("IBO_TOKEN_NAME", "IBO"),
        "token_symbol": _s("IBO_TOKEN_SYMBOL", "IBO"),
        "contract_address": contract,
        "network_label": _s("IBO_BLOCKCHAIN_NETWORK", "BNB Smart Chain (BEP-20)"),
        "official_website": website.rstrip("/") + "/" if website else "",
        "support_email": email,
        "short_description": _s(
            "IBO_DESCRIPTION",
            "IBO is a BNB Chain utility token focused on accessible crypto trading "
            "infrastructure and a broader token ecosystem.",
        ),
        "logo_url": logo,
        "brand_logo_url": _s("BRAND_LOGO_URL", logo),
        "buy_url": dex,
        "bscscan_url": (
            f"https://bscscan.com/token/{contract}" if contract.startswith("0x") else ""
        ),
        "whitepaper_path": "/whitepaper",
        "community": {
            "telegram": _s("IBO_TELEGRAM", "https://t.me/iboofficial"),
            "twitter": _s("IBO_TWITTER", "https://x.com/iboofficial"),
            "discord": _s("IBO_DISCORD", ""),
        },
        "exchange": {
            "status_label": _s("IBO_EXCHANGE_STATUS", "Live now"),
            "launch_window": _s("IBO_EXCHANGE_LAUNCH_WINDOW", "2026"),
            "url_display": _s("IBO_EXCHANGE_URL_DISPLAY", "exchange.ibo.io"),
            "official_url": _s("IBO_EXCHANGE_URL", "https://exchange.ibo.io"),
            "summary": _s(
                "IBO_EXCHANGE_SUMMARY",
                "IBO Exchange is live at exchange.ibo.io — spot trading, professional "
                "charts, INR deposits and payouts for Indian users, and IBO utility across "
                "the platform.",
            ),
        },
        "organization": {
            "legal_entity_name": _s("IBO_LEGAL_ENTITY_NAME", "Ibo Private Limited"),
            "registration_country": _s("IBO_REGISTRATION_COUNTRY", "India"),
            "headquarters": _s("IBO_HEADQUARTERS", "Surat, Gujarat, India"),
        },
        "team": _team_from_env(),
        "signup": _signup_from_env(),
    }


def _signup_from_env() -> Dict[str, Any]:
    """Non-secret signup UI hints (AuthKey dial code, SMS availability)."""
    cc = "".join(ch for ch in _s("AUTHKEY_SMS_COUNTRY_CODE") if ch.isdigit())
    sms_on = _s("AUTHKEY_SMS_ENABLED").lower() in ("1", "true", "yes", "on")
    has_key = bool(_s("AUTHKEY_API_KEY") or _s("AUTHKEY_AUTHKEY"))
    has_sid = bool(_s("AUTHKEY_SMS_SID"))
    return {
        "default_country_code": cc,
        "sms_available": bool(sms_on and has_key and has_sid and cc),
    }
