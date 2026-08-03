import {
  toExchangeSymbol,
  isInternalMockUsdtPair,
  isIboMockMarketSymbol,
} from './tradeSymbols';
import { isChartInterval, type ChartInterval } from '../components/trading/chartIntervals';

/** Binance feed mapping for real USDT spot pairs (not IBO mock markets). */
const TV_SYMBOLS: Record<string, string> = {
  BTCUSDT: 'BINANCE:BTCUSDT',
  ETHUSDT: 'BINANCE:ETHUSDT',
  BNBUSDT: 'BINANCE:BNBUSDT',
  SOLUSDT: 'BINANCE:SOLUSDT',
  XRPUSDT: 'BINANCE:XRPUSDT',
  DOGEUSDT: 'BINANCE:DOGEUSDT',
  ADAUSDT: 'BINANCE:ADAUSDT',
  POLUSDT: 'BINANCE:POLUSDT',
  AVAXUSDT: 'BINANCE:AVAXUSDT',
  DOTUSDT: 'BINANCE:DOTUSDT',
  LINKUSDT: 'BINANCE:LINKUSDT',
  LTCUSDT: 'BINANCE:LTCUSDT',
};

/** IBO mock + internal demo pairs use exchange candles, not TradingView embed. */
export function canUseTradingViewWidget(symbol: string): boolean {
  return !isInternalMockUsdtPair(symbol) && !isIboMockMarketSymbol(symbol);
}

/** Resolve API symbol → TradingView widget symbol (real Binance USDT pairs only). */
export function resolveTradingViewWidgetSymbol(symbol: string): string {
  const sym = toExchangeSymbol(symbol);

  if (isIboMockMarketSymbol(sym) || isInternalMockUsdtPair(sym)) {
    return '';
  }

  if (TV_SYMBOLS[sym]) return TV_SYMBOLS[sym];

  if (sym.endsWith('USDT') && sym.length > 4) {
    return `BINANCE:${sym}`;
  }

  return 'BINANCE:BTCUSDT';
}

const INTERVAL_TO_TV: Record<ChartInterval, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

export function chartIntervalToTvInterval(interval: string): string {
  if (isChartInterval(interval)) return INTERVAL_TO_TV[interval];
  return '60';
}
