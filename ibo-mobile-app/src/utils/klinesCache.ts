import type { Kline } from '../types/market.types';
import { toExchangeSymbol } from './tradeSymbols';

const store = new Map<string, { rows: Kline[]; fetchedAt: number }>();

export function klinesCacheKey(symbol: string, interval: string): string {
  return `${toExchangeSymbol(symbol)}|${interval}`;
}

export function readKlinesCache(key: string): Kline[] | null {
  const e = store.get(key);
  return e?.rows?.length ? e.rows : null;
}

export function readSymbolKlines(symbol: string, interval: string): Kline[] {
  return readKlinesCache(klinesCacheKey(symbol, interval)) ?? [];
}

export function hasSymbolKlines(symbol: string, interval: string): boolean {
  return readSymbolKlines(symbol, interval).length > 0;
}

export function writeKlinesCache(key: string, rows: Kline[]): void {
  if (!rows.length) return;
  store.set(key, { rows, fetchedAt: Date.now() });
}

export function writeSymbolKlines(symbol: string, interval: string, rows: Kline[]): void {
  writeKlinesCache(klinesCacheKey(symbol, interval), rows);
}

export function klinesCacheAgeMs(key: string): number | null {
  const e = store.get(key);
  if (!e) return null;
  return Date.now() - e.fetchedAt;
}

export const KLINES_SOFT_TTL_MS = 90_000;
