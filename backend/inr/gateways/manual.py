"""Manual INR deposits — UTR + screenshot, admin approval (current production flow)."""

from __future__ import annotations

from typing import Dict

from inr.gateways.base import (
    GatewayOrderRequest,
    GatewayOrderResult,
    GatewayWebhookEvent,
    InrPaymentGateway,
)


class ManualGateway(InrPaymentGateway):
    name = "manual"

    def is_configured(self) -> bool:
        return True

    async def create_order(self, req: GatewayOrderRequest) -> GatewayOrderResult:
        raise NotImplementedError("Manual flow does not create gateway orders")

    async def parse_webhook(
        self,
        *,
        headers: Dict[str, str],
        body: bytes,
    ) -> GatewayWebhookEvent:
        raise NotImplementedError("Manual flow does not accept gateway webhooks")
