"""Admin INR deposit API — ``/api/admin/inr/*``."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from inr import gateway_ops, service
from inr.gateways.registry import provider_metadata
from inr import withdrawal_service
from inr.models import (
    InrDepositApproveBody,
    InrDepositRejectBody,
    InrGatewayConfigPatch,
    InrWithdrawalApproveBody,
    InrWithdrawalRejectBody,
    PaymentMethodCreateBody,
    PaymentMethodUpdateBody,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/inr", tags=["Admin INR"])
_http_bearer = HTTPBearer(auto_error=False)
_deps: Dict[str, Any] = {}


def register_inr_admin(
    *,
    db,
    inr_upload_dir,
    get_platform_controls,
    resolve_admin_auth,
    require_admin_permission,
    log_admin_audit=None,
) -> None:
    service.register_inr_deps(
        db=db,
        inr_upload_dir=inr_upload_dir,
        get_platform_controls=get_platform_controls,
    )
    _deps.update({
        "resolve_admin": resolve_admin_auth,
        "require_perm": require_admin_permission,
        "log_audit": log_admin_audit,
    })


async def _require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_http_bearer),
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    fn = _deps.get("resolve_admin")
    if fn is None:
        raise HTTPException(status_code=503, detail="Admin auth not configured")
    return await fn(credentials=credentials, x_admin_key=x_admin_key)


def _perm(auth, permission: str) -> None:
    fn = _deps.get("require_perm")
    if fn is None:
        raise HTTPException(status_code=503, detail="Admin permissions not configured")
    fn(auth, permission)


def _admin_id(auth) -> str:
    admin = getattr(auth, "admin", None) or {}
    if isinstance(admin, dict):
        return admin.get("aid") or admin.get("email") or "admin"
    return "admin"


# ── Stats (sidebar badge) ─────────────────────────────────────────────────────

@router.get("/stats")
async def inr_stats(auth=Depends(_require_admin)):
    _perm(auth, "view_withdrawals")
    return await service.count_pending_inr_queue()


@router.get("/rate")
async def admin_inr_rate(auth=Depends(_require_admin)):
    _perm(auth, "view_withdrawals")
    inr_per_usdt, ibo_usdt, ibo_per_inr = await service.resolve_inr_ibo_rate()
    return {
        "inr_per_usdt": inr_per_usdt,
        "ibo_usdt": ibo_usdt,
        "ibo_per_inr": ibo_per_inr,
    }


@router.get("/gateway-providers")
async def admin_inr_gateway_providers(auth=Depends(_require_admin)):
    _perm(auth, "manage_settings")
    return {"items": provider_metadata()}


@router.get("/gateway-config")
async def admin_inr_gateway_config_get(auth=Depends(_require_admin)):
    _perm(auth, "manage_settings")
    return await gateway_ops.get_gateway_config()


@router.patch("/gateway-config")
async def admin_inr_gateway_config_patch(
    body: InrGatewayConfigPatch,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_settings")
    return await gateway_ops.update_gateway_config(body)


@router.get("/deposits/{deposit_id}/preview")
async def admin_deposit_ibo_preview(
    deposit_id: str,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_treasury")
    return await service.preview_pending_deposit_ibo(deposit_id)


# ── Payment methods ───────────────────────────────────────────────────────────

@router.get("/payment-methods")
async def admin_list_payment_methods(auth=Depends(_require_admin)):
    _perm(auth, "manage_settings")
    return {"items": await service.list_payment_methods(active_only=False)}


@router.post("/payment-methods")
async def admin_create_payment_method(
    body: PaymentMethodCreateBody,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_settings")
    created = await service.create_payment_method(
        body.type,
        body.details,
        is_active=body.is_active,
    )
    return created


@router.post("/payment-methods/with-qr")
async def admin_create_qr_payment_method(
    type: str = Form("qr"),
    details_json: str = Form(...),
    is_active: bool = Form(True),
    qr_image: UploadFile = File(...),
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_settings")
    if type != "qr":
        raise HTTPException(status_code=400, detail="This endpoint is for QR methods only")
    try:
        details = json.loads(details_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid details JSON") from exc
    qr_url = await service.save_qr_image(qr_image)
    return await service.create_payment_method(
        "qr",
        details,
        is_active=is_active,
        qr_image_url=qr_url,
    )


@router.patch("/payment-methods/{method_id}")
async def admin_update_payment_method(
    method_id: str,
    body: PaymentMethodUpdateBody,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_settings")
    return await service.update_payment_method(
        method_id,
        details=body.details,
        is_active=body.is_active,
    )


@router.post("/payment-methods/{method_id}/qr")
async def admin_upload_qr_for_method(
    method_id: str,
    qr_image: UploadFile = File(...),
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_settings")
    qr_url = await service.save_qr_image(qr_image)
    return await service.update_payment_method(method_id, qr_image_url=qr_url)


@router.delete("/payment-methods/{method_id}")
async def admin_delete_payment_method(
    method_id: str,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_settings")
    await service.delete_payment_method(method_id)
    return {"ok": True}


# ── Deposits queue ────────────────────────────────────────────────────────────

@router.get("/deposits")
async def admin_list_deposits(
    uid: Optional[str] = Query(None, min_length=4, max_length=64),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    auth=Depends(_require_admin),
):
    _perm(auth, "view_withdrawals")
    return await service.list_admin_deposits(uid=uid, status=status, skip=skip, limit=limit)


@router.post("/deposits/{deposit_id}/approve")
async def admin_approve_deposit(
    deposit_id: str,
    body: InrDepositApproveBody,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_treasury")
    return await service.approve_deposit(
        deposit_id,
        _admin_id(auth),
        note=body.note,
    )


@router.post("/deposits/{deposit_id}/reject")
async def admin_reject_deposit(
    deposit_id: str,
    body: InrDepositRejectBody,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_treasury")
    return await service.reject_deposit(
        deposit_id,
        _admin_id(auth),
        body.reason,
    )


# ── Withdrawals queue ─────────────────────────────────────────────────────────

@router.get("/withdrawals")
async def admin_list_withdrawals(
    uid: Optional[str] = Query(None, min_length=4, max_length=64),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    auth=Depends(_require_admin),
):
    _perm(auth, "view_withdrawals")
    return await withdrawal_service.list_admin_withdrawals(
        uid=uid, status=status, skip=skip, limit=limit
    )


@router.post("/withdrawals/{withdrawal_id}/approve")
async def admin_approve_withdrawal(
    withdrawal_id: str,
    body: InrWithdrawalApproveBody,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_treasury")
    return await withdrawal_service.approve_withdrawal(
        withdrawal_id,
        _admin_id(auth),
        note=body.note,
        payout_reference=body.payout_reference,
    )


@router.post("/withdrawals/{withdrawal_id}/reject")
async def admin_reject_withdrawal(
    withdrawal_id: str,
    body: InrWithdrawalRejectBody,
    auth=Depends(_require_admin),
):
    _perm(auth, "manage_treasury")
    return await withdrawal_service.reject_withdrawal(
        withdrawal_id,
        _admin_id(auth),
        body.reason,
    )
