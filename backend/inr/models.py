"""Pydantic models for INR deposit APIs."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from inr.constants import METHOD_BANK, METHOD_QR, METHOD_TYPES, METHOD_UPI


class BankDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bank_name: str = Field(..., min_length=2, max_length=120)
    account_holder_name: str = Field(..., min_length=2, max_length=120)
    account_number: str = Field(..., min_length=4, max_length=40)
    ifsc_code: str = Field(..., min_length=11, max_length=11)
    branch: Optional[str] = Field(None, max_length=120)

    @field_validator("ifsc_code")
    @classmethod
    def _ifsc(cls, v: str) -> str:
        s = (v or "").strip().upper()
        if len(s) != 11:
            raise ValueError("IFSC must be 11 characters")
        return s


class UpiDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upi_id: str = Field(..., min_length=3, max_length=80)
    display_name: str = Field(..., min_length=2, max_length=120)


class QrDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(..., min_length=2, max_length=120)


class PaymentMethodCreateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Literal["bank", "upi", "qr"]
    details: Dict[str, Any]
    is_active: bool = True

    @field_validator("type")
    @classmethod
    def _type_ok(cls, v: str) -> str:
        if v not in METHOD_TYPES:
            raise ValueError("type must be bank, upi, or qr")
        return v


class PaymentMethodUpdateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    details: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class InrDepositRejectBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reason: str = Field(..., min_length=3, max_length=500)


class InrDepositApproveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    note: Optional[str] = Field(None, max_length=300)


class InrWithdrawalCreateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    amount_inr: float = Field(..., gt=0)
    payout_type: Literal["bank", "upi"]
    payout_details: Optional[Dict[str, Any]] = None
    save_payout_profile: bool = True

    @field_validator("payout_type")
    @classmethod
    def _payout_type_ok(cls, v: str) -> str:
        if v not in (METHOD_BANK, METHOD_UPI):
            raise ValueError("payout_type must be bank or upi")
        return v


class InrWithdrawalRejectBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reason: str = Field(..., min_length=3, max_length=500)


class InrPayoutProfileSaveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    payout_type: Literal["bank", "upi"]
    payout_details: Dict[str, Any]

    @field_validator("payout_type")
    @classmethod
    def _payout_type_ok(cls, v: str) -> str:
        if v not in (METHOD_BANK, METHOD_UPI):
            raise ValueError("payout_type must be bank or upi")
        return v


class InrWithdrawalApproveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    note: Optional[str] = Field(None, max_length=300)
    payout_reference: Optional[str] = Field(
        None,
        max_length=120,
        description="UTR / bank reference after admin sends INR",
    )


class InrGatewayConfigPatch(BaseModel):
    """Admin: INR deposit flow and payment gateway selection."""

    model_config = ConfigDict(extra="ignore")

    deposit_mode: Optional[Literal["manual", "gateway", "hybrid"]] = None
    gateway_provider: Optional[str] = Field(
        None,
        description="none, razorpay, cashfree, payu, phonepe",
    )
    auto_approve_max_inr: Optional[float] = Field(
        None,
        ge=0,
        description="Auto-credit IBO after gateway payment up to this INR amount; 0 = always manual review",
    )
    min_deposit_inr: Optional[float] = Field(
        None,
        ge=0,
        description="Minimum INR amount per deposit; 0 = no minimum",
    )

    @field_validator("gateway_provider")
    @classmethod
    def _provider(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return (v or "none").strip().lower()


def validate_details_for_type(method_type: str, details: Dict[str, Any]) -> Dict[str, Any]:
    if method_type == METHOD_BANK:
        return BankDetails.model_validate(details).model_dump()
    if method_type == METHOD_UPI:
        return UpiDetails.model_validate(details).model_dump()
    if method_type == METHOD_QR:
        return QrDetails.model_validate(details).model_dump()
    raise ValueError("invalid method type")
