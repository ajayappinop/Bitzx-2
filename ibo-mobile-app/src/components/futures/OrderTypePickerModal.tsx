/**
 * Futures order type picker — themed bottom sheet with close button.
 */
import React from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, Pressable,
} from 'react-native';
import Icon from '../common/AppIcon';
import FuturesOrderTypeIcon from './FuturesOrderTypeIcon';
import { FUTURES_ORDER_TYPE_OPTIONS, type FuturesOrderType } from './futuresOrderTypes';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';

export type { FuturesOrderType } from './futuresOrderTypes';

type Props = {
  visible: boolean;
  value: FuturesOrderType;
  onClose: () => void;
  onSelect: (type: FuturesOrderType) => void;
};

export default function OrderTypePickerModal({
  visible, value, onClose, onSelect,
}: Props) {
  const pick = (type: FuturesOrderType) => {
    onSelect(type);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>Basic Orders</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Icon name="x" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.list}>
          {FUTURES_ORDER_TYPE_OPTIONS.map((opt) => {
            const active = value === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.row, active && styles.rowActive]}
                onPress={() => pick(opt.key)}
                activeOpacity={0.85}
              >
                <View style={styles.iconContainer}>
                  <FuturesOrderTypeIcon type={opt.key} active={active} size={28} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, active && styles.rowTitleActive]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={2}>{opt.subtitle}</Text>
                </View>
                {active ? (
                  <Icon name="check" size={18} color={Colors.goldLight} />
                ) : (
                  <View style={styles.checkSpacer} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.black60,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.surfaceBorder,
    paddingBottom: Spacing[8],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center',
    marginTop: Spacing[2],
    marginBottom: Spacing[1],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: Spacing[3],
    paddingTop: Spacing[2],
    gap: Spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  rowActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldAlpha10,
  },
  iconContainer: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[3],
  },
  rowText: { flex: 1, paddingRight: Spacing[2] },
  rowTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: 3,
  },
  rowTitleActive: { color: Colors.goldLight },
  rowSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  checkSpacer: { width: 18 },
});
