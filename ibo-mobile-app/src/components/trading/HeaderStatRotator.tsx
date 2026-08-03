import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontFamily, FontSize } from '../../theme';
import type { TradeStatChip } from './TradeMarketHeader';

type Props = {
  stats?: TradeStatChip[];
  intervalMs?: number;
};

export default function HeaderStatRotator({ stats, intervalMs = 2800 }: Props) {
  const list = stats?.filter((s) => s.value && s.value !== '—') ?? [];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [stats]);

  useEffect(() => {
    if (list.length <= 1) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), intervalMs);
    return () => clearInterval(t);
  }, [list.length, intervalMs]);

  if (!list.length) return null;
  const chip = list[idx % list.length];

  return (
    <View style={styles.slot}>
      <Text style={styles.label} numberOfLines={1}>{chip.label}</Text>
      <Text
        style={[styles.value, chip.valueColor ? { color: chip.valueColor } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {chip.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    minWidth: 72,
    maxWidth: 110,
    alignItems: 'flex-end',
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  value: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginTop: 2,
  },
});
