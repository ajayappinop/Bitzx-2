import type { Ticker, MarketRow, OrderBook } from '../types/market.types';
import type { ExchangeTradeRow } from './marketData';
import { parseMarketNum } from './markets';
import { setCachedOrderBook, orderBookHasDepth } from './orderBookCache';

export type ChartTradeSnapshot = {
  id: string;
  price: number;
  qty: number;
  timeMs: number;
  buy: boolean;
};

type TickerEntry = { data: Ticker; fetchedAt: number };
type TradesEntry = { rows: ChartTradeSnapshot[]; fetchedAt: number };

const tickerStore = new Map<string, TickerEntry>();
const tradesStore = new Map<string, TradesEntry>();

function symKey(symbol: string): string {
  return String(symbol || '').toUpperCase();
}

export function readChartTicker(symbol: string): Ticker | null {
  const hit = tickerStore.get(symKey(symbol));
  return hit?.data ?? null;
}

export function writeChartTicker(symbol: string, data: Ticker): void {
  tickerStore.set(symKey(symbol), { data, fetchedAt: Date.now() });
}

export function readChartTrades(symbol: string): ChartTradeSnapshot[] | null {
  const hit = tradesStore.get(symKey(symbol));
  return hit?.rows?.length ? hit.rows : null;
}

export function writeChartTrades(symbol: string, rows: ChartTradeSnapshot[]): void {
  if (!rows.length) return;
  tradesStore.set(symKey(symbol), { rows, fetchedAt: Date.now() });
}

export function chartTickerAgeMs(symbol: string): number | null {
  const hit = tickerStore.get(symKey(symbol));
  if (!hit) return null;
  return Date.now() - hit.fetchedAt;
}

export function chartTradesAgeMs(symbol: string): number | null {
  const hit = tradesStore.get(symKey(symbol));
  if (!hit) return null;
  return Date.now() - hit.fetchedAt;
}

export const CHART_PAGE_SOFT_TTL_MS = 90_000;

export function tickerFromMarketRow(symbol: string, row: MarketRow): Ticker {
  return {
    symbol,
    price: row.last_price,
    change: row.price_change_24h,
    changePct: row.price_change_pct_24h,
    volume: row.volume_24h,
    high: row.high_24h ?? 0,
    low: row.low_24h ?? 0,
  };
}

/** Best available ticker: cache → Redux market row. */
export function resolveChartTicker(
  symbol: string,
  marketRow?: MarketRow | null,
): Ticker | null {
  const cached = readChartTicker(symbol);
  if (cached) return cached;
  if (marketRow && parseMarketNum(marketRow.last_price) > 0) {
    return tickerFromMarketRow(symbol, marketRow);
  }
  return null;
}

/** Build a ticker snapshot from a WS / REST payload. */
export function tickerFromPayload(
  symbol: string,
  raw: Record<string, unknown>,
): Ticker {
  return {
    symbol: String(raw.symbol ?? symbol),
    price: (raw.price ?? raw.last_price ?? 0) as number | string,
    change: (raw.priceChange ?? raw.change ?? raw.price_change_24h ?? 0) as number | string,
    changePct: (raw.priceChangePercent ?? raw.changePct ?? raw.price_change_pct_24h ?? 0) as number | string,
    volume: (raw.volume ?? raw.volume_24h ?? 0) as number | string,
    high: (raw.highPrice ?? raw.high_24h ?? raw.high ?? 0) as number | string,
    low: (raw.lowPrice ?? raw.low_24h ?? raw.low ?? 0) as number | string,
  };
}

/**
 * Synchronously warm caches before chart hooks read them (route seeds + Redux row).
 * Safe to call when symbol or seeds change.
 */
export function bootstrapChartPageCaches(opts: {
  spotSym: string;
  seedTicker?: Record<string, unknown> | null;
  seedOrderBook?: OrderBook | null;
  marketRow?: MarketRow | null;
}): void {
  const { spotSym, seedTicker, seedOrderBook, marketRow } = opts;

  if (seedOrderBook && orderBookHasDepth(seedOrderBook)) {
    setCachedOrderBook(spotSym, seedOrderBook);
  }

  if (seedTicker) {
    writeChartTicker(spotSym, tickerFromPayload(spotSym, seedTicker));
    return;
  }

  if (!readChartTicker(spotSym) && marketRow && parseMarketNum(marketRow.last_price) > 0) {
    writeChartTicker(spotSym, tickerFromMarketRow(spotSym, marketRow));
  }
}

export function tradesFromExchangeRows(
  rows: ExchangeTradeRow[],
  mapBuy: (t: ExchangeTradeRow) => boolean,
  mapQty: (t: ExchangeTradeRow) => number,
  mapTime: (t: ExchangeTradeRow) => number,
): ChartTradeSnapshot[] {
  return rows
    .map((t, i) => ({
      id: String(t.id ?? t.tradeId ?? i),
      price: Number(t.price),
      qty: mapQty(t),
      timeMs: mapTime(t),
      buy: mapBuy(t),
    }))
    .filter((t) => Number.isFinite(t.price) && t.price > 0);
}
