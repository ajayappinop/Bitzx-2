"""INR payment gateway configuration, checkout stubs, and webhooks."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request

from inr.constants import (
    COL_DEPOSITS,
    COL_GATEWAY_EVENTS,
    DEFAULT_DEPOSIT_MODE,
    DEPOSIT_MODE_GATEWAY,
    DEPOSIT_MODE_HYBRID,
    DEPOSIT_MODE_MANUAL,
    DEPOSIT_MODES,
    GATEWAY_NONE,
    GW_STATUS_CREATED,
    GW_STATUS_FAILED,
    GW_STATUS_PAID,
    STATUS_APPROVED,
    STATUS_PENDING,
)
from inr.gateways.base import GatewayOrderRequest
from inr.gateways.registry import get_gateway, provider_metadata
from inr.models import InrGatewayConfigPatch

logger = logging.getLogger(__name__)


def _db():
    from inr import service

    return service._db()


def _now_iso():
    from inr import service

    return service._now_iso()


def _new_id(prefix: str):
    from inr import service

    return service._new_id(prefix)


async def _get_controls() -> Dict[str, Any]:
    from inr import service

    return await service._get_controls()


def _normalize_mode(raw: Any) -> str:
    mode = (str(raw or "") or DEFAULT_DEPOSIT_MODE).strip().lower()
    if mode not in DEPOSIT_MODES:
        return DEFAULT_DEPOSIT_MODE
    return mode


def _normalize_provider(raw: Any) -> str:
    prov = (str(raw or "") or GATEWAY_NONE).strip().lower()
    if prov == GATEWAY_NONE or prov == "manual":
        return GATEWAY_NONE
    return prov


async def get_gateway_config() -> Dict[str, Any]:
    ctrl = await _get_controls()
    mode = _normalize_mode(ctrl.get("inr_deposit_mode"))
    provider = _normalize_provider(ctrl.get("inr_gateway_provider"))
    auto_max = float(ctrl.get("inr_gateway_auto_approve_max_inr") or 0)
    if auto_max < 0:
        auto_max = 0.0
    min_deposit = float(ctrl.get("inr_min_deposit_inr") or 0)
    if min_deposit < 0:
        min_deposit = 0.0
    if mode == DEPOSIT_MODE_MANUAL:
        provider = GATEWAY_NONE
    elif mode == DEPOSIT_MODE_GATEWAY and provider == GATEWAY_NONE:
        pass  # misconfiguration surfaced in public_config
    return {
        "deposit_mode": mode,
        "gateway_provider": provider,
        "auto_approve_max_inr": round(auto_max, 2),
        "min_deposit_inr": round(min_deposit, 2),
        "manual_enabled": mode in (DEPOSIT_MODE_MANUAL, DEPOSIT_MODE_HYBRID),
        "gateway_enabled": mode in (DEPOSIT_MODE_GATEWAY, DEPOSIT_MODE_HYBRID),
    }


async def get_public_deposit_config() -> Dict[str, Any]:
    """User-facing deposit flow capabilities."""
    cfg = await get_gateway_config()
    provider = cfg["gateway_provider"]
    gw = get_gateway(provider) if provider != GATEWAY_NONE else None
    gateway_ready = bool(
        cfg["gateway_enabled"]
        and provider != GATEWAY_NONE
        and gw
        and gw.is_configured()
    )
    misconfigured = bool(
        cfg["gateway_enabled"] and provider != GATEWAY_NONE and not gateway_ready
    )
    return {
        **cfg,
        "gateway_ready": gateway_ready,
        "gateway_misconfigured": misconfigured,
        "providers_available": provider_metadata(),
    }


async def update_gateway_config(patch: InrGatewayConfigPatch) -> Dict[str, Any]:
    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    updates = patch.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    ctrl = await _get_controls()
    mode = _normalize_mode(updates.get("deposit_mode", ctrl.get("inr_deposit_mode")))
    provider = _normalize_provider(
        updates.get("gateway_provider", ctrl.get("inr_gateway_provider"))
    )
    if "auto_approve_max_inr" in updates:
        auto_max = float(updates["auto_approve_max_inr"])
        if auto_max < 0:
            raise HTTPException(status_code=400, detail="auto_approve_max_inr must be >= 0")
    else:
        auto_max = float(ctrl.get("inr_gateway_auto_approve_max_inr") or 0)

    if "min_deposit_inr" in updates:
        min_deposit = float(updates["min_deposit_inr"])
        if min_deposit < 0:
            raise HTTPException(status_code=400, detail="min_deposit_inr must be >= 0")
    else:
        min_deposit = float(ctrl.get("inr_min_deposit_inr") or 0)
        if min_deposit < 0:
            min_deposit = 0.0

    if mode == DEPOSIT_MODE_MANUAL:
        provider = GATEWAY_NONE
    if mode in (DEPOSIT_MODE_GATEWAY, DEPOSIT_MODE_HYBRID) and provider == GATEWAY_NONE:
        raise HTTPException(
            status_code=400,
            detail="Select a payment gateway provider when using gateway or hybrid mode",
        )

    set_fields = {
        "inr_deposit_mode": mode,
        "inr_gateway_provider": provider,
        "inr_gateway_auto_approve_max_inr": round(auto_max, 2),
        "inr_min_deposit_inr": round(min_deposit, 2),
        "updated_at": _now_iso(),
    }
    await db.platform_controls.update_one(
        {"id": "global"},
        {"$set": set_fields},
        upsert=True,
    )
    return await get_gateway_config()


async def create_gateway_checkout(
    uid: str,
    *,
    amount_inr: float,
    payment_method_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Reserve a deposit row and ask the configured provider for a checkout session."""
    from inr import service

    cfg = await get_gateway_config()
    if not cfg["gateway_enabled"]:
        raise HTTPException(status_code=400, detail="Automatic payment gateway is not enabled")
    provider = cfg["gateway_provider"]
    if provider == GATEWAY_NONE:
        raise HTTPException(status_code=503, detail="No payment gateway provider configured")

    db = _db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if amount_inr <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    await service.assert_min_deposit_inr(amount_inr)

    pending = await db[COL_DEPOSITS].find_one({"uid": uid, "status": STATUS_PENDING})
    if pending:
        raise HTTPException(
            status_code=409,
            detail="You already have a pending INR deposit. Wait for review or contact support.",
        )

    method_label = None
    if payment_method_id:
        method = await service.get_payment_method(payment_method_id, must_be_active=True)
        method_label = service._method_label(method)

    deposit_id = _new_id("inrd")
    now = _now_iso()
    gw = get_gateway(provider)

    user = await db.users.find_one({"uid": uid}, {"_id": 0, "email": 1, "name": 1})
    order_req = GatewayOrderRequest(
        deposit_id=deposit_id,
        uid=uid,
        amount_inr=round(float(amount_inr), 2),
        payment_method_id=payment_method_id,
        customer_email=(user or {}).get("email"),
        customer_name=(user or {}).get("name"),
    )
    order = await gw.create_order(order_req)

    doc = {
        "id": deposit_id,
        "uid": uid,
        "amount_inr": round(float(amount_inr), 2),
        "amount_ibo": None,
        "inr_rate_at_time": None,
        "ibo_usdt_at_time": None,
        "inr_per_usdt_at_time": None,
        "payment_method_id": payment_method_id,
        "payment_method_type": None,
        "payment_method_label": method_label,
        "utr_number": None,
        "screenshot_url": None,
        "note": None,
        "deposit_flow": "gateway",
        "gateway_provider": provider,
        "gateway_order_id": order.provider_order_id,
        "gateway_status": GW_STATUS_CREATED,
        "gateway_checkout_url": order.checkout_url,
        "status": STATUS_PENDING,
        "rejection_reason": None,
        "reviewed_by": None,
        "reviewed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    await db[COL_DEPOSITS].insert_one(doc)
    await service._notify_user_deposit_submitted(doc)
    return {
        "deposit": service._deposit_out(doc),
        "checkout_url": order.checkout_url,
        "client_payload": order.client_payload,
        "provider": provider,
    }


async def _log_gateway_event(
    *,
    provider: str,
    event_type: str,
    deposit_id: Optional[str],
    provider_payment_id: Optional[str],
    payload: Dict[str, Any],
    processed: bool,
    error: Optional[str] = None,
) -> None:
    db = _db()
    if db is None:
        return
    await db[COL_GATEWAY_EVENTS].insert_one({
        "id": _new_id("inrgw"),
        "provider": provider,
        "event_type": event_type,
        "deposit_id": deposit_id,
        "provider_payment_id": provider_payment_id,
        "payload": payload,
        "processed": processed,
        "error": error,
        "created_at": _now_iso(),
    })


async def handle_gateway_webhook(provider: str, request: Request) -> Dict[str, Any]:
    """Entry point for ``POST /api/inr/webhooks/{provider}``."""
    from inr import service

    prov = (provider or "").strip().lower()
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    gw = get_gateway(prov)

    try:
        event = await gw.parse_webhook(headers=headers, body=body)
    except HTTPException as exc:
        await _log_gateway_event(
            provider=prov,
            event_type="webhook_error",
            deposit_id=None,
            provider_payment_id=None,
            payload={"status": exc.status_code, "detail": exc.detail},
            processed=False,
            error=str(exc.detail),
        )
        raise
    except Exception as exc:
        logger.exception("inr gateway webhook parse failed provider=%s", prov)
        await _log_gateway_event(
            provider=prov,
            event_type="webhook_error",
            deposit_id=None,
            provider_payment_id=None,
            payload={},
            processed=False,
            error=str(exc),
        )
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from exc

    deposit_id = event.deposit_id
    db = _db()
    doc = None
    if deposit_id and db is not None:
        doc = await db[COL_DEPOSITS].find_one({"id": deposit_id}, {"_id": 0})
    if doc is None and event.provider_payment_id and db is not None:
        doc = await db[COL_DEPOSITS].find_one(
            {"gateway_payment_id": event.provider_payment_id},
            {"_id": 0},
        )
        deposit_id = doc.get("id") if doc else deposit_id

    await _log_gateway_event(
        provider=prov,
        event_type=event.event_type,
        deposit_id=deposit_id,
        provider_payment_id=event.provider_payment_id,
        payload=event.raw,
        processed=False,
    )

    if not doc:
        return {"ok": True, "action": "ignored", "reason": "deposit not found"}

    if doc.get("status") in (STATUS_APPROVED,):
        return {"ok": True, "action": "ignored", "reason": "already approved"}

    if event.failed:
        await db[COL_DEPOSITS].update_one(
            {"id": doc["id"]},
            {"$set": {"gateway_status": GW_STATUS_FAILED, "updated_at": _now_iso()}},
        )
        return {"ok": True, "action": "marked_failed"}

    if not event.paid:
        return {"ok": True, "action": "ignored", "reason": "not a payment success event"}

    paid_inr = round(float(event.amount_inr or doc.get("amount_inr") or 0), 2)
    cfg = await get_gateway_config()
    auto_max = float(cfg.get("auto_approve_max_inr") or 0)
    min_inr = float(cfg.get("min_deposit_inr") or 0)
    can_auto = (
        auto_max > 0
        and paid_inr > 0
        and paid_inr <= auto_max
        and (min_inr <= 0 or paid_inr >= min_inr)
    )

    await db[COL_DEPOSITS].update_one(
        {"id": doc["id"]},
        {
            "$set": {
                "gateway_payment_id": event.provider_payment_id,
                "gateway_status": GW_STATUS_PAID,
                "utr_number": event.provider_payment_id or doc.get("utr_number"),
                "updated_at": _now_iso(),
            }
        },
    )

    if can_auto and doc.get("status") == STATUS_PENDING:
        try:
            await service.approve_deposit(
                doc["id"],
                f"gateway:{prov}",
                note=f"Auto-approved via {prov} webhook",
            )
            await _log_gateway_event(
                provider=prov,
                event_type=event.event_type,
                deposit_id=doc["id"],
                provider_payment_id=event.provider_payment_id,
                payload=event.raw,
                processed=True,
            )
            return {"ok": True, "action": "auto_approved", "deposit_id": doc["id"]}
        except HTTPException as exc:
            logger.warning("inr gateway auto-approve failed %s: %s", doc["id"], exc.detail)
            return {"ok": True, "action": "pending_manual_review", "reason": str(exc.detail)}

    return {"ok": True, "action": "pending_manual_review", "deposit_id": doc["id"]}


def gateway_fields_out(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "deposit_flow": doc.get("deposit_flow") or DEPOSIT_MODE_MANUAL,
        "gateway_provider": doc.get("gateway_provider"),
        "gateway_order_id": doc.get("gateway_order_id"),
        "gateway_payment_id": doc.get("gateway_payment_id"),
        "gateway_status": doc.get("gateway_status"),
        "gateway_checkout_url": doc.get("gateway_checkout_url"),
    }
