import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import AppIcon from './AppIcon';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
  labelStyle?: TextStyle;
  /** Auth screens: gold labels, larger radius, deeper field chrome. */
  variant?: 'default' | 'auth';
  /** Inline OTP rows: render only the bordered field (no outer label/margin). */
  fieldOnly?: boolean;
  rightElement?: React.ReactNode;
  leftIcon?: React.ReactNode;
}

export default function Input({
  label,
  error,
  hint,
  containerStyle,
  labelStyle,
  variant = 'default',
  fieldOnly = false,
  rightElement,
  leftIcon,
  secureTextEntry,
  ...rest
}: InputProps) {
  const [secure, setSecure] = useState(secureTextEntry ?? false);
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<View>(null);

  const hasError = !!error;
  const isAuth = variant === 'auth';

  const handleFocus = (e: Parameters<NonNullable<TextInputProps['onFocus']>>[0]) => {
    setFocused(true);
    rest.onFocus?.(e);
  };

  const rowHeight = isAuth ? 52 : 50;

  const inputRow = (
    <View
      style={[
        styles.inputRow,
        isAuth && styles.inputRowAuth,
        fieldOnly && { height: rowHeight, minHeight: rowHeight },
        focused && styles.inputFocused,
        hasError && styles.inputError,
      ]}
    >
      {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

      <TextInput
        {...rest}
        secureTextEntry={secure}
        onFocus={handleFocus}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        style={[
          styles.input,
          fieldOnly && styles.inputFieldOnly,
          leftIcon ? styles.inputWithLeft : undefined,
          rest.style,
        ]}
        placeholderTextColor={Colors.textMuted}
        selectionColor={Colors.gold}
        cursorColor={Colors.gold}
      />

      {secureTextEntry ? (
        <TouchableOpacity
          onPress={() => setSecure((p) => !p)}
          style={styles.rightBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={secure ? 'Show password' : 'Hide password'}
        >
          <AppIcon
            name={secure ? 'eye' : 'eye-off'}
            size={20}
            color={Colors.textSecondary}
          />
        </TouchableOpacity>
      ) : rightElement ? (
        <View style={styles.rightBtn}>{rightElement}</View>
      ) : null}
    </View>
  );

  if (fieldOnly) {
    return (
      <View ref={wrapperRef} collapsable={false} style={[styles.fieldOnlyWrap, containerStyle]}>
        {inputRow}
      </View>
    );
  }

  return (
    <View ref={wrapperRef} collapsable={false} style={[styles.wrapper, containerStyle]}>
      {label ? (
        <Text style={[isAuth ? styles.labelAuth : styles.label, labelStyle]}>{label}</Text>
      ) : null}

      {inputRow}

      {hasError && <Text style={styles.errorText}>{error}</Text>}
      {!hasError && hint && <Text style={styles.hintText}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: Spacing[4],
  },
  fieldOnlyWrap: {
    flex: 1,
    minWidth: 0,
  },
  inputFieldOnly: {
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing[1],
    letterSpacing: 0.2,
  },
  labelAuth: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    marginBottom: Spacing[2],
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    minHeight: 50,
  },
  inputRowAuth: {
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    minHeight: 52,
    borderColor: Colors.surfaceBorder,
  },
  inputFocused: {
    borderColor: Colors.goldAlpha30,
  },
  inputError: {
    borderColor: Colors.danger,
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.base,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  inputWithLeft: {
    paddingLeft: Spacing[2],
  },
  leftIcon: {
    paddingLeft: Spacing[3],
  },
  rightBtn: {
    paddingRight: Spacing[3],
    paddingLeft: Spacing[2],
  },
  errorText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.danger,
    marginTop: Spacing[1],
  },
  hintText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing[1],
  },
});
