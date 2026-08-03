/**
 * Spot ticker feed — WS-first with parallel REST seed.
 * Mirrors maxByte-exchange: wss://host/api/ws/exchange/ticker?symbol=BTCUSDT
 */
import { API_URL } from '../config/env';
import { exchangeWsPath } from '../config/wsConfig';
import { EP } from '../api/endpoints';
import { wsManager } from './websocket.service';
import {
  readChartTicker,
  writeChartTicker,
  tickerFromPayload,
  chartTickerAgeMs,
  CHART_PAGE_SOFT_TTL_MS,
} from '../utils/chartPageCache';
import type { Ticker } from '../types/market.types';
import { isIboMockMarketSymbol, isInternalMxbUsdtPair } from '../utils/tradeSymbols';
import { prefetchIboMarket, subscribeIboTicker } from './iboMarketFeed.service';

type TickerListener = (ticker: Ticker) => void;

const IDLE_DISCONNECT_MS = 45_000;
const FETCH_TIMEOUT_MS = 8_000;
const inFlight = new Map<string, Promise<Ticker | null>>();

interface Channel {
  symbol: string;
  wsUrl: string;
  listeners: Set<TickerListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  subscribed: boolean;
  wsUnsub: (() => void) | null;
}

const channels = new Map<string, Channel>();

function symKey(symbol: string): string {
  return String(symbol || '').toUpperCase();
}

function publish(channel: Channel, raw: Record<string, unknown>): void {
  const next = tickerFromPayload(channel.symbol, raw);
  writeChartTicker(channel.symbol, next);
  channel.listeners.forEach((fn) => fn(next));
}

function ensureWs(channel: Channel): void {
  if (channel.subscribed) return;
  channel.subscribed = true;
  channel.wsUnsub = wsManager.subscribe(channel.wsUrl, channel.wsUrl, (msg: unknown) => {
    const m = msg as { type?: string; ticker?: Record<string, unknown> };
    if (m?.type !== 'exchange_ticker' || !m.ticker) return;
    const tickSym = String(m.ticker.symbol ?? '');
    if (tickSym && tickSym !== channel.symbol) return;
    publish(channel, m.ticker);
  });
}

function scheduleIdleDisconnect(key: string): void {
  const ch = channels.get(key);
  if (!ch || ch.listeners.size > 0) return;
  if (ch.idleTimer) clearTimeout(ch.idleTimer);
  ch.idleTimer = setTimeout(() => {
    const current = channels.get(key);
    if (!current || current.listeners.size > 0) return;
    current.wsUnsub?.();
    current.wsUnsub = null;
    current.subscribed = false;
    channels.delete(key);
  }, IDLE_DISCONNECT_MS);
}

async function fetchTicker(symbol: string): Promise<Ticker | null> {
  const sym = symKey(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${EP.TRADING_TICKER(sym)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const next = tickerFromPayload(sym, data);
    writeChartTicker(sym, next);
    return next;
  } catch {
    return readChartTicker(sym);
  } finally {
    clearTimeout(timer);
  }
}

function dedupedFetch(key: string, fn: () => Promise<Ticker | null>): Promise<Ticker | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function getOrCreateChannel(symbol: string): Channel {
  const sym = symKey(symbol);
  let ch = channels.get(sym);
  if (!ch) {
    const wsUrl = exchangeWsPath(
      `/api/ws/exchange/ticker?symbol=${encodeURIComponent(sym)}`,
    );
    ch = {
      symbol: sym,
      wsUrl,
      listeners: new Set(),
      idleTimer: null,
      subscribed: false,
      wsUnsub: null,
    };
    channels.set(sym, ch);
  }
  return ch;
}

export function subscribeSpotTicker(symbol: string, listener: TickerListener): () => void {
  const sym = symKey(symbol);
  if (isIboMockMarketSymbol(sym) && !isInternalMxbUsdtPair(sym)) {
    return subscribeIboTicker(sym, listener);
  }
  const ch = getOrCreateChannel(sym);

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.listeners.add(listener);
  ensureWs(ch);

  const cached = readChartTicker(sym);
  if (cached) listener(cached);

  const age = chartTickerAgeMs(sym);
  const cacheFresh = cached && age != null && age <= CHART_PAGE_SOFT_TTL_MS;
  if (!cacheFresh) {
    void dedupedFetch(`ticker:fetch:${sym}`, () => fetchTicker(sym)).then((t) => {
      if (t) listener(t);
    });
  }

  return () => {
    ch.listeners.delete(listener);
    if (ch.listeners.size === 0) scheduleIdleDisconnect(sym);
  };
}

export function warmSpotTickerWs(symbol: string): void {
  const ch = getOrCreateChannel(symbol);
  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }
  ensureWs(ch);
}

export function prefetchSpotTicker(symbol: string, force = false): void {
  const sym = symKey(symbol);
  if (!force) {
    const cached = readChartTicker(sym);
    const age = chartTickerAgeMs(sym);
    if (cached && age != null && age <= CHART_PAGE_SOFT_TTL_MS) return;
  }
  warmSpotTickerWs(sym);
  void dedupedFetch(`ticker:fetch:${sym}`, () => fetchTicker(sym));
}

export function prefetchSpotTickers(symbols: string[]): void {
  symbols.forEach((s) => prefetchSpotTicker(s));
}
