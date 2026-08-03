import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  View,
  type KeyboardAvoidingViewProps,
} from 'react-native';

/** iOS: no auto keyboard padding (manual scroll). Android: standard KeyboardAvoidingView. */
export default function AdaptiveKeyboardAvoidingView({
  children,
  behavior,
  keyboardVerticalOffset,
  enabled,
  ...rest
}: KeyboardAvoidingViewProps) {
  if (Platform.OS === 'ios') {
    return <View {...rest}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
      enabled={enabled}
      {...rest}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
