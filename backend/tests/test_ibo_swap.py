"""Unit tests for IBO ↔ USDT swap order sizing."""

import pytest

from services import ibo_swap as swap


def test_ibo_to_usdt_sell_side():
    side, qty = swap.build_market_order(
        "ibo_to_usdt",
        10.0,
        price_usdt=0.5,
        min_base_amount=0.0001,
        min_order_value_usdt=1.0,
    )
    assert side == "sell"
    assert qty == 10.0


def test_usdt_to_ibo_buy_side():
    side, qty = swap.build_market_order(
        "usdt_to_ibo",
        5.0,
        price_usdt=0.5,
        min_base_amount=0.0001,
        min_order_value_usdt=1.0,
    )
    assert side == "buy"
    assert qty == pytest.approx(10.0, rel=1e-6)


def test_rejects_below_min_usdt():
    with pytest.raises(ValueError, match="Minimum swap"):
        swap.build_market_order(
            "usdt_to_ibo",
            0.5,
            price_usdt=1.0,
            min_base_amount=0.0001,
            min_order_value_usdt=1.0,
        )


def test_estimate_ibo_to_usdt():
    out = swap.estimate_swap_output(
        "ibo_to_usdt",
        2.0,
        price_usdt=0.25,
        swap_fee_rate=0.001,
        swap_fee_ibo_fixed=0.0,
        ibo_price_usdt=0.25,
    )
    assert out["from_asset"] == "IBO"
    assert out["to_asset"] == "USDT"
    assert out["to_amount_estimated"] == pytest.approx(0.5, rel=1e-6)
    assert out["fee_ibo_estimated"] > 0
    assert out["fee_ibo_total"] >= out["fee_ibo_estimated"]


def test_swap_platform_fee_fixed_ibo():
    parts = swap.compute_swap_platform_fee_ibo(
        "usdt_to_ibo",
        10.0,
        price_usdt=0.5,
        swap_fee_rate=0.0,
        swap_fee_ibo_fixed=2.5,
        ibo_price_usdt=0.5,
    )
    assert parts["fee_ibo_estimated"] == pytest.approx(2.5, rel=1e-9)
