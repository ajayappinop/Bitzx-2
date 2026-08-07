/**
 * Delta Markets — same Delta table / category-tab chrome as MarketsPage spot list.
 */
import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Star, RefreshCw, ChevronLeft } from 'lucide-react';
import { coinIconUrl } from '@/services/marketApi';
import { useIboMarkets } from '@/hooks/useIboMarkets';
import MarketsPagination from '@/components/markets/MarketsPagination';
import MarketCoinCell from '@/components/markets/MarketCoinCell';
import { BRAND_MARK } from '@/lib/brandAssets';
import { num, fmtMarketPrice, fmtMarketVol } from '@/lib/marketFormat';

const TRADE_BTN_CLASS =
  'inline-flex items-center justify-center rounded-md bg-[color:var(--ibo-accent)] px-3 py-1.5 text-[12px] font-bold text-[#101013] transition-[filter] hover:brightness-110';

const IBO_LOGO = BRAND_MARK;

const CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Watchlist', icon: Star },
  { id: 'featured', label: 'Featured' },
  { id: 'major', label: 'Majors' },
  { id: 'web3', label: 'Web3' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'topVolume', label: 'Volume' },
];

/** API tiers supported by useIboMarkets — gainers/losers/volume filtered client-side. */
const API_TIERS = new Set(['all', 'featured', 'major', 'web3']);

function MarketsCategoryTab({ id, label, Icon, active, onClick, count }) {
  const isWatchlist = id === 'favorites';
  const TabIcon = Icon || (isWatchlist ? Star : null);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex h-11 flex-shrink-0 items-center gap-1.5 px-3.5 text-[13px] whitespace-nowrap transition-colors ${
        active
          ? 'font-semibold text-[color:var(--ibo-ink)]'
          : 'font-medium text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
      }`}
    >
      {TabIcon ? (
        <TabIcon
          size={12}
          className={
            active || (isWatchlist && count > 0)
              ? 'fill-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)]'
              : 'text-[color:var(--ibo-muted)]'
          }
        />
      ) : null}
      <span>{label}</span>
      {isWatchlist && typeof count === 'number' ? (
        <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--ibo-muted)' }}>
          ({count})
        </span>
      ) : null}
      {active ? (
        <span
          className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
          style={{ background: 'var(--ibo-accent)' }}
        />
      ) : null}
    </button>
  );
}

function RangeBar({ low, high, price }) {
  const l = num(low);
  const h = num(high);
  const p = num(price);
  if (h <= l) return <div className="h-1.5 w-14 sm:w-20 rounded-full" style={{ background: 'var(--ibo-border)' }} />;
  const x = Math.min(100, Math.max(0, ((p - l) / (h - l)) * 100));
  return (
    <div
      className="h-1.5 w-14 sm:w-20 rounded-full overflow-hidden relative"
      style={{ background: 'var(--ibo-border)' }}
      title="24h range"
    >
      <div className="absolute inset-y-0 left-0 w-full rounded-full bg-gradient-to-r from-red-500/60 via-[#00A876]/70 to-green-500/60" />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full shadow border"
        style={{
          left: `calc(${x}% - 3px)`,
          background: 'var(--ibo-ink)',
          borderColor: 'var(--ibo-card)',
        }}
      />
    </div>
  );
}

function IboMobileCard({ market, isFavorite, onToggleFavorite }) {
  const pct = num(market.priceChangePercent);
  const isUp = pct >= 0;
  const base = market.base || market.symbol?.replace(/IBO$/, '') || '';

  return (
    <div
      className="rounded-2xl border p-3.5 sm:p-4 space-y-3 max-w-full overflow-hidden"
      style={{ background: 'var(--ibo-card)', borderColor: 'var(--ibo-border-solid)' }}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onToggleFavorite(market.symbol)}
            className="shrink-0 p-0.5"
            aria-label={isFavorite ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            <Star
              size={15}
              className={isFavorite ? 'fill-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)]' : 'text-[color:var(--ibo-muted)]'}
            />
          </button>
          <MarketCoinCell market={{ ...market, quote: 'IBO' }} size={36} />
        </div>
        <span className={`text-sm font-extrabold tabular-nums shrink-0 ${isUp ? 'text-green-500' : 'text-red-500'}`}>
          {isUp ? '+' : ''}{pct.toFixed(2)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <div>
          <p className="uppercase font-bold text-[9px] tracking-wide" style={{ color: 'var(--ibo-muted)' }}>Last</p>
          <p className="font-mono font-semibold tabular-nums" style={{ color: 'var(--ibo-ink)' }}>
            {fmtMarketPrice(market.price, base)} Delta
          </p>
        </div>
        <div>
          <p className="uppercase font-bold text-[9px] tracking-wide" style={{ color: 'var(--ibo-muted)' }}>Vol Delta</p>
          <p className="font-mono font-semibold tabular-nums" style={{ color: 'var(--ibo-ink)' }}>
            {fmtMarketVol(market.quoteVolume)}
          </p>
        </div>
        <div>
          <p className="uppercase font-bold text-[9px] tracking-wide" style={{ color: 'var(--ibo-muted)' }}>24h High</p>
          <p className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink-secondary)' }}>
            {fmtMarketPrice(market.highPrice, base)}
          </p>
        </div>
        <div>
          <p className="uppercase font-bold text-[9px] tracking-wide" style={{ color: 'var(--ibo-muted)' }}>24h Low</p>
          <p className="font-mono tabular-nums" style={{ color: 'var(--ibo-ink-secondary)' }}>
            {fmtMarketPrice(market.lowPrice, base)}
          </p>
        </div>
      </div>

      <RangeBar low={market.lowPrice} high={market.highPrice} price={market.price} />

      <Link
        to={`/ibo-market?symbol=${market.symbol}`}
        className="flex items-center justify-center w-full py-2.5 rounded-md bg-[color:var(--ibo-accent)] text-[#101013] font-bold text-sm hover:brightness-110 transition-[filter]"
      >
        Trade {base}
      </Link>
    </div>
  );
}

export default function IBOMarketsPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState('all');
  const [sortKey, setSortKey] = useState('quoteVolume');
  const [sortDir, setSortDir] = useState(-1);
  const [displayLimit, setDisplayLimit] = useState(60);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ibo_ibomkt_favs') || '[]'); } catch { return []; }
  });

  const apiTier = API_TIERS.has(category) ? category : 'all';

  const {
    setTier,
    query,
    setQuery,
    items,
    total,
    catalogTotal,
    topGainers,
    topLosers,
    iboPrice,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  } = useIboMarkets({ tier: 'all' });

  // Keep hook tier in sync for Featured / Majors / Web3 / All
  useEffect(() => {
    setTier(apiTier);
  }, [apiTier, setTier]);

  useEffect(() => {
    setDisplayLimit(60);
  }, [category, query, sortKey, sortDir]);

  const toggleFav = (sym) => {
    const next = favorites.includes(sym) ? favorites.filter((f) => f !== sym) : [...favorites, sym];
    setFavorites(next);
    localStorage.setItem('ibo_ibomkt_favs', JSON.stringify(next));
  };

  const handleSort = (k) => {
    if (sortKey === k) setSortDir((d) => -d);
    else {
      setSortKey(k);
      setSortDir(k === 'priceChangePercent' || k === 'quoteVolume' || k === 'volume' ? -1 : 1);
    }
  };

  const filtered = useMemo(() => {
    let list = [...items];
    if (category === 'favorites') {
      list = list.filter((m) => favorites.includes(m.symbol));
    } else if (category === 'gainers') {
      list = list.filter((m) => num(m.priceChangePercent) > 0)
        .sort((a, b) => num(b.priceChangePercent) - num(a.priceChangePercent));
    } else if (category === 'losers') {
      list = list.filter((m) => num(m.priceChangePercent) < 0)
        .sort((a, b) => num(a.priceChangePercent) - num(b.priceChangePercent));
    } else if (category === 'topVolume') {
      list = list.slice().sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume));
    } else {
      list = list.sort((a, b) => (num(a[sortKey] ?? 0) - num(b[sortKey] ?? 0)) * sortDir);
    }
    if (category === 'gainers' || category === 'losers' || category === 'topVolume') {
      // already sorted above; apply secondary search is via hook query
    }
    return list;
  }, [items, category, favorites, sortKey, sortDir]);

  const visible = useMemo(
    () => filtered.slice(0, displayLimit),
    [filtered, displayLimit],
  );

  const volumeMovers = useMemo(
    () => [...items].sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume)).slice(0, 5),
    [items],
  );

  const SortTh = ({ label, field, className = '' }) => (
    <th
      onClick={() => handleSort(field)}
      className={`px-2 md:px-2.5 py-2 text-left text-[10px] md:text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors ${className}`}
      style={{ color: 'var(--ibo-muted)' }}
    >
      <span className="hover:text-[color:var(--ibo-ink)] inline-flex items-center gap-0.5">
        {label}
        {sortKey === field && (
          <span style={{ color: 'var(--ibo-accent)' }}>{sortDir > 0 ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  );

  return (
    <div className="ibo-page">
      <div className="w-full max-w-[100vw] min-w-0 px-3 sm:px-4 md:px-6 lg:px-8 xl:px-10 py-3 sm:py-4 md:py-5 pb-10 sm:pb-14">

        <div className="mb-4 flex flex-col gap-3 sm:mb-5">
          <button
            type="button"
            onClick={() => navigate('/markets')}
            className="flex items-center gap-1.5 text-[12px] font-semibold w-fit transition-colors"
            style={{ color: 'var(--ibo-muted)' }}
          >
            <ChevronLeft size={14} /> Back to Markets
          </button>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <img src={IBO_LOGO} alt="" className="w-6 h-6 rounded-full" />
                <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl" style={{ color: 'var(--ibo-ink)' }}>
                  Delta Markets
                </h1>
              </div>
              <p className="mt-0.5 text-[12px] sm:text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
                Delta-quoted pairs
                {iboPrice != null ? (
                  <span className="ml-2 font-mono tabular-nums" style={{ color: 'var(--ibo-accent)' }}>
                    Delta ≈ ${parseFloat(iboPrice).toFixed(4)}
                  </span>
                ) : null}
              </p>
            </div>
            <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--ibo-muted)' }}>
              {loading ? '…' : `${catalogTotal || total} pairs`}
            </span>
          </div>
        </div>

        {/* Movers — same 3-col strip as Markets */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:mb-5 md:grid-cols-3">
          {[
            {
              key: 'vol',
              title: 'Highest volume',
              accent: 'var(--ibo-accent)',
              rows: volumeMovers,
              pctClass: null,
            },
            {
              key: 'up',
              title: 'Top gainers',
              accent: '#22c55e',
              rows: topGainers.slice(0, 5),
              pctClass: 'text-green-500',
            },
            {
              key: 'down',
              title: 'Top losers',
              accent: '#ef4444',
              rows: topLosers.slice(0, 5),
              pctClass: 'text-red-500',
            },
          ].map((col) => (
            <div
              key={col.key}
              className="delta-movers-card overflow-hidden rounded border"
            >
              <div className="flex items-center gap-2 border-b px-3 py-2.5">
                <span className="h-3.5 w-1 rounded-full" style={{ background: col.accent }} />
                <span className="text-[12px] font-bold" style={{ color: 'var(--ibo-ink)' }}>{col.title}</span>
              </div>
              <div className="delta-movers-rows">
                {loading ? (
                  <div className="py-6 text-center text-[12px]" style={{ color: 'var(--ibo-muted)' }}>Loading…</div>
                ) : col.rows.length === 0 ? (
                  <div className="py-6 text-center text-[12px]" style={{ color: 'var(--ibo-muted)' }}>No data</div>
                ) : (
                  col.rows.map((m) => {
                    const base = m.base || m.symbol?.replace(/IBO$/, '');
                    const pct = num(m.priceChangePercent);
                    const icon = coinIconUrl(base, m.logo_url);
                    return (
                      <button
                        key={m.symbol}
                        type="button"
                        onClick={() => navigate(`/ibo-market?symbol=${m.symbol}`)}
                        className="delta-movers-row flex w-full items-center gap-2.5 px-3 py-2 text-left"
                      >
                        {icon ? (
                          <img src={icon} alt="" className="w-6 h-6 rounded-full shrink-0" />
                        ) : (
                          <div className="delta-movers-fallback-icon w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0">
                            {base?.slice(0, 2)}
                          </div>
                        )}
                        <span className="flex-1 min-w-0 text-[12px] font-semibold truncate" style={{ color: 'var(--ibo-ink)' }}>
                          {base}<span style={{ color: 'var(--ibo-muted)' }}>/Delta</span>
                        </span>
                        <span className={`font-mono text-[12px] font-semibold tabular-nums ${col.pctClass || ''}`} style={!col.pctClass ? { color: 'var(--ibo-ink)' } : undefined}>
                          {col.pctClass
                            ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
                            : fmtMarketVol(m.quoteVolume)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>

        {error ? (
          <div
            className="mb-4 rounded-lg border px-3 py-2.5 text-[13px]"
            style={{ borderColor: 'var(--ibo-border-solid)', color: 'var(--ibo-muted)', background: 'var(--ibo-elevated)' }}
          >
            {error}
          </div>
        ) : null}

        {/* Full-bleed Delta markets list */}
        <div
          className="delta-markets-panel -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 xl:-mx-10 border-y"
        >
          <div
            className="delta-markets-tabs flex flex-col border-b sm:flex-row sm:items-center sm:justify-between"
          >
            <div
              className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto overscroll-x-contain pl-2 pr-1 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10 [scrollbar-width:none]"
              role="tablist"
              aria-label="Delta market categories"
            >
              {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
                <MarketsCategoryTab
                  key={id}
                  id={id}
                  label={label}
                  Icon={Icon}
                  active={category === id}
                  onClick={() => setCategory(id)}
                  count={id === 'favorites' ? favorites.length : undefined}
                />
              ))}
              <span
                className="hidden flex-shrink-0 pl-2 font-mono text-[11px] tabular-nums sm:inline"
                style={{ color: 'var(--ibo-muted)' }}
              >
                {loading ? '…' : filtered.length}
              </span>
            </div>
            <div
              className="flex items-center gap-2 border-t px-3 py-2 sm:border-t-0 sm:py-0 sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10"
              style={{ borderColor: 'var(--ibo-border-solid)' }}
            >
              <div
                className="delta-markets-search flex h-8 min-w-0 flex-1 items-center gap-2 rounded border px-2.5 sm:w-48 sm:flex-none"
              >
                <Search size={13} className="flex-shrink-0" style={{ color: 'var(--ibo-muted)' }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[color:var(--ibo-muted)]"
                  style={{ color: 'var(--ibo-ink)' }}
                />
              </div>
              <button
                type="button"
                onClick={() => refresh()}
                className="delta-markets-icon-btn flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border transition-colors"
                style={{ color: 'var(--ibo-ink-secondary)' }}
                aria-label="Refresh list"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block w-full min-w-0">
            <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:thin]">
              <table className="w-full min-w-[720px] md:min-w-[880px] lg:min-w-[1000px] xl:min-w-[1180px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b">
                    <th className="w-9 py-2.5 pl-3 pr-1.5 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10" />
                    <th
                      className="px-2 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider lg:min-w-[140px]"
                      style={{ color: 'var(--ibo-muted)' }}
                    >
                      Contract
                    </th>
                    <SortTh label="Price" field="price" />
                    <SortTh label="24h Change" field="priceChangePercent" />
                    <th
                      className="hidden px-1.5 py-2.5 text-[10px] font-medium uppercase tracking-wider md:table-cell"
                      style={{ color: 'var(--ibo-muted)' }}
                    >
                      Range
                    </th>
                    <SortTh label="High" field="highPrice" className="hidden md:table-cell" />
                    <SortTh label="Low" field="lowPrice" className="hidden md:table-cell" />
                    <SortTh label="Volume" field="volume" />
                    <SortTh label="Vol Delta" field="quoteVolume" className="hidden md:table-cell" />
                    <th
                      className="py-2.5 pl-2 pr-3 text-right text-[10px] font-medium uppercase tracking-wider sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10"
                      style={{ color: 'var(--ibo-muted)' }}
                    >
                      Trade
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !items.length ? (
                    <tr>
                      <td colSpan={10} className="py-20 text-center">
                        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ibo-accent)] border-t-transparent" />
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-16 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
                        {category === 'favorites'
                          ? 'No pairs in your watchlist yet. Tap the star on any row to add one.'
                          : 'No pairs match your filters.'}
                      </td>
                    </tr>
                  ) : (
                    visible.map((m) => {
                      const pct = num(m.priceChangePercent);
                      const isUp = pct >= 0;
                      const base = m.base || m.symbol?.replace(/IBO$/, '');
                      const isFav = favorites.includes(m.symbol);
                      return (
                        <tr
                          key={m.symbol}
                          className="border-b transition-colors cursor-pointer"
                          style={{ borderColor: 'var(--ibo-border-solid)' }}
                          onClick={() => navigate(`/ibo-market?symbol=${m.symbol}`)}
                        >
                          <td
                            className="py-2.5 pl-3 pr-1.5 sm:pl-4 md:pl-6 lg:pl-8 xl:pl-10"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => toggleFav(m.symbol)}
                              className="p-0.5"
                              aria-label={isFav ? 'Remove from watchlist' : 'Add to watchlist'}
                            >
                              <Star
                                size={13}
                                className={
                                  isFav
                                    ? 'fill-[color:var(--ibo-accent)] text-[color:var(--ibo-accent)]'
                                    : 'text-[color:var(--ibo-muted)]'
                                }
                              />
                            </button>
                          </td>
                          <td className="px-2 py-2.5 min-w-[140px]">
                            <MarketCoinCell market={{ ...m, quote: 'IBO' }} size={28} />
                          </td>
                          <td
                            className="px-2 py-2.5 font-mono text-[13px] font-semibold tabular-nums whitespace-nowrap"
                            style={{ color: 'var(--ibo-ink)' }}
                          >
                            {fmtMarketPrice(m.price, base)}
                          </td>
                          <td className="px-2 py-2.5">
                            <span className={`font-semibold tabular-nums text-[12px] ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                              {isUp ? '+' : ''}{pct.toFixed(2)}%
                            </span>
                          </td>
                          <td className="hidden px-1.5 py-2.5 md:table-cell">
                            <RangeBar low={m.lowPrice} high={m.highPrice} price={m.price} />
                          </td>
                          <td
                            className="hidden px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap md:table-cell"
                            style={{ color: 'var(--ibo-ink-secondary)' }}
                          >
                            {fmtMarketPrice(m.highPrice, base)}
                          </td>
                          <td
                            className="hidden px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap md:table-cell"
                            style={{ color: 'var(--ibo-ink-secondary)' }}
                          >
                            {fmtMarketPrice(m.lowPrice, base)}
                          </td>
                          <td
                            className="px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap"
                            style={{ color: 'var(--ibo-ink-secondary)' }}
                          >
                            {fmtMarketVol(m.volume)}
                          </td>
                          <td
                            className="hidden px-2 py-2.5 font-mono text-[12px] tabular-nums whitespace-nowrap md:table-cell"
                            style={{ color: 'var(--ibo-ink-secondary)' }}
                          >
                            {fmtMarketVol(m.quoteVolume)}
                          </td>
                          <td
                            className="py-2.5 pl-2 pr-3 text-right sm:pr-4 md:pr-6 lg:pr-8 xl:pr-10"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link to={`/ibo-market?symbol=${m.symbol}`} className={TRADE_BTN_CLASS}>
                              Trade
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 ? (
              <MarketsPagination
                shown={visible.length}
                total={category === 'favorites' || category === 'gainers' || category === 'losers' || category === 'topVolume'
                  ? filtered.length
                  : Math.max(filtered.length, total)}
                pageSize={60}
                loading={loadingMore}
                onLoadMore={() => {
                  if (visible.length < filtered.length) {
                    setDisplayLimit((n) => n + 60);
                  } else if (hasMore && category !== 'favorites') {
                    loadMore();
                    setDisplayLimit((n) => n + 60);
                  } else {
                    setDisplayLimit((n) => n + 60);
                  }
                }}
                className="border-t border-[color:var(--ibo-border-solid)] px-3 sm:px-4 md:px-6 lg:px-8 xl:px-10"
              />
            ) : null}
          </div>

          {/* Mobile */}
          <div className="divide-y md:hidden" style={{ borderColor: 'var(--ibo-border-solid)' }}>
            {loading && !items.length ? (
              <div className="flex justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--ibo-accent)] border-t-transparent" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
                {category === 'favorites'
                  ? 'No pairs in your watchlist yet. Tap the star on any row to add one.'
                  : 'No pairs match your filters.'}
              </p>
            ) : (
              <>
                {visible.map((m) => (
                  <div key={m.symbol} className="px-3 py-3 sm:px-4 md:px-6">
                    <IboMobileCard
                      market={m}
                      isFavorite={favorites.includes(m.symbol)}
                      onToggleFavorite={toggleFav}
                    />
                  </div>
                ))}
                <div className="px-3 py-3 sm:px-4 md:px-6">
                  <MarketsPagination
                    shown={visible.length}
                    total={filtered.length}
                    pageSize={60}
                    loading={loadingMore}
                    onLoadMore={() => {
                      if (visible.length < filtered.length) setDisplayLimit((n) => n + 60);
                      else if (hasMore && category !== 'favorites') {
                        loadMore();
                        setDisplayLimit((n) => n + 60);
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
