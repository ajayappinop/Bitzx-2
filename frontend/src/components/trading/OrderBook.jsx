import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
  memo,
} from 'react';
import { Columns2, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tradingApi } from '@/services/api';

/**
 * Scroll without any native scrollbar: Windows/Edge often ignore scrollbar-hiding CSS.
 * Viewport is overflow:hidden; wheel deltas move the inner block with translateY.
 * Wheel listener is non-passive so we can preventDefault (required for nested scroll).
 */
function ObWheelScroll({ className, style, children }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const measure = useCallback(() => {
    const v = viewportRef.current;
    const c = contentRef.current;
    if (!v || !c) return 0;
    return Math.max(0, c.scrollHeight - v.clientHeight);
  }, []);

  useLayoutEffect(() => {
    const v = viewportRef.current;
    const c = contentRef.current;
    if (!v) return undefined;
    const ro = new ResizeObserver(() => {
      const vi = viewportRef.current;
      const ci = contentRef.current;
      if (!vi || !ci) return;
      const max = Math.max(0, ci.scrollHeight - vi.clientHeight);
      setOffset(o => {
        const n = max <= 0 ? 0 : Math.min(max, Math.max(0, o));
        offsetRef.current = n;
        return n;
      });
    });
    ro.observe(v);
    if (c) ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return undefined;
    const onWheel = e => {
      const el = contentRef.current;
      if (!el) return;
      const max = Math.max(0, el.scrollHeight - v.clientHeight);
      if (max <= 0) return;
      const prev = offsetRef.current;
      const next = Math.max(0, Math.min(max, prev + e.deltaY));
      if (next === prev) return;
      e.preventDefault();
      e.stopPropagation();
      offsetRef.current = next;
      setOffset(next);
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={viewportRef}
      className={cn('ob-viewport min-h-0 w-full overflow-hidden', className)}
      style={{ ...(style || {}), overflow: 'hidden' }}
    >
      <div
        ref={contentRef}
        className="order-book-wheel-content"
        style={{
          transform: `translate3d(0, -${offset}px, 0)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Merge L2 into price buckets by tick size */
function aggregateLevels(levels, tickSize) {
  const m = new Map();
  for (const [p, q] of levels) {
    const price = parseFloat(p);
    const qty = parseFloat(q);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) continue;
    const grid = Math.round(price / tickSize) * tickSize;
    const key = Number(grid.toPrecision(14));
    m.set(key, (m.get(key) || 0) + qty);
  }
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
}

function decimalsForTick(tick) {
  if (tick >= 1) return 2;
  const match = /^(\d\.?\d*)e([-+]\d+)$/.exec(Number(tick).toExponential());
  if (!match) return 8;
  const exp = parseInt(match[2], 10);
  if (exp >= 0) return Math.min(8, exp + 2);
  return Math.min(8, -exp + 1);
}

const fmtPrice = (n, tickSize) => {
  const v = parseFloat(n);
  const d = decimalsForTick(tickSize);
  if (v >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toFixed(d);
};

const fmtQ = n => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 1000000 ? `${(v / 1000000).toFixed(2)}M`
    : v >= 1000 ? `${(v / 1000).toFixed(2)}K`
      : v.toFixed(4);
};

const fmtTotal = n => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(3)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(3)}K`;
  return v >= 1 ? v.toFixed(2) : v.toFixed(6);
};

const TICK_PRESETS = [
  100, 10, 1, 0.1, 0.01, 0.001, 0.0001, 0.00001, 0.000001, 0.0000001, 0.00000001,
];

function pickDefaultTick(mid) {
  if (!mid || mid <= 0) return 0.0001;
  if (mid >= 10000) return 1;
  if (mid >= 100) return 0.01;
  if (mid >= 1) return 0.0001;
  if (mid >= 0.01) return 0.000001;
  return 0.00000001;
}

function tickLabel(t) {
  if (t >= 1) return String(t);
  return t.toFixed(8).replace(/\.?0+$/, '') || String(t);
}

/** Accept [price, qty] arrays or { price, qty } / Binance-style objects */
function toPair(row) {
  if (!row) return null;
  if (Array.isArray(row) && row.length >= 2) return [row[0], row[1]];
  if (typeof row === 'object') {
    const p = row.price ?? row[0];
    const q = row.qty ?? row.quantity ?? row.amount ?? row[1];
    if (p != null && q != null) return [p, q];
  }
  return null;
}

/**
 * Normalize Binance-style depth: asks ascending (best = lowest first),
 * bids descending (best = highest first) → bids ascending for aggregation.
 */
function normalizeDepth(book) {
  const rawAsks = book?.asks || [];
  const rawBids = book?.bids || [];
  const asksAsc = rawAsks.map(toPair).filter(Boolean).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  const bidsAsc = rawBids.map(toPair).filter(Boolean).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  return { asksAsc, bidsAsc };
}

const Row = memo(function Row({ price, qty, side, depthPct, tickSize, onPriceClick, total }) {
  const isBid = side === 'bid';
  const d = Math.min(100, Math.max(0, depthPct));
  const barRgb = isBid ? '34, 197, 94' : '239, 68, 68';

  return (
    <div
      role="button"
      tabIndex={-1}
      draggable={false}
      onMouseDown={e => e.preventDefault()}
      onClick={() => onPriceClick?.(fmtPrice(price, tickSize))}
      onKeyDown={e => { if (e.key === 'Enter') onPriceClick?.(fmtPrice(price, tickSize)); }}
      className="order-book-row relative flex w-full min-w-0 items-center px-2 py-[5px] cursor-pointer outline-none ring-0 focus-visible:outline-none focus-visible:ring-0"
    >
      {/* Full-row depth: tint spans entire row, anchored from the right */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          background: `linear-gradient(to left, rgba(${barRgb}, 0.2) 0%, rgba(${barRgb}, 0.2) ${d}%, transparent ${d}%, transparent 100%)`,
        }}
      />
      <span
        className={`relative z-[1] w-[34%] min-w-0 text-left font-mono font-bold text-[11px] tabular-nums leading-tight ${
          isBid ? 'text-green-400' : 'text-red-400'
        }`}
      >
        {fmtPrice(price, tickSize)}
      </span>
      <span className="relative z-[1] w-[32%] min-w-0 text-center text-ink font-mono text-[11px] font-semibold tabular-nums leading-tight">
        {fmtQ(qty)}
      </span>
      <span
        className={`relative z-[1] w-[34%] min-w-0 text-right font-mono text-[10px] font-semibold tabular-nums leading-tight ${
          isBid ? 'text-green-400/95' : 'text-red-400/95'
        }`}
      >
        {fmtTotal(total)}
      </span>
    </div>
  );
}, (prev, next) =>
  prev.price === next.price
  && prev.qty === next.qty
  && prev.side === next.side
  && prev.depthPct === next.depthPct
  && prev.tickSize === next.tickSize
  && prev.total === next.total,
);

const FETCH_LIMIT = 100;
const DEPTHS = [10, 14, 20];

export default function OrderBook({
  symbol,
  baseAsset,
  onPriceClick,
  lastPrice,
  changePct,
}) {
  const base = baseAsset || symbol.replace('USDT', '');
  const [book, setBook] = useState({ asks: [], bids: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tickSize, setTickSize] = useState(0.0001);
  const [tickOpen, setTickOpen] = useState(false);
  const [viewMode, setViewMode] = useState('all');
  const [rows, setRows] = useState(14);
  const timerRef = useRef(null);
  const tickRef = useRef(null);

  const load = useCallback(() => {
    tradingApi.getOrderBook(symbol, FETCH_LIMIT)
      .then(data => {
        setBook(data && typeof data === 'object' ? data : { asks: [], bids: [] });
        setLoadError(null);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoadError(err?.message || 'Failed to load order book');
        setBook({ asks: [], bids: [] });
        setLoading(false);
      });
  }, [symbol]);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    load();
    timerRef.current = setInterval(load, 2000);
    return () => clearInterval(timerRef.current);
  }, [symbol, load]);

  const { asksAsc, bidsAsc } = useMemo(() => normalizeDepth(book), [book]);

  const asksAgg = useMemo(() => aggregateLevels(asksAsc, tickSize), [asksAsc, tickSize]);
  const bidsAgg = useMemo(() => aggregateLevels(bidsAsc, tickSize), [bidsAsc, tickSize]);

  /** Asks: lowest rows near spread; show high → low toward mid */
  const asks = useMemo(() => {
    const chunk = asksAgg.slice(0, rows);
    return chunk.reverse();
  }, [asksAgg, rows]);

  /** Bids: best bids near spread at top */
  const bids = useMemo(() => {
    const chunk = bidsAgg.slice(-rows);
    return chunk.reverse();
  }, [bidsAgg, rows]);

  const bestAsk = asksAgg.length ? asksAgg[0][0] : 0;
  const bestBid = bidsAgg.length ? bidsAgg[bidsAgg.length - 1][0] : 0;

  const lp = parseFloat(lastPrice);
  const midFromBook =
    bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const mid = Number.isFinite(lp) && lp > 0 ? lp : midFromBook;

  useEffect(() => {
    const p = parseFloat(lastPrice);
    setTickSize(pickDefaultTick(Number.isFinite(p) && p > 0 ? p : 0.45));
    // Only when trading pair changes — not on every ticker poll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const spread =
    bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPct = bestBid > 0 ? ((spread / bestBid) * 100) : 0;

  const maxAskN = useMemo(() => {
    let m = 1;
    asks.forEach(([p, q]) => {
      const t = parseFloat(p) * parseFloat(q);
      if (t > m) m = t;
    });
    return m;
  }, [asks]);

  const maxBidN = useMemo(() => {
    let m = 1;
    bids.forEach(([p, q]) => {
      const t = parseFloat(p) * parseFloat(q);
      if (t > m) m = t;
    });
    return m;
  }, [bids]);

  const pct = changePct != null && Number.isFinite(Number(changePct)) ? Number(changePct) : null;
  const isUp = pct == null ? true : pct >= 0;

  useEffect(() => {
    const el = e => { if (tickRef.current && !tickRef.current.contains(e.target)) setTickOpen(false); };
    document.addEventListener('mousedown', el);
    return () => document.removeEventListener('mousedown', el);
  }, []);

  return (
    <div className="order-book-root flex flex-col h-full min-h-0 min-w-0 bg-surface-elevated overflow-hidden">
      <div className="px-2 pt-2 pb-1.5 border-b border-line flex-shrink-0">
        <div className="flex items-end gap-1 mb-1">
          <span className="text-xs font-bold tracking-tight text-emerald-400">Order Book</span>
          <span className="h-0.5 w-6 rounded-full bg-emerald-400/80 mb-0.5" />
        </div>
        <div className="flex items-center justify-between gap-1 mt-1">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="Bids & asks"
              onClick={() => setViewMode('all')}
              className={`p-1 rounded-md transition-colors ${viewMode === 'all' ? 'bg-[#0EA4AB]/25 text-ink-accent' : 'text-[#4A4B50] hover:text-ink-muted'}`}
            >
              <Columns2 size={14} />
            </button>
            <button
              type="button"
              title="Bids only"
              onClick={() => setViewMode('bids')}
              className={`p-1 rounded-md transition-colors ${viewMode === 'bids' ? 'bg-[#0EA4AB]/25 text-ink-accent' : 'text-[#4A4B50] hover:text-ink-muted'}`}
            >
              <TrendingUp size={14} className="text-green-400" />
            </button>
            <button
              type="button"
              title="Asks only"
              onClick={() => setViewMode('asks')}
              className={`p-1 rounded-md transition-colors ${viewMode === 'asks' ? 'bg-[#0EA4AB]/25 text-ink-accent' : 'text-[#4A4B50] hover:text-ink-muted'}`}
            >
              <TrendingDown size={14} className="text-red-400" />
            </button>
          </div>
          <div className="relative" ref={tickRef}>
            <button
              type="button"
              onClick={() => setTickOpen(o => !o)}
              className="flex items-center gap-0.5 text-[10px] font-mono text-ink-soft bg-surface-card border border-line rounded px-1.5 py-0.5 hover:border-[#0EA4AB]/40 max-w-[104px]"
            >
              <span className="truncate">{tickLabel(tickSize)}</span>
              <ChevronDown size={12} className="text-[#4A4B50] flex-shrink-0" />
            </button>
            {tickOpen && (
              <ObWheelScroll className="absolute right-0 top-full z-20 mt-1 max-h-40 min-w-[112px] rounded-lg border border-line bg-surface-card shadow-xl">
                <div className="py-1">
                  {TICK_PRESETS.map(t => (
                    <button
                      key={t}
                      type="button"
                      className={`w-full text-left px-2 py-1 text-[10px] font-mono hover:bg-[#1a2748] ${t === tickSize ? 'text-ink-accent' : 'text-ink-soft'}`}
                      onClick={() => { setTickSize(t); setTickOpen(false); }}
                    >
                      {tickLabel(t)}
                    </button>
                  ))}
                </div>
              </ObWheelScroll>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-1 mt-1.5 mb-0.5">
          {DEPTHS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setRows(d)}
              className={`flex-1 text-[10px] py-0.5 rounded font-mono transition-colors ${
                rows === d ? 'bg-[#0EA4AB]/30 text-ink-accent border border-[#0EA4AB]/50' : 'text-[#4A4B50] border border-transparent hover:text-ink-muted'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-between px-2 py-1 text-[9px] text-[#4A4B50] flex-shrink-0 uppercase tracking-wide">
        <span className="w-[34%]">Price(USDT)</span>
        <span className="w-[32%] text-center">Qty({base})</span>
        <span className="w-[34%] text-right">Total(USDT)</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#0EA4AB] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-2 py-6 gap-2 text-center">
          <span className="text-[11px] text-red-400/95 leading-snug">{loadError}</span>
          <span className="text-[9px] text-[#4A4B50] leading-snug">
            The order book is loaded from your backend. Start the API (e.g. port 8000) and set REACT_APP_BACKEND_URL if it is not localhost.
          </span>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {viewMode !== 'bids' && (
            <ObWheelScroll
              key={`ob-asks-${symbol}`}
              className={cn('min-h-0 w-full', viewMode === 'asks' && 'flex-1')}
              style={viewMode === 'all' ? { maxHeight: '42%' } : undefined}
            >
              {asks.length === 0 ? (
                <div className="px-2 py-4 text-center text-[10px] text-[#4A4B50]">No asks</div>
              ) : (
                asks.map(([p, q]) => {
                  const price = parseFloat(p);
                  const qty = parseFloat(q);
                  const total = price * qty;
                  const depthPct = maxAskN > 0 ? (total / maxAskN) * 100 : 0;
                  const pk = price;
                  return (
                    <Row
                      key={`ask-${pk}`}
                      price={pk}
                      qty={qty}
                      side="ask"
                      depthPct={depthPct}
                      tickSize={tickSize}
                      onPriceClick={onPriceClick}
                      total={total}
                    />
                  );
                })
              )}
            </ObWheelScroll>
          )}

          <div
            className="order-book-mid flex items-center justify-between px-2 py-1.5 border-y border-line bg-surface-card flex-shrink-0 cursor-pointer outline-none transition-colors hover:bg-surface-soft"
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPriceClick?.(fmtPrice(mid, tickSize))}
            role="button"
            tabIndex={-1}
            onKeyDown={e => { if (e.key === 'Enter') onPriceClick?.(fmtPrice(mid, tickSize)); }}
          >
            <span className={`text-sm font-bold font-mono tabular-nums ${isUp ? 'text-green-400' : 'text-red-400'}`}>
              {fmtPrice(mid, tickSize)}
            </span>
            <div className="flex items-center gap-1">
              {isUp ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
              {pct != null && (
                <span className={`text-[10px] font-semibold font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                  {isUp ? '+' : ''}{pct.toFixed(2)}%
                </span>
              )}
            </div>
            <span className="text-[9px] text-[#4A4B50] font-mono">
              Spr {spread > 0 ? fmtPrice(spread, tickSize) : '—'} ({spreadPct.toFixed(3)}%)
            </span>
          </div>

          {viewMode !== 'asks' && (
            <ObWheelScroll
              key={`ob-bids-${symbol}`}
              className={cn('min-h-0 w-full', viewMode === 'bids' && 'flex-1')}
              style={viewMode === 'all' ? { maxHeight: '42%' } : undefined}
            >
              {bids.length === 0 ? (
                <div className="px-2 py-4 text-center text-[10px] text-[#4A4B50]">No bids</div>
              ) : (
                bids.map(([p, q]) => {
                  const price = parseFloat(p);
                  const qty = parseFloat(q);
                  const total = price * qty;
                  const depthPct = maxBidN > 0 ? (total / maxBidN) * 100 : 0;
                  const pk = price;
                  return (
                    <Row
                      key={`bid-${pk}`}
                      price={pk}
                      qty={qty}
                      side="bid"
                      depthPct={depthPct}
                      tickSize={tickSize}
                      onPriceClick={onPriceClick}
                      total={total}
                    />
                  );
                })
              )}
            </ObWheelScroll>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 px-2 py-1 border-t border-line bg-surface flex-shrink-0">
        <span className="text-[10px] font-semibold text-ink-soft">{base}</span>
        {pct != null ? (
          <span className={`text-[10px] font-mono font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{pct.toFixed(2)}%
          </span>
        ) : (
          <span className="text-[10px] text-[#4A4B50]">—</span>
        )}
      </div>
    </div>
  );
}
