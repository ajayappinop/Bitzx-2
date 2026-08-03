import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '@/theme';
import { FuturesUi } from '@/theme/futuresTerminal';

type SideBlock = {
  maxLabel: string;
  maxValue: string;
  marginLabel: string;
  marginValue: string;
  buttonLabel: string;
  onPress?: () => void;
  variant: 'long' | 'short';
  disabled?: boolean;
};

type KycGate = {
  buttonLabel: string;
  message: string;
  onPress: () => void;
};

type Props = {
  long: SideBlock;
  short: SideBlock;
  /** @deprecated use placingLong / placingShort */
  placing?: boolean;
  placingLong?: boolean;
  placingShort?: boolean;
  disabled?: boolean;
  /** Reference-sized buttons/meta for futures terminal. */
  size?: 'default' | 'large';
  /** When set, replace Long/Short CTAs with one verify button + message pill. */
  kycGate?: KycGate | null;
};

function SideSubmit({
  maxLabel,
  maxValue,
  marginLabel,
  marginValue,
  buttonLabel,
  onPress,
  variant,
  placing,
  disabled,
  large,
}: SideBlock & { placing?: boolean; disabled?: boolean; large?: boolean }) {
  const isLong = variant === 'long';
  const sideDisabled = disabled || !onPress;
  return (
    <View style={[styles.block, large && styles.blockLarge]}>
      <View style={styles.metaRow}>
        <Text style={[styles.metaLbl, large && styles.metaLblLarge]}>{maxLabel}</Text>
        <Text style={[styles.metaVal, large && styles.metaValLarge]}>{maxValue}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={[styles.metaLbl, large && styles.metaLblLarge]}>{marginLabel}</Text>
        <Text style={[styles.metaVal, large && styles.metaValLarge]}>{marginValue}</Text>
      </View>
      <TouchableOpacity
        style={[
          styles.btn,
          large && styles.btnLarge,
          isLong ? styles.btnLong : styles.btnShort,
          disabled && styles.btnDisabled,
          sideDisabled && styles.btnDisabled,
        ]}
        onPress={onPress ?? (() => {})}
        disabled={sideDisabled || placing}
        activeOpacity={0.88}
      >
        {placing ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={[styles.btnTxt, large && styles.btnTxtLarge]}>{buttonLabel}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function FuturesStackedSubmit({
  long,
  short,
  placing,
  placingLong,
  placingShort,
  disabled,
  size = 'default',
  kycGate = null,
}: Props) {
  const longBusy = placingLong ?? placing ?? false;
  const shortBusy = placingShort ?? placing ?? false;
  const large = size === 'large';

  if (kycGate) {
    return (
      <View style={[styles.wrap, large && styles.wrapLarge]}>
        <TouchableOpacity
          style={[styles.kycBtnFull, large && styles.kycBtnFullLarge]}
          onPress={kycGate.onPress}
          activeOpacity={0.88}
        >
          <Text style={[styles.btnTxt, large && styles.btnTxtLarge]} numberOfLines={1}>
            {kycGate.buttonLabel}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, large && styles.wrapLarge]}>
      <SideSubmit
        {...long}
        variant="long"
        placing={longBusy}
        disabled={disabled || long.disabled}
        large={large}
      />
      <SideSubmit
        {...short}
        variant="short"
        placing={shortBusy}
        disabled={disabled || short.disabled}
        large={large}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing[1],
    paddingHorizontal: Spacing[1],
    paddingTop: 0,
    paddingBottom: 0,
  },
  wrapLarge: {
    gap: Spacing[2],
    paddingHorizontal: 0,
  },
  block: {
    gap: 2,
  },
  blockLarge: {
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  metaLbl: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  metaLblLarge: {
    fontSize: FontSize.sm,
  },
  metaVal: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  metaValLarge: {
    fontSize: FontSize.sm,
  },
  btn: {
    borderRadius: Radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  btnLarge: {
    paddingVertical: FuturesUi.form.ctaPadV,
    minHeight: FuturesUi.form.ctaMinH,
    borderRadius: Radius.lg,
  },
  btnLong: {
    backgroundColor: FuturesUi.long,
  },
  btnShort: {
    backgroundColor: FuturesUi.short,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.white,
    letterSpacing: 0.3,
  },
  btnTxtLarge: {
    fontSize: FontSize.base,
  },
  kycBtnFull: {
    width: '100%',
    borderRadius: Radius.md,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: 44,
  },
  kycBtnFullLarge: {
    paddingVertical: FuturesUi.form.ctaPadV,
    minHeight: FuturesUi.form.ctaMinH,
    borderRadius: Radius.lg,
  },
});
