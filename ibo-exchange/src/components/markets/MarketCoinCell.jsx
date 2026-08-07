import { Link } from 'react-router-dom';
import { coinIconUrl, displayAssetCode } from '@/services/marketApi';
import { BRAND_MARK } from '@/lib/brandAssets';

/**
 * Consistent coin identity cell for markets tables (admin-managed metadata).
 */
export default function MarketCoinCell({ market, size = 40, showQuote = true, linkToTrade = false }) {
  const base = market?.base || market?.symbol?.replace(/USDT$/, '').replace(/IBO$/, '') || '';
  const quote = market?.quote || market?.quoteAsset || (market?.symbol?.endsWith('IBO') ? 'IBO' : 'USDT');
  const baseLabel = displayAssetCode(base);
  const quoteLabel = displayAssetCode(quote);
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
          className="delta-market-row__icon rounded-full shrink-0 object-contain bg-transparent"
          loading="lazy"
          onError={(e) => {
            const fb = coinIconUrl(base, null);
            if (fb && e.currentTarget.src !== fb) e.currentTarget.src = fb;
            else if (base === 'IBO' && e.currentTarget.src !== BRAND_MARK) e.currentTarget.src = BRAND_MARK;
          }}
        />
      ) : (
        <div
          className="delta-market-row__icon-fallback rounded-full flex items-center justify-center font-bold shrink-0"
          style={{ width: size, height: size, fontSize: Math.max(10, size * 0.32) }}
        >
          {baseLabel?.slice(0, 2)}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-sm sm:text-[13px] tracking-tight" style={{ color: 'var(--ibo-ink)' }}>{baseLabel}</span>
          {showQuote ? (
            <span className="text-[11px] font-medium" style={{ color: 'var(--ibo-muted)' }}>/ {quoteLabel}</span>
          ) : null}
          {isIbo ? (
            <span className="text-[9px] bg-[rgba(254,108,2,0.12)] text-[#FE6C02] px-1.5 py-0.5 rounded font-bold border border-[rgba(254,108,2,0.22)]">
              Delta
            </span>
          ) : null}
          {isListed && !isIbo ? (
            <span className="text-[9px] bg-sky-500/12 text-sky-600 dark:text-sky-200 px-1.5 py-0.5 rounded font-bold border border-sky-500/25">
              Listed
            </span>
          ) : null}
          {showCategory ? (
            <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--ibo-muted)' }}>{category}</span>
          ) : null}
        </div>
        {displayName ? (
          <p className="text-[11px] truncate max-w-[min(100%,12rem)] sm:max-w-[280px]" style={{ color: 'var(--ibo-ink-secondary)' }}>{displayName}</p>
        ) : null}
        {tagline ? (
          <p className="text-[10px] truncate max-w-[min(100%,14rem)] hidden sm:block" style={{ color: 'var(--ibo-muted)' }}>{tagline}</p>
        ) : null}
      </div>
    </div>
  );

  if (linkToTrade && market?.symbol) {
    return (
      <Link to={`/futures/${String(market.symbol).replace(/USDT$/,'')}USDT-PERP`} className="hover:opacity-90 transition-opacity">
        {inner}
      </Link>
    );
  }
  return inner;
}
