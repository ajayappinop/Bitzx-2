import {
  useEffect,
  useState,
  useRef,
  useMemo,
  memo,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { exchangeWsPath, displayBaseForApiSymbol, parsePairFromApiSymbol } from '@/services/marketApi';
import {
  isSyntheticSpotSymbol,
  synthesizeOrderBook,
  recenterOrderBook,
  jitterOrderBook,
} from '@/lib/syntheticMarket';

const API_LIMIT = 100;
const TICK_PRESETS = [
  100, 10, 1, 0.5, 0.1, 0.01, 0.001, 0.0001, 0.00001, 0.000001, 0.0000001, 0.00000001,
];

/** Binance-style depth layout icons (red asks / green bids). */
function IconBookBoth({ active }) {
  const mute = active ? 1 : 0.38;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1.5" width="4" height="3" rx="0.5" fill={`rgba(246,70,93,${mute + 0.35})`} />
      <rect x="1" y="5.5" width="4" height="3" rx="0.5" fill={`rgba(246,70,93,${mute + 0.15})`} />
      <rect x="1" y="9.5" width="4" height="3" rx="0.5" fill={`rgba(14,203,129,${mute + 0.15})`} />
      <rect x="1" y="13.5" width="4" height="1.5" rx="0.4" fill={`rgba(14,203,129,${mute + 0.35})`} />
      <rect x="6.5" y="2" width="8.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
      <rect x="6.5" y="5" width="7" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute * 0.85})`} />
      <rect x="6.5" y="8" width="8" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
      <rect x="6.5" y="11" width="6.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute * 0.85})`} />
      <rect x="6.5" y="14" width="7.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
    </svg>
  );
}

function IconBookBids({ active }) {
  const mute = active ? 1 : 0.38;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1.5" width="4" height="3" rx="0.5" fill={`rgba(14,203,129,${mute + 0.35})`} />
      <rect x="1" y="5.5" width="4" height="3" rx="0.5" fill={`rgba(14,203,129,${mute + 0.2})`} />
      <rect x="1" y="9.5" width="4" height="3" rx="0.5" fill={`rgba(14,203,129,${mute + 0.1})`} />
      <rect x="1" y="13.5" width="4" height="1.5" rx="0.4" fill={`rgba(14,203,129,${mute})`} />
      <rect x="6.5" y="2" width="8.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
      <rect x="6.5" y="5" width="7" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute * 0.85})`} />
      <rect x="6.5" y="8" width="8" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
      <rect x="6.5" y="11" width="6.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute * 0.85})`} />
      <rect x="6.5" y="14" width="7.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
    </svg>
  );
}

function IconBookAsks({ active }) {
  const mute = active ? 1 : 0.38;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="1.5" width="4" height="3" rx="0.5" fill={`rgba(246,70,93,${mute + 0.35})`} />
      <rect x="1" y="5.5" width="4" height="3" rx="0.5" fill={`rgba(246,70,93,${mute + 0.2})`} />
      <rect x="1" y="9.5" width="4" height="3" rx="0.5" fill={`rgba(246,70,93,${mute + 0.1})`} />
      <rect x="1" y="13.5" width="4" height="1.5" rx="0.4" fill={`rgba(246,70,93,${mute})`} />
      <rect x="6.5" y="2" width="8.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
      <rect x="6.5" y="5" width="7" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute * 0.85})`} />
      <rect x="6.5" y="8" width="8" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
      <rect x="6.5" y="11" width="6.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute * 0.85})`} />
      <rect x="6.5" y="14" width="7.5" height="1.2" rx="0.4" fill={`rgba(128,128,128,${mute})`} />
    </svg>
  );
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
  if (tick >= 1) return 0;
  if (tick >= 0.5) return 1;
  if (tick >= 0.1) return 1;
  if (tick >= 0.01) return 2;
  const s = String(tick);
  if (s.includes('e') || s.includes('E')) {
    const match = /^(\d\.?\d*)e([-+]\d+)$/i.exec(Number(tick).toExponential());
    if (!match) return 8;
    const exp = parseInt(match[2], 10);
    if (exp >= 0) return Math.min(8, exp + 2);
    return Math.min(8, -exp);
  }
  const frac = s.split('.')[1];
  return frac ? Math.min(8, frac.replace(/0+$/, '').length || frac.length) : 0;
}

function fmtPrice(n, tickSize) {
  const v = parseFloat(n);
  const d = decimalsForTick(tickSize);
  if (!Number.isFinite(v)) return '—';
  // Screenshot style: plain digits, no grouping commas (e.g. 64835.0)
  return v.toFixed(d);
}

const fmtQ = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000000) return `${(v / 1000000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)}K`;
  // Reference tape/book sizes: 0.025, 1.463, 4.756
  if (v >= 0.001) return v.toFixed(3);
  return v.toFixed(4);
};

function tickLabel(t) {
  if (t >= 1) return String(t);
  if (t === 0.5) return '0.5';
  return t.toFixed(8).replace(/\.?0+$/, '') || String(t);
}

function pickDefaultTick(mid) {
  if (!mid || mid <= 0) return 0.5;
  if (mid >= 10000) return 0.5;
  if (mid >= 1000) return 0.1;
  if (mid >= 100) return 0.01;
  if (mid >= 1) return 0.0001;
  if (mid >= 0.01) return 0.000001;
  return 0.00000001;
}

const Row = memo(function Row({
  price, qty, side, cumSize, maxCum, tickSize, onPriceClick,
}) {
  const isBid = side === 'bid';
  const cumPct = maxCum > 0 ? Math.min(100, (cumSize / maxCum) * 100) : 0;

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
      className={`ob-row ${isBid ? 'ob-row--bid' : 'ob-row--ask'}`}
    >
      {/* Depth spans Size+Total from the right (reference) */}
      <span
        className="ob-row__depth"
        style={{ width: `${Math.max(cumPct * 0.68, cumPct > 0 ? 6 : 0)}%` }}
        aria-hidden
      />
      <span className="ob-row__px">{fmtPrice(price, tickSize)}</span>
      <span className="ob-row__sz">{fmtQ(qty)}</span>
      <span className="ob-row__tot">{fmtQ(cumSize)}</span>
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
  const [rows] = useState(12);
  const [tickSize, setTickSize] = useState(0.5);
  const [tickOpen, setTickOpen] = useState(false);
  const [viewMode, setViewMode] = useState('all');
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
        try { ws.close(); } catch { /* ignore */ }
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
    const el = (e) => {
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

  // Auto tick after agg/mid exist — BTC ~65k → 0.5 (matches reference grouping)
  useEffect(() => {
    if (manualTickRef.current) return;
    const p = parseFloat(lastPrice);
    const ref = Number.isFinite(p) && p > 0 ? p : midFromBook;
    if (ref > 0) setTickSize(pickDefaultTick(ref));
  }, [symbol, lastPrice, midFromBook]);

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

  const maxCum = Math.max(
    askCumSizes[0] || 0,
    bidCumSizes[bidCumSizes.length - 1] || 0,
    1,
  );

  const lastDirUp = useMemo(() => {
    const p = parseFloat(lastPrice);
    if (!Number.isFinite(p) || p <= 0) return null;
    if (bestBid > 0 && bestAsk > 0) {
      const midBook = (bestBid + bestAsk) / 2;
      return p >= midBook;
    }
    return true;
  }, [lastPrice, bestBid, bestAsk]);

  const markPx = midFromBook > 0 ? midFromBook : mid;
  const asksFlex = viewMode === 'bids' ? 'hidden' : 'flex-1 min-h-0';
  const bidsFlex = viewMode === 'asks' ? 'hidden' : 'flex-1 min-h-0';
  const quoteLabel = quoteAsset === 'USDT' || quoteAsset === 'USD' ? 'USD' : quoteAsset;
  const baseLabel = displayBase || baseAsset || '—';

  return (
    <div className="delta-ob ob-panel flex flex-col h-full min-h-0 overflow-hidden select-none">
      {/* Header — title, then layout icons + tick (screenshot) */}
      <div className="ob-head">
        <div className="ob-head__title-row">
          <h3 className="ob-head__title">Order Book</h3>
        </div>
        <div className="ob-head__ctrl-row">
          <div className="ob-view" role="group" aria-label="Book view">
            <button
              type="button"
              title="Bids & asks"
              onClick={() => setViewMode('all')}
              className={`ob-view__btn${viewMode === 'all' ? ' is-on' : ''}`}
            >
              <IconBookBoth active={viewMode === 'all'} />
            </button>
            <button
              type="button"
              title="Bids only"
              onClick={() => setViewMode('bids')}
              className={`ob-view__btn${viewMode === 'bids' ? ' is-on' : ''}`}
            >
              <IconBookBids active={viewMode === 'bids'} />
            </button>
            <button
              type="button"
              title="Asks only"
              onClick={() => setViewMode('asks')}
              className={`ob-view__btn${viewMode === 'asks' ? ' is-on' : ''}`}
            >
              <IconBookAsks active={viewMode === 'asks'} />
            </button>
          </div>
          <div className="ob-precision" ref={tickRef}>
            <button
              type="button"
              onClick={() => setTickOpen((o) => !o)}
              className="ob-precision__btn"
              aria-expanded={tickOpen}
              aria-haspopup="listbox"
              title="Price grouping"
            >
              <span className="ob-precision__val">{tickLabel(tickSize)}</span>
              <ChevronDown size={12} strokeWidth={2.25} className={`ob-precision__chev${tickOpen ? ' is-open' : ''}`} />
            </button>
            {tickOpen ? (
              <ul className="ob-precision__menu" role="listbox">
                {TICK_PRESETS.map((t) => (
                  <li key={t} role="option" aria-selected={t === tickSize}>
                    <button
                      type="button"
                      className={`ob-precision__opt${t === tickSize ? ' is-on' : ''}`}
                      onClick={() => {
                        manualTickRef.current = true;
                        setTickSize(t);
                        setTickOpen(false);
                      }}
                    >
                      {tickLabel(t)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      {/* Column labels — Price · Size · Total (base) */}
      <div className="ob-cols">
        <span>Price ({quoteLabel})</span>
        <span className="text-right">Size ({baseLabel})</span>
        <span className="text-right">Total ({baseLabel})</span>
      </div>

      {loading ? (
        <div className="ob-state">
          <div className="ob-state__spin" />
        </div>
      ) : loadError ? (
        <div className="ob-state">
          <p className="ob-state__err">{loadError}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); setLoadError(null); setWsKick((k) => k + 1); }}
            className="ob-state__retry"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Asks */}
          <div className={`flex min-h-0 flex-col justify-end overflow-hidden ${asksFlex}`}>
            <div className="order-book-scroll ob-scroll flex min-h-0 max-h-full w-full flex-col overflow-y-auto">
              {asks.length === 0 ? (
                <div className="ob-empty">No asks</div>
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

          {/* Last + Mark — screenshot: $LAST …… [M] mark */}
          <button
            type="button"
            onClick={() => mid > 0 && onPriceClick?.(fmtPrice(mid, tickSize))}
            className="ob-mid"
          >
            <span
              className={`ob-mid__last${
                lastDirUp == null ? '' : lastDirUp ? ' is-up' : ' is-down'
              }`}
            >
              {mid > 0 ? `$${fmtPrice(mid, tickSize)}` : '—'}
            </span>
            <span className="ob-mid__mark" title="Mark / book mid">
              <span className="ob-mid__badge" aria-hidden>M</span>
              <span className="ob-mid__mark-px">
                {markPx > 0 ? fmtPrice(markPx, tickSize) : '—'}
              </span>
            </span>
          </button>

          {/* Bids */}
          <div className={`order-book-scroll ob-scroll min-h-0 overflow-y-auto ${bidsFlex}`}>
            {bids.length === 0 ? (
              <div className="ob-empty">No bids</div>
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
