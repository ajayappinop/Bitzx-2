import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import {
  AdminPageHeader,
  AdminPanel,
  GradientStatCard,
  FilterBar,
  AdminDataTable,
} from '@/components/AdminPrimitives';
import BscDirectoryAdminPanel from '@/components/BscDirectoryAdminPanel';
import {
  BarChart2, RefreshCw, Star, Eye, EyeOff, LayoutGrid, List,
  Save, Coins, Globe, TrendingUp, Pencil, Wallet,
} from 'lucide-react';

const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

const CATEGORIES = [
  { value: 'major', label: 'Major' },
  { value: 'alt', label: 'Altcoin' },
  { value: 'ibo', label: 'Delta' },
  { value: 'listed', label: 'Listed project' },
  { value: 'defi', label: 'DeFi' },
  { value: 'meme', label: 'Meme' },
];

const inputCls =
  'w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-gold/40 outline-none';

function mediaUrl(rel) {
  if (!rel || typeof rel !== 'string') return null;
  if (rel.startsWith('http')) return rel;
  return `${API_BASE}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

function fmtPrice(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  return n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toFixed(6);
}

function fmtPct(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function MarketCatalogPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_listings');
  const readOnly = !canManage;

  const [tab, setTab] = useState('overview');
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState({});
  const [platformDirty, setPlatformDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('cards');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 24;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listings.marketCatalog();
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load catalog');
      setCatalog(data);
      setDirty({});
      setPlatformDirty({});
    } catch (e) {
      setCatalog(null);
      setError(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = catalog?.items || [];
  const featured = catalog?.featured || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    if (categoryFilter !== 'all') {
      list = list.filter((it) => (it.market_category || 'alt') === categoryFilter);
    }
    if (!q) return list;
    return list.filter((it) => {
      const hay = [it.symbol, it.base, it.token_name, it.project_name, it.market_tagline]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, search, categoryFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    setPage(0);
  }, [search, categoryFilter, tab]);

  const patchRow = (symbol, patch) => {
    setDirty((d) => ({ ...d, [symbol]: { ...(d[symbol] || {}), ...patch } }));
  };

  const patchPlatform = (symbol, patch) => {
    setPlatformDirty((d) => ({ ...d, [symbol]: { ...(d[symbol] || {}), ...patch } }));
  };

  const rowState = (it) => ({ ...it, ...(dirty[it.symbol] || {}) });

  const saveAll = async () => {
    if (!canManage) return;
    setSaving(true);
    setError('');
    setOkMsg('');
    try {
      const tokenPatches = items
        .filter((it) => it.listed_token_id && dirty[it.symbol])
        .map((it) => ({
          id: it.listed_token_id,
          ...dirty[it.symbol],
        }));

      const platform_symbols = {};
      for (const [sym, patch] of Object.entries(platformDirty)) {
        if (Object.keys(patch).length) platform_symbols[sym] = patch;
      }

      const res = await api.listings.patchMarketCatalog({
        tokens: tokenPatches,
        platform_symbols: Object.keys(platform_symbols).length ? platform_symbols : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setOkMsg(`Saved ${data.updated_tokens || 0} token(s), ${data.platform_symbols || 0} platform override(s).`);
      await load();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const kpi = useMemo(() => ({
    total: items.length,
    tradingTotal: catalog?.trading_pairs_total ?? items.length,
    bscTotal: catalog?.bsc_directory_total ?? null,
    featured: items.filter((i) => rowState(i).featured_landing).length,
    listed: items.filter((i) => i.is_listed).length,
    hidden: items.filter((i) => rowState(i).market_visible === false).length,
  }), [items, dirty, catalog]);

  const renderCard = (it) => {
    const r = rowState(it);
    const pct = parseFloat(r.priceChangePercent);
    const up = pct >= 0;
    const isListed = Boolean(r.listed_token_id);
    const logo = mediaUrl(r.logo_url);

    return (
      <div
        key={r.symbol}
        className="rounded-2xl border border-surface-border bg-surface-card/60 p-4 sm:p-5 flex flex-col gap-3"
      >
        <div className="flex items-start gap-3">
          {logo ? (
            <img src={logo} alt="" className="w-12 h-12 rounded-full object-cover border border-surface-border shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gold/15 flex items-center justify-center text-gold-light font-bold shrink-0">
              {r.base?.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-white text-lg">{r.base}</p>
            <p className="text-xs text-white/50 font-mono">{r.symbol}</p>
            <p className="text-sm text-white/75 mt-1">{r.token_name || r.project_name}</p>
          </div>
          <span className={`text-sm font-bold tabular-nums ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmtPct(r.priceChangePercent)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-white/5 px-2.5 py-2 border border-white/8">
            <p className="text-white/45 uppercase font-bold text-[9px]">Last</p>
            <p className="text-white font-mono font-semibold">${fmtPrice(r.price)}</p>
          </div>
          <div className="rounded-lg bg-white/5 px-2.5 py-2 border border-white/8">
            <p className="text-white/45 uppercase font-bold text-[9px]">24h vol</p>
            <p className="text-white font-mono font-semibold">{parseFloat(r.quoteVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase text-white/45">Tagline (markets + landing)</span>
          <input
            className={inputCls}
            value={r.market_tagline || ''}
            disabled={readOnly}
            onChange={(e) => (isListed
              ? patchRow(r.symbol, { market_tagline: e.target.value })
              : patchPlatform(r.symbol, { market_tagline: e.target.value }))}
            placeholder="Short line shown under the pair name"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-white/45">Category</span>
            <select
              className={inputCls}
              value={r.market_category || 'alt'}
              disabled={readOnly}
              onChange={(e) => (isListed
                ? patchRow(r.symbol, { market_category: e.target.value })
                : patchPlatform(r.symbol, { market_category: e.target.value }))}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-white/45">Sort order</span>
            <input
              type="number"
              min={0}
              max={9999}
              className={inputCls}
              value={r.market_sort_order ?? 500}
              disabled={readOnly}
              onChange={(e) => (isListed
                ? patchRow(r.symbol, { market_sort_order: Number(e.target.value) })
                : patchPlatform(r.symbol, { market_sort_order: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              const next = r.market_visible === false;
              if (isListed) patchRow(r.symbol, { market_visible: next });
              else patchPlatform(r.symbol, { market_visible: next });
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
              r.market_visible !== false
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/15 text-rose-200'
            }`}
          >
            {r.market_visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
            {r.market_visible !== false ? 'Visible' : 'Hidden'}
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => (isListed
              ? patchRow(r.symbol, { featured_landing: !r.featured_landing })
              : patchPlatform(r.symbol, { featured_landing: !r.featured_landing }))}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
              r.featured_landing
                ? 'border-gold/40 bg-gold/15 text-gold-light'
                : 'border-surface-border text-white/50'
            }`}
          >
            <Star size={12} className={r.featured_landing ? 'fill-current' : ''} />
            Landing featured
          </button>
          {isListed ? (
            <Link
              to="/token-listings"
              className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline ml-auto"
            >
              <Pencil size={12} /> Full token edit
            </Link>
          ) : null}
        </div>

        {r.description ? (
          <p className="text-[11px] text-white/55 leading-relaxed line-clamp-3 border-t border-surface-border/60 pt-2">
            {r.description}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-10">
      <AdminPageHeader
        title="Market Catalog"
        subtitle="Control how every trading pair appears on the exchange landing page and Markets screen — visibility, featured cards, taglines, and sort order."
        actions={(
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            {canManage ? (
              <button
                type="button"
                onClick={saveAll}
                disabled={saving || (Object.keys(dirty).length === 0 && Object.keys(platformDirty).length === 0)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-gold/90 to-gold text-[#0a0b0d] text-sm font-extrabold disabled:opacity-40"
              >
                <Save size={15} /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            ) : null}
          </div>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{okMsg}</div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <GradientStatCard label="Tradable Delta" value={kpi.tradingTotal} hint="Live trading snapshot" tone="cyan" />
        <GradientStatCard
          label="BEP-20 directory"
          value={kpi.bscTotal != null ? kpi.bscTotal : '—'}
          hint="Wallet + Web3 catalog"
          tone="violet"
        />
        <GradientStatCard label="Landing featured" value={kpi.featured} hint="Top coin cards" tone="amber" />
        <GradientStatCard label="Listed projects" value={kpi.listed} hint="From token listings" tone="emerald" />
        <GradientStatCard label="Hidden" value={kpi.hidden} hint="Not shown on site" tone="rose" />
      </div>

      <div className="admin-tabs flex flex-wrap">
        {[
          { id: 'overview', label: 'Overview', icon: BarChart2 },
          { id: 'catalog', label: 'All pairs', icon: LayoutGrid },
          { id: 'featured', label: 'Landing featured', icon: Star },
          { id: 'web3', label: 'BEP-20 directory', icon: Globe },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`admin-tab-btn ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'web3' && <BscDirectoryAdminPanel />}

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <AdminPanel title="How it works" subtitle="Data flow from admin to exchange">
            <ul className="text-sm text-white/75 space-y-3 list-disc pl-5">
              <li>
                <strong className="text-white">Listed tokens</strong> come from Token Listings — approve projects there first, then tune market display here.
              </li>
              <li>
                <strong className="text-white">Platform pairs</strong> (BTC, ETH, …) use overrides stored in platform controls — edit taglines and featured flags on this page.
              </li>
              <li>Prices and 24h stats are live from the trading engine / Binance feed; this catalog only controls presentation.</li>
              <li>Hidden pairs are removed from the public Markets page and landing tables.</li>
            </ul>
            <Link
              to="/token-listings"
              className="inline-flex items-center gap-2 mt-5 text-sm font-bold text-gold-light hover:underline"
            >
              <Coins size={16} /> Open Token Listings
            </Link>
          </AdminPanel>
          <AdminPanel title="Category breakdown" subtitle="Pairs per market category">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(catalog?.categories || {}).map(([k, n]) => (
                <div key={k} className="rounded-xl border border-surface-border px-3 py-2.5 bg-white/[0.03]">
                  <p className="text-[10px] uppercase font-bold text-white/45">{catalog?.category_labels?.[k] || k}</p>
                  <p className="text-xl font-extrabold text-white">{n}</p>
                </div>
              ))}
            </div>
          </AdminPanel>
        </div>
      )}

      {(tab === 'catalog' || tab === 'featured') && (
        <>
          <FilterBar className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                className={`${inputCls} w-full sm:max-w-xs`}
                placeholder="Search symbol, name, tagline…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="text-xs text-white/50 tabular-nums">
                {filtered.length} pair{filtered.length === 1 ? '' : 's'}
              </span>
              {tab === 'catalog' ? (
                <div className="flex gap-2 sm:ml-auto">
                  <button
                    type="button"
                    onClick={() => setView('cards')}
                    className={`px-3 py-2 rounded-lg text-xs font-bold border ${view === 'cards' ? 'border-gold/40 bg-gold/15 text-gold-light' : 'border-surface-border text-white/50'}`}
                  >
                    <LayoutGrid size={14} className="inline mr-1" /> Cards
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    className={`px-3 py-2 rounded-lg text-xs font-bold border ${view === 'list' ? 'border-gold/40 bg-gold/15 text-gold-light' : 'border-surface-border text-white/50'}`}
                  >
                    <List size={14} className="inline mr-1" /> Table
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {[{ value: 'all', label: 'All' }, ...CATEGORIES].map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategoryFilter(c.value)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap ${
                    categoryFilter === c.value
                      ? 'border-gold/40 bg-gold/15 text-gold-light'
                      : 'border-surface-border text-white/50 hover:text-white'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </FilterBar>

          {loading ? (
            <p className="text-white/50 text-center py-16">Loading market catalog…</p>
          ) : tab === 'featured' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {(featured.length ? featured : filtered.filter((i) => rowState(i).featured_landing)).map(renderCard)}
            </div>
          ) : view === 'cards' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                {paged.map(renderCard)}
              </div>
              {pageCount > 1 ? (
                <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                  <button
                    type="button"
                    disabled={safePage <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="px-4 py-2 rounded-lg border border-surface-border text-sm font-bold disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-white/60 tabular-nums">
                    Page {safePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    className="px-4 py-2 rounded-lg border border-surface-border text-sm font-bold disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <AdminPanel title="All pairs" subtitle={`${filtered.length} markets · page ${safePage + 1}/${pageCount}`}>
              <AdminDataTable minWidth="720px" className="!border-0 !shadow-none !p-0">
                  <thead>
                    <tr>
                      <th>Pair</th>
                      <th>Name</th>
                      <th className="hidden md:table-cell">Tagline</th>
                      <th>Price</th>
                      <th>24h</th>
                      <th>Cat.</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((it) => {
                      const r = rowState(it);
                      const pct = parseFloat(r.priceChangePercent);
                      return (
                        <tr key={r.symbol}>
                          <td className="font-mono font-bold text-white whitespace-nowrap">{r.symbol}</td>
                          <td className="text-white/75 max-w-[140px] truncate">{r.token_name || '—'}</td>
                          <td className="text-white/55 max-w-[200px] truncate hidden md:table-cell">{r.market_tagline || '—'}</td>
                          <td className="font-mono text-white/80 whitespace-nowrap">${fmtPrice(r.price)}</td>
                          <td className={`font-bold whitespace-nowrap ${pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {fmtPct(r.priceChangePercent)}
                          </td>
                          <td className="text-xs text-white/50 uppercase">{r.market_category || 'alt'}</td>
                          <td>
                            <div className="flex gap-1.5">
                              {r.market_visible !== false ? (
                                <Eye size={14} className="text-emerald-400" title="Visible" />
                              ) : (
                                <EyeOff size={14} className="text-rose-400" title="Hidden" />
                              )}
                              {r.featured_landing ? (
                                <Star size={14} className="text-gold-light fill-gold-light" title="Featured" />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
              </AdminDataTable>
              {pageCount > 1 ? (
                <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-surface-border/60 mt-2">
                  <button
                    type="button"
                    disabled={safePage <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="px-4 py-2 rounded-lg border border-surface-border text-sm font-bold disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-white/60 tabular-nums">
                    Page {safePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    className="px-4 py-2 rounded-lg border border-surface-border text-sm font-bold disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </AdminPanel>
          )}
        </>
      )}
    </div>
  );
}
