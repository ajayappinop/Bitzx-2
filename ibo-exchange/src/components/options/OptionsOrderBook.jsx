import { memo, useMemo, useState } from 'react';
import { RefreshCw, AlignVerticalJustifyCenter, ArrowUpFromLine, ArrowDownToLine } from 'lucide-react';

function fmt(n, d = 1) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(d);
}

function fmtSz(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toFixed(1);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(3);
}

const TICKS = [0.1, 0.5, 1, 2.5, 5, 10];

const Row = memo(function Row({ price, qty, cum, side, cumPct, onPriceClick, tick }) {
  const isBid = side === 'bid';
  const dec = tick >= 1 ? 0 : tick >= 0.1 ? 1 : 2;
  return (
    <button
      type="button"
      onClick={() => onPriceClick?.(String(price))}
      className={`ob-row ${isBid ? 'ob-row--bid' : 'ob-row--ask'}`}
    >
      <span
        className="ob-row__depth"
        style={{ width: `${Math.max(cumPct * 0.72, cumPct > 0 ? 5 : 0)}%` }}
        aria-hidden
      />
      <span className="ob-row__px">{fmt(price, dec)}</span>
      <span className="ob-row__sz">{fmtSz(qty)}</span>
      <span className="ob-row__tot">{fmtSz(cum)}</span>
    </button>
  );
});

/**
 * Options depth — Delta screenshot: view modes, tick, Price/Size/Total, big mid + mark.
 */
export default function OptionsOrderBook({
  depth = null,
  loading = false,
  midPrice = null,
  markIv = null,
  onPriceClick,
  emptyHint = 'Select a contract to view depth',
  sizeUnit = 'BTC',
}) {
  const [mode, setMode] = useState('both'); // both | asks | bids
  const [tick, setTick] = useState(0.1);

  const asks = useMemo(() => {
    const rows = Array.isArray(depth?.asks) ? depth.asks : [];
    return rows.slice(0, 14).map((r) => [parseFloat(r[0]), parseFloat(r[1])]).filter(([p, q]) => Number.isFinite(p) && q > 0);
  }, [depth]);

  const bids = useMemo(() => {
    const rows = Array.isArray(depth?.bids) ? depth.bids : [];
    return rows.slice(0, 14).map((r) => [parseFloat(r[0]), parseFloat(r[1])]).filter(([p, q]) => Number.isFinite(p) && q > 0);
  }, [depth]);

  const askDisplay = useMemo(() => [...asks].reverse(), [asks]);

  const { askCums, bidCums, maxCum } = useMemo(() => {
    const askCums = new Array(askDisplay.length);
    let run = 0;
    for (let i = askDisplay.length - 1; i >= 0; i -= 1) {
      run += askDisplay[i][1] || 0;
      askCums[i] = run;
    }
    run = 0;
    const bidCums = bids.map(([, q]) => {
      run += q || 0;
      return run;
    });
    const maxCum = Math.max(askCums[0] || 0, bidCums[bidCums.length - 1] || 0, 1);
    return { askCums, bidCums, maxCum };
  }, [askDisplay, bids]);

  const mid = midPrice != null && Number.isFinite(Number(midPrice))
    ? Number(midPrice)
    : (asks[0]?.[0] && bids[0]?.[0] ? (asks[0][0] + bids[0][0]) / 2 : asks[0]?.[0] || bids[0]?.[0] || 0);

  const bestAsk = asks[0]?.[0];
  const bestBid = bids[0]?.[0];
  const midTone = bestAsk != null && mid > 0 && mid >= bestAsk ? 'is-down'
    : bestBid != null && mid > 0 && mid <= bestBid ? 'is-up'
      : bestBid != null && bestAsk != null && mid >= (bestBid + bestAsk) / 2 ? 'is-up' : 'is-down';

  const markIvLabel = (() => {
    if (markIv == null || !Number.isFinite(Number(markIv))) return null;
    const n = Number(markIv);
    return (n <= 2 ? n * 100 : n).toFixed(1);
  })();

  const showAsks = mode === 'both' || mode === 'asks';
  const showBids = mode === 'both' || mode === 'bids';
  const hasBook = asks.length > 0 || bids.length > 0;

  return (
    <div className="delta-ob ob-panel doc-ob flex flex-col h-full min-h-0 overflow-hidden select-none">
      <div className="ob-head">
        <div className="ob-head__title-row">
          <h3 className="ob-head__title">Order Book</h3>
          <div className="doc-ob__modes">
            <button type="button" title="Bids & Asks" className={mode === 'both' ? 'is-on' : ''} onClick={() => setMode('both')}>
              <AlignVerticalJustifyCenter size={14} />
            </button>
            <button type="button" title="Asks only" className={mode === 'asks' ? 'is-on' : ''} onClick={() => setMode('asks')}>
              <ArrowUpFromLine size={14} />
            </button>
            <button type="button" title="Bids only" className={mode === 'bids' ? 'is-on' : ''} onClick={() => setMode('bids')}>
              <ArrowDownToLine size={14} />
            </button>
            <select
              className="doc-ob__tick"
              value={tick}
              onChange={(e) => setTick(Number(e.target.value))}
              title="Price grouping"
            >
              {TICKS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="ob-cols">
        <span>Price (USD)</span>
        <span className="text-right">Size ({sizeUnit})</span>
        <span className="text-right">Total ({sizeUnit})</span>
      </div>

      {loading ? (
        <div className="ob-state">
          <RefreshCw size={16} className="animate-spin text-[color:var(--ibo-accent)]" />
          <p className="ob-state__err">Loading depth…</p>
        </div>
      ) : !depth && !hasBook ? (
        <div className="ob-state">
          <p className="ob-state__err">{emptyHint}</p>
        </div>
      ) : !hasBook ? (
        <div className="ob-state">
          <p className="ob-state__err">{emptyHint}</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {showAsks ? (
            <div className={`flex min-h-0 flex-col justify-end overflow-hidden ${mode === 'both' ? 'flex-1' : 'flex-[1.2]'}`}>
              <div className="order-book-scroll ob-scroll flex min-h-0 max-h-full w-full flex-col overflow-y-auto">
                {askDisplay.length === 0 ? (
                  <div className="ob-empty">No asks</div>
                ) : (
                  askDisplay.map(([p, q], i) => (
                    <Row
                      key={`a-${p}`}
                      price={p}
                      qty={q}
                      cum={askCums[i] || 0}
                      side="ask"
                      tick={tick}
                      cumPct={maxCum > 0 ? ((askCums[i] || 0) / maxCum) * 100 : 0}
                      onPriceClick={onPriceClick}
                    />
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div
            className="ob-mid doc-ob__mid"
            style={{ cursor: mid > 0 ? 'pointer' : 'default' }}
            onClick={() => mid > 0 && onPriceClick?.(String(mid))}
          >
            <span className={`ob-mid__last ${midTone}`}>{mid > 0 ? `$${fmt(mid, mid >= 10 ? 1 : 1)}` : '—'}</span>
            {markIvLabel != null ? (
              <span className="ob-mid__meta">
                <span className="ob-mid__badge" title="Mark">M</span>
                <span className="ob-mid__mark-px" title="Mark IV %">{markIvLabel}</span>
              </span>
            ) : null}
          </div>

          {showBids ? (
            <div className={`flex min-h-0 flex-col overflow-hidden ${mode === 'both' ? 'flex-1' : 'flex-[1.2]'}`}>
              <div className="order-book-scroll ob-scroll flex min-h-0 max-h-full w-full flex-col overflow-y-auto">
                {bids.length === 0 ? (
                  <div className="ob-empty">No bids</div>
                ) : (
                  bids.map(([p, q], i) => (
                    <Row
                      key={`b-${p}`}
                      price={p}
                      qty={q}
                      cum={bidCums[i] || 0}
                      side="bid"
                      tick={tick}
                      cumPct={maxCum > 0 ? ((bidCums[i] || 0) / maxCum) * 100 : 0}
                      onPriceClick={onPriceClick}
                    />
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
