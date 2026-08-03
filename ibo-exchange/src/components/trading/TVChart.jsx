/**
 * TVChart — TradingView Advanced Real-Time Chart (all spot pairs).
 *
 * Delta-quoted pairs map to the same base on Binance USDT for an identical
 * TradingView UI (toolbars, drawings, intervals). Live Delta price is shown
 * in the page header, order book, and trade form.
 */
import { useEffect, useRef } from 'react';
import { parsePairFromApiSymbol } from '@/services/marketApi';
import { useTheme } from '@/context/ThemeContext';

const TV_SYMBOLS = {
  IBOUSDT:  'BINANCE:BTCUSDT',
  BTCUSDT:  'BINANCE:BTCUSDT',
  ETHUSDT:  'BINANCE:ETHUSDT',
  BNBUSDT:  'BINANCE:BNBUSDT',
  SOLUSDT:  'BINANCE:SOLUSDT',
  XRPUSDT:  'BINANCE:XRPUSDT',
  DOGEUSDT: 'BINANCE:DOGEUSDT',
  ADAUSDT:  'BINANCE:ADAUSDT',
  POLUSDT:  'BINANCE:POLUSDT',
  AVAXUSDT: 'BINANCE:AVAXUSDT',
  DOTUSDT:  'BINANCE:DOTUSDT',
  LINKUSDT: 'BINANCE:LINKUSDT',
  LTCUSDT:  'BINANCE:LTCUSDT',
};

const TV_WIDGET_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

function resolveTvSymbol(apiSymbol) {
  const sym = String(apiSymbol || '').toUpperCase();
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

function tvOptionsForTheme(isLight) {
  return {
    autosize: true,
    interval: '60',
    timezone: 'Etc/UTC',
    theme: isLight ? 'light' : 'dark',
    style: '1',
    locale: 'en',
    backgroundColor: isLight ? '#ffffff' : '#101013',
    gridColor: isLight ? 'rgba(208,219,227,0.9)' : 'rgba(255,255,255,0.04)',
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
      'mainSeriesProperties.candleStyle.upColor': '#00a876',
      'mainSeriesProperties.candleStyle.downColor': '#eb5454',
      'mainSeriesProperties.candleStyle.borderUpColor': '#00a876',
      'mainSeriesProperties.candleStyle.borderDownColor': '#eb5454',
      'mainSeriesProperties.candleStyle.wickUpColor': '#00a876',
      'mainSeriesProperties.candleStyle.wickDownColor': '#eb5454',
    },
    support_host: 'https://www.tradingview.com',
  };
}

export default function TVChart({ symbol }) {
  const containerRef = useRef(null);
  const { isLight } = useTheme();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    el.innerHTML = '';

    const tvSymbol = resolveTvSymbol(symbol);
    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container';
    wrapper.style.cssText = 'width:100%;height:100%;';

    const widgetEl = document.createElement('div');
    widgetEl.className = 'tradingview-widget-container__widget';
    widgetEl.style.cssText = 'width:100%;height:100%;';
    wrapper.appendChild(widgetEl);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = TV_WIDGET_SCRIPT;
    script.textContent = JSON.stringify({
      ...tvOptionsForTheme(isLight),
      symbol: tvSymbol,
    });
    wrapper.appendChild(script);
    el.appendChild(wrapper);

    return () => {
      el.innerHTML = '';
    };
  }, [symbol, isLight]);

  return (
    <div
      className="ibo-tv-chart"
      style={{
        position: 'absolute',
        inset: 0,
        background: isLight ? '#ffffff' : '#101013',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
