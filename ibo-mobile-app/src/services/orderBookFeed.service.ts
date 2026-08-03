/**
 * Fast order-book feed — WS-first with parallel public REST seed.
 * Keeps WS channels warm briefly after unsubscribe so symbol switches feel instant.
 */
import { API_URL } from '../config/env';
import { exchangeWsPath, futuresWsUrl } from '../config/wsConfig';
import { EP } from '../api/endpoints';
import { wsManager } from './websocket.service';
import {
  isBinanceSpotSymbol,
  subscribeBinanceDepth,
} from './binancePublicFeed.service';
import type { OrderBook } from '../types/market.types';
import { normalizeOrderBook } from '../utils/orderbook';
import { extractFuturesMarkPayload } from '../utils/futuresQuotes';
import {
  getCachedOrderBook,
  setCachedOrderBook,
  orderBookHasDepth,
} from '../utils/orderBookCache';
import { isIboMockMarketSymbol } from '../utils/tradeSymbols';
import { prefetchIboMarket, subscribeIboOrderBook } from './iboMarketFeed.service';

type BookListener = (book: OrderBook) => void;

/** Match maxByte-exchange OrderBook.jsx API_LIMIT. */
const SPOT_LIMIT = 100;
const IDLE_DISCONNECT_MS = 45_000;
/** Order-book REST seed — fail fast so symbol switches don't hang on a slow proxy. */
const ORDERBOOK_FETCH_TIMEOUT_MS = 8_000;
/** Coalesce WS book pushes — cache updates immediately, listeners at most every 50ms. */
const BOOK_PUBLISH_COALESCE_MS = 50;
const inFlight = new Map<string, Promise<OrderBook | null>>();

export type FuturesMarketMeta = {
  mark: number;
  index: number;
  recentTrades: unknown[];
};

type FuturesMetaListener = (meta: FuturesMarketMeta) => void;

interface Channel {
  symbol: string;
  wsUrl: string;
  listeners: Set<BookListener>;
  metaListeners: Set<FuturesMetaListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  wsHandler: (msg: unknown) => void;
  subscribed: boolean;
  wsUnsub: (() => void) | null;
  kind: 'spot' | 'futures';
  /** Coalesce rapid WS ticks — mirrors web FuturesContext 300ms flush pattern. */
  pendingBook: OrderBook | null;
  publishTimer: ReturnType<typeof setTimeout> | null;
  /** Direct Binance depth (~100ms) for standard USDT pairs. */
  binanceUnsub: (() => void) | null;
}

const channels = new Map<string, Channel>();

function cacheKey(symbol: string): string {
  return String(symbol || '').toUpperCase();
}

function channelKey(kind: 'spot' | 'futures', symbol: string): string {
  return `${kind}:${cacheKey(symbol)}`;
}

function flushBookListeners(channel: Channel): void {
  channel.publishTimer = null;
  const book = channel.pendingBook;
  if (!book) return;
  channel.pendingBook = null;
  channel.listeners.forEach((fn) => fn(book));
}

function publish(channel: Channel, book: OrderBook): void {
  if (!orderBookHasDepth(book)) return;
  setCachedOrderBook(channel.symbol, book);
  channel.pendingBook = book;
  if (channel.publishTimer) return;
  channel.publishTimer = setTimeout(
    () => flushBookListeners(channel),
    BOOK_PUBLISH_COALESCE_MS,
  );
}

/** Push latest book to listeners immediately (subscribe / REST seed). */
function publishImmediate(channel: Channel, book: OrderBook): void {
  if (!orderBookHasDepth(book)) return;
  setCachedOrderBook(channel.symbol, book);
  channel.pendingBook = null;
  if (channel.publishTimer) {
    clearTimeout(channel.publishTimer);
    channel.publishTimer = null;
  }
  channel.listeners.forEach((fn) => fn(book));
}

function spotWsHandler(channel: Channel): (msg: unknown) => void {
  return (msg: unknown) => {
    const m = msg as { type?: string; book?: unknown };
    if (m?.type !== 'exchange_orderbook' || !m.book) return;
    publish(channel, normalizeOrderBook(m.book));
  };
}

function publishFuturesMeta(channel: Channel, msg: Record<string, unknown>): void {
  if (!channel.metaListeners.size) return;
  const markSnap = msg.mark && typeof msg.mark === 'object' ? msg.mark : null;
  const { mark, index } = markSnap
    ? extractFuturesMarkPayload(markSnap)
    : { mark: 0, index: 0 };
  const meta: FuturesMarketMeta = {
    mark,
    index,
    recentTrades: Array.isArray(msg.recent_trades) ? msg.recent_trades : [],
  };
  channel.metaListeners.forEach((fn) => fn(meta));
}

function futuresWsHandler(channel: Channel): (msg: unknown) => void {
  return (msg: unknown) => {
    const m = msg as {
      type?: string;
      symbol?: string;
      book?: unknown;
      mark?: unknown;
      recent_trades?: unknown[];
    };
    if (m?.type !== 'futures_orderbook') return;
    if (m.symbol && m.symbol !== channel.symbol) return;
    if (m.book) publish(channel, normalizeOrderBook(m.book));
    publishFuturesMeta(channel, m as Record<string, unknown>);
  };
}

function ensureWs(channel: Channel): void {
  if (channel.subscribed) return;
  channel.subscribed = true;
  channel.wsUnsub = wsManager.subscribe(channel.wsUrl, channel.wsUrl, channel.wsHandler);
}

function ensureBinanceDepth(channel: Channel): void {
  if (channel.kind !== 'spot' || channel.binanceUnsub) return;
  if (!isBinanceSpotSymbol(channel.symbol)) return;
  channel.binanceUnsub = subscribeBinanceDepth(channel.symbol, (book) => {
    publish(channel, book);
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
    current.binanceUnsub?.();
    current.binanceUnsub = null;
    current.subscribed = false;
    channels.delete(key);
  }, IDLE_DISCONNECT_MS);
}

async function fetchWithTimeout(url: string, timeoutMs = ORDERBOOK_FETCH_TIMEOUT_MS): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

async function fetchSpotOrderBook(symbol: string, limit = SPOT_LIMIT): Promise<OrderBook | null> {
  const key = cacheKey(symbol);
  const url = `${API_URL}${EP.TRADING_ORDERBOOK(key)}?limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;
  try {
    const data = await res.json();
    const book = normalizeOrderBook((data as { book?: unknown })?.book ?? data);
    if (orderBookHasDepth(book)) setCachedOrderBook(key, book);
    return book;
  } catch {
    return null;
  }
}

async function fetchFuturesOrderBook(symbol: string, depth = 25): Promise<OrderBook | null> {
  const key = cacheKey(symbol);
  const qs = new URLSearchParams({ symbol: key, depth: String(depth) });
  const url = `${API_URL}${EP.FUTURES_ORDERBOOK}?${qs.toString()}`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;
  try {
    const data = await res.json();
    const book = normalizeOrderBook((data as { book?: unknown })?.book ?? data);
    if (orderBookHasDepth(book)) setCachedOrderBook(key, book);
    return book;
  } catch {
    return null;
  }
}

function dedupedFetch(
  key: string,
  fn: () => Promise<OrderBook | null>,
): Promise<OrderBook | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function getOrCreateChannel(kind: 'spot' | 'futures', symbol: string): Channel {
  const sym = cacheKey(symbol);
  const key = channelKey(kind, sym);
  const wsUrl =
    kind === 'spot'
      ? exchangeWsPath(
          `/api/ws/exchange/orderbook?symbol=${encodeURIComponent(sym)}&limit=${SPOT_LIMIT}`,
        )
      : futuresWsUrl(`/ws/futures/orderbook?symbol=${encodeURIComponent(sym)}`);

  let ch = channels.get(key);
  if (!ch) {
    ch = {
      symbol: sym,
      wsUrl,
      listeners: new Set(),
      metaListeners: new Set(),
      idleTimer: null,
      wsHandler: () => {},
      subscribed: false,
      wsUnsub: null,
      kind,
      pendingBook: null,
      publishTimer: null,
      binanceUnsub: null,
    };
    ch.wsHandler = kind === 'spot' ? spotWsHandler(ch) : futuresWsHandler(ch);
    channels.set(key, ch);
  }
  return ch;
}

function subscribe(
  kind: 'spot' | 'futures',
  symbol: string,
  listener: BookListener,
): () => void {
  const sym = cacheKey(symbol);
  const key = channelKey(kind, sym);
  const ch = getOrCreateChannel(kind, sym);

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.listeners.add(listener);
  ensureWs(ch);
  if (kind === 'spot') ensureBinanceDepth(ch);

  const cached = getCachedOrderBook(sym);
  if (cached) publishImmediate(ch, cached);

  const fetchKey = `${kind}:fetch:${sym}`;
  void dedupedFetch(fetchKey, () =>
    kind === 'spot' ? fetchSpotOrderBook(sym) : fetchFuturesOrderBook(sym),
  ).then((book) => {
    if (book) publishImmediate(ch, book);
  });

  return () => {
    ch!.listeners.delete(listener);
    if (ch!.listeners.size === 0 && ch!.metaListeners.size === 0) {
      scheduleIdleDisconnect(key);
    }
  };
}

export function subscribeSpotOrderBook(symbol: string, listener: BookListener): () => void {
  const sym = cacheKey(symbol);
  if (isIboMockMarketSymbol(sym)) {
    return subscribeIboOrderBook(sym, listener);
  }
  return subscribe('spot', symbol, listener);
}

export function subscribeFuturesOrderBook(symbol: string, listener: BookListener): () => void {
  return subscribe('futures', symbol, listener);
}

/** Mark price, index, and recent trades from the shared futures orderbook WS. */
export function subscribeFuturesMarketMeta(
  symbol: string,
  listener: FuturesMetaListener,
): () => void {
  const sym = cacheKey(symbol);
  const key = channelKey('futures', sym);
  const ch = getOrCreateChannel('futures', sym);

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.metaListeners.add(listener);
  ensureWs(ch);

  return () => {
    ch!.metaListeners.delete(listener);
    if (ch!.listeners.size === 0 && ch!.metaListeners.size === 0) {
      scheduleIdleDisconnect(key);
    }
  };
}

export function prefetchSpotOrderBook(symbol: string, force = false): void {
  const sym = cacheKey(symbol);
  if (isIboMockMarketSymbol(sym)) {
    prefetchIboMarket(sym);
    return;
  }
  if (!force && getCachedOrderBook(sym)) return;
  void dedupedFetch(`spot:fetch:${sym}`, () => fetchSpotOrderBook(sym));
}

export function prefetchFuturesOrderBook(symbol: string, force = false): void {
  const sym = cacheKey(symbol);
  if (!force && getCachedOrderBook(sym)) return;
  void dedupedFetch(`futures:fetch:${sym}`, () => fetchFuturesOrderBook(sym));
}

/** Ensure spot depth is warm — used by chart page on mount. */
export function ensureSpotOrderBook(symbol: string): void {
  const sym = cacheKey(symbol);
  const cached = getCachedOrderBook(sym);
  if (cached) return;
  prefetchSpotOrderBook(sym, true);
}

export function prefetchOrderBooks(symbols: string[]): void {
  symbols.forEach((s) => {
    prefetchSpotOrderBook(s);
  });
}

function warmOrderBookWs(kind: 'spot' | 'futures', symbol: string): void {
  const ch = getOrCreateChannel(kind, symbol);
  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }
  ensureWs(ch);
  if (kind === 'spot') ensureBinanceDepth(ch);
}

/** Warm spot and/or futures depth before navigating to a trade screen. */
export function prefetchOrderBookForMarket(
  symbol: string,
  market: 'spot' | 'futures' | 'options',
): void {
  const sym = cacheKey(symbol);
  if (market === 'futures') {
    warmOrderBookWs('futures', sym);
    prefetchFuturesOrderBook(sym, true);
    const spot = sym.replace(/-PERP$/i, '');
    warmOrderBookWs('spot', spot);
    prefetchSpotOrderBook(spot, true);
    return;
  }
  const spot = sym.replace(/-PERP$/i, '').replace(/-OPTIONS$/i, '');
  warmOrderBookWs('spot', spot);
  prefetchSpotOrderBook(spot, true);
}

/** Pre-warm WS + REST for the top N pairs (pair picker / markets list). */
export function prefetchOrderBooksBatch(symbols: string[], market: 'spot' | 'futures' = 'spot'): void {
  symbols.slice(0, 12).forEach((s) => prefetchOrderBookForMarket(s, market));
}
