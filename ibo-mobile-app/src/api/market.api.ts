import apiClient from './client';
import { EP } from './endpoints';
import { MarketRow, Kline, OrderBook, RecentTrade } from '../types/market.types';
import { normalizeOrderBook } from '../utils/orderbook';
import { registerExtraCoinLogos, resolveLogoSync } from '../utils/coinIcons';

let tokenLogoMapCache: Record<string, string> | null = null;
let tokenLogoMapPromise: Promise<Record<string, string>> | null = null;

function pickLogoUrl(raw: Record<string, any>): string | undefined {
  const candidates = [
    raw.logo_url,
    raw.logoUrl,
    raw.image_url,
    raw.imageUrl,
    raw.image,
    raw.icon,
  ];
  for (const c of candidates) {
    const s = c != null ? String(c).trim() : '';
    if (s) return s;
  }
  return undefined;
}

async function fetchTokenLogoMap(): Promise<Record<string, string>> {
  if (tokenLogoMapCache) return tokenLogoMapCache;
  if (tokenLogoMapPromise) return tokenLogoMapPromise;
  tokenLogoMapPromise = (async () => {
    const out: Record<string, string> = {};

    const ingestRows = (items: Record<string, unknown>[]) => {
      for (const row of items) {
        const asset = String((row as any)?.base ?? (row as any)?.asset ?? '').trim().toUpperCase();
        const logo = pickLogoUrl(row as Record<string, any>);
        if (asset && logo && !out[asset]) out[asset] = logo;
      }
    };

    try {
      const { data } = await apiClient.get<{
        items?: Record<string, unknown>[];
      }>('/api/wallet/deposit-catalog', {
        params: {
          deposit_only: 'false',
          include_all_listed: 'true',
          include_web3_directory: 'false',
          skip: '0',
          limit: '200',
          chain: 'bsc',
        },
      });
      ingestRows(Array.isArray(data?.items) ? data.items : []);
    } catch {
      // best-effort enrichment only
    }

    let skip = 0;
    const limit = 200;
    let total = 1;
    try {
      while (skip < total) {
        const { data } = await apiClient.get<{
          items?: Record<string, unknown>[];
          total?: number;
        }>('/api/listings/bsc-directory', {
          params: {
            web3_only: 'true',
            skip: String(skip),
            limit: String(limit),
          },
        });
        const items = Array.isArray(data?.items) ? data.items : [];
        total = Number(data?.total) || items.length;
        ingestRows(items);
        skip += items.length;
        if (!items.length) break;
      }
    } catch {
      // best-effort enrichment only
    }
    tokenLogoMapCache = out;
    registerExtraCoinLogos(out);
    tokenLogoMapPromise = null;
    return out;
  })();
  return tokenLogoMapPromise;
}

async function hydrateLogoUrls(rows: MarketRow[]): Promise<MarketRow[]> {
  const map = await fetchTokenLogoMap();
  if (!map || !Object.keys(map).length) return rows;
  return rows.map((r) => {
    if (r.logo_url) return r;
    const base = String(r.base_asset ?? '').trim().toUpperCase();
    const fallback = map[base];
    return fallback ? { ...r, logo_url: fallback } : r;
  });
}

/**
 * Normalize backend/WS market data to the mobile MarketRow interface.
 * Backend returns Binance-style field names (price, priceChangePercent, etc.)
 * while the mobile type uses snake_case. This bridges the gap.
 */
export function normalizeMarket(m: Record<string, any>): MarketRow {
  return {
    symbol: m.symbol,
    base_asset: m.base_asset ?? m.base ?? String(m.symbol ?? '').replace('USDT', '').replace('-PERP', ''),
    quote_asset: m.quote_asset ?? 'USDT',
    logo_url: pickLogoUrl(m),
    last_price: m.last_price ?? m.price ?? 0,
    price_change_24h: m.price_change_24h ?? m.priceChange ?? 0,
    price_change_pct_24h: m.price_change_pct_24h ?? m.priceChangePercent ?? 0,
    volume_24h: m.volume_24h ?? m.volume ?? 0,
    high_24h: m.high_24h ?? m.highPrice ?? 0,
    low_24h: m.low_24h ?? m.lowPrice ?? 0,
    market_type: m.market_type ?? 'spot',
  };
}

/** Unique store key — options share underlying symbols with spot. */
export function marketStoreKey(row: MarketRow): string {
  if (row.market_type === 'options') return `options:${row.symbol}`;
  return row.symbol;
}

/** Ensure platform token IBO/USDT appears in spot markets (matches web dashboard). */
async function ensureIboUsdtSpot(rows: MarketRow[]): Promise<MarketRow[]> {
  if (rows.some((r) => r.symbol === 'IBOUSDT')) return rows;
  try {
    const { data } = await apiClient.get<Record<string, unknown>>(EP.TRADING_TICKER('IBOUSDT'));
    if (!data?.price && !data?.last_price) return rows;
    const row = spotRowFromRaw({
      symbol: 'IBOUSDT',
      base: 'IBO',
      base_asset: 'IBO',
      quote: 'USDT',
      quote_asset: 'USDT',
      price: data.price ?? data.last_price,
      priceChange: data.priceChange ?? data.price_change_24h ?? 0,
      priceChangePercent: data.priceChangePercent ?? data.price_change_pct_24h ?? 0,
      highPrice: data.highPrice ?? data.high_24h ?? 0,
      lowPrice: data.lowPrice ?? data.low_24h ?? 0,
      volume: data.volume ?? data.volume_24h ?? 0,
      source: 'internal',
      market_type: 'spot',
    });
    return [row, ...rows];
  } catch {
    return rows;
  }
}

function spotRowFromRaw(raw: Record<string, any>): MarketRow {
  return normalizeMarket({ ...raw, market_type: 'spot' });
}

function futuresRowFromCatalog(
  catalog: Record<string, any>,
  spotBySymbol: Record<string, MarketRow>,
): MarketRow {
  const bin = String(catalog.binance_symbol ?? '').toUpperCase();
  const sym = String(catalog.symbol ?? '');
  const spotSym = sym.replace(/-PERP$/i, '').toUpperCase();
  const spot = (bin ? spotBySymbol[bin] : undefined) ?? spotBySymbol[spotSym];
  return {
    symbol: sym,
    base_asset: catalog.base ?? sym.replace('-PERP', '').replace('USDT', ''),
    quote_asset: catalog.quote ?? 'USDT',
    logo_url: pickLogoUrl(catalog) ?? spot?.logo_url,
    last_price: spot?.last_price ?? 0,
    price_change_24h: spot?.price_change_24h ?? 0,
    price_change_pct_24h: spot?.price_change_pct_24h ?? 0,
    volume_24h: spot?.volume_24h ?? 0,
    high_24h: spot?.high_24h ?? 0,
    low_24h: spot?.low_24h ?? 0,
    market_type: 'futures',
  };
}

function optionsRowFromUnderlying(
  underlying: Record<string, any>,
  spotBySymbol: Record<string, MarketRow>,
): MarketRow {
  const sym = String(underlying.symbol ?? '').toUpperCase();
  const spot = spotBySymbol[sym];
  const base = underlying.display_name ?? sym.replace('USDT', '');
  return {
    symbol: sym,
    base_asset: base,
    quote_asset: 'USDT',
    logo_url: pickLogoUrl(underlying) ?? spot?.logo_url,
    last_price: spot?.last_price ?? 0,
    price_change_24h: spot?.price_change_24h ?? 0,
    price_change_pct_24h: spot?.price_change_pct_24h ?? 0,
    volume_24h: spot?.volume_24h ?? 0,
    high_24h: spot?.high_24h ?? 0,
    low_24h: spot?.low_24h ?? 0,
    market_type: 'options',
  };
}

const IBO_PAGE_LIMIT = 80;

function normalizeIboMarketRow(raw: Record<string, unknown>): MarketRow {
  const sym = String(raw.symbol ?? '').toUpperCase();
  const base = String(raw.base ?? raw.baseAsset ?? sym.replace(/IBO$/, ''));
  return normalizeMarket({
    symbol: sym,
    base_asset: base,
    quote_asset: 'IBO',
    last_price: raw.price ?? 0,
    price_change_24h: raw.priceChange ?? 0,
    price_change_pct_24h: raw.priceChangePercent ?? 0,
    high_24h: raw.highPrice ?? 0,
    low_24h: raw.lowPrice ?? 0,
    volume_24h: raw.volume ?? 0,
    logo_url: pickLogoUrl(raw as Record<string, any>),
    market_type: 'spot',
  });
}

/** Load every IBO-quoted pair (majors + full Web3 catalog), paginated. */
export async function fetchAllIboMarketRows(): Promise<MarketRow[]> {
  const out: MarketRow[] = [];
  const seen = new Set<string>();
  let skip = 0;
  let total = 1;

  while (skip < total) {
    const res = await apiClient.get<{
      markets?: Record<string, unknown>[];
      items?: Record<string, unknown>[];
      total?: number;
    }>(EP.IBO_MARKETS, {
      params: { tier: 'all', skip, limit: IBO_PAGE_LIMIT },
    });
    const sourceRows = Array.isArray(res.data?.markets)
      ? res.data.markets
      : Array.isArray(res.data?.items)
        ? res.data.items
        : [];
    const list = sourceRows.map((raw) => normalizeIboMarketRow(raw));
    total = Number(res.data?.total) ?? skip + list.length;
    for (const row of list) {
      if (row.symbol && !seen.has(row.symbol)) {
        seen.add(row.symbol);
        out.push(row);
      }
    }
    skip += list.length;
    if (!list.length) break;
  }
  return hydrateLogoUrls(out);
}

export const marketApi = {
  getMarkets: async () => {
    const res = await apiClient.get<any[]>(EP.TRADING_MARKETS);
    return { ...res, data: (res.data ?? []).map(spotRowFromRaw) as MarketRow[] };
  },

  /**
   * Fast catalog for wallet / dashboard / trade header — no paginated IBO crawl.
   * Full Web3 IBO list is loaded on Markets / pair picker via getAllMarkets().
   */
  getMarketsLite: async (): Promise<MarketRow[]> => {
    const [spotRes, futuresRes, optionsRes] = await Promise.allSettled([
      apiClient.get<any[]>(EP.TRADING_MARKETS),
      apiClient.get<{ symbols?: any[] }>(EP.FUTURES_SYMBOLS),
      apiClient.get<{ underlyings?: any[] }>(EP.OPTIONS_UNDERLYINGS, {
        params: { listed_only: true },
      }),
    ]);

    let spotRows: MarketRow[] =
      spotRes.status === 'fulfilled'
        ? (spotRes.value.data ?? []).map(spotRowFromRaw)
        : [];

    spotRows = await ensureIboUsdtSpot(spotRows);
    const spotBySymbol = Object.fromEntries(spotRows.map((r) => [r.symbol, r]));

    const futuresRows: MarketRow[] =
      futuresRes.status === 'fulfilled'
        ? (futuresRes.value.data?.symbols ?? []).map((s: Record<string, any>) =>
            futuresRowFromCatalog(s, spotBySymbol),
          )
        : [];

    const optionsRows: MarketRow[] =
      optionsRes.status === 'fulfilled'
        ? (optionsRes.value.data?.underlyings ?? []).map((u: Record<string, any>) =>
            optionsRowFromUnderlying(u, spotBySymbol),
          )
        : [];

    return hydrateLogoUrls([...spotRows, ...futuresRows, ...optionsRows]);
  },

  /** Spot + futures + options + full paginated IBO catalog (slow — use on Markets / pair search). */
  getAllMarkets: async (): Promise<MarketRow[]> => {
    const lite = await marketApi.getMarketsLite();
    let spotRows = lite.filter((r) => r.market_type === 'spot');
    const futuresRows = lite.filter((r) => r.market_type === 'futures');
    const optionsRows = lite.filter((r) => r.market_type === 'options');

    try {
      const iboAll = await fetchAllIboMarketRows();
      const seen = new Set(spotRows.map((r) => r.symbol));
      for (const row of iboAll) {
        if (row.symbol && !seen.has(row.symbol)) {
          seen.add(row.symbol);
          spotRows.push(row);
        }
      }
    } catch {
      /* optional */
    }

    return [...spotRows, ...futuresRows, ...optionsRows];
  },

  getTicker: (symbol: string) =>
    apiClient.get(EP.TRADING_TICKER(symbol)),

  getKlines: (symbol: string, params?: { interval?: string; limit?: number }) =>
    apiClient.get<Kline[]>(EP.TRADING_KLINES(symbol), { params }),

  getOrderBook: (symbol: string) =>
    apiClient.get<OrderBook>(EP.TRADING_ORDERBOOK(symbol)).then((res) => ({
      ...res,
      data: normalizeOrderBook(res.data),
    })),

  getRecentTrades: (symbol: string) =>
    apiClient.get<RecentTrade[]>(EP.TRADING_TRADES(symbol)),

  /** Paginated IBO-quoted markets (tier, q, skip, limit). Fast path — no async logo hydration. */
  getIBOMarkets: async (params?: { tier?: string; q?: string; skip?: number; limit?: number }) => {
    const res = await apiClient.get<{
      markets?: Record<string, unknown>[];
      items?: Record<string, unknown>[];
      total?: number;
      total_catalog?: number;
      [k: string]: unknown;
    }>(EP.IBO_MARKETS, { params });

    const rawMarkets = Array.isArray(res.data?.markets)
      ? res.data.markets
      : Array.isArray(res.data?.items)
        ? res.data.items
        : [];

    // Sync logo enrichment from already-cached map — no network waterfall.
    const patchedMarkets = rawMarkets.map((raw) => {
      const r = raw as Record<string, any>;
      if (pickLogoUrl(r)) return r;
      const base = String(r.base ?? r.baseAsset ?? String(r.symbol ?? '').replace(/IBO$/, '')).trim().toUpperCase();
      const logo = base ? resolveLogoSync(base) : undefined;
      return logo ? { ...r, logo_url: logo } : r;
    });

    // Kick off background logo map population so subsequent opens are enriched.
    void fetchTokenLogoMap();

    return {
      ...res,
      data: {
        ...res.data,
        markets: patchedMarkets,
        items: patchedMarkets,
      },
    };
  },

  fetchAllIboMarketRows,

  normalizeIboMarketRow,
};
