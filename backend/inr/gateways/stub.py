"""Placeholder gateway providers — wire real APIs when credentials are configured."""

from __future__ import annotations

import os
from typing import Dict

from fastapi import HTTPException

from inr.gateways.base import (
    GatewayOrderRequest,
    GatewayOrderResult,
    GatewayWebhookEvent,
    InrPaymentGateway,
)


def _env(*keys: str) -> str:
    for k in keys:
        v = (os.getenv(k) or "").strip()
        if v:
            return v
    return ""


class _StubGateway(InrPaymentGateway):
    """Shared behaviour until a provider SDK is integrated."""

    display_name: str = "Gateway"
    key_id_env: str = ""
    key_secret_env: str = ""
    webhook_secret_env: str = ""

    def is_configured(self) -> bool:
        return bool(_env(self.key_id_env) and _env(self.key_secret_env))

    async def create_order(self, req: GatewayOrderRequest) -> GatewayOrderResult:
        if not self.is_configured():
            raise HTTPException(
                status_code=503,
                detail=(
                    f"{self.display_name} is selected but API credentials are not configured. "
                    f"Set {self.key_id_env} and {self.key_secret_env}, or switch to manual deposits."
                ),
            )
        raise HTTPException(
            status_code=501,
            detail=f"{self.display_name} integration is not enabled yet. Use manual deposit flow.",
        )

    async def parse_webhook(
        self,
        *,
        headers: Dict[str, str],
        body: bytes,
    ) -> GatewayWebhookEvent:
        if not _env(self.webhook_secret_env):
            raise HTTPException(status_code=503, detail=f"{self.display_name} webhook secret not configured")
        raise HTTPException(
            status_code=501,
            detail=f"{self.display_name} webhooks are not enabled yet",
        )


class RazorpayGateway(_StubGateway):
    name = "razorpay"
    display_name = "Razorpay"
    key_id_env = "INR_RAZORPAY_KEY_ID"
    key_secret_env = "INR_RAZORPAY_KEY_SECRET"
    webhook_secret_env = "INR_RAZORPAY_WEBHOOK_SECRET"


class CashfreeGateway(_StubGateway):
    name = "cashfree"
    display_name = "Cashfree"
    key_id_env = "INR_CASHFREE_APP_ID"
    key_secret_env = "INR_CASHFREE_SECRET_KEY"
    webhook_secret_env = "INR_CASHFREE_WEBHOOK_SECRET"


class PayuGateway(_StubGateway):
    name = "payu"
    display_name = "PayU"
    key_id_env = "INR_PAYU_MERCHANT_KEY"
    key_secret_env = "INR_PAYU_MERCHANT_SALT"
    webhook_secret_env = "INR_PAYU_WEBHOOK_SECRET"


class PhonePeGateway(_StubGateway):
    name = "phonepe"
    display_name = "PhonePe"
    key_id_env = "INR_PHONEPE_MERCHANT_ID"
    key_secret_env = "INR_PHONEPE_SALT_KEY"
    webhook_secret_env = "INR_PHONEPE_WEBHOOK_SECRET"
