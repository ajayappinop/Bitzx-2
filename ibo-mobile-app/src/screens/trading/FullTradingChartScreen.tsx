/**
 * Full-screen chart route (header chart icon) — reuses TradingView panel UI inline.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { displayPairSlash } from '../../utils/tradeSymbols';
import {
  DEFAULT_CHART_INTERVAL,
  toTradingViewSymbol,
  priceChartIntervalFromKey,
  type ChartIntervalKey,
} from '../../utils/tradingViewSymbol';
import ChartIntervalBar from '../../components/trading/ChartIntervalBar';
import TradingViewChart from '../../components/trading/TradingViewChart';
import PriceChart from '../../components/trading/PriceChart';

type Stack = {
  SpotChart: { symbol: string };
  FuturesChart: { symbol: string };
};

type Props = {
  navigation: NativeStackNavigationProp<Stack, 'SpotChart' | 'FuturesChart'>;
  route: RouteProp<Stack, 'SpotChart' | 'FuturesChart'>;
};

export default function FullTradingChartScreen({ navigation, route }: Props) {
  const { symbol } = route.params;
  const { height: winH } = useWindowDimensions();
  const [interval, setInterval] = useState<ChartIntervalKey>(DEFAULT_CHART_INTERVAL);
  const hasTv = Boolean(toTradingViewSymbol(symbol));
  const chartH = Math.max(320, winH - 200);
  const pair = displayPairSlash(symbol);

  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{pair}</Text>
          <Text style={styles.subtitle}>
            {hasTv ? 'TradingView · MA · EMA · Bollinger' : 'Exchange candles'}
          </Text>
        </View>
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
            defaultInterval={priceChartIntervalFromKey(interval)}
          />
        )}
      </View>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[2],
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
  chartArea: {
    flex: 1,
  },
});
