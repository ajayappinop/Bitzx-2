/**
 * ErrorBanner — mirrors authFormBannerMessage pattern from web exchange.
 * Displays inline error/success/warning messages within forms.
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

type BannerType = 'error' | 'success' | 'warning' | 'info';

const TONE = {
  error: { bg: Colors.dangerDim, border: 'rgba(239,68,68,0.25)', text: '#fca5a5' },
  success: { bg: Colors.successDim, border: 'rgba(34,197,94,0.25)', text: '#86efac' },
  warning: { bg: Colors.warningDim, border: 'rgba(245,158,11,0.25)', text: '#fde68a' },
  info: { bg: Colors.infoDim, border: 'rgba(59,130,246,0.25)', text: '#93c5fd' },
};

interface ErrorBannerProps {
  message: string | null | undefined;
  type?: BannerType;
  style?: ViewStyle;
}

export default function ErrorBanner({ message, type = 'error', style }: ErrorBannerProps) {
  if (!message) return null;
  const t = TONE[type];

  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      <Text style={[styles.text, { color: t.text }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[3],
    marginBottom: Spacing[4],
  },
  text: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
});
