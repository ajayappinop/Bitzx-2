import { useState, useEffect, useRef, useCallback } from 'react';
import { exchangeWsPath, marketApi, normalizeMarketsList } from '@/services/marketApi';
import { fetchMarketCatalog } from '@/services/listingsApi';

const PRICE_KEYS = [
  'price', 'priceChange', 'priceChangePercent', 'openPrice', 'highPrice', 'lowPrice',
  'volume', 'quoteVolume', 'weightedAvgPrice', 'bidPrice', 'askPrice', 'prevClosePrice', 'count',
];

function positiveNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0;
}

function pickPriceField(liveVal, metaVal) {
  if (positiveNum(liveVal)) return liveVal;
  if (positiveNum(metaVal)) return metaVal;
  if (liveVal != null && liveVal !== '') return liveVal;
  if (metaVal != null && metaVal !== '') return metaVal;
  return undefined;
}

/** Merge admin catalog metadata with live WS rows; append catalog-only visible pairs. */
export function mergeCatalogWithLive(metaBySymbol, liveRows) {
  const map = metaBySymbol instanceof Map ? metaBySymbol : new Map();
  const seen = new Set();
  const out = [];

  for (const row of liveRows || []) {
    const sym = row?.symbol;
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    const meta = map.get(sym);
    if (!meta) {
      out.push(row);
      continue;
    }
    const merged = { ...meta };
    for (const k of Object.keys(row)) {
      if (PRICE_KEYS.includes(k)) {
        const picked = pickPriceField(row[k], meta[k]);
        if (picked != null && picked !== '') merged[k] = picked;
      } else if (row[k] != null && row[k] !== '') {
        merged[k] = row[k];
      }
    }
    for (const k of PRICE_KEYS) {
      if ((merged[k] == null || merged[k] === '') && meta[k] != null && meta[k] !== '') {
        merged[k] = meta[k];
      }
    }
    if (merged.market_visible === false) continue;
    out.push(merged);
  }

  for (const [sym, meta] of map) {
    if (seen.has(sym) || meta.market_visible === false) continue;
    if (!positiveNum(meta.price)) continue;
    out.push(meta);
  }

  out.sort((a, b) => {
    const sa = Number(a.market_sort_order) || 500;
    const sb = Number(b.market_sort_order) || 500;
    if (sa !== sb) return sa - sb;
    return (a.symbol || '').localeCompare(b.symbol || '');
  });

  return out;
}

/**
 * Live markets via WebSocket + one-time admin catalog merge for metadata / listed pairs.
 */
export function useLiveMarkets({ enabled = true } = {}) {
  const [markets, setMarkets] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const metaRef = useRef(new Map());

  const applyLive = useCallback((rawList) => {
    const live = normalizeMarketsList(rawList).filter((m) => m.market_visible !== false);
    setMarkets(mergeCatalogWithLive(metaRef.current, live));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const cat = await fetchMarketCatalog();
        if (cancelled) return;
        const map = new Map();
        for (const it of cat.items || []) {
          if (it?.symbol) map.set(it.symbol, it);
        }
        metaRef.current = map;
        setFeatured(Array.isArray(cat.featured) ? cat.featured : []);
        setCatalogTotal(Number(cat.total) || map.size);
      } catch {
        if (!cancelled) metaRef.current = new Map();
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    marketApi.getMarkets().then((rows) => {
      if (!cancelled && rows?.length) applyLive(rows);
    }).catch(() => { /* WS will follow */ });

    const url = exchangeWsPath('/api/ws/exchange/markets');
    let closed = false;
    let reconnectTimer = null;
    let ws = null;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_markets' && Array.isArray(j.markets)) {
            applyLive(j.markets);
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();
    const loadFallback = window.setTimeout(() => {
      if (!closed) setLoading(false);
    }, 12000);

    return () => {
      closed = true;
      window.clearTimeout(loadFallback);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [enabled, applyLive]);

  return { markets, featured, catalogTotal, loading };
}
