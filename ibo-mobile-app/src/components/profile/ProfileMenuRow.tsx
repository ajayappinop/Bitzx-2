import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';

type Props = {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  showArrow?: boolean;
  danger?: boolean;
  badge?: string;
  badgeColor?: string;
  isLast?: boolean;
};

export default function ProfileMenuRow({
  icon, label, subtitle, onPress, showArrow = true, danger = false, badge, badgeColor, isLast,
}: Props) {
  return (
    <TouchableOpacity
      style={[styles.row, isLast && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <View style={[styles.iconBox, danger && styles.iconBoxDanger]}>
        <Icon
          name={icon as any}
          size={18}
          color={danger ? Colors.danger : Colors.goldLight}
        />
      </View>
      <View style={styles.content}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, danger && styles.labelDanger]} numberOfLines={1}>
            {label}
          </Text>
          {badge ? (
            <View style={[styles.badge, badgeColor ? { borderColor: badgeColor + '50', backgroundColor: badgeColor + '18' } : null]}>
              <Text style={[styles.badgeTxt, badgeColor ? { color: badgeColor } : null]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
        ) : null}
      </View>
      {showArrow && (
        <Icon name="chevron-right" size={20} color={Colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  rowLast: { borderBottomWidth: 0 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.lg,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[3],
  },
  iconBoxDanger: {
    backgroundColor: Colors.dangerDim ?? Colors.sellRedDim,
    borderColor: Colors.danger + '40',
  },
  content: { flex: 1, minWidth: 0, marginRight: Spacing[2] },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  label: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  labelDanger: { color: Colors.danger },
  subtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  badge: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  badgeTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
