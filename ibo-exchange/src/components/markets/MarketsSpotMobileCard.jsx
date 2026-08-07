import { Link } from 'react-router-dom';
import { Star, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import MarketCoinCell from '@/components/markets/MarketCoinCell';
import { fmtMarketPrice, fmtMarketVol, num } from '@/lib/marketFormat';

export default function MarketsSpotMobileCard({ market, isFavorite, onToggleFavorite }) {
  const pct = num(market.priceChangePercent);
  const isUp = pct >= 0;
  const base = market.base || market.symbol?.replace('USDT', '') || '';

  return (
    <div
      className="rounded-2xl border border-surface-border p-3.5 sm:p-4 space-y-3 max-w-full overflow-hidden"
      style={{ background: 'var(--ibo-card)' }}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onToggleFavorite ? (
            <button
              type="button"
              onClick={() => onToggleFavorite(market.symbol)}
              className="shrink-0 p-0.5"
              aria-label={isFavorite ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <Star size={15} className={isFavorite ? 'text-gold fill-gold' : 'text-[color:var(--ibo-muted)]'} />
            </button>
          ) : null}
          <MarketCoinCell market={market} size={36} />
        </div>
        <span className={`text-sm font-extrabold tabular-nums shrink-0 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
          {isUp ? '+' : ''}{pct.toFixed(2)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <div>
          <p className="text-white/45 uppercase font-bold text-[9px] tracking-wide">Last</p>
          <p className="text-white font-mono font-semibold tabular-nums">${fmtMarketPrice(market.price, base)}</p>
        </div>
        <div>
          <p className="text-white/45 uppercase font-bold text-[9px] tracking-wide">Vol USDT</p>
          <p className="text-white font-mono font-semibold tabular-nums">${fmtMarketVol(market.quoteVolume)}</p>
        </div>
        <div>
          <p className="text-white/45 uppercase font-bold text-[9px] tracking-wide">24h High</p>
          <p className="text-white/90 font-mono tabular-nums">${fmtMarketPrice(market.highPrice, base)}</p>
        </div>
        <div>
          <p className="text-white/45 uppercase font-bold text-[9px] tracking-wide">24h Low</p>
          <p className="text-white/90 font-mono tabular-nums">${fmtMarketPrice(market.lowPrice, base)}</p>
        </div>
      </div>

      <Link
        to={`/futures/${String(market.symbol).replace(/USDT$/,'')}USDT-PERP`}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md bg-[color:var(--ibo-accent)] text-[#101013] font-bold text-sm hover:brightness-110 transition-[filter]"
      >
        Trade {base}
        {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
