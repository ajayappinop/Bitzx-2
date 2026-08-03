"""In-process QuickNode RPC / WS usage meter (zero log parsing, minimal hot-path cost).

Counters roll up per UTC hour and per chain. Only the last few hours are kept in memory.
"""

from __future__ import annotations

import os
import time
from threading import Lock
from typing import Any, Dict, Optional

# QuickNode credit estimates (documentation / ops planning — not billing truth).
_METHOD_CREDITS: Dict[str, int] = {
    "eth_getLogs": 75,
    "eth_getBlockByNumber": 16,
    "eth_blockNumber": 10,
    "eth_getBalance": 15,
    "eth_call": 26,
    "eth_getTransactionReceipt": 15,
    "eth_getTransactionCount": 15,
    "eth_sendRawTransaction": 50,
    "eth_estimateGas": 26,
    "eth_chainId": 10,
    "eth_maxPriorityFeePerGas": 10,
    "scantxoutset": 100,
    "bb_getUTXOs": 40,
    "getSignaturesForAddress": 20,
    "getTransaction": 20,
}
_DEFAULT_METHOD_CREDITS = 12
_WS_HEAD_CREDITS_EST = 1  # newHead push — plan-dependent; rough planning value

_MAX_HOURS_RETAINED = 3
_lock = Lock()
_buckets: Dict[int, Dict[str, Any]] = {}
_host_chain_cache: Dict[str, str] = {}
_host_cache_ts: float = 0.0
_HOST_CACHE_TTL = 300.0


def _empty_bucket() -> Dict[str, Any]:
    return {
        "rpc": {},       # chain_id -> {calls, methods: {method: n}}
        "ws_heads": {},  # chain_id -> int
        "poller_ticks": 0,
        "poller_idle_ticks": 0,
    }


def _prune_locked() -> None:
    if len(_buckets) <= _MAX_HOURS_RETAINED:
        return
    for hk in sorted(_buckets.keys())[:- _MAX_HOURS_RETAINED]:
        _buckets.pop(hk, None)


def _method_credits(method: str, count: int) -> int:
    unit = _METHOD_CREDITS.get(method, _DEFAULT_METHOD_CREDITS)
    return unit * max(0, count)


def _refresh_host_chain_cache() -> None:
    global _host_chain_cache, _host_cache_ts
    now = time.monotonic()
    if now - _host_cache_ts < _HOST_CACHE_TTL and _host_chain_cache:
        return
    try:
        from services.rpc_endpoints import endpoint_key, get_registry

        reg = get_registry()
        m: Dict[str, str] = {}
        for cid in ("btc", "eth", "bsc", "tron", "solana"):
            ep = reg.get_env(cid)
            if ep.http_url:
                m[endpoint_key(ep.http_url)] = cid
        _host_chain_cache = m
        _host_cache_ts = now
    except Exception:
        pass


def resolve_chain_for_url(url: str) -> str:
    """Map QuickNode HTTP URL host to logical chain id."""
    if not url:
        return "unknown"
    _refresh_host_chain_cache()
    try:
        from services.rpc_endpoints import endpoint_key

        return _host_chain_cache.get(endpoint_key(url), "unknown")
    except Exception:
        return "unknown"


def record_rpc(url: str, method: str) -> None:
    """Called once per outbound JSON-RPC HTTP request (hot path)."""
    chain = resolve_chain_for_url(url)
    hk = int(time.time() // 3600)
    with _lock:
        b = _buckets.setdefault(hk, _empty_bucket())
        ch = b["rpc"].setdefault(chain, {"calls": 0, "methods": {}})
        ch["calls"] += 1
        methods = ch["methods"]
        methods[method] = methods.get(method, 0) + 1
        if len(methods) > 40:
            # Bound memory: fold overflow into "_other"
            other = methods.pop("_other", 0)
            for k in list(methods.keys()):
                if k not in (
                    "eth_getLogs", "eth_getBlockByNumber", "eth_blockNumber",
                    "eth_getBalance", "eth_call", "getSignaturesForAddress",
                ):
                    other += methods.pop(k, 0)
            methods["_other"] = other
        _prune_locked()


def record_ws_head(chain_id: str) -> None:
    hk = int(time.time() // 3600)
    cid = (chain_id or "unknown").lower()
    with _lock:
        b = _buckets.setdefault(hk, _empty_bucket())
        b["ws_heads"][cid] = b["ws_heads"].get(cid, 0) + 1
        _prune_locked()


def record_poller_tick(*, idle: bool = False) -> None:
    hk = int(time.time() // 3600)
    with _lock:
        b = _buckets.setdefault(hk, _empty_bucket())
        if idle:
            b["poller_idle_ticks"] += 1
        else:
            b["poller_ticks"] += 1
        _prune_locked()


def _summarize_bucket(hk: int, data: Dict[str, Any]) -> Dict[str, Any]:
    chains_out: Dict[str, Any] = {}
    credits_total = 0
    rpc_calls = 0

    for chain_id, ch in (data.get("rpc") or {}).items():
        methods = ch.get("methods") or {}
        ch_credits = sum(_method_credits(m, c) for m, c in methods.items())
        calls = int(ch.get("calls") or 0)
        rpc_calls += calls
        credits_total += ch_credits
        chains_out[chain_id] = {
            "rpc_calls": calls,
            "methods": dict(sorted(methods.items(), key=lambda x: -x[1])[:15]),
            "credits_est": ch_credits,
        }

    ws_heads = data.get("ws_heads") or {}
    ws_credits = sum(int(v) for v in ws_heads.values()) * _WS_HEAD_CREDITS_EST
    credits_total += ws_credits

    return {
        "hour_start_unix": hk * 3600,
        "hour_start_iso": time.strftime("%Y-%m-%dT%H:00:00Z", time.gmtime(hk * 3600)),
        "rpc_calls_total": rpc_calls,
        "ws_heads": dict(ws_heads),
        "ws_heads_total": sum(int(v) for v in ws_heads.values()),
        "poller_ticks": int(data.get("poller_ticks") or 0),
        "poller_idle_ticks": int(data.get("poller_idle_ticks") or 0),
        "credits_est_total": credits_total,
        "chains": chains_out,
    }


def get_usage_snapshot(*, hours: int = 2) -> Dict[str, Any]:
    """Admin API payload — read-only, no RPC calls."""
    hours = max(1, min(int(hours or 2), _MAX_HOURS_RETAINED))
    now = time.time()
    cur_hk = int(now // 3600)

    with _lock:
        hour_keys = sorted(_buckets.keys())[-hours:]
        summaries = [_summarize_bucket(hk, _buckets[hk]) for hk in hour_keys]

    cur = summaries[-1] if summaries and summaries[-1]["hour_start_unix"] == cur_hk * 3600 else None
    if cur is None:
        with _lock:
            if cur_hk in _buckets:
                cur = _summarize_bucket(cur_hk, _buckets[cur_hk])

    elapsed = max(1.0, now - cur_hk * 3600) if cur else 3600.0
    rpc_cur = (cur or {}).get("rpc_calls_total") or 0
    cred_cur = (cur or {}).get("credits_est_total") or 0

    return {
        "current_hour_unix": cur_hk * 3600,
        "current_hour_iso": time.strftime("%Y-%m-%dT%H:00:00Z", time.gmtime(cur_hk * 3600)),
        "hours_retained": _MAX_HOURS_RETAINED,
        "hours": summaries,
        "current_hour": cur,
        "rates_current_hour": {
            "elapsed_sec": round(elapsed, 1),
            "rpc_per_minute": round(rpc_cur / elapsed * 60, 2),
            "rpc_per_second": round(rpc_cur / elapsed, 3),
            "credits_est_per_minute": round(cred_cur / elapsed * 60, 1),
            "credits_est_per_second": round(cred_cur / elapsed, 2),
        },
        "throttle": {
            "rpc_max_concurrency": int(os.getenv("RPC_MAX_CONCURRENCY", "2")),
            "rpc_min_interval_ms": int(os.getenv("RPC_MIN_INTERVAL_MS", "120")),
            "rpc_max_retries": int(os.getenv("RPC_MAX_RETRIES", "4")),
        },
        "notes": [
            "Counts are in-process since API server start (resets on restart).",
            "credits_est_* uses static method weights (~75 for filtered eth_getLogs); verify on QuickNode dashboard.",
            "poller_idle_ticks = block wakes with zero deposit addresses (no HTTP RPC).",
        ],
    }


def reset_usage_counters() -> None:
    """Test / admin reset."""
    with _lock:
        _buckets.clear()
