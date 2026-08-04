/**
 * FuturesOrderBook — futures depth panel (same visual system as spot OrderBook).
 * Data from FuturesContext WS; supports tick grouping, view modes, click-to-fill.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useFutures } from '@/context/FuturesContext';

const TICK_PRESETS = [
  10000, 1000, 100, 10, 1, 0.5, 0.1, 0.01, 0.001, 0.0001, 0.00001, 0.000001,
];

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
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
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
  if (mid >= 1000) return 0.1;
  if (mid >= 100) return 0.01;
  if (mid >= 1) return 0.0001;
  if (mid >= 0.01) return 0.000001;
  return 0.00000001;
}

function aggregateLevels(levels, tick) {
  const m = new Map();
  for (const [p, q] of levels) {
    const price = parseFloat(p);
    const qty = parseFloat(q);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) continue;
    const grid = Math.round(price / tick) * tick;
    const key = Number(grid.toPrecision(14));
    m.set(key, (m.get(key) || 0) + qty);
  }
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
}

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

const Row = memo(function Row({ price, qty, side, cumSize, maxCum, maxQty, tick, onPriceClick }) {
  const isBid = side === 'bid';
  const cumPct = maxCum > 0 ? Math.min(100, (cumSize / maxCum) * 100) : 0;
  const qtyPct = maxQty > 0 ? Math.min(100, (parseFloat(qty) / maxQty) * 100) : 0;
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
      className={`ob-row ${isBid ? 'ob-row--bid' : 'ob-row--ask'}`}
    >
      <div
        className="ob-row__depth"
        style={{ width: `${Math.max(cumPct, cumPct > 0 ? 2 : 0)}%` }}
        aria-hidden
      />
      <div
        className="ob-row__lvl"
        style={{ width: `${Math.max(qtyPct * 0.55, qtyPct > 0 ? 1.5 : 0)}%` }}
        aria-hidden
      />
      <span className="ob-row__px">{fmtPrice(price, tick)}</span>
      <span className="ob-row__sz">{fmtQty(qty)}</span>
      <span className="ob-row__tot">{fmtQty(cumSize)}</span>
    </div>
  );
}, (a, b) =>
  a.price === b.price
  && a.qty === b.qty
  && a.cumSize === b.cumSize
  && a.maxCum === b.maxCum
  && a.maxQty === b.maxQty
  && a.tick === b.tick,
);

export default function FuturesOrderBook({ onPriceClick }) {
  const { orderbook, activeMark, symbols, activeSymbol } = useFutures();

  const meta = useMemo(
    () => symbols.find((s) => s.symbol === activeSymbol) || {},
    [symbols, activeSymbol],
  );
  const base = meta.base || (activeSymbol || '').replace(/USDT.*/i, '') || 'BASE';
  const markPx = Number(activeMark?.mark_price || 0);

  const rows = 14;
  const [tickSize, setTickSize] = useState(() => pickDefaultTick(markPx || 50000));
  const [tickOpen, setTickOpen] = useState(false);
  const [viewMode, setViewMode] = useState('all');
  const tickRef = useRef(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTickSize(pickDefaultTick(markPx || 50000)); }, [activeSymbol]);

  useEffect(() => {
    const handler = (e) => {
      if (tickRef.current && !tickRef.current.contains(e.target)) setTickOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const asksAsc = useMemo(() => normFromContext(orderbook?.asks), [orderbook?.asks]);
  const bidsAsc = useMemo(() => normFromContext(orderbook?.bids), [orderbook?.bids]);
  const asksAgg = useMemo(() => aggregateLevels(asksAsc, tickSize), [asksAsc, tickSize]);
  const bidsAgg = useMemo(() => aggregateLevels(bidsAsc, tickSize), [bidsAsc, tickSize]);

  const asks = useMemo(() => asksAgg.slice(0, rows).reverse(), [asksAgg, rows]);
  const bids = useMemo(() => bidsAgg.slice(-rows).reverse(), [bidsAgg, rows]);

  const bestAsk = asksAgg.length ? asksAgg[0][0] : 0;
  const bestBid = bidsAgg.length ? bidsAgg[bidsAgg.length - 1][0] : 0;
  const bookMid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const lastPx = bookMid > 0 ? bookMid : markPx;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const spreadPct = lastPx > 0 && spread > 0 ? (spread / lastPx) * 100 : 0;

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
  const maxQty = useMemo(() => {
    let m = 0;
    for (const [, q] of asks) m = Math.max(m, Number(q) || 0);
    for (const [, q] of bids) m = Math.max(m, Number(q) || 0);
    return m || 1;
  }, [asks, bids]);

  const bidDepth = bidCumSizes[bidCumSizes.length - 1] || 0;
  const askDepth = askCumSizes[0] || 0;
  const pressureTotal = bidDepth + askDepth;
  const bidPressure = pressureTotal > 0 ? (bidDepth / pressureTotal) * 100 : 50;

  const isEmpty = asksAgg.length === 0 && bidsAgg.length === 0;
  const lastDirUp = markPx > 0 && lastPx > 0 ? lastPx >= markPx * 0.9995 : true;

  return (
    <div className="delta-ob ob-panel flex flex-col h-full min-h-0 overflow-hidden select-none">
      <div className="ob-head">
        <div className="ob-head__title-row">
          <h3 className="ob-head__title">Order Book</h3>
        </div>
        <div className="ob-head__ctrl-row">
          <div className="ob-view" role="group" aria-label="Book view">
            <button type="button" title="Bids & asks" onClick={() => setViewMode('all')}
              className={`ob-view__btn${viewMode === 'all' ? ' is-on' : ''}`}>
              <IconBookBoth active={viewMode === 'all'} />
            </button>
            <button type="button" title="Bids only" onClick={() => setViewMode('bids')}
              className={`ob-view__btn${viewMode === 'bids' ? ' is-on' : ''}`}>
              <IconBookBids active={viewMode === 'bids'} />
            </button>
            <button type="button" title="Asks only" onClick={() => setViewMode('asks')}
              className={`ob-view__btn${viewMode === 'asks' ? ' is-on' : ''}`}>
              <IconBookAsks active={viewMode === 'asks'} />
            </button>
          </div>
          <div className="ob-precision" ref={tickRef}>
            <button type="button" onClick={() => setTickOpen((o) => !o)} className="ob-precision__btn"
              aria-expanded={tickOpen} title="Price grouping">
              <span className="ob-precision__val">{tickLabel(tickSize)}</span>
              <ChevronDown size={12} strokeWidth={2.25} className={`ob-precision__chev${tickOpen ? ' is-open' : ''}`} />
            </button>
            {tickOpen ? (
              <ul className="ob-precision__menu" role="listbox">
                {TICK_PRESETS.map((t) => (
                  <li key={t} role="option" aria-selected={t === tickSize}>
                    <button type="button"
                      className={`ob-precision__opt${t === tickSize ? ' is-on' : ''}`}
                      onClick={() => { setTickSize(t); setTickOpen(false); }}>
                      {tickLabel(t)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      <div className="ob-cols">
        <span>Price (USD)</span>
        <span className="text-right">Size ({base})</span>
        <span className="text-right">Total</span>
      </div>

      {isEmpty ? (
        <div className="ob-state">
          <p className="ob-state__muted">Waiting for depth…</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {viewMode !== 'bids' ? (
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
              <div className="order-book-scroll ob-scroll flex flex-col min-h-0 max-h-full overflow-y-auto">
                {asks.length === 0 ? (
                  <div className="ob-empty">No asks</div>
                ) : (
                  asks.map(([p, q], i) => (
                    <Row
                      key={`ask-${p}`}
                      price={p}
                      qty={q}
                      side="ask"
                      tick={tickSize}
                      onPriceClick={onPriceClick}
                      cumSize={askCumSizes[i] || 0}
                      maxCum={maxCum}
                      maxQty={maxQty}
                    />
                  ))
                )}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => lastPx > 0 && onPriceClick?.(fmtPrice(lastPx, tickSize))}
            className="ob-mid"
          >
            <div className="ob-mid__main min-w-0">
              <span className={`ob-mid__last${lastDirUp ? ' is-up' : ' is-down'}`}>
                {lastPx > 0 ? fmtPrice(lastPx, tickSize) : '—'}
              </span>
              {spread > 0 ? (
                <span className="ob-mid__spread">
                  Spread {fmtPrice(spread, tickSize)}
                  {spreadPct > 0 ? (
                    <span className="ob-mid__spread-pct">
                      ({spreadPct < 0.01 ? '<0.01' : spreadPct.toFixed(2)}%)
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="ob-mid__mark">
              <span className="ob-mid__mark-px">
                {markPx > 0 ? fmtPrice(markPx, tickSize) : '—'}
              </span>
              <span className="ob-mid__badge" title="Mark price">Mark</span>
            </div>
          </button>

          {viewMode !== 'asks' ? (
            <div className="order-book-scroll ob-scroll flex-1 min-h-0 overflow-y-auto">
              {bids.length === 0 ? (
                <div className="ob-empty">No bids</div>
              ) : (
                bids.map(([p, q], i) => (
                  <Row
                    key={`bid-${p}`}
                    price={p}
                    qty={q}
                    side="bid"
                    tick={tickSize}
                    onPriceClick={onPriceClick}
                    cumSize={bidCumSizes[i] || 0}
                    maxCum={maxCum}
                    maxQty={maxQty}
                  />
                ))
              )}
            </div>
          ) : null}

          {viewMode === 'all' && pressureTotal > 0 ? (
            <div className="ob-pressure" title="Bid vs ask depth (visible levels)">
              <div className="ob-pressure__bar">
                <div className="ob-pressure__bid" style={{ width: `${bidPressure}%` }} />
                <div className="ob-pressure__ask" style={{ width: `${100 - bidPressure}%` }} />
              </div>
              <div className="ob-pressure__labels">
                <span className="is-bid">B {bidPressure.toFixed(0)}%</span>
                <span className="is-ask">A {(100 - bidPressure).toFixed(0)}%</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
