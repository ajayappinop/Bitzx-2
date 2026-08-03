/**
 * Compact TradingView Advanced Chart — same widget as web, trimmed chrome for trade mini panel.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildTradingViewEmbedHtml } from './tradingViewAdvancedChartHtml';
import { chartIntervalToTvInterval } from './tvAdvancedChart';
import { resolveTradingViewWidgetSymbol } from '../../utils/tradingViewWidgetSymbol';
import { CHART_WEBVIEW_LAYER, TERMINAL_WEBVIEW_PROPS } from './terminalWebViewProps';
import type { ChartIndicatorId } from './chartIndicators';
import {
  DEFAULT_TV_CHART_STYLE,
  indicatorsToTvStudies,
  type TvChartStyle,
} from './chartIndicatorTvStudies';

type Props = {
  symbol: string;
  interval?: string;
  indicators?: ChartIndicatorId[];
  extraStudies?: string[];
  chartStyle?: TvChartStyle;
  showLegend?: boolean;
  height?: number;
  width?: number;
  style?: ViewStyle;
};

export default function TradingViewMiniChart({
  symbol,
  interval = '1h',
  indicators = [],
  extraStudies = [],
  chartStyle = DEFAULT_TV_CHART_STYLE,
  showLegend = false,
  height,
  width,
  style,
}: Props) {
  const tvSymbol = resolveTradingViewWidgetSymbol(symbol);
  const tvInterval = useMemo(() => {
    if (/^\d+$/.test(interval) || interval === 'D' || interval === 'W') return interval;
    return chartIntervalToTvInterval(interval);
  }, [interval]);

  const studies = useMemo(
    () => indicatorsToTvStudies(indicators, extraStudies),
    [indicators, extraStudies],
  );
  const studiesKey = studies.join('|');

  const webSource = useMemo(
    () => ({
      html: buildTradingViewEmbedHtml(tvSymbol, tvInterval, {
        compact: true,
        studies,
        style: chartStyle,
        hideLegend: !showLegend,
      }),
      baseUrl: 'https://www.tradingview.com',
    }),
    [tvSymbol, tvInterval, studiesKey, chartStyle, showLegend],
  );

  return (
    <View style={[styles.wrap, { height, width }, style]} collapsable={false}>
      <WebView
        key={`${tvSymbol}-${tvInterval}-${studiesKey}-${chartStyle}-${showLegend ? 1 : 0}`}
        source={webSource}
        style={styles.webview}
        {...TERMINAL_WEBVIEW_PROPS}
        androidLayerType={CHART_WEBVIEW_LAYER as 'none'}
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#0d0f14',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
