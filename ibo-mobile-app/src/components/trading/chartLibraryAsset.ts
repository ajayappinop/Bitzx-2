import { Platform } from 'react-native';

const CHART_CDN =
  'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';

/**
 * LW Charts script URL for the chart WebView.
 * CDN is primary — most reliable across debug/release builds.
 * Android asset copy remains as offline fallback in chart HTML bootstrap.
 */
export function chartLibraryScriptSrc(): string {
  return CHART_CDN;
}

/** Optional bundled script (offline fallback), relative to android_asset/. */
export function chartLibraryAssetSrc(): string | null {
  return Platform.OS === 'android' ? 'chart/lightweight-charts.standalone.js' : null;
}

export function chartLibraryCdnSrc(): string {
  return CHART_CDN;
}

/** WebView baseUrl so the chart script resolves on Android assets. */
export function chartWebViewBaseUrl(): string | undefined {
  if (Platform.OS === 'android') {
    return 'file:///android_asset/';
  }
  return undefined;
}
