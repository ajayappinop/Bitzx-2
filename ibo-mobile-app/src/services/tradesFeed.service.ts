/**
 * Recent trades feed — WS-first with parallel REST seed.
 * Mirrors maxByte-exchange: wss://host/api/ws/exchange/trades?symbol=BTCUSDT&limit=40
 */
import { API_URL } from '../config/env';
import { exchangeWsPath } from '../config/wsConfig';
import { EP } from '../api/endpoints';
import { wsManager } from './websocket.service';
import {
  normalizeRecentTrades,
  tradeIsBuy,
  tradeQty,
  tradeTimeMs,
} from '../utils/marketData';
import {
  readChartTrades,
  writeChartTrades,
  chartTradesAgeMs,
  CHART_PAGE_SOFT_TTL_MS,
  type ChartTradeSnapshot,
} from '../utils/chartPageCache';

type TradesListener = (trades: ChartTradeSnapshot[]) => void;

const TRADES_LIMIT = 40;
const IDLE_DISCONNECT_MS = 45_000;
const FETCH_TIMEOUT_MS = 8_000;
const inFlight = new Map<string, Promise<ChartTradeSnapshot[] | null>>();

interface Channel {
  symbol: string;
  wsUrl: string;
  listeners: Set<TradesListener>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  subscribed: boolean;
  wsUnsub: (() => void) | null;
}

const channels = new Map<string, Channel>();

function symKey(symbol: string): string {
  return String(symbol || '').toUpperCase();
}

function mapTrades(rows: ReturnType<typeof normalizeRecentTrades>): ChartTradeSnapshot[] {
  return rows.map((t, i) => ({
    id: String(t.id ?? t.tradeId ?? i),
    price: Number(t.price),
    qty: tradeQty(t),
    timeMs: tradeTimeMs(t),
    buy: tradeIsBuy(t),
  })).filter((t) => Number.isFinite(t.price) && t.price > 0);
}

function publish(channel: Channel, rows: ChartTradeSnapshot[]): void {
  if (!rows.length) return;
  writeChartTrades(channel.symbol, rows);
  channel.listeners.forEach((fn) => fn(rows));
}

function ensureWs(channel: Channel): void {
  if (channel.subscribed) return;
  channel.subscribed = true;
  channel.wsUnsub = wsManager.subscribe(channel.wsUrl, channel.wsUrl, (msg: unknown) => {
    const m = msg as { type?: string; trades?: unknown[] };
    if (m?.type !== 'exchange_trades' || !Array.isArray(m.trades)) return;
    publish(channel, mapTrades(normalizeRecentTrades(m.trades)));
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

async function fetchTrades(symbol: string): Promise<ChartTradeSnapshot[] | null> {
  const sym = symKey(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const qs = new URLSearchParams({ limit: String(TRADES_LIMIT) });
    const res = await fetch(`${API_URL}${EP.TRADING_TRADES(sym)}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = mapTrades(normalizeRecentTrades(data));
    if (rows.length) writeChartTrades(sym, rows);
    return rows.length ? rows : null;
  } catch {
    return readChartTrades(sym);
  } finally {
    clearTimeout(timer);
  }
}

function dedupedFetch(
  key: string,
  fn: () => Promise<ChartTradeSnapshot[] | null>,
): Promise<ChartTradeSnapshot[] | null> {
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
      `/api/ws/exchange/trades?symbol=${encodeURIComponent(sym)}&limit=${TRADES_LIMIT}`,
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

export function subscribeSpotTrades(symbol: string, listener: TradesListener): () => void {
  const sym = symKey(symbol);
  const ch = getOrCreateChannel(sym);

  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }

  ch.listeners.add(listener);
  ensureWs(ch);

  const cached = readChartTrades(sym);
  if (cached?.length) listener(cached);

  const age = chartTradesAgeMs(sym);
  const cacheFresh = cached?.length && age != null && age <= CHART_PAGE_SOFT_TTL_MS;
  if (!cacheFresh) {
    void dedupedFetch(`trades:fetch:${sym}`, () => fetchTrades(sym)).then((rows) => {
      if (rows?.length) listener(rows);
    });
  }

  return () => {
    ch.listeners.delete(listener);
    if (ch.listeners.size === 0) scheduleIdleDisconnect(sym);
  };
}

export function warmSpotTradesWs(symbol: string): void {
  const ch = getOrCreateChannel(symbol);
  if (ch.idleTimer) {
    clearTimeout(ch.idleTimer);
    ch.idleTimer = null;
  }
  ensureWs(ch);
}

export function prefetchSpotTrades(symbol: string, force = false): void {
  const sym = symKey(symbol);
  if (!force) {
    const cached = readChartTrades(sym);
    const age = chartTradesAgeMs(sym);
    if (cached?.length && age != null && age <= CHART_PAGE_SOFT_TTL_MS) return;
  }
  warmSpotTradesWs(sym);
  void dedupedFetch(`trades:fetch:${sym}`, () => fetchTrades(sym));
}

export function prefetchSpotTradesBatch(symbols: string[]): void {
  symbols.forEach((s) => prefetchSpotTrades(s));
}
