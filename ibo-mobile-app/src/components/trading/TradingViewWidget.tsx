/**
 * TradingViewWidget — wraps TradingViewChart (LWC WebView) with klines data.
 *
 * mini=true  → compact chart panel (e.g. on TradeScreen)
 * mini=false → full-screen chart (e.g. SpotChartScreen)
 *
 * Klines are fetched from /api/trading/klines/{symbol} and refreshed every 30s.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, useWindowDimensions,
} from 'react-native';
import TradingViewChart from './TradingViewChart';
import { useKlinesFeed } from '../../hooks/useKlinesFeed';
import { toExchangeSymbol } from '../../utils/tradeSymbols';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import Icon from '../common/AppIcon';

export interface TradingViewWidgetProps {
  symbol?: string;
  market?: 'spot' | 'futures' | 'options';
  mini?: boolean;
  onExpand?: () => void;
  livePrice?: number;
  /** Height for mini mode (default 200) */
  height?: number;
}

const INTERVALS: Record<string, string> = {
  spot:    '1h',
  futures: '15m',
  options: '15m',
};

export default function TradingViewWidget({
  symbol = 'BTCUSDT',
  market = 'spot',
  mini = false,
  onExpand,
  livePrice,
  height = 200,
}: TradingViewWidgetProps) {
  const { width, height: windowHeight } = useWindowDimensions();
  const fullHeight = windowHeight * 0.55;
  const chartSymbol = useMemo(() => toExchangeSymbol(symbol), [symbol]);
  const interval = INTERVALS[market] ?? '1h';

  const { klines, loading } = useKlinesFeed(chartSymbol, interval, 200, { refreshMs: 30_000 });

  const [activeInterval, setActiveInterval] = useState(interval);
  useEffect(() => {
    setActiveInterval(interval);
  }, [chartSymbol, interval]);

  const { klines: customKlines, loading: customLoading } = useKlinesFeed(
    chartSymbol,
    activeInterval,
    200,
    { refreshMs: 30_000 },
  );

  const displayKlines = activeInterval === interval ? klines : customKlines;
  const displayLoading = activeInterval === interval ? loading : customLoading;

  const INTERVAL_TABS = ['5m', '15m', '1h', '4h', '1d'];

  if (mini) {
    return (
      <View style={[s.miniWrap, { height }]}>
        {displayLoading && displayKlines.length === 0 ? (
          <View style={s.loadingOverlay}>
            <ActivityIndicator size="small" color={Colors.goldLight} />
          </View>
        ) : null}
        <TradingViewChart
          key={`${chartSymbol}|${activeInterval}|mini`}
          klines={displayKlines}
          livePrice={livePrice}
          height={height}
          width={width}
          mode="preview"
          keepAliveWhenHidden
        />
        {/* Expand button */}
        {onExpand ? (
          <TouchableOpacity style={s.expandBtn} onPress={onExpand} activeOpacity={0.85}>
            <Icon name="fullscreen" size={16} color={Colors.white} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={s.fullWrap}>
      {/* Interval selector */}
      <View style={s.intervalRow}>
        {INTERVAL_TABS.map((iv) => (
          <TouchableOpacity
            key={iv}
            style={[s.ivBtn, activeInterval === iv && s.ivBtnActive]}
            onPress={() => setActiveInterval(iv)}
            activeOpacity={0.75}
          >
            <Text style={[s.ivTxt, activeInterval === iv && s.ivTxtActive]}>{iv}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {displayLoading && displayKlines.length === 0 ? (
        <View style={[s.loadingOverlay, { height: fullHeight }]}>
          <ActivityIndicator size="large" color={Colors.goldLight} />
          <Text style={s.loadingText}>Loading chart…</Text>
        </View>
      ) : (
        <TradingViewChart
          key={`${chartSymbol}|${activeInterval}|full`}
          klines={displayKlines}
          livePrice={livePrice}
          height={fullHeight}
          width={width}
          mode="fullscreen"
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  miniWrap: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  fullWrap: {
    width: '100%',
    backgroundColor: Colors.surface,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    zIndex: 5,
  },
  loadingText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing[2],
  },
  expandBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  intervalRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    gap: Spacing[2],
    backgroundColor: Colors.surfaceDark,
  },
  ivBtn: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 5,
    borderRadius: Radius.sm,
  },
  ivBtnActive: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  ivTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  ivTxtActive: {
    color: Colors.goldLight,
  },
});
