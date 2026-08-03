import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { CHART_INTERVALS, type ChartIntervalKey } from '../../utils/tradingViewSymbol';

type Props = {
  value: ChartIntervalKey;
  onChange: (key: ChartIntervalKey) => void;
  compact?: boolean;
};

export default function ChartIntervalBar({ value, onChange, compact = false }: Props) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {CHART_INTERVALS.map((iv) => {
          const active = iv.key === value;
          return (
            <TouchableOpacity
              key={iv.key}
              style={[styles.chip, active && styles.chipActive, compact && styles.chipCompact]}
              onPress={() => onChange(iv.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{iv.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  row: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    gap: Spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.md,
    marginRight: 4,
  },
  chipCompact: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
  },
  chipActive: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  chipText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  chipTextActive: {
    color: Colors.goldLight,
  },
});
