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
const DEPTHS = [10, 14, 20];
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

const fmtTotal = n => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(3) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(3) + 'K';
  return v >= 1 ? v.toFixed(2) : v.toFixed(6);
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

const Row = memo(function Row({ price, qty, side, pct, cumPct, tickSize, onPriceClick }) {
  const isGreen = side === 'bid';
  const total = parseFloat(price) * parseFloat(qty);

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPriceClick?.(fmtPrice(price, tickSize)); } }}
      onClick={() => onPriceClick?.(fmtPrice(price, tickSize))}
      className="order-book-row relative isolate flex w-full min-h-[26px] items-center px-3 py-0.5 cursor-pointer
        hover:bg-[color:var(--ibo-elevated)] outline-none focus-visible:ring-1 focus-visible:ring-[#0ea4ab]/40 focus-visible:ring-inset"
    >
      <div
        className={`pointer-events-none absolute inset-y-0 z-0 ${isGreen ? 'left-0' : 'right-0'}`}
        style={{ width: `${cumPct}%`, background: isGreen ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)' }}
      />
      <div
        className={`pointer-events-none absolute inset-y-0 z-0 ${isGreen ? 'left-0' : 'right-0'}`}
        style={{ width: `${pct}%`, background: isGreen ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)' }}
      />
      <span className={`relative z-[2] w-1/3 min-w-0 font-mono tabular-nums font-semibold text-[12px] ${isGreen ? 'text-emerald-500' : 'text-rose-500'}`}>
        {fmtPrice(price, tickSize)}
      </span>
      <span className="relative z-[2] w-1/3 min-w-0 text-right text-[color:var(--ibo-ink)] font-mono tabular-nums text-[11px] font-medium">
        {fmtQ(qty)}
      </span>
      <span className="relative z-[2] w-1/3 min-w-0 text-right text-[color:var(--ibo-muted)] font-mono tabular-nums text-[11px]">
        {fmtTotal(total)}
      </span>
    </div>
  );
}, (a, b) =>
  a.price === b.price
  && a.qty === b.qty
  && a.side === b.side
  && a.pct === b.pct
  && a.cumPct === b.cumPct
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

  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0;

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

  const maxTotal = Math.max(maxAskN, maxBidN, 1);

  const askTotals = asks.reduce((acc, [p, q]) => [...acc, (acc[acc.length - 1] || 0) + parseFloat(p) * parseFloat(q)], []);
  const bidTotals = bids.reduce((acc, [p, q]) => [...acc, (acc[acc.length - 1] || 0) + parseFloat(p) * parseFloat(q)], []);
  const maxAsk = askTotals[askTotals.length - 1] || 1;
  const maxBid = bidTotals[bidTotals.length - 1] || 1;

  const asksFlex = viewMode === 'bids' ? 'hidden' : viewMode === 'asks' ? 'flex-1 min-h-0' : 'flex-1 min-h-0';
  const bidsFlex = viewMode === 'asks' ? 'hidden' : viewMode === 'bids' ? 'flex-1 min-h-0' : 'flex-1 min-h-0';

  return (
    <div className="order-book-panel flex flex-col h-full min-h-0 overflow-hidden bg-surface-DEFAULT select-none">

      <div className="px-3 pt-2.5 pb-2 border-b border-[color:var(--ibo-border)] flex-shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[12px] font-semibold text-[color:var(--ibo-ink)] tracking-wide">Order Book</span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              title="Bids and asks"
              onClick={() => setViewMode('all')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                viewMode === 'all'
                  ? 'bg-[#0ea4ab]/15 text-[#0ea4ab] ring-1 ring-[#0ea4ab]/30'
                  : 'text-[color:var(--ibo-muted)] hover:bg-[color:var(--ibo-elevated)]'
              }`}
            >
              <Columns2 size={14} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              title="Bids only"
              onClick={() => setViewMode('bids')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                viewMode === 'bids'
                  ? 'bg-[#0ea4ab]/15 text-[#0ea4ab] ring-1 ring-[#0ea4ab]/30'
                  : 'text-[color:var(--ibo-muted)] hover:bg-[color:var(--ibo-elevated)]'
              }`}
            >
              <TrendingUp size={14} className="text-emerald-500" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              title="Asks only"
              onClick={() => setViewMode('asks')}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                viewMode === 'asks'
                  ? 'bg-[#0ea4ab]/15 text-[#0ea4ab] ring-1 ring-[#0ea4ab]/30'
                  : 'text-[color:var(--ibo-muted)] hover:bg-[color:var(--ibo-elevated)]'
              }`}
            >
              <TrendingDown size={14} className="text-rose-500" strokeWidth={2.25} />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-0 flex-1" ref={tickRef}>
            <button
              type="button"
              onClick={() => setTickOpen(o => !o)}
              className="flex h-7 min-w-[4.5rem] max-w-full items-center justify-between gap-1.5 rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] px-2 text-[11px] font-mono tabular-nums font-semibold text-[color:var(--ibo-ink)] hover:border-[#0ea4ab]/40"
            >
              <span className="truncate">{tickLabel(tickSize)}</span>
              <ChevronDown size={12} className="text-[color:var(--ibo-muted)] flex-shrink-0" />
            </button>
            {tickOpen && (
              <div
                className="absolute left-0 right-0 top-full z-40 mt-1 max-h-48 overflow-y-auto rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] py-1 shadow-xl scrollbar-hide sm:left-auto sm:right-0 sm:min-w-[120px]"
              >
                {TICK_PRESETS.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`flex w-full items-center px-3 py-1.5 text-left text-[11px] font-mono tabular-nums hover:bg-[color:var(--ibo-elevated)] ${
                      t === tickSize ? 'text-[#0ea4ab] bg-[#0ea4ab]/10' : 'text-[color:var(--ibo-ink)]'
                    }`}
                    onClick={() => {
                      manualTickRef.current = true;
                      setTickSize(t);
                      setTickOpen(false);
                    }}
                  >
                    {tickLabel(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {DEPTHS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setRows(d)}
                className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md text-[11px] font-mono tabular-nums font-semibold transition-colors ${
                  rows === d
                    ? 'bg-[#0ea4ab]/15 text-[#0ea4ab] ring-1 ring-[#0ea4ab]/35'
                    : 'bg-[color:var(--ibo-card)] text-[color:var(--ibo-muted)] border border-[color:var(--ibo-border-solid)] hover:text-[color:var(--ibo-ink)] hover:border-[#0ea4ab]/35'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex px-3 py-1.5 text-[10px] text-[color:var(--ibo-muted)] font-medium flex-shrink-0 border-b border-[color:var(--ibo-border)]">
        <span className="w-1/3">Price ({quoteAsset})</span>
        <span className="w-1/3 text-right">Amt ({displayBase})</span>
        <span className="w-1/3 text-right">Total ({quoteAsset})</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-3 py-6 gap-2 text-center">
          <span className="text-xs text-red-400/90">{loadError}</span>
          <span className="text-[10px] text-white">Check the API or your connection</span>
          <button
            type="button"
            onClick={() => { setLoading(true); setLoadError(null); setWsKick(k => k + 1); }}
            className="text-[11px] font-bold text-[#C5E35B] hover:underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">

          {/* Outer justify-end keeps asks near the spread; inner scroll avoids flex-col-reverse (breaks overflow-y in Chromium). */}
          <div className={`flex min-h-0 flex-col justify-end overflow-hidden ${asksFlex}`}>
            <div className="order-book-scroll flex min-h-0 max-h-full w-full flex-col">
              {viewMode !== 'bids' && (
                <div className="px-3 pt-2 pb-1 flex-shrink-0">
                  <span className="text-[11px] text-red-400/80 uppercase tracking-widest font-extrabold">
                    ▼ Asks (Sell)
                  </span>
                </div>
              )}
              {asks.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-white">No asks</div>
              ) : (
                asks.map(([p, q], i) => {
                  const revIdx = asks.length - 1 - i;
                  const pk = String(p);
                  return (
                    <Row key={`ask-${pk}`}
                      price={p} qty={q} side="ask" tickSize={tickSize} onPriceClick={onPriceClick}
                      pct={Math.min((parseFloat(p) * parseFloat(q) / maxTotal) * 100, 100)}
                      cumPct={Math.min((askTotals[revIdx] / maxAsk) * 100, 100)}
                    />
                  );
                })
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => mid > 0 && onPriceClick?.(fmtPrice(mid, tickSize))}
            className="flex items-center justify-between px-3 py-2
              border-y border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated)]
              hover:bg-[color:var(--ibo-hover)] flex-shrink-0 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-[#0ea4ab] font-mono tabular-nums tracking-tight">
                {mid > 0 ? fmtPrice(mid, tickSize) : '—'}
              </span>
              <span className="text-[9px] text-[color:var(--ibo-muted)] bg-[color:var(--ibo-card)] px-1.5 py-0.5 rounded font-semibold uppercase">
                Mid
              </span>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[color:var(--ibo-ink)] font-mono tabular-nums font-semibold">
                Spread {spread > 0 ? fmtPrice(spread, tickSize) : '—'}
              </div>
              {spreadPct > 0 && (
                <div className="text-[10px] text-[color:var(--ibo-muted)] font-mono tabular-nums">
                  {spreadPct.toFixed(3)}%
                </div>
              )}
            </div>
          </button>

          <div className={`order-book-scroll min-h-0 ${bidsFlex}`}>
            {viewMode !== 'asks' && (
              <div className="px-3 pt-2 pb-1">
                <span className="text-[11px] text-green-400/80 uppercase tracking-widest font-extrabold">
                  ▲ Bids (Buy)
                </span>
              </div>
            )}
            {bids.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-white">No bids</div>
            ) : (
              bids.map(([p, q], i) => (
                <Row key={`bid-${String(p)}`}
                  price={p} qty={q} side="bid" tickSize={tickSize} onPriceClick={onPriceClick}
                  pct={Math.min((parseFloat(p) * parseFloat(q) / maxTotal) * 100, 100)}
                  cumPct={Math.min((bidTotals[i] / maxBid) * 100, 100)}
                />
              ))
            )}
          </div>

        </div>
      )}
    </div>
  );
}
