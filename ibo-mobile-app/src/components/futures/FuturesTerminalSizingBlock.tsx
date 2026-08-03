/**
 * Binance-style futures sizing: editable size + unit settings, hint, % slider.
 */
import React, { useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import Icon from '../common/AppIcon';
import StableTerminalPctSlider from '../trading/StableTerminalPctSlider';
import TerminalNumericInput from '../trading/TerminalNumericInput';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { FuturesUi } from '../../theme/futuresTerminal';
import type { SizingDisplay } from '../../utils/futuresOrderSizing';

type Props = {
  side: 'buy' | 'sell';
  sliderResetKey: string;
  unitLabel: string;
  sizingHint: SizingDisplay;
  primaryValue: string;
  onPrimaryChange: (value: string) => void;
  sliderPct: number;
  onPctLive: (pct: number) => void;
  onOpenSettings: () => void;
  settingsEnabled?: boolean;
  onStepQty?: (delta: number) => void;
  onLockParentScroll?: (locked: boolean) => void;
};

function fmtHint(n: number, unit: string): string {
  if (!Number.isFinite(n) || n <= 0) return '0.0000';
  if (unit === 'Cont') return n.toFixed(0);
  if (unit === 'USDT') return n.toFixed(2);
  return n.toFixed(4);
}

export default function FuturesTerminalSizingBlock({
  side,
  sliderResetKey,
  unitLabel,
  sizingHint,
  primaryValue,
  onPrimaryChange,
  sliderPct,
  onPctLive,
  onOpenSettings,
  settingsEnabled = true,
  onStepQty,
  onLockParentScroll,
}: Props) {
  const accent = side === 'buy' ? FuturesUi.long : Colors.sellRed;

  const handleSliderLive = useCallback((pct: number) => {
    onPctLive(pct);
  }, [onPctLive]);

  return (
    <View style={styles.wrap} collapsable={false}>
      <View style={styles.sizeRow}>
        {onStepQty ? (
          <TouchableOpacity style={styles.stepBtn} onPress={() => onStepQty(-1)} hitSlop={6}>
            <Text style={styles.stepTxt}>−</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.primaryBox}>
          <TerminalNumericInput
            style={styles.primaryInput}
            align="center"
            baseFontSize={FontSize.sm}
            keyboardType="decimal-pad"
            value={primaryValue}
            onChangeText={onPrimaryChange}
            placeholder="0"
            placeholderTextColor={Colors.textDisabled}
            selectionColor={Colors.gold}
          />
        </View>
        {onStepQty ? (
          <TouchableOpacity style={styles.stepBtn} onPress={() => onStepQty(1)} hitSlop={6}>
            <Text style={styles.stepTxt}>+</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.unitBtn, !settingsEnabled && styles.unitBtnStatic]}
          onPress={settingsEnabled ? onOpenSettings : undefined}
          activeOpacity={settingsEnabled ? 0.85 : 1}
          disabled={!settingsEnabled}
        >
          <Text style={styles.unitBtnTxt}>{unitLabel}</Text>
          {settingsEnabled ? (
            <Icon name="chevron-down" size={14} color={Colors.textMuted} />
          ) : null}
        </TouchableOpacity>
      </View>

      <Text style={styles.hintLine}>
        <Text style={styles.hintMuted}>≈ </Text>
        <Text style={[styles.hintVal, { color: FuturesUi.longLight }]}>
          {fmtHint(sizingHint.current, sizingHint.unit)}
        </Text>
        <Text style={styles.hintMuted}> / </Text>
        <Text style={styles.hintVal}>
          {fmtHint(sizingHint.max, sizingHint.unit)}
        </Text>
        <Text style={styles.hintMuted}> {sizingHint.unit}</Text>
        {sliderPct > 0 ? (
          <Text style={styles.hintMuted}> · {sliderPct}%</Text>
        ) : null}
      </Text>

      <View style={styles.sliderWrap}>
        <StableTerminalPctSlider
          resetKey={sliderResetKey}
          side={side}
          hidePctInput
          syncPct={sliderPct}
          onLiveChange={handleSliderLive}
          onChange={handleSliderLive}
          size="large"
          onLockParentScroll={onLockParentScroll}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexShrink: 0,
    gap: Spacing[1],
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing[1],
  },
  stepBtn: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    minHeight: 40,
  },
  stepTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  primaryBox: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    justifyContent: 'center',
    minHeight: 40,
  },
  primaryInput: {
    paddingVertical: 0,
  },
  unitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: Spacing[2],
    minWidth: 56,
    flexShrink: 0,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    minHeight: 40,
  },
  unitBtnTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  unitBtnStatic: {
    opacity: 0.85,
  },
  hintLine: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    marginTop: 2,
    marginBottom: 2,
  },
  hintMuted: {
    color: Colors.textMuted,
  },
  hintVal: {
    color: Colors.textSecondary,
  },
  sliderWrap: {
    flexShrink: 0,
    minHeight: 52,
  },
});
