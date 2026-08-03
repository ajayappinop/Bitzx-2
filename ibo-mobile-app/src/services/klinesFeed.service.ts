/**
 * Klines feed — cache-first, deduped fetch with fast Binance fallback.
 * Also subscribes to a live klines WS channel so charts update in real time
 * without relying on a 15-20s polling interval.
 *
 * Backend /api/trading/klines can take 10–30s; Binance public API is usually 1–3s.
 * For REST seeding, we use a tighter 8s timeout for all symbols (down from 30s)
 * to fail fast and let the chart render from cache quickly.
 */
import { API_URL } from '../config/env';
import { EP } from '../api/endpoints';
import { subscribeBinanceKline, isBinanceSpotSymbol } from './binancePublicFeed.service';
import { normalizeKlines } from '../utils/marketData';
import {
  klinesCacheKey,
  readKlinesCache,
  writeSymbolKlines,
  klinesCacheAgeMs,
  KLINES_SOFT_TTL_MS,
  writeKlinesCache,
} from '../utils/klinesCache';
import { isIboMockMarketSymbol, isInternalMockUsdtPair, isInternalMxbUsdtPair, toExchangeSymbol } from '../utils/tradeSymbols';
import { fetchIboCandles, subscribeIboCandles } from './iboMarketFeed.service';
import type { Kline } from '../types/market.types';

const inFlight = new Map<string, Promise<Kline[]>>();

/** Tighter timeout for REST seed — fail fast so charts render from cache. */
const KLINES_FETCH_TIMEOUT_MS = 8_000;

/** Symbols that only exist on our backend (not on Binance). */
function isBackendOnlySymbol(sym: string): boolean {
  return isIboMockMarketSymbol(sym) || isInternalMxbUsdtPair(sym) || isInternalMockUsdtPair(sym);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromBackend(sym: string, interval: string, limit: number): Promise<Kline[]> {
  const qs = new URLSearchParams({
    interval,
    limit: String(limit),
  });
  const url = `${API_URL}${EP.TRADING_KLINES(sym)}?${qs.toString()}`;
  const raw = await fetchWithTimeout(url, KLINES_FETCH_TIMEOUT_MS);
  const rows = normalizeKlines(raw);
  if (!rows.length) throw new Error('empty backend klines');
  return rows;
}

async function fetchFromBinance(sym: string, interval: string, limit: number): Promise<Kline[]> {
  const qs = new URLSearchParams({
    symbol: sym,
    interval,
    limit: String(Math.min(limit, 1000)),
  });
  const url = `https://api.binance.com/api/v3/klines?${qs.toString()}`;
  const raw = await fetchWithTimeout(url, KLINES_FETCH_TIMEOUT_MS);
  const rows = normalizeKlines(raw);
  if (!rows.length) throw new Error('empty binance klines');
  return rows;
}

async function loadKlinesRemote(sym: string, interval: string, limit: number): Promise<Kline[]> {
  const cached = readKlinesCache(klinesCacheKey(sym, interval));

  if (isIboMockMarketSymbol(sym)) {
    try {
      return await fetchIboCandles(sym, interval, limit);
    } catch {
      return cached ?? [];
    }
  }

  if (isBackendOnlySymbol(sym)) {
    try {
      return await fetchFromBackend(sym, interval, limit);
    } catch {
      return cached ?? [];
    }
  }

  try {
    const binance = await fetchFromBinance(sym, interval, limit);
    return binance;
  } catch {
    try {
      return await fetchFromBackend(sym, interval, limit);
    } catch {
      return cached ?? [];
    }
  }
}

/**
 * Fetch klines — returns cache immediately when fresh, otherwise network (with fallback).
 * Never discards existing cache on failure.
 */
export async function fetchSymbolKlines(
  symbol: string,
  interval: string,
  limit: number,
  opts?: { force?: boolean },
): Promise<Kline[]> {
  const sym = toExchangeSymbol(symbol);
  const key = klinesCacheKey(sym, interval);
  const cached = readKlinesCache(key);
  const age = klinesCacheAgeMs(key);
  const cacheFresh = cached?.length && age != null && age <= KLINES_SOFT_TTL_MS;

  if (!opts?.force && cacheFresh && cached) {
    void dedupedFetch(sym, interval, limit, key);
    return cached;
  }

  if (!opts?.force && cached?.length) {
    void dedupedFetch(sym, interval, limit, key);
    return cached;
  }

  return dedupedFetch(sym, interval, limit, key);
}

function dedupedFetch(
  sym: string,
  interval: string,
  limit: number,
  key: string,
): Promise<Kline[]> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = loadKlinesRemote(sym, interval, limit)
    .then((rows) => {
      if (rows.length) writeSymbolKlines(sym, interval, rows);
      return rows.length ? rows : (readKlinesCache(key) ?? []);
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

export function prefetchSymbolKlines(symbol: string, interval: string, limit: number): void {
  void fetchSymbolKlines(symbol, interval, limit).catch(() => {});
}

// ─── Live klines WebSocket ────────────────────────────────────────────────────

type KlinesListener = (klines: Kline[]) => void;

interface KlinesChannel {
  symbol: string;
  interval: string;
  listeners: Set<KlinesListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  subscribed: boolean;
  wsUnsub: (() => void) | null;
  pendingKlines: Kline[] | null;
  publishTimer: ReturnType<typeof setTimeout> | null;
}

const KLINES_PUBLISH_COALESCE_MS = 50;
const IDLE_DISCONNECT_MS = 45_000;
const klinesChannels = new Map<string, KlinesChannel>();

function flushKlinesListeners(channel: KlinesChannel): void {
  channel.publishTimer = null;
  const rows = channel.pendingKlines;
  if (!rows) return;
  channel.pendingKlines = null;
  channel.listeners.forEach((fn) => fn(rows));
}

function notifyKlinesListeners(channel: KlinesChannel, rows: Kline[], immediate = false): void {
  if (immediate) {
    channel.pendingKlines = null;
    if (channel.publishTimer) {
      clearTimeout(channel.publishTimer);
      channel.publishTimer = null;
    }
    channel.listeners.forEach((fn) => fn(rows));
    return;
  }
  channel.pendingKlines = rows;
  if (channel.publishTimer) return;
  channel.publishTimer = setTimeout(
    () => flushKlinesListeners(channel),
    KLINES_PUBLISH_COALESCE_MS,
  );
}

function klinesChannelKey(symbol: string, interval: string): string {
  return `${symbol}|${interval}`;
}

function mergeKlineUpdate(existing: Kline[], update: Kline): Kline[] {
  if (!existing.length) return [update];
  const last = existing[existing.length - 1];
  if (last.time === update.time) {
    // Update the last candle in place
    const next = [...existing];
    next[next.length - 1] = update;
    return next;
  }
  if (update.time > last.time) {
    // New candle — append and keep a reasonable window
    return [...existing.slice(-999), update];
  }
  // Older update — ignore
  return existing;
}

function applyKlineUpdate(channel: KlinesChannel, update: Kline): void {
  const key = klinesCacheKey(channel.symbol, channel.interval);
  const cached = readKlinesCache(key) ?? [];
  const merged = mergeKlineUpdate(cached, update);
  writeKlinesCache(key, merged);
  notifyKlinesListeners(channel, merged);
}

function ensureKlinesWs(channel: KlinesChannel): void {
  if (channel.subscribed) return;
  channel.subscribed = true;

  if (isBinanceSpotSymbol(channel.symbol)) {
    channel.wsUnsub = subscribeBinanceKline(
      channel.symbol,
      channel.interval,
      (update) => applyKlineUpdate(channel, update),
    );
    return;
  }

  if (isIboMockMarketSymbol(channel.symbol)) {
    channel.wsUnsub = subscribeIboCandles(channel.symbol, channel.interval, (rows) => {
      if (rows.length) {
        writeKlinesCache(klinesCacheKey(channel.symbol, channel.interval), rows);
        notifyKlinesListeners(channel, rows, true);
      }
    });
    return;
  }

  channel.wsUnsub = null;
}

function scheduleKlinesIdleDisconnect(key: string): void {
  const ch = klinesChannels.get(key);
  if (!ch || ch.listeners.size > 0) return;
  if (ch.idleTimer) clearTimeout(ch.idleTimer);
  ch.idleTimer = setTimeout(() => {
    const current = klinesChannels.get(key);
    if (!current || current.listeners.size > 0) return;
    current.wsUnsub?.();
    current.wsUnsub = null;
    current.subscribed = false;
    klinesChannels.delete(key);
  }, IDLE_DISCONNECT_MS);
}

function getOrCreateKlinesChannel(symbol: string, interval: string): KlinesChannel {
  const sym = toExchangeSymbol(symbol).toUpperCase();
  const key = klinesChannelKey(sym, interval);
  let ch = klinesChannels.get(key);
  if (!ch) {
    ch = {
      symbol: sym,
      interval,
      listeners: new Set(),
      idleTimer: null,
      subscribed: false,
      wsUnsub: null,
      pendingKlines: null,
      publishTimer: null,
    };
    klinesChannels.set(key, ch);
  }
  return ch;
}

/**
 * Subscribe to live kline updates for a symbol + interval via WebSocket.
 * Immediately seeds from cache (if available) then pushes updates as new candles arrive.
 * Also seeds with a REST fetch if the cache is stale.
 */
export function subscribeKlines(
  symbol: string,
  interval: string,
  limit: number,
  listener: KlinesListener,
): () => void {
  const sym = toExchangeSymbol(symbol).toUpperCase();
  const ch = getOrCreateKlinesChannel(sym, interval);

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.listeners.add(listener);
  ensureKlinesWs(ch);

  // Seed immediately from cache
  const key = klinesCacheKey(sym, interval);
  const cached = readKlinesCache(key);
  if (cached?.length) notifyKlinesListeners(ch, cached, true);

  // Background REST seed if cache is stale or missing
  const age = klinesCacheAgeMs(key);
  const cacheFresh = cached?.length && age != null && age <= KLINES_SOFT_TTL_MS;
  if (!cacheFresh) {
    void fetchSymbolKlines(sym, interval, limit).then((rows) => {
      if (rows.length) notifyKlinesListeners(ch, rows, true);
    });
  }

  return () => {
    ch.listeners.delete(listener);
    if (ch.listeners.size === 0) {
      scheduleKlinesIdleDisconnect(klinesChannelKey(sym, interval));
    }
  };
}
