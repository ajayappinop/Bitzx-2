/**
 * Compact terminal numeric field — scales down long amounts so values stay visible
 * without horizontal scrolling inside the input.
 */
import React, { useMemo } from 'react';
import {
  TextInput,
  Platform,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { Colors, FontFamily, FontSize } from '../../theme';

const MIN_FONT = 9;

export function terminalNumericFontSize(value: string, base = FontSize.sm): number {
  const len = (value || '').replace(/\s/g, '').length;
  if (len <= 8) return base;
  if (len <= 11) return base - 1;
  if (len <= 14) return base - 2;
  if (len <= 17) return base - 3;
  if (len <= 20) return base - 4;
  return Math.max(MIN_FONT, base - 5);
}

type Props = TextInputProps & {
  textStyle?: StyleProp<TextStyle>;
  align?: 'left' | 'center' | 'right';
  baseFontSize?: number;
};

export default function TerminalNumericInput({
  value,
  style,
  textStyle,
  align = 'center',
  baseFontSize = FontSize.sm,
  ...rest
}: Props) {
  const fontSize = useMemo(
    () => terminalNumericFontSize(String(value ?? ''), baseFontSize),
    [value, baseFontSize],
  );

  return (
    <TextInput
      {...rest}
      value={value}
      style={[styles.input, { fontSize, textAlign: align }, style, textStyle]}
      adjustsFontSizeToFit={Platform.OS === 'ios'}
      minimumFontScale={0.5}
      numberOfLines={1}
      scrollEnabled={false}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    fontFamily: FontFamily.monoMedium,
    color: Colors.textPrimary,
    paddingVertical: 0,
    marginVertical: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false as const } : null),
  },
});
