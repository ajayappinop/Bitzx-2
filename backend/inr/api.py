"""User-facing INR deposit API — ``/api/inr/*``."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from inr import gateway_ops, service, withdrawal_service
from inr.models import InrPayoutProfileSaveBody, InrWithdrawalCreateBody
from inr import payout_profile_service
from p2p.deps import current_user

router = APIRouter(prefix="/api/inr", tags=["INR Deposits"])


@router.get("/public-info")
async def get_inr_deposit_public_info():
    """Public INR deposit limits for landing / marketing (no auth)."""
    min_inr = await service.resolve_min_deposit_inr()
    return {"min_deposit_inr": min_inr}


class GatewayCheckoutBody(BaseModel):
    amount_inr: float = Field(..., gt=0)
    payment_method_id: Optional[str] = Field(None, min_length=4)


@router.get("/config")
async def get_inr_deposit_config(_user=Depends(current_user)):
    """Deposit flow mode (manual / gateway / hybrid) and whether checkout is available."""
    return await gateway_ops.get_public_deposit_config()


@router.get("/rate")
async def get_inr_rate(_user=Depends(current_user)):
    """Current INR→IBO conversion preview for the deposit form."""
    inr_per_usdt, ibo_usdt, ibo_per_inr = await service.resolve_inr_ibo_rate()
    return {
        "inr_per_usdt": inr_per_usdt,
        "ibo_usdt": ibo_usdt,
        "ibo_per_inr": ibo_per_inr,
    }


@router.get("/payment-methods")
async def list_active_payment_methods(_user=Depends(current_user)):
    return {"items": await service.list_payment_methods(active_only=True)}


@router.get("/asset")
async def get_inr_asset(path: str = Query(..., min_length=12, max_length=512)):
    """
    Stream INR QR or deposit screenshot files (same paths as ``/uploads/inr/...``).
    Public read — used when static ``/uploads`` is proxied differently on production.
    """
    full = service.resolve_inr_public_asset_path(path)
    return FileResponse(
        full,
        media_type=service.mime_for_inr_asset(full),
        filename=full.name,
    )


@router.get("/deposits")
async def list_my_deposits(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user=Depends(current_user),
):
    return await service.list_user_deposits(user["uid"], skip=skip, limit=limit)


@router.post("/deposits/gateway")
async def start_gateway_deposit(body: GatewayCheckoutBody, user=Depends(current_user)):
    """Start a hosted payment session (when gateway mode is enabled and configured)."""
    return await gateway_ops.create_gateway_checkout(
        user["uid"],
        amount_inr=body.amount_inr,
        payment_method_id=(body.payment_method_id or "").strip() or None,
    )


@router.post("/webhooks/{provider}")
async def inr_gateway_webhook(provider: str, request: Request):
    """Payment provider callbacks — no user auth; verified per provider."""
    return await gateway_ops.handle_gateway_webhook(provider, request)


@router.get("/withdrawals/eligibility")
async def get_inr_withdrawal_eligibility(user=Depends(current_user)):
    """Whether user may request INR withdrawal (requires approved INR deposit)."""
    return await withdrawal_service.get_withdrawal_eligibility(user["uid"])


@router.get("/withdrawals/payout-profile")
async def get_inr_payout_profile(user=Depends(current_user)):
    """Saved bank / UPI details for INR withdrawals."""
    return await payout_profile_service.get_payout_profile(user["uid"])


@router.put("/withdrawals/payout-profile")
async def save_inr_payout_profile(
    body: InrPayoutProfileSaveBody,
    user=Depends(current_user),
):
    """Save or update bank or UPI payout details for future INR withdrawals."""
    profile = await payout_profile_service.save_payout_profile(
        user["uid"],
        body.payout_type,
        body.payout_details,
    )
    return {"message": "Payout details saved.", "payout_profile": profile}


@router.delete("/withdrawals/payout-profile/{payout_type}")
async def delete_inr_payout_profile(
    payout_type: str,
    user=Depends(current_user),
):
    """Delete saved bank or UPI payout details."""
    profile = await payout_profile_service.delete_payout_profile(
        user["uid"],
        payout_type.strip().lower(),
    )
    return {"message": "Payout details deleted.", "payout_profile": profile}


@router.get("/withdrawals")
async def list_my_inr_withdrawals(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user=Depends(current_user),
):
    return await withdrawal_service.list_user_withdrawals(
        user["uid"], skip=skip, limit=limit
    )


@router.post("/withdrawals")
async def submit_inr_withdrawal(
    body: InrWithdrawalCreateBody,
    user=Depends(current_user),
):
    doc = await withdrawal_service.create_withdrawal_request(
        user["uid"],
        amount_inr=body.amount_inr,
        payout_type=body.payout_type,
        payout_details=body.payout_details,
        save_payout_profile=body.save_payout_profile,
    )
    return {
        "message": "Your INR withdrawal request has been submitted and is under review.",
        "withdrawal": doc,
    }


@router.delete("/withdrawals/{withdrawal_id}")
async def cancel_inr_withdrawal(withdrawal_id: str, user=Depends(current_user)):
    withdrawal = await withdrawal_service.cancel_user_withdrawal(
        withdrawal_id=withdrawal_id,
        uid=user["uid"],
    )
    return {
        "message": "INR withdrawal request cancelled successfully.",
        "withdrawal": withdrawal,
    }


@router.post("/deposits")
async def submit_inr_deposit(
    amount_inr: float = Form(..., gt=0),
    payment_method_id: str = Form(..., min_length=4),
    utr_number: str = Form(..., min_length=4),
    note: Optional[str] = Form(None),
    screenshot: UploadFile = File(...),
    user=Depends(current_user),
):
    cfg = await gateway_ops.get_gateway_config()
    if not cfg.get("manual_enabled"):
        raise HTTPException(
            status_code=400,
            detail="Manual INR deposits are disabled. Use the payment gateway checkout.",
        )
    await service.assert_min_deposit_inr(amount_inr)
    screenshot_url = await service.save_deposit_screenshot(screenshot)
    doc = await service.create_deposit_request(
        user["uid"],
        amount_inr=amount_inr,
        payment_method_id=payment_method_id.strip(),
        utr_number=utr_number,
        screenshot_url=screenshot_url,
        note=note,
    )
    return {
        "message": "Your deposit request has been submitted and is under review.",
        "deposit": doc,
    }
