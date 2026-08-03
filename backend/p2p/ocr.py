"""MaxByte P2P Receipt OCR.

Uses Gemini 2.5 Flash via emergentintegrations (EMERGENT_LLM_KEY) to extract
structured fields from a payment-receipt image (Indian UPI / IMPS / bank-app
screenshot). Result is cached on the dispute document.

Set EMERGENT_LLM_KEY in .env to enable. Feature degrades gracefully if absent.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

log = logging.getLogger("p2p.ocr")

_SYSTEM = """You are a payment-receipt OCR specialist for an Indian crypto P2P exchange.

You receive a SCREENSHOT of an Indian UPI / IMPS / NEFT / bank-app payment confirmation.
Your job: extract structured fields and return ONLY a JSON object — no prose, no markdown,
no code fences. The JSON must use exactly these keys:

{
  "amount": <number or null — the rupee amount that was transferred (₹), no commas>,
  "utr":    <string or null — the 12-digit UTR / RRN / Transaction Reference / UPI Ref ID>,
  "timestamp_iso": <string or null — payment timestamp converted to ISO-8601 with the
                    Asia/Kolkata timezone, e.g. "2026-05-06T13:42:00+05:30">,
  "receiver_name": <string or null — the payee / beneficiary name shown on the receipt>,
  "receiver_upi":  <string or null — the receiver's UPI handle if visible>,
  "status": <"success" | "failed" | "pending" | null — payment outcome shown on screen>,
  "confidence": <number 0.0-1.0 — your overall confidence the image is a real, unedited
                 Indian payment receipt and the fields above were extracted correctly>,
  "raw_text": <string — short human-readable line summarising what you saw, max 200 chars>
}

Rules:
- If any field is unreadable or absent, return null for that field.
- If the image is NOT a payment receipt (e.g. a cat photo, code screenshot, wallpaper),
  set confidence below 0.2 and most fields to null.
- Be strict — never invent values. Lower confidence is fine.
- amount must be a JSON number (not a string).
- The output MUST be valid JSON parseable by json.loads()."""

_KEY = os.environ.get("EMERGENT_LLM_KEY")


def _parse_data_url(data_url: str) -> Optional[tuple[str, str]]:
    m = re.match(r"^data:(image/[^;]+);base64,(.+)$", data_url, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return m.group(1), m.group(2)


def _strip_json_fence(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s).rstrip("`").strip()
    return s


def _safe_json(text: str) -> dict[str, Any]:
    s = _strip_json_fence(text)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if not m:
            raise
        return json.loads(m.group(0))


async def extract_receipt_fields(image_data_url: str, session_id: str) -> dict[str, Any]:
    """Send the receipt image to Gemini and return parsed fields.

    Raises RuntimeError if EMERGENT_LLM_KEY is not configured.
    """
    # Reload key at call time (server may have set it after module import)
    key = os.environ.get("EMERGENT_LLM_KEY") or _KEY
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")

    parsed = _parse_data_url(image_data_url)
    if not parsed:
        raise ValueError("Receipt must be a base64 data URL (data:image/...;base64,...)")
    _, b64 = parsed

    from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
    chat = (
        LlmChat(api_key=key, session_id=session_id, system_message=_SYSTEM)
        .with_model("gemini", "gemini-2.5-flash")
    )
    msg = UserMessage(
        text="Extract the payment receipt fields from this image and return the JSON object only.",
        file_contents=[ImageContent(image_base64=b64)],
    )
    raw = await chat.send_message(msg)
    if not raw:
        raise RuntimeError("Empty response from Gemini")

    data = _safe_json(raw)

    def _num(v):
        try:
            if v is None or v == "":
                return None
            return float(v)
        except (ValueError, TypeError):
            return None

    confidence = _num(data.get("confidence")) or 0.0
    confidence = max(0.0, min(1.0, confidence))

    return {
        "amount": _num(data.get("amount")),
        "utr": (data.get("utr") or None),
        "timestamp_iso": (data.get("timestamp_iso") or None),
        "receiver_name": (data.get("receiver_name") or None),
        "receiver_upi": (data.get("receiver_upi") or None),
        "status": (data.get("status") or None),
        "confidence": round(confidence, 3),
        "raw_text": (data.get("raw_text") or "")[:200],
        "ocr_at": datetime.now(timezone.utc).isoformat(),
        "model": "gemini-2.5-flash",
    }


def compare_with_order(ocr: dict, order: dict) -> dict[str, dict]:
    """Return per-field verification checks comparing OCR output to order data."""
    out: dict[str, dict] = {}

    expected_amt = float(order.get("fiat_amount") or 0)
    extracted_amt = ocr.get("amount")
    if extracted_amt is None:
        out["amount"] = {"ok": False, "note": "Amount not detected in receipt"}
    elif abs(extracted_amt - expected_amt) <= max(1.0, expected_amt * 0.01):
        out["amount"] = {"ok": True, "note": f"₹{extracted_amt:,.2f} matches expected ₹{expected_amt:,.2f}"}
    else:
        out["amount"] = {"ok": False, "note": f"Receipt shows ₹{extracted_amt:,.2f} but order is ₹{expected_amt:,.2f}"}

    utr = (ocr.get("utr") or "").strip()
    expected_utr = (order.get("buyer_paid_note") or "").strip()
    if not utr:
        out["utr"] = {"ok": False, "note": "UTR / reference not detected"}
    elif expected_utr and (utr in expected_utr or expected_utr in utr):
        out["utr"] = {"ok": True, "note": f"UTR {utr} matches"}
    elif expected_utr:
        out["utr"] = {"ok": False, "note": f"Receipt UTR {utr} ≠ buyer-claimed {expected_utr}"}
    else:
        out["utr"] = {"ok": True, "note": f"UTR detected: {utr}"}

    receipt_status = (ocr.get("status") or "").lower()
    if receipt_status == "success":
        out["status"] = {"ok": True, "note": "Payment marked as successful"}
    elif receipt_status in ("failed", "pending"):
        out["status"] = {"ok": False, "note": f"Receipt shows status: {receipt_status}"}
    else:
        out["status"] = {"ok": False, "note": "Payment status not clearly visible"}

    receiver = (ocr.get("receiver_upi") or ocr.get("receiver_name") or "").lower().strip()
    pm = order.get("payment_method_snapshot") or {}
    expected_upi = (pm.get("upi_id") or "").lower().strip()
    expected_name = (pm.get("holder_name") or "").lower().strip()
    if not receiver:
        out["receiver"] = {"ok": False, "note": "Receiver not detected in receipt"}
    elif expected_upi and expected_upi in receiver:
        out["receiver"] = {"ok": True, "note": f"Paid to {expected_upi}"}
    elif expected_name and expected_name in receiver:
        out["receiver"] = {"ok": True, "note": f"Paid to {ocr.get('receiver_name')}"}
    else:
        target = expected_upi or expected_name or "expected payee"
        out["receiver"] = {"ok": False, "note": f"Receiver '{receiver}' may not match {target}"}

    return out
