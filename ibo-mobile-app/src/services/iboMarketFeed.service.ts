/**
 * IBO / MXB mock market feed — REST bootstrap + /api/ws/ibo-market WS.
 * Mirrors maxByte-exchange useIBOMarket.js.
 */
import { API_URL, MARKET_PUBLIC_TIMEOUT_MS } from '../config/env';
import { exchangeWsPath } from '../config/wsConfig';
import { wsManager } from './websocket.service';
import { normalizeOrderBook } from '../utils/orderbook';
import { normalizeKlines } from '../utils/marketData';
import { tickerFromPayload, writeChartTicker } from '../utils/chartPageCache';
import {
  getCachedOrderBook,
  setCachedOrderBook,
  orderBookHasDepth,
} from '../utils/orderBookCache';
import {
  klinesCacheKey,
  readKlinesCache,
  writeKlinesCache,
} from '../utils/klinesCache';
import type { Kline, OrderBook, Ticker } from '../types/market.types';

const FETCH_TIMEOUT_MS = MARKET_PUBLIC_TIMEOUT_MS;
const IDLE_DISCONNECT_MS = 45_000;
const MAX_CANDLES = 500;
const DEFAULT_INTERVAL = '1m';

type ObListener = (book: OrderBook) => void;
type TickerListener = (ticker: Ticker) => void;
type CandleListener = (candles: Kline[]) => void;
type StatusListener = (status: { connected: boolean; error: string | null; loading: boolean }) => void;

interface IboChannel {
  symbol: string;
  interval: string;
  obListeners: Set<ObListener>;
  tickerListeners: Set<TickerListener>;
  candleListeners: Set<CandleListener>;
  statusListeners: Set<StatusListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  wsUnsub: (() => void) | null;
  subscribed: boolean;
  loading: boolean;
  connected: boolean;
  error: string | null;
  noRetry: boolean;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  candles: Kline[];
  pendingOb: OrderBook | null;
  obTimer: ReturnType<typeof setTimeout> | null;
}

const channels = new Map<string, IboChannel>();
const inFlight = new Map<string, Promise<unknown>>();

function channelKey(symbol: string, interval: string): string {
  return `${String(symbol || '').toUpperCase()}|${String(interval || DEFAULT_INTERVAL).toLowerCase()}`;
}

function symKey(symbol: string): string {
  return String(symbol || '').toUpperCase();
}

function notifyStatus(ch: IboChannel): void {
  const status = { connected: ch.connected, error: ch.error, loading: ch.loading };
  ch.statusListeners.forEach((fn) => fn(status));
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function flushOb(ch: IboChannel): void {
  ch.obTimer = null;
  const ob = ch.pendingOb;
  if (!ob) return;
  ch.pendingOb = null;
  if (orderBookHasDepth(ob)) {
    setCachedOrderBook(ch.symbol, ob);
    ch.obListeners.forEach((fn) => fn(ob));
  }
}

function scheduleOb(ch: IboChannel, ob: OrderBook): void {
  ch.pendingOb = ob;
  if (ch.obTimer) return;
  ch.obTimer = setTimeout(() => flushOb(ch), 50);
}

function publishTicker(ch: IboChannel, raw: Record<string, unknown>): void {
  const next = tickerFromPayload(ch.symbol, raw);
  writeChartTicker(ch.symbol, next);
  ch.tickerListeners.forEach((fn) => fn(next));
}

function publishCandles(ch: IboChannel, rows: Kline[], immediate = false): void {
  ch.candles = rows;
  const key = klinesCacheKey(ch.symbol, ch.interval);
  if (rows.length) writeKlinesCache(key, rows);
  if (immediate) {
    ch.candleListeners.forEach((fn) => fn(rows));
    return;
  }
  ch.candleListeners.forEach((fn) => fn(rows));
}

function mergeCandle(existing: Kline[], update: Kline): Kline[] {
  if (!existing.length) return [update];
  const next = [...existing];
  const idx = next.findIndex((x) => Number(x.time) === Number(update.time));
  if (idx >= 0) {
    next[idx] = update;
  } else {
    next.push(update);
  }
  return next.length > MAX_CANDLES ? next.slice(-MAX_CANDLES) : next;
}

async function bootstrapChannel(ch: IboChannel): Promise<void> {
  ch.loading = true;
  ch.error = null;
  notifyStatus(ch);
  const sym = ch.symbol;
  const iv = ch.interval;
  const base = `${API_URL}/api/ibo`;
  const fetchKey = `ibo:bootstrap:${sym}:${iv}`;
  const run = async () => {
    const [cRes, obRes, tkRes] = await Promise.all([
      fetchWithTimeout(`${base}/candles?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}&limit=200`),
      fetchWithTimeout(`${base}/orderbook?symbol=${encodeURIComponent(sym)}`),
      fetchWithTimeout(`${base}/ticker?symbol=${encodeURIComponent(sym)}`),
    ]);
    if (cRes) {
      const cData = await cRes.json();
      const rows = normalizeKlines(cData);
      if (rows.length) publishCandles(ch, rows, true);
    }
    if (obRes) {
      const obData = await obRes.json();
      const ob = normalizeOrderBook(obData);
      if (orderBookHasDepth(ob)) scheduleOb(ch, ob);
    }
    if (tkRes) {
      const tkData = await tkRes.json();
      if (tkData && typeof tkData === 'object') publishTicker(ch, tkData as Record<string, unknown>);
    }
  };
  try {
    const existing = inFlight.get(fetchKey);
    if (existing) await existing;
    else {
      const p = run().finally(() => inFlight.delete(fetchKey));
      inFlight.set(fetchKey, p);
      await p;
    }
  } catch {
    ch.error = 'Failed to load MXB market data';
  } finally {
    ch.loading = false;
    notifyStatus(ch);
  }
}

function handleWsMessage(ch: IboChannel, msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'snapshot': {
      const rows = normalizeKlines(msg.candles);
      if (rows.length) publishCandles(ch, rows, true);
      if (msg.orderbook) {
        scheduleOb(ch, normalizeOrderBook(msg.orderbook));
      }
      if (msg.ticker && typeof msg.ticker === 'object') {
        publishTicker(ch, msg.ticker as Record<string, unknown>);
      }
      ch.loading = false;
      notifyStatus(ch);
      break;
    }
    case 'candle': {
      if (!msg.candle || typeof msg.candle !== 'object') break;
      const c = msg.candle as Kline;
      const merged = mergeCandle(ch.candles, c);
      publishCandles(ch, merged, true);
      break;
    }
    case 'ticker':
      publishTicker(ch, msg);
      break;
    case 'orderbook':
      scheduleOb(ch, normalizeOrderBook({ bids: msg.bids, asks: msg.asks }));
      break;
    case 'ping':
      break;
    default:
      break;
  }
}

function scheduleReconnect(ch: IboChannel): void {
  if (ch.noRetry) return;
  ch.retryCount += 1;
  const delay = Math.min(30_000, 1_000 * 2 ** (ch.retryCount - 1));
  if (ch.retryTimer) clearTimeout(ch.retryTimer);
  ch.retryTimer = setTimeout(() => {
    ch.retryTimer = null;
    void bootstrapChannel(ch).then(() => ensureWs(ch));
  }, delay);
}

function ensureWs(ch: IboChannel): void {
  if (ch.subscribed || ch.noRetry) return;
  ch.subscribed = true;
  const url = exchangeWsPath(
    `/api/ws/ibo-market?symbol=${encodeURIComponent(ch.symbol)}&interval=${encodeURIComponent(ch.interval)}`,
  );
  const wsKey = `ibo:${ch.symbol}:${ch.interval}`;
  ch.wsUnsub = wsManager.subscribe(wsKey, url, (raw) => {
    const msg = raw as Record<string, unknown>;
    if (!msg || typeof msg !== 'object') return;
    handleWsMessage(ch, msg);
  }, { heartbeat: true });

  ch.connected = true;
  ch.error = null;
  notifyStatus(ch);
}

function hasListeners(ch: IboChannel): boolean {
  return ch.obListeners.size > 0
    || ch.tickerListeners.size > 0
    || ch.candleListeners.size > 0
    || ch.statusListeners.size > 0;
}

function scheduleIdleDisconnect(key: string): void {
  const ch = channels.get(key);
  if (!ch || hasListeners(ch)) return;
  if (ch.idleTimer) clearTimeout(ch.idleTimer);
  ch.idleTimer = setTimeout(() => {
    const current = channels.get(key);
    if (!current || hasListeners(current)) return;
    current.wsUnsub?.();
    current.wsUnsub = null;
    current.subscribed = false;
    current.connected = false;
    if (current.retryTimer) clearTimeout(current.retryTimer);
    if (current.obTimer) clearTimeout(current.obTimer);
    channels.delete(key);
  }, IDLE_DISCONNECT_MS);
}

function getOrCreateChannel(symbol: string, interval = DEFAULT_INTERVAL): IboChannel {
  const sym = symKey(symbol);
  const iv = String(interval || DEFAULT_INTERVAL).toLowerCase();
  const key = channelKey(sym, iv);
  let ch = channels.get(key);
  if (!ch) {
    ch = {
      symbol: sym,
      interval: iv,
      obListeners: new Set(),
      tickerListeners: new Set(),
      candleListeners: new Set(),
      statusListeners: new Set(),
      idleTimer: null,
      wsUnsub: null,
      subscribed: false,
      loading: false,
      connected: false,
      error: null,
      noRetry: false,
      retryCount: 0,
      retryTimer: null,
      candles: [],
      pendingOb: null,
      obTimer: null,
    };
    channels.set(key, ch);
  }
  return ch;
}

function attachChannel(ch: IboChannel): void {
  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }
  if (!ch.subscribed && !ch.loading) {
    void bootstrapChannel(ch).then(() => ensureWs(ch));
  } else {
    ensureWs(ch);
  }
}

function detachChannel(key: string, ch: IboChannel): void {
  if (hasListeners(ch)) return;
  scheduleIdleDisconnect(key);
}

export async function fetchIboCandles(
  symbol: string,
  interval: string,
  limit = 200,
): Promise<Kline[]> {
  const sym = symKey(symbol);
  const iv = String(interval || DEFAULT_INTERVAL).toLowerCase();
  const url = `${API_URL}/api/ibo/candles?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res) return readKlinesCache(klinesCacheKey(sym, iv)) ?? [];
  const data = await res.json();
  const rows = normalizeKlines(data);
  if (rows.length) writeKlinesCache(klinesCacheKey(sym, iv), rows);
  return rows;
}

export function subscribeIboOrderBook(symbol: string, listener: ObListener): () => void {
  const ch = getOrCreateChannel(symbol);
  const key = channelKey(ch.symbol, ch.interval);
  ch.obListeners.add(listener);
  attachChannel(ch);

  const cached = getCachedOrderBook(ch.symbol);
  if (cached && orderBookHasDepth(cached)) listener(cached);

  return () => {
    ch.obListeners.delete(listener);
    detachChannel(key, ch);
  };
}

export function subscribeIboTicker(symbol: string, listener: TickerListener): () => void {
  const ch = getOrCreateChannel(symbol);
  const key = channelKey(ch.symbol, ch.interval);
  ch.tickerListeners.add(listener);
  attachChannel(ch);
  return () => {
    ch.tickerListeners.delete(listener);
    detachChannel(key, ch);
  };
}

export function subscribeIboCandles(
  symbol: string,
  interval: string,
  listener: CandleListener,
): () => void {
  const ch = getOrCreateChannel(symbol, interval);
  const key = channelKey(ch.symbol, ch.interval);
  ch.candleListeners.add(listener);
  attachChannel(ch);

  const cached = readKlinesCache(klinesCacheKey(ch.symbol, ch.interval));
  if (cached?.length) listener(cached);
  else if (ch.candles.length) listener(ch.candles);

  return () => {
    ch.candleListeners.delete(listener);
    detachChannel(key, ch);
  };
}

export function subscribeIboMarketStatus(
  symbol: string,
  interval: string,
  listener: StatusListener,
): () => void {
  const ch = getOrCreateChannel(symbol, interval);
  const key = channelKey(ch.symbol, ch.interval);
  ch.statusListeners.add(listener);
  listener({ connected: ch.connected, error: ch.error, loading: ch.loading });
  attachChannel(ch);
  return () => {
    ch.statusListeners.delete(listener);
    detachChannel(key, ch);
  };
}

export function prefetchIboMarket(symbol: string, interval = DEFAULT_INTERVAL): void {
  const ch = getOrCreateChannel(symbol, interval);
  attachChannel(ch);
}

export function setIboFatalError(symbol: string, code: number, interval = DEFAULT_INTERVAL): void {
  const ch = getOrCreateChannel(symbol, interval);
  ch.noRetry = true;
  ch.connected = false;
  if (code === 4403) {
    ch.error = 'MXB mock market is disabled on the server (IBO_MOCK_MARKET=true needed).';
  } else if (code === 4400) {
    ch.error = `Unsupported MXB market symbol: ${ch.symbol}`;
  }
  notifyStatus(ch);
}
