/** Shared candle intervals for TradingView charts. */
export const CHART_PREVIEW_INTERVALS = ['1m', '5m', '15m', '1h', '4h'] as const;

/** Extra height for the timeframe row above trade / futures mini charts. */
export const CHART_INTERVAL_TOOLBAR_H = 36;

/** Indicator tab row height (TradingView-style Indicators control). */
export const CHART_MINI_INDICATOR_BAR_H = 28;

/** Total mini-chart panel height (timeframe row + chart body). Indicators sit in the timeframe row. */
export const TRADE_CHART_PANEL_H = 236 + CHART_INTERVAL_TOOLBAR_H;
export const CHART_FULL_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;

export type ChartInterval = (typeof CHART_FULL_INTERVALS)[number];

export const CHART_KLINE_LIMITS: Record<ChartInterval, number> = {
  '1m': 120,
  '5m': 100,
  '15m': 80,
  '1h': 80,
  '4h': 72,
  '1d': 60,
  '1w': 52,
};

export function isChartInterval(v: string): v is ChartInterval {
  return (CHART_FULL_INTERVALS as readonly string[]).includes(v);
}
