import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';

interface Props {
  title: string;
  onBack?: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
  rightLabel?: string;
  subtitle?: string;
}

export default function ScreenHeader({ title, onBack, rightIcon, onRightPress, rightLabel, subtitle }: Props) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <TouchableOpacity style={styles.sideBtn} onPress={onBack} activeOpacity={0.7}>
          <Icon name="arrow-left" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.sideBtn} />
      )}
      <View style={styles.titleBox}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {(rightIcon || rightLabel) ? (
        <TouchableOpacity style={[styles.sideBtn, styles.rightBtn]} onPress={onRightPress} activeOpacity={0.7}>
          {rightIcon && <Icon name={rightIcon} size={22} color={Colors.goldLight} />}
          {rightLabel && !rightIcon && <Text style={styles.rightLabel}>{rightLabel}</Text>}
        </TouchableOpacity>
      ) : (
        <View style={styles.sideBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  sideBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rightBtn: {},
  titleBox: { flex: 1, alignItems: 'center' },
  title: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary },
  subtitle: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  rightLabel: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.goldLight },
});
