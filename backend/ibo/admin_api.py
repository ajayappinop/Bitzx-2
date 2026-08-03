"""Admin API for the IBO Trading Ecosystem.

Mounts at /admin/ibo and exposes 8 management surfaces:
  1.  Dashboard   — KPIs: volume, active pairs, top holders, treasury IBO
  2.  Price       — override IBO base price and per-pair spread BPS
  3.  Liquidity   — toggle synthetic liquidity, depth levels, spread default
  4.  Pairs       — enable/disable each IBO-quoted pair, set min/max sizes
  5.  Wallet / Supply — user IBO holdings summary + treasury position
  6.  Deposits / Withdrawals — IBO asset-filtered history
  7.  User Holdings — paginated user IBO balances
  8.  Analytics & Logs — volume, trade counts, spread revenue over time
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from .constants import IBO_CONTROL_DEFAULTS, IBO_QUOTED_PAIRS, IBO_QUOTED_SYMBOL_MAP

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/ibo", tags=["IBO Admin"])

# ── Dependency injection stubs ─────────────────────────────────────────────────
# These are resolved at startup by server.py calling _register_deps() so we
# avoid circular imports from the giant server.py.

_deps: Dict[str, Any] = {}


def _register_deps(**kwargs: Any) -> None:
    """Called by server.py at startup to inject db, get_platform_controls, and
    the admin auth resolver."""
    _deps.update(kwargs)


def _db():
    return _deps.get("db")


async def _controls() -> Dict[str, Any]:
    fn = _deps.get("get_platform_controls")
    if fn:
        return await fn()
    return dict(IBO_CONTROL_DEFAULTS)


_http_bearer = HTTPBearer(auto_error=False)


async def _require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_http_bearer),
    x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key"),
):
    """Validates admin credentials using the resolver injected at startup."""
    fn = _deps.get("require_admin")
    if fn is None:
        raise HTTPException(status_code=503, detail="Admin auth not configured")
    try:
        return await fn(credentials=credentials, x_admin_key=x_admin_key)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Admin access required") from exc


# ── Pydantic models ────────────────────────────────────────────────────────────

class IBOPriceUpdate(BaseModel):
    ibo_price_override:       Optional[float] = Field(None, gt=0)
    ibo_spread_bps_default:   Optional[float] = Field(None, ge=0, le=500)
    ibo_spread_bps_by_symbol: Optional[Dict[str, float]] = None


class IBOLiquidityUpdate(BaseModel):
    ibo_liquidity_enabled:  Optional[bool]  = None
    ibo_market_depth_levels: Optional[int]  = Field(None, ge=5, le=100)
    ibo_spread_bps_default:  Optional[float] = Field(None, ge=0, le=500)


class IBOPairUpdate(BaseModel):
    enabled:       Optional[bool]  = None
    min_order_size: Optional[float] = Field(None, ge=0)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_range(since: datetime, until: datetime) -> Dict[str, str]:
    return {"$gte": since.isoformat(), "$lt": until.isoformat()}


def _ibo_trading_symbols() -> List[str]:
    """All IBO-quoted symbols (core majors + dynamic Web3 catalog)."""
    symbols = set(IBO_QUOTED_PAIRS)
    try:
        from listings.ibo_pairs import get_tradable_ibo_pairs

        symbols.update(get_tradable_ibo_pairs())
    except Exception:  # noqa: BLE001
        logger.debug("ibo admin: dynamic pair list unavailable", exc_info=True)
    return sorted(symbols)


def _ibo_symbol_mongo_filter() -> Dict[str, Any]:
    syms = _ibo_trading_symbols()
    if syms:
        return {"symbol": {"$in": syms}}
    return {"symbol": {"$regex": r"^[A-Z0-9]{2,12}IBO$"}}


def _normalize_trade_log(row: Dict[str, Any]) -> Dict[str, Any]:
    """Shape trade rows for admin Analytics & Logs table."""
    taker_fee = float(row.get("taker_fee") or 0)
    maker_fee = float(row.get("maker_fee") or 0)
    return {
        **row,
        "side": row.get("taker_side") or row.get("side") or "",
        "fee_amount": round(taker_fee + maker_fee, 8),
    }


async def _get_user_ibo_balances() -> List[Dict[str, Any]]:
    """Return all wallet rows for asset=IBO."""
    db = _db()
    if db is None:
        return []
    cursor = db.wallets.find({"asset": "IBO"}, {"_id": 0})
    return await cursor.to_list(length=None)


async def _sum_usdt_volume_ibo_pairs(
    since: datetime, until: datetime,
) -> Dict[str, float]:
    """Aggregate trade volume on IBO-quoted pairs within [since, until)."""
    db = _db()
    if db is None:
        return {}
    pipeline = [
        {"$match": {
            **_ibo_symbol_mongo_filter(),
            "created_at": _iso_range(since, until),
        }},
        {"$group": {
            "_id": "$symbol",
            "volume_base":  {"$sum": "$amount"},
            "volume_quote": {"$sum": {"$multiply": ["$amount", "$price"]}},
            "trade_count":  {"$sum": 1},
            "fee_revenue":  {
                "$sum": {
                    "$add": [
                        {"$ifNull": ["$taker_fee", 0]},
                        {"$ifNull": ["$maker_fee", 0]},
                    ],
                },
            },
        }},
    ]
    rows = await db.trades.aggregate(pipeline).to_list(length=None)
    return {r["_id"]: r for r in rows}


# ── 1. Dashboard ───────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def ibo_dashboard(admin=Depends(_require_admin)):
    controls = await _controls()
    db = _db()

    ibo_price = float(controls.get("ibo_price_override") or 0.4523)
    all_symbols = _ibo_trading_symbols()
    enabled_map = dict(controls.get("ibo_pairs_enabled") or {})
    active_pairs = [s for s in all_symbols if enabled_map.get(s, True)]

    # 24-h stats
    now   = datetime.now(timezone.utc)
    since = now - timedelta(hours=24)
    vol_by_pair = await _sum_usdt_volume_ibo_pairs(since, now)
    total_volume_ibo = sum(
        float(v.get("volume_quote") or 0) for v in vol_by_pair.values()
    )
    total_trades = sum(int(v.get("trade_count") or 0) for v in vol_by_pair.values())

    # IBO holdings
    balances = await _get_user_ibo_balances()
    total_user_ibo = sum(
        float(b.get("available") or 0) + float(b.get("locked") or 0)
        for b in balances
    )

    # Treasury IBO
    treasury_ibo = 0.0
    if db is not None:
        tw = await db.wallets.find_one({"uid": "SYSTEM", "asset": "IBO"}, {"_id": 0})
        treasury_ibo = float((tw or {}).get("available", 0)) + float((tw or {}).get("locked", 0))

    return {
        "ibo_price_usdt":    ibo_price,
        "active_pairs":      len(active_pairs),
        "total_pairs":       len(all_symbols),
        "volume_24h_ibo":    round(total_volume_ibo, 4),
        "trades_24h":        total_trades,
        "total_user_ibo":    round(total_user_ibo, 4),
        "treasury_ibo":      round(treasury_ibo, 4),
        "ibo_liquidity":     bool(controls.get("ibo_liquidity_enabled", True)),
        "spread_bps":        float(controls.get("ibo_spread_bps_default") or 25),
        "updated_at":        _now_utc(),
        "pairs": [
            {
                "symbol":  s,
                "base":    IBO_QUOTED_SYMBOL_MAP.get(s) or s.replace("IBO", ""),
                "enabled": enabled_map.get(s, True),
                "volume_ibo": round(float(vol_by_pair.get(s, {}).get("volume_quote") or 0), 4),
                "volume_quote": float(vol_by_pair.get(s, {}).get("volume_quote") or 0),
                "trade_count": int(vol_by_pair.get(s, {}).get("trade_count") or 0),
                "priceChangePercent": 0,
            }
            for s in sorted(
                all_symbols,
                key=lambda sym: -float(vol_by_pair.get(sym, {}).get("volume_quote") or 0),
            )[:48]
        ],
    }


# ── 2. Price Management ────────────────────────────────────────────────────────

@router.get("/price")
async def ibo_get_price(admin=Depends(_require_admin)):
    controls = await _controls()
    return {
        "ibo_price_override":       controls.get("ibo_price_override"),
        "ibo_spread_bps_default":   float(controls.get("ibo_spread_bps_default") or 25),
        "ibo_spread_bps_by_symbol": controls.get("ibo_spread_bps_by_symbol") or {},
        "pairs":                    IBO_QUOTED_PAIRS,
    }


@router.patch("/price")
async def ibo_update_price(body: IBOPriceUpdate, admin=Depends(_require_admin)):
    db = _db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    updates: Dict[str, Any] = {}
    if body.ibo_price_override is not None:
        updates["ibo_price_override"] = body.ibo_price_override
    if body.ibo_spread_bps_default is not None:
        updates["ibo_spread_bps_default"] = body.ibo_spread_bps_default
    if body.ibo_spread_bps_by_symbol is not None:
        allowed = set(_ibo_trading_symbols())
        for sym in body.ibo_spread_bps_by_symbol:
            if allowed and sym not in allowed:
                raise HTTPException(400, f"Unknown IBO pair: {sym}")
        updates["ibo_spread_bps_by_symbol"] = body.ibo_spread_bps_by_symbol

    if not updates:
        raise HTTPException(400, "No valid fields to update")

    updates["updated_at"] = _now_utc()
    await db.platform_controls.update_one(
        {"id": "global"}, {"$set": updates}, upsert=True
    )
    return {"ok": True, "updated": list(updates.keys())}


@router.delete("/price/override")
async def ibo_clear_price_override(admin=Depends(_require_admin)):
    db = _db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await db.platform_controls.update_one(
        {"id": "global"},
        {"$unset": {"ibo_price_override": ""}, "$set": {"updated_at": _now_utc()}},
        upsert=True,
    )
    return {"ok": True, "detail": "IBO price override cleared; using built-in constant"}


# ── 3. Liquidity Management ───────────────────────────────────────────────────

@router.get("/liquidity")
async def ibo_get_liquidity(admin=Depends(_require_admin)):
    controls = await _controls()
    return {
        "ibo_liquidity_enabled":   bool(controls.get("ibo_liquidity_enabled", True)),
        "ibo_market_depth_levels": int(controls.get("ibo_market_depth_levels") or 20),
        "ibo_spread_bps_default":  float(controls.get("ibo_spread_bps_default") or 25),
    }


@router.patch("/liquidity")
async def ibo_update_liquidity(body: IBOLiquidityUpdate, admin=Depends(_require_admin)):
    db = _db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    updates: Dict[str, Any] = {}
    if body.ibo_liquidity_enabled is not None:
        updates["ibo_liquidity_enabled"] = body.ibo_liquidity_enabled
    if body.ibo_market_depth_levels is not None:
        updates["ibo_market_depth_levels"] = body.ibo_market_depth_levels
    if body.ibo_spread_bps_default is not None:
        updates["ibo_spread_bps_default"] = body.ibo_spread_bps_default

    if not updates:
        raise HTTPException(400, "No valid fields to update")

    updates["updated_at"] = _now_utc()
    await db.platform_controls.update_one(
        {"id": "global"}, {"$set": updates}, upsert=True
    )
    return {"ok": True, "updated": list(updates.keys())}


# ── 4. Trading Pairs ──────────────────────────────────────────────────────────

@router.get("/pairs")
async def ibo_get_pairs(admin=Depends(_require_admin)):
    controls = await _controls()
    enabled_map = dict(controls.get("ibo_pairs_enabled") or {})
    min_size_map = dict(controls.get("ibo_min_order_size") or {})

    return {
        "pairs": [
            {
                "symbol":        s,
                "base":          IBO_QUOTED_SYMBOL_MAP.get(s) or s.replace("IBO", ""),
                "quote":         "IBO",
                "enabled":       enabled_map.get(s, True),
                "min_order_size": float(min_size_map.get(s, 0)),
            }
            for s in _ibo_trading_symbols()
        ]
    }


@router.patch("/pairs/{symbol}")
async def ibo_update_pair(
    symbol: str,
    body: IBOPairUpdate,
    admin=Depends(_require_admin),
):
    sym = symbol.upper()
    allowed = set(_ibo_trading_symbols())
    if allowed and sym not in allowed:
        raise HTTPException(404, f"IBO pair {sym} not found")

    db = _db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    updates: Dict[str, Any] = {}
    if body.enabled is not None:
        updates[f"ibo_pairs_enabled.{sym}"] = body.enabled
    if body.min_order_size is not None:
        updates[f"ibo_min_order_size.{sym}"] = body.min_order_size

    if not updates:
        raise HTTPException(400, "No valid fields to update")

    updates["updated_at"] = _now_utc()
    await db.platform_controls.update_one(
        {"id": "global"}, {"$set": updates}, upsert=True
    )
    return {"ok": True, "symbol": sym, "updated": list(updates.keys())}


# ── 5. Wallet & Supply ────────────────────────────────────────────────────────

@router.get("/wallet-supply")
async def ibo_wallet_supply(admin=Depends(_require_admin)):
    db = _db()
    if db is None:
        return {"total_user_ibo": 0, "treasury_ibo": 0, "holder_count": 0, "breakdown": []}

    balances = await _get_user_ibo_balances()
    user_rows = [b for b in balances if b.get("uid") != "SYSTEM"]
    sys_row   = next((b for b in balances if b.get("uid") == "SYSTEM"), {})

    total_user    = sum(float(b.get("available") or 0) + float(b.get("locked") or 0) for b in user_rows)
    treasury_ibo  = float(sys_row.get("available") or 0) + float(sys_row.get("locked") or 0)

    controls = await _controls()
    price = float(controls.get("ibo_price_override") or 0.4523)

    return {
        "total_user_ibo":    round(total_user, 4),
        "treasury_ibo":      round(treasury_ibo, 4),
        "holder_count":      len(user_rows),
        "ibo_price_usdt":    price,
        "total_user_usdt_equiv": round(total_user * price, 2),
        "updated_at":        _now_utc(),
    }


# ── 6. Deposits / Withdrawals ─────────────────────────────────────────────────

@router.get("/deposits-withdrawals")
async def ibo_deposits_withdrawals(
    type:  str = Query("all", pattern="^(all|deposit|withdrawal)$"),
    asset: Optional[str] = Query(None, description="Filter by asset (e.g. IBO, USDT)"),
    page:  int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    admin=Depends(_require_admin),
):
    """Platform deposit events + withdrawal requests (all assets).

    Uses ``deposit_events`` (on-chain pipeline) — the legacy ``deposits`` collection
    is no longer written in Phase 4+.
    """
    db = _db()
    if db is None:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    skip = (page - 1) * limit
    asset_f = (asset or "").strip().upper()
    asset_match: Dict[str, Any] = {}
    if asset_f:
        asset_match["asset"] = asset_f

    if type == "deposit":
        filt = dict(asset_match)
        total = await db.deposit_events.count_documents(filt)
        rows = await db.deposit_events.find(
            filt, {"_id": 0, "raw": 0},
        ).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
        items = [{**r, "_type": "deposit"} for r in rows]
        return {"items": items, "total": total, "page": page, "limit": limit}

    if type == "withdrawal":
        filt = dict(asset_match)
        total = await db.withdrawal_requests.count_documents(filt)
        rows = await db.withdrawal_requests.find(
            filt, {"_id": 0},
        ).sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
        items = [{**r, "_type": "withdrawal"} for r in rows]
        return {"items": items, "total": total, "page": page, "limit": limit}

    # Combined timeline — merge deposit_events + withdrawal_requests
    dep_filt = dict(asset_match)
    wdr_filt = dict(asset_match)
    dep_total = await db.deposit_events.count_documents(dep_filt)
    wdr_total = await db.withdrawal_requests.count_documents(wdr_filt)
    combined_total = dep_total + wdr_total

    fetch_n = min(skip + limit, 500)
    dep_rows = await db.deposit_events.find(
        dep_filt, {"_id": 0, "raw": 0},
    ).sort("created_at", -1).limit(fetch_n).to_list(length=fetch_n)
    wdr_rows = await db.withdrawal_requests.find(
        wdr_filt, {"_id": 0},
    ).sort("created_at", -1).limit(fetch_n).to_list(length=fetch_n)

    merged: List[Dict[str, Any]] = []
    for r in dep_rows:
        merged.append({**r, "_type": "deposit"})
    for r in wdr_rows:
        merged.append({**r, "_type": "withdrawal"})
    merged.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    page_rows = merged[skip : skip + limit]

    return {
        "items": page_rows,
        "total": combined_total,
        "page": page,
        "limit": limit,
        "counts": {"deposits": dep_total, "withdrawals": wdr_total},
    }


# ── 7. User Holdings ─────────────────────────────────────────────────────────

@router.get("/user-holdings")
async def ibo_user_holdings(
    page:   int = Query(1, ge=1),
    limit:  int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort:   str = Query("balance_desc", pattern="^(balance_desc|balance_asc|uid_asc)$"),
    admin=Depends(_require_admin),
):
    db = _db()
    if db is None:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    query: Dict[str, Any] = {"asset": "IBO", "uid": {"$ne": "SYSTEM"}}
    if search:
        query["uid"] = {"$regex": search, "$options": "i", "$ne": "SYSTEM"}

    total = await db.wallets.count_documents(query)
    sort_key = {"balance_desc": [("available", -1)], "balance_asc": [("available", 1)], "uid_asc": [("uid", 1)]}[sort]
    rows = await db.wallets.find(query, {"_id": 0}).sort(sort_key).skip((page - 1) * limit).limit(limit).to_list(length=None)

    controls = await _controls()
    price = float(controls.get("ibo_price_override") or 0.4523)

    items = []
    for r in rows:
        available = float(r.get("available") or 0)
        locked    = float(r.get("locked") or 0)
        total_ibo = available + locked
        items.append({
            "uid":          r.get("uid"),
            "available":    round(available, 8),
            "locked":       round(locked, 8),
            "total_ibo":    round(total_ibo, 8),
            "usdt_equiv":   round(total_ibo * price, 4),
            "updated_at":   r.get("updated_at"),
        })

    return {"items": items, "total": total, "page": page, "limit": limit}


# ── 8. Analytics & Logs ───────────────────────────────────────────────────────

@router.get("/analytics")
async def ibo_analytics(
    window: str = Query("24h", pattern="^(1h|24h|7d|30d)$"),
    admin=Depends(_require_admin),
):
    windows = {"1h": 1, "24h": 24, "7d": 168, "30d": 720}
    hours   = windows[window]
    now     = datetime.now(timezone.utc)
    since   = now - timedelta(hours=hours)

    vol_by_pair = await _sum_usdt_volume_ibo_pairs(since, now)

    symbols = sorted(
        set(_ibo_trading_symbols()) | set(vol_by_pair.keys()),
        key=lambda sym: -float(vol_by_pair.get(sym, {}).get("volume_quote") or 0),
    )
    pairs_data = []
    for sym in symbols:
        d = vol_by_pair.get(sym, {})
        pairs_data.append({
            "symbol":       sym,
            "base":         IBO_QUOTED_SYMBOL_MAP.get(sym) or sym.replace("IBO", ""),
            "volume_base":  round(float(d.get("volume_base") or 0), 4),
            "volume_ibo":   round(float(d.get("volume_quote") or 0), 4),
            "trade_count":  int(d.get("trade_count") or 0),
            "fee_revenue":  round(float(d.get("fee_revenue") or 0), 8),
        })

    return {
        "window":      window,
        "since":       since.isoformat(),
        "until":       now.isoformat(),
        "pairs":       pairs_data,
        "totals": {
            "volume_ibo":  round(sum(p["volume_ibo"]  for p in pairs_data), 4),
            "trade_count": sum(p["trade_count"] for p in pairs_data),
            "fee_revenue": round(sum(p["fee_revenue"] for p in pairs_data), 8),
        },
    }


@router.get("/logs")
async def ibo_logs(
    symbol: Optional[str] = Query(None),
    page:   int = Query(1, ge=1),
    limit:  int = Query(50, ge=1, le=200),
    admin=Depends(_require_admin),
):
    db = _db()
    if db is None:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    query: Dict[str, Any] = dict(_ibo_symbol_mongo_filter())
    if symbol:
        sym = symbol.upper()
        allowed = set(_ibo_trading_symbols())
        if allowed and sym not in allowed:
            raise HTTPException(400, f"Unknown IBO pair: {sym}")
        query = {"symbol": sym}

    total = await db.trades.count_documents(query)
    rows  = await db.trades.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(length=None)

    return {
        "items": [_normalize_trade_log(r) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
    }
