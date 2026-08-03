import { useRegisterLiveMarkets, REGISTER_PREVIEW_PAIRS } from '@/hooks/useRegisterLiveMarkets';

function formatPrice(price) {
  const px = parseFloat(price || 0);
  if (!Number.isFinite(px) || px <= 0) return '—';
  return `$${px.toLocaleString(undefined, { maximumFractionDigits: px >= 100 ? 2 : 4 })}`;
}

export default function RegisterLiveMarketPreview() {
  const { rows, loading } = useRegisterLiveMarkets();

  return (
    <div className="space-y-2">
      {loading && !rows.length ? (
        REGISTER_PREVIEW_PAIRS.map((sym) => (
          <div key={sym} className="flex items-center justify-between animate-pulse">
            <span className="h-3 w-16 rounded bg-white/10" />
            <div className="flex items-center gap-3">
              <span className="h-3 w-14 rounded bg-white/10" />
              <span className="h-3 w-10 rounded bg-white/10" />
            </div>
          </div>
        ))
      ) : rows.length ? (
        rows.map((t) => {
          const pct = parseFloat(t.priceChangePercent ?? 0);
          const base = t.symbol.replace('USDT', '');
          return (
            <div key={t.symbol} className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">{base}/USDT</span>
              <div className="flex items-center gap-3">
                <span
                  key={String(t.price)}
                  className="text-xs text-white font-mono transition-colors duration-300"
                >
                  {formatPrice(t.price)}
                </span>
                <span className={`text-[11px] font-bold ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })
      ) : (
        <p className="text-xs text-white/45">Market data unavailable</p>
      )}
    </div>
  );
}
