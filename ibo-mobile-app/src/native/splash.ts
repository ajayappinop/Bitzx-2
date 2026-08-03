import { NativeModules, Platform } from 'react-native';

type SplashNative = { hide: () => void };
const native: SplashNative | undefined = NativeModules.IboSplash;

/** Dismiss the native window-background splash immediately (Android only). */
export function hideNativeSplash(): void {
  if (Platform.OS === 'android') {
    native?.hide?.();
  }
}
