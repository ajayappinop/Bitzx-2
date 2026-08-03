"""Tests for user-facing wallet / deposit / futures ledger labels."""

from services.wallet_ledger_present import (
    present_deposit_event,
    present_futures_wallet_txn,
    present_wallet_txn,
)


def test_present_wallet_txn_signup_bonus():
    out = present_wallet_txn({
        "id": "tx_1",
        "type": "deposit",
        "asset": "IBO",
        "meta": {"source": "signup_bonus", "tx_hash": "0xabc", "network": "BEP20"},
    })
    assert out["label"] == "Signup bonus"
    assert out["source"] == "signup_bonus"
    assert out["tx_hash"] == "0xabc"
    assert out["network"] == "BEP20"


def test_present_wallet_txn_futures_transfer():
    out = present_wallet_txn({
        "type": "adjustment",
        "ref_type": "futures_transfer",
        "meta": {"direction": "spot_to_futures"},
    })
    assert out["label"] == "Transfer to Futures"


def test_present_deposit_event_signup_bonus_pending_kyc():
    out = present_deposit_event({
        "asset": "IBO",
        "source": "signup_bonus",
        "status": "pending_kyc",
    })
    assert out["label"] == "Signup bonus"
    assert out["kind"] == "signup_bonus"
    assert "KYC" in out["status_note"]


def test_present_futures_wallet_txn_transfer_in():
    out = present_futures_wallet_txn({
        "type": "transfer_in",
        "meta": {"direction": "spot_to_futures"},
    })
    assert out["label"] == "Transfer from Spot"
