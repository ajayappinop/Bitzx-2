"""Pydantic models for the MaxByte P2P module."""
from __future__ import annotations

from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator

# Supported fiat currencies for P2P
ALLOWED_FIATS = {"INR"}

# Supported crypto assets for P2P — all assets supported on MaxByte
ALLOWED_ASSETS = {"USDT", "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "TRX", "LTC", "ADA"}

PAYMENT_METHOD_TYPES = {"UPI", "IMPS", "BANK", "PAYTM", "PHONEPE", "GPAY"}


# ----------------------------- Payment methods --------------------------------
class PaymentMethodCreate(BaseModel):
    type: Literal["UPI", "IMPS", "BANK", "PAYTM", "PHONEPE", "GPAY"]
    display_name: str = Field(..., min_length=2, max_length=40)
    upi_id: Optional[str] = Field(None, max_length=80)
    bank_name: Optional[str] = Field(None, max_length=80)
    account_number: Optional[str] = Field(None, max_length=40)
    ifsc: Optional[str] = Field(None, max_length=15)
    holder_name: Optional[str] = Field(None, min_length=2, max_length=80)
    is_default: bool = False


class PaymentMethodUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=2, max_length=40)
    upi_id: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc: Optional[str] = None
    holder_name: Optional[str] = None
    is_default: Optional[bool] = None


# ----------------------------- Ads -------------------------------------------
class AdCreate(BaseModel):
    side: Literal["buy", "sell"]
    asset: str = Field("USDT", max_length=10)
    fiat: str = Field("INR", max_length=5)
    price_type: Literal["fixed", "floating"] = "fixed"
    price: Optional[str] = None              # required when price_type=fixed
    margin_pct: Optional[str] = None         # required when price_type=floating ("+1.5", "-0.5")
    total_amount: str = Field(..., description="Crypto amount in asset units")
    min_order_inr: str = Field(...)
    max_order_inr: str = Field(...)
    payment_method_ids: list[str] = Field(..., min_length=1, max_length=5)
    payment_window_min: int = Field(15, ge=10, le=60)
    terms: Optional[str] = Field(None, max_length=500)
    auto_reply: Optional[str] = Field(None, max_length=200)
    # Counter-party filters (enforced server-side at order-open)
    filter_kyc_tier: int = Field(0, ge=0, le=3)
    filter_min_completed_trades: int = Field(0, ge=0, le=10000)
    filter_min_completion_rate: float = Field(0.0, ge=0.0, le=100.0)

    @field_validator("price_type", mode="before")
    @classmethod
    def _normalise_price_type(cls, v: str) -> str:
        # Accept "float" as an alias for "floating" from older clients
        if v == "float":
            return "floating"
        return v

    @field_validator("asset", "fiat")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


class AdUpdate(BaseModel):
    """Partial update — only allowed when ad has zero in_progress orders."""
    price: Optional[str] = None
    margin_pct: Optional[str] = None
    min_order_inr: Optional[str] = None
    max_order_inr: Optional[str] = None
    payment_method_ids: Optional[list[str]] = None
    payment_window_min: Optional[int] = Field(None, ge=10, le=60)
    terms: Optional[str] = Field(None, max_length=500)
    auto_reply: Optional[str] = Field(None, max_length=200)
    filter_kyc_tier: Optional[int] = Field(None, ge=0, le=3)
    filter_min_completed_trades: Optional[int] = Field(None, ge=0, le=10000)
    filter_min_completion_rate: Optional[float] = Field(None, ge=0.0, le=100.0)


# ----------------------------- Orders ----------------------------------------
class OrderCreate(BaseModel):
    ad_id: str
    fiat_amount: str = Field(..., description="Fiat amount the taker wants to spend / receive")
    payment_method_id: str


# ----------------------------- Order actions ----------------------------------
class MarkPaidRequest(BaseModel):
    payment_proof_url: Optional[str] = Field(None, max_length=500_000)
    note: Optional[str] = Field(None, max_length=200)


class ReleaseRequest(BaseModel):
    totp_code: Optional[str] = Field(
        None, min_length=6, max_length=10,
        description="Required only if seller has TOTP 2FA enabled"
    )


class CancelOrderRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=200)


class RateOrderRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=200)


class MessageCreate(BaseModel):
    body: Optional[str] = Field(None, max_length=2000)
    attachment_url: Optional[str] = Field(None, max_length=500)


# ----------------------------- Disputes --------------------------------------
DISPUTE_REASONS = {
    "buyer_no_payment", "seller_no_release", "wrong_amount",
    "fake_proof", "chargeback", "other",
}


DISPUTE_REASON_VALUES = {
    "buyer_no_payment", "seller_no_release", "wrong_amount",
    "fake_proof", "chargeback", "other",
}


class DisputeOpen(BaseModel):
    reason: str = Field(..., min_length=3, max_length=100)
    description: str = Field(..., min_length=5, max_length=1000)
    evidence_urls: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("reason", mode="before")
    @classmethod
    def _normalise_reason(cls, v: str) -> str:
        # Coerce free-text reasons to canonical enum values
        v = v.strip()
        if v in DISPUTE_REASON_VALUES:
            return v
        return "other"


class DisputeEvidence(BaseModel):
    evidence_urls: list[str] = Field(..., min_length=1, max_length=10)
    note: Optional[str] = Field(None, max_length=300)


class DisputeResolve(BaseModel):
    resolution: Literal["release_to_buyer", "refund_to_seller"]
    note: str = Field(..., min_length=5, max_length=500)


class P2PBanRequest(BaseModel):
    duration_hours: int = Field(24, ge=0, le=8760)  # 0 = permanent (365 days)
    reason: str = Field(..., min_length=3, max_length=200)


# ----------------------------- Admin models ----------------------------------
class DisputeAdminNote(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)


class DisputeFreezeRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=200)


class DisputeEscalateRequest(BaseModel):
    priority: Literal["high", "critical"] = "high"
    note: str = Field(..., min_length=3, max_length=300)


class DisputeRequestEvidence(BaseModel):
    target: Literal["buyer", "seller", "both"] = "both"
    note: str = Field(..., min_length=3, max_length=300)


# ----------------------------- Merchant system (Phase 4) ---------------------
class MerchantApply(BaseModel):
    # New exchange form fields
    monthly_volume_usd: Optional[float] = Field(None, ge=0)
    trading_experience: Optional[str] = Field(None, max_length=60)
    application_reason: Optional[str] = Field(None, max_length=1000)
    # Legacy fields kept for backwards compat
    display_name: Optional[str] = Field(None, min_length=2, max_length=60)
    business_type: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class MerchantAdminAction(BaseModel):
    reason: Optional[str] = Field(None, max_length=300)
