/**
 * Direct Binance public WebSocket feeds — same strategy as maxByte-exchange
 * FuturesContext (miniTicker) and faster than backend-proxied REST/WS for
 * standard USDT pairs.
 *
 * Used for: spot depth (~100ms), live klines, futures index reference prices.
 */
import { wsManager } from './websocket.service';
import { isIboMockMarketSymbol, isInternalMockUsdtPair } from '../utils/tradeSymbols';
import { normalizeOrderBook } from '../utils/orderbook';
import type { OrderBook, Kline } from '../types/market.types';

const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';

type DepthListener = (book: OrderBook) => void;
type KlineListener = (kline: Kline) => void;
type IndexListener = (price: number) => void;

interface ListenerChannel<T> {
  listeners: Set<T>;
  wsUnsub: (() => void) | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const IDLE_DISCONNECT_MS = 45_000;
const INDEX_FLUSH_MS = 300;

const depthChannels = new Map<string, ListenerChannel<DepthListener>>();
const klineChannels = new Map<string, ListenerChannel<KlineListener>>();
const indexChannels = new Map<string, ListenerChannel<IndexListener>>();

/** Standard spot symbol on Binance (not IBO synthetic / mock pairs). */
export function isBinanceSpotSymbol(symbol: string): boolean {
  const sym = String(symbol || '').toUpperCase().replace(/-PERP$/i, '').replace(/-OPTIONS$/i, '');
  if (!sym.endsWith('USDT')) return false;
  return !isIboMockMarketSymbol(sym) && !isInternalMockUsdtPair(sym);
}

export function toBinanceStreamSymbol(symbol: string): string {
  return String(symbol || '')
    .toUpperCase()
    .replace(/-PERP$/i, '')
    .replace(/-OPTIONS$/i, '')
    .replace(/[^A-Z0-9]/g, '')
    .toLowerCase();
}

function scheduleIdle<T>(
  map: Map<string, ListenerChannel<T>>,
  key: string,
  disconnect: () => void,
): void {
  const ch = map.get(key);
  if (!ch || ch.listeners.size > 0) return;
  if (ch.idleTimer) clearTimeout(ch.idleTimer);
  ch.idleTimer = setTimeout(() => {
    const current = map.get(key);
    if (!current || current.listeners.size > 0) return;
    disconnect();
    map.delete(key);
  }, IDLE_DISCONNECT_MS);
}

function parseBinanceDepth(msg: unknown, symbol: string): OrderBook | null {
  const m = msg as { bids?: unknown[]; asks?: unknown[]; b?: unknown[]; a?: unknown[] };
  const bids = m.bids ?? m.b;
  const asks = m.asks ?? m.a;
  if (!Array.isArray(bids) || !Array.isArray(asks)) return null;
  return normalizeOrderBook({ bids, asks, symbol });
}

function parseBinanceKline(msg: unknown): Kline | null {
  const m = msg as { k?: Record<string, unknown> };
  const k = m.k;
  if (!k) return null;
  const t = Number(k.t ?? k.T ?? 0);
  if (!Number.isFinite(t) || t <= 0) return null;
  const time = t > 1e12 ? Math.floor(t / 1000) : t;
  const open = Number(k.o ?? 0);
  const high = Number(k.h ?? 0);
  const low = Number(k.l ?? 0);
  const close = Number(k.c ?? 0);
  const volume = Number(k.v ?? 0);
  if (!Number.isFinite(close)) return null;
  return { time, open, high, low, close, volume };
}

function ensureDepthWs(key: string, binSym: string, displaySym: string): void {
  let ch = depthChannels.get(key);
  if (!ch) {
    ch = { listeners: new Set(), wsUnsub: null, idleTimer: null };
    depthChannels.set(key, ch);
  }
  if (ch.wsUnsub) return;

  const url = `${BINANCE_WS_BASE}/${binSym}@depth20@100ms`;
  const wsKey = `binance:depth:${key}`;
  ch.wsUnsub = wsManager.subscribe(
    wsKey,
    url,
    (msg) => {
      const book = parseBinanceDepth(msg, displaySym);
      if (!book) return;
      ch!.listeners.forEach((fn) => fn(book));
    },
    { heartbeat: false },
  );
}

/** Live spot depth — ~100ms updates from Binance (standard USDT pairs only). */
export function subscribeBinanceDepth(symbol: string, listener: DepthListener): () => void {
  const displaySym = String(symbol || '').toUpperCase().replace(/-PERP$/i, '');
  if (!isBinanceSpotSymbol(displaySym)) return () => {};

  const key = displaySym;
  const binSym = toBinanceStreamSymbol(displaySym);
  let ch = depthChannels.get(key);
  if (!ch) {
    ch = { listeners: new Set(), wsUnsub: null, idleTimer: null };
    depthChannels.set(key, ch);
  }

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.listeners.add(listener);
  ensureDepthWs(key, binSym, displaySym);

  return () => {
    ch!.listeners.delete(listener);
    if (ch!.listeners.size === 0) {
      scheduleIdle(depthChannels, key, () => {
        ch!.wsUnsub?.();
        ch!.wsUnsub = null;
      });
    }
  };
}

function ensureKlineWs(key: string, binSym: string, interval: string): void {
  let ch = klineChannels.get(key);
  if (!ch) {
    ch = { listeners: new Set(), wsUnsub: null, idleTimer: null };
    klineChannels.set(key, ch);
  }
  if (ch.wsUnsub) return;

  const url = `${BINANCE_WS_BASE}/${binSym}@kline_${interval}`;
  const wsKey = `binance:kline:${key}`;
  ch.wsUnsub = wsManager.subscribe(
    wsKey,
    url,
    (msg) => {
      const kline = parseBinanceKline(msg);
      if (!kline) return;
      ch!.listeners.forEach((fn) => fn(kline));
    },
    { heartbeat: false },
  );
}

/** Live candle updates from Binance (replaces missing /api/ws/exchange/klines). */
export function subscribeBinanceKline(
  symbol: string,
  interval: string,
  listener: KlineListener,
): () => void {
  const displaySym = String(symbol || '').toUpperCase().replace(/-PERP$/i, '');
  if (!isBinanceSpotSymbol(displaySym)) return () => {};

  const key = `${displaySym}|${interval}`;
  const binSym = toBinanceStreamSymbol(displaySym);
  let ch = klineChannels.get(key);
  if (!ch) {
    ch = { listeners: new Set(), wsUnsub: null, idleTimer: null };
    klineChannels.set(key, ch);
  }

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.listeners.add(listener);
  ensureKlineWs(key, binSym, interval);

  return () => {
    ch!.listeners.delete(listener);
    if (ch!.listeners.size === 0) {
      scheduleIdle(klineChannels, key, () => {
        ch!.wsUnsub?.();
        ch!.wsUnsub = null;
      });
    }
  };
}

function ensureIndexWs(key: string, binSym: string): void {
  let ch = indexChannels.get(key);
  if (!ch) {
    ch = { listeners: new Set(), wsUnsub: null, idleTimer: null };
    indexChannels.set(key, ch);
  }
  if (ch.wsUnsub) return;

  const url = `${BINANCE_WS_BASE}/${binSym}@miniTicker`;
  const wsKey = `binance:index:${key}`;
  let pendingPrice = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    const px = pendingPrice;
    pendingPrice = 0;
    if (px <= 0) return;
    ch!.listeners.forEach((fn) => fn(px));
  };

  ch.wsUnsub = wsManager.subscribe(
    wsKey,
    url,
    (msg) => {
      const m = msg as { c?: string };
      const price = parseFloat(String(m.c ?? ''));
      if (!Number.isFinite(price) || price <= 0) return;
      pendingPrice = price;
      if (!flushTimer) flushTimer = setTimeout(flush, INDEX_FLUSH_MS);
    },
    { heartbeat: false },
  );
}

/**
 * Sub-second spot index for futures headers — mirrors web FuturesContext
 * Binance miniTicker overlay (BTCUSDT-PERP → btcusdt@miniTicker).
 */
export function subscribeBinanceSpotIndex(
  futuresOrSpotSymbol: string,
  listener: IndexListener,
): () => void {
  const spotSym = String(futuresOrSpotSymbol || '')
    .toUpperCase()
    .replace(/-PERP$/i, '')
    .replace(/-OPTIONS$/i, '');
  if (!isBinanceSpotSymbol(spotSym)) return () => {};

  const key = spotSym;
  const binSym = toBinanceStreamSymbol(spotSym);
  let ch = indexChannels.get(key);
  if (!ch) {
    ch = { listeners: new Set(), wsUnsub: null, idleTimer: null };
    indexChannels.set(key, ch);
  }

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.listeners.add(listener);
  ensureIndexWs(key, binSym);

  return () => {
    ch!.listeners.delete(listener);
    if (ch!.listeners.size === 0) {
      scheduleIdle(indexChannels, key, () => {
        ch!.wsUnsub?.();
        ch!.wsUnsub = null;
      });
    }
  };
}
