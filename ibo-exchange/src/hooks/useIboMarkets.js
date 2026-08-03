import { useState, useEffect, useCallback, useRef } from 'react';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { exchangeWsPath } from '@/services/marketApi';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const PAGE_SIZE = 40;

/**
 * Optimized IBO markets — paginated REST + lightweight WS (featured/top ~48).
 */
export function useIboMarkets({ tier: initialTier = 'all' } = {}) {
  const [tier, setTier] = useState(initialTier);
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [topGainers, setTopGainers] = useState([]);
  const [topLosers, setTopLosers] = useState([]);
  const [iboPrice, setIboPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const skipRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  const applyPayload = useCallback((data, { append = false } = {}) => {
    const list = Array.isArray(data?.markets) ? data.markets : data?.items || [];
    setItems((prev) => (append ? [...prev, ...list] : list));
    setTotal(Number(data?.total) ?? list.length);
    setCatalogTotal(Number(data?.total_catalog) ?? data?.summary?.total_pairs ?? 0);
    if (data?.summary) setSummary(data.summary);
    if (Array.isArray(data?.top_gainers)) setTopGainers(data.top_gainers);
    if (Array.isArray(data?.top_losers)) setTopLosers(data.top_losers);
    if (data?.ibo_usdt_price != null) setIboPrice(data.ibo_usdt_price);
  }, []);

  const fetchPage = useCallback(
    async ({ append = false, tierOverride, qOverride } = {}) => {
      const t = tierOverride ?? (tier === 'favorites' ? 'all' : tier);
      const q = qOverride ?? debouncedQ;
      const skip = append ? skipRef.current : 0;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      try {
        const params = new URLSearchParams({
          skip: String(skip),
          limit: String(PAGE_SIZE),
          tier: t,
        });
        if (q) params.set('q', q);
        const res = await fetch(`${API}/api/trading/ibo-markets?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let list = Array.isArray(data.markets) ? data.markets : [];
        if (tier === 'favorites') {
          const favs = JSON.parse(localStorage.getItem('ibo_ibomkt_favs') || '[]');
          list = list.filter((m) => favs.includes(m.symbol));
          data.total = list.length;
        }
        applyPayload({ ...data, markets: list }, { append });
        skipRef.current = skip + list.length;
      } catch {
        if (!append) {
          setItems([]);
          setError('Could not load IBO markets.');
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [tier, debouncedQ, applyPayload],
  );

  useEffect(() => {
    skipRef.current = 0;
    fetchPage({ append: false });
  }, [fetchPage]);

  useEffect(() => {
    let closed = false;
    let ws = null;
    let reconnectTimer = null;
    const url = exchangeWsPath('/api/ws/ibo/markets');

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type !== 'ibo_markets') return;
          if (tier === 'featured' && !debouncedQ) {
            applyPayload(j, { append: false });
            skipRef.current = (j.markets || []).length;
          } else if (j.summary) {
            setSummary(j.summary);
            setCatalogTotal(Number(j.total_catalog) || catalogTotal);
            if (j.ibo_usdt_price != null) setIboPrice(j.ibo_usdt_price);
            if (Array.isArray(j.top_gainers)) setTopGainers(j.top_gainers);
            if (Array.isArray(j.top_losers)) setTopLosers(j.top_losers);
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) reconnectTimer = window.setTimeout(connect, 4000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [tier, debouncedQ, applyPayload, catalogTotal]);

  const hasMore = items.length < total;

  return {
    tier,
    setTier,
    query,
    setQuery,
    items,
    total,
    catalogTotal,
    summary,
    topGainers,
    topLosers,
    iboPrice,
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
