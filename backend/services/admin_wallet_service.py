"""Admin treasury wallet dashboard — flow KPIs, all omnibus addresses, tx feed."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from listings.wallet_assets import BEP20_NETWORK
from services import blockchain_service
from services import treasury_service
from services import treasury_wallets_registry as tw_registry

IBO_ASSET = "IBO"
SIGNUP_SOURCE = "signup_bonus"
ERC20_ETH = "ERC-20 (Ethereum)"
TRC20_NETWORK = "TRC-20 (Tron)"

# Active deposit/withdrawal rails (no BTC hot/cold — user deposits are HD per user).
CHAIN_RAILS: Tuple[Tuple[str, str, str, str], ...] = (
    # network, label, chain_id (rpc), omnibus_asset for withdrawal row
    (BEP20_NETWORK, "BEP-20 · BNB Chain", "bsc", "IBO"),
    (ERC20_ETH, "ERC-20 · Ethereum", "eth", "ETH"),
    (TRC20_NETWORK, "TRC-20 · Tron", "tron", "USDT"),
)

CHAIN_DEPOSIT_HINT: Dict[str, str] = {
    BEP20_NETWORK: "Per-user HD address (BEP-20 on BSC)",
    ERC20_ETH: "Per-user HD address (ERC-20)",
    TRC20_NETWORK: "Per-user HD address (TRC-20)",
}

WD_DONE_STATUSES = ("confirmed", "broadcasting", "completed")
WD_PENDING_STATUSES = (
    "pending_approval", "awaiting_treasury", "approved", "broadcasting", "risk_hold",
)
DEP_PENDING_STATUSES = ("pending", "confirming", "pending_kyc")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _read_network_balance_parts(
    provider,
    *,
    network: str,
    omnibus_asset: str,
    address: Optional[str],
) -> List[Dict[str, Any]]:
    """Human balances shown on a chain row (may combine assets on the same address)."""
    if not address:
        return []
    net = network or ""
    ast = (omnibus_asset or "").strip().upper()
    parts: List[Dict[str, Any]] = []

    if net == BEP20_NETWORK:
        assets = ("IBO", "USDT", "BNB")
    elif net == ERC20_ETH and ast == "ETH":
        assets = ("ETH", "USDT")
    else:
        assets = (ast,)

    async def _fetch(asset: str) -> Dict[str, Any]:
        amt = await provider.read_deposit_address_balance_human(
            asset=asset, network=net, address=address,
        )
        return {"asset": asset, "amount": amt}

    fetched = await asyncio.gather(*[_fetch(a) for a in assets])
    parts.extend(fetched)
    return parts


async def _probe_bsc_rpc(provider) -> Dict[str, Any]:
    """Light health check for BSC JSON-RPC (primary + fallback)."""
    if not getattr(provider, "_bsc_rpc_url", None):
        return {"configured": False, "ok": False}
    try:
        await provider._rpc_bsc("eth_blockNumber", [])
        return {
            "configured": True,
            "ok": True,
            "fallback_url": bool(getattr(provider, "_bsc_fallback_url", None)),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "configured": True,
            "ok": False,
            "error": str(exc)[:200],
            "fallback_url": bool(getattr(provider, "_bsc_fallback_url", None)),
        }


def _signer_for_slot(asset: str, role: str) -> Optional[str]:
    ast = (asset or "").upper()
    r = (role or "").strip().lower()
    if r == "hot" and ast in ("ETH", "USDT", "IBO"):
        return tw_registry.treasury_signer_for_asset(ast)
    if r == "cold" and ast == "IBO":
        return tw_registry.treasury_cold_signer_address()
    return None


async def _omnibus_row(db, *, role: str, asset: str, network: str) -> Optional[Dict[str, Any]]:
    if db is None:
        return None
    doc = await db.treasury_wallets.find_one(
        {"role": role.strip().lower(), "asset": asset.upper(), "network": network},
        {"_id": 0},
        sort=[("enabled", -1), ("updated_at", -1)],
    )
    return tw_registry.wallet_doc_to_public(doc) if doc else None


async def _aggregate_flow_kpis(db) -> Dict[str, Any]:
    """Deposits, withdrawals, fees, and pending counts for admin wallet KPI row."""
    dep_match = {"status": "credited", "source": {"$ne": SIGNUP_SOURCE}}

    (
        dep_count,
        dep_rows,
        wd_count,
        wd_rows,
        fee_rows,
        dep_pending,
        wd_pending,
    ) = await asyncio.gather(
        db.deposit_events.count_documents(dep_match),
        db.deposit_events.aggregate([
            {"$match": dep_match},
            {"$group": {"_id": "$asset", "total": {"$sum": {"$ifNull": ["$credited_amount", {"$ifNull": ["$amount", 0]}]}}}},
        ]).to_list(length=100),
        db.withdrawal_requests.count_documents({"status": {"$in": list(WD_DONE_STATUSES)}}),
        db.withdrawal_requests.aggregate([
            {"$match": {"status": {"$in": list(WD_DONE_STATUSES)}}},
            {"$group": {"_id": "$asset", "total": {"$sum": {"$ifNull": ["$amount", 0]}}}},
        ]).to_list(length=100),
        db.withdrawal_requests.aggregate([
            {"$match": {"status": "confirmed"}},
            {
                "$group": {
                    "_id": None,
                    "platform_fee_ibo": {"$sum": {"$ifNull": ["$fee_amount", 0]}},
                    "gas_fee_ibo": {"$sum": {"$ifNull": ["$ibo_gas_fee", 0]}},
                    "fee_count": {"$sum": 1},
                },
            },
        ]).to_list(length=1),
        db.deposit_events.count_documents({"status": {"$in": list(DEP_PENDING_STATUSES)}}),
        db.withdrawal_requests.count_documents({"status": {"$in": list(WD_PENDING_STATUSES)}}),
    )
    deposits_by_asset = {
        str(r["_id"]).upper(): float(r.get("total") or 0)
        for r in dep_rows if r.get("_id")
    }
    deposits_volume = round(sum(deposits_by_asset.values()), 8)

    withdrawals_by_asset = {
        str(r["_id"]).upper(): float(r.get("total") or 0)
        for r in wd_rows if r.get("_id")
    }
    withdrawals_volume = round(sum(withdrawals_by_asset.values()), 8)

    fee_doc = fee_rows[0] if fee_rows else {}
    fees_ibo = round(
        float(fee_doc.get("platform_fee_ibo") or 0) + float(fee_doc.get("gas_fee_ibo") or 0),
        8,
    )
    fees_count = int(fee_doc.get("fee_count") or 0)

    return {
        "deposits_count": dep_count,
        "deposits_volume": deposits_volume,
        "deposits_by_asset": deposits_by_asset,
        "withdrawals_count": wd_count,
        "withdrawals_volume": withdrawals_volume,
        "withdrawals_by_asset": withdrawals_by_asset,
        "fees_ibo_total": fees_ibo,
        "fees_withdrawal_count": fees_count,
        "pending_deposits": dep_pending,
        "pending_withdrawals": wd_pending,
        "pending_total": dep_pending + wd_pending,
    }


def _chain_rpc_status(chain_id: str) -> Dict[str, Any]:
    from services.rpc_endpoints import get_registry

    reg = get_registry()
    env_ep = reg.get_env(chain_id)
    active_ep = reg.get(chain_id)
    env_url = bool(env_ep.http_url)
    active_url = bool(active_ep.http_url)
    return {
        "chain_id": chain_id,
        "rpc_configured": env_url,
        "rpc_active": active_url,
        "admin_disabled": env_url and not active_url,
    }


async def _deposit_rail_row(
    db, *, network: str, network_label: str, chain_id: str, omnibus_asset: str,
) -> Dict[str, Any]:
    """Deposit rail — per-user HD pool (no single platform deposit address)."""
    asset = omnibus_asset.upper()
    count = 0
    if db is not None:
        filt = {"network": network, "address": {"$exists": True, "$ne": ""}}
        count = await db.deposit_addresses.count_documents(filt)
    rpc = _chain_rpc_status(chain_id)
    return {
        "network": network,
        "network_label": network_label,
        "address_kind": "deposit",
        "type_label": "Deposit",
        "purpose": CHAIN_DEPOSIT_HINT.get(network, "Per-user HD deposit address"),
        "covers_hint": f"{count} user HD address{'es' if count != 1 else ''} on file",
        "asset": asset,
        "role": "deposit",
        "deposit_address_count": count,
        "address": None,
        "registered_address": None,
        "sample_address": None,
        "configured": count > 0,
        "signer_configured": False,
        "readonly": True,
        "editable": False,
        "balance_parts": [],
        "rpc": rpc,
        "status_note": (
            "Each user receives a unique HD deposit address (BLOCKCHAIN_MASTER_MNEMONIC). "
            "There is no single platform deposit wallet — view per-user addresses in Deposit events."
        ),
    }


async def _withdrawal_rail_row(
    db,
    provider,
    *,
    network: str,
    network_label: str,
    chain_id: str,
    omnibus_asset: str,
    balance_parts_cache: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Treasury payout wallet (hot omnibus + env signer)."""
    asset = omnibus_asset.upper()
    omni = await _omnibus_row(db, role="hot", asset=asset, network=network)
    if network == TRC20_NETWORK:
        signer = None
        reg_addr = ((omni or {}).get("address") or "").strip()
        if reg_addr.startswith("0x"):
            reg_addr = ""
        tron_fn = getattr(provider, "treasury_tron_address", None)
        tron_signer = tron_fn() if callable(tron_fn) else None
        registered = reg_addr or None
        display = registered or tron_signer
    else:
        signer = _signer_for_slot(asset, "hot")
        registered = (omni or {}).get("address")
        display = signer or registered
    rpc = _chain_rpc_status(chain_id)
    balance_parts: List[Dict[str, Any]] = []
    broadcast_assets = {
        BEP20_NETWORK: ("IBO", "USDT", "BNB"),
        ERC20_ETH: ("ETH", "USDT"),
        TRC20_NETWORK: ("TRX", "USDT"),
    }
    can_withdraw = (
        (asset in ("ETH", "USDT", "IBO", "BNB", "TRX"))
        and provider.can_broadcast(asset, network=network)
    )
    rpc_active = bool(rpc.get("rpc_active"))
    if display and can_withdraw and rpc_active:
        bal_key = f"{display.strip().lower()}|{network}|withdrawal"
        if bal_key not in balance_parts_cache:
            balance_parts_cache[bal_key] = await _read_network_balance_parts(
                provider, network=network, omnibus_asset=asset, address=display,
            )
        balance_parts = balance_parts_cache[bal_key]
    note = ""
    if network == TRC20_NETWORK:
        if rpc.get("rpc_configured"):
            note = (
                "Tron withdrawals use the treasury hot wallet (T… address derived from "
                "TREASURY_ETH_PRIVATE_KEY). Fund it with TRX for gas and USDT for payouts."
            )
        else:
            note = "Set QUICKNODE_TRON_URL to enable Tron withdrawals."
        if not display and (omni or {}).get("address", "").strip().startswith("0x"):
            note = (
                "Omnibus has an EVM address on file — replace it with a Tron (T…) treasury address."
            )
    elif rpc.get("admin_disabled"):
        note = "RPC URL is in .env but disabled in Admin → Settings → blockchain chains."
    elif not rpc.get("rpc_configured"):
        note = "RPC URL not configured for this chain."
    elif not display:
        note = "Register the withdrawal address (must match env treasury signer on EVM chains)."
    return {
        "network": network,
        "network_label": network_label,
        "address_kind": "withdrawal",
        "type_label": "Withdrawal",
        "purpose": "Platform payout & sweep destination",
        "covers_hint": ", ".join(broadcast_assets.get(network, ())) or asset,
        "asset": asset,
        "role": "hot",
        "label": (omni or {}).get("label") or f"Treasury withdrawal · {asset}",
        "wallet_id": (omni or {}).get("id"),
        "signer_address": signer,
        "registered_address": registered,
        "address": display,
        "configured": bool(display),
        "signer_configured": bool(signer),
        "enabled": (omni or {}).get("enabled", True) if omni else True,
        "readonly": False,
        "editable": True,
        "balance_parts": balance_parts,
        "rpc": rpc,
        "status_note": note,
    }


async def _build_treasury_rows(
    db, provider, *, balance_parts_cache: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> List[Dict[str, Any]]:
    cache: Dict[str, List[Dict[str, Any]]] = balance_parts_cache if balance_parts_cache is not None else {}
    tasks: List[Any] = []
    for network, label, chain_id, omnibus_asset in CHAIN_RAILS:
        tasks.append(_deposit_rail_row(
            db, network=network, network_label=label, chain_id=chain_id, omnibus_asset=omnibus_asset,
        ))
        tasks.append(_withdrawal_rail_row(
            db, provider,
            network=network,
            network_label=label,
            chain_id=chain_id,
            omnibus_asset=omnibus_asset,
            balance_parts_cache=cache,
        ))
    return list(await asyncio.gather(*tasks))


def _build_chain_cards(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group deposit + withdrawal rows per chain for card UI."""
    by_net: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        net = row.get("network") or ""
        if net not in by_net:
            by_net[net] = {
                "network": net,
                "network_label": row.get("network_label") or net,
                "rpc": row.get("rpc") or {},
                "deposit": None,
                "withdrawal": None,
            }
        kind = row.get("address_kind")
        if kind == "deposit":
            by_net[net]["deposit"] = row
        elif kind == "withdrawal":
            by_net[net]["withdrawal"] = row
            by_net[net]["rpc"] = row.get("rpc") or by_net[net].get("rpc") or {}
    return list(by_net.values())


def _onchain_cards_from_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Compact card payloads for treasury withdrawal wallets (live RPC balances)."""
    cards: List[Dict[str, Any]] = []
    for row in rows:
        if row.get("address_kind") != "withdrawal":
            continue
        net = row.get("network") or ""
        addr = (row.get("address") or "").strip() or None
        if net == TRC20_NETWORK and addr and addr.startswith("0x"):
            addr = None
        rpc = row.get("rpc") or {}
        balance_note = None
        if not rpc.get("rpc_active"):
            if rpc.get("admin_disabled"):
                balance_note = "RPC disabled in admin settings — balances not fetched."
            elif not rpc.get("rpc_configured"):
                balance_note = "RPC not configured — balances not fetched."
        cards.append({
            "id": f"{net}|withdrawal",
            "network": net,
            "network_label": row.get("network_label") or net,
            "role": "withdrawal",
            "role_label": "Withdrawal",
            "hint": row.get("covers_hint") or row.get("purpose") or "",
            "address": addr,
            "signer_configured": bool(row.get("signer_configured")) and net != TRC20_NETWORK,
            "balance_parts": row.get("balance_parts") or [],
            "balance_note": balance_note,
            "rpc": rpc,
        })
    return cards


async def get_ibo_omnibus_wallet(db, role: str) -> Optional[Dict[str, Any]]:
    """Return the enabled-or-latest IBO BEP-20 omnibus row for ``role`` (hot/cold)."""
    return await _omnibus_row(db, role=role, asset=IBO_ASSET, network=BEP20_NETWORK)


async def build_overview(db, *, signup_bonus_ibo: float) -> Dict[str, Any]:
    """Flow KPIs and treasury wallet cards with on-chain balances."""
    provider = blockchain_service.get_provider()
    balance_parts_cache: Dict[str, List[Dict[str, Any]]] = {}

    flow_kpis, treasury_rows, custody, bsc_rpc = await asyncio.gather(
        _aggregate_flow_kpis(db),
        _build_treasury_rows(db, provider, balance_parts_cache=balance_parts_cache),
        treasury_service.get_custody_reserves_summary(),
        _probe_bsc_rpc(provider),
    )
    chain_cards = _build_chain_cards(treasury_rows)
    onchain_cards = _onchain_cards_from_rows(treasury_rows)

    hot_signer = provider.treasury_address(IBO_ASSET)
    cold_signer = getattr(provider, "treasury_cold_address", lambda: None)()
    ibo_contract = (getattr(provider, "_ibo_contract", None) or os.getenv("IBO_CONTRACT_ADDRESS") or "").strip() or None

    custody_rows = list(custody.get("rows") or [])
    custody_expected_assets = {
        str(r.get("asset") or "").upper(): float(r.get("expected_net") or 0)
        for r in custody_rows if r.get("asset")
    }

    return {
        "asset": IBO_ASSET,
        "network": BEP20_NETWORK,
        "kpis": {
            **flow_kpis,
            "signup_bonus_per_user_ibo": float(signup_bonus_ibo or 0),
        },
        "treasury_rows": treasury_rows,
        "chain_cards": chain_cards,
        "onchain_cards": onchain_cards,
        "wallet_cards": treasury_rows,  # legacy alias for older admin builds
        "custody": {
            "rows": custody_rows,
            "expected_by_asset": custody_expected_assets,
            "note": (
                "Ledger custody = credited on-chain deposits minus confirmed withdrawals. "
                "User funds sit on per-user HD addresses until deposit sweep moves them to the "
                "withdrawal hot wallet below."
            ),
        },
        "addresses": {
            "ibo_contract": ibo_contract,
            "signup_bonus_cold": cold_signer,
        },
        "provider": {
            "can_broadcast_ibo": provider.can_broadcast(IBO_ASSET),
            "cold_signer_configured": bool(cold_signer),
            "hot_signer_configured": bool(hot_signer),
            "bsc_rpc": bsc_rpc,
        },
    }


def _matches_search(row: Dict[str, Any], q: str) -> bool:
    needle = (q or "").strip().lower()
    if not needle:
        return True
    hay = " ".join(
        str(row.get(k) or "")
        for k in ("tx_hash", "uid", "to_address", "from_address", "id", "status", "type", "asset", "network")
    ).lower()
    return needle in hay


def _deposit_from_address(ev: Dict[str, Any]) -> Optional[str]:
    raw = ev.get("raw") if isinstance(ev.get("raw"), dict) else {}
    for key in ("from", "from_address", "sender", "fromAddress"):
        val = raw.get(key)
        if val:
            return str(val).strip()
    topics = raw.get("topics")
    if isinstance(topics, list) and len(topics) > 1:
        t = str(topics[1] or "")
        if t.startswith("0x") and len(t) >= 42:
            return f"0x{t[-40:]}"
    return None


def _explorer_tx_url(network: Optional[str], tx_hash: Optional[str]) -> Optional[str]:
    h = (tx_hash or "").strip()
    if not h:
        return None
    net = (network or "").lower()
    if "tron" in net:
        return f"https://tronscan.org/#/transaction/{h}"
    if "ethereum" in net or net.startswith("erc"):
        return f"https://etherscan.io/tx/{h}"
    return f"https://bscscan.com/tx/{h}"


async def list_transactions(
    db,
    *,
    tx_type: Optional[str] = None,
    status: Optional[str] = None,
    uid: Optional[str] = None,
    tx_hash: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> Tuple[List[Dict[str, Any]], int]:
    """Unified treasury movements: inbound deposits, outbound payouts, internal sweeps."""
    provider = blockchain_service.get_provider()
    hot_addr = (provider.treasury_address(IBO_ASSET) or "").lower()
    cold_addr = (getattr(provider, "treasury_cold_address", lambda: None)() or "").lower()

    kind = (tx_type or "").strip().lower()
    want_deposit = not kind or kind in ("deposit", "all")
    want_bonus = not kind or kind in ("signup_bonus", "all")
    want_withdrawal = not kind or kind in ("withdrawal", "all")
    want_sweep = not kind or kind in ("sweep", "all")

    rows: List[Dict[str, Any]] = []

    def _date_range(target: Dict[str, Any]) -> None:
        if date_from or date_to:
            dr: Dict[str, Any] = {}
            if date_from:
                dr["$gte"] = date_from
            if date_to:
                dr["$lte"] = date_to
            target["created_at"] = dr

    dep_filt: Optional[Dict[str, Any]] = None
    bonus_filt: Optional[Dict[str, Any]] = None
    wd_filt: Optional[Dict[str, Any]] = None
    sweep_filt: Optional[Dict[str, Any]] = None

    if want_deposit:
        dep_filt = {
            "source": {"$ne": SIGNUP_SOURCE},
            "tx_hash": {"$exists": True, "$ne": ""},
        }
        if status:
            dep_filt["status"] = status.strip().lower()
        if uid:
            dep_filt["uid"] = uid.strip()
        if tx_hash:
            dep_filt["tx_hash"] = tx_hash.strip()
        _date_range(dep_filt)

    if want_bonus:
        bonus_filt = {"source": SIGNUP_SOURCE}
        if status:
            bonus_filt["status"] = status.strip().lower()
        if uid:
            bonus_filt["uid"] = uid.strip()
        if tx_hash:
            bonus_filt["tx_hash"] = tx_hash.strip()
        _date_range(bonus_filt)

    if want_withdrawal:
        wd_filt = {}
        if status:
            wd_filt["status"] = status.strip().lower()
        if uid:
            wd_filt["uid"] = uid.strip()
        if tx_hash:
            wd_filt["tx_hash"] = tx_hash.strip()
        _date_range(wd_filt)

    if want_sweep:
        sweep_filt = {}
        _date_range(sweep_filt)

    async def _load_dep() -> List[Dict[str, Any]]:
        if not dep_filt:
            return []
        return await db.deposit_events.find(dep_filt, {"_id": 0}).sort(
            "created_at", -1,
        ).limit(2000).to_list(length=2000)

    async def _load_bonus() -> List[Dict[str, Any]]:
        if not bonus_filt:
            return []
        return await db.deposit_events.find(bonus_filt, {"_id": 0, "raw": 0}).sort(
            "created_at", -1,
        ).limit(2000).to_list(length=2000)

    async def _load_wd() -> List[Dict[str, Any]]:
        if not wd_filt:
            return []
        return await db.withdrawal_requests.find(wd_filt, {"_id": 0}).sort(
            "created_at", -1,
        ).limit(2000).to_list(length=2000)

    async def _load_sweep() -> List[Dict[str, Any]]:
        if not sweep_filt:
            return []
        return await db.deposit_sweep_runs.find(sweep_filt, {"_id": 0}).sort(
            "created_at", -1,
        ).limit(500).to_list(length=500)

    dep_docs, bonus_docs, wd_docs, sweep_docs = await asyncio.gather(
        _load_dep(), _load_bonus(), _load_wd(), _load_sweep(),
    )

    for ev in dep_docs:
        amt = float(ev.get("credited_amount") or ev.get("amount") or 0)
        net = ev.get("network") or BEP20_NETWORK
        txh = ev.get("tx_hash")
        ts = ev.get("created_at") or ev.get("credited_at") or ev.get("first_seen_at")
        rows.append({
            "id": ev.get("id"),
            "type": "deposit",
            "direction": "in",
            "asset": (ev.get("asset") or "").upper() or None,
            "network": net,
            "amount": amt,
            "status": ev.get("status"),
            "uid": ev.get("uid"),
            "tx_hash": txh,
            "from_address": _deposit_from_address(ev),
            "to_address": ev.get("address"),
            "created_at": ts,
            "credited_at": ev.get("credited_at"),
            "confirmations": ev.get("confirmations"),
            "explorer_url": _explorer_tx_url(net, txh),
        })

    for ev in bonus_docs:
        net = ev.get("network") or BEP20_NETWORK
        txh = ev.get("tx_hash")
        rows.append({
            "id": ev.get("id"),
            "type": "signup_bonus",
            "direction": "out",
            "asset": (ev.get("asset") or IBO_ASSET).upper(),
            "network": net,
            "amount": float(ev.get("amount") or 0),
            "status": ev.get("status"),
            "uid": ev.get("uid"),
            "tx_hash": txh,
            "from_address": cold_addr or hot_addr or None,
            "to_address": ev.get("address"),
            "created_at": ev.get("created_at"),
            "credited_at": ev.get("credited_at"),
            "confirmations": ev.get("confirmations"),
            "explorer_url": _explorer_tx_url(net, txh),
        })

    for wd in wd_docs:
        net = wd.get("network") or BEP20_NETWORK
        txh = wd.get("tx_hash")
        rows.append({
            "id": wd.get("id"),
            "type": "withdrawal",
            "direction": "out",
            "asset": (wd.get("asset") or IBO_ASSET).upper(),
            "network": net,
            "amount": float(wd.get("amount") or 0),
            "status": wd.get("status"),
            "uid": wd.get("uid"),
            "tx_hash": txh,
            "from_address": hot_addr or None,
            "to_address": wd.get("address"),
            "created_at": wd.get("created_at"),
            "broadcasted_at": wd.get("broadcasted_at"),
            "completed_at": wd.get("completed_at"),
            "explorer_url": _explorer_tx_url(net, txh),
        })

    for run in sweep_docs:
        run_status = run.get("status")
        run_at = run.get("created_at")
        for idx, item in enumerate(run.get("items") or []):
            result = item.get("result") if isinstance(item.get("result"), dict) else {}
            txh = (result.get("tx_hash") or result.get("hash") or "").strip() or None
            if status and run_status != status.strip().lower() and not txh:
                continue
            net = item.get("network") or BEP20_NETWORK
            rows.append({
                "id": f"{run.get('id')}|{idx}",
                "type": "sweep",
                "direction": "internal",
                "asset": (item.get("asset") or "").upper() or None,
                "network": net,
                "amount": float(item.get("balance_human") or 0),
                "status": run_status or ("broadcasted" if txh else "planned"),
                "uid": item.get("uid"),
                "tx_hash": txh,
                "from_address": item.get("address"),
                "to_address": item.get("to_treasury_address"),
                "created_at": run_at,
                "explorer_url": _explorer_tx_url(net, txh),
            })

    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    if search and search.strip():
        rows = [r for r in rows if _matches_search(r, search)]

    total = len(rows)
    page = rows[int(skip) : int(skip) + int(limit)]
    return page, total


async def upsert_treasury_wallet_address(
    db,
    *,
    role: str,
    asset: str,
    network: str,
    address: str,
    label: Optional[str],
    enabled: bool,
    admin_aid: Optional[str],
    admin_email: Optional[str],
) -> Dict[str, Any]:
    """Create or update an omnibus row for any allowed treasury asset/network."""
    r = (role or "").strip().lower()
    if r not in ("hot", "cold", "deposit"):
        raise ValueError("role must be 'hot', 'cold', or 'deposit'")

    if r == "deposit":
        ast = (asset or "").strip().upper()
        net = (network or "").strip()
        if not ast or not net:
            raise ValueError("asset and network are required")
        try:
            addr = blockchain_service.validate_address(ast, address, net)
        except blockchain_service.BlockchainError as exc:
            raise ValueError(str(exc)) from exc
        norm = {
            "role": "deposit",
            "asset": ast,
            "network": net,
            "address": addr,
            "label": (label or "").strip()[:200] or None,
        }
    else:
        norm = tw_registry.validate_wallet_row(
            role=r,
            asset=asset,
            network=network,
            address=address,
            label=label,
        )
    now = _now_utc().isoformat()
    existing = await db.treasury_wallets.find_one(
        {"role": r, "asset": norm["asset"], "network": norm["network"]},
        {"_id": 0},
    )

    if existing:
        wid = existing["id"]
        before = tw_registry.wallet_doc_to_public(existing)
        updates = {
            **norm,
            "enabled": bool(enabled),
            "updated_at": now,
            "updated_by_aid": admin_aid,
            "updated_by_email": admin_email,
        }
        if r == "cold":
            updates["is_default_payout"] = False
        await db.treasury_wallets.update_one({"id": wid}, {"$set": updates})
        after_doc = await db.treasury_wallets.find_one({"id": wid}, {"_id": 0})
        pub = tw_registry.wallet_doc_to_public(after_doc or {})
        await tw_registry.append_audit(
            db,
            wallet_id=wid,
            action="updated",
            admin_aid=admin_aid,
            admin_email=admin_email,
            before=before,
            after=pub,
        )
        return pub

    wid = tw_registry.new_wallet_id()
    doc: Dict[str, Any] = {
        "id": wid,
        **norm,
        "enabled": bool(enabled),
        "is_default_payout": r == "hot",
        "created_at": now,
        "updated_at": now,
        "created_by_aid": admin_aid,
        "updated_by_aid": admin_aid,
        "created_by_email": admin_email,
        "updated_by_email": admin_email,
    }
    await db.treasury_wallets.insert_one(doc)
    pub = tw_registry.wallet_doc_to_public(doc)
    await tw_registry.append_audit(
        db,
        wallet_id=wid,
        action="created",
        admin_aid=admin_aid,
        admin_email=admin_email,
        before={},
        after=pub,
    )
    return pub


async def upsert_ibo_wallet_address(
    db,
    *,
    role: str,
    address: str,
    label: Optional[str],
    enabled: bool,
    admin_aid: Optional[str],
    admin_email: Optional[str],
) -> Dict[str, Any]:
    """Create or update the IBO BEP-20 omnibus row for hot/cold (admin-editable)."""
    return await upsert_treasury_wallet_address(
        db,
        role=role,
        asset=IBO_ASSET,
        network=BEP20_NETWORK,
        address=address,
        label=label,
        enabled=enabled,
        admin_aid=admin_aid,
        admin_email=admin_email,
    )
