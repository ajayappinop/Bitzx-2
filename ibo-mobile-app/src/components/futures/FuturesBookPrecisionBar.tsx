import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '@/theme';

type Props = {
  tickLabel: string;
  onPress?: () => void;
};

export default function FuturesBookPrecisionBar({ tickLabel, onPress }: Props) {
  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.precisionBtn} onPress={onPress} activeOpacity={0.8}>
        <Text style={styles.precisionTxt}>{tickLabel}</Text>
        <Icon name="chevron-down" size={12} color={Colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.gridBtn} hitSlop={8}>
        <Icon name="view-dashboard-outline" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[2],
    paddingTop: 4,
    paddingBottom: 2,
    gap: Spacing[2],
  },
  precisionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing[2],
    paddingVertical: 5,
  },
  precisionTxt: {
    fontFamily: FontFamily.mono,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  gridBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
});
