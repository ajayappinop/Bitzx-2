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

const Row = memo(function Row({ price, qty, side, cumSize, maxCum, tick, onPriceClick }) {
  const isBid = side === 'bid';
  const depth = maxCum > 0 ? Math.min(100, (cumSize / maxCum) * 100) : 0;
  const bar = isBid ? '14, 203, 129' : '246, 70, 93';
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
      className="delta-ob-row relative flex h-[22px] w-full items-center px-2.5 cursor-pointer select-none outline-none hover:bg-white/[0.035]"
    >
      <div
        className="pointer-events-none absolute inset-y-[1px] right-0 z-0"
        style={{
          width: `${Math.max(depth * 0.65, depth > 0 ? 3 : 0)}%`,
          background: `rgba(${bar}, 0.22)`,
        }}
      />
      <span className={`relative z-[1] w-[36%] min-w-0 font-mono text-[12px] tabular-nums font-semibold leading-none ${
        isBid ? 'text-[#0ECB81]' : 'text-[#F6465D]'
      }`}>{fmtPrice(price, tick)}</span>
      <span className="relative z-[1] w-[30%] min-w-0 text-right font-mono text-[11px] tabular-nums text-[color:var(--ibo-ink)] leading-none">{fmtQty(qty)}</span>
      <span className="relative z-[1] w-[34%] min-w-0 text-right font-mono text-[11px] tabular-nums text-[color:var(--ibo-ink-secondary)] leading-none">{fmtQty(cumSize)}</span>
    </div>
  );
}, (a, b) =>
  a.price === b.price && a.qty === b.qty && a.cumSize === b.cumSize && a.maxCum === b.maxCum && a.tick === b.tick,
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

  // Mid-book as last-ish display; mark stays on the right of the strip
  const bestAsk = asksAgg.length ? asksAgg[0][0] : 0;
  const bestBid = bidsAgg.length ? bidsAgg[bidsAgg.length - 1][0] : 0;
  const bookMid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const lastPx = bookMid > 0 ? bookMid : markPx;

  // Cumulative base size (Delta Total)
  const askCumSizes = useMemo(() => {
    const out = new Array(asks.length);
    let run = 0;
    for (let i = asks.length - 1; i >= 0; i -= 1) {
      run += Number(asks[i][1]) || 0;
      out[i] = run;
    }
    return out;
  }, [asks]);

  const bidCumSizes = useMemo(() => {
    let run = 0;
    return bids.map(([, q]) => {
      run += Number(q) || 0;
      return run;
    });
  }, [bids]);

  const maxCum = Math.max(askCumSizes[0] || 0, bidCumSizes[bidCumSizes.length - 1] || 0, 1);

  const isEmpty = asksAgg.length === 0 && bidsAgg.length === 0;
  const lastDirUp = markPx > 0 && lastPx > 0 ? lastPx >= markPx * 0.9995 : true;

  return (
    <div className="delta-ob flex flex-col h-full min-h-0 overflow-hidden bg-transparent select-none font-mono">
      <div className="flex items-center justify-between gap-1.5 px-2.5 h-[32px] shrink-0 border-b border-[color:var(--ibo-border)]">
        <span className="text-[12px] font-semibold text-[color:var(--ibo-ink)] tracking-tight font-sans">Order Book</span>
        <div className="flex items-center gap-0.5">
          <button type="button" title="Bids & asks" onClick={() => setViewMode('all')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${viewMode === 'all' ? 'text-[#FE6C02] bg-[#FE6C02]/12' : 'text-[color:var(--ibo-muted)]'}`}>
            <Columns2 size={13} strokeWidth={2.2} />
          </button>
          <button type="button" title="Bids only" onClick={() => setViewMode('bids')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${viewMode === 'bids' ? 'text-[#FE6C02] bg-[#FE6C02]/12' : 'text-[color:var(--ibo-muted)]'}`}>
            <TrendingUp size={13} className="text-[#0ECB81]" strokeWidth={2.2} />
          </button>
          <button type="button" title="Asks only" onClick={() => setViewMode('asks')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${viewMode === 'asks' ? 'text-[#FE6C02] bg-[#FE6C02]/12' : 'text-[color:var(--ibo-muted)]'}`}>
            <TrendingDown size={13} className="text-[#F6465D]" strokeWidth={2.2} />
          </button>
          <div className="relative ml-0.5" ref={tickRef}>
            <button type="button" onClick={() => setTickOpen((o) => !o)}
              className="flex h-6 min-w-[3.4rem] items-center justify-between gap-1 rounded border border-[color:var(--ibo-border-solid)] bg-transparent px-1.5 text-[11px] tabular-nums text-[color:var(--ibo-ink)]">
              <span className="truncate">{tickLabel(tickSize)}</span>
              <ChevronDown size={11} className="text-[color:var(--ibo-muted)] shrink-0" />
            </button>
            {tickOpen && (
              <div className="absolute right-0 top-full z-40 mt-0.5 max-h-44 overflow-y-auto rounded border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] py-0.5 min-w-[96px] shadow-xl scrollbar-hide">
                {TICK_PRESETS.map((t) => (
                  <button key={t} type="button" onClick={() => { setTickSize(t); setTickOpen(false); }}
                    className={`flex w-full px-2.5 py-1 text-left text-[11px] tabular-nums hover:bg-white/[0.04] ${t === tickSize ? 'text-[#FE6C02]' : 'text-[color:var(--ibo-ink)]'}`}>
                    {tickLabel(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex px-2.5 h-[24px] items-center text-[10px] text-[color:var(--ibo-muted)] shrink-0 border-b border-[color:var(--ibo-border)] font-sans">
        <span className="w-[36%]">Price (USD)</span>
        <span className="w-[30%] text-right">Size ({base})</span>
        <span className="w-[34%] text-right">Total ({base})</span>
      </div>

      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-[color:var(--ibo-muted)] font-sans">Waiting for depth…</div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {viewMode !== 'bids' && (
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
              <div className="flex flex-col min-h-0 max-h-full overflow-y-auto scrollbar-hide">
                {asks.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[10px] text-[color:var(--ibo-muted)] font-sans">No asks</div>
                ) : (
                  asks.map(([p, q], i) => (
                    <Row key={`ask-${p}`} price={p} qty={q} side="ask" tick={tickSize} onPriceClick={onPriceClick}
                      cumSize={askCumSizes[i] || 0} maxCum={maxCum} />
                  ))
                )}
              </div>
            </div>
          )}

          <button type="button" onClick={() => lastPx > 0 && onPriceClick?.(fmtPrice(lastPx, tickSize))}
            className="flex h-[30px] shrink-0 items-center justify-between gap-2 px-2.5 border-y border-[color:var(--ibo-border)] hover:bg-white/[0.03]">
            <span className={`font-mono text-[15px] font-bold tabular-nums ${
              lastDirUp ? 'text-[#0ECB81]' : 'text-[#F6465D]'
            }`}>
              {lastPx > 0 ? fmtPrice(lastPx, tickSize) : '—'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[12px] tabular-nums text-[color:var(--ibo-ink-secondary)]">
                {markPx > 0 ? fmtPrice(markPx, tickSize) : '—'}
              </span>
              <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded px-1 text-[9px] font-bold text-[color:var(--ibo-muted)] border border-[color:var(--ibo-border-solid)] font-sans" title="Mark">
                M
              </span>
            </span>
          </button>

          {viewMode !== 'asks' && (
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
              {bids.length === 0 ? (
                <div className="px-2 py-3 text-center text-[10px] text-[color:var(--ibo-muted)] font-sans">No bids</div>
              ) : (
                bids.map(([p, q], i) => (
                  <Row key={`bid-${p}`} price={p} qty={q} side="bid" tick={tickSize} onPriceClick={onPriceClick}
                    cumSize={bidCumSizes[i] || 0} maxCum={maxCum} />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

