import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, TrendingUp, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef } from 'react';
import MarketCoinCell from '@/components/markets/MarketCoinCell';
import { fmtMarketPrice, fmtMarketVol, num } from '@/lib/marketFormat';

function TopCoinCard({ market, index }) {
  const pct = num(market.priceChangePercent);
  const up = pct >= 0;
  const base = market.base || '';

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: Math.min(index * 0.05, 0.25) }}
      className="ibo-hover-lift ibo-hover-border rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 sm:p-5 flex flex-col gap-3 sm:gap-4 min-h-[200px] sm:min-h-[220px] w-[min(100%,280px)] sm:w-auto flex-shrink-0 sm:flex-shrink snap-center"
    >
      <MarketCoinCell market={market} size={44} showQuote />
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-bold">Last price</p>
        <p className="text-xl sm:text-2xl font-extrabold text-white tabular-nums">
          ${fmtMarketPrice(market.price, base)}
        </p>
        <p className={`text-sm font-semibold tabular-nums flex items-center gap-1 ${up ? 'text-emerald-400' : 'text-red-400'}`}>
          {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {up ? '+' : ''}{pct.toFixed(2)}% <span className="text-zinc-500 font-normal text-xs">24h</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] mt-auto">
        <div className="rounded-lg px-2.5 py-2 border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]">
          <p className="text-zinc-500 uppercase font-bold tracking-wide text-[9px]">24h vol</p>
          <p className="text-white font-mono font-semibold mt-0.5 tabular-nums">${fmtMarketVol(market.quoteVolume)}</p>
        </div>
        <div className="rounded-lg px-2.5 py-2 border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]">
          <p className="text-zinc-500 uppercase font-bold tracking-wide text-[9px]">High / Low</p>
          <p className="text-white/80 font-mono text-[10px] mt-0.5 truncate tabular-nums">
            ${fmtMarketPrice(market.highPrice, base)} / ${fmtMarketPrice(market.lowPrice, base)}
          </p>
        </div>
      </div>
      {(market.description || market.market_tagline) ? (
        <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-2 border-t border-white/[0.06] pt-2">
          {market.description || market.market_tagline}
        </p>
      ) : null}
      <Link
        to={`/trade/${market.symbol}`}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-logo-gradient text-[#050a1a] text-sm font-bold py-2.5 hover:brightness-110 transition-[filter]"
      >
        Trade {base} <ArrowRight size={14} />
      </Link>
    </motion.article>
  );
}

/**
 * Landing featured coins — responsive grid + horizontal scroll on small screens.
 */
export default function TopCoinsShowcase({
  markets = [],
  featured = [],
  title,
  subtitle,
  className = '',
  embedded = false,
}) {
  const scrollRef = useRef(null);

  const display = (() => {
    const feat = (featured?.length ? featured : markets.filter((m) => m.featured_landing)).slice(0, 8);
    if (feat.length >= 3) return feat;
    return [...markets]
      .sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume))
      .slice(0, 6);
  })();

  if (!display.length) return null;

  const scrollBy = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' });
  };

  return (
    <section
      className={
        embedded
          ? `rounded-2xl border border-white/[0.06] px-4 sm:px-5 md:px-6 py-6 sm:py-8 ${className}`
          : `ibo-landing-container py-10 sm:py-12 md:py-16 ${className}`
      }
      style={{ background: 'var(--ibo-surface)' }}
    >
      <div className="mb-6 md:mb-8 max-w-3xl">
        <p className="ibo-eyebrow mb-2 sm:mb-3">{title || 'Top markets'}</p>
        <h2 className="ibo-title-lg mb-2 sm:mb-3">{title || 'Featured coins'}</h2>
        <p className="ibo-lead text-zinc-500 max-w-none text-sm sm:text-base">
          {subtitle
            || 'Curated by the IBO team — live prices, 24h performance, and volume. Managed in the admin Market Catalog.'}
        </p>
      </div>

      {/* Mobile: horizontal snap carousel */}
      <div className="relative sm:hidden">
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-2 -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {display.map((m, i) => (
            <TopCoinCard key={m.symbol} market={m} index={i} />
          ))}
        </div>
        {display.length > 1 ? (
          <div className="flex justify-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              className="p-2 rounded-full border border-white/10 text-white/70 hover:border-gold/30"
              aria-label="Previous"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              className="p-2 rounded-full border border-white/10 text-white/70 hover:border-gold/30"
              aria-label="Next"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}
      </div>

      {/* Tablet+ grid */}
      <div className="hidden sm:grid sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
        {display.map((m, i) => (
          <TopCoinCard key={m.symbol} market={m} index={i} />
        ))}
      </div>
    </section>
  );
}
