/**
 * Custom margin mode picker — Cross vs Isolated (replaces system Alert).
 * Optimistic apply: UI updates and modal closes immediately; API runs in background.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Alert,
} from 'react-native';
import Icon from '../common/AppIcon';
import Button from '../common/Button';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { MarginMode } from '../../types/futures.types';
import { parseApiError } from '../../api/errors';
import { futuresApi } from '../../api/futures.api';
import { toSpotSymbol } from '../../utils/tradeSymbols';

type ModeOption = {
  key: MarginMode;
  title: string;
  summary: string;
  bullets: string[];
};

const OPTIONS: ModeOption[] = [
  {
    key: 'cross',
    title: 'Cross',
    summary: 'Shared margin across all positions',
    bullets: [
      'Wallet balance is shared by open positions',
      'Unrealized PnL can offset margin requirements',
      'Typically higher capital efficiency',
    ],
  },
  {
    key: 'isolated',
    title: 'Isolated',
    summary: 'Dedicated margin per position',
    bullets: [
      'Each position uses its own allocated margin',
      'Liquidation risk is limited to that position',
      'You may need to close positions before switching',
    ],
  },
];

type Props = {
  visible: boolean;
  currentMode: MarginMode;
  symbol: string;
  onClose: () => void;
  onApplied: (mode: MarginMode) => void;
};

export default function MarginModePickerModal({
  visible,
  currentMode,
  symbol,
  onClose,
  onApplied,
}: Props) {
  const [selected, setSelected] = useState<MarginMode>(currentMode);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setSelected(currentMode);
      setError('');
    }
  }, [visible, currentMode]);

  const applyMode = useCallback(async (mode: MarginMode) => {
    if (mode === currentMode) {
      onClose();
      return;
    }
    setSelected(mode);
    setError('');
    onApplied(mode);
    onClose();
    try {
      const res = await futuresApi.setMarginMode(symbol, mode);
      const applied = ((res.data as { margin_mode?: MarginMode })?.margin_mode ?? mode) as MarginMode;
      if (applied !== mode) onApplied(applied);
    } catch (err) {
      onApplied(currentMode);
      Alert.alert('Margin mode', parseApiError(err).message);
    }
  }, [currentMode, symbol, onApplied, onClose]);

  const handleConfirm = useCallback(() => {
    void applyMode(selected);
  }, [applyMode, selected]);

  const spot = toSpotSymbol(symbol);
  const pairLabel = spot.includes('/')
    ? spot
    : spot.replace(/USDT$/, '/USDT').replace(/BTC$/, '/BTC').replace(/ETH$/, '/ETH') || spot;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Margin mode</Text>
            <Text style={styles.subtitle}>{pairLabel} perpetual</Text>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Icon name="close" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.options}>
          {OPTIONS.map((opt) => {
            const active = selected === opt.key;
            const isCurrent = currentMode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.optionCard, active && styles.optionCardActive]}
                onPress={() => void applyMode(opt.key)}
                activeOpacity={0.85}
              >
                <View style={styles.optionTop}>
                  <View style={styles.optionTitleRow}>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active && <View style={styles.radioDot} />}
                    </View>
                    <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>
                      {opt.title}
                    </Text>
                    {isCurrent && (
                      <View style={styles.currentPill}>
                        <Text style={styles.currentPillTxt}>Current</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.optionSummary}>{opt.summary}</Text>
                </View>
                {opt.bullets.map((line) => (
                  <View key={line} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletTxt}>{line}</Text>
                  </View>
                ))}
              </TouchableOpacity>
            );
          })}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Icon name="alert-circle-outline" size={16} color={Colors.sellRed} />
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button
            title={selected === currentMode ? 'Done' : 'Apply'}
            onPress={handleConfirm}
          />
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
    paddingBottom: Spacing[6],
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center',
    marginTop: Spacing[2],
    marginBottom: Spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[3],
  },
  headerText: { flex: 1, paddingRight: Spacing[2] },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: Colors.surfaceHover,
  },
  options: {
    paddingHorizontal: Spacing[4],
    gap: Spacing[3],
  },
  optionCard: {
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  optionCardActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldAlpha10,
  },
  optionTop: { marginBottom: Spacing[2] },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[2],
  },
  radioActive: {
    borderColor: Colors.gold,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.gold,
  },
  optionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textSecondary,
  },
  optionTitleActive: {
    color: Colors.goldLight,
  },
  currentPill: {
    marginLeft: Spacing[2],
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    backgroundColor: Colors.goldAlpha15,
  },
  currentPillTxt: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.goldLight,
  },
  optionSummary: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginLeft: 18 + Spacing[2],
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
    marginLeft: 18 + Spacing[2],
  },
  bulletDot: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginRight: 6,
    lineHeight: 16,
  },
  bulletTxt: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    marginHorizontal: Spacing[4],
    marginTop: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: Colors.sellRedDim,
    borderWidth: 1,
    borderColor: Colors.sellRedDim,
  },
  errorTxt: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.sellRed,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing[3],
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
  },
});
