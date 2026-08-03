/**
 * TP/SL Settings — pick trigger condition for TP or SL inline field.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, Pressable,
} from 'react-native';
import Icon from '../common/AppIcon';
import { TP_SL_MODE_OPTIONS, type TpSlTriggerMode } from './tpSlTrigger';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { FuturesUi } from '../../theme/futuresTerminal';

type Props = {
  visible: boolean;
  value: TpSlTriggerMode;
  onClose: () => void;
  onSelect: (mode: TpSlTriggerMode) => void;
};

export default function TpSlSettingsModal({ visible, value, onClose, onSelect }: Props) {
  const [selected, setSelected] = useState<TpSlTriggerMode>(value);

  useEffect(() => {
    if (visible) setSelected(value);
  }, [visible, value]);

  const pick = (mode: TpSlTriggerMode) => {
    onSelect(mode);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>TP/SL Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Icon name="x" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.list}>
          {TP_SL_MODE_OPTIONS.map((opt) => {
            const active = selected === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.row, active && styles.rowActive]}
                onPress={() => pick(opt.key)}
                activeOpacity={0.85}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, active && styles.rowTitleActive]}>
                    {opt.title}
                  </Text>
                  <Text style={styles.rowSub}>{opt.subtitle}</Text>
                </View>
                {active ? (
                  <View style={styles.checkCircle}>
                    <Icon name="check" size={14} color={Colors.white} />
                  </View>
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
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
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
    borderColor: FuturesUi.long,
    backgroundColor: FuturesUi.longDim,
  },
  rowText: {
    flex: 1,
    paddingRight: Spacing[3],
  },
  rowTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  rowTitleActive: {
    color: Colors.textPrimary,
  },
  rowSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: FuturesUi.long,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSpacer: {
    width: 22,
    height: 22,
  },
});
