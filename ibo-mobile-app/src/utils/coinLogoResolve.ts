import type { MarketRow } from '../types/market.types';
import { resolveCoinBase } from './coinIcons';
import { toExchangeSymbol, toSpotSymbol } from './tradeSymbols';

/** Resolve listed-token logo from Redux market rows (spot / futures / options). */
export function resolveLogoUrlForSymbol(
  symbol: string,
  markets: Record<string, MarketRow>,
): string | undefined {
  const raw = String(symbol ?? '').trim().toUpperCase();
  if (!raw) return undefined;

  const spot = toExchangeSymbol(toSpotSymbol(raw));
  const perp = `${spot}-PERP`;
  const optionsKey = `options:${spot}`;

  for (const key of [raw, spot, perp, optionsKey]) {
    const url = markets[key]?.logo_url;
    if (url) return url;
  }

  const base = resolveCoinBase(raw);
  if (!base) return undefined;

  for (const row of Object.values(markets)) {
    const rowBase = String(row.base_asset ?? '').trim().toUpperCase();
    if (rowBase === base && row.logo_url) return row.logo_url;
  }

  return undefined;
}
