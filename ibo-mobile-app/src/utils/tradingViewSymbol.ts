import { toExchangeSymbol, isIboMockMarketSymbol, isInternalMockUsdtPair } from './tradeSymbols';

/** Intervals shown in the full chart panel (maps to TradingView widget codes). */
export const CHART_INTERVALS = [
  { key: '1m', label: '1m', tv: '1' },
  { key: '3m', label: '3m', tv: '3' },
  { key: '5m', label: '5m', tv: '5' },
  { key: '15m', label: '15m', tv: '15' },
  { key: '30m', label: '30m', tv: '30' },
  { key: '1h', label: '1H', tv: '60' },
  { key: '2h', label: '2H', tv: '120' },
  { key: '4h', label: '4H', tv: '240' },
  { key: '6h', label: '6H', tv: '360' },
  { key: '12h', label: '12H', tv: '720' },
  { key: '1d', label: '1D', tv: 'D' },
  { key: '1w', label: '1W', tv: 'W' },
] as const;

export type ChartIntervalKey = (typeof CHART_INTERVALS)[number]['key'];

export const DEFAULT_CHART_INTERVAL: ChartIntervalKey = '1h';

export function tvIntervalFromKey(key: ChartIntervalKey): string {
  return CHART_INTERVALS.find((i) => i.key === key)?.tv ?? '60';
}

export function priceChartIntervalFromKey(key: ChartIntervalKey): '15m' | '1h' | '4h' | '1d' | '1w' {
  if (key === '1w') return '1w';
  if (key === '1d' || key === '12h' || key === '6h') return '1d';
  if (key === '4h' || key === '2h') return '4h';
  if (key === '15m' || key === '30m' || key === '5m' || key === '3m' || key === '1m') return '15m';
  return '1h';
}

/** Map exchange symbol → TradingView symbol (Binance feed). Null = use native candle fallback. */
export function toTradingViewSymbol(symbol: string): string | null {
  const s = toExchangeSymbol(symbol);
  if (!s || isIboMockMarketSymbol(s) || isInternalMockUsdtPair(s)) return null;
  if (s === 'IBOUSDT') return null;
  if (s.endsWith('USDT') && s.length > 4) {
    const base = s.slice(0, -4);
    if (!base || base.length > 12) return null;
    return `BINANCE:${base}USDT`;
  }
  if (s.endsWith('BUSD') && s.length > 4) {
    const base = s.slice(0, -4);
    return `BINANCE:${base}BUSD`;
  }
  return null;
}
