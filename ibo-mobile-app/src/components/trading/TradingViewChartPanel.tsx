/**
 * Full-screen chart panel — TradingView with MA / EMA / Bollinger + all intervals.
 * IBO / custom pairs fall back to native PriceChart (exchange klines).
 */
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { displayPairSlash } from '../../utils/tradeSymbols';
import {
  DEFAULT_CHART_INTERVAL,
  toTradingViewSymbol,
  priceChartIntervalFromKey,
  type ChartIntervalKey,
} from '../../utils/tradingViewSymbol';
import ChartIntervalBar from './ChartIntervalBar';
import TradingViewChart from './TradingViewChart';
import PriceChart from './PriceChart';
import type { Kline } from '../../types/market.types';

type Props = {
  visible: boolean;
  symbol: string;
  onClose: () => void;
  livePrice?: number;
  klines?: Kline[];
  klinesFromParent?: boolean;
};

export default function TradingViewChartPanel({
  visible,
  symbol,
  onClose,
  livePrice,
  klines,
  klinesFromParent,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [interval, setInterval] = useState<ChartIntervalKey>(DEFAULT_CHART_INTERVAL);
  const hasTv = Boolean(toTradingViewSymbol(symbol));
  const chartH = Math.max(280, winH - insets.top - insets.bottom - 120);
  const pair = displayPairSlash(symbol);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor={Colors.surfaceDark} />
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.topBar}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{pair}</Text>
            <Text style={styles.subtitle}>
              {hasTv ? 'TradingView · MA · EMA · Bollinger' : 'Exchange candles'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Icon name="close" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ChartIntervalBar value={interval} onChange={setInterval} />

        <View style={styles.chartArea}>
          {hasTv ? (
            <TradingViewChart
              exchangeSymbol={symbol}
              interval={interval}
              height={chartH}
              mini={false}
            />
          ) : (
            <PriceChart
              key={interval}
              symbol={symbol}
              height={chartH}
              livePrice={livePrice}
              klines={klines}
              klinesFromParent={klinesFromParent}
              defaultInterval={priceChartIntervalFromKey(interval)}
            />
          )}
        </View>

        {hasTv && (
          <Text style={styles.foot}>
            Pinch to zoom · tap indicators on chart toolbar for more studies
          </Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.surfaceDark,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  titleBlock: { flex: 1 },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartArea: {
    flex: 1,
  },
  foot: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[4],
  },
});
