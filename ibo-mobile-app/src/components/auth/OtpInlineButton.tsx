import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'outline' | 'solid';
  style?: ViewStyle;
};

export default function OtpInlineButton({
  label, onPress, loading = false, variant = 'outline', style,
}: Props) {
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        variant === 'solid' ? styles.solid : styles.outline,
        loading && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'solid' ? Colors.surfaceDark : Colors.goldLight} />
      ) : (
        <Text style={[styles.txt, variant === 'solid' ? styles.txtSolid : styles.txtOutline]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: Spacing[3],
    minHeight: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outline: {
    borderWidth: 1,
    borderColor: Colors.gold + '66',
    backgroundColor: Colors.gold + '14',
  },
  solid: {
    backgroundColor: Colors.gold,
  },
  disabled: { opacity: 0.65 },
  txt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
  },
  txtOutline: { color: Colors.goldLight },
  txtSolid: { color: Colors.surfaceDark },
});
