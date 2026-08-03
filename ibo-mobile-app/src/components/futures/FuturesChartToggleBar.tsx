import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '@/theme';

type Props = {
  title: string;
  expanded?: boolean;
  /** Top bar when collapsed; bottom bar when expanded on trade screen. */
  placement?: 'top' | 'bottom';
  onToggle?: () => void;
  onOpenChart?: () => void;
  /** Opens full-screen chart — shown on the bar, away from the price scale. */
  onExpand?: () => void;
};

export default function FuturesChartToggleBar({
  title,
  expanded = false,
  placement = 'top',
  onToggle,
  onOpenChart,
  onExpand,
}: Props) {
  const chevron = expanded
    ? (placement === 'bottom' ? 'chevron-up' : 'chevron-down')
    : (placement === 'bottom' ? 'chevron-down' : 'chevron-up');

  const handleToggle = onToggle ?? onOpenChart;

  return (
    <View style={[styles.bar, placement === 'bottom' && styles.barBottom]}>
      <Text style={styles.label} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.actions}>
        {onExpand ? (
          <TouchableOpacity
            style={styles.expandBtn}
            onPress={onExpand}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Expand chart"
            accessibilityRole="button"
          >
            <Icon name="fullscreen" size={14} color={Colors.goldLight} />
            <Text style={styles.expandText}>Expand</Text>
          </TouchableOpacity>
        ) : null}
        {handleToggle ? (
          <TouchableOpacity
            style={styles.toggleBtn}
            onPress={handleToggle}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide chart' : 'Show chart'}
          >
            <Text style={styles.action}>{expanded ? 'Hide' : 'Show'}</Text>
            <Icon name={chevron} size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing[2],
    backgroundColor: Colors.surface,
  },
  barBottom: {
    marginTop: Spacing[1],
    paddingTop: Spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
  },
  label: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginRight: Spacing[2],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flexShrink: 0,
  },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  expandText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingLeft: 4,
  },
  action: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
});
