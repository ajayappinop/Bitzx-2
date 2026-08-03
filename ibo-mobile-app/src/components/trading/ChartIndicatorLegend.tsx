/**
 * Binance-style indicator readout — compact value chips above the chart (not on canvas).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { IndicatorReadoutGroup } from './chartIndicators';
import { Colors, FontFamily } from '../../theme';

type Props = {
  groups: IndicatorReadoutGroup[];
  /** True while the user is holding the crosshair on the chart. */
  inspecting?: boolean;
};

export default function ChartIndicatorLegend({ groups, inspecting = false }: Props) {
  if (!groups.length) return null;

  return (
    <View style={[styles.banner, inspecting && styles.bannerInspect]}>
      {groups.map((group) => (
        <View key={group.id} style={styles.row}>
          {group.chips.map((chip) => (
            <View key={chip.key} style={styles.chip}>
              {chip.label ? (
                <Text style={[styles.label, { color: chip.color }]}>{chip.label}</Text>
              ) : null}
              <Text style={[styles.value, group.id === 'time' && styles.timeValue]}>{chip.value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: Colors.surfaceDark,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    gap: 3,
  },
  bannerInspect: {
    backgroundColor: 'rgba(18, 20, 26, 0.98)',
    borderBottomColor: 'rgba(14, 164, 171, 0.35)',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    letterSpacing: 0.2,
  },
  value: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 10,
    color: Colors.textPrimary,
    marginLeft: 3,
  },
  timeValue: {
    color: Colors.goldLight,
    marginLeft: 0,
    fontFamily: FontFamily.monoMedium,
  },
});
