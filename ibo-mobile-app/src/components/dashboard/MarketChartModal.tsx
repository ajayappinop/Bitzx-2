/**
 * Full-screen chart explorer — opened from the dashboard 24h market chart.
 * Switch pairs, change interval, scrub candles, and jump to trade.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { MarketRow } from '../../types/market.types';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatPrice, formatPercent, isPositive } from '../../utils/formatters';
import { formatVolumeCompact, pairParts, parseMarketNum } from '../../utils/markets';
import CoinIcon from '../common/CoinIcon';
import Icon from '../common/AppIcon';
import InteractiveCandleChart, { INTERVALS, Interval } from './InteractiveCandleChart';
import type { BarItem } from './VolumeBarChart';

type Props = {
  visible: boolean;
  items: BarItem[];
  initialSymbol?: string;
  onClose: () => void;
  onTrade: (m: MarketRow) => void;
};

export default function MarketChartModal({
  visible,
  items,
  initialSymbol,
  onClose,
  onTrade,
}: Props) {
  const { height: screenH } = useWindowDimensions();
  const [activeIdx, setActiveIdx] = useState(0);
  const [interval, setInterval] = useState<Interval>('1h');

  const markets = useMemo(() => items.map((it) => it.market), [items]);

  useEffect(() => {
    if (!visible || markets.length === 0) return;
    if (initialSymbol) {
      const idx = markets.findIndex((m) => m.symbol === initialSymbol);
      setActiveIdx(idx >= 0 ? idx : 0);
    } else {
      setActiveIdx(0);
    }
    setInterval('1h');
  }, [visible, initialSymbol, markets]);

  const active = markets[activeIdx] ?? markets[0];
  if (!visible || !active) return null;

  const { base, quote } = pairParts(active);
  const pos = isPositive(active.price_change_pct_24h);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { height: screenH * 0.88 }]}>
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <CoinIcon symbol={active.symbol} size={36} logoUrl={active.logo_url} />
            <View>
              <Text style={styles.pairText}>
                {base}<Text style={styles.quoteText}>{quote ? `/${quote}` : ''}</Text>
              </Text>
              <Text style={styles.priceText}>{formatPrice(active.last_price)}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="x" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatChip
            label="24h"
            value={formatPercent(active.price_change_pct_24h)}
            color={pos ? Colors.buyGreen : Colors.sellRed}
          />
          <StatChip label="Price" value={formatPrice(active.last_price)} />
          <StatChip label="Vol" value={formatVolumeCompact(parseMarketNum(active.volume_24h))} />
        </View>

        {/* Pair tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pairTabs}
          contentContainerStyle={styles.pairTabsContent}
        >
          {markets.map((m, i) => {
            const { base: b } = pairParts(m);
            const selected = i === activeIdx;
            const mPos = isPositive(m.price_change_pct_24h);
            return (
              <TouchableOpacity
                key={m.symbol}
                style={[styles.pairTab, selected && styles.pairTabActive]}
                onPress={() => setActiveIdx(i)}
                activeOpacity={0.75}
              >
                <Text style={[styles.pairTabText, selected && styles.pairTabTextActive]}>{b}</Text>
                <Text style={[styles.pairTabPct, { color: mPos ? Colors.buyGreen : Colors.sellRed }]}>
                  {formatPercent(m.price_change_pct_24h)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Interval picker */}
        <View style={styles.intervalRow}>
          {INTERVALS.map((iv) => (
            <TouchableOpacity
              key={iv}
              style={[styles.ivBtn, interval === iv && styles.ivBtnActive]}
              onPress={() => setInterval(iv)}
            >
              <Text style={[styles.ivText, interval === iv && styles.ivTextActive]}>{iv}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chart */}
        <View style={styles.chartArea}>
          <InteractiveCandleChart
            key={`${active.symbol}_${interval}`}
            symbol={active.symbol}
            interval={interval}
            height={Math.min(320, screenH * 0.42)}
          />
        </View>

        {/* Trade button */}
        <TouchableOpacity
          style={styles.tradeBtn}
          onPress={() => { onTrade(active); onClose(); }}
          activeOpacity={0.85}
        >
          <Text style={styles.tradeBtnText}>Trade {base}</Text>
          <Icon name="arrow-right" size={16} color={Colors.surfaceDark} />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function StatChip({
  label, value, color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderBottomWidth: 0,
    paddingBottom: Spacing[6],
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center',
    marginTop: Spacing[3],
    marginBottom: Spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[2],
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  pairText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  quoteText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  priceText: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.base,
    color: Colors.goldLight,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[4],
    gap: Spacing[2],
    marginBottom: Spacing[3],
  },
  statChip: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
  },
  statLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 8,
    color: Colors.textMuted,
    marginBottom: 2,
  },
  statValue: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.textPrimary,
  },
  pairTabs: { maxHeight: 52, marginBottom: Spacing[2] },
  pairTabsContent: { paddingHorizontal: Spacing[4], gap: Spacing[2] },
  pairTab: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceElevated,
    marginRight: Spacing[2],
    minWidth: 64,
    alignItems: 'center',
  },
  pairTabActive: {
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha15,
  },
  pairTabText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  pairTabTextActive: { color: Colors.goldLight },
  pairTabPct: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 9,
    marginTop: 2,
  },
  intervalRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[4],
    marginBottom: Spacing[2],
    gap: Spacing[1],
  },
  ivBtn: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  ivBtnActive: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.goldAlpha30,
  },
  ivText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  ivTextActive: { color: Colors.goldLight },
  chartArea: {
    flex: 1,
    marginHorizontal: Spacing[4],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: '#0d1117',
  },
  tradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    marginHorizontal: Spacing[4],
    marginTop: Spacing[3],
    backgroundColor: Colors.gold,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[3],
  },
  tradeBtnText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.surfaceDark,
  },
});
