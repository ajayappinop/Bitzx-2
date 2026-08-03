"""Payment gateway provider interface for INR deposits."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class GatewayOrderRequest:
    deposit_id: str
    uid: str
    amount_inr: float
    payment_method_id: Optional[str] = None
    customer_email: Optional[str] = None
    customer_name: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GatewayOrderResult:
    """Result of creating a payment session with a provider."""

    provider_order_id: str
    checkout_url: Optional[str] = None
    client_payload: Dict[str, Any] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GatewayWebhookEvent:
    """Normalized webhook payload after signature verification."""

    provider: str
    event_type: str
    provider_payment_id: str
    deposit_id: Optional[str] = None
    amount_inr: Optional[float] = None
    paid: bool = False
    failed: bool = False
    raw: Dict[str, Any] = field(default_factory=dict)


class InrPaymentGateway(ABC):
    """Pluggable INR payment gateway — implement per provider (Razorpay, Cashfree, …)."""

    name: str = "base"

    @abstractmethod
    def is_configured(self) -> bool:
        """True when API keys / secrets are present for this environment."""

    @abstractmethod
    async def create_order(self, req: GatewayOrderRequest) -> GatewayOrderResult:
        """Start a hosted checkout or payment session."""

    @abstractmethod
    async def parse_webhook(
        self,
        *,
        headers: Dict[str, str],
        body: bytes,
    ) -> GatewayWebhookEvent:
        """Verify signature and normalize provider webhook payload."""
