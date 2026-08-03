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
 */
function ObWheelScroll({ className, style, children }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

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
        style={{ transform: `translate3d(0, -${offset}px, 0)` }}
      >
        {children}
      </div>
    </div>
  );
}

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
  if (!Number.isFinite(v)) return '—';
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

function normalizeDepth(book) {
  const rawAsks = book?.asks || [];
  const rawBids = book?.bids || [];
  const asksAsc = rawAsks.map(toPair).filter(Boolean).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  const bidsAsc = rawBids.map(toPair).filter(Boolean).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  return { asksAsc, bidsAsc };
}

const Row = memo(function Row({ price, qty, side, cumSize, maxCum, tickSize, onPriceClick }) {
  const isBid = side === 'bid';
  const depth = maxCum > 0 ? Math.min(100, (cumSize / maxCum) * 100) : 0;
  const bar = isBid ? '14, 203, 129' : '246, 70, 93';

  return (
    <div
      role="button"
      tabIndex={-1}
      draggable={false}
      onMouseDown={e => e.preventDefault()}
      onClick={() => onPriceClick?.(fmtPrice(price, tickSize))}
      onKeyDown={e => { if (e.key === 'Enter') onPriceClick?.(fmtPrice(price, tickSize)); }}
      className="order-book-row delta-ob-row relative flex h-[22px] w-full min-w-0 items-center px-2.5 cursor-pointer outline-none hover:bg-white/[0.035]"
    >
      <div
        className="absolute inset-y-[1px] right-0 pointer-events-none z-0"
        style={{
          width: `${Math.max(depth * 0.65, depth > 0 ? 3 : 0)}%`,
          background: `rgba(${bar}, 0.22)`,
        }}
      />
      <span className={`relative z-[1] w-[36%] min-w-0 text-left font-mono font-semibold text-[12px] tabular-nums leading-none ${
        isBid ? 'text-[#0ECB81]' : 'text-[#F6465D]'
      }`}>
        {fmtPrice(price, tickSize)}
      </span>
      <span className="relative z-[1] w-[30%] min-w-0 text-right text-ink font-mono text-[11px] tabular-nums leading-none">
        {fmtQ(qty)}
      </span>
      <span className="relative z-[1] w-[34%] min-w-0 text-right font-mono text-[11px] tabular-nums text-ink-muted leading-none">
        {fmtQ(cumSize)}
      </span>
    </div>
  );
}, (prev, next) =>
  prev.price === next.price
  && prev.qty === next.qty
  && prev.side === next.side
  && prev.cumSize === next.cumSize
  && prev.maxCum === next.maxCum
  && prev.tickSize === next.tickSize,
);

const FETCH_LIMIT = 100;
const ROWS = 14;

export default function OrderBook({
  symbol,
  baseAsset,
  onPriceClick,
  lastPrice,
  changePct,
}) {
  const base = baseAsset || symbol.replace(/USDT|USD$/i, '') || '—';
  const [book, setBook] = useState({ asks: [], bids: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [tickSize, setTickSize] = useState(0.0001);
  const [tickOpen, setTickOpen] = useState(false);
  const [viewMode, setViewMode] = useState('all');
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

  const asks = useMemo(() => asksAgg.slice(0, ROWS).reverse(), [asksAgg]);
  const bids = useMemo(() => bidsAgg.slice(-ROWS).reverse(), [bidsAgg]);

  const bestAsk = asksAgg.length ? asksAgg[0][0] : 0;
  const bestBid = bidsAgg.length ? bidsAgg[bidsAgg.length - 1][0] : 0;
  const midFromBook = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const lp = parseFloat(lastPrice);
  const mid = Number.isFinite(lp) && lp > 0 ? lp : midFromBook;
  const markPx = midFromBook;

  const askCumSizes = useMemo(() => {
    const out = new Array(asks.length);
    let run = 0;
    for (let i = asks.length - 1; i >= 0; i -= 1) {
      run += parseFloat(asks[i][1]) || 0;
      out[i] = run;
    }
    return out;
  }, [asks]);

  const bidCumSizes = useMemo(() => {
    let run = 0;
    return bids.map(([, q]) => {
      run += parseFloat(q) || 0;
      return run;
    });
  }, [bids]);

  const maxCum = Math.max(askCumSizes[0] || 0, bidCumSizes[bidCumSizes.length - 1] || 0, 1);

  useEffect(() => {
    const p = parseFloat(lastPrice);
    setTickSize(pickDefaultTick(Number.isFinite(p) && p > 0 ? p : 0.45));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const pct = changePct != null && Number.isFinite(Number(changePct)) ? Number(changePct) : null;
  const isUp = pct == null ? true : pct >= 0;

  useEffect(() => {
    const el = e => { if (tickRef.current && !tickRef.current.contains(e.target)) setTickOpen(false); };
    document.addEventListener('mousedown', el);
    return () => document.removeEventListener('mousedown', el);
  }, []);

  return (
    <div className="order-book-root delta-ob flex flex-col h-full min-h-0 min-w-0 bg-transparent overflow-hidden font-mono">
      <div className="flex items-center justify-between gap-1.5 px-2.5 h-[32px] shrink-0 border-b border-line">
        <span className="text-[12px] font-semibold text-ink tracking-tight font-sans">Order Book</span>
        <div className="flex items-center gap-0.5">
          <button type="button" title="Bids & asks" onClick={() => setViewMode('all')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${viewMode === 'all' ? 'text-[#FE6C02] bg-[#FE6C02]/15' : 'text-[#4A4B50]'}`}>
            <Columns2 size={13} strokeWidth={2.2} />
          </button>
          <button type="button" title="Bids only" onClick={() => setViewMode('bids')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${viewMode === 'bids' ? 'text-[#FE6C02] bg-[#FE6C02]/15' : 'text-[#4A4B50]'}`}>
            <TrendingUp size={13} className="text-[#0ECB81]" strokeWidth={2.2} />
          </button>
          <button type="button" title="Asks only" onClick={() => setViewMode('asks')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded ${viewMode === 'asks' ? 'text-[#FE6C02] bg-[#FE6C02]/15' : 'text-[#4A4B50]'}`}>
            <TrendingDown size={13} className="text-[#F6465D]" strokeWidth={2.2} />
          </button>
          <div className="relative ml-0.5" ref={tickRef}>
            <button type="button" onClick={() => setTickOpen(o => !o)}
              className="flex h-6 min-w-[3.4rem] items-center justify-between gap-1 rounded border border-line bg-transparent px-1.5 text-[11px] tabular-nums text-ink">
              <span className="truncate">{tickLabel(tickSize)}</span>
              <ChevronDown size={11} className="text-[#4A4B50] flex-shrink-0" />
            </button>
            {tickOpen && (
              <ObWheelScroll className="absolute right-0 top-full z-20 mt-0.5 max-h-40 min-w-[100px] rounded border border-line bg-surface-card shadow-xl">
                <div className="py-0.5">
                  {TICK_PRESETS.map(t => (
                    <button key={t} type="button"
                      className={`w-full text-left px-2.5 py-1 text-[11px] tabular-nums hover:bg-white/5 ${t === tickSize ? 'text-[#FE6C02]' : 'text-ink-soft'}`}
                      onClick={() => { setTickSize(t); setTickOpen(false); }}>
                      {tickLabel(t)}
                    </button>
                  ))}
                </div>
              </ObWheelScroll>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center px-2.5 h-[24px] text-[10px] text-[#4A4B50] shrink-0 border-b border-line font-sans">
        <span className="w-[36%]">Price (USD)</span>
        <span className="w-[30%] text-right">Size ({base})</span>
        <span className="w-[34%] text-right">Total ({base})</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-[#FE6C02]/60 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-2 py-5 gap-1.5 text-center">
          <span className="text-[11px] text-[#F6465D]">{loadError}</span>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {viewMode !== 'bids' && (
            <ObWheelScroll
              key={`ob-asks-${symbol}`}
              className={cn('min-h-0 w-full', viewMode === 'asks' && 'flex-1')}
              style={viewMode === 'all' ? { maxHeight: '42%', flex: '1 1 0' } : undefined}
            >
              {asks.length === 0 ? (
                <div className="px-2 py-3 text-center text-[10px] text-[#4A4B50] font-sans">No asks</div>
              ) : (
                asks.map(([p, q], i) => (
                  <Row
                    key={`ask-${p}`}
                    price={p}
                    qty={q}
                    side="ask"
                    cumSize={askCumSizes[i] || 0}
                    maxCum={maxCum}
                    tickSize={tickSize}
                    onPriceClick={onPriceClick}
                  />
                ))
              )}
            </ObWheelScroll>
          )}

          <div
            className="flex h-[30px] items-center justify-between gap-2 px-2.5 border-y border-line flex-shrink-0 cursor-pointer hover:bg-white/[0.03]"
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPriceClick?.(fmtPrice(mid, tickSize))}
            role="button"
            tabIndex={-1}
          >
            <span className={`text-[15px] font-bold font-mono tabular-nums leading-none ${
              isUp ? 'text-[#0ECB81]' : 'text-[#F6465D]'
            }`}>
              {mid > 0 ? fmtPrice(mid, tickSize) : '—'}
            </span>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[12px] tabular-nums text-ink-muted">
                {markPx > 0 ? fmtPrice(markPx, tickSize) : '—'}
              </span>
              <span
                className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded px-1 text-[9px] font-bold text-[#4A4B50] border border-line font-sans"
                title="Mark"
              >
                M
              </span>
            </span>
          </div>

          {viewMode !== 'asks' && (
            <ObWheelScroll
              key={`ob-bids-${symbol}`}
              className={cn('min-h-0 w-full', viewMode === 'bids' && 'flex-1')}
              style={viewMode === 'all' ? { maxHeight: '42%', flex: '1 1 0' } : undefined}
            >
              {bids.length === 0 ? (
                <div className="px-2 py-3 text-center text-[10px] text-[#4A4B50] font-sans">No bids</div>
              ) : (
                bids.map(([p, q], i) => (
                  <Row
                    key={`bid-${p}`}
                    price={p}
                    qty={q}
                    side="bid"
                    cumSize={bidCumSizes[i] || 0}
                    maxCum={maxCum}
                    tickSize={tickSize}
                    onPriceClick={onPriceClick}
                  />
                ))
              )}
            </ObWheelScroll>
          )}
        </div>
      )}
    </div>
  );
}
