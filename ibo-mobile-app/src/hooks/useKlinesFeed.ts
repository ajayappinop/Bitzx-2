import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { subscribeKlines } from '../services/klinesFeed.service';
import {
  hasSymbolKlines,
  readSymbolKlines,
} from '../utils/klinesCache';
import { toExchangeSymbol } from '../utils/tradeSymbols';
import type { Kline } from '../types/market.types';

type Options = {
  /** Pre-seeded rows from parent (chart page cache). */
  seed?: Kline[];
  /**
   * Background REST refresh interval in ms (fallback for symbols without a
   * klines WS channel on the backend). Omit to rely on WS-only updates.
   */
  refreshMs?: number;
};

/**
 * Cache-first klines hook — shows cached/seed data instantly.
 *
 * Subscribes to the live klines WebSocket so the last candle updates in real
 * time without needing a REST poll interval. Falls back to the REST-poll
 * interval (`refreshMs`) for symbols / deployments where the WS klines stream
 * is unavailable (the subscribe function still seeds from REST + cache).
 */
export function useKlinesFeed(
  symbol: string,
  interval: string,
  limit: number,
  opts?: Options,
) {
  const sym = toExchangeSymbol(symbol);
  const seed = opts?.seed;
  const refreshMs = opts?.refreshMs;

  const [klines, setKlines] = useState<Kline[]>(() => {
    if (seed?.length) return seed;
    return readSymbolKlines(sym, interval);
  });
  const [loading, setLoading] = useState(() => {
    if (seed?.length) return false;
    return !hasSymbolKlines(sym, interval);
  });

  const symRef = useRef(sym);
  symRef.current = sym;

  // Hydrate from cache / seed immediately before first paint
  useLayoutEffect(() => {
    const cached = readSymbolKlines(sym, interval);
    if (cached.length) {
      setKlines(cached);
      setLoading(false);
      return;
    }
    if (seed?.length) {
      setKlines(seed);
      setLoading(false);
      return;
    }
    setKlines([]);
    setLoading(true);
  }, [sym, interval, seed]);

  // Subscribe to live WS + REST seed
  useEffect(() => {
    const unsub = subscribeKlines(sym, interval, limit, (rows) => {
      if (symRef.current !== sym) return;
      setKlines(rows);
      setLoading(false);
    });

    // Mark loading done even if WS/REST gives no rows (avoid forever spinner)
    const fallbackTimer = setTimeout(() => setLoading(false), 10_000);

    return () => {
      unsub();
      clearTimeout(fallbackTimer);
    };
  }, [sym, interval, limit]);

  // Optional REST poll interval (kept for deployments without WS klines stream)
  const refresh = useCallback(async (silent = false) => {
    const { fetchSymbolKlines } = await import('../services/klinesFeed.service');
    const cached = readSymbolKlines(symRef.current, interval);
    if (cached.length) {
      setKlines(cached);
      if (!silent) setLoading(false);
    } else if (!silent) {
      setLoading(true);
    }
    try {
      const rows = await fetchSymbolKlines(symRef.current, interval, limit);
      if (rows.length) setKlines(rows);
    } catch {
      /* keep showing cached / previous rows */
    } finally {
      setLoading(false);
    }
  }, [interval, limit]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(() => { void refresh(true); }, refreshMs);
    return () => clearInterval(id);
  }, [refresh, refreshMs]);

  return { klines, loading, refresh };
}
