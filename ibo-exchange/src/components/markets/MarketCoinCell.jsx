import { Link } from 'react-router-dom';
import { coinIconUrl } from '@/services/marketApi';
import { BRAND_MARK } from '@/lib/brandAssets';

/**
 * Consistent coin identity cell for markets tables (admin-managed metadata).
 */
export default function MarketCoinCell({ market, size = 40, showQuote = true, linkToTrade = false }) {
  const base = market?.base || market?.symbol?.replace(/USDT$/, '').replace(/IBO$/, '') || '';
  const quote = market?.quote || market?.quoteAsset || (market?.symbol?.endsWith('IBO') ? 'IBO' : 'USDT');
  const icon = coinIconUrl(base, market?.logo_url);
  const displayName = [market?.project_name, market?.token_name]
    .map((v) => (v != null ? String(v).trim() : ''))
    .find((v) => v && v.toUpperCase() !== String(base).toUpperCase()) || '';
  const tagline = market?.market_tagline;
  const category = market?.market_category;
  const isListed = market?.is_listed || market?.source === 'listed' || market?.source === 'internal_mock';
  const isIbo = base === 'IBO' || market?.is_platform_default;
  const showCategory = category && category !== 'alt' && !(isListed && category === 'listed');

  const inner = (
    <div className="flex items-center gap-3 min-w-0">
      {icon ? (
        <img
          src={icon}
          alt={base}
          width={size}
          height={size}
          className="rounded-full shrink-0 ring-1 ring-[color:var(--ibo-border-solid)] object-contain bg-transparent"
          loading="lazy"
          onError={(e) => {
            const fb = coinIconUrl(base, null);
            if (fb && e.currentTarget.src !== fb) e.currentTarget.src = fb;
            else if (base === 'IBO' && e.currentTarget.src !== BRAND_MARK) e.currentTarget.src = BRAND_MARK;
          }}
        />
      ) : (
        <div
          className="rounded-full bg-gold/20 flex items-center justify-center text-gold-light font-bold shrink-0"
          style={{ width: size, height: size, fontSize: Math.max(10, size * 0.32) }}
        >
          {base?.slice(0, 2)}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-white font-semibold text-sm sm:text-base">{base}</span>
          {showQuote ? (
            <span className="text-zinc-500 text-xs font-normal">/ {quote}</span>
          ) : null}
          {isIbo ? (
            <span className="text-[9px] bg-gold/15 text-gold-light px-1.5 py-0.5 rounded font-bold border border-gold/25">
              IBO
            </span>
          ) : null}
          {isListed && !isIbo ? (
            <span className="text-[9px] bg-sky-500/15 text-sky-200 px-1.5 py-0.5 rounded font-bold border border-sky-500/25">
              Listed
            </span>
          ) : null}
          {showCategory ? (
            <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold">{category}</span>
          ) : null}
        </div>
        {displayName ? (
          <p className="text-[11px] text-zinc-400 truncate max-w-[min(100%,12rem)] sm:max-w-[280px]">{displayName}</p>
        ) : null}
        {tagline ? (
          <p className="text-[10px] text-zinc-500 truncate max-w-[min(100%,14rem)] hidden sm:block">{tagline}</p>
        ) : null}
      </div>
    </div>
  );

  if (linkToTrade && market?.symbol) {
    return (
      <Link to={`/trade/${market.symbol}`} className="hover:opacity-90 transition-opacity">
        {inner}
      </Link>
    );
  }
  return inner;
}
