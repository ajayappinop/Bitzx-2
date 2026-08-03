/**
 * Binance-style futures order sizing settings — By Amount (USDT / base / Cont) or By Cost.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import Icon from '../common/AppIcon';
import Button from '../common/Button';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { FuturesUi } from '../../theme/futuresTerminal';
import type { FuturesAmountUnit, FuturesSizingMode } from '../../types/futuresOrderSizing.types';

type Props = {
  visible: boolean;
  baseAsset: string;
  mode: FuturesSizingMode;
  amountUnit: FuturesAmountUnit;
  onClose: () => void;
  onConfirm: (mode: FuturesSizingMode, amountUnit: FuturesAmountUnit) => void;
};

const AMOUNT_UNITS: { key: FuturesAmountUnit; label: (base: string) => string }[] = [
  { key: 'USDT', label: () => 'USDT' },
  { key: 'BASE', label: (base) => base },
  { key: 'CONT', label: () => 'Cont' },
];

export default function FuturesOrderSettingsModal({
  visible,
  baseAsset,
  mode,
  amountUnit,
  onClose,
  onConfirm,
}: Props) {
  const [draftMode, setDraftMode] = useState<FuturesSizingMode>(mode);
  const [draftUnit, setDraftUnit] = useState<FuturesAmountUnit>(amountUnit);

  useEffect(() => {
    if (visible) {
      setDraftMode(mode);
      setDraftUnit(amountUnit);
    }
  }, [visible, mode, amountUnit]);

  const handleConfirm = useCallback(() => {
    onConfirm(draftMode, draftUnit);
    onClose();
  }, [draftMode, draftUnit, onConfirm, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>Order Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Icon name="x" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.modeRow}
          onPress={() => setDraftMode('amount')}
          activeOpacity={0.85}
        >
          <View style={[styles.radio, draftMode === 'amount' && styles.radioOn]}>
            {draftMode === 'amount' ? <View style={styles.radioDot} /> : null}
          </View>
          <View style={styles.modeText}>
            <Text style={styles.modeTitle}>By Amount</Text>
            <Text style={styles.modeSub}>
              Place an order by amount. Costs will change accordingly when you adjust the leverage.
            </Text>
            {draftMode === 'amount' ? (
              <View style={styles.unitRow}>
                {AMOUNT_UNITS.map((u) => {
                  const active = draftUnit === u.key;
                  return (
                    <TouchableOpacity
                      key={u.key}
                      style={[styles.unitChip, active && styles.unitChipOn]}
                      onPress={() => setDraftUnit(u.key)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.unitChipTxt, active && styles.unitChipTxtOn]}>
                        {u.label(baseAsset)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modeRow}
          onPress={() => setDraftMode('cost')}
          activeOpacity={0.85}
        >
          <View style={[styles.radio, draftMode === 'cost' && styles.radioOn]}>
            {draftMode === 'cost' ? <View style={styles.radioDot} /> : null}
          </View>
          <View style={styles.modeText}>
            <Text style={styles.modeTitle}>By Cost (USDT)</Text>
            <Text style={styles.modeSub}>
              Place an order by cost (trading fee included). Cost won&apos;t change when you adjust the leverage.
            </Text>
          </View>
        </TouchableOpacity>

        <Button title="Confirm" onPress={handleConfirm} style={styles.confirmBtn} />
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
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[6],
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    marginTop: Spacing[2],
    marginBottom: Spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[4],
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  closeBtn: {
    padding: Spacing[1],
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    marginBottom: Spacing[4],
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioOn: {
    borderColor: FuturesUi.long,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: FuturesUi.long,
  },
  modeText: {
    flex: 1,
  },
  modeTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  modeSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  unitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginTop: Spacing[3],
  },
  unitChip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  unitChipOn: {
    backgroundColor: FuturesUi.longDim,
    borderColor: FuturesUi.long,
  },
  unitChipTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  unitChipTxtOn: {
    color: FuturesUi.longLight,
  },
  confirmBtn: {
    marginTop: Spacing[2],
  },
});
