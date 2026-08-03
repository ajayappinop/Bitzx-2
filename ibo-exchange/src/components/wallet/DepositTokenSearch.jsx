import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, ChevronDown, Check, Loader2 } from 'lucide-react';
import { COIN_ICONS } from '@/services/marketApi';
import { isCatalogDepositReady } from '@/lib/walletNetworks';

function shortContract(addr) {
  const a = (addr || '').trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function TokenAvatar({ item, size = 28 }) {
  const sym = item?.asset || '';
  const logo = item?.logo_url;
  const px = size;
  if (logo) {
    return (
      <img
        src={logo}
        alt={sym}
        width={px}
        height={px}
        className="rounded-full shrink-0 object-cover bg-surface-card"
        loading="lazy"
      />
    );
  }
  if (COIN_ICONS[sym]) {
    return (
      <img
        src={COIN_ICONS[sym]}
        alt={sym}
        width={px}
        height={px}
        className="rounded-full shrink-0"
        loading="lazy"
      />
    );
  }
  return (
    <div
      className="rounded-full bg-[rgba(254, 157, 85,0.2)] flex items-center justify-center text-[#FE9D55] font-bold shrink-0"
      style={{ width: px, height: px, fontSize: Math.max(9, px * 0.35) }}
    >
      {sym.slice(0, 2)}
    </div>
  );
}

const VISIBLE_CHUNK = 60;

/**
 * Searchable BEP-20 token picker — server-backed catalog with infinite scroll.
 */
export default function DepositTokenSearch({
  items = [],
  assets = [],
  value,
  onChange,
  query,
  onQueryChange,
  loading = false,
  loadingMore = false,
  error = null,
  bep20Note = null,
  disabled = false,
  label = 'Search coin',
  total = 0,
  counts = null,
  hasMore = false,
  onLoadMore,
  depositOnlyFilter = false,
  onDepositOnlyFilterChange,
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_CHUNK);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    setVisibleCount(VISIBLE_CHUNK);
  }, [query, items.length, depositOnlyFilter]);

  const selected = useMemo(
    () => items.find((it) => it.asset === value) ?? null,
    [items, value],
  );

  const displayItems = useMemo(() => {
    let list = items;
    if (depositOnlyFilter) list = list.filter((it) => isCatalogDepositReady(it));
    return list;
  }, [items, depositOnlyFilter]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const it of displayItems) {
      if (!map.has(it.asset)) map.set(it.asset, it);
    }
    const order = assets.length ? assets : [...map.keys()];
    return order.filter((a) => map.has(a)).map((a) => map.get(a));
  }, [displayItems, assets]);

  const visible = grouped.slice(0, visibleCount);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
    if (nearBottom) {
      if (visibleCount < grouped.length) {
        setVisibleCount((n) => Math.min(n + VISIBLE_CHUNK, grouped.length));
      } else if (hasMore && onLoadMore) {
        onLoadMore();
      }
    }
  }, [visibleCount, grouped.length, hasMore, onLoadMore]);

  const countLabel = total > 0
    ? `${displayItems.length < total ? `${items.length} loaded · ` : ''}${total} tokens`
    : '';

  return (
    <div ref={wrapRef} className="relative">
      {label ? (
        <label className="block text-xs text-white mb-1.5 uppercase tracking-wider">{label}</label>
      ) : null}

      {bep20Note?.note ? (
        <p className="text-[11px] text-zinc-400 mb-2 leading-relaxed">{bep20Note.note}</p>
      ) : null}

      {onDepositOnlyFilterChange ? (
        <div className="flex flex-wrap gap-2 mb-2">
          {[
            { id: false, label: 'All Web3' },
            { id: true, label: 'Depositable only' },
          ].map((f) => (
            <button
              key={String(f.id)}
              type="button"
              onClick={() => onDepositOnlyFilterChange(f.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                depositOnlyFilter === f.id
                  ? 'border-[rgba(254, 157, 85,0.5)] bg-[rgba(254, 157, 85,0.15)] text-[#FE9D55]'
                  : 'border-surface-border text-zinc-500 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
          {counts ? (
            <span className="text-[10px] text-zinc-500 self-center ml-1">
              {counts.deposit_enabled ?? 0} live deposits
              {counts.listed != null ? ` · ${counts.listed} listed` : ''}
            </span>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 bg-surface-card border border-surface-border rounded-xl px-4 py-3 focus:border-[rgba(254, 157, 85,0.5)] transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {selected ? (
            <>
              <TokenAvatar item={selected} size={26} />
              <div className="text-left min-w-0">
                <p className="text-white font-semibold truncate">{selected.asset}</p>
                <p className="text-[11px] text-zinc-400 truncate">
                  {selected.token_name}
                  {selected.contract_address ? ` · ${shortContract(selected.contract_address)}` : ''}
                </p>
              </div>
            </>
          ) : (
            <span className="text-zinc-400 text-sm">
              Search {total > 0 ? `${total}+` : ''} BEP-20 tokens…
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-white shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface-card border border-surface-border rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="p-2 border-b border-surface-border flex items-center gap-2">
              <Search size={14} className="text-zinc-500 shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Symbol, name, or contract (0x…)…"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none min-w-0"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => onQueryChange('')}
                  className="text-zinc-500 hover:text-white p-0.5"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {countLabel ? (
              <p className="px-3 py-1.5 text-[10px] text-zinc-500 border-b border-surface-border/60">
                {countLabel}
                {loading ? ' · updating…' : ''}
              </p>
            ) : null}

            <div
              ref={listRef}
              onScroll={onScroll}
              className="max-h-[min(420px,50vh)] overflow-y-auto overscroll-contain"
            >
              {error ? (
                <p className="px-4 py-3 text-xs text-[#FE9D55]">{error}</p>
              ) : null}
              {loading && !visible.length ? (
                <p className="px-4 py-6 text-xs text-zinc-500 flex items-center gap-2 justify-center">
                  <Loader2 size={14} className="animate-spin" /> Loading catalog…
                </p>
              ) : null}
              {!loading && !visible.length ? (
                <p className="px-4 py-6 text-xs text-zinc-500 text-center">
                  No matching tokens. Try another search or enable Web3 directory in backend
                  (BSC_WEB3_CATALOG_ENABLED).
                </p>
              ) : null}
              {visible.map((it) => {
                const active = value === it.asset;
                const canDeposit = isCatalogDepositReady(it);
                return (
                  <button
                    key={`${it.asset}-${it.network}-${it.catalog_source || ''}`}
                    type="button"
                    disabled={depositOnlyFilter && !canDeposit}
                    onClick={() => {
                      onChange(it.asset, it);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-hover transition-colors disabled:opacity-40 ${
                      active ? 'bg-[rgba(254, 157, 85,0.1)]' : ''
                    }`}
                  >
                    <TokenAvatar item={it} size={24} />
                    <div className="flex-1 min-w-0 text-left">
                      <p className={`text-sm font-semibold truncate ${active ? 'text-[#FE9D55]' : 'text-white'}`}>
                        {it.asset}
                        {it.is_listed ? (
                          <span className="ml-1.5 text-[9px] font-bold uppercase text-sky-300/80">Listed</span>
                        ) : it.catalog_source === 'coingecko_bsc' ? (
                          <span className="ml-1.5 text-[9px] font-bold uppercase text-zinc-500">Web3</span>
                        ) : null}
                        {!canDeposit ? (
                          <span className="ml-1.5 text-[9px] font-bold uppercase text-[#FE9D55]/90">Soon</span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {it.token_name}
                        {it.contract_address ? ` · ${shortContract(it.contract_address)}` : ''}
                      </p>
                    </div>
                    {active ? <Check size={14} className="text-[#FE6C02] shrink-0" /> : null}
                  </button>
                );
              })}
              {(loadingMore || visibleCount < grouped.length) && (
                <p className="px-4 py-3 text-center text-[11px] text-zinc-500 flex items-center justify-center gap-2">
                  {loadingMore ? <Loader2 size={12} className="animate-spin" /> : null}
                  {loadingMore ? 'Loading more…' : 'Scroll for more'}
                </p>
              )}
              {hasMore && !loadingMore && visibleCount >= grouped.length && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="w-full py-2.5 text-xs font-bold text-[#FE9D55] hover:bg-[rgba(254, 157, 85,0.1)] border-t border-surface-border"
                >
                  Load more from Web3 directory
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
