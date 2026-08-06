/**
 * Options tape — Price · Size · Time/Taker (same chrome as spot RecentTrades).
 */
export default function OptionsRecentTrades({ trades = [], hideHeader = false, sizeUnit = '' }) {
  const rows = Array.isArray(trades) ? trades.slice(0, 40) : [];
  const sizeLabel = sizeUnit ? `Size (${sizeUnit})` : 'Size';

  const fmtP = (n) => {
    const v = parseFloat(n);
    if (!Number.isFinite(v)) return '—';
    if (v >= 100) return v.toFixed(1);
    if (v >= 1) return v.toFixed(2);
    return v.toFixed(4);
  };

  const fmtQ = (n) => {
    const v = parseFloat(n);
    if (!Number.isFinite(v)) return '—';
    if (v >= 0.001) return v.toFixed(3);
    return v.toFixed(4);
  };

  const ts = (t) => {
    const ms = typeof t === 'number' ? t : Date.parse(t);
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  return (
    <div className="rt-panel flex flex-col h-full min-h-0 bg-transparent select-none">
      {!hideHeader ? (
        <div className="rt-head">
          <h3 className="rt-head__title">Recent Trades</h3>
        </div>
      ) : null}

      <div className="rt-cols">
        <span>Price (USD)</span>
        <span className="text-right">{sizeLabel}</span>
        <span className="text-right">Time/Taker</span>
      </div>

      <div className="rt-scroll flex-1 overflow-y-auto min-h-0">
        {rows.length === 0 ? (
          <p className="text-center text-[11px] py-6" style={{ color: 'var(--ibo-muted)' }}>
            No trades yet
          </p>
        ) : (
          rows.map((t, i) => {
            const side = String(t.side || '').toLowerCase();
            const isBuy = side === 'buy' || side === 'b';
            const id = t.id ?? `${t.created_at}-${t.price}-${i}`;
            return (
              <div key={id} className="rt-row">
                <span className={`rt-row__px ${isBuy ? 'is-buy' : 'is-sell'}`}>
                  {fmtP(t.price)}
                  <span className="rt-row__arrow" aria-hidden>
                    {isBuy ? '↗' : '↘'}
                  </span>
                </span>
                <span className="rt-row__sz">{fmtQ(t.qty)}</span>
                <span className="rt-row__time">
                  {ts(t.created_at || t.time || t.ts)}
                  <span className={isBuy ? 'is-buy' : 'is-sell'}>
                    {' '}/{isBuy ? 'B' : 'S'}
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
