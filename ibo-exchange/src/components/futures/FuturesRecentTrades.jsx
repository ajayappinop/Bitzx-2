import { useFutures } from '@/context/FuturesContext';

export default function FuturesRecentTrades() {
  const { recentTrades, symbols, activeSymbol } = useFutures();
  const meta = symbols.find((s) => s.symbol === activeSymbol);
  const base = meta?.base || 'BTC';

  return (
    <div className="flex flex-col h-full min-h-0 bg-[color:var(--ibo-surface)]">
      <div className="px-3 py-2 border-b border-[color:var(--ibo-border)] text-[12px] font-semibold text-[color:var(--ibo-ink)] shrink-0">
        Recent Trades
      </div>
      <div className="grid grid-cols-3 gap-1 px-3 py-1.5 text-[10px] text-[color:var(--ibo-muted)] shrink-0 border-b border-white/[0.04]">
        <span>Price (USD)</span>
        <span className="text-right">Size ({base})</span>
        <span className="text-right">Time</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {(recentTrades || []).slice(0, 40).map((t) => {
          const buy = t.side === 'buy';
          const time = (t.created_at || '').slice(11, 19) || '—';
          return (
            <div
              key={t.id}
              className="grid grid-cols-3 gap-1 px-3 py-[3px] text-[11px] font-mono hover:bg-white/[0.03]"
            >
              <span className={buy ? 'text-emerald-400' : 'text-rose-400'}>
                {Number(t.price).toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
              <span className="text-right text-[color:var(--ibo-ink)]/85">
                {Number(t.qty).toFixed(4)}
              </span>
              <span className="text-right text-[color:var(--ibo-muted)]">{time}</span>
            </div>
          );
        })}
        {!(recentTrades || []).length ? (
          <p className="text-center text-[11px] text-[color:var(--ibo-muted)] py-6">No trades yet</p>
        ) : null}
      </div>
    </div>
  );
}
