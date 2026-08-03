import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { coinIconUrl } from '@/services/marketApi';
import { computeMarketBreadth } from '@/lib/marketStats';

const IBO_TOKEN_ICON = '/hero/ibo-token-3d.png?v=10';

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtPrice(v, base) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  if (base === 'BTC') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function useMarketIntel(markets) {
  return useMemo(() => {
    const b = computeMarketBreadth(markets, { usdtSpotOnly: true });
    const live = b.liveMarkets;
    const byVol = [...live].sort((a, c) => num(c.quoteVolume) - num(a.quoteVolume));
    const listed = live.filter(
      (m) => m.is_listed || m.source === 'listed' || m.source === 'internal_mock' || m.base === 'IBO',
    );
    const listedIds = new Set(listed.map((m) => m.symbol));
    const newCoins = (
      listed.length >= 5
        ? listed
        : [...listed, ...byVol.filter((m) => !listedIds.has(m.symbol))]
    ).slice(0, 5);
    return {
      totalQuoteVol: b.totalQuoteVol,
      pairCount: b.pairCount,
      hotList: byVol.slice(0, 5),
      newCoins,
      gainers: b.gainers.slice(0, 5),
      losers: b.losers.slice(0, 5),
      upCount: b.upCount,
      downCount: b.downCount,
    };
  }, [markets]);
}

function marketDisplayName(market) {
  const base = market.base || market.symbol?.replace(/USDT$/i, '') || '';
  const name = [market.project_name, market.token_name]
    .map((v) => (v != null ? String(v).trim() : ''))
    .find((v) => v && v.toUpperCase() !== String(base).toUpperCase());
  return name || base;
}

function MarketTodayRow({ market }) {
  const pct = num(market.priceChangePercent);
  const up = pct >= 0;
  const base = market.base || market.symbol?.replace(/USDT$/i, '') || '';
  const isIbo = String(base).toUpperCase() === 'IBO';
  const icon = isIbo ? IBO_TOKEN_ICON : coinIconUrl(base, market.logo_url);
  const name = marketDisplayName(market);

  return (
    <Link
      to={`/trade/${market.symbol}`}
      className="group flex items-center gap-3 py-3.5 first:pt-1 last:pb-1 -mx-2 px-2 rounded-lg transition-colors hover:bg-[color:var(--ibo-hover)]"
    >
      {icon ? (
        <img
          src={icon}
          alt=""
          width={36}
          height={36}
          className={`w-9 h-9 rounded-full shrink-0 ring-1 ring-[color:var(--ibo-border-solid)] ${
            isIbo ? 'object-contain bg-[color:var(--ibo-elevated)] p-0.5' : 'object-cover'
          }`}
          loading="lazy"
          onError={(e) => {
            if (isIbo) return;
            const fb = coinIconUrl(base, null);
            if (fb && e.currentTarget.src !== fb) e.currentTarget.src = fb;
          }}
        />
      ) : (
        <div className="w-9 h-9 rounded-full shrink-0 bg-[color:var(--ibo-elevated)] ring-1 ring-[color:var(--ibo-border-solid)] flex items-center justify-center text-[11px] font-bold text-[color:var(--ibo-ink-secondary)]">
          {base.slice(0, 2)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold leading-tight tracking-tight" style={{ color: 'var(--ibo-ink)' }}>{base}</p>
        <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--ibo-muted)' }}>{name}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[13px] sm:text-[14px] font-medium tabular-nums leading-tight" style={{ color: 'var(--ibo-ink)' }}>
          ${fmtPrice(market.price, base)}
        </p>
        <p className={`text-[12px] sm:text-[13px] font-medium tabular-nums mt-0.5 ${up ? 'text-emerald-500' : 'text-red-500'}`}>
          {up ? '+' : ''}{pct.toFixed(2)}%
        </p>
      </div>
    </Link>
  );
}

function MarketTodayColumn({ title, items, loading, empty, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, delay }}
      className="rounded-2xl border p-4 sm:p-5 min-w-0"
      style={{
        background: 'var(--ibo-card)',
        borderColor: 'var(--ibo-border-solid)',
        boxShadow: 'var(--ibo-shadow)',
      }}
    >
      <div className="flex items-center gap-2.5 mb-3 sm:mb-4">
        <span className="h-4 w-[3px] rounded-full bg-[#0EA4AB] shrink-0" aria-hidden />
        <h3
          className="font-display text-[15px] sm:text-[16px] font-bold tracking-tight"
          style={{ color: 'var(--ibo-ink)' }}
        >
          {title}
        </h3>
      </div>
      <div className="divide-y divide-[color:var(--ibo-border-solid)]">
        {loading ? (
          <p className="text-sm text-zinc-500 py-10 text-center">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-zinc-500 py-10 text-center">{empty}</p>
        ) : (
          items.map((m) => <MarketTodayRow key={m.symbol} market={m} />)
        )}
      </div>
    </motion.div>
  );
}

/**
 * Hot / New / Gainers snapshot — used on Markets page.
 */
export default function CryptoMarketToday({
  markets = [],
  showViewAll = false,
  className = '',
}) {
  const intel = useMarketIntel(markets);
  const loading = markets.length === 0;

  return (
    <section
      className={`relative z-[2] border border-white/[0.06] rounded-2xl overflow-hidden ${className}`}
      style={{ background: 'linear-gradient(165deg, var(--ibo-bg) 0%, var(--ibo-surface) 45%, var(--ibo-bg) 100%)' }}
    >
      <div className="relative px-4 sm:px-5 md:px-6 py-6 sm:py-8">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 sm:mb-8"
        >
          <h2 className="ibo-title-lg">
            Crypto Market{' '}
            <span className="relative inline-block">
              Today.
              <span
                aria-hidden
                className="absolute left-0 right-0 -bottom-1 h-[3px] rounded-full"
                style={{ background: 'linear-gradient(90deg, #4D8AFF, #0EA4AB)' }}
              />
            </span>
          </h2>
          {showViewAll ? (
            <Link
              to="/markets"
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[color:var(--ibo-accent)] hover:brightness-110 transition-colors shrink-0"
            >
              View all {intel.pairCount > 0 ? `${intel.pairCount}+` : ''} Coins
              <ChevronRight size={15} />
            </Link>
          ) : (
            <p className="text-[13px] text-zinc-500 shrink-0">
              {intel.pairCount > 0 ? `${intel.pairCount} live pairs` : 'Live USDT pairs'}
            </p>
          )}
        </motion.div>

        <div className="grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
          <MarketTodayColumn
            title="Hot List"
            items={intel.hotList}
            loading={loading}
            empty="No volume leaders yet."
            delay={0}
          />
          <MarketTodayColumn
            title="New Coins"
            items={intel.newCoins}
            loading={loading}
            empty="No new listings yet."
            delay={0.06}
          />
          <MarketTodayColumn
            title="Top Gainers"
            items={intel.gainers}
            loading={loading}
            empty="No advancers in this snapshot."
            delay={0.12}
          />
        </div>
      </div>
    </section>
  );
}
