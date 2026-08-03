/**
 * Prefetch all chart-page data so ChartScreen opens with cache hits.
 * Safe to call repeatedly — dedupes in-flight requests per symbol.
 */
import { prefetchSymbolKlines } from './klinesFeed.service';
import {
  prefetchSpotOrderBook,
  prefetchFuturesOrderBook,
} from './orderBookFeed.service';
import { prefetchSpotTicker } from './tickerFeed.service';
import { prefetchSpotTrades } from './tradesFeed.service';
import {
  readKlinesCache,
  klinesCacheAgeMs,
  klinesCacheKey,
  KLINES_SOFT_TTL_MS,
} from '../utils/klinesCache';
import { CHART_KLINE_INTERVALS, CHART_KLINE_LIMITS } from '../utils/chartPageBootstrap';
import { toSpotSymbol, toFuturesSymbol } from '../utils/tradeSymbols';
import type { TradeMarketType } from '../components/trading/TradeMarketHeader';

const KLINES_PREFETCH = CHART_KLINE_INTERVALS.map((interval) => ({
  interval,
  limit: CHART_KLINE_LIMITS[interval] ?? 80,
}));

function prefetchKlines(sym: string, interval: string, limit: number): void {
  const cacheKey = klinesCacheKey(sym, interval);
  const age = klinesCacheAgeMs(cacheKey);
  if (readKlinesCache(cacheKey)?.length && age != null && age <= KLINES_SOFT_TTL_MS) return;
  prefetchSymbolKlines(sym, interval, limit);
}

function prefetchTicker(sym: string): void {
  prefetchSpotTicker(sym);
}

function prefetchTrades(sym: string): void {
  prefetchSpotTrades(sym);
}

/** Warm caches for the full chart page (klines, ticker, trades, order book). */
export function prefetchChartPageData(
  symbol: string,
  market: TradeMarketType = 'spot',
): void {
  const spot = toSpotSymbol(symbol);
  const futures = toFuturesSymbol(symbol);

  prefetchSpotOrderBook(spot, true);
  prefetchFuturesOrderBook(futures);

  KLINES_PREFETCH.forEach(({ interval, limit }) => {
    prefetchKlines(spot, interval, limit);
  });

  prefetchTicker(spot);
  prefetchTrades(spot);
}
