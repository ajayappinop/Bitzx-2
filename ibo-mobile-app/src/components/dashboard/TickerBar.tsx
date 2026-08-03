/**
 * Live scrolling ticker bar — native-driver marquee + manual drag + tap.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { formatPercent, isPositive } from '../../utils/formatters';
import { pairParts } from '../../utils/markets';
import { useAnimatedMarquee } from '../../hooks/useAnimatedMarquee';

type Props = {
  markets: MarketRow[];
  onPress?: (m: MarketRow) => void;
};

const ITEM_W = 136;
const SPEED = 42;

function compactPrice(raw: number | string): string {
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (isNaN(n) || n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1_000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

export default function TickerBar({ markets, onPress }: Props) {
  const count = markets.length;
  const segmentW = count * ITEM_W;

  const { translateX, panHandlers } = useAnimatedMarquee({
    segmentWidth: segmentW,
    speed: SPEED,
  });

  const items = useMemo(() => {
    if (count === 0) return [];
    return [...markets, ...markets];
  }, [count, markets]);

  if (count === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.clip} {...panHandlers}>
        <Animated.View style={[styles.row, { transform: [{ translateX }] }]}>
          {items.map((m, i) => {
            const { base } = pairParts(m);
            const pos = isPositive(m.price_change_pct_24h);
            const color = pos ? Colors.buyGreen : Colors.sellRed;
            return (
              <TouchableOpacity
                key={`${m.symbol}_${i}`}
                style={styles.item}
                onPress={() => onPress?.(m)}
                activeOpacity={onPress ? 0.72 : 1}
                disabled={!onPress}
              >
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={styles.sym} numberOfLines={1}>{base}</Text>
                <Text style={styles.px} numberOfLines={1}>
                  {compactPrice(m.last_price)}
                </Text>
                <Text style={[styles.pct, { color }]} numberOfLines={1}>
                  {formatPercent(m.price_change_pct_24h)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 34,
    backgroundColor: Colors.surfaceCard,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  clip: {
    flex: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
  },
  item: {
    width: ITEM_W,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[2],
    borderRightWidth: 1,
    borderRightColor: Colors.surfaceBorder,
    height: 34,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginRight: 4,
    flexShrink: 0,
  },
  sym: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    marginRight: 4,
    minWidth: 24,
    maxWidth: 36,
  },
  px: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    color: Colors.textSecondary,
    flex: 1,
  },
  pct: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 9,
    flexShrink: 0,
  },
});
