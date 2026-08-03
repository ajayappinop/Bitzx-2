/**
 * Full-screen chart — TradingView Advanced Chart embed (website parity).
 * Side toolbar, top toolbar, and indicators are provided by TradingView itself.
 * Internal demo pairs fall back to exchange candles (no custom indicator math).
 */
import React, { useMemo, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, LayoutChangeEvent,
} from 'react-native';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import Icon from '../../components/common/AppIcon';
import TradingViewAdvancedChart from '../../components/trading/TradingViewAdvancedChart';
import TradingViewChart, { CHART_INTERACTIVE_MODE } from '../../components/trading/TradingViewChart';
import {
  CHART_KLINE_LIMITS,
  isChartInterval,
  type ChartInterval,
} from '../../components/trading/chartIntervals';
import { useKlinesFeed } from '../../hooks/useKlinesFeed';
import { useSpotTickerFeed } from '../../hooks/useTickerFeed';
import { formatPairLabel, toSpotSymbol } from '../../utils/tradeSymbols';
import { formatPrice } from '../../utils/formatters';
import {
  canUseTradingViewWidget,
  resolveTradingViewWidgetSymbol,
  chartIntervalToTvInterval,
} from '../../utils/tradingViewWidgetSymbol';
import { Colors, FontFamily, FontSize, Spacing, LayoutColors } from '../../theme';

type RouteParams = {
  symbol?: string;
  market?: 'spot' | 'futures' | 'options';
  interval?: string;
  livePrice?: number;
};

export default function FullChartScreen({ navigation, route }: any) {
  const {
    symbol: rawSymbol = 'BTCUSDT',
    interval: routeInterval,
    livePrice: seedPrice,
  } = (route?.params ?? {}) as RouteParams;

  const { width: screenW } = useWindowDimensions();
  const pairLabel = useMemo(() => formatPairLabel(rawSymbol), [rawSymbol]);

  const initialInterval: ChartInterval = routeInterval && isChartInterval(routeInterval)
    ? routeInterval
    : '1h';

  const useTvWidget = useMemo(() => canUseTradingViewWidget(rawSymbol), [rawSymbol]);
  const tvSymbol = useMemo(
    () => resolveTradingViewWidgetSymbol(rawSymbol),
    [rawSymbol],
  );
  const tvInterval = useMemo(
    () => chartIntervalToTvInterval(initialInterval),
    [initialInterval],
  );

  const klineSym = useMemo(() => toSpotSymbol(rawSymbol), [rawSymbol]);
  const limit = CHART_KLINE_LIMITS[initialInterval];
  const { klines, loading } = useKlinesFeed(klineSym, initialInterval, limit);
  const { ticker: feedTicker } = useSpotTickerFeed(klineSym);

  const livePrice = useMemo(() => {
    const tick = feedTicker?.price != null ? Number(feedTicker.price) : NaN;
    if (Number.isFinite(tick) && tick > 0) return tick;
    if (seedPrice != null && Number.isFinite(seedPrice)) return seedPrice;
    if (klines.length) return klines[klines.length - 1].close;
    return undefined;
  }, [feedTicker?.price, seedPrice, klines]);

  const [chartAreaH, setChartAreaH] = useState(0);
  const onChartAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.floor(e.nativeEvent.layout.height);
    if (h > 0) setChartAreaH(h);
  }, []);

  const goBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <SafeAreaWrapper style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="arrow-left" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.pair}>{pairLabel}</Text>
          {livePrice != null ? (
            <Text style={styles.price}>{formatPrice(livePrice)}</Text>
          ) : null}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.chartArea} onLayout={onChartAreaLayout}>
        {chartAreaH > 0 && useTvWidget ? (
          <TradingViewAdvancedChart
            tvSymbol={tvSymbol}
            tvInterval={tvInterval}
            height={chartAreaH}
            width={screenW}
          />
        ) : null}

        {chartAreaH > 0 && !useTvWidget ? (
          <TradingViewChart
            klines={klines}
            livePrice={livePrice}
            height={chartAreaH}
            width={screenW}
            mode={CHART_INTERACTIVE_MODE}
            indicators={[]}
          />
        ) : null}

        {!useTvWidget && loading && klines.length === 0 ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <Text style={styles.loadingText}>Loading chart…</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LayoutColors.canvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LayoutColors.cardAlt,
  },
  backBtn: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  pair: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  price: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: LayoutColors.marketUp,
    marginTop: 2,
  },
  headerSpacer: {
    width: 40,
  },
  chartArea: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,14,17,0.5)',
  },
  loadingText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
