import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import AppIcon from '../common/AppIcon';
import { Colors, Radius } from '../../theme';
import { LayoutColors } from '../../theme/colors';

type Props = {
  activeCount?: number;
  onOpenIndicators: () => void;
};

/** Icon-only Indicators control (TradingView-style). */
export default function ChartMiniIndicatorBar({
  activeCount = 0,
  onOpenIndicators,
}: Props) {
  const on = activeCount > 0;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.tab, on && styles.tabActive]}
        onPress={onOpenIndicators}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Chart settings"
        hitSlop={6}
      >
        <AppIcon
          name="analytics-outline"
          size={18}
          color={on ? LayoutColors.marketUp : Colors.goldLight}
        />
        {on ? <View style={styles.dot} /> : null}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    width: 32,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  tabActive: {
    borderColor: LayoutColors.marketUp,
    backgroundColor: 'rgba(14,203,129,0.12)',
  },
  dot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: LayoutColors.marketUp,
  },
});
