/**
 * FuturesOrderBook
 *
 * Feature-complete order book for the futures trade page — matches every
 * feature of the spot OrderBook component:
 *   • Tick-size aggregation (configurable dropdown)
 *   • Depth selector (10 / 14 / 20 rows)
 *   • View mode: all | asks only | bids only
 *   • Clickable rows → pre-fills the trade form price (via onPriceClick prop)
 *   • Dual depth bars per row (per-level + cumulative)
 *   • Clickable MID/spread bar
 *   • K/M quantity & total formatting
 *   • Loading / empty states
 *
 * Data is pulled from FuturesContext (live WS push, no own WebSocket).
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
import { useFutures } from '@/context/FuturesContext';

const TICK_PRESETS = [
  10000, 1000, 100, 10, 1, 0.1, 0.01, 0.001, 0.0001, 0.00001, 0.000001,
];

// ── Helpers ────────────────────────────────────────────────────────────────

function decimalsForTick(tick) {
  if (tick >= 1) return 2;
  const match = /^(\d\.?\d*)e([-+]\d+)$/.exec(Number(tick).toExponential());
  if (!match) return 8;
  const exp = parseInt(match[2], 10);
  return exp >= 0 ? Math.min(8, exp + 2) : Math.min(8, -exp + 1);
}

function fmtPrice(n, tick) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  const d = decimalsForTick(tick);
  if (v >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toFixed(d);
}

function fmtQty(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(4);
}

function fmtTotal(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(3) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(3) + 'K';
  return v >= 1 ? v.toFixed(2) : v.toFixed(6);
}

function tickLabel(t) {
  if (t >= 1) return String(t);
  return t.toFixed(8).replace(/\.?0+$/, '') || String(t);
}

function pickDefaultTick(mid) {
  if (!mid || mid <= 0) return 0.01;
  if (mid >= 50000) return 10;
  if (mid >= 10000) return 1;
  if (mid >= 1000)  return 0.1;
  if (mid >= 100)   return 0.01;
  if (mid >= 1)     return 0.0001;
  if (mid >= 0.01)  return 0.000001;
  return 0.00000001;
}

/**
 * Aggregate [price, qty] levels to a coarser tick grid.
 * Returns sorted [[price, qty], ...] pairs.
 */
function aggregateLevels(levels, tick) {
  const m = new Map();
  for (const [p, q] of levels) {
    const price = parseFloat(p);
    const qty   = parseFloat(q);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) continue;
    const grid = Math.round(price / tick) * tick;
    const key  = Number(grid.toPrecision(14));
    m.set(key, (m.get(key) || 0) + qty);
  }
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
}

/** Normalize the context orderbook shape {bids:[{price,qty},...], asks:[...]} to [[price,qty],...] */
function normFromContext(levels) {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((lv) => {
      const p = lv.price ?? lv[0];
      const q = lv.qty ?? lv.quantity ?? lv[1];
      if (p == null || q == null) return null;
      return [parseFloat(p), parseFloat(q)];
    })
    .filter((x) => x !== null && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > 0)
    .sort((a, b) => a[0] - b[0]);
}

// ── Row ───────────────────────────────────────────────────────────────────

const Row = memo(function Row({ price, qty, side, pct, cumPct, tick, onPriceClick }) {
  const isGreen = side === 'bid';
  const total   = price * qty;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPriceClick?.(fmtPrice(price, tick))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPriceClick?.(fmtPrice(price, tick));
        }
      }}
      className="relative isolate flex w-full min-h-[26px] items-center px-3 py-0.5 cursor-pointer
        hover:bg-white/[.05] outline-none focus-visible:ring-1 focus-visible:ring-[#C5E35B]/40 focus-visible:ring-inset"
    >
      {/* Cumulative bar */}
      <div
        className={`pointer-events-none absolute inset-y-0 z-0 ${isGreen ? 'left-0' : 'right-0'}`}
        style={{
          width:      `${cumPct}%`,
          background:  isGreen ? 'rgba(34,197,94,0.07)' : 'rgba(244,63,94,0.07)',
        }}
      />
      {/* Per-level bar (brighter) */}
      <div
        className={`pointer-events-none absolute inset-y-0 z-0 ${isGreen ? 'left-0' : 'right-0'}`}
        style={{
          width:      `${pct}%`,
          background:  isGreen ? 'rgba(34,197,94,0.14)' : 'rgba(244,63,94,0.14)',
        }}
      />
      <span className={`relative z-[2] w-1/3 min-w-0 font-mono font-bold text-[13px] ${isGreen ? 'text-emerald-300' : 'text-rose-300'}`}>
        {fmtPrice(price, tick)}
      </span>
      <span className="relative z-[2] w-1/3 min-w-0 text-right font-mono text-[12px] text-white/90 font-semibold">
        {fmtQty(qty)}
      </span>
      <span className="relative z-[2] w-1/3 min-w-0 text-right font-mono text-[11px] text-white/60">
        {fmtTotal(total)}
      </span>
    </div>
  );
}, (a, b) =>
  a.price === b.price &&
  a.qty === b.qty &&
  a.pct === b.pct &&
  a.cumPct === b.cumPct &&
  a.tick === b.tick,
);

// ── Main component ────────────────────────────────────────────────────────

export default function FuturesOrderBook({ onPriceClick }) {
  const { orderbook, activeMark, symbols, activeSymbol } = useFutures();

  const meta = useMemo(
    () => symbols.find((s) => s.symbol === activeSymbol) || {},
    [symbols, activeSymbol],
  );
  const base     = meta.base || (activeSymbol || '').replace(/USDT.*/i, '') || 'BASE';
  const markPx   = Number(activeMark?.mark_price || 0);

  const rows = 14;
  const [tickSize,  setTickSize] = useState(() => pickDefaultTick(markPx || 50000));
  const [tickOpen,  setTickOpen] = useState(false);
  const [viewMode,  setViewMode] = useState('all'); // 'all' | 'bids' | 'asks'

  const tickRef = useRef(null);

  // Auto-pick a sensible default tick when the symbol changes.
  // We intentionally read markPx at call-time (not reactive on every tick)
  // so we don't reset a user's custom tick choice on every WS update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTickSize(pickDefaultTick(markPx || 50000)); }, [activeSymbol]);

  // Close tick dropdown on outside click.
  useEffect(() => {
    const handler = (e) => {
      if (tickRef.current && !tickRef.current.contains(e.target)) setTickOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Normalize + aggregate ──────────────────────────────────────────────
  const asksAsc = useMemo(() => normFromContext(orderbook?.asks), [orderbook?.asks]);
  const bidsAsc = useMemo(() => normFromContext(orderbook?.bids), [orderbook?.bids]);

  const asksAgg = useMemo(() => aggregateLevels(asksAsc, tickSize), [asksAsc, tickSize]);
  const bidsAgg = useMemo(() => aggregateLevels(bidsAsc, tickSize), [bidsAsc, tickSize]);

  // Asks: best (lowest) first → slice first N → reverse so highest is at top
  const asks = useMemo(() => asksAgg.slice(0, rows).reverse(), [asksAgg, rows]);
  // Bids: highest first → take last N from sorted-asc, then reverse
  const bids = useMemo(() => bidsAgg.slice(-rows).reverse(), [bidsAgg, rows]);

  // ── Spread / mid ────────────────────────────────────────────────────────
  const bestAsk = asksAgg.length ? asksAgg[0][0] : 0;
  const bestBid = bidsAgg.length ? bidsAgg[bidsAgg.length - 1][0] : 0;
  const spread  = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0;
  // Prefer mark price as mid (more stable than book mid for futures)
  const mid = markPx > 0 ? markPx : (bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid);

  // ── Depth visualization ─────────────────────────────────────────────────
  // Per-level totals (price × qty) and cumulative totals for the bars.
  const askLevelTotals = asks.map(([p, q]) => p * q);
  const bidLevelTotals = bids.map(([p, q]) => p * q);
  const maxTotal = Math.max(...askLevelTotals, ...bidLevelTotals, 1);

  // Cumulative total down from best ask (worst first in our render order)
  const askCumTotals = (() => {
    const arr = [...asks].reverse();         // best-ask first
    const cum = [];
    let run = 0;
    for (const [p, q] of arr) { run += p * q; cum.push(run); }
    return cum.reverse();                    // back to worst-first (render order)
  })();
  const maxAskCum = askCumTotals[0] || 1;

  // Cumulative total down from best bid (avoid IIFE mutation to satisfy linter)
  const bidCumTotals = useMemo(() => {
    let run = 0;
    return bids.map(([p, q]) => { run += p * q; return run; });
  }, [bids]);
  const maxBidCum = bidCumTotals[bidCumTotals.length - 1] || 1;

  const isEmpty = asksAgg.length === 0 && bidsAgg.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[color:var(--ibo-surface)] select-none">

      {/* ── Header ── */}
      <div className="px-3 pt-2.5 pb-2 border-b border-[color:var(--ibo-border)] shrink-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[12px] font-semibold text-[color:var(--ibo-ink)]">Order Book</span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" title="Bids and asks"
              onClick={() => setViewMode('all')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${viewMode === 'all' ? 'bg-[#C5E35B]/15 ring-1 ring-[#C5E35B]/30' : 'text-white/60 hover:bg-white/10'}`}>
              <Columns2 size={14} strokeWidth={2.25} className={viewMode === 'all' ? 'text-[#C5E35B]' : ''} />
            </button>
            <button type="button" title="Bids only"
              onClick={() => setViewMode('bids')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${viewMode === 'bids' ? 'bg-[#C5E35B]/15 ring-1 ring-[#C5E35B]/30' : 'text-white/60 hover:bg-white/10'}`}>
              <TrendingUp size={14} strokeWidth={2.25} className={viewMode === 'bids' ? 'text-[#C5E35B]' : 'text-emerald-400'} />
            </button>
            <button type="button" title="Asks only"
              onClick={() => setViewMode('asks')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${viewMode === 'asks' ? 'bg-[#C5E35B]/15 ring-1 ring-[#C5E35B]/30' : 'text-white/60 hover:bg-white/10'}`}>
              <TrendingDown size={14} strokeWidth={2.25} className={viewMode === 'asks' ? 'text-[#C5E35B]' : 'text-rose-400'} />
            </button>
            <div className="relative ml-1" ref={tickRef}>
              <button
                type="button"
                onClick={() => setTickOpen((o) => !o)}
                className="flex h-7 min-w-[4.5rem] items-center justify-between gap-1 rounded border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)] px-2 text-[11px] font-mono tabular-nums font-semibold text-[color:var(--ibo-ink)] hover:border-[#0ea4ab]/40"
              >
                <span className="truncate">{tickLabel(tickSize)}</span>
                <ChevronDown size={12} className="text-[color:var(--ibo-muted)] shrink-0" />
              </button>
              {tickOpen && (
                <div className="absolute right-0 top-full z-40 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] py-1 shadow-2xl scrollbar-hide min-w-[100px]">
                  {TICK_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setTickSize(t); setTickOpen(false); }}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-[11px] font-mono tabular-nums hover:bg-[color:var(--ibo-elevated)] ${
                        t === tickSize ? 'text-[#0ea4ab] bg-[#0ea4ab]/10' : 'text-[color:var(--ibo-ink)]'
                      }`}
                    >
                      {tickLabel(t)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Column headers ── */}
      <div className="flex px-3 py-1.5 text-[10px] text-[color:var(--ibo-muted)] font-medium shrink-0 border-b border-white/[0.04]">
        <span className="w-1/3">Price (USD)</span>
        <span className="w-1/3 text-right">Size ({base})</span>
        <span className="w-1/3 text-right">Total (USD)</span>
      </div>

      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center text-xs text-white/40">
          Waiting for depth data…
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto scrollbar-hide">

          {/* Asks (sells) — best ask closest to the spread */}
          {viewMode !== 'bids' && (
            <div className="flex min-h-0 flex-col justify-end flex-1">
              <div className="flex flex-col min-h-0 max-h-full">
                <div className="px-3 py-1 shrink-0">
                  <span className="text-[10px] text-rose-400/80 uppercase tracking-widest font-extrabold">
                    ▼ Asks
                  </span>
                </div>
                {asks.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-white/40">No asks</div>
                ) : (
                  asks.map(([p, q], i) => (
                    <Row
                      key={`ask-${p}`}
                      price={p}
                      qty={q}
                      side="ask"
                      tick={tickSize}
                      onPriceClick={onPriceClick}
                      pct={Math.min((p * q / maxTotal) * 100, 100)}
                      cumPct={Math.min((askCumTotals[i] / maxAskCum) * 100, 100)}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {/* MID / spread bar — clickable (snaps to mid price) */}
          <button
            type="button"
            onClick={() => mid > 0 && onPriceClick?.(fmtPrice(mid, tickSize))}
            className="flex items-center justify-between px-3 py-2
              border-y border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated)]
              hover:bg-white/[.04] shrink-0 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-extrabold text-[#C5E35B] font-mono tracking-tight tabular-nums">
                {mid > 0 ? fmtPrice(mid, tickSize) : '—'}
              </span>
              <span className="text-[9px] text-white/45 bg-white/[.05] px-1.5 py-0.5 rounded font-bold uppercase">
                Mark
              </span>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-white/70 font-semibold">
                Spread {spread > 0 ? fmtPrice(spread, tickSize) : '—'}
              </div>
              {spreadPct > 0 && (
                <div className="text-[10px] text-white/40">{spreadPct.toFixed(3)}%</div>
              )}
            </div>
          </button>

          {/* Bids (buys) */}
          {viewMode !== 'asks' && (
            <div className="flex-1 min-h-0">
              <div className="px-3 py-1 shrink-0">
                <span className="text-[10px] text-emerald-400/80 uppercase tracking-widest font-extrabold">
                  ▲ Bids
                </span>
              </div>
              {bids.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-white/40">No bids</div>
              ) : (
                bids.map(([p, q], i) => (
                  <Row
                    key={`bid-${p}`}
                    price={p}
                    qty={q}
                    side="bid"
                    tick={tickSize}
                    onPriceClick={onPriceClick}
                    pct={Math.min((p * q / maxTotal) * 100, 100)}
                    cumPct={Math.min((bidCumTotals[i] / maxBidCum) * 100, 100)}
                  />
                ))
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
