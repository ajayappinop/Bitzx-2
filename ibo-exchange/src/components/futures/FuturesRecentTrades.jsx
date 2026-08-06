import { useFutures } from '@/context/FuturesContext';

const fmtP = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toFixed(1);
  if (v >= 1) return v.toFixed(v >= 100 ? 1 : 4);
  return v.toFixed(6);
};

const fmtQ = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(4);
};

export default function FuturesRecentTrades({ hideHeader = false }) {
  const { recentTrades, symbols, activeSymbol } = useFutures();
  const meta = symbols.find((s) => s.symbol === activeSymbol);
  const base = meta?.base || 'BTC';

  return (
    <div className="rt-panel flex flex-col h-full min-h-0 bg-transparent select-none">
      {!hideHeader ? (
        <div className="rt-head">
          <h3 className="rt-head__title">Recent Trades</h3>
        </div>
      ) : null}
      <div className="rt-cols">
        <span>Price (USD)</span>
        <span className="text-right">Size ({base})</span>
        <span className="text-right">Time/Taker</span>
      </div>
      <div className="rt-scroll flex-1 overflow-y-auto">
        {(recentTrades || []).slice(0, 80).map((t) => {
          const buy = t.side === 'buy';
          const time = (t.created_at || '').slice(11, 19) || '—';
          return (
            <div key={t.id} className="rt-row">
              <span className={`rt-row__px ${buy ? 'is-buy' : 'is-sell'}`}>
                {fmtP(t.price)}
                <span className="rt-row__arrow" aria-hidden>
                  {buy ? '↗' : '↘'}
                </span>
              </span>
              <span className="rt-row__sz">{fmtQ(t.qty)}</span>
              <span className="rt-row__time">
                {time}
                <span className={buy ? 'is-buy' : 'is-sell'}>
                  {' '}/{buy ? 'B' : 'S'}
                </span>
              </span>
            </div>
          );
        })}
        {!(recentTrades || []).length ? (
          <p className="text-center text-[10px] text-[color:var(--ibo-muted)] py-6">No trades yet</p>
        ) : null}
      </div>
    </div>
  );
}
