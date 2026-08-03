import type { Kline } from '../types/market.types';
import { readSymbolKlines } from './klinesCache';
import {
  CHART_FULL_INTERVALS,
  CHART_KLINE_LIMITS,
} from '../components/trading/chartIntervals';

/** Default candlestick interval on the chart page. */
export const CHART_DEFAULT_INTERVAL = '1h';

/** All intervals prefetched for the chart page. */
export const CHART_KLINE_INTERVALS = CHART_FULL_INTERVALS;

export { CHART_KLINE_LIMITS };

export function instantChartKlines(symbol: string, interval = CHART_DEFAULT_INTERVAL): Kline[] {
  return readSymbolKlines(symbol, interval);
}

export function instantPulseKlines(symbol: string): Kline[] {
  return readSymbolKlines(symbol, '15m');
}
