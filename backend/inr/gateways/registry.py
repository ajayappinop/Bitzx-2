"""Gateway provider registry."""

from __future__ import annotations

from typing import Dict

from fastapi import HTTPException

from inr.constants import GATEWAY_NONE, KNOWN_GATEWAY_PROVIDERS
from inr.gateways.base import InrPaymentGateway
from inr.gateways.manual import ManualGateway
from inr.gateways.stub import (
    CashfreeGateway,
    PayuGateway,
    PhonePeGateway,
    RazorpayGateway,
    _StubGateway,
)

_PROVIDERS: Dict[str, InrPaymentGateway] = {
    GATEWAY_NONE: ManualGateway(),
    "manual": ManualGateway(),
    "razorpay": RazorpayGateway(),
    "cashfree": CashfreeGateway(),
    "payu": PayuGateway(),
    "phonepe": PhonePeGateway(),
}


def list_gateway_providers() -> list[str]:
    return list(KNOWN_GATEWAY_PROVIDERS)


def get_gateway(provider: str) -> InrPaymentGateway:
    key = (provider or GATEWAY_NONE).strip().lower()
    if key not in _PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown payment gateway: {provider}")
    return _PROVIDERS[key]


def provider_metadata() -> list[dict]:
    """Admin UI: available providers and whether env credentials look set."""
    out = []
    for name in KNOWN_GATEWAY_PROVIDERS:
        if name == GATEWAY_NONE:
            out.append({
                "id": GATEWAY_NONE,
                "label": "None (manual only)",
                "configured": True,
                "implemented": True,
            })
            continue
        gw = _PROVIDERS.get(name)
        configured = bool(gw and gw.is_configured())
        implemented = not isinstance(gw, _StubGateway)
        labels = {
            "razorpay": "Razorpay",
            "cashfree": "Cashfree",
            "payu": "PayU",
            "phonepe": "PhonePe",
        }
        out.append({
            "id": name,
            "label": labels.get(name, name.title()),
            "configured": configured,
            "implemented": implemented,
        })
    return out
