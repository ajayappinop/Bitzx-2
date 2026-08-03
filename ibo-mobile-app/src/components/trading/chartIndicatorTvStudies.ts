import type { ChartIndicatorId } from './chartIndicators';

/** @deprecated kept for callers; quick chips removed — use Indicators sheet. */
export const MINI_QUICK_INDICATORS: ChartIndicatorId[] = [
  'MA', 'EMA', 'BOLL', 'VOL', 'RSI', 'MACD',
];

/** No studies pre-selected on the mini chart. */
export const DEFAULT_MINI_INDICATORS: ChartIndicatorId[] = [];

/** TradingView Advanced Chart `style` codes (same as expanded chart). */
export type TvChartStyle = '0' | '1' | '2' | '3' | '8' | '9';

export const TV_CHART_STYLES: { id: TvChartStyle; label: string }[] = [
  { id: '1', label: 'Candles' },
  { id: '9', label: 'Hollow candles' },
  { id: '0', label: 'Bars' },
  { id: '2', label: 'Line' },
  { id: '3', label: 'Area' },
  { id: '8', label: 'Heikin Ashi' },
];

export const DEFAULT_TV_CHART_STYLE: TvChartStyle = '1';

/** Extra studies available on TradingView (expanded chart) beyond LWC overlays. */
export const TV_EXTRA_STUDIES: { id: string; label: string; study: string }[] = [
  { id: 'ATR', label: 'ATR', study: 'ATR@tv-basicstudies' },
  { id: 'CCI', label: 'CCI', study: 'CCI@tv-basicstudies' },
  { id: 'ADX', label: 'ADX', study: 'ADX@tv-basicstudies' },
  { id: 'MOM', label: 'Momentum', study: 'Mom@tv-basicstudies' },
  { id: 'ROC', label: 'ROC', study: 'ROC@tv-basicstudies' },
  { id: 'ICHIMOKU', label: 'Ichimoku', study: 'IchimokuCloud@tv-basicstudies' },
  { id: 'VWAP', label: 'VWAP', study: 'VWAP@tv-basicstudies' },
];

const TV_STUDY_MAP: Partial<Record<ChartIndicatorId, string>> = {
  MA: 'MASimple@tv-basicstudies',
  EMA: 'MAExp@tv-basicstudies',
  BOLL: 'BB@tv-basicstudies',
  SAR: 'PSAR@tv-basicstudies',
  VOL: 'Volume@tv-basicstudies',
  OBV: 'OBV@tv-basicstudies',
  RSI: 'RSI@tv-basicstudies',
  MACD: 'MACD@tv-basicstudies',
  KDJ: 'Stochastic@tv-basicstudies',
  WR: 'WilliamsR@tv-basicstudies',
};

export type MiniChartSettings = {
  indicators: ChartIndicatorId[];
  /** Extra TradingView-only study ids (ATR, CCI, …). */
  extraStudies: string[];
  chartStyle: TvChartStyle;
  showLegend: boolean;
};

export const DEFAULT_MINI_CHART_SETTINGS: MiniChartSettings = {
  indicators: [],
  extraStudies: [],
  chartStyle: DEFAULT_TV_CHART_STYLE,
  showLegend: false,
};

/** Map selected ids → TradingView embed study list. */
export function indicatorsToTvStudies(
  indicators: ChartIndicatorId[],
  extraStudyIds: string[] = [],
): string[] {
  const out: string[] = [];
  for (const id of indicators) {
    const study = TV_STUDY_MAP[id];
    if (study && !out.includes(study)) out.push(study);
  }
  for (const extraId of extraStudyIds) {
    const row = TV_EXTRA_STUDIES.find((s) => s.id === extraId);
    if (row && !out.includes(row.study)) out.push(row.study);
  }
  return out;
}
