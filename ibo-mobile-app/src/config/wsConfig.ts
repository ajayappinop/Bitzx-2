import { WS_URL } from './env';

/**
 * Build full WebSocket URL for exchange streams.
 * Mirrors: exchangeWsPath() from marketApi.js
 */
export function exchangeWsPath(pathWithQuery: string): string {
  const p = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  return `${WS_URL}${p}`;
}

/**
 * Build full WebSocket URL for futures streams.
 * Mirrors: futuresWsUrl() from futuresApi.js
 */
export function futuresWsUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${WS_URL}${p}`;
}

/**
 * Build full WebSocket URL for options streams.
 */
export function optionsWsUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${WS_URL}${p}`;
}

/**
 * WebSocket URL for the IBO markets snapshot stream.
 * Broadcasts all IBO-quoted pair tickers every ~5 s.
 */
export function iboMarketsWsUrl(): string {
  return `${WS_URL}/api/ws/ibo/markets`;
}

/**
 * WebSocket URL for a single IBO-quoted pair order book.
 */
export function iboOrderbookWsUrl(symbol: string): string {
  return `${WS_URL}/api/ws/ibo/orderbook?symbol=${symbol.toUpperCase()}`;
}
