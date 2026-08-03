import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'buy' | 'sell' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
  /** Shown after title when not loading (e.g. arrow icon). */
  endIcon?: React.ReactNode;
}

const sizeStyles: Record<Size, { paddingVertical: number; paddingHorizontal: number; fontSize: number }> = {
  sm: { paddingVertical: 8, paddingHorizontal: 16, fontSize: FontSize.sm },
  md: { paddingVertical: 13, paddingHorizontal: 24, fontSize: FontSize.base },
  lg: { paddingVertical: 16, paddingHorizontal: 32, fontSize: FontSize.lg },
};

const variantStyles: Record<Variant, { bg: string; border: string; text: string }> = {
  primary: { bg: Colors.gold, border: Colors.gold, text: Colors.surfaceDark },
  secondary: { bg: Colors.surfaceCard, border: Colors.surfaceBorder, text: Colors.textPrimary },
  ghost: { bg: Colors.transparent, border: Colors.surfaceBorder, text: Colors.textSecondary },
  danger: { bg: Colors.dangerDim, border: Colors.danger, text: Colors.danger },
  buy: { bg: Colors.buyGreenDim, border: Colors.buyGreen, text: Colors.buyGreen },
  sell: { bg: Colors.sellRedDim, border: Colors.sellRed, text: Colors.sellRed },
  outline: { bg: Colors.transparent, border: Colors.surfaceBorder, text: Colors.textPrimary },
};

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = false,
  endIcon,
}: ButtonProps) {
  const v = variantStyles[variant];
  const s = sizeStyles[size];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          opacity: isDisabled ? 0.5 : 1,
          width: fullWidth ? '100%' : undefined,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : (
        <View style={styles.labelRow}>
          <Text
            style={[
              styles.label,
              { color: v.text, fontSize: s.fontSize },
              variant === 'primary' && styles.primaryLabel,
              textStyle,
            ]}
          >
            {title}
          </Text>
          {endIcon ? <View style={styles.endIcon}>{endIcon}</View> : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 44,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endIcon: { marginLeft: Spacing[2] },
  label: {
    fontFamily: FontFamily.semiBold,
    letterSpacing: -0.2,
  },
  primaryLabel: {
    fontFamily: FontFamily.bold,
  },
});
