import { useState, useEffect, useCallback, useRef } from 'react';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const PAGE_SIZE = 48;

export function normalizeBscDirectoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const base = String(row.base ?? row.baseAsset ?? '').trim().toUpperCase();
  if (!base) return null;
  return {
    ...row,
    symbol: row.symbol || `${base}USDT`,
    base,
    baseAsset: base,
    quote: row.quote ?? row.quoteAsset ?? 'USDT',
    quoteAsset: row.quoteAsset ?? 'USDT',
    logo_url: row.logo_url != null ? String(row.logo_url).trim() : '',
    token_name: String(row.token_name ?? base).trim(),
    contract_address: row.contract_address != null ? String(row.contract_address).trim() : '',
    deposit_enabled: row.deposit_enabled === true,
    universal_bep20: Boolean(row.universal_bep20),
    trade_symbol: row.trade_symbol != null ? String(row.trade_symbol).trim().toUpperCase() : '',
    is_listed: Boolean(row.is_listed),
    has_live_price: Boolean(row.has_live_price),
    catalog_source: row.catalog_source || '',
    market_category: row.market_category || 'web3',
  };
}

/**
 * Paginated BSC / Web3 directory (same tokens as wallet deposit catalog).
 */
export function useBscDirectory({
  enabled = true,
  depositOnly = false,
  listedOnly = false,
  web3Only = false,
  pageSize = PAGE_SIZE,
} = {}) {
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const skipRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 280);
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
          skip: String(skip),
          limit: String(pageSize),
          deposit_only: depositOnly ? 'true' : 'false',
          listed_only: listedOnly ? 'true' : 'false',
          web3_only: web3Only ? 'true' : 'false',
        });
        if (debouncedQ) params.set('q', debouncedQ);
        const res = await fetch(`${API}/api/listings/bsc-directory?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = (Array.isArray(data?.items) ? data.items : [])
          .map(normalizeBscDirectoryRow)
          .filter(Boolean);
        setItems((prev) => (append ? [...prev, ...list] : list));
        setTotal(Number(data?.total) || 0);
        setCounts(data?.counts ?? null);
        skipRef.current = skip + list.length;
      } catch (e) {
        if (!append) {
          setItems([]);
          setTotal(0);
          setError('Could not load BSC token directory.');
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [enabled, debouncedQ, depositOnly, listedOnly, web3Only, pageSize],
  );

  useEffect(() => {
    skipRef.current = 0;
    fetchPage({ append: false });
  }, [fetchPage]);

  const hasMore = items.length < total;

  return {
    query,
    setQuery,
    items,
    total,
    counts,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore: () => {
      if (!hasMore || loadingMore || loading) return;
      fetchPage({ append: true });
    },
    refresh: () => {
      skipRef.current = 0;
      return fetchPage({ append: false });
    },
  };
}
