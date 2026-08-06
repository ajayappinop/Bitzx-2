import { useEffect, useMemo, useRef, useState } from 'react';

function fmtPrice(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toFixed(1);
  return n.toFixed(6);
}

function fmtQty(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** IBO mock tape — same Recent Trades chrome as spot (screenshot layout). */
export default function IBOTrades({ trades, loading, hideHeader = false }) {
  const boxRef = useRef(null);
  const rows = useMemo(() => (Array.isArray(trades) ? trades.slice(0, 50) : []), [trades]);
  const topTs = rows[0]?.timestamp;
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (!boxRef.current) return undefined;
    boxRef.current.scrollTop = 0;
    setFlashing(true);
    const tm = setTimeout(() => setFlashing(false), 300);
    return () => clearTimeout(tm);
  }, [rows.length, topTs]);

  return (
    <div className="rt-panel flex flex-col h-full min-h-0 bg-transparent select-none">
      {!hideHeader ? (
        <div className="rt-head">
          <h3 className="rt-head__title">Recent Trades</h3>
        </div>
      ) : null}

      <div className="rt-cols">
        <span>Price (USD)</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time/Taker</span>
      </div>

      <div ref={boxRef} className="rt-scroll flex-1 overflow-y-auto min-h-0">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[color:var(--ibo-accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-[10px] text-[color:var(--ibo-muted)] py-6">No trades yet</p>
        ) : (
          rows.map((t, i) => {
            const buy = String(t.side || '').toLowerCase() === 'buy';
            const isNew = i === 0 && flashing;
            return (
              <div
                key={`${t.timestamp}-${i}`}
                className={`rt-row${isNew ? (buy ? ' is-flash-buy' : ' is-flash-sell') : ''}`}
              >
                <span className={`rt-row__px ${buy ? 'is-buy' : 'is-sell'}`}>
                  {fmtPrice(t.price)}
                  <span className="rt-row__arrow" aria-hidden>
                    {buy ? '↗' : '↘'}
                  </span>
                </span>
                <span className="rt-row__sz">{fmtQty(t.qty)}</span>
                <span className="rt-row__time">
                  {fmtTime(t.timestamp)}
                  <span className={buy ? 'is-buy' : 'is-sell'}>
                    {' '}/{buy ? 'B' : 'S'}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
