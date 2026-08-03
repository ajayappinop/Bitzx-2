/**
 * Full-width animated portfolio sparkline.
 * Built from the top-volume spot market's 24h OHLCV data;
 * falls back gracefully to a flat line when data is absent.
 * Nothing is hardcoded — all values come from the MarketRow feed.
 */
import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, useWindowDimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { buildSparkPoints } from '../../utils/markets';
import { parseMarketNum } from '../../utils/markets';

type Props = {
  market: MarketRow | null;
  height?: number;
  /** extra horizontal padding already applied by parent card */
  hPad?: number;
};

export default function PortfolioSparkLine({ market, height = 64, hPad = 0 }: Props) {
  const { width } = useWindowDimensions();
  const W = width - hPad * 2;

  const animW = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animW.setValue(0);
    Animated.timing(animW, {
      toValue: 1,
      duration: 700,
      useNativeDriver: false,
      easing: Easing.out(Easing.quad),
    }).start();
  }, [market?.symbol]);

  if (!market) return <View style={{ height }} />;

  const pts = buildSparkPoints(market);
  const isPos = parseMarketNum(market.price_change_pct_24h) >= 0;
  const color = isPos ? Colors.buyGreen : Colors.sellRed;

  // Fallback flat line when no data
  const resolved: number[] = pts ?? [
    parseMarketNum(market.last_price),
    parseMarketNum(market.last_price),
  ];

  if (resolved.length < 2) return <View style={{ height }} />;

  const PAD = 4;
  const minV = Math.min(...resolved);
  const maxV = Math.max(...resolved);
  const range = maxV - minV || maxV * 0.002 || 1;
  const n = resolved.length;

  const toX = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const toY = (v: number) =>
    height - PAD - ((v - minV) / range) * (height - PAD * 2);

  const lineParts = resolved
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(' ');

  const fillParts = [
    `M ${toX(0).toFixed(1)},${height}`,
    ...resolved.map((v, i) => `L ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`),
    `L ${toX(n - 1).toFixed(1)},${height}`,
    'Z',
  ].join(' ');

  return (
    <View style={{ height, overflow: 'hidden' }}>
      <Svg width={W} height={height}>
        <Defs>
          <LinearGradient id="pgrd" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={fillParts} fill="url(#pgrd)" stroke="none" />
        <Path
          d={lineParts}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
