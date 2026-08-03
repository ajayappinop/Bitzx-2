import { ArrowUp, ArrowDown } from 'lucide-react';
import { useFutures } from '@/context/FuturesContext';

const fmtP = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 10000
    ? v.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : v >= 1
      ? v.toFixed(v >= 100 ? 1 : 4)
      : v.toFixed(6);
};

const fmtQ = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)}M`
    : v >= 1e3 ? `${(v / 1e3).toFixed(2)}K`
    : v.toFixed(4);
};

export default function FuturesRecentTrades({ hideHeader = false }) {
  const { recentTrades, symbols, activeSymbol } = useFutures();
  const meta = symbols.find((s) => s.symbol === activeSymbol);
  const base = meta?.base || 'BTC';

  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent select-none">
      {!hideHeader ? (
        <div className="flex h-8 items-center px-2.5 border-b border-[color:var(--ibo-border)] text-[12px] font-semibold text-[color:var(--ibo-ink)] shrink-0">
          Recent Trades
        </div>
      ) : null}
      <div className="flex px-3 sm:px-4 h-[28px] items-center text-[10px] text-[color:var(--ibo-muted)] shrink-0 border-b border-[color:var(--ibo-border)]">
        <span className="w-[38%]">Price (USD)</span>
        <span className="w-[28%] text-right">Size ({base})</span>
        <span className="w-[34%] text-right">Time/Taker</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {(recentTrades || []).slice(0, 80).map((t) => {
          const buy = t.side === 'buy';
          const time = (t.created_at || '').slice(11, 19) || '—';
          return (
            <div
              key={t.id}
              className="flex px-3 sm:px-4 h-[26px] items-center text-[12px] font-mono tabular-nums hover:bg-white/[0.03] border-b border-[color:var(--ibo-border)]/40"
            >
              <span className={`w-[38%] flex items-center gap-0.5 font-semibold ${
                buy ? 'text-[#0ECB81]' : 'text-[#F6465D]'
              }`}>
                {fmtP(t.price)}
                {buy
                  ? <ArrowUp size={10} className="shrink-0 opacity-90" strokeWidth={2.5} />
                  : <ArrowDown size={10} className="shrink-0 opacity-90" strokeWidth={2.5} />}
              </span>
              <span className="w-[28%] text-right text-[color:var(--ibo-ink)]">{fmtQ(t.qty)}</span>
              <span className="w-[34%] text-right text-[color:var(--ibo-muted)]">
                {time}
                <span className={buy ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
                  {buy ? '/B' : '/S'}
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
