/**
 * TradingView Advanced Real-Time Chart in a WebView — parity with ibo-exchange TVChart.jsx.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildTvAdvancedChartHtml, chartIntervalToTvInterval } from './tvAdvancedChart';
import { CHART_WEBVIEW_LAYER, TERMINAL_WEBVIEW_PROPS } from './terminalWebViewProps';

type Props = {
  symbol: string;
  /** Mobile interval key (1m, 1h, …) or TradingView code (60, D, …). */
  interval?: string;
  height?: number;
  width?: number;
  style?: ViewStyle;
};

export default function TradingViewAdvancedChart({
  symbol,
  interval = '1h',
  height,
  width,
  style,
}: Props) {
  const tvInterval = useMemo(() => {
    if (/^\d+$/.test(interval) || interval === 'D' || interval === 'W') return interval;
    return chartIntervalToTvInterval(interval);
  }, [interval]);

  const webSource = useMemo(
    () => ({
      html: buildTvAdvancedChartHtml(symbol, tvInterval),
      baseUrl: 'https://www.tradingview.com',
    }),
    [symbol, tvInterval],
  );

  return (
    <View style={[styles.wrap, { height, width }, style]} collapsable={false}>
      <WebView
        key={`${symbol}-${tvInterval}`}
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
    backgroundColor: 'rgba(10, 11, 15, 1)',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
