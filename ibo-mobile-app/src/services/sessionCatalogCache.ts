import { marketApi } from '../api/market.api';
import type { MarketRow } from '../types/market.types';

let catalogCache: MarketRow[] | null = null;
let inflight: Promise<MarketRow[]> | null = null;

export function getIboCatalogCached(): MarketRow[] | null {
  return catalogCache;
}

export async function loadIboCatalogOnce(force = false): Promise<MarketRow[]> {
  if (!force && catalogCache) return catalogCache;
  if (!force && inflight) return inflight;
  inflight = marketApi.fetchAllIboMarketRows()
    .then((rows) => {
      catalogCache = rows.filter((r) => String(r.symbol || '').endsWith('IBO'));
      return catalogCache;
    })
    .catch(() => {
      catalogCache = [];
      return [];
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
