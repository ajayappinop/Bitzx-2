import { Platform } from 'react-native';
import Config from 'react-native-config';

/** Live API — same host as web exchange production */
export const PROD_API_ORIGIN = 'https://api.ibo.io';
export const PROD_WS_ORIGIN = 'wss://api.ibo.io';

/**
 * Normalize API base URL — mirrors exchangeApiOrigin() from apiBase.js.
 * Strips trailing slashes and duplicate /api suffix.
 */
function normalizeApiOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return __DEV__ ? devApiOrigin() : PROD_API_ORIGIN;
  }
  let s = trimmed.replace(/\/+$/, '');
  while (s.toLowerCase().endsWith('/api')) {
    s = s.slice(0, -4).replace(/\/+$/, '');
  }
  return s || (__DEV__ ? devApiOrigin() : PROD_API_ORIGIN);
}

/** Debug default: emulator loopback (Android) or localhost (iOS). */
function devApiOrigin(): string {
  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
}

/**
 * Build WebSocket base URL from API URL — mirrors the HTTP→WS scheme swap
 * used in marketApi.js and futuresApi.js.
 */
function buildWsOrigin(apiUrl: string, wsOverride?: string): string {
  const override = (wsOverride ?? '').trim();
  if (override) return override.replace(/\/$/, '');
  if (!__DEV__ && apiUrl === PROD_API_ORIGIN) return PROD_WS_ORIGIN;
  return apiUrl.replace(/^http/, 'ws');
}

export const API_URL = normalizeApiOrigin(Config.API_URL);
export const WS_URL = buildWsOrigin(API_URL, Config.WS_URL);

if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('[IBO] API_URL =', API_URL, '| WS_URL =', WS_URL, '| ENV =', Config.ENV_NAME ?? 'dev');
}

export const TOKEN_URL = (Config.TOKEN_URL || 'https://ibo.io').replace(/\/$/, '');
export const ENV_NAME = Config.ENV_NAME || (__DEV__ ? 'development' : 'production');
export const IS_PRODUCTION = ENV_NAME === 'production';
export const IS_DEV = ENV_NAME === 'development';
export const API_TIMEOUT_MS = 20000;
/** Signzy face-match + image upload can exceed the default axios timeout. */
export const KYC_UPLOAD_TIMEOUT_MS = 90000;
export const KYC_FACE_MATCH_TIMEOUT_MS = 120000;
/** Public market REST (ticker, order book seed). */
export const MARKET_PUBLIC_TIMEOUT_MS = 8000;
