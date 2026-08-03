"""Phase 8d — Hedger worker.

A small polling loop that:

1. Reads ``platform_controls`` to decide whether the hedger is enabled
   at all (``hedger_enabled`` master switch).
2. For each tradable spot symbol (via the injected
   ``get_hedger_symbols`` callback) it:

   a. Resolves effective per-symbol config.
   b. Reads treasury position + current hedger_state.
   c. Runs :func:`services.hedger_service.suggest_hedge` to get the
      target side/qty.
   d. Persists the suggestion so the admin dashboard is always fresh.
   e. **Only if** mode == ``auto`` (and the master dry-run flag / kill
      switch permit) does it actually call
      :func:`services.hedger_service.execute_hedge`.

Manual mode symbols never touch Binance from inside the worker —
ops has to click "Execute" in the admin panel, which calls
:func:`services.hedger_service.execute_hedge` directly.

Safety:

- Opt-in via ``HEDGER_WORKER_ENABLED=true``. Silently no-ops without
  Binance credentials or with the master kill-switch off.
- Failures in one symbol never break the loop for the others —
  per-symbol exceptions are logged and swallowed.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Awaitable, Callable, Dict, List, Optional

from services import hedger_service, treasury_service
from services import alert_service
from services.hedger_service import (
    BinanceClient,
    HedgerError,
    HedgerSafetyError,
    UNHEDGEABLE_BASES,
    _base_from_symbol,
    resolve_symbol_config,
)

logger = logging.getLogger(__name__)

# GAP-7: Track consecutive HedgerSafetyError rejections per symbol.
# When a symbol is blocked by the safety gate _SAFETY_REJECT_ALERT_THRESHOLD
# times in a row, a HIGH alert is raised so ops can investigate (e.g. price
# sanity drift, persistent cooldown, mis-configured LOT_SIZE filter).
_safety_reject_streak: Dict[str, int] = {}
_SAFETY_REJECT_ALERT_THRESHOLD = 5


def _is_enabled() -> bool:
    val = (os.getenv("HEDGER_WORKER_ENABLED") or "").strip().lower()
    return val in ("1", "true", "yes", "on")


def _interval_sec() -> float:
    try:
        return max(3.0, float(os.getenv("HEDGER_WORKER_INTERVAL_SEC") or "15"))
    except ValueError:
        return 15.0


# ─────────────────────────────────────────────────────────────────────────────
# Per-symbol tick
# ─────────────────────────────────────────────────────────────────────────────

async def _tick_symbol(
    symbol: str,
    *,
    controls: Dict[str, Any],
    client: BinanceClient,
    treasury_mark_fn: Callable[[str], Optional[float]],
) -> None:
    sym = symbol.upper()
    base = _base_from_symbol(sym)
    if base in UNHEDGEABLE_BASES:
        return  # e.g. IBO — no external market

    cfg = resolve_symbol_config(controls, sym)

    # Treasury position + our running hedge offset.
    treasury_pos = await treasury_service.get_position(base)
    state = await hedger_service.get_state(sym)
    net_hedged = float(state.get("net_hedged_qty") or 0.0)

    suggestion = hedger_service.suggest_hedge(
        symbol=sym,
        treasury_pos_base=treasury_pos,
        net_hedged_qty=net_hedged,
        config=cfg,
    )
    # Store the most recent suggestion so the admin dashboard doesn't
    # have to recompute — also useful for audit ("why didn't we hedge?").
    suggestion_with_ctx = dict(suggestion)
    suggestion_with_ctx.update({
        "treasury_pos_base": treasury_pos,
        "net_hedged_qty":    net_hedged,
        "mode":              cfg["mode"],
    })
    await hedger_service.record_evaluation(sym, suggestion=suggestion_with_ctx)

    if cfg["mode"] != "auto":
        # MANUAL or OFF — the worker never fires. Suggestion is stored
        # for the UI; execution happens via the admin endpoint.
        return

    if suggestion.get("side") is None:
        # Within threshold — no hedge needed. Reset any rejection streak.
        _safety_reject_streak.pop(sym, None)
        return

    qty = float(suggestion.get("target_qty") or 0.0)
    if qty <= 0:
        return

    try:
        treasury_mark = treasury_mark_fn(base)
    except Exception:  # noqa: BLE001
        treasury_mark = None

    try:
        await hedger_service.execute_hedge(
            symbol=sym,
            side=suggestion["side"],
            qty=qty,
            reason=f"auto:{suggestion.get('reason', 'rebalance')}",
            initiator="worker",
            controls=controls,
            client=client,
            treasury_mark=treasury_mark,
            mode="auto",
        )
        # Success — reset the rejection streak.
        _safety_reject_streak.pop(sym, None)
    except HedgerSafetyError as exc:
        # GAP-7: Safety rails are *expected* (cooldown / sanity / LOT_SIZE).
        # Track consecutive rejections and alert if they pile up so ops can
        # investigate whether a filter or sanity threshold is mis-configured.
        streak = _safety_reject_streak.get(sym, 0) + 1
        _safety_reject_streak[sym] = streak
        logger.debug("hedger[%s]: skipped (streak=%d) — %s", sym, streak, exc)
        if streak >= _SAFETY_REJECT_ALERT_THRESHOLD:
            try:
                await alert_service.raise_alert(
                    type="hedger.safety.rejected_streak",
                    severity="high",
                    source="hedger_worker",
                    title=f"Hedger safety gate blocking {sym} ({streak} consecutive rejections)",
                    message=(
                        f"The hedger for {sym} has been blocked by a safety rule "
                        f"{streak} times in a row: {exc}. "
                        "Unhedged exposure may be growing. Check cooldown, price sanity "
                        "thresholds, LOT_SIZE/MIN_NOTIONAL filters, and Binance API status."
                    ),
                    meta={"symbol": sym, "streak": streak, "reason": str(exc)},
                    dedupe_key=f"hedger.safety.rejected_streak:{sym}",
                )
            except Exception:  # noqa: BLE001
                logger.exception("hedger[%s]: could not fire safety-streak alert", sym)
    except HedgerError as exc:
        logger.warning("hedger[%s]: hedge failed — %s", sym, exc)
    except Exception:  # noqa: BLE001
        logger.exception("hedger[%s]: unexpected error during auto-hedge", sym)


# ─────────────────────────────────────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────────────────────────────────────

async def _run_loop(
    *,
    get_platform_controls: Callable[[], Awaitable[Dict[str, Any]]],
    get_hedger_symbols: Callable[[], List[str]],
    treasury_mark_fn: Callable[[str], Optional[float]],
) -> None:
    interval = _interval_sec()
    client = await hedger_service.get_client()
    logger.info(
        "hedger_worker: started (testnet=%s, interval=%.1fs, creds=%s)",
        client.testnet, interval, "yes" if client.has_credentials else "no",
    )
    while True:
        try:
            controls = await get_platform_controls()
            if not controls.get("hedger_enabled", False):
                # Master kill-switch off — don't even iterate symbols.
                pass
            else:
                symbols = list(get_hedger_symbols() or [])
                for sym in symbols:
                    try:
                        await _tick_symbol(
                            sym,
                            controls=controls,
                            client=client,
                            treasury_mark_fn=treasury_mark_fn,
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception:  # noqa: BLE001
                        logger.exception("hedger_worker[%s]: tick failed", sym)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("hedger_worker: loop error — sleeping before retry")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise


def start(
    *,
    get_platform_controls: Callable[[], Awaitable[Dict[str, Any]]],
    get_hedger_symbols: Callable[[], List[str]],
    treasury_mark_fn: Callable[[str], Optional[float]],
) -> Optional[asyncio.Task]:
    """Kick off the hedger worker if enabled via env."""
    if not _is_enabled():
        logger.info(
            "hedger_worker: disabled (set HEDGER_WORKER_ENABLED=true to enable)",
        )
        return None
    task = asyncio.create_task(
        _run_loop(
            get_platform_controls=get_platform_controls,
            get_hedger_symbols=get_hedger_symbols,
            treasury_mark_fn=treasury_mark_fn,
        ),
        name="ibo-hedger-worker",
    )
    return task


async def stop(task: Optional[asyncio.Task]) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("hedger_worker: stop raised")
    await hedger_service.shutdown_client()
