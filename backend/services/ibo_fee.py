"""IBO-denominated trading fees (spot, futures, options).

Fee *rates* come from platform controls / module defaults (percent of notional).
Fee *settlement* is always in IBO from the user's spot ``wallets`` row.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from services.db import get_db
from services.errors import InsufficientFundsError
from services import wallet_service as spot_wallet

logger = logging.getLogger(__name__)

FEE_ASSET = "IBO"
_EPS = 1e-12

# Suggested starter values for admin UI only — never charged unless saved
# into ``platform_controls.withdraw_gas_fee_ibo`` / ``_by_chain``.
DEFAULT_WITHDRAW_GAS_FEE_IBO_BY_CHAIN: Dict[str, float] = {
    "bsc": 2.0,
    "eth": 15.0,
    "tron": 1.0,
    "btc": 5.0,
    "solana": 1.0,
}

_NETWORK_TO_CHAIN_ID: Dict[str, str] = {
    "BEP-20 (BNB Chain)": "bsc",
    "ERC-20 (Ethereum)": "eth",
    "TRC-20 (Tron)": "tron",
    "Bitcoin Network": "btc",
    "Solana": "solana",
}


def network_to_chain_id(network: Optional[str]) -> str:
    net = (network or "").strip()
    if not net:
        return ""
    if net in _NETWORK_TO_CHAIN_ID:
        return _NETWORK_TO_CHAIN_ID[net]
    lo = net.lower()
    if "bep-20" in lo or "bnb" in lo or lo == "bsc":
        return "bsc"
    if "erc-20" in lo or "ethereum" in lo or lo == "eth":
        return "eth"
    if "trc-20" in lo or "tron" in lo:
        return "tron"
    if "bitcoin" in lo or lo == "btc":
        return "btc"
    if "solana" in lo or lo == "sol":
        return "solana"
    return lo


def resolve_withdraw_gas_fee_ibo(
    controls: Optional[Dict[str, Any]],
    network: Optional[str],
    *,
    asset: Optional[str] = None,
) -> float:
    """IBO gas fee charged to the user for a withdrawal on ``network``.

    Real on-chain gas (BNB / ETH / TRX) is paid by the treasury; the user
    is always billed in IBO only. Amounts come **only** from admin
    ``platform_controls`` (Fees / Settings):

    1. ``withdraw_gas_fee_ibo_by_chain[chain_id]`` when that key is set
       (including ``0`` = no gas fee on that chain)
    2. Else flat ``withdraw_gas_fee_ibo`` (including ``0`` = no gas fee)

    Built-in ``DEFAULT_WITHDRAW_GAS_FEE_IBO_BY_CHAIN`` values are UI suggestions
    only — they are never applied automatically.
    """
    if (asset or "").strip().upper() == FEE_ASSET:
        return 0.0
    controls = controls or {}
    chain_id = network_to_chain_id(network)
    by_chain = controls.get("withdraw_gas_fee_ibo_by_chain") or {}
    if isinstance(by_chain, dict) and chain_id:
        raw = by_chain.get(chain_id)
        if raw is None:
            raw = by_chain.get(chain_id.upper()) or by_chain.get(chain_id.lower())
        if raw is not None and str(raw).strip() != "":
            try:
                return max(0.0, float(raw))
            except (TypeError, ValueError):
                pass
    try:
        flat = float(controls.get("withdraw_gas_fee_ibo") or 0.0)
    except (TypeError, ValueError):
        flat = 0.0
    return max(0.0, flat)


def withdraw_gas_fee_schedule(controls: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
    """Resolved IBO gas fee per chain_id for UI / admin previews."""
    controls = controls or {}
    out: Dict[str, float] = {}
    for cid in ("bsc", "eth", "tron", "btc", "solana"):
        out[cid] = resolve_withdraw_gas_fee_ibo(controls, cid, asset="USDT")
    return out


def suggested_withdraw_gas_fee_by_chain() -> Dict[str, float]:
    """Copy of starter per-chain IBO gas fees for admin forms."""
    return dict(DEFAULT_WITHDRAW_GAS_FEE_IBO_BY_CHAIN)


def _round(value: float, dp: int = 8) -> float:
    return round(float(value), dp)


async def resolve_ibo_usdt_price(controls: Optional[Dict[str, Any]] = None) -> float:
    """Best-effort IBO/USDT mark for USDT-notional → IBO fee conversion."""
    from ibo.pricing import platform_ibo_usdt_price

    return platform_ibo_usdt_price(controls)


def estimate_ibo_fee(
    *,
    quote_asset: str,
    quote_notional: float,
    fee_rate: float,
    ibo_price_usdt: float,
) -> float:
    """Return estimated IBO fee for a quote notional at ``fee_rate``."""
    q = float(max(quote_notional, 0.0))
    r = float(max(fee_rate, 0.0))
    if q <= 0 or r <= 0:
        return 0.0
    if str(quote_asset or "USDT").upper() == "IBO":
        return _round(q * r)
    px = float(ibo_price_usdt or 0.0)
    if px <= 0:
        return 0.0
    return _round((q * r) / px)


def usdt_notional_to_ibo_fee(usdt_fee: float, ibo_price_usdt: float) -> float:
    """Convert a USDT fee amount to IBO."""
    amt = float(max(usdt_fee, 0.0))
    if amt <= 0:
        return 0.0
    px = float(ibo_price_usdt or 0.0)
    if px <= 0:
        return 0.0
    return _round(amt / px)


async def read_ibo_available(uid: str) -> float:
    doc = await get_db()["wallets"].find_one(
        {"uid": uid, "asset": FEE_ASSET},
        {"_id": 0, "available": 1},
    )
    return float((doc or {}).get("available") or 0.0)


async def ensure_ibo_fee_balance(
    uid: str,
    fee_ibo: float,
    *,
    context: str = "trading",
) -> None:
    """Raise :class:`InsufficientFundsError` when spot IBO is too low."""
    need = float(max(fee_ibo, 0.0))
    if need <= _EPS:
        return
    avail = await read_ibo_available(uid)
    if avail + _EPS < need:
        raise InsufficientFundsError(
            uid, FEE_ASSET, have=avail, need=need, bucket="available",
        )


async def charge_ibo_fee(
    uid: str,
    fee_ibo: float,
    *,
    trade_id: str,
    ref_type: str = "trade",
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> float:
    """Debit ``fee_ibo`` from spot IBO. Returns amount charged."""
    amt = _round(float(fee_ibo or 0.0))
    if amt <= _EPS:
        return 0.0
    m = dict(meta or {})
    m.setdefault("fee_asset", FEE_ASSET)
    await spot_wallet.debit(
        uid,
        FEE_ASSET,
        amt,
        txn_type="fee",
        ref_type=ref_type,
        ref_id=trade_id,
        meta=m,
        session=session,
    )
    return amt


async def charge_ibo_fee_from_usdt(
    uid: str,
    usdt_fee: float,
    *,
    ibo_price_usdt: Optional[float] = None,
    trade_id: str,
    ref_type: str = "trade",
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> float:
    """Convert USDT fee → IBO and debit spot wallet. Returns IBO charged."""
    usdt = float(max(usdt_fee, 0.0))
    if usdt <= _EPS:
        return 0.0
    px = float(ibo_price_usdt or 0.0)
    if px <= 0:
        px = await resolve_ibo_usdt_price()
    fee_ibo = usdt_notional_to_ibo_fee(usdt, px)
    if fee_ibo <= _EPS:
        return 0.0
    m = dict(meta or {})
    m.setdefault("usdt_fee", usdt)
    m.setdefault("ibo_price_usdt", px)
    return await charge_ibo_fee(
        uid,
        fee_ibo,
        trade_id=trade_id,
        ref_type=ref_type,
        meta=m,
        session=session,
    )


async def credit_ibo_fee_sink(
    sink_uid: str,
    fee_ibo: float,
    *,
    trade_id: str,
    leg: str,
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> None:
    """Credit collected IBO fees to a treasury uid's spot wallet."""
    amt = _round(float(fee_ibo or 0.0))
    if amt <= _EPS or not sink_uid:
        return
    m = dict(meta or {})
    m.setdefault("leg", leg)
    m.setdefault("fee_asset", FEE_ASSET)
    await spot_wallet.credit(
        sink_uid,
        FEE_ASSET,
        amt,
        txn_type="fee",
        ref_type="trade_fee",
        ref_id=f"{trade_id}_{leg}",
        meta=m,
        session=session,
    )


async def rebate_ibo_from_usdt_sink(
    maker_uid: str,
    usdt_rebate: float,
    sink_uid: str,
    *,
    ibo_price_usdt: Optional[float] = None,
    trade_id: str,
    ref_type: str = "trade_rebate",
    meta: Optional[Dict[str, Any]] = None,
    session=None,
) -> float:
    """Debit IBO from ``sink_uid`` spot wallet and credit maker (USDT-notional rebate)."""
    usdt = float(max(usdt_rebate, 0.0))
    if usdt <= _EPS or not sink_uid:
        return 0.0
    px = float(ibo_price_usdt or 0.0)
    if px <= 0:
        px = await resolve_ibo_usdt_price()
    rebate_ibo = usdt_notional_to_ibo_fee(usdt, px)
    if rebate_ibo <= _EPS:
        return 0.0
    m = dict(meta or {})
    m.setdefault("usdt_rebate", usdt)
    m.setdefault("ibo_price_usdt", px)
    m.setdefault("fee_asset", FEE_ASSET)
    m.setdefault("role", "maker")
    await spot_wallet.debit(
        sink_uid,
        FEE_ASSET,
        rebate_ibo,
        txn_type="adjustment",
        ref_type=ref_type,
        ref_id=f"{trade_id}_maker_rebate_sink",
        meta={**m, "sink_uid": sink_uid},
        session=session,
    )
    await spot_wallet.credit(
        maker_uid,
        FEE_ASSET,
        rebate_ibo,
        txn_type="adjustment",
        ref_type=ref_type,
        ref_id=f"{trade_id}_maker_rebate",
        meta=m,
        session=session,
    )
    return rebate_ibo
