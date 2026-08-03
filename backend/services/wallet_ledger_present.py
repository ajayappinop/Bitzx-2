"""User-facing labels for spot / deposit / futures ledger rows."""

from __future__ import annotations

from typing import Any, Dict, Optional


def _meta(doc: Dict[str, Any]) -> Dict[str, Any]:
    raw = doc.get("meta")
    return raw if isinstance(raw, dict) else {}


def present_wallet_txn(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Add ``label``, ``source``, and top-level hash/network for client history UIs."""
    out = dict(doc)
    meta = _meta(out)
    source = str(meta.get("source") or out.get("source") or "").strip().lower()
    ref_type = str(out.get("ref_type") or "").strip().lower()
    txn_type = str(out.get("type") or "").strip().lower()
    direction = str(meta.get("direction") or "").strip().lower()

    label: Optional[str] = None
    if source == "signup_bonus":
        label = "Signup bonus"
    elif ref_type == "futures_transfer":
        label = (
            "Transfer to Futures"
            if direction == "spot_to_futures"
            else "Transfer from Futures"
            if direction == "futures_to_spot"
            else "Futures transfer"
        )
    elif txn_type == "deposit" and ref_type == "deposit_event":
        label = "On-chain deposit"
    elif txn_type == "withdraw":
        label = "Withdrawal"
    elif txn_type == "trade":
        label = "Trade"
    elif txn_type == "fee":
        phase = str(meta.get("phase") or "").lower()
        fee_kind = str(meta.get("fee_kind") or "").lower()
        if "withdrawal" in phase and ("gas" in phase or fee_kind == "gas"):
            label = "Withdrawal gas fee"
        elif "withdrawal" in phase or fee_kind == "platform" or ref_type == "withdrawal":
            label = "Withdrawal fee"
        elif "swap" in phase or ref_type == "swap":
            label = "Swap fee"
        else:
            label = "Trading fee"
    elif txn_type == "adjustment" and not label:
        label = "Balance adjustment"

    if label:
        out["label"] = label
    if source:
        out["source"] = source

    if not out.get("tx_hash") and meta.get("tx_hash"):
        out["tx_hash"] = meta.get("tx_hash")
    if not out.get("network") and meta.get("network"):
        out["network"] = meta.get("network")
    if not out.get("address") and meta.get("address"):
        out["address"] = meta.get("address")
    if not out.get("note") and label:
        out["note"] = label
    return out


def present_deposit_event(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Annotate ``deposit_events`` rows for deposit history screens."""
    out = dict(doc)
    source = str(out.get("source") or "").strip().lower()
    asset = str(out.get("asset") or "").strip().upper() or "—"
    status = str(out.get("status") or "").strip().lower()

    if source == "signup_bonus":
        out["label"] = "Signup bonus"
        out["kind"] = "signup_bonus"
        if status == "pending_kyc":
            out["status_note"] = "Complete KYC to receive in trading wallet"
        elif status in ("pending", "confirming"):
            out["status_note"] = "On-chain transfer confirming"
    else:
        out["label"] = f"{asset} deposit"
        out["kind"] = "on_chain_deposit"

    if status == "credited":
        out["status_note"] = out.get("status_note") or "Credited to trading wallet"
    return out


_FUTURES_TYPE_LABELS = {
    "transfer_in": "Transfer from Spot",
    "transfer_out": "Transfer to Spot",
    "margin_lock": "Margin locked",
    "margin_unlock": "Margin released",
    "realized_pnl": "Realized PnL",
    "fee": "Trading fee",
    "funding": "Funding payment",
    "liquidation": "Liquidation",
    "insurance": "Insurance fund",
    "adjustment": "Balance adjustment",
}


def present_futures_wallet_txn(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Annotate ``futures_wallet_txns`` for futures wallet history."""
    out = dict(doc)
    txn_type = str(out.get("type") or "").strip().lower()
    meta = _meta(out)
    direction = str(meta.get("direction") or "").strip().lower()

    label = _FUTURES_TYPE_LABELS.get(txn_type)
    if txn_type == "transfer_in" and direction == "spot_to_futures":
        label = "Transfer from Spot"
    elif txn_type == "transfer_out" and direction == "futures_to_spot":
        label = "Transfer to Spot"

    if label:
        out["label"] = label
    if not out.get("note") and label:
        out["note"] = label
    return out
