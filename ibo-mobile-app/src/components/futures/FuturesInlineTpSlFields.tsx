/**
 * Inline TP/SL inputs — TP / SL fields with per-leg trigger mode selectors.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import TerminalNumericInput from '../trading/TerminalNumericInput';
import Icon from '../common/AppIcon';
import TpSlSettingsModal from './TpSlSettingsModal';
import {
  TP_SL_MODE_SHORT,
  tpSlFieldLabel,
  tpSlFieldPlaceholder,
  type TpSlLeg,
  type TpSlTriggerMode,
} from './tpSlTrigger';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';

type Props = {
  tpPrice: string;
  onTpPriceChange: (v: string) => void;
  slPrice: string;
  onSlPriceChange: (v: string) => void;
  tpMode: TpSlTriggerMode;
  slMode: TpSlTriggerMode;
  onTpModeChange: (mode: TpSlTriggerMode) => void;
  onSlModeChange: (mode: TpSlTriggerMode) => void;
};

function TpSlField({
  leg,
  mode,
  value,
  onChangeText,
  onModePress,
}: {
  leg: TpSlLeg;
  mode: TpSlTriggerMode;
  value: string;
  onChangeText: (v: string) => void;
  onModePress: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{tpSlFieldLabel(leg, mode)}</Text>
      <View style={styles.inputBox}>
        <TerminalNumericInput
          style={styles.input}
          align="center"
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChangeText}
          placeholder={tpSlFieldPlaceholder(mode)}
          placeholderTextColor={Colors.textDisabled}
          selectionColor={Colors.gold}
        />
      </View>
      <TouchableOpacity style={styles.modeBtn} onPress={onModePress} activeOpacity={0.8}>
        <Text style={styles.modeTxt} numberOfLines={1}>
          {TP_SL_MODE_SHORT[mode]}
        </Text>
        <Icon name="chevron-down" size={12} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

export default function FuturesInlineTpSlFields({
  tpPrice,
  onTpPriceChange,
  slPrice,
  onSlPriceChange,
  tpMode,
  slMode,
  onTpModeChange,
  onSlModeChange,
}: Props) {
  const [settingsLeg, setSettingsLeg] = useState<TpSlLeg | null>(null);

  const closeSettings = () => setSettingsLeg(null);

  const handleModeSelect = (mode: TpSlTriggerMode) => {
    if (settingsLeg === 'tp') {
      if (mode !== tpMode) {
        onTpModeChange(mode);
        onTpPriceChange('');
      }
    } else if (settingsLeg === 'sl') {
      if (mode !== slMode) {
        onSlModeChange(mode);
        onSlPriceChange('');
      }
    }
    closeSettings();
  };

  return (
    <View style={styles.wrap}>
      <TpSlField
        leg="tp"
        mode={tpMode}
        value={tpPrice}
        onChangeText={onTpPriceChange}
        onModePress={() => setSettingsLeg('tp')}
      />
      <TpSlField
        leg="sl"
        mode={slMode}
        value={slPrice}
        onChangeText={onSlPriceChange}
        onModePress={() => setSettingsLeg('sl')}
      />

      <TpSlSettingsModal
        visible={settingsLeg !== null}
        value={settingsLeg === 'tp' ? tpMode : slMode}
        onClose={closeSettings}
        onSelect={handleModeSelect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
    width: '100%',
    marginTop: 0,
    marginBottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    width: 56,
  },
  inputBox: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    minHeight: 40,
    justifyContent: 'center',
  },
  input: {
    paddingVertical: 6,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 68,
    maxWidth: 78,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  modeTxt: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
