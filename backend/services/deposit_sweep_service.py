"""Phase 3 — deposit-address sweeps toward treasury hot (manual / dry-run first).

Balances are read via :class:`services.blockchain_service.QuickNodeProvider`.

**Live sweep support (EVM chains):**
- Native ETH  (ERC-20 Ethereum)  — fully implemented
- USDT ERC-20 (ERC-20 Ethereum)  — fully implemented
- IBO  BEP-20 (BEP-20 BNB Chain) — fully implemented
- USDT BEP-20 (BEP-20 BNB Chain) — fully implemented

**Not yet implemented (live broadcast):**
- BTC, TRX, SOL — listed in preview for visibility, dry-run only.

**Gas requirement for token sweeps:**
ERC-20/BEP-20 sweeps deduct gas from the deposit address itself
(ETH for Ethereum tokens, BNB for BSC tokens). If a deposit address
holds tokens but no native gas the sweep returns status
``insufficient_gas`` rather than failing the entire run.

Auto-sweep loops are intentionally absent — only admin-triggered runs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services import blockchain_service
from services import treasury_wallets_registry as tw_registry
from services.blockchain_service import QuickNodeProvider

logger = logging.getLogger(__name__)

# ── Price caching (in-process, refreshed per sweep run) ───────────────────────
_price_cache: Dict[str, Any] = {}
_PRICE_CACHE_TTL_SEC = 120  # reuse prices within the same run

import time as _time


async def _fetch_bnb_usdt_price() -> Optional[float]:
    """Fetch current BNB/USDT price. Falls back to env var SWEEP_BNB_USDT_PRICE."""
    # 1. Check env override
    env_price = os.getenv("SWEEP_BNB_USDT_PRICE", "").strip()
    if env_price:
        try:
            return float(env_price)
        except ValueError:
            pass

    # 2. Check in-process cache
    cached = _price_cache.get("bnb_usdt")
    if cached and (_time.time() - cached.get("at", 0)) < _PRICE_CACHE_TTL_SEC:
        return cached["price"]

    # 3. CoinGecko simple price (free, no key needed)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "binancecoin", "vs_currencies": "usd"},
            )
            if r.status_code == 200:
                price = float(r.json()["binancecoin"]["usd"])
                _price_cache["bnb_usdt"] = {"price": price, "at": _time.time()}
                return price
    except Exception as exc:  # noqa: BLE001
        logger.warning("deposit_sweep: BNB price fetch failed: %s", exc)

    return None


async def _fetch_ibo_usdt_price() -> Optional[float]:
    """Return IBO/USDT price using the platform pricing system."""
    try:
        from services import ibo_fee as ibo_fee_svc
        price = await ibo_fee_svc.resolve_ibo_usdt_price()
        if price and price > 0:
            return float(price)
    except Exception as exc:  # noqa: BLE001
        logger.warning("deposit_sweep: IBO price fetch failed: %s", exc)

    # Fallback env var
    env_price = os.getenv("SWEEP_IBO_USDT_PRICE", "").strip()
    if env_price:
        try:
            return float(env_price)
        except ValueError:
            pass

    return None


async def _calculate_gas_fee_ibo(
    gas_cost_bnb: float,
    *,
    decimals: int = 18,
) -> Dict[str, Any]:
    """Convert a BNB gas cost into IBO equivalent.

    Returns dict with keys:
      gas_fee_ibo       — amount in IBO (human units, 8 dp)
      gas_fee_ibo_base  — amount in smallest IBO units (int)
      bnb_price_usdt    — BNB/USDT used
      ibo_price_usdt    — IBO/USDT used
      gas_cost_usdt     — gas cost in USDT
      ok                — False if price unavailable
    """
    bnb_price = await _fetch_bnb_usdt_price()
    ibo_price = await _fetch_ibo_usdt_price()

    if not bnb_price or bnb_price <= 0:
        return {"ok": False, "error": "bnb_price_unavailable"}
    if not ibo_price or ibo_price <= 0:
        return {"ok": False, "error": "ibo_price_unavailable"}

    gas_cost_usdt = float(gas_cost_bnb) * float(bnb_price)
    gas_fee_ibo = round(gas_cost_usdt / float(ibo_price), 8)
    gas_fee_ibo_base = int(round(gas_fee_ibo * (10 ** decimals)))

    return {
        "ok": True,
        "gas_fee_ibo": gas_fee_ibo,
        "gas_fee_ibo_base": gas_fee_ibo_base,
        "bnb_price_usdt": round(bnb_price, 4),
        "ibo_price_usdt": round(ibo_price, 8),
        "gas_cost_usdt": round(gas_cost_usdt, 6),
        "gas_cost_bnb": round(gas_cost_bnb, 8),
    }


def _live_sweep_env_enabled() -> bool:
    return (os.getenv("DEPOSIT_SWEEP_LIVE_ENABLED") or "").strip().lower() in ("1", "true", "yes", "on")


def _min_human(asset: str) -> float:
    ast = (asset or "").strip().upper()
    if ast == "BTC":
        try:
            return max(0.0, float(os.getenv("DEPOSIT_SWEEP_MIN_BTC", "0.00005") or 0.00005))
        except ValueError:
            return 0.00005
    if ast == "ETH":
        try:
            return max(0.0, float(os.getenv("DEPOSIT_SWEEP_MIN_ETH", "0.0001") or 0.0001))
        except ValueError:
            return 0.0001
    if ast == "USDT":
        try:
            return max(0.0, float(os.getenv("DEPOSIT_SWEEP_MIN_USDT", "1.0") or 1.0))
        except ValueError:
            return 1.0
    return 0.0


def new_sweep_run_id() -> str:
    return f"dsw_{uuid.uuid4().hex[:18]}"


async def _load_candidate_addresses(
    db,
    *,
    asset: Optional[str],
    network: Optional[str],
    limit: int,
) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {"enabled": True, "uid": {"$exists": True, "$ne": None}}
    if asset:
        q["asset"] = asset.strip().upper()
    if network:
        q["network"] = network.strip()
    cur = (
        db.deposit_addresses.find(q, {"_id": 0})
        .sort("updated_at", -1)
        .limit(max(1, min(int(limit or 50), 500)))
    )
    return await cur.to_list(length=500)


async def plan_items(
    db,
    *,
    asset: Optional[str],
    network: Optional[str],
    limit: int,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Return sweep line-items with on-chain balances (best effort)."""
    if db is None:
        return [], None
    provider = blockchain_service.get_provider()
    read_fn = getattr(provider, "read_deposit_address_balance_human", None)
    if read_fn is None:
        return [], "Blockchain provider does not support balance reads for sweeps."

    rows = await _load_candidate_addresses(db, asset=asset, network=network, limit=limit)
    out: List[Dict[str, Any]] = []
    for row in rows:
        ast = str(row.get("asset") or "")
        net = str(row.get("network") or "")
        addr = str(row.get("address") or "").strip()
        if not addr or not tw_registry.is_allowed_v1(ast, net):
            continue
        try:
            bal = await read_fn(asset=ast, network=net, address=addr)  # type: ignore[misc]
        except Exception:  # noqa: BLE001
            logger.exception("deposit_sweep balance read failed id=%s", row.get("id"))
            bal = None
        min_h = _min_human(ast)
        sweepable = bal is not None and float(bal) > float(min_h)
        if tw_registry.is_allowed_v1(ast, net):
            gate_block = await tw_registry.treasury_gate_block_reason(db, ast, net)
            dest = tw_registry.treasury_signer_for_asset(ast) if gate_block is None else None
        else:
            gate_block = None
            dest = None
        out.append(
            {
                "deposit_address_id": row.get("id"),
                "uid": row.get("uid"),
                "asset": ast,
                "network": net,
                "address": addr,
                "derivation_index": row.get("derivation_index"),
                "balance_human": bal,
                "min_human": min_h,
                "sweepable": sweepable and dest is not None,
                "to_treasury_address": dest,
                "gate_block": gate_block,
            },
        )
    return out, None


# BSC gas amount sent per deposit address when auto_gas_fund=True.
# 0.0008 BNB ~ covers one BEP-20 transfer with headroom.
_DEFAULT_GAS_FUND_BNB = float(os.getenv("SWEEP_GAS_FUND_BNB", "0.0008") or 0.0008)
# ETH gas amount sent per deposit address (ERC-20 Ethereum).
_DEFAULT_GAS_FUND_ETH = float(os.getenv("SWEEP_GAS_FUND_ETH", "0.0005") or 0.0005)

# After funding we wait this many seconds for the tx to land before sweeping.
# BSC finalises in ~3 s; 6 s gives a safe margin.
_GAS_FUND_WAIT_SEC = int(os.getenv("SWEEP_GAS_FUND_WAIT_SEC", "6") or 6)


async def run_sweep(
    db,
    *,
    dry_run: bool,
    confirm_live: bool,
    asset: Optional[str],
    network: Optional[str],
    limit: int,
    idempotency_key: Optional[str],
    admin_aid: Optional[str],
    admin_panel_live_enabled: bool = False,
    auto_gas_fund: bool = False,
) -> Dict[str, Any]:
    """Persist a sweep run; live path is opt-in via env OR admin-panel toggle + ``confirm_live``.

    ``auto_gas_fund=True`` (live only): for token addresses that return
    ``insufficient_gas`` the hot wallet automatically sends a small amount of
    native gas (BNB for BSC, ETH for Ethereum) to the deposit address, waits
    ``_GAS_FUND_WAIT_SEC`` for it to land, then retries the token sweep.
    The gas-funding tx hash and cost are stored on the item result.
    """
    if db is None:
        return {"ok": False, "error": "database_unavailable"}

    idem = (idempotency_key or "").strip() or None
    if idem:
        existing = await db.deposit_sweep_runs.find_one({"idempotency_key": idem}, {"_id": 0})
        if existing:
            return {"ok": True, "replay": True, "run": existing}

    items, err = await plan_items(db, asset=asset, network=network, limit=limit)
    if err:
        return {"ok": False, "error": err}

    run_id = new_sweep_run_id()
    now = datetime.now(timezone.utc).isoformat()
    mode = "dry_run" if dry_run else "live"
    run_doc: Dict[str, Any] = {
        "id": run_id,
        "mode": mode,
        "status": "running",
        "dry_run": bool(dry_run),
        "created_at": now,
        "updated_at": now,
        "created_by_aid": admin_aid,
        "idempotency_key": idem,
        "items": [],
    }

    provider = blockchain_service.get_provider()
    # Live sweeps are allowed when EITHER the server env var is set OR the
    # admin enabled the toggle in the admin panel (platform controls DB flag).
    live_flag = _live_sweep_env_enabled() or bool(admin_panel_live_enabled)
    live_ok = live_flag and confirm_live and not dry_run

    if not dry_run and not live_ok:
        run_doc["status"] = "refused"
        run_doc["refusal_reason"] = (
            "Live sweeps require the 'Live Sweep' toggle to be ON in the admin panel "
            "(Hot & Cold Wallets page), dry_run=false, and confirm_live=true."
        )
        run_doc["items"] = items
        await db.deposit_sweep_runs.insert_one(dict(run_doc))
        return {"ok": True, "run": {k: v for k, v in run_doc.items() if k != "_id"}}

    processed: List[Dict[str, Any]] = []

    # Supported EVM assets (native or token) that can be swept using the HD key.
    _NATIVE_EVM = {("ETH", "ERC-20 (Ethereum)")}
    _TOKEN_EVM = {
        ("USDT", "ERC-20 (Ethereum)"),
        ("IBO",  "BEP-20 (BNB Chain)"),
        ("USDT", "BEP-20 (BNB Chain)"),
    }

    for it in items:
        entry = dict(it)
        entry["result"] = None
        ast = it["asset"]
        net = it.get("network", "")
        asset_net = (ast, net)

        if not it.get("sweepable"):
            entry["skipped_reason"] = "below_min_or_not_sweepable_or_no_destination"
            processed.append(entry)
            continue

        idx = it.get("derivation_index")
        to_addr = it.get("to_treasury_address")
        if idx is None or not to_addr:
            entry["skipped_reason"] = "missing_derivation_index_or_destination"
            processed.append(entry)
            continue

        if not isinstance(provider, QuickNodeProvider):
            entry["skipped_reason"] = "blockchain_provider_unsupported"
            processed.append(entry)
            continue

        # ── native ETH sweep ───────────────────────────────────────────────
        if asset_net in _NATIVE_EVM:
            try:
                entry["result"] = await provider.sweep_eth_native_deposit_to_treasury(
                    derivation_index=int(idx),
                    deposit_address=str(it["address"]),
                    to_address=str(to_addr),
                    dry_run=(not live_ok),
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("deposit_sweep ETH failed id=%s", it.get("deposit_address_id"))
                entry["result"] = {"ok": False, "error": str(exc)}
            processed.append(entry)
            continue

        # ── ERC-20 / BEP-20 token sweep (with optional gas-station) ───────
        if asset_net in _TOKEN_EVM:
            dep_addr = str(it["address"])
            # IBO decimals from env (same as blockchain_service uses)
            ibo_decimals = 18
            try:
                ibo_decimals = int(os.getenv("IBO_TOKEN_DECIMALS", "18") or 18)
            except ValueError:
                pass
            token_decimals = ibo_decimals if ast == "IBO" else (6 if ast == "USDT" and "Ethereum" in net else 18)

            try:
                res = await provider.sweep_erc20_deposit_to_treasury(
                    derivation_index=int(idx),
                    deposit_address=dep_addr,
                    to_address=str(to_addr),
                    asset=ast,
                    network=net,
                    dry_run=(not live_ok),
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "deposit_sweep %s/%s failed id=%s", ast, net, it.get("deposit_address_id"),
                )
                res = {"ok": False, "error": str(exc)}

            # ── Gas-station: fund then deduct fee and retry ────────────────
            no_gas = (
                live_ok
                and auto_gas_fund
                and isinstance(res, dict)
                and not res.get("ok")
                and str(res.get("error", "")).startswith("insufficient_gas")
            )
            if no_gas:
                chain = "bsc" if "BNB" in net else "eth"
                if chain == "bsc":
                    fund_wei = int(_DEFAULT_GAS_FUND_BNB * 1e18)
                    fund_bnb = _DEFAULT_GAS_FUND_BNB
                else:
                    fund_wei = int(_DEFAULT_GAS_FUND_ETH * 1e18)
                    fund_bnb = _DEFAULT_GAS_FUND_ETH

                # ── Calculate gas fee in IBO and check if deposit has enough ──
                ibo_balance_human = float(it.get("balance_human") or 0.0)
                min_balance = float(_min_human(ast))
                gas_fee_info = await _calculate_gas_fee_ibo(fund_bnb, decimals=token_decimals)

                if not gas_fee_info.get("ok"):
                    # Price unavailable: skip this address
                    res = {
                        "ok": False,
                        "error": f"gas_fee_price_unavailable: {gas_fee_info.get('error')}",
                        "token_balance_human": ibo_balance_human,
                    }
                    entry["result"] = res
                    entry["gas_fee_info"] = gas_fee_info
                    processed.append(entry)
                    continue

                gas_fee_ibo = float(gas_fee_info["gas_fee_ibo"])
                gas_fee_ibo_base = int(gas_fee_info["gas_fee_ibo_base"])

                # Net sweep amount = full balance minus gas fee
                net_sweep_human = round(ibo_balance_human - gas_fee_ibo, 8)
                if net_sweep_human <= min_balance:
                    res = {
                        "ok": False,
                        "error": "insufficient_ibo_after_gas_fee",
                        "token_balance_human": ibo_balance_human,
                        "gas_fee_ibo": gas_fee_ibo,
                        "net_sweep_human": net_sweep_human,
                        "min_balance": min_balance,
                    }
                    entry["result"] = res
                    entry["gas_fee_info"] = gas_fee_info
                    processed.append(entry)
                    continue

                net_sweep_base = max(0, int(round(net_sweep_human * (10 ** token_decimals))))
                entry["gas_fee_info"] = gas_fee_info
                entry["gas_fee_ibo"] = gas_fee_ibo
                entry["net_sweep_human"] = net_sweep_human

                logger.info(
                    "deposit_sweep gas_station: funding %s (%s) with %s wei on %s; "
                    "deducting %.8f %s as gas fee",
                    dep_addr[:12], ast, fund_wei, chain, gas_fee_ibo, ast,
                )
                try:
                    fund_res = await provider.send_native_gas_to_address(
                        to_address=dep_addr,
                        amount_wei=fund_wei,
                        chain=chain,
                    )
                except Exception as exc:  # noqa: BLE001
                    fund_res = {"ok": False, "error": str(exc)}

                entry["gas_fund_result"] = fund_res

                if fund_res.get("ok"):
                    # Wait for gas tx to land before sweeping
                    await asyncio.sleep(_GAS_FUND_WAIT_SEC)
                    logger.info(
                        "deposit_sweep gas_station: sweeping %.8f %s (net after fee) from %s",
                        net_sweep_human, ast, dep_addr[:12],
                    )
                    try:
                        res = await provider.sweep_erc20_deposit_to_treasury(
                            derivation_index=int(idx),
                            deposit_address=dep_addr,
                            to_address=str(to_addr),
                            asset=ast,
                            network=net,
                            dry_run=False,
                            amount_base_override=net_sweep_base,
                        )
                        if res.get("ok"):
                            res["gas_fee_ibo"] = gas_fee_ibo
                            res["gas_fee_info"] = gas_fee_info
                    except Exception as exc:  # noqa: BLE001
                        logger.exception(
                            "deposit_sweep %s/%s retry failed id=%s", ast, net, it.get("deposit_address_id"),
                        )
                        res = {"ok": False, "error": str(exc)}
                else:
                    logger.warning(
                        "deposit_sweep gas_station: funding failed for %s: %s",
                        dep_addr[:12], fund_res.get("error"),
                    )
                    res = {"ok": False, "error": f"gas_fund_failed: {fund_res.get('error')}",
                           "token_balance_human": ibo_balance_human}

            entry["result"] = res
            processed.append(entry)
            continue

        # ── not yet implemented (BTC, TRX, SOL, …) ─────────────────────────
        if live_ok:
            entry["skipped_reason"] = f"live_sweep_not_implemented_for_{ast}"
        else:
            entry["dry_run_only"] = True
            entry["result"] = {"ok": False, "dry_run": True,
                               "error": f"live_sweep_not_implemented_for_{ast}"}
        processed.append(entry)

    # ── build per-asset transfer summary ─────────────────────────────────
    summary: Dict[str, Any] = {
        "total_addresses": len(processed),
        "swept": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run_previewed": 0,
        "insufficient_gas": 0,
        "insufficient_ibo_for_fee": 0,
        "gas_funded": 0,
        "gas_fund_total_wei": 0,
        "total_gas_fee_ibo": 0.0,
        "by_asset": {},
    }
    for entry in processed:
        ast_key = f"{entry.get('asset', '?')}|{entry.get('network', '?')}"
        bucket = summary["by_asset"].setdefault(ast_key, {
            "asset": entry.get("asset"), "network": entry.get("network"),
            "swept": 0, "swept_amount": 0.0,
            "total_gas_fee_ibo": 0.0,
            "skipped": 0, "failed": 0, "dry_run_previewed": 0,
            "insufficient_gas": 0, "insufficient_ibo_for_fee": 0, "gas_funded": 0,
        })
        res = entry.get("result")
        skip_reason = entry.get("skipped_reason") or entry.get("dry_run_only")

        # Count gas-funding events
        gf = entry.get("gas_fund_result")
        if gf and gf.get("ok"):
            summary["gas_funded"] += 1
            bucket["gas_funded"] += 1
            summary["gas_fund_total_wei"] += int(gf.get("amount_wei") or 0)

        # Accumulate gas fee IBO charged
        fee_ibo = float(entry.get("gas_fee_ibo") or 0.0)
        if fee_ibo > 0:
            summary["total_gas_fee_ibo"] = round(summary["total_gas_fee_ibo"] + fee_ibo, 8)
            bucket["total_gas_fee_ibo"] = round(bucket["total_gas_fee_ibo"] + fee_ibo, 8)

        if skip_reason:
            summary["skipped"] += 1
            bucket["skipped"] += 1
        elif res is None:
            summary["skipped"] += 1
            bucket["skipped"] += 1
        elif isinstance(res, dict):
            err = str(res.get("error") or "")
            if res.get("dry_run"):
                summary["dry_run_previewed"] += 1
                bucket["dry_run_previewed"] += 1
            elif res.get("ok"):
                summary["swept"] += 1
                bucket["swept"] += 1
                # prefer sweep_amount_human (partial sweep after fee), fall back to full balance
                amt = float(res.get("sweep_amount_human") or res.get("token_balance_human") or 0)
                if res.get("value_wei") and not res.get("token_balance_human"):
                    amt = float(res["value_wei"]) / 1e18
                bucket["swept_amount"] = round(bucket["swept_amount"] + amt, 8)
            elif err.startswith("insufficient_gas"):
                summary["insufficient_gas"] += 1
                bucket["insufficient_gas"] += 1
            elif err.startswith("insufficient_ibo_after_gas_fee"):
                summary["insufficient_ibo_for_fee"] += 1
                bucket["insufficient_ibo_for_fee"] += 1
            else:
                summary["failed"] += 1
                bucket["failed"] += 1

    run_doc["items"] = processed
    run_doc["summary"] = summary
    run_doc["status"] = "completed"
    run_doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.deposit_sweep_runs.insert_one(dict(run_doc))
    pub = {k: v for k, v in run_doc.items() if k != "_id"}
    return {"ok": True, "run": pub}
