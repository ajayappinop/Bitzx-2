import { Platform } from 'react-native';

/**
 * iOS: manual scroll only — no system keyboard inset / auto-scroll.
 * Keyboard stays open while the user scrolls (keyboardDismissMode: none).
 * Android: unchanged (windowSoftInputMode adjustResize).
 */
export function iosManualKeyboardScrollProps() {
  if (Platform.OS !== 'ios') {
    return { keyboardShouldPersistTaps: 'handled' as const };
  }
  return {
    keyboardShouldPersistTaps: 'handled' as const,
    keyboardDismissMode: 'none' as const,
    automaticallyAdjustKeyboardInsets: false,
    contentInsetAdjustmentBehavior: 'never' as const,
  };
}
