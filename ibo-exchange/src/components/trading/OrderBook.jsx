import {
  useEffect,
  useState,
  useRef,
  useMemo,
  memo,
} from 'react';
import { Columns2, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
import { exchangeWsPath, displayBaseForApiSymbol, parsePairFromApiSymbol } from '@/services/marketApi';
import {
  isSyntheticSpotSymbol,
  synthesizeOrderBook,
  recenterOrderBook,
  jitterOrderBook,
} from '@/lib/syntheticMarket';

const API_LIMIT = 100;
const TICK_PRESETS = [
  100, 10, 1, 0.1, 0.01, 0.001, 0.0001, 0.00001, 0.000001, 0.0000001, 0.00000001,
];

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

function fmtPrice(n, tickSize) {
  const v = parseFloat(n);
  const d = decimalsForTick(tickSize);
  if (!Number.isFinite(v)) return '—';
  if (v >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toFixed(d);
}

const fmtQ = n => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 1000000 ? (v / 1000000).toFixed(2) + 'M'
       : v >= 1000    ? (v / 1000).toFixed(2) + 'K'
                      : v.toFixed(4);
};

function tickLabel(t) {
  if (t >= 1) return String(t);
  return t.toFixed(8).replace(/\.?0+$/, '') || String(t);
}

function pickDefaultTick(mid) {
  if (!mid || mid <= 0) return 0.0001;
  if (mid >= 10000) return 1;
  if (mid >= 100) return 0.01;
  if (mid >= 1) return 0.0001;
  if (mid >= 0.01) return 0.000001;
  return 0.00000001;
}

const Row = memo(function Row({ price, qty, side, cumSize, maxCum, tickSize, onPriceClick }) {
  const isBid = side === 'bid';
  const depth = maxCum > 0 ? Math.min(100, (cumSize / maxCum) * 100) : 0;
  const bar = isBid ? '14, 203, 129' : '246, 70, 93';

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPriceClick?.(fmtPrice(price, tickSize));
        }
      }}
      onClick={() => onPriceClick?.(fmtPrice(price, tickSize))}
      className="delta-ob-row group relative flex h-[22px] w-full items-center px-2.5 cursor-pointer select-none
        outline-none hover:bg-white/[0.035]"
    >
      <div
        className="pointer-events-none absolute inset-y-[1px] right-0 z-0"
        style={{
          width: `${Math.max(depth * 0.65, depth > 0 ? 3 : 0)}%`,
          background: `rgba(${bar}, 0.22)`,
        }}
      />
      <span
        className={`relative z-[1] w-[36%] min-w-0 font-mono text-[12px] tabular-nums font-semibold leading-none ${
          isBid ? 'text-[#0ECB81]' : 'text-[#F6465D]'
        }`}
      >
        {fmtPrice(price, tickSize)}
      </span>
      <span className="relative z-[1] w-[30%] min-w-0 text-right font-mono text-[11px] tabular-nums text-[color:var(--ibo-ink)] leading-none">
        {fmtQ(qty)}
      </span>
      <span className="relative z-[1] w-[34%] min-w-0 text-right font-mono text-[11px] tabular-nums text-[color:var(--ibo-ink-secondary)] leading-none">
        {fmtQ(cumSize)}
      </span>
    </div>
  );
}, (a, b) =>
  a.price === b.price
  && a.qty === b.qty
  && a.side === b.side
  && a.cumSize === b.cumSize
  && a.maxCum === b.maxCum
  && a.tickSize === b.tickSize,
);

export default function OrderBook({ symbol, baseAsset, lastPrice, onPriceClick, bookOverride = null }) {
  const displayBase = displayBaseForApiSymbol(symbol);
  const { quote: quoteAsset } = parsePairFromApiSymbol(symbol);
  const synthetic = isSyntheticSpotSymbol(symbol) && !bookOverride;
  const externalBook = bookOverride && typeof bookOverride === 'object' ? bookOverride : null;
  const [book, setBook] = useState({ asks: [], bids: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [rows, setRows] = useState(14);
  const [tickSize, setTickSize] = useState(0.0001);
  const [tickOpen, setTickOpen] = useState(false);
  const [viewMode, setViewMode] = useState('all'); // 'all' | 'bids' | 'asks'
  const [wsKick, setWsKick] = useState(0);

  const tickRef = useRef(null);
  const lastPriceRef = useRef(lastPrice);
  lastPriceRef.current = lastPrice;

  useEffect(() => {
    if (externalBook) {
      setBook(externalBook);
      setLoadError(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setBook({ asks: [], bids: [] });
    const qs = new URLSearchParams({ symbol, limit: String(API_LIMIT) });
    const url = exchangeWsPath(`/api/ws/exchange/orderbook?${qs.toString()}`);
    let closed = false;
    let reconnectTimer = null;
    let ws = null;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_orderbook' && j.book) {
            let next = typeof j.book === 'object' ? j.book : { asks: [], bids: [] };
            const lp = parseFloat(lastPriceRef.current);
            if (synthetic && Number.isFinite(lp) && lp > 0) {
              next = recenterOrderBook(next, lp);
            }
            setBook(next);
            setLoadError(null);
            setLoading(false);
          }
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        setLoadError('Could not load depth');
        setLoading(false);
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [symbol, wsKick, synthetic, externalBook]);

  useEffect(() => {
    if (!synthetic) return undefined;
    const lp = parseFloat(lastPrice);
    if (!Number.isFinite(lp) || lp <= 0) return undefined;

    setBook((prev) => {
      const hasDepth = (prev?.asks?.length || 0) + (prev?.bids?.length || 0) > 0;
      const base = hasDepth ? recenterOrderBook(prev, lp) : synthesizeOrderBook(lp, API_LIMIT);
      return jitterOrderBook(base);
    });
    setLoadError(null);
    setLoading(false);

    const id = window.setInterval(() => {
      const px = parseFloat(lastPrice);
      if (!Number.isFinite(px) || px <= 0) return;
      setBook((prev) => jitterOrderBook(recenterOrderBook(prev, px)));
    }, 2000);

    return () => window.clearInterval(id);
  }, [symbol, synthetic, lastPrice]);

  const manualTickRef = useRef(false);

  useEffect(() => {
    manualTickRef.current = false;
  }, [symbol]);

  useEffect(() => {
    if (manualTickRef.current) return;
    const p = parseFloat(lastPrice);
    if (Number.isFinite(p) && p > 0) setTickSize(pickDefaultTick(p));
  }, [symbol, lastPrice]);

  useEffect(() => {
    const el = e => {
      if (tickRef.current && !tickRef.current.contains(e.target)) setTickOpen(false);
    };
    document.addEventListener('mousedown', el);
    return () => document.removeEventListener('mousedown', el);
  }, []);

  const { asksAsc, bidsAsc } = useMemo(() => normalizeDepth(book), [book]);
  const asksAgg = useMemo(() => aggregateLevels(asksAsc, tickSize), [asksAsc, tickSize]);
  const bidsAgg = useMemo(() => aggregateLevels(bidsAsc, tickSize), [bidsAsc, tickSize]);

  const asks = useMemo(() => {
    const chunk = asksAgg.slice(0, rows);
    return chunk.reverse();
  }, [asksAgg, rows]);

  const bids = useMemo(() => {
    const chunk = bidsAgg.slice(-rows);
    return chunk.reverse();
  }, [bidsAgg, rows]);

  const bestAsk = asksAgg.length ? asksAgg[0][0] : 0;
  const bestBid = bidsAgg.length ? bidsAgg[bidsAgg.length - 1][0] : 0;
  const midFromBook = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const lp = parseFloat(lastPrice);
  const mid = Number.isFinite(lp) && lp > 0 ? lp : midFromBook;

  // Cumulative size in base (Delta "Total") from the best level outward
  const askCumSizes = useMemo(() => {
    // asks: high → low; asks[last] is best ask
    const out = new Array(asks.length);
    let run = 0;
    for (let i = asks.length - 1; i >= 0; i -= 1) {
      run += parseFloat(asks[i][1]) || 0;
      out[i] = run;
    }
    return out;
  }, [asks]);

  const bidCumSizes = useMemo(() => {
    // bids: best → worst; bids[0] is best bid
    let run = 0;
    return bids.map(([, q]) => {
      run += parseFloat(q) || 0;
      return run;
    });
  }, [bids]);

  const maxCum = Math.max(
    askCumSizes[0] || 0,
    bidCumSizes[bidCumSizes.length - 1] || 0,
    1,
  );

  const lastDirUp = useMemo(() => {
    const lp = parseFloat(lastPrice);
    if (!Number.isFinite(lp) || lp <= 0) return null;
    if (bestBid > 0 && bestAsk > 0) {
      // prefer mid book context when last sits nearer asks or bids
      const midBook = (bestBid + bestAsk) / 2;
      return lp >= midBook;
    }
    return true;
  }, [lastPrice, bestBid, bestAsk]);

  const markPx = midFromBook;

  const asksFlex = viewMode === 'bids' ? 'hidden' : viewMode === 'asks' ? 'flex-1 min-h-0' : 'flex-1 min-h-0';
  const bidsFlex = viewMode === 'asks' ? 'hidden' : viewMode === 'bids' ? 'flex-1 min-h-0' : 'flex-1 min-h-0';

  const quoteLabel = quoteAsset === 'USDT' || quoteAsset === 'USD' ? 'USD' : quoteAsset;
  const baseLabel = displayBase || '—';

  return (
    <div className="delta-ob flex flex-col h-full min-h-0 overflow-hidden bg-transparent select-none font-mono">
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 px-2.5 h-[32px] shrink-0 border-b border-[color:var(--ibo-border)]">
        <span className="text-[12px] font-semibold text-[color:var(--ibo-ink)] tracking-tight font-sans">Order Book</span>
        <div className="flex items-center gap-0.5">
          <button type="button" title="Bids & asks" onClick={() => setViewMode('all')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
              viewMode === 'all' ? 'text-[#FE6C02] bg-[#FE6C02]/12' : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
            }`}>
            <Columns2 size={13} strokeWidth={2.2} />
          </button>
          <button type="button" title="Bids only" onClick={() => setViewMode('bids')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
              viewMode === 'bids' ? 'text-[#FE6C02] bg-[#FE6C02]/12' : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
            }`}>
            <TrendingUp size={13} className="text-[#0ECB81]" strokeWidth={2.2} />
          </button>
          <button type="button" title="Asks only" onClick={() => setViewMode('asks')}
            className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
              viewMode === 'asks' ? 'text-[#FE6C02] bg-[#FE6C02]/12' : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
            }`}>
            <TrendingDown size={13} className="text-[#F6465D]" strokeWidth={2.2} />
          </button>
          <div className="relative ml-0.5" ref={tickRef}>
            <button type="button" onClick={() => setTickOpen((o) => !o)}
              className="flex h-6 min-w-[3.4rem] items-center justify-between gap-1 rounded border border-[color:var(--ibo-border-solid)] bg-transparent px-1.5 text-[11px] tabular-nums text-[color:var(--ibo-ink)] hover:border-[#FE6C02]/45">
              <span className="truncate">{tickLabel(tickSize)}</span>
              <ChevronDown size={11} className="text-[color:var(--ibo-muted)] shrink-0" />
            </button>
            {tickOpen && (
              <div className="absolute right-0 top-full z-40 mt-0.5 max-h-44 overflow-y-auto rounded border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] py-0.5 shadow-xl scrollbar-hide min-w-[96px]">
                {TICK_PRESETS.map((t) => (
                  <button key={t} type="button"
                    className={`flex w-full items-center px-2.5 py-1 text-left text-[11px] tabular-nums hover:bg-white/[0.04] ${
                      t === tickSize ? 'text-[#FE6C02]' : 'text-[color:var(--ibo-ink)]'
                    }`}
                    onClick={() => { manualTickRef.current = true; setTickSize(t); setTickOpen(false); }}>
                    {tickLabel(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Columns — Price (USD) · Size (BTC) · Total (BTC) */}
      <div className="flex px-2.5 h-[24px] items-center text-[10px] text-[color:var(--ibo-muted)] shrink-0 border-b border-[color:var(--ibo-border)] font-sans">
        <span className="w-[36%]">Price ({quoteLabel})</span>
        <span className="w-[30%] text-right">Size ({baseLabel})</span>
        <span className="w-[34%] text-right">Total ({baseLabel})</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-[#FE6C02]/60 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-2 py-4 gap-1.5 text-center font-sans">
          <span className="text-[11px] text-[#F6465D]">{loadError}</span>
          <button type="button" onClick={() => { setLoading(true); setLoadError(null); setWsKick((k) => k + 1); }}
            className="text-[11px] font-semibold text-[#FE6C02] hover:underline">Retry</button>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Asks — scrollable, pinned near last price */}
          <div className={`flex min-h-0 flex-col justify-end overflow-hidden ${asksFlex}`}>
            <div className="order-book-scroll flex min-h-0 max-h-full w-full flex-col overflow-y-auto">
              {asks.length === 0 ? (
                <div className="px-2 py-3 text-center text-[10px] text-[color:var(--ibo-muted)] font-sans">No asks</div>
              ) : (
                asks.map(([p, q], i) => (
                  <Row
                    key={`ask-${p}`}
                    price={p}
                    qty={q}
                    side="ask"
                    tickSize={tickSize}
                    onPriceClick={onPriceClick}
                    cumSize={askCumSizes[i] || 0}
                    maxCum={maxCum}
                  />
                ))
              )}
            </div>
          </div>

          {/* Last + Mark strip (Delta) */}
          <button
            type="button"
            onClick={() => mid > 0 && onPriceClick?.(fmtPrice(mid, tickSize))}
            className="flex h-[30px] shrink-0 items-center justify-between gap-2 px-2.5
              border-y border-[color:var(--ibo-border)] bg-transparent hover:bg-white/[0.03] transition-colors"
          >
            <span
              className={`font-mono text-[15px] font-bold tabular-nums tracking-tight leading-none ${
                lastDirUp == null
                  ? 'text-[color:var(--ibo-ink)]'
                  : lastDirUp
                    ? 'text-[#0ECB81]'
                    : 'text-[#F6465D]'
              }`}
            >
              {mid > 0 ? fmtPrice(mid, tickSize) : '—'}
            </span>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[12px] tabular-nums text-[color:var(--ibo-ink-secondary)]">
                {markPx > 0 ? fmtPrice(markPx, tickSize) : '—'}
              </span>
              <span
                className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded px-1 text-[9px] font-bold text-[color:var(--ibo-muted)] border border-[color:var(--ibo-border-solid)] font-sans"
                title="Mark"
              >
                M
              </span>
            </span>
          </button>

          {/* Bids */}
          <div className={`order-book-scroll min-h-0 overflow-y-auto ${bidsFlex}`}>
            {bids.length === 0 ? (
              <div className="px-2 py-3 text-center text-[10px] text-[color:var(--ibo-muted)] font-sans">No bids</div>
            ) : (
              bids.map(([p, q], i) => (
                <Row
                  key={`bid-${p}`}
                  price={p}
                  qty={q}
                  side="bid"
                  tickSize={tickSize}
                  onPriceClick={onPriceClick}
                  cumSize={bidCumSizes[i] || 0}
                  maxCum={maxCum}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

