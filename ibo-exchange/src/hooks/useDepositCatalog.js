import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const PAGE_SIZE = 150;

function normalizeCatalogItem(row) {
  if (!row || typeof row !== 'object') return null;
  const asset = String(row.asset ?? '').trim().toUpperCase();
  const network = String(row.network ?? '').trim();
  if (!asset || !network) return null;
  return {
    asset,
    network,
    chain_id: row.chain_id != null ? String(row.chain_id).toLowerCase() : '',
    label: String(row.label ?? network).trim() || network,
    token_name: String(row.token_name ?? asset).trim() || asset,
    project_name: row.project_name != null ? String(row.project_name).trim() : '',
    logo_url: row.logo_url != null ? String(row.logo_url).trim() : '',
    contract_address: row.contract_address != null ? String(row.contract_address).trim() : '',
    decimals: Number(row.decimals) || 18,
    deposit_enabled: row.deposit_enabled === true,
    withdraw_enabled: row.withdraw_enabled === true,
    status: String(row.status ?? 'active').trim() || 'active',
    testnet: Boolean(row.testnet),
    listed_token_id: row.listed_token_id ?? null,
    is_listed: Boolean(row.is_listed),
    universal_bep20: Boolean(row.universal_bep20),
    endpoint_label: row.endpoint_label != null ? String(row.endpoint_label).trim() : '',
    chain_display: row.chain_display != null ? String(row.chain_display).trim() : '',
    catalog_source: row.catalog_source != null ? String(row.catalog_source) : '',
    description: row.description != null ? String(row.description) : '',
  };
}

/**
 * Full Web3 / BEP-20 deposit catalog with server search + pagination.
 */
export function useDepositCatalog({ chain = 'bsc', enabled = true, depositOnlyFilter = false } = {}) {
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [bep20Meta, setBep20Meta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const skipRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    async ({ append = false } = {}) => {
      if (!enabled) return;
      const skip = append ? skipRef.current : 0;
      if (append) setLoadingMore(true);
      else setLoading(true);
      if (!append) setError(null);
      try {
        const params = new URLSearchParams({
          deposit_only: depositOnlyFilter ? 'true' : 'false',
          include_all_listed: 'true',
          include_web3_directory: 'true',
          skip: String(skip),
          limit: String(PAGE_SIZE),
        });
        if (chain) params.set('chain', chain);
        if (debouncedQ) params.set('q', debouncedQ);
        const res = await fetch(`${API}/api/wallet/deposit-catalog?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = (Array.isArray(data?.items) ? data.items : [])
          .map(normalizeCatalogItem)
          .filter(Boolean);
        setItems((prev) => (append ? [...prev, ...list] : list));
        setTotal(Number(data?.total) || 0);
        setCounts(data?.counts ?? null);
        setBep20Meta(data?.bep20_universal ?? null);
        skipRef.current = skip + list.length;
      } catch (e) {
        if (!append) {
          setItems([]);
          setTotal(0);
          setCounts(null);
          setBep20Meta(null);
          setError(
            e?.message?.includes('Failed to fetch')
              ? 'Could not reach the API. Check VITE_BACKEND_URL.'
              : 'Could not load deposit catalog.',
          );
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [chain, debouncedQ, depositOnlyFilter, enabled],
  );

  useEffect(() => {
    skipRef.current = 0;
    fetchPage({ append: false });
  }, [fetchPage]);

  const hasMore = items.length < total;

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    fetchPage({ append: true });
  }, [fetchPage, hasMore, loading, loadingMore]);

  const depositableItems = useMemo(
    () => items.filter((it) => it.deposit_enabled),
    [items],
  );

  const assets = useMemo(() => {
    const order = [];
    const seen = new Set();
    for (const it of items) {
      if (!seen.has(it.asset)) {
        seen.add(it.asset);
        order.push(it.asset);
      }
    }
    return order;
  }, [items]);

  const itemByKey = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      m.set(`${it.asset}|${it.network}`, it);
    }
    return m;
  }, [items]);

  return {
    query,
    setQuery,
    items,
    depositableItems,
    total,
    counts,
    assets,
    itemByKey,
    bep20Meta,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    depositOnlyFilter,
    refresh: () => {
      skipRef.current = 0;
      return fetchPage({ append: false });
    },
  };
}

export { normalizeCatalogItem };
