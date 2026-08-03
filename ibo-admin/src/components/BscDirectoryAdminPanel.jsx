import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  AdminPanel,
  FilterBar,
  GradientStatCard,
} from '@/components/AdminPrimitives';
import { Globe, Loader2, RefreshCw, Search, Wallet } from 'lucide-react';

const PAGE_SIZE = 48;

const FILTERS = [
  { id: 'all', label: 'All tokens' },
  { id: 'web3', label: 'Web3 / CoinGecko' },
  { id: 'listed', label: 'Listed projects' },
  { id: 'deposit', label: 'Depositable' },
];

function shortAddr(addr) {
  const a = (addr || '').trim();
  if (a.length < 12) return a || '—';
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function fmtPrice(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toFixed(8);
}

function fmtPct(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function BscDirectoryAdminPanel() {
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const skipRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  const filterParams = useMemo(() => {
    switch (filter) {
      case 'web3':
        return { web3_only: true };
      case 'listed':
        return { listed_only: true };
      case 'deposit':
        return { deposit_only: true };
      default:
        return {};
    }
  }, [filter]);

  const fetchPage = useCallback(
    async ({ append = false } = {}) => {
      const skip = append ? skipRef.current : 0;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError('');
      }
      try {
        const res = await api.listings.bscDirectory({
          skip,
          limit: PAGE_SIZE,
          deposit_only: filterParams.deposit_only ? 'true' : 'false',
          listed_only: filterParams.listed_only ? 'true' : 'false',
          web3_only: filterParams.web3_only ? 'true' : 'false',
          ...(debouncedQ ? { q: debouncedQ } : {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load BSC directory');
        const list = Array.isArray(data?.items) ? data.items : [];
        setItems((prev) => (append ? [...prev, ...list] : list));
        setTotal(Number(data?.total) || 0);
        setCounts(data?.counts ?? null);
        skipRef.current = skip + list.length;
      } catch (e) {
        if (!append) {
          setItems([]);
          setTotal(0);
          setError(e.message || 'Could not load directory');
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedQ, filterParams],
  );

  useEffect(() => {
    skipRef.current = 0;
    fetchPage({ append: false });
  }, [fetchPage]);

  const hasMore = items.length < total;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GradientStatCard
          label="Directory total"
          value={counts?.total ?? total}
          hint="Same as wallet deposit catalog"
          tone="cyan"
        />
        <GradientStatCard
          label="Web3 tokens"
          value={counts?.web3 ?? '—'}
          hint="CoinGecko BSC directory"
          tone="amber"
        />
        <GradientStatCard
          label="Listed"
          value={counts?.listed ?? '—'}
          hint="Approved token listings"
          tone="emerald"
        />
        <GradientStatCard
          label="Depositable"
          value={counts?.deposit_enabled ?? '—'}
          hint="Deposit enabled on BSC"
          tone="rose"
        />
      </div>

      <FilterBar>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol, name, contract…"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-dark border border-surface-border text-sm text-white placeholder:text-white/35 focus:border-gold/40 outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                filter === f.id
                  ? 'bg-gold/20 border-gold/40 text-gold-light'
                  : 'border-surface-border text-white/70 hover:border-white/30'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            skipRef.current = 0;
            fetchPage({ append: false });
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </FilterBar>

      {error ? (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <AdminPanel
        title="BEP-20 / BSC token directory"
        subtitle={`Showing ${items.length} of ${total} — mirrors wallet deposit catalog (enable BSC_WEB3_CATALOG_ENABLED on API for full Web3 list).`}
        icon={Globe}
      >
        {loading && !items.length ? (
          <div className="flex items-center justify-center gap-2 py-16 text-white/50">
            <Loader2 size={20} className="animate-spin" /> Loading directory…
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto -mx-1">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-white/50 text-xs uppercase border-b border-surface-border">
                    <th className="py-2 pr-3">Asset</th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Price</th>
                    <th className="py-2 pr-3">24h</th>
                    <th className="py-2 pr-3">Contract</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const pct = parseFloat(row.priceChangePercent);
                    const up = Number.isFinite(pct) && pct >= 0;
                    return (
                      <tr
                        key={`${row.base}-${row.contract_address || row.catalog_source}`}
                        className="border-b border-surface-border/50 hover:bg-white/[0.02]"
                      >
                        <td className="py-2.5 pr-3 font-bold text-white">{row.base}</td>
                        <td className="py-2.5 pr-3 text-white/70 max-w-[180px] truncate">
                          {row.token_name || '—'}
                        </td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">
                          {row.has_live_price ? fmtPrice(row.price) : '—'}
                        </td>
                        <td
                          className={`py-2.5 pr-3 font-mono tabular-nums ${
                            Number.isFinite(pct) ? (up ? 'text-emerald-400' : 'text-red-400') : 'text-white/40'
                          }`}
                        >
                          {row.has_live_price ? fmtPct(row.priceChangePercent) : '—'}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-white/50" title={row.contract_address}>
                          {shortAddr(row.contract_address)}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-white/60">{row.catalog_source || row.source}</td>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {row.deposit_enabled ? (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                                Deposit
                              </span>
                            ) : null}
                            {row.is_listed ? (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-200">
                                Listed
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((row) => {
                const pct = parseFloat(row.priceChangePercent);
                const up = Number.isFinite(pct) && pct >= 0;
                return (
                  <div
                    key={`m-${row.base}-${row.contract_address || row.catalog_source}`}
                    className="rounded-xl border border-surface-border bg-white/[0.03] p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white">{row.base}</span>
                      {row.has_live_price ? (
                        <span className="text-xs font-mono text-white/80">{fmtPrice(row.price)}</span>
                      ) : (
                        <span className="text-[10px] text-white/40">No live price</span>
                      )}
                    </div>
                    <p className="text-xs text-white/60 truncate">{row.token_name}</p>
                    {row.has_live_price && Number.isFinite(pct) ? (
                      <p className={`text-xs font-bold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtPct(row.priceChangePercent)}
                      </p>
                    ) : null}
                    <p className="text-[10px] font-mono text-white/40 truncate">{shortAddr(row.contract_address)}</p>
                    <div className="flex flex-wrap gap-1">
                      {row.deposit_enabled ? (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                          <Wallet size={10} /> Deposit
                        </span>
                      ) : null}
                      {row.is_listed ? (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-200">
                          Listed
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {items.length === 0 && !loading ? (
              <p className="text-center text-sm text-white/50 py-10">No tokens match your filters.</p>
            ) : null}

            {hasMore ? (
              <div className="flex justify-center pt-4 border-t border-surface-border/60 mt-4">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchPage({ append: true })}
                  className="px-5 py-2.5 rounded-xl border border-gold/40 bg-gold/10 text-gold-light text-sm font-bold disabled:opacity-40"
                >
                  {loadingMore ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Loading…
                    </span>
                  ) : (
                    `Load more (${items.length} / ${total})`
                  )}
                </button>
              </div>
            ) : (
              <p className="text-center text-xs text-white/40 pt-4">
                {total > 0 ? `All ${total} tokens loaded.` : null}
              </p>
            )}
          </>
        )}
      </AdminPanel>
    </div>
  );
}
