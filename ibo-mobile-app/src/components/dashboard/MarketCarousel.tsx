/**
 * Horizontal market cards — native-driver marquee + manual drag + tappable cards.
 */
import React, { useMemo, memo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { formatPrice, formatPercent, isPositive } from '../../utils/formatters';
import { pairParts, formatVolumeCompact } from '../../utils/markets';
import CoinIcon from '../common/CoinIcon';
import MarketsTaMicroChart from './MarketsTaMicroChart';
import { useAnimatedMarquee } from '../../hooks/useAnimatedMarquee';

const CARD_W = 152;
const CARD_H = 140;
const CARD_GAP = Spacing[3];
const ITEM_W = CARD_W + CARD_GAP;
const SPEED = 30;

type Props = {
  markets: MarketRow[];
  onPress: (m: MarketRow) => void;
};

const MarketCard = memo(function MarketCard({
  market: m,
  onPress,
}: {
  market: MarketRow;
  onPress: () => void;
}) {
  const { base, quote } = pairParts(m);
  const pos = isPositive(m.price_change_pct_24h);
  const color = pos ? Colors.buyGreen : Colors.sellRed;
  const dimBg = pos ? Colors.buyGreenDim : Colors.sellRedDim;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.78}>
      <View style={styles.cardTop}>
        <CoinIcon symbol={m.symbol} size={28} logoUrl={m.logo_url} />
        <View style={styles.cardMeta}>
          <Text style={styles.cardBase} numberOfLines={1}>{base}</Text>
          <Text style={styles.cardQuote} numberOfLines={1}>/{quote}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: dimBg }]}>
          <Text style={[styles.badgeText, { color }]}>
            {formatPercent(m.price_change_pct_24h)}
          </Text>
        </View>
      </View>
      <View style={styles.sparkWrap}>
        <MarketsTaMicroChart market={m} width={CARD_W - 20} height={46} />
      </View>
      <Text style={styles.cardPrice} numberOfLines={1}>
        {formatPrice(m.last_price)}
      </Text>
      <Text style={styles.cardVol} numberOfLines={1}>
        Vol {formatVolumeCompact(m.volume_24h)}
      </Text>
    </TouchableOpacity>
  );
});

export default function MarketCarousel({ markets, onPress }: Props) {
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
          {items.map((m, i) => (
            <MarketCard
              key={`${m.symbol}_${i}`}
              market={m}
              onPress={() => onPress(m)}
            />
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingLeft: Spacing[4],
    paddingVertical: Spacing[2],
  },
  clip: {
    height: CARD_H,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    height: CARD_H,
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[3],
    marginRight: CARD_GAP,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardMeta: { flex: 1, marginLeft: Spacing[2] },
  cardBase: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  cardQuote: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
  },
  badge: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 9,
  },
  sparkWrap: {
    marginHorizontal: -Spacing[1],
    marginVertical: Spacing[1],
  },
  cardPrice: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  cardVol: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 1,
  },
});
