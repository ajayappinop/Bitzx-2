/**
 * TradingView Advanced Real-Time Chart — same widget + options as ibo-exchange TVChart.jsx.
 */
import { parsePairFromApiSymbol } from '../../utils/tradeSymbols';

export const TV_WIDGET_SCRIPT =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

const TV_SYMBOLS: Record<string, string> = {
  IBOUSDT: 'BINANCE:BTCUSDT',
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

/** Map mobile interval keys → TradingView widget interval codes. */
export function chartIntervalToTvInterval(interval: string): string {
  const map: Record<string, string> = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
    '1w': 'W',
  };
  return map[interval] ?? '60';
}

/** Same symbol resolution as web TVChart.jsx (futures strips -PERP before lookup). */
export function resolveTvChartSymbol(apiSymbol: string): string {
  const sym = String(apiSymbol || '').toUpperCase().replace(/-PERP$/i, '');

  if (TV_SYMBOLS[sym]) return TV_SYMBOLS[sym];

  if (sym.endsWith('IBO')) {
    const { base } = parsePairFromApiSymbol(sym);
    const usdt = `${base}USDT`;
    if (TV_SYMBOLS[usdt]) return TV_SYMBOLS[usdt];
    return `BINANCE:${usdt}`;
  }

  if (sym.endsWith('USDT')) {
    return `BINANCE:${sym}`;
  }

  return 'BINANCE:BTCUSDT';
}

const TV_WIDGET_OPTIONS = {
  autosize: true,
  timezone: 'Etc/UTC',
  theme: 'dark',
  style: '1',
  locale: 'en',
  backgroundColor: 'rgba(10,11,15,1)',
  gridColor: 'rgba(26,29,36,0.9)',
  allow_symbol_change: false,
  calendar: false,
  withdateranges: false,
  hide_side_toolbar: false,
  hide_top_toolbar: false,
  hide_legend: false,
  details: false,
  hotlist: false,
  show_popup_button: false,
  overrides: {
    'mainSeriesProperties.candleStyle.upColor': '#22c55e',
    'mainSeriesProperties.candleStyle.downColor': '#ef4444',
    'mainSeriesProperties.candleStyle.borderUpColor': '#22c55e',
    'mainSeriesProperties.candleStyle.borderDownColor': '#ef4444',
    'mainSeriesProperties.candleStyle.wickUpColor': '#22c55e',
    'mainSeriesProperties.candleStyle.wickDownColor': '#ef4444',
  },
  support_host: 'https://www.tradingview.com',
} as const;

export function buildTvAdvancedChartHtml(apiSymbol: string, interval = '60'): string {
  const tvSymbol = resolveTvChartSymbol(apiSymbol);
  const config = JSON.stringify({
    ...TV_WIDGET_OPTIONS,
    symbol: tvSymbol,
    interval,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: rgba(10, 11, 15, 1);
      -webkit-text-size-adjust: 100%;
    }
    .ibo-tv-chart {
      position: absolute;
      inset: 0;
    }
    .tradingview-widget-container,
    .tradingview-widget-container__widget {
      width: 100% !important;
      height: 100% !important;
    }
    .tradingview-widget-copyright {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="ibo-tv-chart">
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <script type="text/javascript" src="${TV_WIDGET_SCRIPT}" async>${config}</script>
    </div>
  </div>
</body>
</html>`;
}
