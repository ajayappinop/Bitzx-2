/**
 * TradingView Advanced Real-Time Chart embed — same widget as ibo-exchange TVChart.jsx.
 */
const TV_WIDGET_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

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
  no_referral_id: true,
  disabled_features: [
    'widget_logo',
    'adaptive_logo',
    'buy_sell_buttons',
    'broker_button',
    'chart_crosshair_menu',
    'popup_hints',
    'chart_property_page_trading',
    'trading_account_manager',
    'trading_notifications',
    'show_logo_on_all_charts',
    'edit_buttons_in_legend',
  ],
  overrides: {
    'mainSeriesProperties.candleStyle.upColor': '#22c55e',
    'mainSeriesProperties.candleStyle.downColor': '#ef4444',
    'mainSeriesProperties.candleStyle.borderUpColor': '#22c55e',
    'mainSeriesProperties.candleStyle.borderDownColor': '#ef4444',
    'mainSeriesProperties.candleStyle.wickUpColor': '#22c55e',
    'mainSeriesProperties.candleStyle.wickDownColor': '#ef4444',
  },
  support_host: 'https://www.tradingview.com',
};

/** Block TV trademark links / popups before the embed script runs. */
const TV_EMBED_GUARD_SCRIPT = `
(function () {
  function blockPopup() { return null; }
  window.open = blockPopup;
  window.showModalDialog = blockPopup;

  document.addEventListener('click', function (e) {
    var node = e.target;
    while (node) {
      if (node.tagName === 'A') {
        var href = node.getAttribute('href') || '';
        if (/tradingview\\.com/i.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
      if (node.classList && (
        node.classList.contains('tradingview-widget-copyright') ||
        node.classList.contains('trademark')
      )) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      node = node.parentElement;
    }
  }, true);

  window.addEventListener('message', function (e) {
    try {
      var data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data && data.name === 'openChartInPopup') {
        e.stopImmediatePropagation();
      }
    } catch (err) {}
  }, true);

  function purgeBranding() {
    document.querySelectorAll(
      '.tradingview-widget-copyright, .trademark, a[href*="tradingview.com"],' +
      '[class*="tv-embed-widget-wrapper__logo"], [class*="embed-logo"],' +
      'button[aria-label*="Help"], button[title*="Help"],' +
      'a[aria-label*="TradingView"], [data-name="open-popup-button"]'
    ).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }
  purgeBranding();
  new MutationObserver(purgeBranding).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

export function buildTradingViewAdvancedChartHtml(tvSymbol: string, tvInterval: string): string {
  return buildTradingViewEmbedHtml(tvSymbol, tvInterval, { compact: false });
}

export type TvEmbedOptions = {
  compact?: boolean;
  studies?: string[];
  /** TradingView chart style: 0 bars, 1 candles, 2 line, 3 area, 8 heikin ashi, 9 hollow. */
  style?: string;
  hideLegend?: boolean;
};

export function buildTradingViewEmbedHtml(
  tvSymbol: string,
  tvInterval: string,
  opts: TvEmbedOptions = {},
): string {
  const compact = !!opts.compact;
  const studies = opts.studies ?? [];
  const style = opts.style ?? TV_WIDGET_OPTIONS.style;
  const hideLegend = opts.hideLegend ?? (compact ? true : TV_WIDGET_OPTIONS.hide_legend);

  const config = JSON.stringify({
    ...TV_WIDGET_OPTIONS,
    symbol: tvSymbol,
    interval: tvInterval,
    style,
    hide_side_toolbar: compact,
    hide_top_toolbar: compact,
    hide_legend: hideLegend,
    withdateranges: false,
    ...(studies.length ? { studies } : {}),
    ...(compact
      ? {
        disabled_features: [
          ...(TV_WIDGET_OPTIONS.disabled_features || []),
          'header_symbol_search',
          'symbol_search_hot_key',
          'header_compare',
          'display_market_status',
          'header_saveload',
          'save_chart_properties_to_local_storage',
          'left_toolbar',
          'control_bar',
          'timeframes_toolbar',
          'header_settings',
          'header_chart_type',
          'header_indicators',
          'header_undo_redo',
          'header_screenshot',
          'header_fullscreen_button',
        ],
      }
      : {}),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background: #0d0f14;
      overflow: hidden;
    }
    .tradingview-widget-container,
    .tradingview-widget-container__widget {
      width: 100%;
      height: 100%;
    }
    .tradingview-widget-copyright,
    .trademark,
    a[href*="tradingview.com"]:not([href*="tradingview-widget.com"]),
    [class*="tv-embed-widget-wrapper__logo"],
    [class*="embed-logo"],
    button[aria-label*="Help"],
    button[title*="Help"] {
      display: none !important;
      pointer-events: none !important;
      visibility: hidden !important;
      height: 0 !important;
      overflow: hidden !important;
    }
  </style>
  <script>${TV_EMBED_GUARD_SCRIPT}</script>
</head>
<body>
  <div class="tradingview-widget-container">
    <div class="tradingview-widget-container__widget"></div>
    <script type="text/javascript" src="${TV_WIDGET_SCRIPT}" async>${config}</script>
  </div>
</body>
</html>`;
}
