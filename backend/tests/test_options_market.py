"""Tests for options market-data providers and greeks."""

from __future__ import annotations

from options.providers.binance import internal_to_binance_symbol
from options.services import greeks as greeks_svc
from options.providers.registry import get_index_provider, get_local_provider


def test_greeks_include_rho():
    out = greeks_svc.compute_greeks(
        S=100.0,
        K=100.0,
        T=30 / 365.0,
        option_type="call",
        mid_price=3.5,
    )
    assert out.get("rho") is not None
    assert out.get("delta") is not None


def test_provider_registry_defaults():
    assert get_index_provider().name in ("binance_options", "deribit", "local")
    assert get_local_provider().name == "local"


def test_internal_to_binance_symbol():
    assert internal_to_binance_symbol("optc_BTC_20260627_95000_C") == "BTC-260627-95000-C"
    assert internal_to_binance_symbol("optc_ETH_20251231_3200p5_P") == "ETH-251231-3200.5-P"
