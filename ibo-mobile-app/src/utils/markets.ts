import { MarketRow } from '../types/market.types';

export type MarketTypeFilter = 'all' | 'spot' | 'futures' | 'options' | 'ibo';
export type MarketCategoryFilter = 'all' | 'gainers' | 'losers' | 'volume' | 'ibo';

/** USDT spot rows — include IBO/USDT; *IBO-quoted pairs live on IBO Markets. */
function usdtSpotMarketsRows(rows: MarketRow[]): MarketRow[] {
  const spot = rows.filter((m) => (m.market_type ?? 'spot') === 'spot');
  const listed = spot.filter((m) => {
    const sym = (m.symbol ?? '').replace('-PERP', '').replace(/\//g, '').toUpperCase();
    if (sym === 'IBOUSDT') return true;
    return !(sym.endsWith('IBO') && sym.length > 3);
  });
  return dedupeMarketsBySymbol(listed);
}

export function parseMarketNum(value: number | string | undefined): number {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** One row per trading pair — prefer spot when duplicates share the same base/quote. */
export function dedupeMarketsBySymbol(rows: MarketRow[]): MarketRow[] {
  const byKey = new Map<string, MarketRow>();
  for (const m of rows) {
    const sym = String(m.symbol ?? '').toUpperCase();
    const { base, quote } = pairParts(m);
    const key = base && quote ? `${base}_${quote}` : sym;
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, m);
      continue;
    }
    const type = m.market_type ?? 'spot';
    const prevType = existing.market_type ?? 'spot';
    if (type === 'spot' && prevType !== 'spot') byKey.set(key, m);
  }
  return [...byKey.values()];
}

export function pairParts(m: MarketRow): { base: string; quote: string } {
  // Always derive from symbol for IBO pairs — backend sometimes sends quote_asset='USDT'
  // for IBO-quoted markets, which would make them display as BTC/USDT instead of BTC/IBO.
  const sym = (m.symbol ?? '').replace('-PERP', '').replace(/\//g, '').toUpperCase();
  if (sym.endsWith('IBO') && sym.length > 3) return { base: sym.slice(0, -3), quote: 'IBO' };
  if (m.base_asset && m.quote_asset) {
    return { base: m.base_asset.toUpperCase(), quote: m.quote_asset.toUpperCase() };
  }
  if (sym.endsWith('USDT')) return { base: sym.slice(0, -4), quote: 'USDT' };
  return { base: sym, quote: '' };
}

export function formatVolumeCompact(value: number | string | undefined): string {
  const n = parseMarketNum(value);
  if (n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

export function filterMarketsList(
  marketList: string[],
  markets: Record<string, MarketRow>,
  opts: {
    typeTab: MarketTypeFilter;
    category: MarketCategoryFilter;
    search: string;
  },
): MarketRow[] {
  const q = opts.search.trim().toUpperCase();

  let rows = marketList
    .map((s) => markets[s])
    .filter(Boolean) as MarketRow[];

  if (opts.typeTab === 'ibo') {
    rows = rows.filter((m) => {
      const sym = (m.symbol ?? '').replace('-PERP', '').replace(/\//g, '').toUpperCase();
      return sym.endsWith('IBO') && sym.length > 3;
    });
  } else if (opts.typeTab === 'all') {
    rows = usdtSpotMarketsRows(rows);
  } else {
    rows = rows.filter((m) => (m.market_type ?? 'spot') === opts.typeTab);
    if (opts.typeTab === 'spot') {
      rows = usdtSpotMarketsRows(rows);
    }
  }

  if (q) {
    rows = rows.filter((m) => {
      const { base, quote } = pairParts(m);
      return (
        m.symbol.includes(q) ||
        base.includes(q) ||
        quote.includes(q)
      );
    });
  }

  switch (opts.category) {
    case 'gainers':
      return rows
        .filter((m) => parseMarketNum(m.price_change_pct_24h) > 0)
        .sort((a, b) => parseMarketNum(b.price_change_pct_24h) - parseMarketNum(a.price_change_pct_24h));
    case 'losers':
      return rows
        .filter((m) => parseMarketNum(m.price_change_pct_24h) < 0)
        .sort((a, b) => parseMarketNum(a.price_change_pct_24h) - parseMarketNum(b.price_change_pct_24h));
    case 'volume':
      return [...rows].sort((a, b) => parseMarketNum(b.volume_24h) - parseMarketNum(a.volume_24h));
    default:
      return [...rows].sort((a, b) => parseMarketNum(b.volume_24h) - parseMarketNum(a.volume_24h));
  }
}

export function marketOverviewStats(rows: MarketRow[]) {
  let gainers = 0;
  let losers = 0;
  let totalVolume = 0;
  rows.forEach((m) => {
    const pct = parseMarketNum(m.price_change_pct_24h);
    if (pct > 0) gainers += 1;
    else if (pct < 0) losers += 1;
    totalVolume += parseMarketNum(m.volume_24h);
  });
  return { pairCount: rows.length, gainers, losers, totalVolume };
}

/**
 * Build 6 synthetic price points from 24h OHLCV data for a sparkline.
 * Returns null when essential data is missing.
 */
export function buildSparkPoints(m: MarketRow): number[] | null {
  const close = parseMarketNum(m.last_price);
  const change = parseMarketNum(m.price_change_24h);
  if (!close) return null;

  const open = close - change;
  const rawHigh = parseMarketNum(m.high_24h);
  const rawLow = parseMarketNum(m.low_24h);

  const high = rawHigh > 0 ? rawHigh : Math.max(open, close) * 1.004;
  const low  = rawLow  > 0 ? rawLow  : Math.min(open, close) * 0.996;

  if (high <= low) return null;

  const pos = close >= open;
  return pos
    ? [open, (open + low) / 2, low, high * 0.995, (high + close) / 2, close]
    : [open, (open + high) / 2, high, low * 1.005, (low + close) / 2, close];
}
