import { Platform } from 'react-native';

/** Shared WebView settings for in-app terminal surfaces (chart, order book). */
export const TERMINAL_WEBVIEW_PROPS = {
  originWhitelist: ['*'] as const,
  javaScriptEnabled: true,
  domStorageEnabled: true,
  scrollEnabled: false,
  bounces: false,
  overScrollMode: 'never' as const,
  showsHorizontalScrollIndicator: false,
  showsVerticalScrollIndicator: false,
  cacheEnabled: true,
  ...(Platform.OS === 'android'
    ? {
        allowFileAccess: true,
        allowFileAccessFromFileURLs: true,
        allowUniversalAccessFromFileURLs: true,
        mixedContentMode: 'always' as const,
      }
    : {}),
};

/** Chart WebView — software layer avoids GPU crashes with multiple WebViews. */
export const CHART_WEBVIEW_LAYER = 'none';

/** Order-book WebView — avoid dual hardware layers on the same screen (GPU crash). */
export const BOOK_WEBVIEW_LAYER = 'none';
