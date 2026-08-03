import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X, Loader2, Wallet, ArrowRight } from 'lucide-react';
import MarketCoinCell from '@/components/markets/MarketCoinCell';
import MarketsPagination from '@/components/markets/MarketsPagination';
import { useBscDirectory } from '@/hooks/useBscDirectory';
import { fmtMarketPrice, fmtMarketVol, num } from '@/lib/marketFormat';

function shortContract(addr) {
  const a = (addr || '').trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function TokenCard({ item, compact }) {
  const pct = num(item.priceChangePercent);
  const hasPct = item.has_live_price && item.priceChangePercent !== '';
  const up = pct >= 0;

  return (
    <div
      className={`rounded-2xl border flex flex-col gap-2.5 ${
        compact ? 'p-3' : 'p-3.5 sm:p-4'
      }`}
      style={{
        background: 'var(--ibo-card)',
        borderColor: 'var(--ibo-border-solid)',
        boxShadow: 'var(--ibo-shadow)',
      }}
    >
      <div className="flex items-start gap-2 min-w-0">
        <MarketCoinCell market={item} size={compact ? 32 : 36} showQuote={false} />
        <div className="flex-1 min-w-0 text-right">
          {item.has_live_price && item.price ? (
            <p className="text-sm font-mono font-bold tabular-nums" style={{ color: 'var(--ibo-ink)' }}>
              ${fmtMarketPrice(item.price, item.base)}
            </p>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--ibo-muted)' }}>Price on deposit</p>
          )}
          {hasPct ? (
            <p className={`text-xs font-bold tabular-nums ${up ? 'text-emerald-500' : 'text-red-500'}`}>
              {up ? '+' : ''}{pct.toFixed(2)}%
            </p>
          ) : null}
        </div>
      </div>

      {item.contract_address ? (
        <p className="text-[10px] font-mono truncate" style={{ color: 'var(--ibo-muted)' }} title={item.contract_address}>
          {shortContract(item.contract_address)}
        </p>
      ) : item.universal_bep20 ? (
        <p className="text-[10px] truncate" style={{ color: 'var(--ibo-muted)' }} title="Deposits use the shared BNB Chain address">
          Universal BEP-20
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {item.deposit_enabled || item.universal_bep20 ? (
          <span
            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border"
            style={{
              background: 'rgba(16,185,129,0.12)',
              color: '#059669',
              borderColor: 'rgba(16,185,129,0.3)',
            }}
          >
            Deposit
          </span>
        ) : (
          <span
            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border"
            style={{
              background: 'var(--ibo-accent-soft)',
              color: 'var(--ibo-accent)',
              borderColor: 'rgba(14,164,171,0.35)',
            }}
          >
            Soon
          </span>
        )}
        {item.is_listed ? (
          <span
            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border"
            style={{
              background: 'rgba(14,165,233,0.12)',
              color: '#0284c7',
              borderColor: 'rgba(14,165,233,0.3)',
            }}
          >
            Listed
          </span>
        ) : null}
      </div>

      <div className="flex gap-2 mt-auto">
        <Link
          to="/wallet"
          state={{ depositAsset: item.base }}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border"
          style={{
            background: 'var(--ibo-accent-soft)',
            borderColor: 'rgba(14,164,171,0.35)',
            color: 'var(--ibo-accent)',
          }}
        >
          <Wallet size={13} /> Deposit
        </Link>
        {item.actions?.trade ? (
          <Link
            to={`/trade/${item.trade_symbol || `${item.base}IBO`}`}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl border text-xs font-bold hover:opacity-90"
            style={{
              borderColor: 'var(--ibo-border-solid)',
              color: 'var(--ibo-ink)',
              background: 'var(--ibo-elevated)',
            }}
          >
            Trade IBO <ArrowRight size={12} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

const FILTERS = [
  { id: 'all', label: 'All BEP-20' },
  { id: 'web3', label: 'Web3 directory', web3Only: true },
  { id: 'listed', label: 'Listed', listedOnly: true },
  { id: 'deposit', label: 'Depositable', depositOnly: true },
];

/**
 * Full BSC token directory — same coins as wallet deposit, optimized grid + table.
 */
export default function BscTokenDirectory({
  title = 'BNB Chain (BEP-20) tokens',
  subtitle,
  variant = 'full',
  className = '',
}) {
  const [filterId, setFilterId] = useState('all');
  const activeFilter = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  const isCompact = variant === 'compact';

  const {
    query,
    setQuery,
    items,
    total,
    counts,
    loading,
    loadingMore,
    error,
    loadMore,
  } = useBscDirectory({
    depositOnly: Boolean(activeFilter.depositOnly),
    listedOnly: Boolean(activeFilter.listedOnly),
    web3Only: Boolean(activeFilter.web3Only),
    pageSize: isCompact ? 24 : 48,
  });

  const countLabel = useMemo(() => {
    if (!counts) return total > 0 ? `${total} tokens` : '';
    return `${total} tokens · ${counts.deposit_enabled ?? 0} depositable · ${counts.web3_directory ?? counts.with_live_price ?? 0} with live price`;
  }, [counts, total]);

  return (
    <section className={className}>
      <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-4 ${isCompact ? 'mb-6 md:mb-8' : 'mb-5'}`}>
        <div className="min-w-0">
          {isCompact ? (
            <>
              <p className="ibo-eyebrow mb-3">BNB Chain</p>
              {title ? <h2 className="ibo-title-lg mb-3">{title}</h2> : null}
              {subtitle ? (
                <p className="ibo-lead-wide max-w-2xl" style={{ color: 'var(--ibo-ink-secondary)' }}>
                  {subtitle}
                </p>
              ) : null}
            </>
          ) : (
            <>
              {title ? (
                <h2 className="text-xl sm:text-2xl font-extrabold mb-1" style={{ color: 'var(--ibo-ink)' }}>
                  {title}
                </h2>
              ) : null}
              <p className="text-sm max-w-2xl" style={{ color: 'var(--ibo-muted)' }}>
                {subtitle
                  || 'Same catalog as Wallet → Deposit. Search any BEP-20 on BNB Chain; live USD prices where available.'}
              </p>
            </>
          )}
        </div>
        {countLabel ? (
          <p className="text-[11px] font-mono shrink-0" style={{ color: 'var(--ibo-muted)' }}>
            {countLabel}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div
          className="flex flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 min-w-0"
          style={{
            background: 'var(--ibo-card)',
            borderColor: 'var(--ibo-border-solid)',
            boxShadow: '0 4px 14px rgba(12, 25, 34, 0.04)',
          }}
        >
          <Search size={16} className="shrink-0" style={{ color: 'var(--ibo-muted)' }} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol, name, contract…"
            className="flex-1 bg-transparent text-sm outline-none min-w-0 placeholder:text-[color:var(--ibo-muted)]"
            style={{ color: 'var(--ibo-ink)' }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-0.5 hover:opacity-80"
              style={{ color: 'var(--ibo-muted)' }}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
        {FILTERS.map((f) => {
          const active = filterId === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterId(f.id)}
              className="flex-shrink-0 snap-start rounded-full px-3.5 py-2 text-xs font-bold whitespace-nowrap transition-colors border"
              style={
                active
                  ? {
                      background: 'var(--ibo-accent)',
                      color: '#050a1a',
                      borderColor: 'transparent',
                    }
                  : {
                      background: 'var(--ibo-card)',
                      color: 'var(--ibo-ink-secondary)',
                      borderColor: 'var(--ibo-border-solid)',
                    }
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--ibo-accent)' }}>{error}</p>
      ) : null}

      {loading && !items.length ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="animate-spin" size={32} style={{ color: 'var(--ibo-accent)' }} />
        </div>
      ) : null}

      {!loading && !items.length && !error ? (
        <p className="text-center py-12 text-sm" style={{ color: 'var(--ibo-muted)' }}>
          No tokens match your search.
        </p>
      ) : null}

      {/* Desktop table */}
      {items.length > 0 ? (
        <div
          className="hidden lg:block rounded-2xl border overflow-hidden mb-4"
          style={{
            background: 'var(--ibo-card)',
            borderColor: 'var(--ibo-border-solid)',
            boxShadow: 'var(--ibo-shadow)',
          }}
        >
          <div className="overflow-x-auto max-h-[min(520px,60vh)] overflow-y-auto overscroll-contain">
            <table className="w-full text-left text-sm min-w-[900px]">
              <thead
                className="sticky top-0 z-[1] border-b text-[10px] uppercase font-bold"
                style={{
                  background: 'var(--ibo-surface)',
                  borderColor: 'var(--ibo-border-solid)',
                  color: 'var(--ibo-muted)',
                }}
              >
                <tr>
                  <th className="px-4 py-3">Token</th>
                  <th className="px-3 py-3">Price (USD)</th>
                  <th className="px-3 py-3">24h</th>
                  <th className="px-3 py-3">Vol</th>
                  <th className="px-3 py-3">Contract</th>
                  <th className="px-3 py-3 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const pct = num(it.priceChangePercent);
                  const up = pct >= 0;
                  return (
                    <tr
                      key={`${it.base}-${it.catalog_source}`}
                      className="border-b transition-colors"
                      style={{ borderColor: 'var(--ibo-border)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ibo-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td className="px-4 py-3">
                        <MarketCoinCell market={it} size={32} showQuote={false} />
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums" style={{ color: 'var(--ibo-ink)' }}>
                        {it.has_live_price ? `$${fmtMarketPrice(it.price, it.base)}` : '—'}
                      </td>
                      <td
                        className={`px-3 py-3 font-bold tabular-nums ${
                          it.has_live_price
                            ? (up ? 'text-emerald-500' : 'text-red-500')
                            : ''
                        }`}
                        style={!it.has_live_price ? { color: 'var(--ibo-muted)' } : undefined}
                      >
                        {it.has_live_price ? `${up ? '+' : ''}${pct.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums" style={{ color: 'var(--ibo-ink-secondary)' }}>
                        {it.has_live_price ? `$${fmtMarketVol(it.quoteVolume)}` : '—'}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px]" style={{ color: 'var(--ibo-muted)' }} title={it.contract_address || ''}>
                        {shortContract(it.contract_address)
                          || (it.universal_bep20 ? 'Universal BEP-20' : '—')}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          to="/wallet"
                          className="text-xs font-bold hover:underline"
                          style={{ color: 'var(--ibo-accent)' }}
                        >
                          Deposit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Cards — mobile + tablet */}
      <div
        className={`lg:hidden grid gap-3 ${
          isCompact
            ? 'grid-cols-1 sm:grid-cols-2'
            : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
        }`}
      >
        {items.map((it) => (
          <TokenCard key={`${it.base}-${it.catalog_source}-card`} item={it} compact={isCompact} />
        ))}
      </div>

      <MarketsPagination
        shown={items.length}
        total={total}
        pageSize={isCompact ? 24 : 48}
        onLoadMore={loadMore}
        loading={loadingMore}
      />
    </section>
  );
}
